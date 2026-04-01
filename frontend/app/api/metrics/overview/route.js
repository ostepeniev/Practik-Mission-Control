import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

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

  if (categoryId) {
    where += ` AND p.category_id = ?`;
    params.push(categoryId);
  }
  if (productId) {
    where += ` AND oi.product_id = ?`;
    params.push(productId);
  }

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
  const marginPct = revenue > 0 ? (revenue - cogs) / revenue * 100 : 0;
  const marginAmount = revenue - cogs;

  // Returns
  const retRow = db.prepare(`
    SELECT COALESCE(SUM(r.quantity), 0) as returned
    FROM core_returns r
    JOIN core_sales_order_items oi ON r.order_item_id = oi.id
    JOIN core_sales_orders o ON oi.order_id = o.id
    WHERE o.order_date >= ? AND o.order_date <= ?
  `).get(dateFrom, dateTo);
  const returnsPct = volume > 0 ? retRow.returned / volume * 100 : 0;

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
  const prevMarginPct = prevRevenue > 0 ? (prevRevenue - prev.cogs) / prevRevenue * 100 : 0;

  function deltaPct(c, p) { return p === 0 ? 0 : Math.round((c - p) / p * 1000) / 10; }

  return NextResponse.json({
    period: { from: dateFrom, to: dateTo },
    metrics: {
      revenue_mtd: { value: Math.round(revenue * 100) / 100, delta_pct: deltaPct(revenue, prevRevenue), prev_value: Math.round(prevRevenue * 100) / 100, format: 'currency', unit: '₴' },
      gross_margin_pct: { value: Math.round(marginPct * 10) / 10, delta_pct: Math.round((marginPct - prevMarginPct) * 10) / 10, prev_value: Math.round(prevMarginPct * 10) / 10, format: 'percent', unit: '%' },
      gross_margin_amount: { value: Math.round(marginAmount * 100) / 100, delta_pct: deltaPct(marginAmount, prev.revenue - prev.cogs), prev_value: Math.round((prev.revenue - prev.cogs) * 100) / 100, format: 'currency', unit: '₴' },
      sales_volume: { value: Math.round(volume * 10) / 10, delta_pct: deltaPct(volume, prev.volume), prev_value: Math.round(prev.volume * 10) / 10, format: 'number', unit: 'кг' },
      order_count: { value: orderCount, delta_pct: deltaPct(orderCount, prev.order_count), prev_value: prev.order_count, format: 'number', unit: 'шт' },
      returns_pct: { value: Math.round(returnsPct * 100) / 100, delta_pct: 0, prev_value: 0, format: 'percent', unit: '%', inverse: true },
    },
    last_updated: today,
    freshness_status: 'fresh'
  });
}
