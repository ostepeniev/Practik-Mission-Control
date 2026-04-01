/**
 * Tests for lib/metrics.js — Metrics Dictionary
 * 
 * Перевіряє що всі бізнес-формули працюють коректно.
 * Це критично — неправильна формула маржі може коштувати грошей.
 */
import { describe, it, expect } from 'vitest';
import {
  grossMarginPct,
  grossMarginAmount,
  avgPrice,
  returnsPct,
  roas,
  cac,
  cpl,
  aov,
  conversionRate,
  deltaPct,
  deltaPP,
  classifyProductStatus,
  round,
  previousPeriod,
  STATUS_ORDER,
} from '../lib/metrics.js';

// ─── Core Financial Metrics ──────────────────────────────────

describe('grossMarginPct', () => {
  it('calculates margin correctly', () => {
    // Revenue 100, COGS 70 → margin 30%
    expect(grossMarginPct(100, 70)).toBe(30);
  });

  it('handles high margin', () => {
    expect(grossMarginPct(100, 20)).toBe(80);
  });

  it('handles zero margin', () => {
    expect(grossMarginPct(100, 100)).toBe(0);
  });

  it('handles negative margin', () => {
    // Selling below cost
    expect(grossMarginPct(100, 120)).toBe(-20);
  });

  it('returns 0 for zero revenue', () => {
    expect(grossMarginPct(0, 50)).toBe(0);
  });

  it('returns 0 for null revenue', () => {
    expect(grossMarginPct(null, 50)).toBe(0);
  });
});

describe('grossMarginAmount', () => {
  it('calculates amount correctly', () => {
    expect(grossMarginAmount(100, 70)).toBe(30);
  });

  it('handles null values', () => {
    expect(grossMarginAmount(null, null)).toBe(0);
  });
});

describe('avgPrice', () => {
  it('calculates average price', () => {
    expect(avgPrice(1000, 50)).toBe(20);
  });

  it('returns 0 for zero quantity', () => {
    expect(avgPrice(1000, 0)).toBe(0);
  });
});

describe('returnsPct', () => {
  it('calculates return rate', () => {
    expect(returnsPct(5, 100)).toBe(5);
  });

  it('returns 0 for zero sold', () => {
    expect(returnsPct(5, 0)).toBe(0);
  });
});

// ─── Marketing Metrics ───────────────────────────────────────

describe('roas', () => {
  it('calculates ROAS', () => {
    // Revenue 5000, Spend 1000 → ROAS 5x
    expect(roas(5000, 1000)).toBe(5);
  });

  it('returns 0 for zero spend', () => {
    expect(roas(5000, 0)).toBe(0);
  });
});

describe('cac', () => {
  it('calculates CAC', () => {
    // Spend 1000, 10 new customers → CAC 100
    expect(cac(1000, 10)).toBe(100);
  });

  it('returns 0 for zero customers', () => {
    expect(cac(1000, 0)).toBe(0);
  });
});

describe('cpl', () => {
  it('calculates CPL', () => {
    expect(cpl(1000, 50)).toBe(20);
  });
});

describe('aov', () => {
  it('calculates AOV', () => {
    expect(aov(10000, 100)).toBe(100);
  });
});

describe('conversionRate', () => {
  it('calculates conversion rate', () => {
    expect(conversionRate(50, 1000)).toBe(5);
  });

  it('returns 0 for zero visitors', () => {
    expect(conversionRate(50, 0)).toBe(0);
  });
});

// ─── Deltas ──────────────────────────────────────────────────

describe('deltaPct', () => {
  it('calculates positive growth', () => {
    // 120 vs 100 → +20%
    expect(deltaPct(120, 100)).toBe(20);
  });

  it('calculates negative decline', () => {
    // 80 vs 100 → -20%
    expect(deltaPct(80, 100)).toBe(-20);
  });

  it('returns 0 when previous is zero', () => {
    expect(deltaPct(100, 0)).toBe(0);
  });
});

describe('deltaPP', () => {
  it('calculates p.p. change', () => {
    // Margin: 25% vs 30% → -5 p.p.
    expect(deltaPP(25, 30)).toBe(-5);
  });
});

// ─── Product Status Classification ──────────────────────────

describe('classifyProductStatus', () => {
  it('marks new products as "new"', () => {
    expect(classifyProductStatus({ daysSinceLaunch: 5 })).toBe('new');
    expect(classifyProductStatus({ daysSinceLaunch: 13 })).toBe('new');
  });

  it('marks 14+ day old products as normal by default', () => {
    expect(classifyProductStatus({ daysSinceLaunch: 14 })).toBe('normal');
  });

  it('detects attention when margin drops 15-30%', () => {
    expect(classifyProductStatus({
      marginPct: 25,
      prevMarginPct: 30, // 16.7% drop (>15%)
      daysSinceLaunch: 30,
    })).toBe('attention');
  });

  it('detects risk when margin drops >30%', () => {
    expect(classifyProductStatus({
      marginPct: 20,
      prevMarginPct: 30, // 33% drop
      daysSinceLaunch: 30,
    })).toBe('risk');
  });

  it('detects critical when margin drops >30% with high discount', () => {
    expect(classifyProductStatus({
      marginPct: 15,
      prevMarginPct: 30,
      avgDiscount: 25, // >20% discount
      daysSinceLaunch: 30,
    })).toBe('critical');
  });

  it('detects critical when margin drops >30% with no promo but >10pp drop', () => {
    expect(classifyProductStatus({
      marginPct: 15,
      prevMarginPct: 30,
      avgDiscount: 5,
      promoQty: 0, // no promo
      daysSinceLaunch: 30,
    })).toBe('critical');
  });

  it('detects attention/risk on large revenue swings', () => {
    expect(classifyProductStatus({
      marginPct: 30,
      prevMarginPct: 30,
      deltaRevenuePct: -28, // >25%
      daysSinceLaunch: 30,
    })).toBe('attention');

    expect(classifyProductStatus({
      marginPct: 30,
      prevMarginPct: 30,
      deltaRevenuePct: -35, // >30%
      daysSinceLaunch: 30,
    })).toBe('risk');
  });
});

// ─── Helpers ─────────────────────────────────────────────────

describe('round', () => {
  it('rounds to 2 decimals by default', () => {
    expect(round(25.678)).toBe(25.68);
  });

  it('rounds to 1 decimal', () => {
    expect(round(25.678, 1)).toBe(25.7);
  });

  it('handles null', () => {
    expect(round(null)).toBe(0);
  });
});

describe('previousPeriod', () => {
  it('calculates previous month correctly', () => {
    const prev = previousPeriod('2026-03-01', '2026-03-31');
    expect(prev.to).toBe('2026-02-28');
    // 31 days back from 2026-03-01
    expect(prev.from).toBe('2026-01-29');
  });

  it('calculates previous week correctly', () => {
    const prev = previousPeriod('2026-03-24', '2026-03-30');
    expect(prev.to).toBe('2026-03-23');
    expect(prev.from).toBe('2026-03-17');
  });
});

describe('STATUS_ORDER', () => {
  it('critical is highest priority (lowest number)', () => {
    expect(STATUS_ORDER.critical).toBeLessThan(STATUS_ORDER.risk);
    expect(STATUS_ORDER.risk).toBeLessThan(STATUS_ORDER.attention);
    expect(STATUS_ORDER.attention).toBeLessThan(STATUS_ORDER.normal);
    expect(STATUS_ORDER.normal).toBeLessThan(STATUS_ORDER.new);
  });
});
