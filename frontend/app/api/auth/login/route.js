import { NextResponse } from 'next/server';
import { authenticateUser, createToken } from '@/lib/auth';

export async function POST(req) {
  const { username, password } = await req.json();
  const user = authenticateUser(username, password);
  if (!user) {
    return NextResponse.json({ detail: 'Невірний логін або пароль' }, { status: 401 });
  }
  const token = createToken(user);
  return NextResponse.json({
    token,
    user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role }
  });
}
