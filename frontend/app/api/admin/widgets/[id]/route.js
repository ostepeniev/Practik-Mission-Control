import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function PATCH(req, { params }) {
  const user = getUserFromRequest(req);
  if (!user || user.role !== 'developer') return NextResponse.json({ detail: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const { is_visible_owner } = await req.json();
  const db = getDb();
  db.prepare('UPDATE app_widgets SET is_visible_owner = ? WHERE id = ?').run(is_visible_owner ? 1 : 0, id);
  return NextResponse.json({ ok: true, id: parseInt(id), is_visible_owner });
}
