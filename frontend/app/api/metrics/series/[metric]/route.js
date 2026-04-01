import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function GET(req, { params }) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { metric } = await params;
  const { searchParams } = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = searchParams.get('date_from') || today.slice(0, 8) + '01';
  const dateTo = searchParams.get('date_to') || today;
  const categoryId = searchParams.get('category_id');
  const productId = searchParams.get('product_id');

  const db = getDb();
  let catJoin = '', catFilter = '', params2 = [dateFrom, dateTo];
  if (categoryId) { catJoin = 'JOIN core_products p ON oi.product_id = p.id'; catFilter = 'AND p.category_id = ?'; params2.push(categoryId); }
  if (productId) { catFilter += ' AND oi.product_id = ?'; params2.push(productId); }

  const rows = db.prepare(`
    SELECT 
      o.order_date as date,
      SUM(oi.final_price) as revenue,
      SUM(oi.cost_price_at_sale * oi.quantity) as cogs,
      SUM(oi.quantity) as volume,
      COUNT(DISTINCT oi.order_id) as orders
    FROM core_sales_order_items oi
    JOIN core_sales_orders o ON oi.order_id = o.id
    ${catJoin}
    WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled' ${catFilter}
    GROUP BY o.order_date
    ORDER BY o.order_date
  `).all(...params2);

  const series = rows.map(r => {
    const rev = r.revenue, cog = r.cogs;
    const marginPct = rev > 0 ? (rev - cog) / rev * 100 : 0;
    let value;
    if (metric === 'revenue' || metric === 'revenue_daily') value = Math.round(rev * 100) / 100;
    else if (metric === 'margin' || metric === 'margin_daily') value = Math.round(marginPct * 10) / 10;
    else if (metric === 'volume' || metric === 'volume_daily') value = Math.round(r.volume * 10) / 10;
    else if (metric === 'orders' || metric === 'orders_daily') value = r.orders;
    else value = Math.round(rev * 100) / 100;
    return { date: r.date, value };
  });

  return NextResponse.json({ series, metric });
}
