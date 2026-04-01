import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

// Sync from Google Sheets (CSV export)
const SHEET_ID = '1x9oJmDFnyUxm995mwFj6QUxGaKP2WcUXp1tlkUo9W4M';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`;

export async function POST() {
  const db = getDb();

  try {
    const res = await fetch(CSV_URL, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`Failed to fetch CSV: ${res.status} ${res.statusText}`);
    }

    const csvText = await res.text();
    const result = parseAndSync(db, csvText);

    // Log sync
    db.prepare(
      'INSERT INTO marketing_sync_log (sync_type, status, rows_affected) VALUES (?,?,?)'
    ).run('google_sheets', 'success', result.rowsAffected);

    return NextResponse.json({
      success: true,
      message: `Синхронізовано ${result.rowsAffected} записів`,
      details: result,
    });
  } catch (e) {
    console.error('Sync error:', e);

    db.prepare(
      'INSERT INTO marketing_sync_log (sync_type, status, error_message) VALUES (?,?,?)'
    ).run('google_sheets', 'error', e.message);

    return NextResponse.json({
      success: false,
      error: e.message,
    }, { status: 500 });
  }
}

// ─── CSV Parser ─────────────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  let current = '';
  let inQuotes = false;
  const lines = text.split('\n');

  for (const line of lines) {
    if (inQuotes) {
      current += '\n' + line;
    } else {
      current = line;
    }

    const quoteCount = (current.match(/"/g) || []).length;
    inQuotes = quoteCount % 2 !== 0;

    if (!inQuotes) {
      rows.push(parseCSVLine(current.replace(/\r$/, '')));
      current = '';
    }
  }

  return rows;
}

function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    if (inQuotes) {
      if (line[i] === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += line[i];
      }
    } else {
      if (line[i] === '"') {
        inQuotes = true;
      } else if (line[i] === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += line[i];
      }
    }
  }
  result.push(current.trim());
  return result;
}

// Parse Ukrainian number format: "1 234,56" or "1234" or "1,23%"
function parseNum(str) {
  if (!str || str === '' || str === '#DIV/0!') return 0;
  // Remove % sign
  str = str.replace(/%$/, '');
  // Remove spaces (thousand separators)
  str = str.replace(/\s/g, '');
  // Replace Ukrainian comma with dot for decimals
  str = str.replace(',', '.');
  const n = parseFloat(str);
  return isNaN(n) ? 0 : n;
}

// ─── Sync Logic ─────────────────────────────────────────────
function parseAndSync(db, csvText) {
  const rows = parseCSV(csvText);
  if (rows.length < 5) throw new Error('CSV too short, probably wrong format');

  // Find header row (contains week dates)
  const header = rows[0];
  // Columns: [section, responsible, metric, planned, week1_val, week1_delta, week2_val, ...]
  // Week columns are at indices 4, 6, 8, 10, 12, 14, 16, 18, 20

  // Extract week dates from header
  const weekDates = [];
  for (let i = 4; i < header.length; i += 2) {
    const dateStr = header[i]?.trim();
    if (dateStr && dateStr.match(/\d{2}\.\d{2}/)) {
      weekDates.push(dateStr);
    }
  }

  // Map week labels to ISO dates (year 2026)
  const weeks = weekDates.map(label => {
    const parts = label.split(/\s*-\s*/);
    if (parts.length !== 2) return null;
    const startParts = parts[0].trim().split('.');
    const endParts = parts[1].trim().split('.');
    if (startParts.length < 2 || endParts.length < 2) return null;

    const startMonth = parseInt(startParts[1]);
    const startDay = parseInt(startParts[0]);
    const endMonth = parseInt(endParts[1] || startParts[1]);
    const endDay = parseInt(endParts[0]);

    const start = `2026-${String(startMonth).padStart(2, '0')}-${String(startDay).padStart(2, '0')}`;
    const end = `2026-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;
    return { start, end, label };
  }).filter(Boolean);

  if (weeks.length === 0) throw new Error('Could not parse week dates from header');

  let rowsAffected = 0;

  // --- Parse Sales (B2C) ---
  const salesMetricMap = {
    'К-сть вхідних замовлень B2C': 'incoming_orders',
    'Сума вхідних замовлень  B2C': 'incoming_orders_sum',
    'К-сть відправлених замовлень  B2C': 'shipped_orders',
    'Сума відправлених замовлень  B2C': 'shipped_orders_sum',
    'Конверсія у відправку  B2C': 'ship_conversion_rate',
    'Середній чек відправлених  B2C': 'avg_check',
  };

  const clientMetricMap = {
    'База тотал': 'total_clients',
    'Нових клієнтів': 'new_clients',
    'Старих клієнтів': 'returning_clients',
    'Холодних клієнтів': 'cold_clients',
  };

  // Channel mapping
  const channelMap = {
    'Google ADS': 1,
    'Meta SHARK': 2,
    'Meta BUNTAR': 3,
    'Tik Tok ADS': 4,
    'Viber': 5,
    'Instargam шапка профіля': 6,
    'Google Organic': 7,
  };

  // Channel metric mapping
  const channelMetricMap = {
    'Витрати, грн': 'ad_spend',
    'Цінність конверсій кабінет, грн': 'ad_conversions_value',
    'Сума продажів CRM': 'crm_revenue',
    'К-сть замовлень CRM': 'crm_orders',
    'К-сть замовлень': 'crm_orders',
    'Кількість замовлень': 'crm_orders',
    'Нових клієнтів': 'crm_new_clients',
    'Трафік': 'traffic',
    'Трафік на сайті': 'traffic',
    'К-сть користувачів organic': 'traffic',
    'Сума продажів': 'crm_revenue',
    'сума продажів': 'crm_revenue',
  };

  // Process rows - accumulate data per week
  const salesByWeek = {};
  const channelByWeek = {};
  let currentChannel = null;

  for (const row of rows) {
    const section = row[0]?.trim();
    const metric = row[2]?.trim();

    // Detect current channel section
    if (section && channelMap[section]) {
      currentChannel = channelMap[section];
    }

    if (!metric) continue;

    // Sales metrics (section = Продажі)
    if (salesMetricMap[metric]) {
      const field = salesMetricMap[metric];
      for (let w = 0; w < weeks.length; w++) {
        const colIdx = 4 + w * 2;
        const val = parseNum(row[colIdx]);
        if (val > 0) {
          if (!salesByWeek[weeks[w].start]) salesByWeek[weeks[w].start] = {};
          salesByWeek[weeks[w].start][field] = val;
        }
      }
    }

    // Client metrics
    if (clientMetricMap[metric] && !currentChannel) {
      const field = clientMetricMap[metric];
      for (let w = 0; w < weeks.length; w++) {
        const colIdx = 4 + w * 2;
        const val = parseNum(row[colIdx]);
        if (val > 0) {
          if (!salesByWeek[weeks[w].start]) salesByWeek[weeks[w].start] = {};
          salesByWeek[weeks[w].start][field] = val;
        }
      }
    }

    // Channel metrics
    if (currentChannel && channelMetricMap[metric]) {
      const field = channelMetricMap[metric];
      for (let w = 0; w < weeks.length; w++) {
        const colIdx = 4 + w * 2;
        const val = parseNum(row[colIdx]);
        const key = `${weeks[w].start}_${currentChannel}`;
        if (!channelByWeek[key]) channelByWeek[key] = { week: weeks[w], channel: currentChannel };
        channelByWeek[key][field] = val;
      }
    }
  }

  // Upsert sales data
  const upsertSales = db.prepare(`
    INSERT INTO marketing_sales_data (week_start, incoming_orders, incoming_orders_sum,
      shipped_orders, shipped_orders_sum, ship_conversion_rate, avg_check,
      total_clients, new_clients, returning_clients, cold_clients, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sheets')
    ON CONFLICT(week_start) DO UPDATE SET
      incoming_orders = excluded.incoming_orders,
      incoming_orders_sum = excluded.incoming_orders_sum,
      shipped_orders = excluded.shipped_orders,
      shipped_orders_sum = excluded.shipped_orders_sum,
      ship_conversion_rate = excluded.ship_conversion_rate,
      avg_check = excluded.avg_check,
      total_clients = excluded.total_clients,
      new_clients = excluded.new_clients,
      returning_clients = excluded.returning_clients,
      cold_clients = excluded.cold_clients,
      source = 'sheets',
      updated_at = datetime('now')
  `);

  for (const [weekStart, data] of Object.entries(salesByWeek)) {
    upsertSales.run(
      weekStart,
      data.incoming_orders || 0, data.incoming_orders_sum || 0,
      data.shipped_orders || 0, data.shipped_orders_sum || 0,
      data.ship_conversion_rate || 0, data.avg_check || 0,
      data.total_clients || 0, data.new_clients || 0,
      data.returning_clients || 0, data.cold_clients || 0
    );
    rowsAffected++;
  }

  // Upsert channel data
  const upsertChannel = db.prepare(`
    INSERT INTO marketing_weekly_data (week_start, week_end, channel_id,
      ad_spend, ad_conversions_value, crm_revenue, crm_orders, crm_new_clients, traffic, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sheets')
    ON CONFLICT(week_start, channel_id) DO UPDATE SET
      ad_spend = excluded.ad_spend,
      ad_conversions_value = excluded.ad_conversions_value,
      crm_revenue = excluded.crm_revenue,
      crm_orders = excluded.crm_orders,
      crm_new_clients = excluded.crm_new_clients,
      traffic = excluded.traffic,
      source = 'sheets',
      updated_at = datetime('now')
  `);

  for (const data of Object.values(channelByWeek)) {
    upsertChannel.run(
      data.week.start, data.week.end, data.channel,
      data.ad_spend || 0, data.ad_conversions_value || 0,
      data.crm_revenue || 0, data.crm_orders || 0,
      data.crm_new_clients || 0, data.traffic || 0
    );
    rowsAffected++;
  }

  return {
    rowsAffected,
    weeksFound: weeks.length,
    channelsFound: Object.keys(channelMap).length,
    salesWeeks: Object.keys(salesByWeek).length,
  };
}
