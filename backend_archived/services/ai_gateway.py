"""AI Gateway — multi-provider LLM abstraction layer.
Primary provider + fallback. Structured outputs. Run logging.
"""
import os
import json
import time
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional
from sqlalchemy.orm import Session

from backend.models.ai import AIRun, AIInsight, AIProviderConfig


class LLMProvider(ABC):
    """Abstract LLM provider interface."""

    @abstractmethod
    async def generate(self, system_prompt: str, user_prompt: str,
                       response_schema: dict = None, max_tokens: int = 2000,
                       temperature: float = 0.3) -> dict:
        """Generate a response. Returns {"content": str, "tokens_in": int, "tokens_out": int}."""
        pass

    @abstractmethod
    def name(self) -> str:
        pass


class MockProvider(LLMProvider):
    """Mock provider for development — returns realistic demo responses."""

    def name(self) -> str:
        return "mock"

    async def generate(self, system_prompt: str, user_prompt: str,
                       response_schema: dict = None, max_tokens: int = 2000,
                       temperature: float = 0.3) -> dict:
        # Generate contextual mock response based on prompt content
        prompt_lower = user_prompt.lower()

        if "маржа" in prompt_lower or "margin" in prompt_lower:
            content = json.dumps({
                "answer": "Аналіз показує, що зниження маржинальності пов'язане з двома факторами: "
                          "1) Збільшення середньої знижки на 4.2 п.п. за останній тиждень, "
                          "переважно через менеджера Ткаченко М. "
                          "2) Зростання собівартості сировини на 3% по категорії сухого корму. "
                          "Рекомендую: перевірити політику знижок та переглянути закупівельні ціни.",
                "confidence": 0.82,
                "data_sources": ["sales_orders", "cost_price_history", "managers"],
                "follow_up_questions": [
                    "Які конкретно замовлення мали найбільші знижки?",
                    "Як змінилася собівартість по окремих SKU?"
                ]
            }, ensure_ascii=False)
        elif "продаж" in prompt_lower or "sales" in prompt_lower or "виторг" in prompt_lower:
            content = json.dumps({
                "answer": "Продажі за поточний місяць демонструють стабільне зростання +8% порівняно "
                          "з аналогічним періодом. Найбільший внесок — категорія сухого корму для собак (+12%). "
                          "Канал маркетплейсів показує найшвидше зростання. "
                          "Зверніть увагу на товари-новинки: Grain Free Качка має повільний старт.",
                "confidence": 0.88,
                "data_sources": ["sales_orders", "products"],
                "follow_up_questions": [
                    "Які товари показали найбільше зростання?",
                    "Як розподіляються продажі по каналах?"
                ]
            }, ensure_ascii=False)
        else:
            content = json.dumps({
                "answer": "На основі аналізу даних, ситуація загалом стабільна. "
                          "Ключові метрики в межах норми. "
                          "Є кілька товарів, що потребують уваги — вони позначені відповідним статусом у таблиці.",
                "confidence": 0.75,
                "data_sources": ["sales_orders", "products"],
                "follow_up_questions": [
                    "Які товари потребують уваги?",
                    "Чи є аномалії за останній тиждень?"
                ]
            }, ensure_ascii=False)

        return {
            "content": content,
            "tokens_in": len(system_prompt + user_prompt) // 4,
            "tokens_out": len(content) // 4,
        }


class OpenAIProvider(LLMProvider):
    """OpenAI provider (GPT-4o)."""

    def name(self) -> str:
        return "openai"

    async def generate(self, system_prompt: str, user_prompt: str,
                       response_schema: dict = None, max_tokens: int = 2000,
                       temperature: float = 0.3) -> dict:
        try:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]

            kwargs = {
                "model": os.getenv("OPENAI_MODEL", "gpt-4o"),
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
            }

            if response_schema:
                kwargs["response_format"] = {"type": "json_object"}

            response = await client.chat.completions.create(**kwargs)

            return {
                "content": response.choices[0].message.content,
                "tokens_in": response.usage.prompt_tokens,
                "tokens_out": response.usage.completion_tokens,
            }
        except Exception as e:
            raise RuntimeError(f"OpenAI error: {str(e)}")


