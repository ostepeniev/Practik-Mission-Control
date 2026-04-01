/**
 * Tests for lib/llm-gateway.js — LLM Gateway
 * 
 * Перевіряє конфігурацію, cost estimation, fallback logic.
 * Не робить реальних API calls — тестує тільки логіку.
 */
import { describe, it, expect } from 'vitest';
import { estimateCost, getGatewayInfo, isGatewayReady } from '../lib/llm-gateway.js';

// ─── Cost Estimation ─────────────────────────────────────────

describe('estimateCost', () => {
  it('estimates OpenAI GPT-4o cost', () => {
    const cost = estimateCost('openai', 'gpt-4o', {
      prompt_tokens: 1000,
      completion_tokens: 500,
    });
    // 1000/1M * $5 + 500/1M * $15 = $0.005 + $0.0075 = $0.0125
    expect(cost).toBeCloseTo(0.0125, 4);
  });

  it('estimates OpenAI GPT-4o-mini cost', () => {
    const cost = estimateCost('openai', 'gpt-4o-mini', {
      prompt_tokens: 10000,
      completion_tokens: 2000,
    });
    // 10000/1M * $0.15 + 2000/1M * $0.6 = $0.0015 + $0.0012 = $0.0027
    expect(cost).toBeCloseTo(0.0027, 4);
  });

  it('estimates Anthropic Claude Sonnet cost', () => {
    const cost = estimateCost('anthropic', 'claude-sonnet-4-20250514', {
      prompt_tokens: 5000,
      completion_tokens: 1000,
    });
    // 5000/1M * $3 + 1000/1M * $15 = $0.015 + $0.015 = $0.03
    expect(cost).toBeCloseTo(0.03, 4);
  });

  it('returns 0 for no usage', () => {
    expect(estimateCost('openai', 'gpt-4o', null)).toBe(0);
    expect(estimateCost('openai', 'gpt-4o', undefined)).toBe(0);
  });

  it('returns 0 for unknown provider', () => {
    expect(estimateCost('unknown', 'model', { prompt_tokens: 100 })).toBe(0);
  });
});

// ─── Gateway Info ────────────────────────────────────────────

describe('getGatewayInfo', () => {
  it('throws when no API keys configured', () => {
    // In test environment without keys, should throw
    if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
      expect(() => getGatewayInfo()).toThrow('No API keys configured');
    }
  });

  it('returns valid structure when keys are set', () => {
    // Skip if no keys in env
    if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) return;
    
    const info = getGatewayInfo();
    expect(info).toHaveProperty('primary');
    expect(info).toHaveProperty('fallbacks');
    expect(info.totalProviders).toBeGreaterThan(0);
    for (const p of info.providers) {
      expect(p).toHaveProperty('provider');
      expect(p).toHaveProperty('model');
      expect(p).toHaveProperty('name');
    }
  });
});

// ─── Gateway Readiness ───────────────────────────────────────

describe('isGatewayReady', () => {
  it('returns boolean', () => {
    const ready = isGatewayReady();
    expect(typeof ready).toBe('boolean');
  });
});
