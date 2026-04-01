import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function GET(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const cats = db.prepare('SELECT * FROM core_product_categories').all();
  return NextResponse.json({
    categories: cats.map(c => ({ id: c.id, name: c.name }))
  });
}
