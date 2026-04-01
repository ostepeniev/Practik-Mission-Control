import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function GET(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = searchParams.get('date_from') || today.slice(0, 8) + '01';
  const dateTo = searchParams.get('date_to') || today;
  const limit = parseInt(searchParams.get('limit') || '5');

  const db = getDb();
  const rows = db.prepare(`
    SELECT cu.id, cu.name, cu.region, cu.channel,
      SUM(oi.final_price) as revenue,
      COUNT(DISTINCT o.id) as orders,
      SUM(oi.cost_price_at_sale * oi.quantity) as cogs
    FROM core_customers cu
    JOIN core_sales_orders o ON cu.id = o.customer_id
    JOIN core_sales_order_items oi ON oi.order_id = o.id
    WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
    GROUP BY cu.id ORDER BY revenue DESC LIMIT ?
  `).all(dateFrom, dateTo, limit);

  return NextResponse.json({
    items: rows.map(r => ({
      id: r.id, name: r.name, region: r.region, channel: r.channel,
      revenue: Math.round(r.revenue * 100) / 100, orders: r.orders,
      margin_pct: r.revenue > 0 ? Math.round((r.revenue - r.cogs) / r.revenue * 1000) / 10 : 0
    }))
  });
}
