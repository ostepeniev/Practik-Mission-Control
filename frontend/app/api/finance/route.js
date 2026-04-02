import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET(request) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const dateFrom = searchParams.get('date_from') || new Date(Date.now() - 30*86400000).toISOString().slice(0,10);
    const dateTo = searchParams.get('date_to') || new Date().toISOString().slice(0,10);

    // Previous period for comparison
    const periodLen = Math.round((new Date(dateTo) - new Date(dateFrom)) / 86400000);
    const prevFrom = new Date(new Date(dateFrom) - periodLen * 86400000).toISOString().slice(0,10);
    const prevTo = dateFrom;

    // KPI - Revenue
    const rev = db.prepare(`SELECT SUM(total_amount) as total FROM core_sales_orders WHERE order_date BETWEEN ? AND ? AND status='completed'`).get(dateFrom, dateTo);
    const prevRev = db.prepare(`SELECT SUM(total_amount) as total FROM core_sales_orders WHERE order_date BETWEEN ? AND ? AND status='completed'`).get(prevFrom, prevTo);
    const revDelta = prevRev?.total > 0 ? ((rev?.total - prevRev?.total) / prevRev.total * 100) : 0;

    // Margin
    const marginData = db.prepare(`
      SELECT SUM(oi.final_price) as revenue, SUM(oi.cost_price_at_sale * oi.quantity) as cost
      FROM core_sales_order_items oi
      JOIN core_sales_orders o ON o.id = oi.order_id
      WHERE o.order_date BETWEEN ? AND ? AND o.status='completed'
    `).get(dateFrom, dateTo);
    const marginPct = marginData?.revenue > 0 ? ((marginData.revenue - (marginData.cost || 0)) / marginData.revenue * 100) : 0;
    const marginSum = (marginData?.revenue || 0) - (marginData?.cost || 0);

    // Receivables
    const recv = db.prepare(`SELECT SUM(amount - paid_amount) as overdue FROM receivables WHERE status='overdue'`).get();
    const payables = db.prepare(`SELECT SUM(amount - paid_amount) as total FROM payables WHERE status='pending'`).get();

    // Cashflow
    const cashflow = db.prepare(`
      SELECT 
        SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expenses
      FROM cashflow_events WHERE event_date BETWEEN ? AND ?
    `).get(dateFrom, dateTo);

    const kpi = {
      revenueMTD: Math.round(rev?.total || 0),
      revenueDelta: Math.round(revDelta * 10) / 10,
      marginPct: Math.round(marginPct * 10) / 10,
      marginSum: Math.round(marginSum),
      overdueReceivables: Math.round(recv?.overdue || 0),
      totalPayables: Math.round(payables?.total || 0),
      cashflow: Math.round((cashflow?.income || 0) - (cashflow?.expenses || 0)),
    };

    // Revenue series with previous period comparison
    const revenueSeries = db.prepare(`
      SELECT order_date as date, SUM(total_amount) as revenue
      FROM core_sales_orders WHERE order_date BETWEEN ? AND ? AND status='completed'
      GROUP BY order_date ORDER BY order_date
    `).all(dateFrom, dateTo);

    const prevRevenueSeries = db.prepare(`
      SELECT order_date as date, SUM(total_amount) as revenue
      FROM core_sales_orders WHERE order_date BETWEEN ? AND ? AND status='completed'
      GROUP BY order_date ORDER BY order_date
    `).all(prevFrom, prevTo);

    // Margin by category
    const marginByCategory = db.prepare(`
      SELECT pc.name as category,
        SUM(oi.final_price) as revenue,
        SUM(oi.cost_price_at_sale * oi.quantity) as cost,
        CAST((SUM(oi.final_price) - SUM(oi.cost_price_at_sale * oi.quantity)) AS REAL) / NULLIF(SUM(oi.final_price), 0) * 100 as margin_pct
      FROM core_sales_order_items oi
      JOIN core_sales_orders o ON o.id = oi.order_id
      JOIN core_products p ON p.id = oi.product_id
      JOIN core_product_categories pc ON pc.id = p.category_id
      WHERE o.order_date BETWEEN ? AND ? AND o.status='completed'
      GROUP BY pc.id ORDER BY revenue DESC
    `).all(dateFrom, dateTo);

    // Receivables by customer
    const receivablesList = db.prepare(`
      SELECT r.invoice_number, r.invoice_date, r.due_date, r.amount, r.paid_amount, r.status, r.days_overdue,
        c.name as customer_name
      FROM receivables r
      LEFT JOIN core_customers c ON c.id = r.customer_id
      WHERE r.status != 'paid'
      ORDER BY r.days_overdue DESC, r.amount DESC
      LIMIT 20
    `).all();

    // Payables list
    const payablesList = db.prepare(`
      SELECT supplier_name, invoice_date, due_date, amount, paid_amount, category, status
      FROM payables WHERE status != 'paid'
      ORDER BY due_date ASC LIMIT 15
    `).all();

    // Expense structure (for PieChart)
    const expenseStructure = db.prepare(`
      SELECT category, SUM(amount) as total, is_fixed
      FROM expenses WHERE expense_date BETWEEN ? AND ?
      GROUP BY category ORDER BY total DESC
    `).all(dateFrom, dateTo);

    // Cashflow series (weekly)
    const cashflowSeries = db.prepare(`
      SELECT strftime('%Y-%W', event_date) as week,
        MIN(event_date) as week_start,
        SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income,
        SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expenses
      FROM cashflow_events WHERE event_date BETWEEN ? AND ?
      GROUP BY week ORDER BY week
    `).all(dateFrom, dateTo);

    // Purchase price alerts
    const purchasePriceAlerts = db.prepare(`
      SELECT material_name, price_per_kg, market_avg_price, supplier,
        CAST((price_per_kg - market_avg_price) AS REAL) / NULLIF(market_avg_price, 0) * 100 as delta_pct
      FROM purchase_price_history
      WHERE effective_date = (SELECT MAX(effective_date) FROM purchase_price_history)
      ORDER BY delta_pct DESC
    `).all();

    // AI alerts
    const alerts = [];
    // Overdue receivables alert
    if (recv?.overdue > 50000) {
      const topDebtor = db.prepare(`
        SELECT c.name, SUM(r.amount - r.paid_amount) as debt
        FROM receivables r JOIN core_customers c ON c.id = r.customer_id
        WHERE r.status='overdue' GROUP BY r.customer_id ORDER BY debt DESC LIMIT 1
      `).get();
      alerts.push({
        type: 'critical',
        title: `Дебіторка: ${Math.round(recv.overdue / 1000)}K ₴`,
        message: `Основний боржник — ${topDebtor?.name || 'невідомо'} (${Math.round((topDebtor?.debt || 0) / 1000)}K ₴)`,
      });
    }
    // Margin decline
    const prevMargin = db.prepare(`
      SELECT CAST((SUM(oi.final_price) - SUM(oi.cost_price_at_sale * oi.quantity)) AS REAL) / NULLIF(SUM(oi.final_price), 0) * 100 as margin
      FROM core_sales_order_items oi JOIN core_sales_orders o ON o.id = oi.order_id
      WHERE o.order_date BETWEEN ? AND ? AND o.status='completed'
    `).get(prevFrom, prevTo);
    if (prevMargin?.margin && marginPct < prevMargin.margin - 2) {
      alerts.push({
        type: 'warning',
        title: `Маржинальність знижується`,
        message: `${Math.round(marginPct)}% vs ${Math.round(prevMargin.margin)}% минулий період`,
      });
    }
    // Purchase price vs market
    for (const pp of purchasePriceAlerts.filter(p => p.delta_pct > 10)) {
      alerts.push({
        type: 'warning',
        title: `${pp.material_name}: +${Math.round(pp.delta_pct)}% від ринку`,
        message: `${pp.price_per_kg} ₴/кг vs ринкові ${pp.market_avg_price} ₴/кг (${pp.supplier})`,
      });
    }
    // Cashflow forecast
    const avgWeeklyIncome = cashflowSeries.length > 0 ? cashflowSeries.reduce((s, w) => s + w.income, 0) / cashflowSeries.length : 0;
    const avgWeeklyExpense = cashflowSeries.length > 0 ? cashflowSeries.reduce((s, w) => s + w.expenses, 0) / cashflowSeries.length : 0;
    alerts.push({
      type: avgWeeklyIncome > avgWeeklyExpense ? 'info' : 'warning',
      title: `Прогноз cashflow наступний місяць`,
      message: `Надходження ~${Math.round(avgWeeklyIncome * 4 / 1000)}K ₴, Витрати ~${Math.round(avgWeeklyExpense * 4 / 1000)}K ₴, Баланс ${Math.round((avgWeeklyIncome - avgWeeklyExpense) * 4 / 1000)}K ₴`,
    });

    return NextResponse.json({
      kpi,
      revenueSeries,
      prevRevenueSeries,
      marginByCategory,
      receivablesList,
      payablesList,
      expenseStructure,
      cashflowSeries,
      purchasePriceAlerts,
      alerts,
    });
  } catch (error) {
    console.error('Finance API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
