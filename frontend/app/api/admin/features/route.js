import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function GET(req) {
  const user = getUserFromRequest(req);
  if (!user || user.role !== 'developer') return NextResponse.json({ detail: 'Forbidden' }, { status: 403 });

  const db = getDb();
  const features = db.prepare('SELECT * FROM app_feature_flags').all();
  return NextResponse.json({
    features: features.map(f => ({ id: f.id, key: f.feature_key, is_enabled: !!f.is_enabled, description: f.description }))
  });
}