class AIGateway:
    """AI Gateway with provider routing, fallback, and run logging."""

    PROVIDERS = {
        "openai": OpenAIProvider,
        "mock": MockProvider,
    }

    def __init__(self, db: Session):
        self.db = db

    def _get_provider(self, name: str) -> LLMProvider:
        cls = self.PROVIDERS.get(name)
        if not cls:
            cls = MockProvider
        return cls()

    async def ask(self, question: str, context: str = "",
                  task_type: str = "ask", provider_name: str = None) -> dict:
        """Route a question through the AI gateway."""
        primary = provider_name or os.getenv("PRIMARY_AI_PROVIDER", "mock")
        fallback = os.getenv("FALLBACK_AI_PROVIDER", "mock")

        system_prompt = (
            "Ти — AI-аналітик для компанії Practik UA, що виробляє і продає корм для тварин. "
            "Ти аналізуєш бізнес-дані і даєш короткі, конкретні висновки українською мовою. "
            "Відповідай структуровано у форматі JSON з полями: answer, confidence (0-1), "
            "data_sources (список), follow_up_questions (список). "
            "Не вигадуй дані. Якщо даних недостатньо — скажи про це."
        )

        if context:
            system_prompt += f"\n\nКонтекст даних:\n{context}"

        # Try primary
        provider = self._get_provider(primary)
        start = time.time()
        try:
            result = await provider.generate(system_prompt, question)
            latency = int((time.time() - start) * 1000)

            # Log run
            run = AIRun(
                provider=provider.name(),
                model=primary,
                task_type=task_type,
                input_summary=question[:500],
                output_summary=result["content"][:500],
                tokens_in=result.get("tokens_in", 0),
                tokens_out=result.get("tokens_out", 0),
                cost_usd=0,
                latency_ms=latency,
                status="success"
            )
            self.db.add(run)
            self.db.commit()

            # Parse JSON response
            try:
                parsed = json.loads(result["content"])
            except json.JSONDecodeError:
                parsed = {"answer": result["content"], "confidence": 0.5}

            return {
                "response": parsed,
                "provider": provider.name(),
                "latency_ms": latency,
                "run_id": run.id,
            }

        except Exception as e:
            # Log failed run
            self.db.add(AIRun(
                provider=provider.name(), model=primary, task_type=task_type,
                input_summary=question[:500], status="error",
                error_message=str(e), latency_ms=int((time.time() - start) * 1000)
            ))
            self.db.commit()

            # Try fallback
            if fallback and fallback != primary:
                fb_provider = self._get_provider(fallback)
                start2 = time.time()
                try:
                    result = await fb_provider.generate(system_prompt, question)
                    latency2 = int((time.time() - start2) * 1000)

                    run2 = AIRun(
                        provider=fb_provider.name(), model=fallback, task_type=task_type,
                        input_summary=question[:500], output_summary=result["content"][:500],
                        tokens_in=result.get("tokens_in", 0),
                        tokens_out=result.get("tokens_out", 0),
                        latency_ms=latency2, status="success"
                    )
                    self.db.add(run2)
                    self.db.commit()

                    try:
                        parsed = json.loads(result["content"])
                    except json.JSONDecodeError:
                        parsed = {"answer": result["content"], "confidence": 0.5}

                    return {
                        "response": parsed,
                        "provider": fb_provider.name(),
                        "latency_ms": latency2,
                        "run_id": run2.id,
                        "fallback": True,
                    }
                except Exception as e2:
                    pass

            return {
                "response": {"answer": "AI наразі недоступний. Спробуйте пізніше.", "confidence": 0},
                "provider": "none",
                "error": str(e),
            }
