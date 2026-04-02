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
    },
    last_updated: today,
    freshness_status: 'fresh',
  });
}
