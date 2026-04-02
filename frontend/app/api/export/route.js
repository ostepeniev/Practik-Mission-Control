import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { grossMarginPct, avgPrice, deltaPct, deltaPP, classifyProductStatus, round } from '@/lib/metrics';

export async function GET(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'products';
  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = searchParams.get('date_from') || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const dateTo = searchParams.get('date_to') || today;

  const db = getDb();

  let csvContent = '';
  let filename = '';

  if (type === 'products') {
    filename = `products_${dateFrom}_${dateTo}.csv`;

    const rows = db.prepare(`
      SELECT 
        p.id, p.name, p.sku, c.name as category_name, p.launch_date,
        COALESCE(SUM(CASE WHEN o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled' THEN oi.final_price ELSE 0 END), 0) as revenue,
        COALESCE(SUM(CASE WHEN o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled' THEN oi.cost_price_at_sale * oi.quantity ELSE 0 END), 0) as cogs,
        COALESCE(SUM(CASE WHEN o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled' THEN oi.quantity ELSE 0 END), 0) as quantity,
        COUNT(DISTINCT CASE WHEN o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled' THEN oi.order_id END) as orders,
        AVG(CASE WHEN o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled' THEN oi.discount_pct END) as avg_discount
      FROM core_products p
      JOIN core_product_categories c ON p.category_id = c.id
      LEFT JOIN core_sales_order_items oi ON oi.product_id = p.id
      LEFT JOIN core_sales_orders o ON oi.order_id = o.id
      GROUP BY p.id
      ORDER BY revenue DESC
    `).all(dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo, dateFrom, dateTo);

    const headers = ['ID', 'Назва', 'SKU', 'Категорія', 'Виторг ₴', 'Собівартість ₴', 'Маржа %', 'Маржа ₴', 'К-ть', 'Замовлень', 'Сер. знижка %', 'Дата запуску'];
    const csvRows = rows.map(r => {
      const marginPct = grossMarginPct(r.revenue, r.cogs);
      return [
        r.id,
        `"${(r.name || '').replace(/"/g, '""')}"`,
        r.sku,
        `"${(r.category_name || '').replace(/"/g, '""')}"`,
        round(r.revenue),
        round(r.cogs),
        round(marginPct, 1),
        round(r.revenue - r.cogs),
        round(r.quantity, 1),
        r.orders,
        round(r.avg_discount || 0, 1),
        r.launch_date || '',
      ].join(',');
    });
    csvContent = '\uFEFF' + headers.join(',') + '\n' + csvRows.join('\n');

  } else if (type === 'complaints') {
    filename = `complaints_${dateFrom}_${dateTo}.csv`;

    const rows = db.prepare(`
      SELECT c.*, p.name as product_name, p.sku as product_sku
      FROM core_complaints c
      JOIN core_products p ON c.product_id = p.id
      WHERE c.complaint_date >= ? AND c.complaint_date <= ?
      ORDER BY c.complaint_date DESC
    `).all(dateFrom, dateTo);

    const headers = ['ID', 'Дата', 'Товар', 'SKU', 'Джерело', 'Важливість', 'Партія', 'Опис', 'Статус'];
    const csvRows = rows.map(r => [
      r.id,
      r.complaint_date,
      `"${(r.product_name || '').replace(/"/g, '""')}"`,
      r.product_sku,
      r.source,
      r.severity,
      r.batch_number || '',
      `"${(r.description || '').replace(/"/g, '""')}"`,
      r.status,
    ].join(','));
    csvContent = '\uFEFF' + headers.join(',') + '\n' + csvRows.join('\n');

  } else {
    return NextResponse.json({ detail: 'Unknown export type' }, { status: 400 });
  }

  return new NextResponse(csvContent, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
