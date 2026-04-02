/**
 * AI Engine — LLM tool-calling with business tools for Practik UA.
 * Each tool = parameterized SQL query = semantic layer.
 * Uses LLM Gateway for provider-agnostic routing (Claude primary, OpenAI fallback).
 */
import { chatCompletion } from './llm-gateway';
import { getDb } from './db';

// ─── Tool Result Cache (5 min TTL) ─────────────────────────
const _toolCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(key) {
  const entry = _toolCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) { _toolCache.delete(key); return undefined; }
  return entry.data;
}

function setCache(key, data) {
  _toolCache.set(key, { data, ts: Date.now() });
  // Evict old entries if cache grows too large
  if (_toolCache.size > 200) {
    const now = Date.now();
    for (const [k, v] of _toolCache) { if (now - v.ts > CACHE_TTL_MS) _toolCache.delete(k); }
  }
}

export function clearToolCache() { _toolCache.clear(); }

// ─── System Prompt ──────────────────────────────────────────
const SYSTEM_PROMPT = `Ти — AI-аналітик та бізнес-консультант компанії Practik UA (виробництво кормів для домашніх тварин).
Ти маєш доступ до бази даних продажів, товарів, клієнтів, скарг ТА маркетингових даних.
Ти також маєш глибокі знання про ринок кормів для тварин в Україні та світі.

Правила:
- Відповідай українською мовою
- Для запитань про внутрішні дані компанії — використовуй інструменти (tools)
- Для запитань про конкурентів, ринок, тренди, ціни конкурентів, маркетинг, стратегію — відповідай з загальних знань
- Можеш комбінувати: витягни дані з бази + порівняй з ринковими знаннями
- Будь конкретним: вказуй цифри, відсотки, назви товарів
- Якщо потрібні дані з кількох джерел — виклич кілька tools
- Для порівнянь — виклич tool двічі з різними параметрами
- Форматуй відповіді з markdown: таблиці, bold, списки
- Якщо дані не дають чіткої відповіді — скажи про це чесно
- Давай actionable рекомендації, не тільки факти
- Якщо питання не стосується ні компанії, ні бізнесу — все одно допоможи, ти універсальний асистент

Контекст компанії:
- Лінійки: Fresh (холістик), Simple (супер-преміум), Daily (преміум), Смаколик (ласощі), SuperFood (топери), Box (набори)
- Категорії: собаки та коти
- Канали продажів: wholesale, retail, online, marketplace
- Валюта: ₴ (гривня)

Маркетинг:
- Рекламні канали: Google ADS, Meta SHARK (один бренд/акаунт), Meta BUNTAR (інший бренд/акаунт), TikTok ADS, Viber (зупинений), Instagram (органіка з шапки профілю), Google Organic
- ROAS = Return On Ad Spend. ROAS кабінет = за даними рекламного кабінету. ROAS CRM = за реальними продажами в CRM.
- CAC = Customer Acquisition Cost = бюджет / нові клієнти
- CPL = Cost Per Lead = бюджет / к-сть замовлень
- Дані збираються щотижня, доступний історичний ряд за 9+ тижнів
- Відповідальні: Таня (Head) — CRM-дані, Таня (маркетолог) — рекламні кабінети та GA4

Конкуренти (для порівнянь):
- Royal Canin, Purina Pro Plan, Hill's, Acana, Orijen, Club 4 Paws, Optimeal, Brit, Josera, Savory
- Знання про ціни конкурентів базуються на загальних ринкових даних

- Сьогодні: ${new Date().toISOString().slice(0, 10)}`;

