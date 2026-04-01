import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function GET(req, { params }) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  const conv = db.prepare(
    'SELECT * FROM ai_conversations WHERE id = ? AND user_id = ?'
  ).get(Number(id), user.id);
  if (!conv) return NextResponse.json({ detail: 'Not found' }, { status: 404 });

  const messages = db.prepare(
    'SELECT id, role, content, created_at FROM ai_messages WHERE conversation_id = ? AND role IN (?, ?) ORDER BY id'
  ).all(Number(id), 'user', 'assistant');

  return NextResponse.json({ conversation: conv, messages });
}

export async function DELETE(req, { params }) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const db = getDb();

  db.prepare('DELETE FROM ai_tool_logs WHERE conversation_id = ?').run(Number(id));
  db.prepare('DELETE FROM ai_messages WHERE conversation_id = ?').run(Number(id));
  db.prepare('DELETE FROM ai_conversations WHERE id = ? AND user_id = ?').run(Number(id), user.id);

  return NextResponse.json({ ok: true });
}
