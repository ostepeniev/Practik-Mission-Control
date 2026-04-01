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
    SELECT p.id, p.name, p.sku,
      SUM(oi.final_price) as revenue,
      SUM(oi.quantity) as quantity
    FROM core_sales_order_items oi
    JOIN core_products p ON oi.product_id = p.id
    JOIN core_sales_orders o ON oi.order_id = o.id
    WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
    GROUP BY p.id ORDER BY revenue DESC LIMIT ?
  `).all(dateFrom, dateTo, limit);

  return NextResponse.json({
    items: rows.map(r => ({
      id: r.id, name: r.name, sku: r.sku,
      revenue: Math.round(r.revenue * 100) / 100,
      quantity: Math.round(r.quantity * 10) / 10
    }))
  });
}
