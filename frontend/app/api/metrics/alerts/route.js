import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { grossMarginPct, deltaPct, deltaPP, round } from '@/lib/metrics';

export async function GET(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = searchParams.get('date_from') || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const dateTo = searchParams.get('date_to') || today;
  const db = getDb();

  const daysDiff = Math.ceil((new Date(dateTo) - new Date(dateFrom)) / 86400000) + 1;
  const prevTo = new Date(new Date(dateFrom) - 86400000).toISOString().slice(0, 10);
  const prevFrom = new Date(new Date(dateFrom) - daysDiff * 86400000).toISOString().slice(0, 10);

  const rows = db.prepare(`
    SELECT 
      p.id, p.name, p.sku, p.launch_date, p.target_margin_pct,
      SUM(oi.final_price) as revenue,
      SUM(oi.cost_price_at_sale * oi.quantity) as cogs,
      SUM(oi.quantity) as quantity,
      AVG(oi.discount_pct) as avg_discount,
      SUM(CASE WHEN oi.is_promo = 1 THEN oi.quantity ELSE 0 END) as promo_qty,
      COUNT(DISTINCT o.manager_id) as manager_count
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

  // Complaint counts per product
  const complaintCounts = {};
  db.prepare(`
    SELECT product_id, COUNT(*) as cnt 
    FROM core_complaints WHERE complaint_date >= ? AND complaint_date <= ?
    GROUP BY product_id
  `).all(dateFrom, dateTo).forEach(r => { complaintCounts[r.product_id] = r.cnt; });

  // Top discounters per product (managers who gave biggest discounts)
  const topDiscounters = {};
  db.prepare(`
    SELECT oi.product_id, m.name as manager_name, AVG(oi.discount_pct) as avg_disc, COUNT(*) as cnt
    FROM core_sales_order_items oi
    JOIN core_sales_orders o ON oi.order_id = o.id
    LEFT JOIN core_managers m ON o.manager_id = m.id
    WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled' AND oi.discount_pct > 10
    GROUP BY oi.product_id, o.manager_id
    ORDER BY avg_disc DESC
  `).all(dateFrom, dateTo).forEach(r => {
    if (!topDiscounters[r.product_id]) topDiscounters[r.product_id] = [];
    topDiscounters[r.product_id].push({ name: r.manager_name, avg_disc: round(r.avg_disc, 1), count: r.cnt });
  });

  const alerts = [];
  for (const r of rows) {
    const marginPct = grossMarginPct(r.revenue, r.cogs);
    const p = prevMap[r.id] || { revenue: 0, cogs: 0 };
    const prevMarginPct = grossMarginPct(p.revenue, p.cogs);
    const marginDrop = prevMarginPct > 0 ? (prevMarginPct - marginPct) / prevMarginPct * 100 : 0;
    const deltaRev = round(deltaPct(r.revenue, p.revenue), 1);

    const launchDate = r.launch_date ? new Date(r.launch_date) : null;
    if (launchDate && (new Date(today) - launchDate) / 86400000 < 14) continue;

    let severity = null;
    if (marginDrop > 30 && ((r.avg_discount || 0) > 20 || (r.promo_qty === 0 && (prevMarginPct - marginPct) > 10)))
      severity = 'critical';
    else if (marginDrop > 30 || Math.abs(deltaRev) > 30) severity = 'risk';

    if (!severity) continue;

    // ─── Generate AI Hypotheses ───
    const hypotheses = [];
    const complaints = complaintCounts[r.id] || 0;
    const discounters = topDiscounters[r.id] || [];

    // Hypothesis 1: Manager discount issue
    if (discounters.length > 0 && (r.avg_discount || 0) > 10) {
      const top = discounters[0];
      hypotheses.push({
        type: 'manager_discount',
        confidence: 0.8,
        text: `Менеджер ${top.name} дав знижку ${top.avg_disc}% у ${top.count} замовленнях — можливо помилка ціни`,
        icon: '👤',
      });
    }

    // Hypothesis 2: Complaints cluster
    if (complaints >= 3) {
      hypotheses.push({
        type: 'complaint_cluster',
        confidence: 0.85,
        text: `Товар має ${complaints} скарг за період — перевірити партію`,
        icon: '📢',
      });
    }

    // Hypothesis 3: Promo impact
    if (r.promo_qty > 0 && r.quantity > 0 && (r.promo_qty / r.quantity) > 0.3) {
      hypotheses.push({
        type: 'promo_impact',
        confidence: 0.7,
        text: `${round(r.promo_qty / r.quantity * 100, 0)}% обсягу — промо-відправки (перевірте рентабельність)`,
        icon: '🏷️',
      });
    }

    // Hypothesis 4: Revenue anomaly
    if (deltaRev > 40) {
      hypotheses.push({
        type: 'revenue_spike',
        confidence: 0.6,
        text: `Виторг зріс на ${deltaRev}% — перевірте маржу (можливі великі знижки)`,
        icon: '📈',
      });
    } else if (deltaRev < -30) {
      hypotheses.push({
        type: 'revenue_drop',
        confidence: 0.65,
        text: `Виторг впав на ${Math.abs(deltaRev)}% — перевірте наявність на складі`,
        icon: '📉',
      });
    }

    // Hypothesis 5: Cost price change
    if (marginPct < (r.target_margin_pct || 30) * 0.7 && (r.avg_discount || 0) < 5) {
      hypotheses.push({
        type: 'cost_increase',
        confidence: 0.5,
        text: `Маржа нижче цільової при низьких знижках — можливо зросла собівартість`,
        icon: '💰',
      });
    }

    const messages = [];
    if (marginPct - prevMarginPct < -5) messages.push(`Маржа впала на ${Math.abs(round(marginPct - prevMarginPct, 1))} п.п.`);
    if (deltaRev < -20) messages.push(`Виторг впав на ${Math.abs(deltaRev)}%`);
    if (deltaRev > 30) messages.push(`Виторг зріс на ${deltaRev}% (перевірте маржу)`);
    if ((r.avg_discount || 0) > 15) messages.push(`Середня знижка ${round(r.avg_discount || 0, 1)}% (вище норми)`);

    alerts.push({
      product_id: r.id, product_name: r.name, sku: r.sku, severity,
      metrics: {
        margin_pct: round(marginPct, 1),
        delta_margin_pp: round(marginPct - prevMarginPct, 1),
        delta_revenue_pct: deltaRev,
        avg_discount: round(r.avg_discount || 0, 1),
        promo_qty: r.promo_qty,
        complaints,
      },
      hypotheses,
      message: messages.length ? messages.join('; ') : `Статус: ${severity}`,
    });
  }

  alerts.sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1));

  // Auto-create notifications for new critical alerts
  const existingNotifs = new Set(
    db.prepare("SELECT title FROM notifications WHERE created_at >= ? AND source = 'alert'")
      .all(dateFrom).map(n => n.title)
  );

  for (const alert of alerts) {
    const notifTitle = `${alert.severity === 'critical' ? '🔴' : '🟠'} ${alert.product_name}`;
    if (!existingNotifs.has(notifTitle)) {
      db.prepare(
        "INSERT INTO notifications (type, severity, title, body, link, source) VALUES (?, ?, ?, ?, ?, ?)"
      ).run('alert', alert.severity, notifTitle, alert.message, `/products/${alert.product_id}`, 'alert');
    }
  }

  return NextResponse.json({ alerts, total: alerts.length });
}
