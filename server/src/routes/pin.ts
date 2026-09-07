/**
 * PIN-based authentication routes.
 *
 * Generates cryptographically random 6-digit PINs for mobile users to
 * authenticate without a password. PINs expire after 10 minutes and are
 * single-use. When a new PIN is generated for a user, any previous unused
 * PINs for that user are invalidated.
 *
 * Endpoints:
 *   POST /api/pins/generate  — admin-only, creates a 6-digit PIN
 *   POST /api/pins/redeem    — public, mobile sends PIN → gets session token
 *   GET  /api/pins/list      — admin-only, lists active (unexpired, unused) PINs
 */
import {Router} from 'express';
import {requireAuth, currentUser, createSession} from '../auth';
import {q, qOne, mapUser} from '../db';
import {toStr} from '../convert';
import {generateId} from '../services/id';
import {nowIso} from '../services/date';
import {h} from './helpers';

function randomPin(): string {
  // Cryptographically random 6-digit code (100000–999999).
  const buf = require('node:crypto').randomBytes(4);
  const n = buf.readUInt32BE(0);
  return String(100000 + (n % 900000));
}

export function createPinRouter(): Router {
  const r = Router();

  /**
   * POST /api/pins/generate
   * Admin-only. Body: { userId }
   * Returns: { pin, expiresAt }
   */
  r.post(
    '/pins/generate',
    requireAuth,
    h(async (req, res) => {
      const me = currentUser(req);
      if (me.role !== 'admin') {
        res.status(403).json({error: 'Only admins can generate PINs.'});
        return;
      }
      const userId = toStr(req.body?.userId);
      if (!userId) {
        res.status(400).json({error: 'userId is required.'});
        return;
      }
      const user = await qOne('SELECT id, role, status FROM users WHERE id = $1', [userId]);
      if (!user) {
        res.status(404).json({error: 'User not found.'});
        return;
      }
      // Invalidate any previous unused PINs for this user.
      await q(
        "UPDATE pin_codes SET usedAt = now() WHERE userId = $1 AND usedAt IS NULL",
        [userId],
      );
      const pin = randomPin();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await q(
        'INSERT INTO pin_codes (id, code, userId, expiresAt, usedAt, createdAt) VALUES ($1,$2,$3,$4,NULL,$5)',
        [generateId('pin-'), pin, userId, expiresAt, nowIso()],
      );
      res.json({pin, expiresAt});
    }),
  );

  /**
   * POST /api/pins/redeem
   * Public. Body: { pin }
   * Returns: { ok, token, user }
   */
  r.post(
    '/pins/redeem',
    h(async (req, res) => {
      const pin = toStr(req.body?.pin).trim();
      if (!pin || pin.length !== 6) {
        res.status(400).json({ok: false, reason: 'Enter a valid 6-digit PIN.'});
        return;
      }
      const row = await qOne(
        "SELECT * FROM pin_codes WHERE code = $1 AND usedAt IS NULL AND expiresAt > now()",
        [pin],
      );
      if (!row) {
        res.status(401).json({ok: false, reason: 'Invalid or expired PIN.'});
        return;
      }
      // Mark as used.
      await q('UPDATE pin_codes SET usedAt = now() WHERE id = $1', [row.id]);
      // Fetch user and create session.
      const userRow = await qOne('SELECT * FROM users WHERE id = $1', [row.userId]);
      if (!userRow) {
        res.status(404).json({ok: false, reason: 'User account not found.'});
        return;
      }
      const user = mapUser(userRow);
      if (user.status === 'suspended') {
        res.status(403).json({ok: false, reason: 'This account is suspended.'});
        return;
      }
      if (user.status === 'pending') {
        res.status(403).json({ok: false, reason: 'Account awaiting verification.'});
        return;
      }
      const token = await createSession(user.id);
      const safe = {...user, password: ''};
      res.json({ok: true, token, user: safe});
    }),
  );

  /**
   * GET /api/pins/list
   * Admin-only. Returns active (unexpired, unused) PINs.
   */
  r.get(
    '/pins/list',
    requireAuth,
    h(async (req, res) => {
      const me = currentUser(req);
      if (me.role !== 'admin') {
        res.status(403).json({error: 'Only admins can list PINs.'});
        return;
      }
      const rows = await q(
        "SELECT p.*, u.name AS userName, u.email AS userEmail FROM pin_codes p LEFT JOIN users u ON u.id = p.userId WHERE p.usedAt IS NULL AND p.expiresAt > now() ORDER BY p.createdAt DESC",
        [],
      );
      res.json({pins: rows});
    }),
  );

  return r;
}
