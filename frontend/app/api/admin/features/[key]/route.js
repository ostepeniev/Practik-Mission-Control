import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function PATCH(req, { params }) {
  const user = getUserFromRequest(req);
  if (!user || user.role !== 'developer') return NextResponse.json({ detail: 'Forbidden' }, { status: 403 });

  const { key } = await params;
  const { is_enabled } = await req.json();
  const db = getDb();
  db.prepare('UPDATE app_feature_flags SET is_enabled = ? WHERE feature_key = ?').run(is_enabled ? 1 : 0, key);
  return NextResponse.json({ ok: true, key, is_enabled });
}
