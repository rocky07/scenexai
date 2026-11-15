import crypto from 'node:crypto';
import { db, save } from './store.js';

const SESSION_DAYS = 7;

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  db().sessions.push({ token, userId, expires });
  save();
  return token;
}

export function deleteSession(token) {
  const state = db();
  state.sessions = state.sessions.filter((s) => s.token !== token);
  save();
}

// Express middleware: expects "Authorization: Bearer <token>" and sets req.user / req.company.
export function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  const state = db();
  const session = state.sessions.find((s) => s.token === token && s.expires > Date.now());
  if (!session) return res.status(401).json({ error: 'Please log in again.' });

  const user = state.users.find((u) => u.id === session.userId);
  if (!user) return res.status(401).json({ error: 'Please log in again.' });

  req.token = token;
  req.user = user;
  req.company = state.companies.find((c) => c.id === user.company_id);
  next();
}

export function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, company_id: user.company_id };
}
