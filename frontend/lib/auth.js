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
