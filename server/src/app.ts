/**
 * HulogTrack REST API.
 *
 * The mobile app's cloud client (src/api/client.ts) mirrors these endpoints
 * 1:1. Every route returns the same camelCase shapes the app's types define.
 */
import express, {type Request, type Response, type NextFunction} from 'express';
import cors from 'cors';
import {timingSafeEqual} from 'node:crypto';
import {getPool} from './db';
import {runDueReminders} from './services/reminders';
import {
  createPlan,
  recordPayment,
  resolveAdjustment,
  settlePlan,
  planWithDerived,
  insertUserWithHash,
} from './services/planOps';
import {
  createSession,
  currentUser,
  destroySession,
  hashPassword,
  requireAuth,
  verifyPassword,
} from './auth';
import {generateId} from './services/id';
import {nowIso, today} from './services/date';
import {
  getSettings,
  mapAdjustment,
  mapAudit,
  mapCustomer,
  mapMessage,
  mapNotification,
  mapPayment,
  mapPlan,
  mapProduct,
  mapSchedule,
  mapUser,
  q,
  qOne,
  setSetting,
} from './db';
import {toNum, toStr} from './convert';
import type {
  Adjustment,
  AppSettings,
  Customer,
  Message,
  NotificationItem,
  Product,
  User,
} from './types';

