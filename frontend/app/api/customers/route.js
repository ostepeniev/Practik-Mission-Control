import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { round } from '@/lib/metrics';

export async function GET(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';
  const dateFrom = searchParams.get('date_from') || monthStart;
  const dateTo = searchParams.get('date_to') || today;
  const channel = searchParams.get('channel');

  const db = getDb();

  let channelWhere = '';
  const baseParams = [dateFrom, dateTo];
  if (channel) { channelWhere = ' AND o.channel = ?'; baseParams.push(channel); }

  // ─── KPIs ──────────────────────────────────────────
  const totalCustomers = db.prepare(`
    SELECT COUNT(DISTINCT o.customer_id) as cnt
    FROM core_sales_orders o
    WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'${channelWhere}
  `).get(...baseParams).cnt;

  // New customers (first order in this period)
  const newParams = [...baseParams];
  if (channel) newParams.push(channel);
  const newCustomers = db.prepare(`
    SELECT COUNT(DISTINCT o.customer_id) as cnt
    FROM core_sales_orders o
    WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'${channelWhere}
      AND o.customer_id NOT IN (
        SELECT DISTINCT customer_id FROM core_sales_orders
        WHERE order_date < ? AND status != 'cancelled'
      )
  `).get(...[...baseParams, dateFrom]).cnt;

  const returningCustomers = totalCustomers - newCustomers;
  const returningPct = totalCustomers > 0 ? round(returningCustomers / totalCustomers * 100, 1) : 0;

  // Average check
  const checkRow = db.prepare(`
    SELECT AVG(o.total_amount) as avg_check, SUM(o.total_amount) as total_revenue,
      COUNT(*) as total_orders
    FROM core_sales_orders o
    WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'${channelWhere}
  `).get(...baseParams);
  const avgCheck = round(checkRow.avg_check || 0);

  // LTV — average revenue per customer (lifetime)
  const ltvRow = db.prepare(`
    SELECT AVG(customer_total) as avg_ltv FROM (
      SELECT o.customer_id, SUM(o.total_amount) as customer_total
      FROM core_sales_orders o
      WHERE o.status != 'cancelled'
      GROUP BY o.customer_id
    )
  `).get();
  const avgLtv = round(ltvRow.avg_ltv || 0);

  // Retention: customers who ordered both in prev period AND current period
  const daysDiff = Math.ceil((new Date(dateTo) - new Date(dateFrom)) / 86400000) + 1;
  const prevTo = new Date(new Date(dateFrom) - 86400000).toISOString().slice(0, 10);
  const prevFrom = new Date(new Date(dateFrom) - daysDiff * 86400000).toISOString().slice(0, 10);

  const prevCustomerCount = db.prepare(`
    SELECT COUNT(DISTINCT customer_id) as cnt FROM core_sales_orders
    WHERE order_date >= ? AND order_date <= ? AND status != 'cancelled'
  `).get(prevFrom, prevTo).cnt;

  const retainedCount = db.prepare(`
    SELECT COUNT(DISTINCT o1.customer_id) as cnt
    FROM core_sales_orders o1
    WHERE o1.order_date >= ? AND o1.order_date <= ? AND o1.status != 'cancelled'
      AND o1.customer_id IN (
        SELECT DISTINCT customer_id FROM core_sales_orders
        WHERE order_date >= ? AND order_date <= ? AND status != 'cancelled'
      )
  `).get(dateFrom, dateTo, prevFrom, prevTo).cnt;

  const retentionRate = prevCustomerCount > 0 ? round(retainedCount / prevCustomerCount * 100, 1) : 0;

  // Churn: customers in prev period who did NOT order in current
  const churnCount = prevCustomerCount - retainedCount;
  const churnRate = prevCustomerCount > 0 ? round(churnCount / prevCustomerCount * 100, 1) : 0;

  // Average interval between orders (days)
  const intervalRow = db.prepare(`
    SELECT AVG(interval_days) as avg_interval FROM (
      SELECT customer_id,
        julianday(MAX(order_date)) - julianday(MIN(order_date)) as span,
        COUNT(*) as cnt,
        CASE WHEN COUNT(*) > 1
          THEN (julianday(MAX(order_date)) - julianday(MIN(order_date))) / (COUNT(*) - 1)
          ELSE NULL END as interval_days
      FROM core_sales_orders
      WHERE status != 'cancelled'
      GROUP BY customer_id
      HAVING COUNT(*) > 1
    )
  `).get();
  const avgInterval = round(intervalRow.avg_interval || 0, 1);

  // Average orders per customer
  const ordersPerCust = totalCustomers > 0 ? round((checkRow.total_orders || 0) / totalCustomers, 1) : 0;

  // ─── Weekly new vs returning ───────────────────────
  const weeklyData = [];
  for (let w = 12; w >= 0; w--) {
    const wStart = new Date(new Date(dateTo) - w * 7 * 86400000);
    const wEnd = new Date(wStart.getTime() + 6 * 86400000);
    const ws = wStart.toISOString().slice(0, 10);
    const we = wEnd.toISOString().slice(0, 10);

    const wTotal = db.prepare(`
      SELECT COUNT(DISTINCT customer_id) as cnt FROM core_sales_orders
      WHERE order_date >= ? AND order_date <= ? AND status != 'cancelled'
    `).get(ws, we).cnt;

    const wNew = db.prepare(`
      SELECT COUNT(DISTINCT customer_id) as cnt FROM core_sales_orders
      WHERE order_date >= ? AND order_date <= ? AND status != 'cancelled'
        AND customer_id NOT IN (
          SELECT DISTINCT customer_id FROM core_sales_orders WHERE order_date < ? AND status != 'cancelled'
        )
    `).get(ws, we, ws).cnt;

    weeklyData.push({ week: ws, total: wTotal, new: wNew, returning: wTotal - wNew });
  }

  // ─── Channel distribution ─────────────────────────
  const channelDist = db.prepare(`
    SELECT o.channel, COUNT(DISTINCT o.customer_id) as customers,
      SUM(o.total_amount) as revenue, COUNT(*) as orders
    FROM core_sales_orders o
    WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
    GROUP BY o.channel ORDER BY revenue DESC
  `).all(dateFrom, dateTo);

  const channelLabels = { wholesale: 'Оптові', retail: 'Роздріб', online: 'Онлайн', marketplace: 'Маркетплейси' };

  // ─── Top Customers Table ──────────────────────────
  const topCustomers = db.prepare(`
    SELECT c.id, c.name, c.region, c.channel, c.customer_type,
      COUNT(DISTINCT o.id) as orders,
      SUM(o.total_amount) as revenue,
      MAX(o.order_date) as last_order,
      MIN(o.order_date) as first_order
    FROM core_customers c
    JOIN core_sales_orders o ON o.customer_id = c.id
    WHERE o.status != 'cancelled'
    GROUP BY c.id
    ORDER BY revenue DESC
    LIMIT 20
  `).all().map(c => {
    const avgCk = c.orders > 0 ? round(c.revenue / c.orders) : 0;
    return {
      id: c.id, name: c.name, region: c.region,
      channel: channelLabels[c.channel] || c.channel,
      orders: c.orders, revenue: round(c.revenue),
      avg_check: avgCk, ltv: round(c.revenue),
      last_order: c.last_order, first_order: c.first_order,
    };
  });

  return NextResponse.json({
    kpis: {
      total_customers: totalCustomers,
      new_customers: newCustomers,
      returning_customers: returningCustomers,
      returning_pct: returningPct,
      avg_check: avgCheck,
      avg_ltv: avgLtv,
      retention_rate: retentionRate,
      churn_rate: churnRate,
      avg_interval_days: avgInterval,
      orders_per_customer: ordersPerCust,
    },
    weekly_trend: weeklyData,
    channel_distribution: channelDist.map(c => ({
      channel: channelLabels[c.channel] || c.channel,
      channel_key: c.channel,
      customers: c.customers, revenue: round(c.revenue), orders: c.orders,
    })),
    top_customers: topCustomers,
    period: { from: dateFrom, to: dateTo },
  });
}
