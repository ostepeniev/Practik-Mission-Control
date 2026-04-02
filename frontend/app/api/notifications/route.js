import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

// GET: list notifications for current user
export async function GET(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get('unread') === 'true';
  const limit = Math.min(50, parseInt(searchParams.get('limit') || '20'));

  const db = getDb();

  let where = 'WHERE (n.user_id = ? OR n.user_id IS NULL)';
  const params = [user.id];
  if (unreadOnly) { where += ' AND n.is_read = 0'; }

  const notifications = db.prepare(`
    SELECT n.* FROM notifications n
    ${where}
    ORDER BY n.created_at DESC
    LIMIT ?
  `).all(...params, limit);

  const unreadCount = db.prepare(
    'SELECT COUNT(*) as cnt FROM notifications WHERE (user_id = ? OR user_id IS NULL) AND is_read = 0'
  ).get(user.id).cnt;

  return NextResponse.json({ notifications, unread_count: unreadCount });
}

// POST: create a notification (system/admin use)
export async function POST(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { title, body, type, severity, link, source, user_id } = await req.json();
  if (!title) return NextResponse.json({ detail: 'title is required' }, { status: 400 });

  const db = getDb();
  const result = db.prepare(
    'INSERT INTO notifications (user_id, type, severity, title, body, link, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(user_id || null, type || 'alert', severity || 'info', title, body || '', link || '', source || 'system');

  return NextResponse.json({ id: result.lastInsertRowid, success: true });
}

// PATCH: mark notifications as read
export async function PATCH(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const { ids, mark_all } = await req.json();
  const db = getDb();

  if (mark_all) {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE (user_id = ? OR user_id IS NULL) AND is_read = 0')
      .run(user.id);
  } else if (ids?.length) {
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`UPDATE notifications SET is_read = 1 WHERE id IN (${placeholders})`).run(...ids);
  }

  return NextResponse.json({ success: true });
}
