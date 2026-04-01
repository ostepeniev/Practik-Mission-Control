/**
 * Audit Trail — логування змін для Practik Dashboard.
 * 
 * Записує: зміни цін, собівартості, статусів скарг, auth events.
 * Кожен запис містить: хто, коли, що, стара/нова значення.
 */
import { getDb } from './db';

/**
 * Записати audit event.
 * 
 * @param {Object} params
 * @param {string} params.action - Тип дії: 'create', 'update', 'delete', 'login', 'logout'
 * @param {string} params.entityType - Тип сутності: 'order', 'product', 'complaint', 'cost_price', 'user'
 * @param {string|number} [params.entityId] - ID сутності
 * @param {number} [params.userId] - ID користувача що зробив дію
 * @param {string} [params.userName] - Ім'я користувача
 * @param {Object} [params.oldValue] - Попереднє значення (для update)
 * @param {Object} [params.newValue] - Нове значення (для create/update)
 * @param {string} [params.description] - Людино-читабельний опис
 * @param {string} [params.source] - Джерело: 'user', 'crm_sync', 'system', 'ai'
 */
export function logAudit({
  action,
  entityType,
  entityId = null,
  userId = null,
  userName = null,
  oldValue = null,
  newValue = null,
  description = null,
  source = 'system',
}) {
  const db = getDb();

  // Ensure table exists (idempotent)
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      user_id INTEGER,
      user_name TEXT,
      old_value TEXT,
      new_value TEXT,
      description TEXT,
      source TEXT DEFAULT 'system',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.prepare(`
    INSERT INTO audit_log (action, entity_type, entity_id, user_id, user_name, old_value, new_value, description, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    action,
    entityType,
    entityId ? String(entityId) : null,
    userId,
    userName,
    oldValue ? JSON.stringify(oldValue) : null,
    newValue ? JSON.stringify(newValue) : null,
    description,
    source,
  );
}

/**
 * Отримати audit log записи з фільтрацією.
 */
export function getAuditLog({
  entityType = null,
  entityId = null,
  userId = null,
  action = null,
  dateFrom = null,
  dateTo = null,
  limit = 50,
  offset = 0,
} = {}) {
  const db = getDb();

  // Ensure table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      user_id INTEGER,
      user_name TEXT,
      old_value TEXT,
      new_value TEXT,
      description TEXT,
      source TEXT DEFAULT 'system',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  let where = '1=1';
  const params = [];

  if (entityType) { where += ' AND entity_type = ?'; params.push(entityType); }
  if (entityId) { where += ' AND entity_id = ?'; params.push(String(entityId)); }
  if (userId) { where += ' AND user_id = ?'; params.push(userId); }
  if (action) { where += ' AND action = ?'; params.push(action); }
  if (dateFrom) { where += ' AND created_at >= ?'; params.push(dateFrom); }
  if (dateTo) { where += ' AND date(created_at) <= ?'; params.push(dateTo); }

  params.push(limit, offset);

  const rows = db.prepare(`
    SELECT * FROM audit_log WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...params);

  const total = db.prepare(`
    SELECT COUNT(*) as count FROM audit_log WHERE ${where}
  `).get(...params.slice(0, -2)); // Remove limit/offset for count

  return {
    items: rows.map(r => ({
      ...r,
      old_value: r.old_value ? JSON.parse(r.old_value) : null,
      new_value: r.new_value ? JSON.parse(r.new_value) : null,
    })),
    total: total.count,
  };
}
