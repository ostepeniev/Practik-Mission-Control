import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { grossMarginPct, deltaPct, round } from '@/lib/metrics';

export async function GET(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const metric = searchParams.get('metric') || 'revenue';
  const groupBy = searchParams.get('group_by') || 'category';
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = today.slice(0, 8) + '01';
  const dateFrom = searchParams.get('date_from') || monthStart;
  const dateTo = searchParams.get('date_to') || today;

  const db = getDb();
  const daysDiff = Math.ceil((new Date(dateTo) - new Date(dateFrom)) / 86400000) + 1;
  const prevTo = new Date(new Date(dateFrom) - 86400000).toISOString().slice(0, 10);
  const prevFrom = new Date(new Date(dateFrom) - daysDiff * 86400000).toISOString().slice(0, 10);

  let items = [];

  if (groupBy === 'category') {
    const rows = db.prepare(`
      SELECT pc.id, pc.name, SUM(oi.final_price) as revenue,
        SUM(oi.cost_price_at_sale * oi.quantity) as cogs,
        SUM(oi.quantity) as quantity, COUNT(DISTINCT o.id) as orders
      FROM core_sales_order_items oi
      JOIN core_sales_orders o ON oi.order_id = o.id
      JOIN core_products p ON oi.product_id = p.id
      JOIN core_product_categories pc ON p.category_id = pc.id
      WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
      GROUP BY pc.id ORDER BY revenue DESC
    `).all(dateFrom, dateTo);

    const prevRows = db.prepare(`
      SELECT pc.id, SUM(oi.final_price) as revenue, SUM(oi.cost_price_at_sale * oi.quantity) as cogs
      FROM core_sales_order_items oi
      JOIN core_sales_orders o ON oi.order_id = o.id
      JOIN core_products p ON oi.product_id = p.id
      JOIN core_product_categories pc ON p.category_id = pc.id
      WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
      GROUP BY pc.id
    `).all(prevFrom, prevTo);
    const prevMap = Object.fromEntries(prevRows.map(r => [r.id, r]));

    items = rows.map(r => {
      const p = prevMap[r.id] || { revenue: 0, cogs: 0 };
      return {
        id: r.id, name: r.name,
        revenue: round(r.revenue), margin_pct: round(grossMarginPct(r.revenue, r.cogs), 1),
        quantity: round(r.quantity), orders: r.orders,
        delta_pct: round(deltaPct(r.revenue, p.revenue), 1),
        prev_revenue: round(p.revenue),
      };
    });
  }

  else if (groupBy === 'channel') {
    const rows = db.prepare(`
      SELECT o.channel as name, SUM(oi.final_price) as revenue,
        SUM(oi.cost_price_at_sale * oi.quantity) as cogs,
        COUNT(DISTINCT o.id) as orders, COUNT(DISTINCT o.customer_id) as customers
      FROM core_sales_order_items oi
      JOIN core_sales_orders o ON oi.order_id = o.id
      WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
      GROUP BY o.channel ORDER BY revenue DESC
    `).all(dateFrom, dateTo);

    const prevRows = db.prepare(`
      SELECT o.channel as name, SUM(oi.final_price) as revenue
      FROM core_sales_order_items oi JOIN core_sales_orders o ON oi.order_id = o.id
      WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
      GROUP BY o.channel
    `).all(prevFrom, prevTo);
    const prevMap = Object.fromEntries(prevRows.map(r => [r.name, r]));

    const channelLabels = { wholesale: 'Оптові', retail: 'Роздріб', online: 'Онлайн', marketplace: 'Маркетплейси' };
    items = rows.map(r => {
      const p = prevMap[r.name] || { revenue: 0 };
      return {
        id: r.name, name: channelLabels[r.name] || r.name,
        revenue: round(r.revenue), margin_pct: round(grossMarginPct(r.revenue, r.cogs), 1),
        orders: r.orders, customers: r.customers,
        delta_pct: round(deltaPct(r.revenue, p.revenue), 1),
      };
    });
  }

  else if (groupBy === 'product') {
    const categoryId = searchParams.get('category_id');
    let extraWhere = '';
    const params = [dateFrom, dateTo];
    if (categoryId) { extraWhere = ' AND p.category_id = ?'; params.push(categoryId); }

    const rows = db.prepare(`
      SELECT p.id, p.name, p.sku, SUM(oi.final_price) as revenue,
        SUM(oi.cost_price_at_sale * oi.quantity) as cogs,
        SUM(oi.quantity) as quantity, COUNT(DISTINCT o.id) as orders
      FROM core_sales_order_items oi
      JOIN core_sales_orders o ON oi.order_id = o.id
      JOIN core_products p ON oi.product_id = p.id
      WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'${extraWhere}
      GROUP BY p.id ORDER BY revenue DESC LIMIT 15
    `).all(...params);

    items = rows.map(r => ({
      id: r.id, name: r.name, sku: r.sku,
      revenue: round(r.revenue), margin_pct: round(grossMarginPct(r.revenue, r.cogs), 1),
      quantity: round(r.quantity), orders: r.orders,
    }));
  }

  else if (groupBy === 'return_reason') {
    const rows = db.prepare(`
      SELECT r.reason as name, COUNT(*) as count, SUM(r.amount) as amount,
        SUM(r.quantity) as quantity
      FROM core_returns r
      JOIN core_sales_order_items oi ON r.order_item_id = oi.id
      JOIN core_sales_orders o ON oi.order_id = o.id
      WHERE r.return_date >= ? AND r.return_date <= ?
      GROUP BY r.reason ORDER BY count DESC
    `).all(dateFrom, dateTo);

    items = rows.map(r => ({
      id: r.name, name: r.name || 'Не вказано',
      count: r.count, amount: round(r.amount || 0), quantity: round(r.quantity),
    }));
  }

  else if (groupBy === 'margin_drop') {
    // Products with biggest margin drops
    const rows = db.prepare(`
      SELECT p.id, p.name, p.sku,
        SUM(oi.final_price) as revenue, SUM(oi.cost_price_at_sale * oi.quantity) as cogs
      FROM core_sales_order_items oi
      JOIN core_sales_orders o ON oi.order_id = o.id
      JOIN core_products p ON oi.product_id = p.id
      WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
      GROUP BY p.id HAVING revenue > 0
    `).all(dateFrom, dateTo);

    const prevRows = db.prepare(`
      SELECT p.id, SUM(oi.final_price) as revenue, SUM(oi.cost_price_at_sale * oi.quantity) as cogs
      FROM core_sales_order_items oi
      JOIN core_sales_orders o ON oi.order_id = o.id
      JOIN core_products p ON oi.product_id = p.id
      WHERE o.order_date >= ? AND o.order_date <= ? AND o.status != 'cancelled'
      GROUP BY p.id
    `).all(prevFrom, prevTo);
    const prevMap = Object.fromEntries(prevRows.map(r => [r.id, r]));

    items = rows.map(r => {
      const p = prevMap[r.id] || { revenue: 0, cogs: 0 };
      const currM = grossMarginPct(r.revenue, r.cogs);
      const prevM = grossMarginPct(p.revenue, p.cogs);
      return {
        id: r.id, name: r.name, sku: r.sku,
        revenue: round(r.revenue), margin_pct: round(currM, 1),
        prev_margin_pct: round(prevM, 1), margin_change_pp: round(currM - prevM, 1),
      };
    }).sort((a, b) => a.margin_change_pp - b.margin_change_pp).slice(0, 10);
  }

  return NextResponse.json({ metric, group_by: groupBy, items, period: { from: dateFrom, to: dateTo } });
}
