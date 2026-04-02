import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'practik-secret-key-change-me';

function getUser(request) {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(auth.slice(7), JWT_SECRET);
  } catch { return null; }
}

export async function GET(request) {
  const user = getUser(request);
  if (!user || user.role !== 'developer') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  const users = db.prepare('SELECT id, username, display_name, role FROM app_users').all();

  return NextResponse.json({ users });
}
