import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const view = searchParams.get('view') || 'overview'; // overview | channels | weeks | alerts

  const db = getDb();

  try {
    if (view === 'overview') {
      return NextResponse.json(getOverview(db));
    }
    if (view === 'channels') {
      return NextResponse.json(getChannels(db));
    }
    if (view === 'weeks') {
      return NextResponse.json(getWeeks(db));
    }
    if (view === 'alerts') {
      return NextResponse.json(getAlerts(db));
    }
    return NextResponse.json({ error: 'Unknown view' }, { status: 400 });
  } catch (e) {
    console.error('Marketing API error:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ─── Overview KPIs ──────────────────────────────────────────
function getOverview(db) {
  const weeks = db.prepare(`
    SELECT DISTINCT week_start FROM marketing_weekly_data ORDER BY week_start DESC LIMIT 2
  `).all();

  if (weeks.length === 0) return { kpi: {}, latest_week: null };

  const latest = weeks[0].week_start;
  const prev = weeks.length > 1 ? weeks[1].week_start : null;

  // Totals for latest week
  const latestTotals = db.prepare(`
    SELECT
      SUM(ad_spend) as total_spend,
      SUM(crm_revenue) as total_revenue,
      SUM(crm_orders) as total_orders,
      SUM(crm_new_clients) as total_new_clients,
      SUM(traffic) as total_traffic
    FROM marketing_weekly_data WHERE week_start = ?
  `).get(latest);

  const latestSales = db.prepare(`
    SELECT * FROM marketing_sales_data WHERE week_start = ?
  `).get(latest);

  // Previous week for deltas
  let prevTotals = null;
  let prevSales = null;
  if (prev) {
    prevTotals = db.prepare(`
      SELECT SUM(ad_spend) as total_spend, SUM(crm_revenue) as total_revenue,
        SUM(crm_orders) as total_orders, SUM(crm_new_clients) as total_new_clients
      FROM marketing_weekly_data WHERE week_start = ?
    `).get(prev);
    prevSales = db.prepare(`SELECT * FROM marketing_sales_data WHERE week_start = ?`).get(prev);
  }

  const totalSpend = latestTotals?.total_spend || 0;
  const totalRevenue = latestSales?.shipped_orders_sum || 0;
  const roas = totalSpend > 0 ? totalRevenue / totalSpend : 0;
  const newClients = latestSales?.new_clients || 0;
  const cac = newClients > 0 ? totalSpend / newClients : 0;
  const totalOrders = latestTotals?.total_orders || 0;
  const cpl = totalOrders > 0 ? totalSpend / totalOrders : 0;

  const prevSpend = prevTotals?.total_spend || 0;
  const prevRevenue = prevSales?.shipped_orders_sum || 0;
  const prevRoas = prevSpend > 0 ? prevRevenue / prevSpend : 0;
  const prevNewClients = prevSales?.new_clients || 0;
  const prevCac = prevNewClients > 0 ? prevSpend / prevNewClients : 0;

  function delta(curr, prev) {
    if (!prev || prev === 0) return 0;
    return Math.round((curr - prev) / prev * 1000) / 10;
  }

  // Site data
  const latestSite = db.prepare(
    'SELECT * FROM marketing_site_data WHERE week_start <= ? ORDER BY week_start DESC LIMIT 1'
  ).get(latest);

  // Last sync
  const lastSync = db.prepare(
    'SELECT * FROM marketing_sync_log ORDER BY created_at DESC LIMIT 1'
  ).get();

  return {
    latest_week: latest,
    kpi: {
      roas: { value: Math.round(roas * 100) / 100, delta: delta(roas, prevRoas), format: 'number' },
      budget: { value: Math.round(totalSpend), delta: delta(totalSpend, prevSpend), format: 'currency' },
      revenue: { value: Math.round(totalRevenue), delta: delta(totalRevenue, prevRevenue), format: 'currency' },
      cac: { value: Math.round(cac * 100) / 100, delta: delta(cac, prevCac), format: 'currency', inverse: true },
      cpl: { value: Math.round(cpl * 100) / 100, delta: delta(cpl, prevSpend > 0 ? prevSpend / (prevTotals?.total_orders || 1) : 0), format: 'currency', inverse: true },
      new_clients: { value: newClients, delta: delta(newClients, prevNewClients), format: 'number' },
      shipped_orders: { value: latestSales?.shipped_orders || 0, delta: delta(latestSales?.shipped_orders, prevSales?.shipped_orders), format: 'number' },
      avg_check: { value: latestSales?.avg_check || 0, delta: delta(latestSales?.avg_check, prevSales?.avg_check), format: 'currency' },
      ship_conversion: { value: latestSales?.ship_conversion_rate || 0, delta: delta(latestSales?.ship_conversion_rate, prevSales?.ship_conversion_rate), format: 'percent' },
    },
    site: latestSite || null,
    last_sync: lastSync || null,
  };
}

// ─── Channels ───────────────────────────────────────────────
function getChannels(db) {
  const weeks = db.prepare(`
    SELECT DISTINCT week_start FROM marketing_weekly_data ORDER BY week_start DESC LIMIT 2
  `).all();

  if (weeks.length === 0) return { channels: [], latest_week: null };
  const latest = weeks[0].week_start;
  const prev = weeks.length > 1 ? weeks[1].week_start : null;

  const channels = db.prepare(`
    SELECT mc.id, mc.name, mc.display_name, mc.platform, mc.icon, mc.sort_order,
      mwd.ad_spend, mwd.ad_conversions_value, mwd.crm_revenue, mwd.crm_orders,
      mwd.crm_new_clients, mwd.traffic
    FROM marketing_channels mc
    LEFT JOIN marketing_weekly_data mwd ON mwd.channel_id = mc.id AND mwd.week_start = ?
    WHERE mc.is_active = 1
    ORDER BY mc.sort_order
  `).all(latest);

  let prevData = {};
  if (prev) {
    db.prepare(`SELECT * FROM marketing_weekly_data WHERE week_start = ?`).all(prev)
      .forEach(r => { prevData[r.channel_id] = r; });
  }

  function delta(curr, prev) {
    if (!prev || prev === 0) return 0;
    return Math.round((curr - prev) / prev * 1000) / 10;
  }

  return {
    latest_week: latest,
    channels: channels.map(ch => {
      const p = prevData[ch.id] || {};
      const roasAd = ch.ad_spend > 0 ? ch.ad_conversions_value / ch.ad_spend : 0;
      const roasCrm = ch.ad_spend > 0 ? ch.crm_revenue / ch.ad_spend : 0;
      const prevRoasAd = (p.ad_spend || 0) > 0 ? (p.ad_conversions_value || 0) / p.ad_spend : 0;
      const prevRoasCrm = (p.ad_spend || 0) > 0 ? (p.crm_revenue || 0) / p.ad_spend : 0;
      const conv = ch.traffic > 0 ? ch.crm_orders / ch.traffic * 100 : 0;
      const prevConv = (p.traffic || 0) > 0 ? (p.crm_orders || 0) / p.traffic * 100 : 0;
      const newPct = ch.crm_orders > 0 ? ch.crm_new_clients / ch.crm_orders * 100 : 0;

      return {
        ...ch,
        roas_ad: Math.round(roasAd * 100) / 100,
        roas_crm: Math.round(roasCrm * 100) / 100,
        conversion: Math.round(conv * 100) / 100,
        new_clients_pct: Math.round(newPct * 100) / 100,
        deltas: {
          ad_spend: delta(ch.ad_spend, p.ad_spend),
          crm_revenue: delta(ch.crm_revenue, p.crm_revenue),
          roas_ad: delta(roasAd, prevRoasAd),
          roas_crm: delta(roasCrm, prevRoasCrm),
          traffic: delta(ch.traffic, p.traffic),
          conversion: delta(conv, prevConv),
          crm_new_clients: delta(ch.crm_new_clients, p.crm_new_clients),
        }
      };
    }),
  };
}

// ─── Weekly Data (for charts) ───────────────────────────────
function getWeeks(db) {
  const allWeeks = db.prepare(`
    SELECT DISTINCT week_start FROM marketing_weekly_data ORDER BY week_start
  `).all().map(r => r.week_start);

  // Per-week totals for charts
  const weeklyTotals = allWeeks.map(w => {
    const totals = db.prepare(`
      SELECT SUM(ad_spend) as spend, SUM(crm_revenue) as revenue,
        SUM(crm_orders) as orders, SUM(crm_new_clients) as new_clients,
        SUM(traffic) as traffic
      FROM marketing_weekly_data WHERE week_start = ?
    `).get(w);

    const sales = db.prepare(`SELECT * FROM marketing_sales_data WHERE week_start = ?`).get(w);

    const spend = totals?.spend || 0;
    const revenue = sales?.shipped_orders_sum || 0;

    return {
      week: w,
      week_label: w.slice(5), // "01-26"
      spend: Math.round(spend),
      revenue: Math.round(revenue),
      roas: spend > 0 ? Math.round(revenue / spend * 100) / 100 : 0,
      orders: totals?.orders || 0,
      new_clients: sales?.new_clients || 0,
      avg_check: sales?.avg_check || 0,
      cac: (sales?.new_clients || 0) > 0 ? Math.round(spend / sales.new_clients) : 0,
    };
  });

  // Per-channel ROAS trends
  const channels = db.prepare('SELECT * FROM marketing_channels WHERE is_active = 1 ORDER BY sort_order').all();
  const channelTrends = {};

  for (const ch of channels) {
    channelTrends[ch.name] = allWeeks.map(w => {
      const d = db.prepare(
        'SELECT ad_spend, crm_revenue FROM marketing_weekly_data WHERE week_start = ? AND channel_id = ?'
      ).get(w, ch.id);
      const spend = d?.ad_spend || 0;
      return {
        week: w,
        week_label: w.slice(5),
        roas: spend > 0 ? Math.round((d?.crm_revenue || 0) / spend * 100) / 100 : null,
        spend: Math.round(spend),
        revenue: Math.round(d?.crm_revenue || 0),
      };
    });
  }

  return { weeks: weeklyTotals, channel_trends: channelTrends, channels: channels.map(c => ({ name: c.name, display_name: c.display_name, icon: c.icon })) };
}

// ─── Alerts ─────────────────────────────────────────────────
function getAlerts(db) {
  const weeks = db.prepare(`
    SELECT DISTINCT week_start FROM marketing_weekly_data ORDER BY week_start DESC LIMIT 4
  `).all();

  if (weeks.length < 2) return { alerts: [] };

  const alerts = [];
  const latest = weeks[0].week_start;
  const prev = weeks[1].week_start;

  // Check overall ROAS trend (falling for 3+ weeks?)
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

  // Check per-channel: any channel with ROAS CRM < 1?
  const channels = db.prepare(`
    SELECT mc.display_name, mwd.ad_spend, mwd.crm_revenue
    FROM marketing_weekly_data mwd
    JOIN marketing_channels mc ON mc.id = mwd.channel_id
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

  // Check CAC trend
  const salesLatest = db.prepare('SELECT * FROM marketing_sales_data WHERE week_start = ?').get(latest);
  const salesPrev = db.prepare('SELECT * FROM marketing_sales_data WHERE week_start = ?').get(prev);
  const spendLatest = db.prepare('SELECT SUM(ad_spend) as s FROM marketing_weekly_data WHERE week_start = ?').get(latest);
  const spendPrev = db.prepare('SELECT SUM(ad_spend) as s FROM marketing_weekly_data WHERE week_start = ?').get(prev);

  if (salesLatest?.new_clients > 0 && salesPrev?.new_clients > 0) {
    const cacLatest = (spendLatest?.s || 0) / salesLatest.new_clients;
    const cacPrev = (spendPrev?.s || 0) / salesPrev.new_clients;
    const cacDelta = cacPrev > 0 ? (cacLatest - cacPrev) / cacPrev * 100 : 0;

    if (cacDelta > 30) {
      alerts.push({
        severity: cacDelta > 50 ? 'critical' : 'warning',
        type: 'cac_rising',
        title: `CAC зріс на ${Math.round(cacDelta)}%`,
        message: `Вартість залучення клієнта: ${Math.round(cacLatest)} ₴ (було ${Math.round(cacPrev)} ₴). Зростання бюджету не компенсується новими клієнтами.`,
        icon: '💸',
      });
    }
  }

  // Check budget growing but revenue falling
  if (spendLatest?.s > 0 && spendPrev?.s > 0 && salesLatest && salesPrev) {
    const spendGrowth = (spendLatest.s - spendPrev.s) / spendPrev.s * 100;
    const revGrowth = salesPrev.shipped_orders_sum > 0
      ? (salesLatest.shipped_orders_sum - salesPrev.shipped_orders_sum) / salesPrev.shipped_orders_sum * 100
      : 0;

    if (spendGrowth > 10 && revGrowth < -5) {
      alerts.push({
        severity: 'warning',
        type: 'spend_vs_revenue',
        title: 'Бюджет зростає, виручка падає',
        message: `Бюджет +${Math.round(spendGrowth)}%, виручка ${Math.round(revGrowth)}%. Перевірте конверсію та якість трафіку.`,
        icon: '⚠️',
      });
    }
  }

  return { alerts };
}
