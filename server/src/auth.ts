/**
 * Auth — passwords hashed with Node's built-in scrypt (no deps), sessions
 * are opaque random tokens stored in the sessions table. The mobile app
 * sends `Authorization: Bearer <token>` on every request.
 */
import {createHash, randomBytes, scryptSync, timingSafeEqual} from 'node:crypto';
import type {NextFunction, Request, Response} from 'express';
import {q, qOne, mapUser} from './db';
import {nowIso} from './services/date';
import {generateId} from './services/id';
import type {User} from './types';

/* ------------------------------- passwords -------------------------------- */

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !hash) {
      return false;
    }
    const candidate = scryptSync(password, salt, 32);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

/* -------------------------------- sessions -------------------------------- */

export async function createSession(userId: string): Promise<string> {
  const token = createHash('sha256')
    .update(`${randomBytes(48).toString('hex')}${Date.now()}`)
    .digest('hex');
  await q('INSERT INTO sessions (token, userId, createdAt) VALUES ($1, $2, $3)', [
    token,
    userId,
    nowIso(),
  ]);
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await q('DELETE FROM sessions WHERE token = $1', [token]);
}

export async function userForToken(token: string): Promise<User | null> {
  const row = await qOne<{userId: string}>('SELECT userId FROM sessions WHERE token = $1', [
    token,
  ]);
  if (!row) {
    return null;
  }
  const userRow = await qOne('SELECT * FROM users WHERE id = $1', [row.userId]);
  return userRow ? mapUser(userRow) : null;
}

/* ------------------------------ middleware --------------------------------- */

/** Express middleware: require a valid Bearer token, attach req.user. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) {
    res.status(401).json({error: 'Missing authorization token.'});
    return;
  }
  const user = await userForToken(token);
  if (!user) {
    res.status(401).json({error: 'Invalid or expired session.'});
    return;
  }
  (req as Request & {user: User}).user = user;
  (req as Request & {token: string}).token = token;
  next();
}

/** Attach the authed user as req.user (used by route handlers). */
export function currentUser(req: Request): User {
  return (req as Request & {user: User}).user;
}

export {generateId};
