import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function GET(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const db = getDb();

  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = searchParams.get('date_from') || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const dateTo = searchParams.get('date_to') || today;

  // ─── KPI: total complaints in period vs previous period ───
  const daysDiff = Math.ceil((new Date(dateTo) - new Date(dateFrom)) / 86400000) + 1;
  const prevTo = new Date(new Date(dateFrom) - 86400000).toISOString().slice(0, 10);
  const prevFrom = new Date(new Date(dateFrom) - daysDiff * 86400000).toISOString().slice(0, 10);

  const current = db.prepare(
    'SELECT COUNT(*) as cnt FROM core_complaints WHERE complaint_date >= ? AND complaint_date <= ?'
  ).get(dateFrom, dateTo);
  const prev = db.prepare(
    'SELECT COUNT(*) as cnt FROM core_complaints WHERE complaint_date >= ? AND complaint_date <= ?'
  ).get(prevFrom, prevTo);

  const currentCount = current.cnt;
  const prevCount = prev.cnt;
  const deltaPct = prevCount > 0 ? ((currentCount - prevCount) / prevCount) * 100 : (currentCount > 0 ? 100 : 0);

  // ─── By status ───
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) as cnt 
    FROM core_complaints 
    WHERE complaint_date >= ? AND complaint_date <= ?
    GROUP BY status
  `).all(dateFrom, dateTo);

  // ─── By severity ───
  const bySeverity = db.prepare(`
    SELECT severity, COUNT(*) as cnt 
    FROM core_complaints 
    WHERE complaint_date >= ? AND complaint_date <= ?
    GROUP BY severity
  `).all(dateFrom, dateTo);

  // ─── Daily timeline ───
  const timeline = db.prepare(`
    SELECT complaint_date as date, COUNT(*) as count
    FROM core_complaints
    WHERE complaint_date >= ? AND complaint_date <= ?
    GROUP BY complaint_date
    ORDER BY complaint_date
  `).all(dateFrom, dateTo);

  // ─── Cluster detection: 3+ complaints on same product within 7-day windows ───
  const productComplaints = db.prepare(`
    SELECT c.product_id, c.complaint_date, c.batch_number, c.id, c.description, c.severity,
           p.name as product_name, p.sku as product_sku
    FROM core_complaints c
    JOIN core_products p ON c.product_id = p.id
    WHERE c.complaint_date >= ? AND c.complaint_date <= ?
    ORDER BY c.product_id, c.complaint_date
  `).all(dateFrom, dateTo);

  // Group by product
  const byProduct = {};
  for (const row of productComplaints) {
    if (!byProduct[row.product_id]) byProduct[row.product_id] = [];
    byProduct[row.product_id].push(row);
  }

  const clusters = [];
  for (const [productId, complaints] of Object.entries(byProduct)) {
    if (complaints.length < 3) continue;

    // Sliding window: check if 3+ complaints fall within any 7-day window
    for (let i = 0; i < complaints.length; i++) {
      const windowStart = new Date(complaints[i].complaint_date);
      const windowEnd = new Date(windowStart.getTime() + 7 * 86400000);
      const windowComplaints = complaints.filter(c => {
        const d = new Date(c.complaint_date);
        return d >= windowStart && d <= windowEnd;
      });

      if (windowComplaints.length >= 3) {
        // Check if we already have a cluster for this product with overlapping dates
        const existing = clusters.find(cl => cl.product_id === Number(productId) &&
          Math.abs(new Date(cl.date_from).getTime() - windowStart.getTime()) < 7 * 86400000);
        if (existing) continue;

        const batches = [...new Set(windowComplaints.map(c => c.batch_number).filter(Boolean))];
        const highSeverity = windowComplaints.filter(c => c.severity === 'high').length;

        clusters.push({
          product_id: Number(productId),
          product_name: complaints[0].product_name,
          product_sku: complaints[0].product_sku,
          complaint_count: windowComplaints.length,
          date_from: complaints[i].complaint_date,
          date_to: windowComplaints[windowComplaints.length - 1].complaint_date,
          batches,
          high_severity_count: highSeverity,
          severity: highSeverity >= 2 ? 'critical' : windowComplaints.length >= 4 ? 'critical' : 'warning',
          complaint_ids: windowComplaints.map(c => c.id),
        });
        break; // One cluster per product per window
      }
    }
  }

  // Sort clusters: critical first, then by complaint count
  clusters.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
    return b.complaint_count - a.complaint_count;
  });

  // ─── Top complained products ───
  const topProducts = db.prepare(`
    SELECT c.product_id, p.name as product_name, p.sku, COUNT(*) as complaint_count,
           SUM(CASE WHEN c.severity = 'high' THEN 1 ELSE 0 END) as high_count
    FROM core_complaints c
    JOIN core_products p ON c.product_id = p.id
    WHERE c.complaint_date >= ? AND c.complaint_date <= ?
    GROUP BY c.product_id
    ORDER BY complaint_count DESC
    LIMIT 10
  `).all(dateFrom, dateTo);

  return NextResponse.json({
    kpi: {
      total: currentCount,
      delta_pct: Math.round(deltaPct * 10) / 10,
      prev_total: prevCount,
    },
    by_status: byStatus,
    by_severity: bySeverity,
    timeline,
    clusters,
    top_products: topProducts,
  });
}
