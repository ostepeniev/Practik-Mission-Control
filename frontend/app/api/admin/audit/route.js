import { NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDb } from '@/lib/db';

export async function GET(req) {
  const user = getUserFromRequest(req);
  if (!user) return NextResponse.json({ detail: 'Unauthorized' }, { status: 401 });

  // Only developer/owner can view audit logs
  if (!['developer', 'owner'].includes(user.role)) {
    return NextResponse.json({ detail: 'Forbidden' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get('entity_type');
  const action = searchParams.get('action');
  const dateFrom = searchParams.get('date_from');
  const dateTo = searchParams.get('date_to');
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const pageSize = 50;

  const db = getDb();

  let where = 'WHERE 1=1';
  const params = [];

  if (entityType) { where += ' AND a.entity_type = ?'; params.push(entityType); }
  if (action) { where += ' AND a.action = ?'; params.push(action); }
  if (dateFrom) { where += ' AND a.created_at >= ?'; params.push(dateFrom); }
  if (dateTo) { where += ' AND a.created_at <= ?'; params.push(dateTo + ' 23:59:59'); }

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM audit_log a ${where}`).get(...params).cnt;

  const logs = db.prepare(`
    SELECT a.*, u.display_name as user_name
    FROM audit_log a
    LEFT JOIN app_users u ON a.user_id = u.id
    ${where}
    ORDER BY a.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, (page - 1) * pageSize);

  // Get distinct entity types and actions for filter dropdowns
  const entityTypes = db.prepare('SELECT DISTINCT entity_type FROM audit_log WHERE entity_type IS NOT NULL ORDER BY entity_type').all().map(r => r.entity_type);
  const actions = db.prepare('SELECT DISTINCT action FROM audit_log ORDER BY action').all().map(r => r.action);

  return NextResponse.json({
    logs,
    total,
    page,
    page_size: pageSize,
    total_pages: Math.ceil(total / pageSize),
    filters: { entity_types: entityTypes, actions },
  });
}
