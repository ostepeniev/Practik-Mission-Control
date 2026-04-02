import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { grossMarginPct, deltaPct, deltaPP, round } from '@/lib/metrics';

export async function GET(req, { params }) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const days = parseInt(searchParams.get('days') || '30');
  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const db = getDb();

  const product = db.prepare('SELECT p.*, c.name as category_name FROM core_products p JOIN core_product_categories c ON p.category_id = c.id WHERE p.id = ?').get(id);
  if (!product) return NextResponse.json({ error: 'Product not found' });

  // KPIs current period
  const curr = db.prepare(`
    SELECT COALESCE(SUM(oi.final_price),0) as revenue, COALESCE(SUM(oi.cost_price_at_sale*oi.quantity),0) as cogs,
      COALESCE(SUM(oi.quantity),0) as volume, COUNT(DISTINCT oi.order_id) as order_count,
      AVG(oi.discount_pct) as avg_discount,
      SUM(CASE WHEN oi.is_promo=1 THEN oi.quantity ELSE 0 END) as promo_qty
    FROM core_sales_order_items oi JOIN core_sales_orders o ON oi.order_id=o.id
    WHERE oi.product_id=? AND o.order_date>=? AND o.order_date<=? AND o.status!='cancelled'
  `).get(id, dateFrom, today);

  // KPIs previous period
  const prevTo = new Date(new Date(dateFrom) - 86400000).toISOString().slice(0, 10);
  const prevFrom = new Date(new Date(dateFrom) - (days + 1) * 86400000).toISOString().slice(0, 10);
  const prev = db.prepare(`
    SELECT COALESCE(SUM(oi.final_price),0) as revenue, COALESCE(SUM(oi.cost_price_at_sale*oi.quantity),0) as cogs,
      COALESCE(SUM(oi.quantity),0) as volume, COUNT(DISTINCT oi.order_id) as order_count
    FROM core_sales_order_items oi JOIN core_sales_orders o ON oi.order_id=o.id
    WHERE oi.product_id=? AND o.order_date>=? AND o.order_date<=? AND o.status!='cancelled'
  `).get(id, prevFrom, prevTo);

  const mpct = grossMarginPct(curr.revenue, curr.cogs);
  const pmpct = grossMarginPct(prev.revenue, prev.cogs);

  const kpis = {
    revenue_mtd: { value: round(curr.revenue), delta_pct: round(deltaPct(curr.revenue, prev.revenue), 1), prev_value: round(prev.revenue), format: 'currency', unit: '₴' },
    gross_margin_pct: { value: round(mpct, 1), delta_pct: round(deltaPP(mpct, pmpct), 1), prev_value: round(pmpct, 1), format: 'percent', unit: '%' },
    sales_volume: { value: round(curr.volume, 1), delta_pct: round(deltaPct(curr.volume, prev.volume), 1), prev_value: round(prev.volume, 1), format: 'number', unit: 'кг' },
    order_count: { value: curr.order_count, delta_pct: round(deltaPct(curr.order_count, prev.order_count), 1), prev_value: prev.order_count, format: 'number', unit: 'шт' },
    avg_discount: { value: round(curr.avg_discount || 0, 1), format: 'percent', unit: '%' },
    promo_share: { value: curr.volume > 0 ? round(curr.promo_qty / curr.volume * 100, 1) : 0, format: 'percent', unit: '%' },
  };

  // Daily revenue series
  const revDaily = db.prepare(`
    SELECT o.order_date as date, SUM(oi.final_price) as value
    FROM core_sales_order_items oi JOIN core_sales_orders o ON oi.order_id=o.id
    WHERE oi.product_id=? AND o.order_date>=? AND o.order_date<=? AND o.status!='cancelled'
    GROUP BY o.order_date ORDER BY o.order_date
  `).all(id, dateFrom, today).map(r => ({ date: r.date, value: round(r.value) }));

  // Daily margin series
  const marginDaily = db.prepare(`
    SELECT o.order_date as date, SUM(oi.final_price) as rev, SUM(oi.cost_price_at_sale*oi.quantity) as cogs
    FROM core_sales_order_items oi JOIN core_sales_orders o ON oi.order_id=o.id
    WHERE oi.product_id=? AND o.order_date>=? AND o.order_date<=? AND o.status!='cancelled'
    GROUP BY o.order_date ORDER BY o.order_date
  `).all(id, dateFrom, today).map(r => ({ date: r.date, value: round(grossMarginPct(r.rev, r.cogs), 1) }));

  // Manager breakdown (NEW)
  const managerBreakdown = db.prepare(`
    SELECT m.name, SUM(oi.final_price) as revenue, SUM(oi.quantity) as quantity,
      COUNT(DISTINCT o.id) as orders,
      AVG(oi.discount_pct) as avg_discount,
      SUM(oi.final_price - oi.cost_price_at_sale * oi.quantity) as margin_amount
    FROM core_sales_order_items oi
    JOIN core_sales_orders o ON oi.order_id=o.id
    LEFT JOIN core_managers m ON o.manager_id=m.id
    WHERE oi.product_id=? AND o.order_date>=? AND o.order_date<=? AND o.status!='cancelled'
    GROUP BY m.id ORDER BY revenue DESC
  `).all(id, dateFrom, today).map(r => ({
    name: r.name || 'Невідомий',
    revenue: round(r.revenue),
    quantity: round(r.quantity, 1),
    orders: r.orders,
    avg_discount: round(r.avg_discount || 0, 1),
    margin_pct: round(grossMarginPct(r.revenue, r.revenue - r.margin_amount), 1),
  }));

  // Returns (NEW)
  const returns = db.prepare(`
    SELECT r.return_date, r.quantity, r.reason, r.return_type, r.amount,
      o.order_number
    FROM core_returns r
    JOIN core_sales_order_items oi ON r.order_item_id=oi.id
    JOIN core_sales_orders o ON oi.order_id=o.id
    WHERE oi.product_id=? AND r.return_date>=?
    ORDER BY r.return_date DESC LIMIT 20
  `).all(id, dateFrom).map(r => ({
    date: r.return_date, quantity: r.quantity, reason: r.reason,
    type: r.return_type, amount: round(r.amount || 0),
    order_number: r.order_number,
  }));

  const returnsSummary = db.prepare(`
    SELECT COALESCE(SUM(r.quantity),0) as total_returned, COUNT(*) as return_count
    FROM core_returns r
    JOIN core_sales_order_items oi ON r.order_item_id=oi.id
    WHERE oi.product_id=? AND r.return_date>=?
  `).get(id, dateFrom);

  // Discount distribution (NEW)
  const discountDist = db.prepare(`
    SELECT 
      CASE 
        WHEN oi.discount_pct = 0 THEN '0%'
        WHEN oi.discount_pct <= 5 THEN '1-5%'
        WHEN oi.discount_pct <= 10 THEN '6-10%'
        WHEN oi.discount_pct <= 20 THEN '11-20%'
        ELSE '20%+'
      END as bucket,
      COUNT(*) as count,
      SUM(oi.final_price) as revenue
    FROM core_sales_order_items oi
    JOIN core_sales_orders o ON oi.order_id=o.id
    WHERE oi.product_id=? AND o.order_date>=? AND o.order_date<=? AND o.status!='cancelled'
    GROUP BY bucket ORDER BY MIN(oi.discount_pct)
  `).all(id, dateFrom, today);

  // Complaints for this product (NEW)
  const complaints = db.prepare(`
    SELECT c.id, c.complaint_date as date, c.source as type, c.severity, c.description, c.status
    FROM core_complaints c
    WHERE c.product_id=? AND c.complaint_date>=?
    ORDER BY c.complaint_date DESC LIMIT 10
  `).all(id, dateFrom);

  // Recent orders
  const orders = db.prepare(`
    SELECT o.order_number, o.order_date, cu.name as customer_name, m.name as manager_name,
      oi.quantity, oi.unit_price, oi.discount_pct, oi.final_price, oi.is_promo, oi.promo_type
    FROM core_sales_order_items oi
    JOIN core_sales_orders o ON oi.order_id=o.id
    LEFT JOIN core_customers cu ON o.customer_id=cu.id
    LEFT JOIN core_managers m ON o.manager_id=m.id
    WHERE oi.product_id=? AND o.order_date>=?
    ORDER BY o.order_date DESC LIMIT 20
  `).all(id, dateFrom).map(r => ({
    order_number: r.order_number, date: r.order_date, customer: r.customer_name, manager: r.manager_name,
    quantity: r.quantity, unit_price: r.unit_price, discount_pct: r.discount_pct, final_price: r.final_price,
    is_promo: !!r.is_promo, promo_type: r.promo_type,
  }));

  return NextResponse.json({
    product: {
      id: product.id, name: product.name, sku: product.sku, category: product.category_name,
      status: product.status, launch_date: product.launch_date, target_margin_pct: product.target_margin_pct,
      current_cost_price: product.current_cost_price, recommended_sale_price: product.recommended_sale_price,
    },
    kpis,
    revenue_daily: revDaily,
    margin_daily: marginDaily,
    manager_breakdown: managerBreakdown,
    discount_distribution: discountDist,
    returns_summary: {
      total_returned: returnsSummary.total_returned,
      return_count: returnsSummary.return_count,
      return_rate_pct: curr.volume > 0 ? round(returnsSummary.total_returned / curr.volume * 100, 1) : 0,
    },
    returns_recent: returns,
    complaints,
    recent_orders: orders,
    last_updated: today,
    freshness_status: 'fresh',
  });
}
