import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function GET(req) {
  const user = getUserFromRequest(req);
  if (!user || user.role !== 'developer') return NextResponse.json({ detail: 'Forbidden' }, { status: 403 });

  const db = getDb();
  const widgets = db.prepare('SELECT * FROM app_widgets ORDER BY tab_id, sort_order').all();
  return NextResponse.json({
    widgets: widgets.map(w => ({
      id: w.id, title: w.title, widget_type: w.widget_type,
      is_visible_owner: !!w.is_visible_owner, is_active: !!w.is_active,
      size: w.size, tab_id: w.tab_id
    }))
  });
}
