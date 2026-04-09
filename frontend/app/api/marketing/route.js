import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const view = searchParams.get('view') || 'overview';
  const period = searchParams.get('period') || 'last_week'; // last_week | week:YYYY-MM-DD | month | quarter | all
  const db = getDb();

  try {
    if (view === 'overview') return NextResponse.json(getOverview(db, period));
    if (view === 'channels') return NextResponse.json(getChannels(db, period));
    if (view === 'weeks') return NextResponse.json(getWeeks(db));
    if (view === 'alerts') return NextResponse.json(getAlerts(db));
    if (view === 'periods') return NextResponse.json(getAvailablePeriods(db));
    return NextResponse.json({ error: 'Unknown view' }, { status: 400 });
  } catch (e) {
    console.error('Marketing API error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ─── Period resolution ──────────────────────────────────────
function resolveWeeks(db, period) {
  const allWeeks = db.prepare(
    'SELECT DISTINCT week_start FROM marketing_weekly_data ORDER BY week_start DESC'
  ).all().map(r => r.week_start);

  if (allWeeks.length === 0) return { current: [], previous: [], label: '—' };

  if (period === 'last_week') {
    // Find latest week with complete sales data, fallback to latest overall
    const latestWithSales = db.prepare(
      'SELECT week_start FROM marketing_sales_data WHERE shipped_orders_sum > 0 ORDER BY week_start DESC LIMIT 1'
    ).get();
    const target = latestWithSales ? latestWithSales.week_start : allWeeks[0];
    const idx = allWeeks.indexOf(target);
    const prev = idx >= 0 && idx + 1 < allWeeks.length ? [allWeeks[idx + 1]] : [];
    return { current: [target], previous: prev, label: target };
  }

  if (period.startsWith('week:')) {
    const w = period.slice(5);
    const idx = allWeeks.indexOf(w);
    const prev = idx >= 0 && idx + 1 < allWeeks.length ? [allWeeks[idx + 1]] : [];
    return { current: [w], previous: prev, label: w };
  }

  if (period === 'month') {
    // last 4 weeks
    const cur = allWeeks.slice(0, 4);
    const prev = allWeeks.slice(4, 8);
    return { current: cur, previous: prev, label: `${cur[cur.length - 1]} — ${cur[0]} (4 тижні)` };
  }

  if (period === 'quarter') {
    // last 13 weeks
    const cur = allWeeks.slice(0, 13);
    const prev = allWeeks.slice(13, 26);
    return { current: cur, previous: prev, label: `${cur[cur.length - 1]} — ${cur[0]} (квартал)` };
  }

  if (period === 'all') {
    return { current: allWeeks, previous: [], label: `Весь час (${allWeeks.length} тижнів)` };
  }

  return { current: [allWeeks[0]], previous: allWeeks[1] ? [allWeeks[1]] : [], label: allWeeks[0] };
}

function sumWeeklyData(db, weeks) {
  if (weeks.length === 0) return { spend: 0, ad_value: 0, crm_rev: 0, orders: 0, new_clients: 0, traffic: 0 };
  const placeholders = weeks.map(() => '?').join(',');
  return db.prepare(`
    SELECT SUM(ad_spend) as spend, SUM(ad_conversions_value) as ad_value,
      SUM(crm_revenue) as crm_rev, SUM(crm_orders) as orders,
      SUM(crm_new_clients) as new_clients, SUM(traffic) as traffic
    FROM marketing_weekly_data WHERE week_start IN (${placeholders})
  `).get(...weeks);
}

function sumSalesData(db, weeks) {
  if (weeks.length === 0) return null;
  const placeholders = weeks.map(() => '?').join(',');
  return db.prepare(`
    SELECT SUM(incoming_orders) as incoming_orders,
      SUM(incoming_orders_sum) as incoming_orders_sum,
      SUM(shipped_orders) as shipped_orders,
      SUM(shipped_orders_sum) as shipped_orders_sum,
      AVG(ship_conversion_rate) as ship_conversion_rate,
      AVG(avg_check) as avg_check,
      MAX(total_clients) as total_clients,
      SUM(new_clients) as new_clients,
      SUM(returning_clients) as returning_clients,
      SUM(cold_clients) as cold_clients
    FROM marketing_sales_data WHERE week_start IN (${placeholders})
  `).get(...weeks);
}

// ─── Available periods for the picker ───────────────────────
function getAvailablePeriods(db) {
  const weeks = db.prepare(
    'SELECT DISTINCT week_start FROM marketing_weekly_data ORDER BY week_start DESC'
  ).all().map(r => r.week_start);

  return {
    weeks,
    total: weeks.length,
    presets: [
      { value: 'last_week', label: '📅 Останній тиждень' },
      { value: 'month', label: '📊 Місяць (4 тижні)' },
      { value: 'quarter', label: '📈 Квартал (13 тижнів)' },
      { value: 'all', label: '🔄 Весь час' },
    ],
  };
}

// ─── Overview KPIs ──────────────────────────────────────────
function getOverview(db, period) {
  const { current, previous, label } = resolveWeeks(db, period);
  if (current.length === 0) return { kpi: {}, period_label: '—' };

  const curTotals = sumWeeklyData(db, current);
  const curSales = sumSalesData(db, current);
  const prevTotals = previous.length > 0 ? sumWeeklyData(db, previous) : null;
  const prevSales = previous.length > 0 ? sumSalesData(db, previous) : null;

  const spend = curTotals?.spend || 0;
  // Use shipped_orders_sum from sales data; fallback to crm_revenue from weekly data
  const revenue = (curSales?.shipped_orders_sum || 0) > 0
    ? curSales.shipped_orders_sum
    : (curTotals?.crm_rev || 0);
  const roas = spend > 0 ? revenue / spend : 0;
  const newClients = (curSales?.new_clients || 0) > 0
    ? curSales.new_clients
    : (curTotals?.new_clients || 0);
  const cac = newClients > 0 ? spend / newClients : 0;
  const orders = curTotals?.orders || 0;

  const pSpend = prevTotals?.spend || 0;
  const pRevenue = (prevSales?.shipped_orders_sum || 0) > 0
    ? prevSales.shipped_orders_sum
    : (prevTotals?.crm_rev || 0);
  const pRoas = pSpend > 0 ? pRevenue / pSpend : 0;
  const pNew = (prevSales?.new_clients || 0) > 0
    ? prevSales.new_clients
    : (prevTotals?.new_clients || 0);
  const pCac = pNew > 0 ? pSpend / pNew : 0;

  function delta(c, p) { return (!p || p === 0) ? 0 : Math.round((c - p) / p * 1000) / 10; }

  // Site data — latest available
  const latestSite = db.prepare(
    'SELECT * FROM marketing_site_data ORDER BY week_start DESC LIMIT 1'
  ).get();

  const lastSync = db.prepare(
    'SELECT * FROM marketing_sync_log ORDER BY created_at DESC LIMIT 1'
  ).get();

  return {
    period_label: label,
    weeks_count: current.length,
    kpi: {
      roas: { value: Math.round(roas * 100) / 100, delta: delta(roas, pRoas) },
      budget: { value: Math.round(spend), delta: delta(spend, pSpend) },
      revenue: { value: Math.round(revenue), delta: delta(revenue, pRevenue) },
      cac: { value: Math.round(cac), delta: delta(cac, pCac), inverse: true },
      new_clients: { value: newClients, delta: delta(newClients, pNew) },
      shipped_orders: { value: curSales?.shipped_orders || 0, delta: delta(curSales?.shipped_orders, prevSales?.shipped_orders) },
      avg_check: { value: Math.round(curSales?.avg_check || 0), delta: delta(curSales?.avg_check, prevSales?.avg_check) },
      ship_conversion: { value: Math.round((curSales?.ship_conversion_rate || 0) * 10) / 10, delta: delta(curSales?.ship_conversion_rate, prevSales?.ship_conversion_rate) },
      incoming_orders: { value: curSales?.incoming_orders || 0, delta: delta(curSales?.incoming_orders, prevSales?.incoming_orders) },
    },
    site: latestSite || null,
    last_sync: lastSync || null,
  };
}

// ─── Channels ───────────────────────────────────────────────
function getChannels(db, period) {
  const { current, previous, label } = resolveWeeks(db, period);
  if (current.length === 0) return { channels: [], period_label: '—' };

  const channels = db.prepare('SELECT * FROM marketing_channels WHERE is_active = 1 ORDER BY sort_order').all();
  const curPh = current.map(() => '?').join(',');
  const prevPh = previous.length > 0 ? previous.map(() => '?').join(',') : null;

  function delta(c, p) { return (!p || p === 0) ? 0 : Math.round((c - p) / p * 1000) / 10; }

  const result = channels.map(ch => {
    const cur = db.prepare(`
      SELECT SUM(ad_spend) as ad_spend, SUM(ad_conversions_value) as ad_conversions_value,
        SUM(crm_revenue) as crm_revenue, SUM(crm_orders) as crm_orders,
        SUM(crm_new_clients) as crm_new_clients, SUM(traffic) as traffic
      FROM marketing_weekly_data WHERE channel_id = ? AND week_start IN (${curPh})
    `).get(ch.id, ...current);

    let prev = null;
    if (prevPh) {
      prev = db.prepare(`
        SELECT SUM(ad_spend) as ad_spend, SUM(ad_conversions_value) as ad_conversions_value,
          SUM(crm_revenue) as crm_revenue, SUM(crm_orders) as crm_orders,
          SUM(crm_new_clients) as crm_new_clients, SUM(traffic) as traffic
        FROM marketing_weekly_data WHERE channel_id = ? AND week_start IN (${prevPh})
      `).get(ch.id, ...previous);
    }

    const spend = cur?.ad_spend || 0;
    const roasAd = spend > 0 ? (cur?.ad_conversions_value || 0) / spend : 0;
    const roasCrm = spend > 0 ? (cur?.crm_revenue || 0) / spend : 0;
    const convRate = (cur?.traffic || 0) > 0 ? (cur?.crm_orders || 0) / cur.traffic * 100 : 0;
    const newPct = (cur?.crm_orders || 0) > 0 ? (cur?.crm_new_clients || 0) / cur.crm_orders * 100 : 0;

    const pSpend = prev?.ad_spend || 0;
    const pRoasAd = pSpend > 0 ? (prev?.ad_conversions_value || 0) / pSpend : 0;
    const pRoasCrm = pSpend > 0 ? (prev?.crm_revenue || 0) / pSpend : 0;
    const pConv = (prev?.traffic || 0) > 0 ? (prev?.crm_orders || 0) / prev.traffic * 100 : 0;

    return {
      id: ch.id, name: ch.name, display_name: ch.display_name,
      platform: ch.platform, icon: ch.icon,
      ad_spend: spend,
      ad_conversions_value: cur?.ad_conversions_value || 0,
      crm_revenue: cur?.crm_revenue || 0,
      crm_orders: cur?.crm_orders || 0,
      crm_new_clients: cur?.crm_new_clients || 0,
      traffic: cur?.traffic || 0,
      roas_ad: Math.round(roasAd * 100) / 100,
      roas_crm: Math.round(roasCrm * 100) / 100,
      conversion: Math.round(convRate * 100) / 100,
      new_clients_pct: Math.round(newPct * 100) / 100,
      deltas: {
        ad_spend: delta(spend, pSpend),
        crm_revenue: delta(cur?.crm_revenue, prev?.crm_revenue),
        roas_ad: delta(roasAd, pRoasAd),
        roas_crm: delta(roasCrm, pRoasCrm),
        traffic: delta(cur?.traffic, prev?.traffic),
        conversion: delta(convRate, pConv),
        crm_new_clients: delta(cur?.crm_new_clients, prev?.crm_new_clients),
      },
    };
  });

  return { channels: result, period_label: label };
}

// ─── Weekly Data (for charts — always returns ALL weeks) ────
function getWeeks(db) {
  const allWeeks = db.prepare(
    'SELECT DISTINCT week_start FROM marketing_weekly_data ORDER BY week_start'
  ).all().map(r => r.week_start);

  const channels = db.prepare('SELECT * FROM marketing_channels WHERE is_active = 1 ORDER BY sort_order').all();

  // Build unified data: one row per week with all channel ROAS as keys
  const weeklyData = allWeeks.map(w => {
    const totals = db.prepare(`
      SELECT SUM(ad_spend) as spend, SUM(crm_revenue) as crm_rev,
        SUM(crm_orders) as orders, SUM(crm_new_clients) as new_clients,
        SUM(traffic) as traffic
      FROM marketing_weekly_data WHERE week_start = ?
    `).get(w);

    const sales = db.prepare('SELECT * FROM marketing_sales_data WHERE week_start = ?').get(w);

    const spend = totals?.spend || 0;
    // Prefer shipped_orders_sum from sales, fallback to crm_revenue from weekly
    const revenue = (sales?.shipped_orders_sum || 0) > 0
      ? sales.shipped_orders_sum
      : (totals?.crm_rev || 0);
    const newClients = (sales?.new_clients || 0) > 0
      ? sales.new_clients
      : (totals?.new_clients || 0);

    const row = {
      week: w,
      week_label: w.slice(5),
      spend: Math.round(spend),
      revenue: Math.round(revenue),
      roas: spend > 0 ? Math.round(revenue / spend * 100) / 100 : 0,
      orders: totals?.orders || 0,
      new_clients: newClients,
      avg_check: sales?.avg_check || 0,
      cac: newClients > 0 ? Math.round(spend / newClients) : 0,
    };

    // Add per-channel ROAS as keys: roas_google_ads, roas_meta_shark, etc.
    for (const ch of channels) {
      const d = db.prepare(
        'SELECT ad_spend, crm_revenue FROM marketing_weekly_data WHERE week_start = ? AND channel_id = ?'
      ).get(w, ch.id);
      const chSpend = d?.ad_spend || 0;
      row[`roas_${ch.name}`] = chSpend > 0 ? Math.round((d?.crm_revenue || 0) / chSpend * 100) / 100 : null;
    }

    return row;
  });

  return {
    weeks: weeklyData,
    channels: channels.map(c => ({ name: c.name, display_name: c.display_name, icon: c.icon })),
  };
}

// ─── Alerts ─────────────────────────────────────────────────
function getAlerts(db) {
  const weeks = db.prepare(
    'SELECT DISTINCT week_start FROM marketing_weekly_data ORDER BY week_start DESC LIMIT 4'
  ).all();

  if (weeks.length < 2) return { alerts: [] };

  const alerts = [];
  const latest = weeks[0].week_start;
  const prev = weeks[1].week_start;

  // ROAS trend
  if (weeks.length >= 3) {
    const roasTrend = weeks.slice(0, 4).map(w => {
      const t = db.prepare('SELECT SUM(ad_spend) as s FROM marketing_weekly_data WHERE week_start = ?').get(w.week_start);
      const sales = db.prepare('SELECT shipped_orders_sum FROM marketing_sales_data WHERE week_start = ?').get(w.week_start);
      const spend = t?.s || 0;
      return spend > 0 ? (sales?.shipped_orders_sum || 0) / spend : 0;
    });

    let fallingWeeks = 0;
    for (let i = 0; i < roasTrend.length - 1; i++) {
      if (roasTrend[i] < roasTrend[i + 1]) fallingWeeks++;
    }
    if (fallingWeeks >= 2) {
      alerts.push({
        severity: fallingWeeks >= 3 ? 'critical' : 'warning',
        type: 'roas_falling',
        title: `ROAS падає ${fallingWeeks + 1} тижні поспіль`,
        message: `Загальний ROAS впав з ${roasTrend[roasTrend.length - 1].toFixed(1)} до ${roasTrend[0].toFixed(1)}. Перевірте ефективність рекламних каналів.`,
        icon: '📉',
      });
    }
  }

  // Per-channel ROAS < 1
  const channels = db.prepare(`
    SELECT mc.display_name, mwd.ad_spend, mwd.crm_revenue
    FROM marketing_weekly_data mwd JOIN marketing_channels mc ON mc.id = mwd.channel_id
    WHERE mwd.week_start = ? AND mwd.ad_spend > 0
  `).all(latest);

  for (const ch of channels) {
    const roas = ch.crm_revenue / ch.ad_spend;
    if (roas < 1) {
      alerts.push({
        severity: roas < 0.5 ? 'critical' : 'warning',
        type: 'low_roas',
        title: `${ch.display_name}: ROAS CRM < 1`,
        message: `ROAS CRM = ${roas.toFixed(2)}. Канал генерує збитки — витрати ${Math.round(ch.ad_spend).toLocaleString()} ₴, продажі ${Math.round(ch.crm_revenue).toLocaleString()} ₴.`,
        icon: '🔴',
      });
    }
  }

  // CAC trend
  const salesLatest = db.prepare('SELECT * FROM marketing_sales_data WHERE week_start = ?').get(latest);
  const salesPrev = db.prepare('SELECT * FROM marketing_sales_data WHERE week_start = ?').get(prev);
  const spendLatest = db.prepare('SELECT SUM(ad_spend) as s FROM marketing_weekly_data WHERE week_start = ?').get(latest);
  const spendPrev = db.prepare('SELECT SUM(ad_spend) as s FROM marketing_weekly_data WHERE week_start = ?').get(prev);

  if (salesLatest?.new_clients > 0 && salesPrev?.new_clients > 0) {
    const cacL = (spendLatest?.s || 0) / salesLatest.new_clients;
    const cacP = (spendPrev?.s || 0) / salesPrev.new_clients;
    const cacDelta = cacP > 0 ? (cacL - cacP) / cacP * 100 : 0;

    if (cacDelta > 30) {
      alerts.push({
        severity: cacDelta > 50 ? 'critical' : 'warning',
        type: 'cac_rising',
        title: `CAC зріс на ${Math.round(cacDelta)}%`,
        message: `Вартість залучення клієнта: ${Math.round(cacL)} ₴ (було ${Math.round(cacP)} ₴).`,
        icon: '💸',
      });
    }
  }

  // Budget growing, revenue falling
  if (spendLatest?.s > 0 && spendPrev?.s > 0 && salesLatest && salesPrev) {
    const sGrowth = (spendLatest.s - spendPrev.s) / spendPrev.s * 100;
    const rGrowth = salesPrev.shipped_orders_sum > 0
      ? (salesLatest.shipped_orders_sum - salesPrev.shipped_orders_sum) / salesPrev.shipped_orders_sum * 100 : 0;
    if (sGrowth > 10 && rGrowth < -5) {
      alerts.push({
        severity: 'warning', type: 'spend_vs_revenue',
        title: 'Бюджет зростає, виручка падає',
        message: `Бюджет +${Math.round(sGrowth)}%, виручка ${Math.round(rGrowth)}%.`,
        icon: '⚠️',
      });
    }
  }

  return { alerts };
}
