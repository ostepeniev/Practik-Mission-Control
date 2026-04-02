import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { getDb } from './db';

const JWT_SECRET = process.env.JWT_SECRET || 'practik-jwt-secret-change-in-production';
const JWT_EXPIRES = '24h';

export function createToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function getUserFromRequest(req) {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) return null;
  const payload = verifyToken(auth.slice(7));
  if (!payload) return null;
  const db = getDb();
  return db.prepare('SELECT * FROM app_users WHERE id = ? AND is_active = 1').get(payload.sub);
}

export function authenticateUser(username, password) {
  const db = getDb();
  const user = db.prepare('SELECT * FROM app_users WHERE username = ?').get(username);
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.password_hash)) return null;
  return user;
}

/**
 * Role hierarchy: developer > owner > manager > viewer
 * Returns null if allowed, or a NextResponse 403 if not.
 */
const ROLE_LEVELS = { developer: 100, owner: 80, manager: 50, viewer: 10 };

export function checkRole(user, requiredRole) {
  if (!user) return false;
  const userLevel = ROLE_LEVELS[user.role] || 0;
  const requiredLevel = ROLE_LEVELS[requiredRole] || 0;
  return userLevel >= requiredLevel;
}

/**
 * For 'manager' role: get their manager_id to auto-filter data.
 * Returns null for owner/developer (they see all data).
 */
export function getDataScope(user) {
  if (!user) return null;
  if (['developer', 'owner'].includes(user.role)) return { scope: 'all' };
  // Manager sees only their own data
  const db = getDb();
  const manager = db.prepare('SELECT id FROM core_managers WHERE name = ?').get(user.display_name);
  return { scope: 'manager', manager_id: manager?.id || null };
}
