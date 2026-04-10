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

  // ─── KPIs — from marketing_sales_data for realistic numbers ──────────
  const mktKpis = db.prepare(`
    SELECT 
      MAX(total_clients) as total_clients,
      SUM(new_clients) as new_clients,
      SUM(returning_clients) as returning_clients,
      SUM(cold_clients) as cold_clients
    FROM marketing_sales_data
    WHERE week_start >= ? AND week_start <= ?
  `).get(dateFrom, dateTo);

  const mktAvgCheck = db.prepare(`
    SELECT AVG(avg_check) as ac FROM marketing_sales_data
    WHERE week_start >= ? AND week_start <= ?
  `).get(dateFrom, dateTo);

  // Fallback counts from core DB  
  const coreTotal = db.prepare(`
    SELECT COUNT(DISTINCT o.customer_id) as cnt
    FROM core_sales_orders o
    WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
  `).get(dateFrom, dateTo).cnt;

  const hasMktData = mktKpis && mktKpis.total_clients > 0;
  const totalCustomers = hasMktData ? mktKpis.total_clients : coreTotal;
  const newCustomers = hasMktData ? (mktKpis.new_clients || 0) : 0;
  const returningCustomers = hasMktData ? (mktKpis.returning_clients || 0) : coreTotal;
  const returningPct = (newCustomers + returningCustomers) > 0 ? round(returningCustomers / (newCustomers + returningCustomers) * 100, 1) : 0;
  const avgCheck = round(mktAvgCheck?.ac || 0);

  // LTV — from marketing: total shipped revenue / total clients
  const mktLtv = db.prepare(`
    SELECT SUM(shipped_orders_sum) as total_rev, MAX(total_clients) as clients
    FROM marketing_sales_data
  `).get();
  const avgLtv = mktLtv?.clients > 0 ? round(mktLtv.total_rev / mktLtv.clients) : 0;

  // Retention / Churn — from marketing data comparison
  const mktPrev = db.prepare(`
    SELECT SUM(returning_clients) as ret, SUM(new_clients) as new_c,
           SUM(new_clients + returning_clients + cold_clients) as total_active
    FROM marketing_sales_data
    WHERE week_start >= ? AND week_start <= ?
  `).get(dateFrom, dateTo);

  const totalActive = mktPrev?.total_active || (newCustomers + returningCustomers);
  const retentionRate = totalActive > 0 ? round((mktPrev?.ret || returningCustomers) / totalActive * 100, 1) : 0;
  const churnRate = round(100 - retentionRate, 1);

  // Average interval between orders — from core DB (B2B client perspective)
  const intervalRow = db.prepare(`
    SELECT AVG(interval_days) as avg_interval FROM (
      SELECT customer_id,
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

  // Total orders for this period
  const mktOrders = db.prepare(`
    SELECT SUM(incoming_orders) as orders FROM marketing_sales_data
    WHERE week_start >= ? AND week_start <= ?
  `).get(dateFrom, dateTo);
  const totalOrders = mktOrders?.orders || db.prepare(`
    SELECT COUNT(*) as cnt FROM core_sales_orders
    WHERE order_date >= ? AND order_date <= ? AND status != 'cancelled'
  `).get(dateFrom, dateTo).cnt;
  const ordersPerCust = totalActive > 0 ? round(totalOrders / totalActive, 1) : 0;

  // ─── Weekly new vs returning — from marketing_sales_data ───────
  const weeklyData = db.prepare(`
    SELECT week_start as week, new_clients as new, returning_clients as returning,
           (new_clients + returning_clients) as total
    FROM marketing_sales_data
    ORDER BY week_start
  `).all();

  // If no marketing weekly data, fallback to core DB
  if (weeklyData.length === 0) {
    for (let w = 12; w >= 0; w--) {
      const wStart = new Date(new Date(dateTo) - w * 7 * 86400000);
      const ws = wStart.toISOString().slice(0, 10);
      const we = new Date(wStart.getTime() + 6 * 86400000).toISOString().slice(0, 10);
      const wTotal = db.prepare(`
        SELECT COUNT(DISTINCT customer_id) as cnt FROM core_sales_orders
        WHERE order_date >= ? AND order_date <= ? AND status != 'cancelled'
      `).get(ws, we).cnt;
      weeklyData.push({ week: ws, total: wTotal, new: 0, returning: wTotal });
    }
  }

  // ─── Channel distribution — from core_customers ────
  const channelLabels = { wholesale: 'Оптові', retail: 'Роздріб', online: 'Онлайн', marketplace: 'Маркетплейси' };
  const channelDist = db.prepare(`
    SELECT c.channel, COUNT(DISTINCT c.id) as customers,
      COALESCE(SUM(o.total_amount), 0) as revenue, COUNT(o.id) as orders
    FROM core_customers c
    LEFT JOIN core_sales_orders o ON o.customer_id = c.id AND o.status != 'cancelled'
    GROUP BY c.channel ORDER BY revenue DESC
  `).all();

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
