import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function GET(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = searchParams.get('date_from') || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const dateTo = searchParams.get('date_to') || today;
  const db = getDb();

  // Get products with status classification (reuse products logic)
  const daysDiff = Math.ceil((new Date(dateTo) - new Date(dateFrom)) / 86400000) + 1;
  const prevTo = new Date(new Date(dateFrom) - 86400000).toISOString().slice(0, 10);
  const prevFrom = new Date(new Date(dateFrom) - daysDiff * 86400000).toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT 
      p.id, p.name, p.sku, p.launch_date,
      SUM(oi.final_price) as revenue,
      SUM(oi.cost_price_at_sale * oi.quantity) as cogs,
      SUM(oi.quantity) as quantity,
      AVG(oi.discount_pct) as avg_discount,
      SUM(CASE WHEN oi.is_promo = 1 THEN oi.quantity ELSE 0 END) as promo_qty
    FROM core_products p
    JOIN core_sales_order_items oi ON oi.product_id = p.id
    JOIN core_sales_orders o ON oi.order_id = o.id
    WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
    GROUP BY p.id
  `).all(dateFrom, dateTo);

  const prevMap = {};
  const prevRows = db.prepare(`
    SELECT oi.product_id, SUM(oi.final_price) as revenue, SUM(oi.cost_price_at_sale * oi.quantity) as cogs
    FROM core_sales_order_items oi
    JOIN core_sales_orders o ON oi.order_id = o.id
    WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
    GROUP BY oi.product_id
  `).all(prevFrom, prevTo);
  for (const r of prevRows) prevMap[r.product_id] = r;

  const alerts = [];
  for (const r of rows) {
    const rev = r.revenue, cog = r.cogs;
    const marginPct = rev > 0 ? (rev - cog) / rev * 100 : 0;
    const p = prevMap[r.id] || { revenue: 0, cogs: 0 };
    const prevMarginPct = p.revenue > 0 ? (p.revenue - p.cogs) / p.revenue * 100 : 0;
    const marginDrop = prevMarginPct > 0 ? (prevMarginPct - marginPct) / prevMarginPct * 100 : 0;
    const deltaRev = p.revenue ? (rev - p.revenue) / p.revenue * 100 : 0;

    const launchDate = r.launch_date ? new Date(r.launch_date) : null;
    if (launchDate && (new Date(today) - launchDate) / 86400000 < 14) continue;

    let severity = null;
    if (marginDrop > 30 && ((r.avg_discount || 0) > 20 || (r.promo_qty === 0 && (prevMarginPct - marginPct) > 10)))
      severity = 'critical';
    else if (marginDrop > 30 || Math.abs(deltaRev) > 30) severity = 'risk';

    if (!severity) continue;

    const messages = [];
    if (marginPct - prevMarginPct < -5) messages.push(`Маржа впала на ${Math.abs(Math.round((marginPct - prevMarginPct) * 10) / 10)} п.п.`);
    if (deltaRev < -20) messages.push(`Виторг впав на ${Math.abs(Math.round(deltaRev * 10) / 10)}%`);
    if (deltaRev > 30) messages.push(`Виторг зріс на ${Math.round(deltaRev * 10) / 10}% (перевірте маржу)`);
    if ((r.avg_discount || 0) > 15) messages.push(`Середня знижка ${Math.round((r.avg_discount || 0) * 10) / 10}% (вище норми)`);

    alerts.push({
      product_id: r.id, product_name: r.name, sku: r.sku, severity,
      metrics: { margin_pct: Math.round(marginPct * 10) / 10, delta_margin_pp: Math.round((marginPct - prevMarginPct) * 10) / 10, delta_revenue_pct: Math.round(deltaRev * 10) / 10, avg_discount: Math.round((r.avg_discount || 0) * 10) / 10, promo_qty: r.promo_qty },
      message: messages.length ? messages.join('; ') : `Статус: ${severity}`
    });
  }

  alerts.sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1));
  return NextResponse.json({ alerts, total: alerts.length });
}
