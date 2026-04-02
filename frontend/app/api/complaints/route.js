import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { classifyComplaint, getClassificationTypes } from '@/lib/complaint-classifier';

export async function GET(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const db = getDb();

  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = searchParams.get('date_from') || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
  const dateTo = searchParams.get('date_to') || today;
  const productId = searchParams.get('product_id');
  const status = searchParams.get('status');
  const severity = searchParams.get('severity');
  const classification = searchParams.get('classification');

  let where = 'WHERE c.complaint_date >= ? AND c.complaint_date <= ?';
  const params = [dateFrom, dateTo];

  if (productId) { where += ' AND c.product_id = ?'; params.push(Number(productId)); }
  if (status) { where += ' AND c.status = ?'; params.push(status); }
  if (severity) { where += ' AND c.severity = ?'; params.push(severity); }
  if (classification) { where += ' AND c.ai_classification = ?'; params.push(classification); }

  const complaints = db.prepare(`
    SELECT c.*, p.name as product_name, p.sku as product_sku, p.brand as product_brand
    FROM core_complaints c
    JOIN core_products p ON c.product_id = p.id
    ${where}
    ORDER BY c.complaint_date DESC, c.id DESC
  `).all(...params);

  return NextResponse.json({
    complaints,
    total: complaints.length,
    classification_types: getClassificationTypes(),
  });
}

export async function POST(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { product_id, complaint_date, batch_number, source, description, severity } = body;

  if (!product_id || !complaint_date || !description) {
    return NextResponse.json({ detail: 'product_id, complaint_date, and description are required' }, { status: 400 });
  }

  // AI Classification
  const classification = classifyComplaint(description);

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO core_complaints (product_id, complaint_date, batch_number, source, description, status, severity, ai_classification)
    VALUES (?, ?, ?, ?, ?, 'new', ?, ?)
  `).run(product_id, complaint_date, batch_number || null, source || 'клієнт', description, severity || 'medium', classification.type);

  const complaint = db.prepare(`
    SELECT c.*, p.name as product_name, p.sku as product_sku, p.brand as product_brand
    FROM core_complaints c
    JOIN core_products p ON c.product_id = p.id
    WHERE c.id = ?
  `).get(result.lastInsertRowid);

  // Create notification for high-severity complaints
  if (severity === 'high' || severity === 'critical') {
    db.prepare(
      "INSERT INTO notifications (type, severity, title, body, link, source) VALUES (?, ?, ?, ?, ?, ?)"
    ).run('complaint', severity, `📢 Нова скарга: ${classification.icon} ${classification.label}`,
      description.slice(0, 100), `/complaints`, 'complaint');
  }

  return NextResponse.json({
    ...complaint,
    ai_classification_detail: classification,
  }, { status: 201 });
}
