import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function PATCH(req, { params }) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const db = getDb();

  const existing = db.prepare('SELECT * FROM core_complaints WHERE id = ?').get(Number(id));
  if (!existing) return NextResponse.json({ detail: 'Complaint not found' }, { status: 404 });

  const updates = [];
  const values = [];

  if (body.status !== undefined) { updates.push('status = ?'); values.push(body.status); }
  if (body.severity !== undefined) { updates.push('severity = ?'); values.push(body.severity); }
  if (body.resolution !== undefined) { updates.push('resolution = ?'); values.push(body.resolution); }
  if (body.description !== undefined) { updates.push('description = ?'); values.push(body.description); }
  if (body.batch_number !== undefined) { updates.push('batch_number = ?'); values.push(body.batch_number); }

  if (updates.length === 0) {
    return NextResponse.json({ detail: 'No fields to update' }, { status: 400 });
  }

  values.push(Number(id));
  db.prepare(`UPDATE core_complaints SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare(`
    SELECT c.*, p.name as product_name, p.sku as product_sku, p.brand as product_brand
    FROM core_complaints c
    JOIN core_products p ON c.product_id = p.id
    WHERE c.id = ?
  `).get(Number(id));

  return NextResponse.json(updated);
}

export async function DELETE(req, { params }) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  const existing = db.prepare('SELECT * FROM core_complaints WHERE id = ?').get(Number(id));
  if (!existing) return NextResponse.json({ detail: 'Complaint not found' }, { status: 404 });

  db.prepare('DELETE FROM core_complaints WHERE id = ?').run(Number(id));
  return NextResponse.json({ ok: true });
}
