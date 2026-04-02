import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET || 'practik-secret-key-change-me';

function getUser(request) {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(auth.slice(7), JWT_SECRET);
  } catch { return null; }
}

export async function POST(request) {
  const user = getUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const db = getDb();
  const body = await request.json();
  const { target_user_id, current_password, new_password } = body;

  if (!new_password || new_password.length < 4) {
    return NextResponse.json({ error: 'Пароль має бути мінімум 4 символи' }, { status: 400 });
  }

  // Self-change: user changes their own password
  if (!target_user_id || target_user_id === user.sub) {
    if (!current_password) {
      return NextResponse.json({ error: 'Введіть поточний пароль' }, { status: 400 });
    }

    const dbUser = db.prepare('SELECT * FROM app_users WHERE id = ?').get(user.sub);
    if (!dbUser) {
      return NextResponse.json({ error: 'Користувач не знайдений' }, { status: 404 });
    }

    const valid = bcrypt.compareSync(current_password, dbUser.password_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Невірний поточний пароль' }, { status: 403 });
    }

    const hash = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE app_users SET password_hash = ? WHERE id = ?').run(hash, user.sub);

    return NextResponse.json({ success: true, message: 'Пароль змінено' });
  }

  // Admin-change: developer changes another user's password
  if (user.role !== 'developer') {
    return NextResponse.json({ error: 'Тільки розробник може змінювати паролі інших' }, { status: 403 });
  }

  const targetUser = db.prepare('SELECT * FROM app_users WHERE id = ?').get(target_user_id);
  if (!targetUser) {
    return NextResponse.json({ error: 'Користувач не знайдений' }, { status: 404 });
  }

  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE app_users SET password_hash = ? WHERE id = ?').run(hash, target_user_id);

  return NextResponse.json({
    success: true,
    message: `Пароль для ${targetUser.display_name} змінено`,
  });
}