// ─── Tool Definitions (Semantic Layer) ──────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_sales_kpi',
      description: 'Отримати KPI продажів за період: виторг, маржа %, маржа ₴, кількість замовлень, обсяг продажів в кг. Маржа = (виторг - собівартість) / виторг × 100%.',
      parameters: {
        type: 'object',
        properties: {
          date_from: { type: 'string', description: 'Дата початку (YYYY-MM-DD)' },
          date_to: { type: 'string', description: 'Дата кінця (YYYY-MM-DD)' },
          category_id: { type: 'integer', description: 'ID категорії (опціонально)' },
        },
        required: ['date_from', 'date_to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_product_analysis',
      description: 'Деталі по конкретному товару або пошук товару по імені/SKU: виторг, маржа, к-ть, динаміка, знижки.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'integer', description: 'ID товару' },
          search: { type: 'string', description: 'Пошук по назві або SKU (часткове співпадіння)' },
          date_from: { type: 'string', description: 'Дата початку' },
          date_to: { type: 'string', description: 'Дата кінця' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_top_products',
      description: 'Топ товарів за вибраною метрикою: revenue (виторг), margin (маржа %), quantity (к-ть), orders (замовлень).',
      parameters: {
        type: 'object',
        properties: {
          metric: { type: 'string', enum: ['revenue', 'margin', 'quantity', 'orders'], description: 'Метрика для сортування' },
          limit: { type: 'integer', description: 'Кількість (за замовч. 10)' },
          date_from: { type: 'string', description: 'Дата початку' },
          date_to: { type: 'string', description: 'Дата кінця' },
          order: { type: 'string', enum: ['top', 'bottom'], description: 'Напрямок: top (найбільше) або bottom (найменше)' },
        },
        required: ['metric', 'date_from', 'date_to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_complaints_report',
      description: 'Звіт по скаргах: кількість, кластери (проблемні партії), розподіл по severity та status, топ товарів по скаргах. Проблемна партія = 3+ скарги на один продукт за 7 днів.',
      parameters: {
        type: 'object',
        properties: {
          date_from: { type: 'string', description: 'Дата початку' },
          date_to: { type: 'string', description: 'Дата кінця' },
          product_id: { type: 'integer', description: 'Фільтр по продукту (опціонально)' },
          status: { type: 'string', enum: ['new', 'investigating', 'resolved', 'dismissed'], description: 'Фільтр по статусу' },
        },
        required: ['date_from', 'date_to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_customer_stats',
      description: 'Статистика по клієнтах: топ по виторгу, розподіл по каналах (wholesale/retail/marketplace/online), регіонах. Маржа по каналах.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Кількість (за замовч. 10)' },
          date_from: { type: 'string', description: 'Дата початку' },
          date_to: { type: 'string', description: 'Дата кінця' },
          group_by: { type: 'string', enum: ['customer', 'channel', 'region'], description: 'Групування (за замовч. customer)' },
        },
        required: ['date_from', 'date_to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_alerts_summary',
      description: 'Активні алерти: товари з різким падінням маржі, аномальними знижками, підозрілими відвантаженнями.',
      parameters: {
        type: 'object',
        properties: {
          date_from: { type: 'string', description: 'Дата початку' },
          date_to: { type: 'string', description: 'Дата кінця' },
        },
        required: ['date_from', 'date_to'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_trends',
      description: 'Динаміка (тренди) метрик по днях: revenue/margin/orders/complaints. Повертає серію значень по днях.',
      parameters: {
        type: 'object',
        properties: {
          metric: { type: 'string', enum: ['revenue', 'margin', 'orders', 'complaints'], description: 'Метрика' },
          date_from: { type: 'string', description: 'Дата початку' },
          date_to: { type: 'string', description: 'Дата кінця' },
        },
        required: ['metric', 'date_from', 'date_to'],
      },
    },
  },
  // ─── Marketing Tools ────────────────────────────────────
  {
    type: 'function',
    function: {
      name: 'get_marketing_kpi',
      description: 'Маркетингові KPI: ROAS, CAC, CPL, бюджет, виручка по каналах або тотал. Дані щотижневі. Канали: google_ads, meta_shark, meta_buntar, tiktok_ads, viber, instagram_bio, google_organic.',
      parameters: {
        type: 'object',
        properties: {
          week_start: { type: 'string', description: 'Дата початку тижня (YYYY-MM-DD), опціонально. Якщо не вказано — останній тиждень.' },
          channel: { type: 'string', description: 'Ім’я каналу (опціонально). Якщо не вказано — всі канали.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_marketing_trends',
      description: 'Тренди маркетингових метрик по тижнях: roas, budget, revenue, cac, new_clients, orders. Повертає серію значень по тижнях (всі доступні). Можна фільтрувати по каналу.',
      parameters: {
        type: 'object',
        properties: {
          metric: { type: 'string', enum: ['roas', 'budget', 'revenue', 'cac', 'new_clients', 'orders'], description: 'Метрика' },
          channel: { type: 'string', description: 'Ім’я каналу (опціонально, за замовч. — тотал)' },
        },
        required: ['metric'],
      },
    },
  },
];

// ─── Page-Aware Tool Mapping ─────────────────────────────

/**
 * Мапа сторінка → priority tools.
 * Якщо сторінка не в мапі — всі tools доступні в дефолтному порядку.
 */
const PAGE_TOOL_MAP = {
  dashboard: null, // all tools in default order
  product_detail: ['get_product_analysis', 'get_sales_kpi', 'get_complaints_report', 'get_trends', 'get_top_products'],
  complaints: ['get_complaints_report', 'get_product_analysis', 'get_sales_kpi', 'get_alerts_summary'],
  marketing: ['get_marketing_kpi', 'get_marketing_trends', 'get_sales_kpi', 'get_customer_stats'],
};

function getToolsForPage(pageContext) {
  if (!pageContext?.page) return TOOLS;
  const allowedNames = PAGE_TOOL_MAP[pageContext.page];
  if (!allowedNames) return TOOLS;
  // Reorder: priority tools first, then the rest
  const priority = TOOLS.filter(t => allowedNames.includes(t.function.name));
  const rest = TOOLS.filter(t => !allowedNames.includes(t.function.name));
  return [...priority, ...rest];
}

function getPagePrompt(pageContext) {
  if (!pageContext?.page) return '';
  switch (pageContext.page) {
    case 'product_detail':
      return `\n\nКористувач зараз на сторінці конкретного товару (ID: ${pageContext.product_id}). Пріоритетно відповідай про цей товар. Якщо питання неоднозначне — використай get_product_analysis з product_id=${pageContext.product_id}.`;
    case 'complaints':
      return '\n\nКористувач на сторінці скарг. Пріоритет: аналіз скарг, кластери, проблемні партії, якість.';
    case 'marketing':
      return '\n\nКористувач на маркетинговому дашборді. Пріоритет: ROAS, CAC, CPL, ефективність каналів, тренди бюджету.';
    default:
      return '';
  }
}

// ─── Tool Implementations ──────────────────────────────────
function executeTool(name, args) {
  // Check cache first
  const cacheKey = `${name}:${JSON.stringify(args)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const result = _executeTool(name, args);
  setCache(cacheKey, result);
  return result;
}

function _executeTool(name, args) {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  switch (name) {
    case 'get_sales_kpi': {
      const { date_from, date_to, category_id } = args;
      let where = "WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'";
      const params = [date_from, date_to];
      if (category_id) { where += ' AND p.category_id = ?'; params.push(category_id); }

      const row = db.prepare(`
        SELECT 
          COUNT(DISTINCT o.id) as order_count,
          SUM(oi.final_price) as revenue,
          SUM(oi.cost_price_at_sale * oi.quantity) as cogs,
          SUM(oi.quantity) as total_qty,
          SUM(oi.quantity * p.weight_kg) as total_kg,
          AVG(oi.discount_pct) as avg_discount,
          SUM(CASE WHEN oi.is_promo = 1 THEN oi.final_price ELSE 0 END) as promo_revenue
        FROM core_sales_order_items oi
        JOIN core_sales_orders o ON oi.order_id = o.id
        JOIN core_products p ON oi.product_id = p.id
        ${where}
      `).get(...params);

      const revenue = row.revenue || 0;
      const cogs = row.cogs || 0;
      const margin_pct = revenue > 0 ? ((revenue - cogs) / revenue * 100) : 0;

      return {
        period: `${date_from} — ${date_to}`,
        revenue: Math.round(revenue),
        cogs: Math.round(cogs),
        gross_margin_pct: Math.round(margin_pct * 10) / 10,
        gross_margin_amount: Math.round(revenue - cogs),
        order_count: row.order_count,
        total_quantity: Math.round(row.total_qty || 0),
        total_weight_kg: Math.round(row.total_kg || 0),
        avg_discount_pct: Math.round((row.avg_discount || 0) * 10) / 10,
        promo_revenue: Math.round(row.promo_revenue || 0),
      };
    }

    case 'get_product_analysis': {
      const { product_id, search, date_from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10), date_to = today } = args;
      let prodWhere = '';
      const params = [date_from, date_to];

      if (product_id) { prodWhere = 'AND p.id = ?'; params.push(product_id); }
      else if (search) { prodWhere = "AND (p.name LIKE ? OR p.sku LIKE ?)"; params.push(`%${search}%`, `%${search}%`); }
      else { return { error: 'Вкажіть product_id або search' }; }

      const rows = db.prepare(`
        SELECT p.id, p.name, p.sku, p.brand, p.weight_kg, p.status,
          pc.name as category,
          SUM(oi.final_price) as revenue,
          SUM(oi.cost_price_at_sale * oi.quantity) as cogs,
          SUM(oi.quantity) as quantity,
          COUNT(DISTINCT o.id) as orders,
          AVG(oi.discount_pct) as avg_discount
        FROM core_products p
        JOIN core_product_categories pc ON p.category_id = pc.id
        LEFT JOIN core_sales_order_items oi ON oi.product_id = p.id
        LEFT JOIN core_sales_orders o ON oi.order_id = o.id 
          AND o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
        WHERE 1=1 ${prodWhere}
        GROUP BY p.id
        ORDER BY revenue DESC
        LIMIT 10
      `).all(...params);

      return {
        period: `${date_from} — ${date_to}`,
        products: rows.map(r => ({
          id: r.id, name: r.name, sku: r.sku, brand: r.brand, category: r.category,
          weight_kg: r.weight_kg, status: r.status,
          revenue: Math.round(r.revenue || 0),
          margin_pct: r.revenue > 0 ? Math.round((r.revenue - r.cogs) / r.revenue * 1000) / 10 : 0,
          quantity: Math.round(r.quantity || 0),
          orders: r.orders,
          avg_discount: Math.round((r.avg_discount || 0) * 10) / 10,
        })),
      };
    }

    case 'get_top_products': {
      const { metric, limit = 10, date_from, date_to, order = 'top' } = args;
      const orderDir = order === 'bottom' ? 'ASC' : 'DESC';
      const orderCol = { revenue: 'revenue', margin: 'margin_pct', quantity: 'quantity', orders: 'order_count' }[metric] || 'revenue';

      const rows = db.prepare(`
        SELECT p.id, p.name, p.sku, p.brand, pc.name as category,
          SUM(oi.final_price) as revenue,
          SUM(oi.cost_price_at_sale * oi.quantity) as cogs,
          SUM(oi.quantity) as quantity,
          COUNT(DISTINCT o.id) as order_count
        FROM core_sales_order_items oi
        JOIN core_sales_orders o ON oi.order_id = o.id
        JOIN core_products p ON oi.product_id = p.id
        JOIN core_product_categories pc ON p.category_id = pc.id
        WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
        GROUP BY p.id
        HAVING revenue > 0
        ORDER BY ${orderCol} ${orderDir}
        LIMIT ?
      `).all(date_from, date_to, limit);

      return {
        metric, order, period: `${date_from} — ${date_to}`,
        products: rows.map(r => ({
          name: r.name, sku: r.sku, brand: r.brand, category: r.category,
          revenue: Math.round(r.revenue),
          margin_pct: r.revenue > 0 ? Math.round((r.revenue - r.cogs) / r.revenue * 1000) / 10 : 0,
          margin_amount: Math.round((r.revenue || 0) - (r.cogs || 0)),
          quantity: Math.round(r.quantity),
          orders: r.order_count,
        })),
      };
    }

    case 'get_complaints_report': {
      const { date_from, date_to, product_id, status } = args;
      let where = 'WHERE c.complaint_date >= ? AND c.complaint_date <= ?';
      const params = [date_from, date_to];
      if (product_id) { where += ' AND c.product_id = ?'; params.push(product_id); }
      if (status) { where += ' AND c.status = ?'; params.push(status); }

      const total = db.prepare(`SELECT COUNT(*) as cnt FROM core_complaints c ${where}`).get(...params);
      const byStatus = db.prepare(`SELECT status, COUNT(*) as cnt FROM core_complaints c ${where} GROUP BY status`).all(...params);
      const bySeverity = db.prepare(`SELECT severity, COUNT(*) as cnt FROM core_complaints c ${where} GROUP BY severity`).all(...params);

      const topProds = db.prepare(`
        SELECT c.product_id, p.name, p.sku, COUNT(*) as cnt,
          SUM(CASE WHEN c.severity = 'high' THEN 1 ELSE 0 END) as high_cnt
        FROM core_complaints c JOIN core_products p ON c.product_id = p.id
        ${where} GROUP BY c.product_id ORDER BY cnt DESC LIMIT 5
      `).all(...params);

      // Cluster detection
      const allComplaints = db.prepare(`
        SELECT c.product_id, c.complaint_date, c.batch_number, p.name as product_name, p.sku
        FROM core_complaints c JOIN core_products p ON c.product_id = p.id
        ${where} ORDER BY c.product_id, c.complaint_date
      `).all(...params);

      const byProduct = {};
      for (const r of allComplaints) {
        if (!byProduct[r.product_id]) byProduct[r.product_id] = [];
        byProduct[r.product_id].push(r);
      }
      const clusters = [];
      for (const [pid, comps] of Object.entries(byProduct)) {
        if (comps.length < 3) continue;
        for (let i = 0; i < comps.length; i++) {
          const wStart = new Date(comps[i].complaint_date);
          const wEnd = new Date(wStart.getTime() + 7 * 86400000);
          const wComps = comps.filter(c => { const d = new Date(c.complaint_date); return d >= wStart && d <= wEnd; });
          if (wComps.length >= 3) {
            const existing = clusters.find(cl => cl.product_id === Number(pid) && Math.abs(new Date(cl.date_from).getTime() - wStart.getTime()) < 7 * 86400000);
            if (!existing) {
              clusters.push({
                product_id: Number(pid), product_name: comps[0].product_name, sku: comps[0].sku,
                count: wComps.length, date_from: comps[i].complaint_date,
                date_to: wComps[wComps.length - 1].complaint_date,
                batches: [...new Set(wComps.map(c => c.batch_number).filter(Boolean))],
              });
            }
            break;
          }
        }
      }

      return {
        period: `${date_from} — ${date_to}`,
        total: total.cnt,
        by_status: byStatus, by_severity: bySeverity,
        top_products: topProds.map(r => ({ name: r.name, sku: r.sku, complaints: r.cnt, high_severity: r.high_cnt })),
        problem_batches: clusters,
      };
    }

    case 'get_customer_stats': {
      const { limit = 10, date_from, date_to, group_by = 'customer' } = args;

      if (group_by === 'channel') {
        const rows = db.prepare(`
          SELECT o.channel, COUNT(DISTINCT o.id) as orders,
            SUM(oi.final_price) as revenue, SUM(oi.cost_price_at_sale * oi.quantity) as cogs,
            COUNT(DISTINCT o.customer_id) as customers
          FROM core_sales_orders o
          JOIN core_sales_order_items oi ON oi.order_id = o.id
          WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
          GROUP BY o.channel ORDER BY revenue DESC
        `).all(date_from, date_to);
        return { group_by: 'channel', period: `${date_from} — ${date_to}`, data: rows.map(r => ({
          channel: r.channel, orders: r.orders, customers: r.customers,
          revenue: Math.round(r.revenue), margin_pct: r.revenue > 0 ? Math.round((r.revenue - r.cogs) / r.revenue * 1000) / 10 : 0,
        })) };
      }

      if (group_by === 'region') {
        const rows = db.prepare(`
          SELECT c.region, COUNT(DISTINCT o.id) as orders,
            SUM(oi.final_price) as revenue, SUM(oi.cost_price_at_sale * oi.quantity) as cogs
          FROM core_sales_orders o
          JOIN core_sales_order_items oi ON oi.order_id = o.id
          JOIN core_customers c ON o.customer_id = c.id
          WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
          GROUP BY c.region ORDER BY revenue DESC
        `).all(date_from, date_to);
        return { group_by: 'region', period: `${date_from} — ${date_to}`, data: rows.map(r => ({
          region: r.region, orders: r.orders,
          revenue: Math.round(r.revenue), margin_pct: r.revenue > 0 ? Math.round((r.revenue - r.cogs) / r.revenue * 1000) / 10 : 0,
        })) };
      }

      const rows = db.prepare(`
        SELECT c.id, c.name, c.region, c.channel,
          COUNT(DISTINCT o.id) as orders, SUM(oi.final_price) as revenue,
          SUM(oi.cost_price_at_sale * oi.quantity) as cogs
        FROM core_customers c
        JOIN core_sales_orders o ON o.customer_id = c.id
        JOIN core_sales_order_items oi ON oi.order_id = o.id
        WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
        GROUP BY c.id ORDER BY revenue DESC LIMIT ?
      `).all(date_from, date_to, limit);

      return { group_by: 'customer', period: `${date_from} — ${date_to}`, data: rows.map(r => ({
        name: r.name, region: r.region, channel: r.channel, orders: r.orders,
        revenue: Math.round(r.revenue), margin_pct: r.revenue > 0 ? Math.round((r.revenue - r.cogs) / r.revenue * 1000) / 10 : 0,
      })) };
    }

    case 'get_alerts_summary': {
      const { date_from, date_to } = args;
      const daysDiff = Math.ceil((new Date(date_to) - new Date(date_from)) / 86400000) + 1;
      const prevTo = new Date(new Date(date_from) - 86400000).toISOString().slice(0, 10);
      const prevFrom = new Date(new Date(date_from) - daysDiff * 86400000).toISOString().slice(0, 10);

      const rows = db.prepare(`
        SELECT p.id, p.name, p.sku,
          SUM(oi.final_price) as revenue, SUM(oi.cost_price_at_sale * oi.quantity) as cogs,
          AVG(oi.discount_pct) as avg_discount
        FROM core_products p
        JOIN core_sales_order_items oi ON oi.product_id = p.id
        JOIN core_sales_orders o ON oi.order_id = o.id
        WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
        GROUP BY p.id
      `).all(date_from, date_to);

      const prevMap = {};
      db.prepare(`
        SELECT oi.product_id, SUM(oi.final_price) as revenue, SUM(oi.cost_price_at_sale * oi.quantity) as cogs
        FROM core_sales_order_items oi JOIN core_sales_orders o ON oi.order_id = o.id
        WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
        GROUP BY oi.product_id
      `).all(prevFrom, prevTo).forEach(r => { prevMap[r.product_id] = r; });

      const alerts = [];
      for (const r of rows) {
        const marginPct = r.revenue > 0 ? (r.revenue - r.cogs) / r.revenue * 100 : 0;
        const p = prevMap[r.id] || { revenue: 0, cogs: 0 };
        const prevMargin = p.revenue > 0 ? (p.revenue - p.cogs) / p.revenue * 100 : 0;
        const marginDrop = prevMargin > 0 ? prevMargin - marginPct : 0;
        const revDelta = p.revenue ? (r.revenue - p.revenue) / p.revenue * 100 : 0;

        if (marginDrop > 10 || Math.abs(revDelta) > 30 || (r.avg_discount || 0) > 15) {
          alerts.push({
            product: r.name, sku: r.sku,
            severity: marginDrop > 20 ? 'critical' : 'warning',
            margin_pct: Math.round(marginPct * 10) / 10,
            margin_change_pp: Math.round(-marginDrop * 10) / 10,
            revenue_change_pct: Math.round(revDelta * 10) / 10,
            avg_discount: Math.round((r.avg_discount || 0) * 10) / 10,
          });
        }
      }
      alerts.sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1));
      return { period: `${date_from} — ${date_to}`, alerts, total: alerts.length };
    }

    case 'get_trends': {
      const { metric, date_from, date_to } = args;

      if (metric === 'complaints') {
        const rows = db.prepare(`
          SELECT complaint_date as date, COUNT(*) as value
          FROM core_complaints WHERE complaint_date >= ? AND complaint_date <= ?
          GROUP BY complaint_date ORDER BY complaint_date
        `).all(date_from, date_to);
        return { metric, period: `${date_from} — ${date_to}`, series: rows };
      }

      if (metric === 'orders') {
        const rows = db.prepare(`
          SELECT order_date as date, COUNT(*) as value
          FROM core_sales_orders WHERE order_date >= ? AND order_date <= ? AND status != 'cancelled'
          GROUP BY order_date ORDER BY order_date
        `).all(date_from, date_to);
        return { metric, period: `${date_from} — ${date_to}`, series: rows };
      }

      if (metric === 'margin') {
        const rows = db.prepare(`
          SELECT o.order_date as date,
            SUM(oi.final_price) as rev, SUM(oi.cost_price_at_sale * oi.quantity) as cog
          FROM core_sales_order_items oi
          JOIN core_sales_orders o ON oi.order_id = o.id
          WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
          GROUP BY o.order_date ORDER BY o.order_date
        `).all(date_from, date_to);
        return { metric, period: `${date_from} — ${date_to}`, series: rows.map(r => ({
          date: r.date, value: r.rev > 0 ? Math.round((r.rev - r.cog) / r.rev * 1000) / 10 : 0,
        })) };
      }

      // revenue
      const rows = db.prepare(`
        SELECT o.order_date as date, SUM(oi.final_price) as value
        FROM core_sales_order_items oi
        JOIN core_sales_orders o ON oi.order_id = o.id
        WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
        GROUP BY o.order_date ORDER BY o.order_date
      `).all(date_from, date_to);
      return { metric: 'revenue', period: `${date_from} — ${date_to}`, series: rows.map(r => ({ date: r.date, value: Math.round(r.value) })) };
    }


    case 'get_marketing_kpi': {
      const { week_start, channel } = args;
      let weekFilter = week_start;
      if (!weekFilter) {
        const latest = db.prepare('SELECT week_start FROM marketing_weekly_data ORDER BY week_start DESC LIMIT 1').get();
        weekFilter = latest?.week_start;
      }
      if (!weekFilter) return { error: 'Немає маркетингових даних' };

      if (channel) {
        const ch = db.prepare('SELECT id, display_name FROM marketing_channels WHERE name = ?').get(channel);
        if (!ch) return { error: `Канал ${channel} не знайдено` };

        const data = db.prepare('SELECT * FROM marketing_weekly_data WHERE week_start = ? AND channel_id = ?').get(weekFilter, ch.id);
        if (!data) return { channel: ch.display_name, week: weekFilter, message: 'Немає даних за цей тиждень' };

        return {
          channel: ch.display_name,
          week: weekFilter,
          ad_spend: data.ad_spend,
          ad_conversions_value: data.ad_conversions_value,
          crm_revenue: data.crm_revenue,
          crm_orders: data.crm_orders,
          crm_new_clients: data.crm_new_clients,
          traffic: data.traffic,
          roas_ad: data.ad_spend > 0 ? Math.round(data.ad_conversions_value / data.ad_spend * 100) / 100 : 0,
          roas_crm: data.ad_spend > 0 ? Math.round(data.crm_revenue / data.ad_spend * 100) / 100 : 0,
        };
      }

      // Total across all channels
      const totals = db.prepare(`
        SELECT SUM(ad_spend) as spend, SUM(ad_conversions_value) as ad_value,
          SUM(crm_revenue) as crm_rev, SUM(crm_orders) as orders, SUM(crm_new_clients) as new_clients,
          SUM(traffic) as traffic
        FROM marketing_weekly_data WHERE week_start = ?
      `).get(weekFilter);

      const sales = db.prepare('SELECT * FROM marketing_sales_data WHERE week_start = ?').get(weekFilter);

      const spend = totals?.spend || 0;
      const revenue = sales?.shipped_orders_sum || 0;

      // Per-channel breakdown
      const perChannel = db.prepare(`
        SELECT mc.display_name, mwd.ad_spend, mwd.crm_revenue, mwd.crm_orders, mwd.crm_new_clients, mwd.traffic
        FROM marketing_weekly_data mwd
        JOIN marketing_channels mc ON mc.id = mwd.channel_id
        WHERE mwd.week_start = ?
        ORDER BY mc.sort_order
      `).all(weekFilter);

      return {
        week: weekFilter,
        total: {
          budget: Math.round(spend),
          revenue: Math.round(revenue),
          roas: spend > 0 ? Math.round(revenue / spend * 100) / 100 : 0,
          cac: (sales?.new_clients || 0) > 0 ? Math.round(spend / sales.new_clients) : 0,
          cpl: (totals?.orders || 0) > 0 ? Math.round(spend / totals.orders) : 0,
          new_clients: sales?.new_clients || 0,
          shipped_orders: sales?.shipped_orders || 0,
          avg_check: sales?.avg_check || 0,
          ship_conversion: sales?.ship_conversion_rate || 0,
        },
        channels: perChannel.map(c => ({
          channel: c.display_name,
          spend: c.ad_spend,
          crm_revenue: c.crm_revenue,
          roas_crm: c.ad_spend > 0 ? Math.round(c.crm_revenue / c.ad_spend * 100) / 100 : null,
          orders: c.crm_orders,
          new_clients: c.crm_new_clients,
          traffic: c.traffic,
        })),
      };
    }

    case 'get_marketing_trends': {
      const { metric, channel } = args;

      const allWeeks = db.prepare('SELECT DISTINCT week_start FROM marketing_weekly_data ORDER BY week_start').all();

      const series = allWeeks.map(w => {
        const week = w.week_start;
        let value = 0;

        if (channel) {
          const ch = db.prepare('SELECT id FROM marketing_channels WHERE name = ?').get(channel);
          if (!ch) return { week, value: null };
          const data = db.prepare('SELECT * FROM marketing_weekly_data WHERE week_start = ? AND channel_id = ?').get(week, ch.id);
          if (!data) return { week, value: null };

          switch (metric) {
            case 'roas': value = data.ad_spend > 0 ? Math.round(data.crm_revenue / data.ad_spend * 100) / 100 : 0; break;
            case 'budget': value = data.ad_spend; break;
            case 'revenue': value = data.crm_revenue; break;
            case 'new_clients': value = data.crm_new_clients; break;
            case 'orders': value = data.crm_orders; break;
            case 'cac': value = data.crm_new_clients > 0 ? Math.round(data.ad_spend / data.crm_new_clients) : 0; break;
          }
        } else {
          const totals = db.prepare('SELECT SUM(ad_spend) as spend, SUM(crm_revenue) as rev, SUM(crm_orders) as ord, SUM(crm_new_clients) as nc FROM marketing_weekly_data WHERE week_start = ?').get(week);
          const sales = db.prepare('SELECT * FROM marketing_sales_data WHERE week_start = ?').get(week);

          const spend = totals?.spend || 0;
          const revenue = sales?.shipped_orders_sum || 0;

          switch (metric) {
            case 'roas': value = spend > 0 ? Math.round(revenue / spend * 100) / 100 : 0; break;
            case 'budget': value = Math.round(spend); break;
            case 'revenue': value = Math.round(revenue); break;
            case 'new_clients': value = sales?.new_clients || 0; break;
            case 'orders': value = sales?.shipped_orders || 0; break;
            case 'cac': value = (sales?.new_clients || 0) > 0 ? Math.round(spend / sales.new_clients) : 0; break;
          }
        }

        return { week, value };
      });

      return { metric, channel: channel || 'total', series };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── Chat with Tool Calling ─────────────────────────────────
export async function chat(messages, conversationId, userId, pageContext) {
  const db = getDb();
  
  const contextualPrompt = SYSTEM_PROMPT + getPagePrompt(pageContext);
  const contextualTools = getToolsForPage(pageContext);

  const openaiMessages = [
    { role: 'system', content: contextualPrompt },
    ...messages.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.tool_calls ? { tool_calls: JSON.parse(m.tool_calls) } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
    })),
  ];

  let gatewayResult = await chatCompletion({
    messages: openaiMessages,
    tools: contextualTools,
    temperature: 0.3,
    max_tokens: 4000,
  });

  let assistantMessage = gatewayResult.message;
  let totalEstimatedCost = gatewayResult.estimatedCost || 0;
  const allToolLogs = [];

  // Tool calling loop (max 5 iterations)
  let iterations = 0;
  while (assistantMessage.tool_calls && iterations < 5) {
    iterations++;

    // Save assistant message with tool calls
    openaiMessages.push(assistantMessage);

    // Execute each tool call
    for (const toolCall of assistantMessage.tool_calls) {
      const fnName = toolCall.function.name;
      const fnArgs = JSON.parse(toolCall.function.arguments);

      const start = Date.now();
      const result = executeTool(fnName, fnArgs);
      const latency = Date.now() - start;

      allToolLogs.push({
        tool_name: fnName,
        input: fnArgs,
        output: result,
        latency_ms: latency,
      });

      openaiMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }

    // Get next response
    gatewayResult = await chatCompletion({
      messages: openaiMessages,
      tools: contextualTools,
      temperature: 0.3,
      max_tokens: 4000,
    });

    assistantMessage = gatewayResult.message;
    totalEstimatedCost += gatewayResult.estimatedCost || 0;
  }

  // Save to DB (observability)
  if (conversationId) {
    const aiMsg = db.prepare(
      'INSERT INTO ai_messages (conversation_id, role, content, tool_calls) VALUES (?, ?, ?, ?)'
    ).run(conversationId, 'assistant', assistantMessage.content,
      assistantMessage.tool_calls ? JSON.stringify(assistantMessage.tool_calls) : null);

    for (const log of allToolLogs) {
      db.prepare(
        'INSERT INTO ai_tool_logs (message_id, conversation_id, tool_name, input_json, output_json, latency_ms) VALUES (?,?,?,?,?,?)'
      ).run(aiMsg.lastInsertRowid, conversationId, log.tool_name,
        JSON.stringify(log.input), JSON.stringify(log.output), log.latency_ms);
    }

    db.prepare('UPDATE ai_conversations SET updated_at = datetime(?) WHERE id = ?')
      .run(new Date().toISOString(), conversationId);
  }

  return {
    content: assistantMessage.content,
    tool_calls_count: allToolLogs.length,
    tools_used: allToolLogs.map(l => l.tool_name),
    usage: gatewayResult.usage,
    provider: gatewayResult.provider,
    model: gatewayResult.model,
    estimatedCost: totalEstimatedCost,
  };
}

// ─── Streaming Chat ─────────────────────────────────────────
export async function chatStream(messages, conversationId, userId, pageContext) {
  const db = getDb();

  const contextualPrompt = SYSTEM_PROMPT + getPagePrompt(pageContext);
  const contextualTools = getToolsForPage(pageContext);

  const openaiMessages = [
    { role: 'system', content: contextualPrompt },
    ...messages,
  ];

  let gatewayResult = await chatCompletion({
    messages: openaiMessages,
    tools: contextualTools,
    temperature: 0.3,
    max_tokens: 4000,
  });

  let assistantMessage = gatewayResult.message;
  const allToolLogs = [];

  // Tool calling loop
  let iterations = 0;
  while (assistantMessage.tool_calls && iterations < 5) {
    iterations++;
    openaiMessages.push(assistantMessage);

    for (const toolCall of assistantMessage.tool_calls) {
      const fnName = toolCall.function.name;
      const fnArgs = JSON.parse(toolCall.function.arguments);
      const start = Date.now();
      const result = executeTool(fnName, fnArgs);
      const latency = Date.now() - start;

      allToolLogs.push({ tool_name: fnName, input: fnArgs, output: result, latency_ms: latency });
      openaiMessages.push({ role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify(result) });
    }

    gatewayResult = await chatCompletion({
      messages: openaiMessages,
      tools: contextualTools,
      temperature: 0.3,
      max_tokens: 4000,
    });
    assistantMessage = gatewayResult.message;
  }

  // Now stream the final response
  // We already have the final content from non-streamed call, but for true streaming
  // we re-send without tools so it streams the final answer
  if (!assistantMessage.tool_calls) {
    // Save to DB
    if (conversationId) {
      db.prepare('INSERT INTO ai_messages (conversation_id, role, content) VALUES (?, ?, ?)')
        .run(conversationId, 'assistant', assistantMessage.content);
      for (const log of allToolLogs) {
        db.prepare('INSERT INTO ai_tool_logs (conversation_id, tool_name, input_json, output_json, latency_ms) VALUES (?,?,?,?,?)')
          .run(conversationId, log.tool_name, JSON.stringify(log.input), JSON.stringify(log.output), log.latency_ms);
      }
      db.prepare('UPDATE ai_conversations SET updated_at = datetime(?) WHERE id = ?')
        .run(new Date().toISOString(), conversationId);
    }
  }

  return {
    content: assistantMessage.content,
    tools_used: allToolLogs.map(l => l.tool_name),
  };
}
