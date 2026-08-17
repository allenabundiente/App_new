/**
 * Auth service routes — identity & directory.
 *
 * Owns the `users` and `sessions` tables. Mounted by the monolith
 * (src/app.ts) and by the standalone auth microservice (src/entries/auth.ts).
 * Every handler is byte-for-byte the same route that lived in the old
 * single-file app.ts — the mobile client's contract is unchanged.
 */
import {Router, type Request} from 'express';
import {
  createSession,
  currentUser,
  destroySession,
  hashPassword,
  requireAuth,
  verifyPassword,
} from '../auth';
import {mapUser, q, qOne} from '../db';
import {toStr} from '../convert';
import {generateId} from '../services/id';
import {nowIso, today} from '../services/date';
import {insertUserWithHash} from '../services/planOps';
import type {User} from '../types';
import {adminScope, h, safeUser} from './helpers';

export function createAuthRouter(): Router {
  const r = Router();

  /* --------------------------------- auth --------------------------------- */

  r.post(
    '/auth/login',
    h(async (req, res) => {
      const email = toStr(req.body?.email).trim().toLowerCase();
      const password = toStr(req.body?.password);
      const userRow = await qOne('SELECT * FROM users WHERE email = $1', [email]);
      if (!userRow || !verifyPassword(password, mapUser(userRow).password)) {
        res.status(401).json({ok: false, reason: 'Incorrect email or password.'});
        return;
      }
      const user = mapUser(userRow);
      if (user.status === 'suspended') {
        res.status(403).json({ok: false, reason: 'This account is suspended. Contact support.'});
        return;
      }
      if (user.status === 'pending') {
        res.status(403).json({
          ok: false,
          reason: 'Your account is awaiting verification by an admin.',
        });
        return;
      }
      const token = await createSession(user.id);
      await q(
        'INSERT INTO audit_log (id, userId, action, detail, createdAt) VALUES ($1,$2,$3,$4,$5)',
        [generateId('a-'), user.id, 'auth.login', `${user.name} signed in`, nowIso()],
      );
      res.json({ok: true, token, user: safeUser(user)});
    }),
  );

  r.post(
    '/auth/register',
    h(async (req, res) => {
      const name = toStr(req.body?.name).trim();
      const email = toStr(req.body?.email).trim().toLowerCase();
      const password = toStr(req.body?.password);
      const phone = toStr(req.body?.phone);
      const role = (req.body?.role === 'seller' ? 'seller' : 'buyer') as User['role'];
      if (!name || !email || password.length < 6) {
        res.status(400).json({ok: false, reason: 'Fill all fields — password needs at least 6 characters.'});
        return;
      }
      const exists = await qOne('SELECT id FROM users WHERE email = $1', [email]);
      if (exists) {
        res.status(409).json({ok: false, reason: 'An account with that email already exists.'});
        return;
      }
      await insertUserWithHash({
        id: generateId('u-'),
        name,
        email,
        password,
        phone,
        role,
        status: 'pending',
        joinedAt: today(),
      });
      const admin = await qOne('SELECT id FROM users WHERE role = $1 LIMIT 1', ['admin']);
      if (admin) {
        await q(
          `INSERT INTO notifications (id, userId, type, title, body, isRead, createdAt)
           VALUES ($1,$2,'info','New account awaiting verification',$3,0,$4)`,
          [generateId('n-'), toStr(admin.id), `${name} registered as a ${role}.`, nowIso()],
        );
      }
      res.json({
        ok: false, // registration always waits for verification — no session yet
        reason: 'Account created! An admin will verify it before you can sign in.',
      });
    }),
  );

  r.post(
    '/auth/logout',
    requireAuth,
    h(async (req, res) => {
      await destroySession((req as Request & {token: string}).token);
      res.json({ok: true});
    }),
  );

  r.get(
    '/me',
    requireAuth,
    h(async (req, res) => {
      res.json({user: safeUser(currentUser(req))});
    }),
  );

  /* --------------------------------- users -------------------------------- */

  r.get(
    '/users',
    requireAuth,
    h(async (req, res) => {
      // Scoped manager admins only see the assigned seller, that seller's
      // buyers, and themselves — never the whole account directory.
      const scoped = adminScope(req);
      if (scoped) {
        const rows = await q(
          `SELECT * FROM users
           WHERE id = $1 OR id = $2
              OR id IN (SELECT userId FROM customers WHERE sellerId = $2)
           ORDER BY joinedAt DESC`,
          [currentUser(req).id, scoped],
        );
        res.json({users: rows.map(mapUser).map(safeUser)});
        return;
      }
      const rows = await q('SELECT * FROM users ORDER BY joinedAt DESC');
      res.json({users: rows.map(mapUser).map(safeUser)});
    }),
  );

  r.get(
    '/users/by-email',
    requireAuth,
    h(async (req, res) => {
      const row = await qOne('SELECT * FROM users WHERE email = $1', [
        toStr(req.query.email).toLowerCase(),
      ]);
      res.json({user: row ? safeUser(mapUser(row)) : null});
    }),
  );

  r.get(
    '/users/:id',
    requireAuth,
    h(async (req, res) => {
      const row = await qOne('SELECT * FROM users WHERE id = $1', [req.params.id]);
      res.json({user: row ? safeUser(mapUser(row)) : null});
    }),
  );

  r.patch(
    '/users/:id/status',
    requireAuth,
    h(async (req, res) => {
      const status = toStr(req.body?.status);
      if (!['active', 'pending', 'suspended'].includes(status)) {
        res.status(400).json({error: 'Invalid status.'});
        return;
      }
      await q('UPDATE users SET status = $1 WHERE id = $2', [status, req.params.id]);
      res.json({ok: true});
    }),
  );

  // Self-service profile edit (name / email / phone). The signed-in user may
  // edit their own record; admins may edit anyone's (used for corrections).
  r.patch(
    '/users/:id/profile',
    requireAuth,
    h(async (req, res) => {
      const target = req.params.id;
      const me = currentUser(req);
      if (me.role !== 'admin' && me.id !== target) {
        res.status(403).json({error: 'You can only edit your own profile.'});
        return;
      }
      const name = req.body?.name !== undefined ? toStr(req.body.name).trim() : undefined;
      const email =
        req.body?.email !== undefined ? toStr(req.body.email).trim().toLowerCase() : undefined;
      const phone = req.body?.phone !== undefined ? toStr(req.body.phone).trim() : undefined;
      const qrImage = req.body?.qrImage !== undefined ? toStr(req.body.qrImage).trim() : undefined;
      if (name !== undefined && !name) {
        res.status(400).json({error: 'Name cannot be empty.'});
        return;
      }
      if (email !== undefined) {
        const clash = await qOne('SELECT id FROM users WHERE email = $1 AND id <> $2', [
          email,
          target,
        ]);
        if (clash) {
          res.status(409).json({error: 'Another account already uses that email.'});
          return;
        }
      }
      const fields: string[] = [];
      const params: unknown[] = [];
      for (const [key, val] of [
        ['name', name],
        ['email', email],
        ['phone', phone],
        ['qrImage', qrImage],
      ] as const) {
        if (val !== undefined) {
          params.push(val);
          fields.push(`${key} = $${params.length}`);
        }
      }
      if (!fields.length) {
        res.status(400).json({error: 'Nothing to update.'});
        return;
      }
      params.push(target);
      await q(`UPDATE users SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
      const row = await qOne('SELECT * FROM users WHERE id = $1', [target]);
      res.json({ok: true, user: row ? safeUser(mapUser(row)) : null});
    }),
  );

  // Admin-only: promote/demote roles (e.g. make someone a second admin).
  r.patch(
    '/users/:id/role',
    requireAuth,
    h(async (req, res) => {
      const me = currentUser(req);
      if (me.role !== 'admin') {
        res.status(403).json({error: 'Only admins can change roles.'});
        return;
      }
      const role = toStr(req.body?.role);
      if (!['admin', 'seller', 'buyer'].includes(role)) {
        res.status(400).json({error: 'Invalid role.'});
        return;
      }
      const target = req.params.id;
      if (target === me.id && role !== 'admin') {
        res.status(400).json({error: 'You cannot demote your own account.'});
        return;
      }
      await q('UPDATE users SET role = $1 WHERE id = $2', [role, target]);
      // A demoted admin loses any seller oversight scope.
      if (role !== 'admin') {
        await q('UPDATE users SET assignedSellerId = NULL WHERE id = $1', [target]);
      }
      const row = await qOne('SELECT * FROM users WHERE id = $1', [target]);
      res.json({ok: true, user: row ? safeUser(mapUser(row)) : null});
    }),
  );

  // Admin-only: scope an admin to oversee ONE seller's transactions.
  r.patch(
    '/users/:id/assignment',
    requireAuth,
    h(async (req, res) => {
      const me = currentUser(req);
      if (me.role !== 'admin') {
        res.status(403).json({error: 'Only admins can assign oversight.'});
        return;
      }
      const target = req.params.id;
      const targetRow = await qOne('SELECT * FROM users WHERE id = $1', [target]);
      if (!targetRow || mapUser(targetRow).role !== 'admin') {
        res.status(400).json({error: 'Assignment can only target an admin.'});
        return;
      }
      const sellerId =
        req.body?.sellerId == null ? null : toStr(req.body.sellerId) || null;
      if (sellerId) {
        const seller = await qOne('SELECT role FROM users WHERE id = $1', [sellerId]);
        if (!seller || toStr(seller.role) !== 'seller') {
          res.status(400).json({error: 'assignedSellerId must be a seller account.'});
          return;
        }
      }
      await q('UPDATE users SET assignedSellerId = $1 WHERE id = $2', [sellerId, target]);
      const row = await qOne('SELECT * FROM users WHERE id = $1', [target]);
      res.json({ok: true, user: row ? safeUser(mapUser(row)) : null});
    }),
  );

  // Change password — verifies the current password before replacing it.
  r.post(
    '/users/:id/password',
    requireAuth,
    h(async (req, res) => {
      const target = req.params.id;
      const me = currentUser(req);
      if (me.role !== 'admin' && me.id !== target) {
        res.status(403).json({error: 'You can only change your own password.'});
        return;
      }
      const currentPassword = toStr(req.body?.currentPassword);
      const newPassword = toStr(req.body?.newPassword);
      const row = await qOne('SELECT * FROM users WHERE id = $1', [target]);
      if (!row) {
        res.status(404).json({error: 'User not found.'});
        return;
      }
      const user = mapUser(row);
      if (!verifyPassword(currentPassword, user.password)) {
        res.status(401).json({error: 'Current password is incorrect.'});
        return;
      }
      if (newPassword.length < 6) {
        res.status(400).json({error: 'New password must be at least 6 characters.'});
        return;
      }
      await q('UPDATE users SET password = $1 WHERE id = $2', [hashPassword(newPassword), target]);
      res.json({ok: true});
    }),
  );

  return r;
}
