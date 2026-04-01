import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function GET(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const conversations = db.prepare(
    'SELECT id, title, created_at, updated_at FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50'
  ).all(user.id);

  return NextResponse.json({ conversations });
}

export async function POST(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { title } = await req.json();
  const db = getDb();
  const result = db.prepare(
    'INSERT INTO ai_conversations (user_id, title) VALUES (?, ?)'
  ).run(user.id, title || 'Новий діалог');

  return NextResponse.json({
    id: result.lastInsertRowid,
    title: title || 'Новий діалог',
  }, { status: 201 });
}
