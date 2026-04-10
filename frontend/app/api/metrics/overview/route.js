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

  // Average check — use marketing data for realistic avg_check
  const mktAvgCheck = db.prepare(`
    SELECT AVG(avg_check) as ac FROM marketing_sales_data
    WHERE week_start >= ? AND week_start <= ?
  `).get(dateFrom, dateTo);
  const avgCheck = mktAvgCheck?.ac || (orderCount > 0 ? revenue / orderCount : 0);

  // Customers — pull from marketing_sales_data for realistic numbers
  const mktCust = db.prepare(`
    SELECT 
      MAX(total_clients) as total_clients,
      SUM(new_clients) as new_clients,
      SUM(returning_clients) as returning_clients
    FROM marketing_sales_data
    WHERE week_start >= ? AND week_start <= ?
  `).get(dateFrom, dateTo);

  // Fallback to core DB if no marketing data
  let totalCust, newCustomers, returningCustomers;
  if (mktCust && mktCust.total_clients) {
    totalCust = mktCust.total_clients;
    newCustomers = mktCust.new_clients || 0;
    returningCustomers = mktCust.returning_clients || 0;
  } else {
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
    totalCust = custStats.total_customers || 0;
    newCustomers = newCust.cnt || 0;
    returningCustomers = totalCust - newCustomers;
  }

  // Complaints count
  const complaintRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM core_complaints
    WHERE complaint_date >= ? AND complaint_date <= ?
  `).get(dateFrom, dateTo);
  const complaintsCount = complaintRow?.cnt || 0;

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

  // Plan/Fact — monthly targets based on marketing data
  // Real scale: ~5.5M/week revenue → ~24M/month, ~4000 orders/week → ~16000/month
  const mktPlanData = db.prepare(`
    SELECT 
      AVG(incoming_orders_sum) as avg_weekly_rev,
      AVG(incoming_orders) as avg_weekly_orders
    FROM marketing_sales_data
  `).get();

  const plan = {
    revenue: round((mktPlanData?.avg_weekly_rev || 5500000) * 4.33),  // weekly avg * 4.33 weeks
    margin_pct: 35.0,
    orders: round((mktPlanData?.avg_weekly_orders || 4000) * 4.33),
  };

  // Scale plan proportionally if period != full month
  const daysInMonth = new Date(new Date(dateTo).getFullYear(), new Date(dateTo).getMonth() + 1, 0).getDate();
  const periodDays = daysDiff;
  const planScale = Math.min(periodDays / daysInMonth, 1);

  // Use marketing revenue for plan/fact when available
  const mktRevForPeriod = db.prepare(`
    SELECT COALESCE(SUM(incoming_orders_sum), 0) as rev,
           COALESCE(SUM(incoming_orders), 0) as orders
    FROM marketing_sales_data
    WHERE week_start >= ? AND week_start <= ?
  `).get(dateFrom, dateTo);
  const factRevenue = mktRevForPeriod?.rev > 0 ? mktRevForPeriod.rev : revenue;
  const factOrders = mktRevForPeriod?.orders > 0 ? mktRevForPeriod.orders : orderCount;

  const planFact = {
    revenue: { plan: round(plan.revenue * planScale), fact: round(factRevenue), pct: plan.revenue * planScale > 0 ? round(factRevenue / (plan.revenue * planScale) * 100, 1) : 0 },
    margin_pct: { plan: plan.margin_pct, fact: round(marginPct, 1), pct: plan.margin_pct > 0 ? round(marginPct / plan.margin_pct * 100, 1) : 0 },
    orders: { plan: round(plan.orders * planScale), fact: factOrders, pct: plan.orders * planScale > 0 ? round(factOrders / (plan.orders * planScale) * 100, 1) : 0 },
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
        returning_pct: (newCustomers + returningCustomers) > 0 ? round(returningCustomers / (newCustomers + returningCustomers) * 100, 1) : 0,
      },
      complaints: {
        value: complaintsCount, format: 'number', unit: 'шт',
      },
    },
    plan_fact: planFact,
    last_updated: today,
    freshness_status: 'fresh',
  });
}
