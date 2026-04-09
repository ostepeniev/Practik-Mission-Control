import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';
import {
  grossMarginPct, grossMarginAmount, returnsPct as calcReturnsPct,
  deltaPct, deltaPP, round,
} from '@/lib/metrics';

export async function GET(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';
  const dateFrom = searchParams.get('date_from') || monthStart;
  const dateTo = searchParams.get('date_to') || today;
  const categoryId = searchParams.get('category_id');
  const productId = searchParams.get('product_id');

  const db = getDb();

  // Build dynamic WHERE
  let where = `o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'`;
  let params = [dateFrom, dateTo];

  if (categoryId) { where += ` AND p.category_id = ?`; params.push(categoryId); }
  if (productId) { where += ` AND oi.product_id = ?`; params.push(productId); }

  const joinProduct = categoryId ? 'JOIN core_products p ON oi.product_id = p.id' : '';

  const row = db.prepare(`
    SELECT 
      COALESCE(SUM(oi.final_price), 0) as revenue,
      COALESCE(SUM(oi.cost_price_at_sale * oi.quantity), 0) as cogs,
      COALESCE(SUM(oi.quantity), 0) as volume,
      COUNT(DISTINCT oi.order_id) as order_count
    FROM core_sales_order_items oi
    JOIN core_sales_orders o ON oi.order_id = o.id
    ${joinProduct}
    WHERE ${where}
  `).get(...params);

  const revenue = row.revenue;
  const cogs = row.cogs;
  const volume = row.volume;
  const orderCount = row.order_count;
  const marginPct = grossMarginPct(revenue, cogs);
  const marginAmt = grossMarginAmount(revenue, cogs);

  // Returns
  const retRow = db.prepare(`
    SELECT COALESCE(SUM(r.quantity), 0) as returned
    FROM core_returns r
    JOIN core_sales_order_items oi ON r.order_item_id = oi.id
    JOIN core_sales_orders o ON oi.order_id = o.id
    WHERE o.order_date >= ? AND o.order_date <= ?
  `).get(dateFrom, dateTo);
  const retPct = calcReturnsPct(retRow.returned, volume);

  // Average check
  const avgCheck = orderCount > 0 ? revenue / orderCount : 0;

  // New vs returning customers
  const custStats = db.prepare(`
    SELECT COUNT(DISTINCT o.customer_id) as total_customers
    FROM core_sales_orders o
    WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
  `).get(dateFrom, dateTo);

  const newCust = db.prepare(`
    SELECT COUNT(DISTINCT o.customer_id) as cnt
    FROM core_sales_orders o
    WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
      AND o.customer_id NOT IN (
        SELECT DISTINCT customer_id FROM core_sales_orders
        WHERE order_date < ? AND status != 'cancelled'
      )
  `).get(dateFrom, dateTo, dateFrom);

  const totalCust = custStats.total_customers || 0;
  const newCustomers = newCust.cnt || 0;
  const returningCustomers = totalCust - newCustomers;

  // Previous period
  const daysDiff = Math.ceil((new Date(dateTo) - new Date(dateFrom)) / 86400000) + 1;
  const prevTo = new Date(new Date(dateFrom) - 86400000).toISOString().slice(0, 10);
  const prevFrom = new Date(new Date(dateFrom) - daysDiff * 86400000).toISOString().slice(0, 10);

  let prevWhere = `o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'`;
  let prevParams = [prevFrom, prevTo];
  if (categoryId) { prevWhere += ` AND p.category_id = ?`; prevParams.push(categoryId); }
  if (productId) { prevWhere += ` AND oi.product_id = ?`; prevParams.push(productId); }

  const prev = db.prepare(`
    SELECT 
      COALESCE(SUM(oi.final_price), 0) as revenue,
      COALESCE(SUM(oi.cost_price_at_sale * oi.quantity), 0) as cogs,
      COALESCE(SUM(oi.quantity), 0) as volume,
      COUNT(DISTINCT oi.order_id) as order_count
    FROM core_sales_order_items oi
    JOIN core_sales_orders o ON oi.order_id = o.id
    ${joinProduct}
    WHERE ${prevWhere}
  `).get(...prevParams);

  const prevRevenue = prev.revenue;
  const prevMargin = grossMarginPct(prevRevenue, prev.cogs);
  const prevMarginAmt = grossMarginAmount(prevRevenue, prev.cogs);
  const prevAvgCheck = prev.order_count > 0 ? prevRevenue / prev.order_count : 0;

  // Plan/Fact — monthly targets (realistic for a pet food company)
  const plan = {
    revenue: 3200000,
    margin_pct: 35.0,
    orders: 350,
    new_customers: 5,
  };

  // Scale plan proportionally if period != full month
  const daysInMonth = new Date(new Date(dateTo).getFullYear(), new Date(dateTo).getMonth() + 1, 0).getDate();
  const periodDays = daysDiff;
  const planScale = Math.min(periodDays / daysInMonth, 1);

  const planFact = {
    revenue: { plan: round(plan.revenue * planScale), fact: round(revenue), pct: plan.revenue * planScale > 0 ? round(revenue / (plan.revenue * planScale) * 100, 1) : 0 },
    margin_pct: { plan: plan.margin_pct, fact: round(marginPct, 1), pct: plan.margin_pct > 0 ? round(marginPct / plan.margin_pct * 100, 1) : 0 },
    orders: { plan: round(plan.orders * planScale), fact: orderCount, pct: plan.orders * planScale > 0 ? round(orderCount / (plan.orders * planScale) * 100, 1) : 0 },
  };

  return NextResponse.json({
    period: { from: dateFrom, to: dateTo },
    metrics: {
      revenue_mtd: {
        value: round(revenue), delta_pct: round(deltaPct(revenue, prevRevenue), 1),
        prev_value: round(prevRevenue), format: 'currency', unit: '₴',
      },
      gross_margin_pct: {
        value: round(marginPct, 1), delta_pct: round(deltaPP(marginPct, prevMargin), 1),
        prev_value: round(prevMargin, 1), format: 'percent', unit: '%',
      },
      gross_margin_amount: {
        value: round(marginAmt), delta_pct: round(deltaPct(marginAmt, prevMarginAmt), 1),
        prev_value: round(prevMarginAmt), format: 'currency', unit: '₴',
      },
      sales_volume: {
        value: round(volume, 1), delta_pct: round(deltaPct(volume, prev.volume), 1),
        prev_value: round(prev.volume, 1), format: 'number', unit: 'кг',
      },
      order_count: {
        value: orderCount, delta_pct: round(deltaPct(orderCount, prev.order_count), 1),
        prev_value: prev.order_count, format: 'number', unit: 'шт',
      },
      returns_pct: {
        value: round(retPct), delta_pct: 0, prev_value: 0,
        format: 'percent', unit: '%', inverse: true,
      },
      avg_check: {
        value: round(avgCheck), delta_pct: round(deltaPct(avgCheck, prevAvgCheck), 1),
        prev_value: round(prevAvgCheck), format: 'currency', unit: '₴',
      },
      customers: {
        total: totalCust, new: newCustomers, returning: returningCustomers,
        returning_pct: totalCust > 0 ? round(returningCustomers / totalCust * 100, 1) : 0,
      },
    },
    plan_fact: planFact,
    last_updated: today,
    freshness_status: 'fresh',
  });
}
