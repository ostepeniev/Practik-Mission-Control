/**
 * LLM Gateway — абстракція для мультипровайдерного LLM routing.
 * 
 * Фаза 1: Claude Sonnet (primary) + OpenAI GPT-4o (fallback)
 * Фаза 4: + Gemini Flash (cheap tier) + smart routing
 * 
 * Всі AI-модулі мають використовувати цей gateway замість прямого openai SDK.
 */
import OpenAI from 'openai';

// ─── Provider Configuration ────────────────────────────────────

const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    client: null,
    createClient: () => new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    }),
    defaultModel: process.env.OPENAI_MODEL || 'gpt-4o',
    // Approximate costs per 1M tokens (USD)
    costs: {
      'gpt-4o': { input: 5.0, output: 15.0 },
      'gpt-4o-mini': { input: 0.15, output: 0.6 },
    },
  },
  anthropic: {
    name: 'Anthropic',
    client: null,
    createClient: () => new OpenAI({
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: 'https://api.anthropic.com/v1/',
      defaultHeaders: { 'anthropic-version': '2023-06-01' },
    }),
    defaultModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    costs: {
      'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
      'claude-haiku-3-20240307': { input: 0.25, output: 1.25 },
    },
  },
};

// ─── Fallback Chain ─────────────────────────────────────────────

/**
 * Визначення ланцюга fallback.
 * Primary → Fallback1 → Fallback2 → ...
 * Якщо primary не має API key — автоматично переходить до наступного.
 */
function getFallbackChain() {
  const chain = [];

  // Primary: Anthropic (Claude) якщо є ключ
  if (process.env.ANTHROPIC_API_KEY) {
    chain.push({ provider: 'anthropic', model: PROVIDERS.anthropic.defaultModel });
  }

  // Fallback: OpenAI (завжди доступний якщо є ключ)
  if (process.env.OPENAI_API_KEY) {
    chain.push({ provider: 'openai', model: PROVIDERS.openai.defaultModel });
  }

  // Якщо жоден не налаштований — помилка
  if (chain.length === 0) {
    throw new Error('LLM Gateway: No API keys configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
  }

  return chain;
}

// ─── Client Management ──────────────────────────────────────────

function getClient(providerName) {
  const provider = PROVIDERS[providerName];
  if (!provider) throw new Error(`Unknown LLM provider: ${providerName}`);
  if (!provider.client) {
    provider.client = provider.createClient();
  }
  return provider.client;
}

// ─── Cost Estimation ────────────────────────────────────────────

/**
 * Оцінка вартості запиту в USD
 */
export function estimateCost(providerName, model, usage) {
  if (!usage) return 0;
  const provider = PROVIDERS[providerName];
  if (!provider) return 0;
  const costs = provider.costs[model] || { input: 5.0, output: 15.0 };
  const inputCost = (usage.prompt_tokens || 0) / 1_000_000 * costs.input;
  const outputCost = (usage.completion_tokens || 0) / 1_000_000 * costs.output;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000; // 6 decimal places
}

// ─── Main Chat Completion ───────────────────────────────────────

/**
 * Відправити chat completion запит через gateway.
 * Автоматично пробує providers по fallback chain.
 * 
 * @param {Object} options
 * @param {Array} options.messages - Масив повідомлень [{role, content}]
 * @param {Array} [options.tools] - Tool definitions
 * @param {number} [options.temperature=0.3] - Temperature
 * @param {number} [options.max_tokens=4000] - Max tokens
 * @param {string} [options.forceProvider] - Force specific provider (skip fallback)
 * @returns {Object} { message, usage, provider, model, estimatedCost }
 */
export async function chatCompletion({
  messages,
  tools,
  temperature = 0.3,
  max_tokens = 4000,
  forceProvider = null,
}) {
  const chain = forceProvider
    ? [{ provider: forceProvider, model: PROVIDERS[forceProvider]?.defaultModel }]
    : getFallbackChain();

  let lastError = null;

  for (const { provider: providerName, model } of chain) {
    try {
      const client = getClient(providerName);
      
      const requestParams = {
        model,
        messages,
        temperature,
        max_tokens,
      };

      // Only include tools if provided and non-empty
      if (tools && tools.length > 0) {
        requestParams.tools = tools;
      }

      const response = await client.chat.completions.create(requestParams);
      const message = response.choices[0].message;
      const usage = response.usage;
      const cost = estimateCost(providerName, model, usage);

      return {
        message,
        usage,
        provider: providerName,
        model,
        estimatedCost: cost,
      };
    } catch (error) {
      lastError = error;
      console.error(`[LLM Gateway] ${providerName}/${model} failed:`, error.message);
      // Continue to next provider in chain
    }
  }

  // All providers failed
  throw new Error(
    `LLM Gateway: All providers failed. Last error: ${lastError?.message || 'Unknown error'}`
  );
}

// ─── Convenience: Get Active Provider Info ──────────────────────

/**
 * Повернути інформацію про поточну конфігурацію gateway.
 */
export function getGatewayInfo() {
  const chain = getFallbackChain();
  return {
    primary: chain[0] || null,
    fallbacks: chain.slice(1),
    totalProviders: chain.length,
    providers: chain.map(c => ({
      provider: c.provider,
      model: c.model,
      name: PROVIDERS[c.provider]?.name,
    })),
  };
}

/**
 * Перевірити чи gateway має хоча б один налаштований provider.
 */
export function isGatewayReady() {
  try {
    const chain = getFallbackChain();
    return chain.length > 0;
  } catch {
    return false;
  }
}