export function createApp() {
  const app = express();
  app.use(cors({origin: true, credentials: true}));
  app.use(express.json());

  // Wrap async handlers so thrown errors become 500 JSON instead of crashes.
  const h =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction) => {
      fn(req, res).catch(next);
    };

  app.get('/', (_req, res) => {
    res.json({service: 'HulogTrack API', version: '0.1.0', status: 'ok'});
  });

  /* ------------------------- health & machine cron ------------------------ */

  // Public liveness probe — free hosts (Render) and keep-alive monitors ping
  // this to wake the instance and prove it is healthy.
  app.get('/api/health', (_req, res) => {
    res.json({ok: true, service: 'hulogtrack-api', time: nowIso()});
  });

  // Machine-only endpoint for the due-reminder cron. Guarded by a shared
  // secret (CRON_SECRET) sent as `x-cron-secret` — NOT user auth, because it
  // is called by the keep-alive workflow / uptime monitor, not the app.
  app.post(
    '/api/cron/reminders',
    h(async (_req, res) => {
      const secret = process.env.CRON_SECRET;
      const sent = toStr(_req.headers['x-cron-secret']);
      if (!secret) {
        res.status(503).json({ok: false, reason: 'CRON_SECRET is not configured on the server.'});
        return;
      }
      const a = Buffer.from(secret);
      const b = Buffer.from(sent);
      if (a.length === 0 || a.length !== b.length || !timingSafeEqual(a, b)) {
        res.status(401).json({ok: false, reason: 'Invalid cron secret.'});
        return;
      }
      const result = await runDueReminders();
      res.json({ok: true, ...result});
    }),
  );

  /* --------------------------------- auth --------------------------------- */

  app.post(
    '/api/auth/login',
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

  app.post(
    '/api/auth/register',
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

  app.post(
    '/api/auth/logout',
    requireAuth,
    h(async (req, res) => {
      await destroySession((req as Request & {token: string}).token);
      res.json({ok: true});
    }),
  );

  app.get(
    '/api/me',
    requireAuth,
    h(async (req, res) => {
      res.json({user: safeUser(currentUser(req))});
    }),
  );

  /* --------------------------------- users -------------------------------- */

  app.get(
    '/api/users',
    requireAuth,
    h(async (_req, res) => {
      const rows = await q('SELECT * FROM users ORDER BY joinedAt DESC');
      res.json({users: rows.map(mapUser).map(safeUser)});
    }),
  );

  app.get(
    '/api/users/by-email',
    requireAuth,
    h(async (req, res) => {
      const row = await qOne('SELECT * FROM users WHERE email = $1', [
        toStr(req.query.email).toLowerCase(),
      ]);
      res.json({user: row ? safeUser(mapUser(row)) : null});
    }),
  );

  app.get(
    '/api/users/:id',
    requireAuth,
    h(async (req, res) => {
      const row = await qOne('SELECT * FROM users WHERE id = $1', [req.params.id]);
      res.json({user: row ? safeUser(mapUser(row)) : null});
    }),
  );

  app.patch(
    '/api/users/:id/status',
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

  /* ------------------------------ customers ------------------------------- */

  app.get(
    '/api/customers',
    requireAuth,
    h(async (req, res) => {
      const rows = await q('SELECT * FROM customers WHERE sellerId = $1 ORDER BY name', [
        req.query.sellerId,
      ]);
      res.json({customers: rows.map(mapCustomer)});
    }),
  );

  app.post(
    '/api/customers',
    requireAuth,
    h(async (req, res) => {
      const sellerId = toStr(req.body?.sellerId);
      const name = toStr(req.body?.name).trim();
      if (!sellerId || !name) {
        res.status(400).json({error: 'sellerId and name are required.'});
        return;
      }
      const buyerId = generateId('u-');
      const customer: Customer = {
        id: generateId('c-'),
        sellerId,
        userId: buyerId,
        name,
        phone: toStr(req.body?.phone),
        email: toStr(req.body?.email).toLowerCase(),
        address: toStr(req.body?.address),
        notes: toStr(req.body?.notes),
        joinedAt: today(),
      };
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `INSERT INTO users (id, name, email, password, phone, role, status, joinedAt)
           VALUES ($1,$2,$3,$4,$5,'buyer','active',$6)`,
          [buyerId, name, customer.email, hashPassword('buyer123'), customer.phone, today()],
        );
        await client.query(
          `INSERT INTO customers (id, sellerId, userId, name, phone, email, address, notes, joinedAt)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [customer.id, customer.sellerId, customer.userId, customer.name, customer.phone,
            customer.email, customer.address, customer.notes, customer.joinedAt],
        );
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
      res.json({customer});
    }),
  );

  /* ------------------------------- products ------------------------------- */

  app.get(
    '/api/products',
    requireAuth,
    h(async (req, res) => {
      const rows = await q('SELECT * FROM products WHERE sellerId = $1 ORDER BY name', [
        req.query.sellerId,
      ]);
      res.json({products: rows.map(mapProduct)});
    }),
  );

  app.post(
    '/api/products',
    requireAuth,
    h(async (req, res) => {
      const product: Product = {
        id: generateId('p-'),
        sellerId: toStr(req.body?.sellerId),
        name: toStr(req.body?.name),
        price: toNum(req.body?.price),
        cost: toNum(req.body?.cost),
        stock: toNum(req.body?.stock),
        emoji: toStr(req.body?.emoji),
      };
      await q(
        `INSERT INTO products (id, sellerId, name, price, cost, stock, emoji) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [product.id, product.sellerId, product.name, product.price, product.cost, product.stock, product.emoji],
      );
      res.json({product});
    }),
  );

  app.put(
    '/api/products/:id',
    requireAuth,
    h(async (req, res) => {
      const id = req.params.id;
      const fields: string[] = [];
      const params: unknown[] = [];
      const allowed = ['name', 'price', 'cost', 'stock', 'emoji'] as const;
      for (const key of allowed) {
        const v = req.body?.[key];
        if (v !== undefined) {
          params.push(v);
          fields.push(`${key} = $${params.length}`);
        }
      }
      if (!fields.length) {
        res.status(400).json({error: 'Nothing to update.'});
        return;
      }
      params.push(id);
      await q(`UPDATE products SET ${fields.join(', ')} WHERE id = $${params.length}`, params);
      const row = await qOne('SELECT * FROM products WHERE id = $1', [id]);
      res.json({product: row ? mapProduct(row) : null});
    }),
  );

  app.delete(
    '/api/products/:id',
    requireAuth,
    h(async (req, res) => {
      await q('DELETE FROM products WHERE id = $1', [req.params.id]);
      res.json({ok: true});
    }),
  );

  /* --------------------------------- plans -------------------------------- */

  app.get(
    '/api/plans',
    requireAuth,
    h(async (req, res) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (req.query.sellerId) {
        params.push(req.query.sellerId);
        where.push(`sellerId = $${params.length}`);
      }
      if (req.query.buyerId) {
        params.push(req.query.buyerId);
        where.push(`buyerId = $${params.length}`);
      }
      const sql =
        'SELECT * FROM plans' +
        (where.length ? ' WHERE ' + where.join(' AND ') : '') +
        ' ORDER BY createdAt DESC';
      const rows = await q(sql, params);
      res.json({plans: rows.map(mapPlan)});
    }),
  );

  app.get(
    '/api/plans/:id',
    requireAuth,
    h(async (req, res) => {
      const row = await qOne('SELECT * FROM plans WHERE id = $1', [req.params.id]);
      res.json({plan: row ? mapPlan(row) : null});
    }),
  );

  app.get(
    '/api/plans/:id/schedule',
    requireAuth,
    h(async (req, res) => {
      const rows = await q('SELECT * FROM plan_schedule WHERE planId = $1 ORDER BY dueDate', [
        req.params.id,
      ]);
      res.json({schedule: rows.map(mapSchedule)});
    }),
  );

  app.get(
    '/api/plans/:id/payments',
    requireAuth,
    h(async (req, res) => {
      const rows = await q('SELECT * FROM payments WHERE planId = $1 ORDER BY date DESC', [
        req.params.id,
      ]);
      res.json({payments: rows.map(mapPayment)});
    }),
  );

  app.get(
    '/api/plans/:id/derived',
    requireAuth,
    h(async (req, res) => {
      const row = await qOne('SELECT * FROM plans WHERE id = $1', [req.params.id]);
      if (!row) {
        res.json({derived: null});
        return;
      }
      res.json({derived: await planWithDerived(mapPlan(row))});
    }),
  );

  app.post(
    '/api/plans',
    requireAuth,
    h(async (req, res) => {
      const plan = await createPlan({
        sellerId: toStr(req.body?.sellerId),
        buyerId: toStr(req.body?.buyerId),
        productId: req.body?.productId ? toStr(req.body.productId) : null,
        productName: toStr(req.body?.productName),
        productEmoji: toStr(req.body?.productEmoji),
        price: toNum(req.body?.price),
        downPayment: toNum(req.body?.downPayment),
        apr: toNum(req.body?.apr),
        term: toNum(req.body?.term),
        startDate: toStr(req.body?.startDate),
        notes: toStr(req.body?.notes),
      });
      res.status(201).json({plan});
    }),
  );

  app.post(
    '/api/plans/:id/payments',
    requireAuth,
    h(async (req, res) => {
      const payment = await recordPayment({
        planId: req.params.id,
        amount: toNum(req.body?.amount),
        method: toStr(req.body?.method) || 'Cash',
        date: toStr(req.body?.date) || today(),
        notes: toStr(req.body?.notes),
        recordedBy: toStr(req.body?.recordedBy) || currentUser(req).id,
      });
      const plan = await qOne('SELECT * FROM plans WHERE id = $1', [req.params.id]);
      if (plan) {
        await q(
          `INSERT INTO notifications (id, userId, type, title, body, isRead, createdAt)
           VALUES ($1,$2,'money','Payment received',$3,0,$4)`,
          [generateId('n-'), toStr(plan.buyerId),
            `${payment.amount} recorded on ${mapPlan(plan).planNo}. Receipt ${payment.receiptNo}.`,
            nowIso()],
        );
      }
      await q(
        'INSERT INTO audit_log (id, userId, action, detail, createdAt) VALUES ($1,$2,$3,$4,$5)',
        [generateId('a-'), payment.recordedBy, 'payment.record',
          `Recorded ${payment.amount} on ${payment.receiptNo}`, nowIso()],
      );
      res.status(201).json({payment});
    }),
  );

  app.post(
    '/api/plans/:id/settle',
    requireAuth,
    h(async (req, res) => {
      const recordedBy = toStr(req.body?.recordedBy) || currentUser(req).id;
      const payment = await settlePlan(req.params.id, recordedBy);
      const plan = await qOne('SELECT * FROM plans WHERE id = $1', [req.params.id]);
      if (plan) {
        await q(
          `INSERT INTO notifications (id, userId, type, title, body, isRead, createdAt)
           VALUES ($1,$2,'success','Plan settled early',$3,0,$4)`,
          [generateId('n-'), toStr(plan.buyerId),
            `${mapPlan(plan).planNo} settled for ${payment.amount}.`, nowIso()],
        );
      }
      res.status(201).json({payment});
    }),
  );

  /* -------------------------------- payments ------------------------------- */

  app.get(
    '/api/payments',
    requireAuth,
    h(async (req, res) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (req.query.buyerId) {
        params.push(req.query.buyerId);
        where.push(`buyerId = $${params.length}`);
      }
      if (req.query.sellerId) {
        params.push(req.query.sellerId);
        where.push(`sellerId = $${params.length}`);
      }
      const sql =
        'SELECT * FROM payments' +
        (where.length ? ' WHERE ' + where.join(' AND ') : '') +
        ' ORDER BY date DESC, createdAt DESC';
      const rows = await q(sql, params);
      res.json({payments: rows.map(mapPayment)});
    }),
  );

  app.get(
    '/api/payments/:id',
    requireAuth,
    h(async (req, res) => {
      const row = await qOne('SELECT * FROM payments WHERE id = $1', [req.params.id]);
      res.json({payment: row ? mapPayment(row) : null});
    }),
  );

  /* ------------------------------ adjustments ------------------------------ */

  app.get(
    '/api/adjustments',
    requireAuth,
    h(async (req, res) => {
      const where: string[] = [];
      const params: unknown[] = [];
      if (req.query.buyerId) {
        params.push(req.query.buyerId);
        where.push(`buyerId = $${params.length}`);
      }
      if (req.query.status) {
        params.push(req.query.status);
        where.push(`status = $${params.length}`);
      }
      const sql =
        'SELECT * FROM adjustments' +
        (where.length ? ' WHERE ' + where.join(' AND ') : '') +
        ' ORDER BY createdAt DESC';
      const rows = await q(sql, params);
      res.json({adjustments: rows.map(mapAdjustment)});
    }),
  );

  app.get(
    '/api/adjustments/pending',
    requireAuth,
    h(async (req, res) => {
      const rows = await q(
        `SELECT a.* FROM adjustments a
         JOIN plans p ON p.id = a.planId
         WHERE a.status = 'pending' AND p.sellerId = $1
         ORDER BY a.createdAt DESC`,
        [req.query.sellerId],
      );
      res.json({adjustments: rows.map(mapAdjustment)});
    }),
  );

  app.post(
    '/api/adjustments',
    requireAuth,
    h(async (req, res) => {
      const adjustment: Adjustment = {
        id: generateId('ad-'),
        planId: toStr(req.body?.planId),
        buyerId: toStr(req.body?.buyerId),
        type: toStr(req.body?.type) as Adjustment['type'],
        reason: toStr(req.body?.reason),
        detailJson: toStr(req.body?.detailJson) || '{}',
        status: 'pending',
        createdAt: nowIso(),
        resolvedAt: null,
        note: '',
      };
      await q(
        `INSERT INTO adjustments (id, planId, buyerId, type, reason, detailJson, status, createdAt, resolvedAt, note)
         VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,NULL,'')`,
        [adjustment.id, adjustment.planId, adjustment.buyerId, adjustment.type,
          adjustment.reason, adjustment.detailJson, adjustment.createdAt],
      );
      res.status(201).json({adjustment});
    }),
  );

  app.post(
    '/api/adjustments/:id/resolve',
    requireAuth,
    h(async (req, res) => {
      const approve = Boolean(req.body?.approve);
      const resolverId = toStr(req.body?.resolverId) || currentUser(req).id;
      const note = toStr(req.body?.note);
      const before = await qOne('SELECT * FROM adjustments WHERE id = $1', [req.params.id]);
      await resolveAdjustment(req.params.id, approve, resolverId, note);
      const plan = before
        ? await qOne('SELECT * FROM plans WHERE id = $1', [toStr(before.planId)])
        : null;
      if (plan) {
        await q(
          `INSERT INTO notifications (id, userId, type, title, body, isRead, createdAt)
           VALUES ($1,$2,$3,'Adjustment ' || $4,$5,0,$6)`,
          [generateId('n-'), toStr(plan.buyerId), approve ? 'success' : 'warn',
            approve ? 'approved' : 'rejected',
            `${toStr(before?.type)} request for ${mapPlan(plan).planNo}: ${note || 'Resolved.'}`,
            nowIso()],
        );
      }
      res.json({ok: true});
    }),
  );

  /* ----------------------------- notifications ----------------------------- */

  app.get(
    '/api/notifications',
    requireAuth,
    h(async (req, res) => {
      const limit = Math.min(200, toNum(req.query.limit) || 30);
      const rows = await q(
        'SELECT * FROM notifications WHERE userId = $1 ORDER BY createdAt DESC LIMIT $2',
        [req.query.userId, limit],
      );
      res.json({notifications: rows.map(mapNotification)});
    }),
  );

  app.get(
    '/api/notifications/unread',
    requireAuth,
    h(async (req, res) => {
      const rows = await q(
        'SELECT COUNT(*)::int AS n FROM notifications WHERE userId = $1 AND isRead = 0',
        [req.query.userId],
      );
      res.json({count: toNum(rows[0]?.n)});
    }),
  );

  app.post(
    '/api/notifications',
    requireAuth,
    h(async (req, res) => {
      const notification: NotificationItem = {
        id: generateId('n-'),
        userId: toStr(req.body?.userId),
        type: (req.body?.type as NotificationItem['type']) ?? 'info',
        title: toStr(req.body?.title),
        body: toStr(req.body?.body),
        isRead: false,
        createdAt: nowIso(),
      };
      await q(
        `INSERT INTO notifications (id, userId, type, title, body, isRead, createdAt)
         VALUES ($1,$2,$3,$4,$5,0,$6)`,
        [notification.id, notification.userId, notification.type, notification.title,
          notification.body, notification.createdAt],
      );
      res.status(201).json({notification});
    }),
  );

  /* -------------------------------- messages ------------------------------- */

  app.get(
    '/api/messages',
    requireAuth,
    h(async (req, res) => {
      const rows = await q('SELECT * FROM messages WHERE planId = $1 ORDER BY createdAt', [
        req.query.planId,
      ]);
      res.json({messages: rows.map(mapMessage)});
    }),
  );

  app.post(
    '/api/messages',
    requireAuth,
    h(async (req, res) => {
      const message: Message = {
        id: generateId('m-'),
        planId: toStr(req.body?.planId),
        senderId: toStr(req.body?.senderId),
        recipientId: toStr(req.body?.recipientId),
        text: toStr(req.body?.text),
        isRead: false,
        createdAt: nowIso(),
      };
      await q(
        `INSERT INTO messages (id, planId, senderId, recipientId, text, isRead, createdAt)
         VALUES ($1,$2,$3,$4,$5,0,$6)`,
        [message.id, message.planId, message.senderId, message.recipientId, message.text,
          message.createdAt],
      );
      res.status(201).json({message});
    }),
  );

  /* --------------------------------- audit -------------------------------- */

  app.get(
    '/api/audit',
    requireAuth,
    h(async (req, res) => {
      const limit = Math.min(500, toNum(req.query.limit) || 100);
      const rows = await q('SELECT * FROM audit_log ORDER BY createdAt DESC LIMIT $1', [limit]);
      res.json({audit: rows.map(mapAudit)});
    }),
  );

  app.post(
    '/api/audit',
    requireAuth,
    h(async (req, res) => {
      await q(
        'INSERT INTO audit_log (id, userId, action, detail, createdAt) VALUES ($1,$2,$3,$4,$5)',
        [generateId('a-'), toStr(req.body?.userId), toStr(req.body?.action),
          toStr(req.body?.detail), nowIso()],
      );
      res.json({ok: true});
    }),
  );

  /* -------------------------------- settings ------------------------------- */

  app.get(
    '/api/settings',
    requireAuth,
    h(async (_req, res) => {
      res.json({settings: await getSettings()});
    }),
  );

  app.put(
    '/api/settings',
    requireAuth,
    h(async (req, res) => {
      const body = req.body?.settings as Partial<AppSettings>;
      const current = await getSettings();
      const next = {...current, ...body};
      const entries: Array<[string, string]> = [
        ['businessName', next.businessName],
        ['businessAddr', next.businessAddr],
        ['businessPhone', next.businessPhone],
        ['taxId', next.taxId],
        ['currency', next.currency],
        ['graceDays', String(next.graceDays)],
        ['penaltyRate', String(next.penaltyRate)],
        ['penaltyCap', String(next.penaltyCap)],
        ['defaultApr', String(next.defaultApr)],
        ['reminderLead', String(next.reminderLead)],
      ];
      for (const [k, v] of entries) {
        await setSetting(k, v);
      }
      res.json({settings: await getSettings()});
    }),
  );

  // Central error handler.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[api error]', err);
    res.status(500).json({error: err.message ?? 'Internal server error.'});
  });

  return app;
}

/** Strip the password hash before sending a user to the client. */
function safeUser(user: User): User {
  return {...user, password: ''};
}
