import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';

export async function GET(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({
    id: user.id, username: user.username,
    display_name: user.display_name, role: user.role
  });
}
