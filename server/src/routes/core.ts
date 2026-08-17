/**
 * Core service routes — the installment-tracking domain.
 *
 * Owns `customers`, `products`, `plans`, `plan_schedule`, `payments`,
 * `adjustments`, and `settings`. Mounted by the monolith (src/app.ts) and by
 * the standalone core microservice (src/entries/core.ts). Every handler is
 * byte-for-byte the same route that lived in the old single-file app.ts — the
 * mobile client's contract is unchanged.
 */
import {Router} from 'express';
import {getPool, getSettings, mapAdjustment, mapCustomer, mapPayment, mapPlan, mapProduct, mapSchedule, q, qOne, setSetting} from '../db';
import {toNum, toStr} from '../convert';
import {generateId} from '../services/id';
import {nowIso, today} from '../services/date';
import {currentUser, hashPassword, requireAuth} from '../auth';
import {createPlan, planWithDerived, recordPayment, resolveAdjustment, settlePlan} from '../services/planOps';
import type {Adjustment, AppSettings, Customer, Product} from '../types';
import {adminScope, applyScope, h, outsideScope} from './helpers';

export function createCoreRouter(): Router {
  const r = Router();

  /* ------------------------------ customers ------------------------------- */

  r.get(
    '/customers',
    requireAuth,
    h(async (req, res) => {
      // Scoped admins always see their assigned seller's shop, never another's.
      const sellerId = adminScope(req) ?? toStr(req.query.sellerId);
      if (!sellerId) {
        res.json({customers: []});
        return;
      }
      const rows = await q('SELECT * FROM customers WHERE sellerId = $1 ORDER BY name', [
        sellerId,
      ]);
      res.json({customers: rows.map(mapCustomer)});
    }),
  );

  r.post(
    '/customers',
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

  r.get(
    '/products',
    requireAuth,
    h(async (req, res) => {
      // Scoped admins always see their assigned seller's shop, never another's.
      const sellerId = adminScope(req) ?? toStr(req.query.sellerId);
      if (!sellerId) {
        res.json({products: []});
        return;
      }
      const rows = await q('SELECT * FROM products WHERE sellerId = $1 ORDER BY name', [
        sellerId,
      ]);
      res.json({products: rows.map(mapProduct)});
    }),
  );

  r.post(
    '/products',
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
        image: toStr(req.body?.image),
      };
      await q(
        `INSERT INTO products (id, sellerId, name, price, cost, stock, emoji, image) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [product.id, product.sellerId, product.name, product.price, product.cost, product.stock, product.emoji, product.image],
      );
      res.json({product});
    }),
  );

  r.put(
    '/products/:id',
    requireAuth,
    h(async (req, res) => {
      const id = req.params.id;
      const fields: string[] = [];
      const params: unknown[] = [];
      const allowed = ['name', 'price', 'cost', 'stock', 'emoji', 'image'] as const;
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

  r.delete(
    '/products/:id',
    requireAuth,
    h(async (req, res) => {
      await q('DELETE FROM products WHERE id = $1', [req.params.id]);
      res.json({ok: true});
    }),
  );

  /* --------------------------------- plans -------------------------------- */

  r.get(
    '/plans',
    requireAuth,
    h(async (req, res) => {
      const where: string[] = [];
      const params: unknown[] = [];
      applyScope(req, where, params);
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

  r.get(
    '/plans/:id',
    requireAuth,
    h(async (req, res) => {
      const row = await qOne('SELECT * FROM plans WHERE id = $1', [req.params.id]);
      if (!row) {
        res.json({plan: null});
        return;
      }
      if (outsideScope(req, res, toStr(row.sellerId))) {
        return;
      }
      res.json({plan: mapPlan(row)});
    }),
  );

  r.get(
    '/plans/:id/schedule',
    requireAuth,
    h(async (req, res) => {
      const planRow = await qOne('SELECT sellerId FROM plans WHERE id = $1', [req.params.id]);
      if (outsideScope(req, res, planRow ? toStr(planRow.sellerId) : null)) {
        return;
      }
      const rows = await q('SELECT * FROM plan_schedule WHERE planId = $1 ORDER BY dueDate', [
        req.params.id,
      ]);
      res.json({schedule: rows.map(mapSchedule)});
    }),
  );

  r.get(
    '/plans/:id/payments',
    requireAuth,
    h(async (req, res) => {
      const planRow = await qOne('SELECT sellerId FROM plans WHERE id = $1', [req.params.id]);
      if (outsideScope(req, res, planRow ? toStr(planRow.sellerId) : null)) {
        return;
      }
      const rows = await q('SELECT * FROM payments WHERE planId = $1 ORDER BY date DESC', [
        req.params.id,
      ]);
      res.json({payments: rows.map(mapPayment)});
    }),
  );

  r.get(
    '/plans/:id/derived',
    requireAuth,
    h(async (req, res) => {
      const row = await qOne('SELECT * FROM plans WHERE id = $1', [req.params.id]);
      if (!row) {
        res.json({derived: null});
        return;
      }
      if (outsideScope(req, res, toStr(row.sellerId))) {
        return;
      }
      res.json({derived: await planWithDerived(mapPlan(row))});
    }),
  );

  r.post(
    '/plans',
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

  r.post(
    '/plans/:id/payments',
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

  r.post(
    '/plans/:id/settle',
    requireAuth,
    h(async (req, res) => {
      const recordedBy = toStr(req.body?.recordedBy) || currentUser(req).id;
      const amount =
        req.body?.amount === undefined || req.body?.amount === null
          ? undefined
          : toNum(req.body.amount);
      const payment = await settlePlan(req.params.id, recordedBy, amount);
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

  r.get(
    '/payments',
    requireAuth,
    h(async (req, res) => {
      const where: string[] = [];
      const params: unknown[] = [];
      applyScope(req, where, params);
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

  r.get(
    '/payments/:id',
    requireAuth,
    h(async (req, res) => {
      const row = await qOne('SELECT * FROM payments WHERE id = $1', [req.params.id]);
      if (!row) {
        res.json({payment: null});
        return;
      }
      if (outsideScope(req, res, toStr(row.sellerId))) {
        return;
      }
      res.json({payment: mapPayment(row)});
    }),
  );

  /* ------------------------------ adjustments ------------------------------ */

  r.get(
    '/adjustments',
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
      // Scoped admins filter through the plan the adjustment belongs to.
      const scoped = adminScope(req);
      if (scoped) {
        params.push(scoped);
        where.push(`planId IN (SELECT id FROM plans WHERE sellerId = $${params.length})`);
      }
      const sql =
        'SELECT * FROM adjustments' +
        (where.length ? ' WHERE ' + where.join(' AND ') : '') +
        ' ORDER BY createdAt DESC';
      const rows = await q(sql, params);
      res.json({adjustments: rows.map(mapAdjustment)});
    }),
  );

  r.get(
    '/adjustments/pending',
    requireAuth,
    h(async (req, res) => {
      const sellerId = adminScope(req) ?? toStr(req.query.sellerId);
      if (!sellerId) {
        res.json({adjustments: []});
        return;
      }
      const rows = await q(
        `SELECT a.* FROM adjustments a
         JOIN plans p ON p.id = a.planId
         WHERE a.status = 'pending' AND p.sellerId = $1
         ORDER BY a.createdAt DESC`,
        [sellerId],
      );
      res.json({adjustments: rows.map(mapAdjustment)});
    }),
  );

  r.post(
    '/adjustments',
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

  r.post(
    '/adjustments/:id/resolve',
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

  /* -------------------------------- settings ------------------------------- */

  r.get(
    '/settings',
    requireAuth,
    h(async (_req, res) => {
      res.json({settings: await getSettings()});
    }),
  );

  r.put(
    '/settings',
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

  return r;
}
