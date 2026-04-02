/**
 * LLM Gateway — абстракція для мультипровайдерного LLM routing.
 * 
 * Фаза 1: Claude Sonnet (primary) + OpenAI GPT-4o (fallback)
 * Фаза 4: + Gemini Flash (cheap tier) + smart routing
 * 
 * Всі AI-модулі мають використовувати цей gateway замість прямих SDK calls.
 * 
 * Кожен provider має свій SDK і свій формат — gateway уніфікує це в один
 * інтерфейс з однаковим форматом відповіді (OpenAI-compatible).
 */
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

// ─── Provider Configuration ────────────────────────────────────

const PROVIDERS = {
  openai: {
    name: 'OpenAI',
    client: null,
    createClient: () => new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
    defaultModel: process.env.OPENAI_MODEL || 'gpt-4o',
    costs: {
      'gpt-4o': { input: 5.0, output: 15.0 },
      'gpt-4o-mini': { input: 0.15, output: 0.6 },
    },
  },
  anthropic: {
    name: 'Anthropic',
    client: null,
    createClient: () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }),
    defaultModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    costs: {
      'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
      'claude-haiku-3-20240307': { input: 0.25, output: 1.25 },
    },
  },
};

// ─── Fallback Chain ─────────────────────────────────────────────

function getFallbackChain() {
  const chain = [];
  if (process.env.ANTHROPIC_API_KEY) {
    chain.push({ provider: 'anthropic', model: PROVIDERS.anthropic.defaultModel });
  }
  if (process.env.OPENAI_API_KEY) {
    chain.push({ provider: 'openai', model: PROVIDERS.openai.defaultModel });
  }
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

// ─── Anthropic ↔ OpenAI Format Conversion ───────────────────────

/**
 * Конвертувати OpenAI-формат tools → Anthropic-формат tools.
 * OpenAI: { type: 'function', function: { name, description, parameters } }
 * Anthropic: { name, description, input_schema }
 */
function convertToolsToAnthropic(openaiTools) {
  if (!openaiTools || openaiTools.length === 0) return [];
  return openaiTools.map(t => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

/**
 * Конвертувати OpenAI-формат messages → Anthropic-формат messages.
 * Anthropic: system prompt передається окремим параметром, не в messages.
 * Anthropic: tool_call_id → tool results мають інший формат.
 */
function convertMessagesForAnthropic(openaiMessages) {
  let systemPrompt = '';
  const messages = [];

  for (const msg of openaiMessages) {
    if (msg.role === 'system') {
      systemPrompt += (systemPrompt ? '\n\n' : '') + msg.content;
      continue;
    }

    if (msg.role === 'user' || msg.role === 'assistant') {
      // Assistant message with tool_calls → Anthropic format
      if (msg.role === 'assistant' && msg.tool_calls) {
        const content = [];
        if (msg.content) {
          content.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          });
        }
        messages.push({ role: 'assistant', content });
        continue;
      }

      messages.push({ role: msg.role, content: msg.content });
      continue;
    }

    if (msg.role === 'tool') {
      // Tool result → Anthropic format: role='user' with tool_result content block
      // Check if previous message is already a user message with tool results
      const lastMsg = messages[messages.length - 1];
      const toolResultBlock = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id,
        content: msg.content,
      };
      
      if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content) && 
          lastMsg.content.some(b => b.type === 'tool_result')) {
        // Merge into existing user message
        lastMsg.content.push(toolResultBlock);
      } else {
        messages.push({ role: 'user', content: [toolResultBlock] });
      }
      continue;
    }
  }

  return { systemPrompt, messages };
}

/**
 * Конвертувати Anthropic response → OpenAI-compatible response format.
 * Це дозволяє ai-engine.js працювати однаково незалежно від provider.
 */
function convertAnthropicResponse(anthropicResponse) {
  const content = anthropicResponse.content;
  
  // Extract text and tool_use blocks
  const textBlocks = content.filter(b => b.type === 'text');
  const toolUseBlocks = content.filter(b => b.type === 'tool_use');
  
  const message = {
    role: 'assistant',
    content: textBlocks.map(b => b.text).join('\n') || null,
  };

  // Convert tool_use → OpenAI tool_calls format
  if (toolUseBlocks.length > 0) {
    message.tool_calls = toolUseBlocks.map(b => ({
      id: b.id,
      type: 'function',
      function: {
        name: b.name,
        arguments: JSON.stringify(b.input),
      },
    }));
  }

  const usage = {
    prompt_tokens: anthropicResponse.usage?.input_tokens || 0,
    completion_tokens: anthropicResponse.usage?.output_tokens || 0,
    total_tokens: (anthropicResponse.usage?.input_tokens || 0) + (anthropicResponse.usage?.output_tokens || 0),
  };

  return { message, usage };
}

// ─── Cost Estimation ────────────────────────────────────────────

export function estimateCost(providerName, model, usage) {
  if (!usage) return 0;
  const provider = PROVIDERS[providerName];
  if (!provider) return 0;
  const costs = provider.costs[model] || { input: 5.0, output: 15.0 };
  const inputCost = (usage.prompt_tokens || 0) / 1_000_000 * costs.input;
  const outputCost = (usage.completion_tokens || 0) / 1_000_000 * costs.output;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

// ─── Provider-Specific Call Functions ───────────────────────────

async function callOpenAI(client, { model, messages, tools, temperature, max_tokens }) {
  const params = { model, messages, temperature, max_tokens };
  if (tools && tools.length > 0) params.tools = tools;

  const response = await client.chat.completions.create(params);
  return {
    message: response.choices[0].message,
    usage: response.usage,
  };
}

async function callAnthropic(client, { model, messages, tools, temperature, max_tokens }) {
  const { systemPrompt, messages: anthropicMessages } = convertMessagesForAnthropic(messages);
  
  const params = {
    model,
    messages: anthropicMessages,
    temperature,
    max_tokens,
  };

  if (systemPrompt) params.system = systemPrompt;
  
  const anthropicTools = convertToolsToAnthropic(tools);
  if (anthropicTools.length > 0) params.tools = anthropicTools;

  const response = await client.messages.create(params);
  return convertAnthropicResponse(response);
}

// ─── Main Chat Completion ───────────────────────────────────────

/**
 * Unified chat completion — працює однаково для OpenAI та Anthropic.
 * Повертає результат завжди в OpenAI-compatible форматі.
 * 
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
      const callFn = providerName === 'anthropic' ? callAnthropic : callOpenAI;
      
      const { message, usage } = await callFn(client, {
        model, messages, tools, temperature, max_tokens,
      });

      const cost = estimateCost(providerName, model, usage);

      return { message, usage, provider: providerName, model, estimatedCost: cost };
    } catch (error) {
      lastError = error;
      console.error(`[LLM Gateway] ${providerName}/${model} failed:`, error.message);
    }
  }

  throw new Error(
    `LLM Gateway: All providers failed. Last error: ${lastError?.message || 'Unknown error'}`
  );
}

// ─── Info & Readiness ───────────────────────────────────────────

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

export function isGatewayReady() {
  try {
    return getFallbackChain().length > 0;
  } catch {
    return false;
  }
}
