/**
 * Metrics Dictionary — єдиний calculation engine для Practik Dashboard.
 * 
 * ВСІ формули метрик визначені тут. Дашборди, API routes та AI tools
 * МУСЯТЬ використовувати ці функції замість inline-обчислень.
 * 
 * Версіонування: якщо формула змінюється — додай v2 і deprecation notice.
 */

// ─── Core Financial Metrics ────────────────────────────────────

/**
 * Валова маржа (%) = (виторг - собівартість) / виторг × 100
 * Показує скільки % від виторгу залишається після вирахування прямих витрат.
 */
export function grossMarginPct(revenue, cogs) {
  if (!revenue || revenue === 0) return 0;
  return (revenue - cogs) / revenue * 100;
}

/**
 * Валова маржа (₴) = виторг - собівартість
 */
export function grossMarginAmount(revenue, cogs) {
  return (revenue || 0) - (cogs || 0);
}

/**
 * Середня ціна за одиницю = виторг / кількість
 */
export function avgPrice(revenue, quantity) {
  if (!quantity || quantity === 0) return 0;
  return revenue / quantity;
}

/**
 * % повернень = повернуті одиниці / продані одиниці × 100
 */
export function returnsPct(returnedQty, soldQty) {
  if (!soldQty || soldQty === 0) return 0;
  return returnedQty / soldQty * 100;
}

// ─── Marketing Metrics ─────────────────────────────────────────

/**
 * ROAS = Return On Ad Spend = виручка / витрати на рекламу
 * ROAS > 1 означає прибуткову рекламу.
 * ROAS кабінет — за даними рекл. кабінету; ROAS CRM — за реальними продажами.
 */
export function roas(revenue, adSpend) {
  if (!adSpend || adSpend === 0) return 0;
  return revenue / adSpend;
}

/**
 * CAC = Customer Acquisition Cost = бюджет / нові клієнти
 * Вартість залучення одного нового клієнта.
 */
export function cac(adSpend, newCustomers) {
  if (!newCustomers || newCustomers === 0) return 0;
  return adSpend / newCustomers;
}

/**
 * CPL = Cost Per Lead = бюджет / к-сть замовлень
 * Вартість одного замовлення (ліда) з реклами.
 */
export function cpl(adSpend, orders) {
  if (!orders || orders === 0) return 0;
  return adSpend / orders;
}

/**
 * AOV = Average Order Value = виторг / к-сть замовлень
 */
export function aov(revenue, orders) {
  if (!orders || orders === 0) return 0;
  return revenue / orders;
}

/**
 * Conversion Rate (%) = конверсії / всього відвідувачів × 100
 */
export function conversionRate(conversions, visitors) {
  if (!visitors || visitors === 0) return 0;
  return conversions / visitors * 100;
}

// ─── Comparison & Deltas ────────────────────────────────────────

/**
 * Delta % = (поточне - попереднє) / попереднє × 100
 * Показує зміну у %. Якщо попередній = 0, повертає 0.
 */
export function deltaPct(current, previous) {
  if (!previous || previous === 0) return 0;
  return (current - previous) / previous * 100;
}

/**
 * Delta в процентних пунктах (для метрик які вже в %).
 * Наприклад: маржа була 30% стала 25% → delta = -5 п.п.
 */
export function deltaPP(currentPct, previousPct) {
  return (currentPct || 0) - (previousPct || 0);
}

// ─── Product Status Classification ──────────────────────────────

/**
 * Визначає статус ризику товару на основі змін маржі та виторгу.
 * 
 * Статуси:
 * - 'new'       — товар запущений менше 14 днів тому
 * - 'normal'    — все в нормі
 * - 'attention' — потребує уваги (маржа впала 15-30% або виторг ±25%)
 * - 'risk'      — ризик (маржа впала >30% або виторг ±30%)
 * - 'critical'  — критично (маржа впала >30% + аномальні знижки або маржа drop >10 п.п. без промо)
 * 
 * @param {Object} params
 * @param {number} params.marginPct - Поточна маржа %
 * @param {number} params.prevMarginPct - Маржа % попереднього періоду
 * @param {number} params.deltaRevenuePct - Зміна виторгу %
 * @param {number} params.avgDiscount - Середня знижка %
 * @param {number} params.promoQty - К-сть промо-одиниць
 * @param {number} params.daysSinceLaunch - Днів з моменту запуску
 */
export function classifyProductStatus({
  marginPct = 0,
  prevMarginPct = 0,
  deltaRevenuePct = 0,
  avgDiscount = 0,
  promoQty = 0,
  daysSinceLaunch = 999,
} = {}) {
  // New products get special treatment
  if (daysSinceLaunch < 14) return 'new';

  const marginDrop = prevMarginPct > 0
    ? (prevMarginPct - marginPct) / prevMarginPct * 100
    : 0;
  const marginDropPP = prevMarginPct - marginPct;

  // Critical: margin dropped >30% AND (high discount without promo OR margin drop >10 p.p.)
  if (marginDrop > 30 && (avgDiscount > 20 || (promoQty === 0 && marginDropPP > 10))) {
    return 'critical';
  }

  // Risk: margin dropped >30% OR revenue changed >30%
  if (marginDrop > 30 || Math.abs(deltaRevenuePct) > 30) {
    return 'risk';
  }

  // Attention: margin dropped 15-30% OR revenue changed 25-30%
  if (marginDrop > 15 || Math.abs(deltaRevenuePct) > 25) {
    return 'attention';
  }

  return 'normal';
}

/**
 * Порядок severity для сортування (менше = важливіше)
 */
export const STATUS_ORDER = {
  critical: 0,
  risk: 1,
  attention: 2,
  normal: 3,
  new: 4,
};

// ─── Formatting Helpers ─────────────────────────────────────────

/**
 * Округлення до N знаків після коми
 */
export function round(value, decimals = 2) {
  const factor = Math.pow(10, decimals);
  return Math.round((value || 0) * factor) / factor;
}

/**
 * Форматувати як валюту: 1234.5 → '1 234.50 ₴'
 */
export function formatCurrency(value) {
  return new Intl.NumberFormat('uk-UA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value || 0) + ' ₴';
}

/**
 * Форматувати як відсоток: 25.678 → '25.7%'
 */
export function formatPct(value) {
  return round(value, 1) + '%';
}

// ─── Period Helpers ─────────────────────────────────────────────

/**
 * Обчислити попередній період такої ж тривалості.
 * Наприклад: 2026-03-01..2026-03-31 → попередній: 2026-01-29..2026-02-28.
 */
export function previousPeriod(dateFrom, dateTo) {
  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  const daysDiff = Math.ceil((to - from) / 86400000) + 1;
  const prevTo = new Date(from.getTime() - 86400000);
  const prevFrom = new Date(from.getTime() - daysDiff * 86400000);
  return {
    from: prevFrom.toISOString().slice(0, 10),
    to: prevTo.toISOString().slice(0, 10),
  };
}

/**
 * Сьогоднішня дата як YYYY-MM-DD
 */
export function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Перший день поточного місяця
 */
export function monthStart() {
  return today().slice(0, 8) + '01';
}
