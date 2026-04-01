import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function GET(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = searchParams.get('date_from') || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const dateTo = searchParams.get('date_to') || today;
  const categoryId = searchParams.get('category_id');
  const sortBy = searchParams.get('sort_by') || 'revenue';
  const sortDir = searchParams.get('sort_dir') || 'desc';

  const db = getDb();

  let catFilter = '';
  let catParams = [];
  if (categoryId) { catFilter = 'AND p.category_id = ?'; catParams = [categoryId]; }

  const rows = db.prepare(`
    SELECT 
      p.id, p.name, p.sku, p.status as product_status, p.target_margin_pct, p.launch_date,
      c.name as category_name,
      COALESCE(SUM(CASE WHEN o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled' THEN oi.final_price ELSE 0 END), 0) as revenue,
      COALESCE(SUM(CASE WHEN o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled' THEN oi.cost_price_at_sale * oi.quantity ELSE 0 END), 0) as cogs,
      COALESCE(SUM(CASE WHEN o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled' THEN oi.quantity ELSE 0 END), 0) as quantity,
      COUNT(DISTINCT CASE WHEN o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled' THEN oi.order_id END) as orders,
      AVG(CASE WHEN o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled' THEN oi.discount_pct END) as avg_discount,
      COALESCE(SUM(CASE WHEN o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled' AND oi.is_promo = 1 THEN oi.quantity ELSE 0 END), 0) as promo_qty
    FROM core_products p
    JOIN core_product_categories c ON p.category_id = c.id
    LEFT JOIN core_sales_order_items oi ON oi.product_id = p.id
    LEFT JOIN core_sales_orders o ON oi.order_id = o.id
    WHERE 1=1 ${catFilter}
    GROUP BY p.id
  `).all(dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo, ...catParams);

  // Previous period
  const daysDiff = Math.ceil((new Date(dateTo) - new Date(dateFrom)) / 86400000) + 1;
  const prevTo = new Date(new Date(dateFrom) - 86400000).toISOString().slice(0, 10);
  const prevFrom = new Date(new Date(dateFrom) - daysDiff * 86400000).toISOString().slice(0, 10);

  const prevMap = {};
  const prevRows = db.prepare(`
    SELECT 
      oi.product_id,
      SUM(oi.final_price) as revenue,
      SUM(oi.cost_price_at_sale * oi.quantity) as cogs,
      SUM(oi.quantity) as quantity
    FROM core_sales_order_items oi
    JOIN core_sales_orders o ON oi.order_id = o.id
    WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
    GROUP BY oi.product_id
  `).all(prevFrom, prevTo);
  for (const r of prevRows) prevMap[r.product_id] = r;

  const products = rows.map(r => {
    const rev = r.revenue, cg = r.cogs, qty = r.quantity;
    const marginPct = rev > 0 ? (rev - cg) / rev * 100 : 0;
    const marginAmt = rev - cg;
    const avgPrice = qty > 0 ? rev / qty : 0;
    const p = prevMap[r.id] || { revenue: 0, cogs: 0, quantity: 0 };
    const prevMarginPct = p.revenue > 0 ? (p.revenue - p.cogs) / p.revenue * 100 : 0;
    const deltaRev = p.revenue === 0 ? 0 : Math.round((rev - p.revenue) / p.revenue * 1000) / 10;
    const deltaMargin = Math.round((marginPct - prevMarginPct) * 10) / 10;

    const todayDate = new Date(today);
    const launchDate = r.launch_date ? new Date(r.launch_date) : null;
    const daysSinceLaunch = launchDate ? Math.ceil((todayDate - launchDate) / 86400000) : 999;
    let status = 'normal';
    if (daysSinceLaunch < 14) status = 'new';
    else {
      const marginDrop = prevMarginPct > 0 ? (prevMarginPct - marginPct) / prevMarginPct * 100 : 0;
      if (marginDrop > 30 && ((r.avg_discount || 0) > 20 || (r.promo_qty === 0 && (prevMarginPct - marginPct) > 10)))
        status = 'critical';
      else if (marginDrop > 30 || Math.abs(deltaRev) > 30) status = 'risk';
      else if (marginDrop > 15 || Math.abs(deltaRev) > 25) status = 'attention';
    }

    return {
      id: r.id, name: r.name, sku: r.sku, category: r.category_name,
      product_status: r.product_status,
      revenue: Math.round(rev * 100) / 100, cogs: Math.round(cg * 100) / 100,
      margin_pct: Math.round(marginPct * 10) / 10, margin_amount: Math.round(marginAmt * 100) / 100,
      quantity: Math.round(qty * 10) / 10, orders: r.orders || 0,
      avg_price: Math.round(avgPrice * 100) / 100,
      avg_discount: Math.round((r.avg_discount || 0) * 10) / 10,
      promo_qty: Math.round(r.promo_qty * 10) / 10,
      delta_revenue_pct: deltaRev, delta_margin_pp: deltaMargin,
      status, is_new: r.product_status === 'new',
      launch_date: r.launch_date
    };
  });

  // Sort
  const dir = sortDir === 'desc' ? -1 : 1;
  if (['revenue', 'margin_pct', 'quantity', 'orders', 'delta_revenue_pct', 'delta_margin_pp'].includes(sortBy)) {
    products.sort((a, b) => ((a[sortBy] || 0) - (b[sortBy] || 0)) * dir);
  } else if (sortBy === 'status') {
    const ord = { critical: 0, risk: 1, attention: 2, normal: 3, new: 4 };
    products.sort((a, b) => ((ord[a.status] || 5) - (ord[b.status] || 5)) * (sortDir === 'desc' ? -1 : 1));
  }

  return NextResponse.json({
    products, total_count: products.length,
    period: { from: dateFrom, to: dateTo }, last_updated: today, freshness_status: 'fresh'
  });
}
