import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

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

  // KPIs
  const curr = db.prepare(`
    SELECT COALESCE(SUM(oi.final_price),0) as revenue, COALESCE(SUM(oi.cost_price_at_sale*oi.quantity),0) as cogs,
      COALESCE(SUM(oi.quantity),0) as volume, COUNT(DISTINCT oi.order_id) as order_count
    FROM core_sales_order_items oi JOIN core_sales_orders o ON oi.order_id=o.id
    WHERE oi.product_id=? AND o.order_date>=? AND o.order_date<=? AND o.status!='cancelled'
  `).get(id, dateFrom, today);

  const prevTo = new Date(new Date(dateFrom) - 86400000).toISOString().slice(0,10);
  const prevFrom = new Date(new Date(dateFrom) - (days+1)*86400000).toISOString().slice(0,10);
  const prev = db.prepare(`
    SELECT COALESCE(SUM(oi.final_price),0) as revenue, COALESCE(SUM(oi.cost_price_at_sale*oi.quantity),0) as cogs,
      COALESCE(SUM(oi.quantity),0) as volume, COUNT(DISTINCT oi.order_id) as order_count
    FROM core_sales_order_items oi JOIN core_sales_orders o ON oi.order_id=o.id
    WHERE oi.product_id=? AND o.order_date>=? AND o.order_date<=? AND o.status!='cancelled'
  `).get(id, prevFrom, prevTo);

  const mpct = curr.revenue > 0 ? (curr.revenue-curr.cogs)/curr.revenue*100 : 0;
  const pmpct = prev.revenue > 0 ? (prev.revenue-prev.cogs)/prev.revenue*100 : 0;
  const dp = (c,p) => p===0?0:Math.round((c-p)/p*1000)/10;

  const kpis = {
    revenue_mtd: { value: Math.round(curr.revenue*100)/100, delta_pct: dp(curr.revenue,prev.revenue), prev_value: Math.round(prev.revenue*100)/100, format:'currency', unit:'₴' },
    gross_margin_pct: { value: Math.round(mpct*10)/10, delta_pct: Math.round((mpct-pmpct)*10)/10, prev_value: Math.round(pmpct*10)/10, format:'percent', unit:'%' },
    sales_volume: { value: Math.round(curr.volume*10)/10, delta_pct: dp(curr.volume,prev.volume), prev_value: Math.round(prev.volume*10)/10, format:'number', unit:'кг' },
    order_count: { value: curr.order_count, delta_pct: dp(curr.order_count,prev.order_count), prev_value: prev.order_count, format:'number', unit:'шт' },
  };

  // Daily series
  const revDaily = db.prepare(`
    SELECT o.order_date as date, SUM(oi.final_price) as value
    FROM core_sales_order_items oi JOIN core_sales_orders o ON oi.order_id=o.id
    WHERE oi.product_id=? AND o.order_date>=? AND o.order_date<=? AND o.status!='cancelled'
    GROUP BY o.order_date ORDER BY o.order_date
  `).all(id, dateFrom, today).map(r => ({ date: r.date, value: Math.round(r.value * 100) / 100 }));

  const marginDaily = db.prepare(`
    SELECT o.order_date as date, SUM(oi.final_price) as rev, SUM(oi.cost_price_at_sale*oi.quantity) as cogs
    FROM core_sales_order_items oi JOIN core_sales_orders o ON oi.order_id=o.id
    WHERE oi.product_id=? AND o.order_date>=? AND o.order_date<=? AND o.status!='cancelled'
    GROUP BY o.order_date ORDER BY o.order_date
  `).all(id, dateFrom, today).map(r => ({ date: r.date, value: r.rev>0 ? Math.round((r.rev-r.cogs)/r.rev*1000)/10 : 0 }));

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
    is_promo: !!r.is_promo, promo_type: r.promo_type
  }));

  return NextResponse.json({
    product: { id: product.id, name: product.name, sku: product.sku, category: product.category_name,
      status: product.status, launch_date: product.launch_date, target_margin_pct: product.target_margin_pct,
      current_cost_price: product.current_cost_price, recommended_sale_price: product.recommended_sale_price },
    kpis, revenue_daily: revDaily, margin_daily: marginDaily, recent_orders: orders,
    last_updated: today, freshness_status: 'fresh'
  });
}
