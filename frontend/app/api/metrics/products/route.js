import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';
import {
  grossMarginPct, grossMarginAmount, avgPrice, deltaPct, deltaPP,
  classifyProductStatus, STATUS_ORDER, round,
} from '@/lib/metrics';

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
  const search = searchParams.get('search') || '';
  const statusFilter = searchParams.get('status');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('page_size') || '50')));

  const db = getDb();

  let catFilter = '';
  let catParams = [];
  if (categoryId) { catFilter = 'AND p.category_id = ?'; catParams = [categoryId]; }

  let searchFilter = '';
  let searchParams2 = [];
  if (search) { searchFilter = 'AND (p.name LIKE ? OR p.sku LIKE ?)'; searchParams2 = [`%${search}%`, `%${search}%`]; }

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
    WHERE 1=1 ${catFilter} ${searchFilter}
    GROUP BY p.id
  `).all(dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo, ...catParams, ...searchParams2);

  // Previous period for deltas
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

  // Build products with metrics from unified dictionary
  let products = rows.map(r => {
    const rev = r.revenue, cg = r.cogs, qty = r.quantity;
    const marginPct = grossMarginPct(rev, cg);
    const marginAmt = grossMarginAmount(rev, cg);
    const price = avgPrice(rev, qty);

    const prev = prevMap[r.id] || { revenue: 0, cogs: 0, quantity: 0 };
    const prevMargin = grossMarginPct(prev.revenue, prev.cogs);
    const deltaRev = deltaPct(rev, prev.revenue);
    const deltaMarginPP = deltaPP(marginPct, prevMargin);

    const todayDate = new Date(today);
    const launchDate = r.launch_date ? new Date(r.launch_date) : null;
    const daysSinceLaunch = launchDate ? Math.ceil((todayDate - launchDate) / 86400000) : 999;

    const status = classifyProductStatus({
      marginPct,
      prevMarginPct: prevMargin,
      deltaRevenuePct: deltaRev,
      avgDiscount: r.avg_discount || 0,
      promoQty: r.promo_qty || 0,
      daysSinceLaunch,
    });

    return {
      id: r.id, name: r.name, sku: r.sku, category: r.category_name,
      product_status: r.product_status,
      revenue: round(rev), cogs: round(cg),
      margin_pct: round(marginPct, 1), margin_amount: round(marginAmt),
      quantity: round(qty, 1), orders: r.orders || 0,
      avg_price: round(price),
      avg_discount: round(r.avg_discount || 0, 1),
      promo_qty: round(r.promo_qty || 0, 1),
      delta_revenue_pct: round(deltaRev, 1),
      delta_margin_pp: round(deltaMarginPP, 1),
      status,
      is_new: daysSinceLaunch < 14,
      launch_date: r.launch_date,
      target_margin_pct: r.target_margin_pct,
    };
  });

  // Filter by status
  if (statusFilter) {
    products = products.filter(p => p.status === statusFilter);
  }

  // Sort
  const dir = sortDir === 'desc' ? -1 : 1;
  if (['revenue', 'margin_pct', 'quantity', 'orders', 'delta_revenue_pct', 'delta_margin_pp', 'avg_discount'].includes(sortBy)) {
    products.sort((a, b) => ((a[sortBy] || 0) - (b[sortBy] || 0)) * dir);
  } else if (sortBy === 'status') {
    products.sort((a, b) => ((STATUS_ORDER[a.status] ?? 5) - (STATUS_ORDER[b.status] ?? 5)) * dir);
  } else if (sortBy === 'name') {
    products.sort((a, b) => a.name.localeCompare(b.name, 'uk') * dir);
  }

  // Pagination
  const totalCount = products.length;
  const totalPages = Math.ceil(totalCount / pageSize);
  const paginatedProducts = products.slice((page - 1) * pageSize, page * pageSize);

  // Status summary
  const statusSummary = {
    critical: products.filter(p => p.status === 'critical').length,
    risk: products.filter(p => p.status === 'risk').length,
    attention: products.filter(p => p.status === 'attention').length,
    normal: products.filter(p => p.status === 'normal').length,
    new: products.filter(p => p.status === 'new').length,
  };

  return NextResponse.json({
    products: paginatedProducts,
    total_count: totalCount,
    page,
    page_size: pageSize,
    total_pages: totalPages,
    status_summary: statusSummary,
    period: { from: dateFrom, to: dateTo },
    last_updated: today,
    freshness_status: 'fresh',
  });
}
