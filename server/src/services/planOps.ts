/**
 * Plan operations — the write path of the API. Mirrors the mobile
 * repository's recordPayment / createPlan / settlePlan / resolveAdjustment,
 * including the same transaction discipline: every multi-table write runs on
 * ONE client inside BEGIN/COMMIT/ROLLBACK so a crash never leaves the DB
 * half-updated.
 */
import type {PoolClient} from 'pg';
import {
  DEFAULT_SETTINGS,
  getSettings,
  getPool,
  mapAdjustment,
  mapPlan,
  mapSchedule,
  normalizeRow,
  q,
} from '../db';
import {toNum, toStr} from '../convert';
import type {
  Payment,
  Plan,
  PlanDerived,
  ScheduleItem,
  User,
} from '../types';
import {addMonths, nowIso, today} from './date';
import {generateId} from './id';
import {round2} from './money';
import {buildSchedule, pmt} from './amortization';
import {computePenalty, effectiveDueDate, planStatus} from './penalty';
import {earlySettlementQuote} from './earlySettlement';
import {hashPassword} from '../auth';

/* --------------------------- transaction helper --------------------------- */

async function withTransaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/* --------------------- client-scoped helpers (inside txns) ---------------- */

async function cGetPlan(c: PoolClient, id: string): Promise<Plan | null> {
  const res = await c.query('SELECT * FROM plans WHERE id = $1', [id]);
  return res.rows.length ? mapPlan(normalizeRow(res.rows[0])) : null;
}

async function cSchedule(c: PoolClient, planId: string): Promise<ScheduleItem[]> {
  const res = await c.query('SELECT * FROM plan_schedule WHERE planId = $1 ORDER BY dueDate', [
    planId,
  ]);
  return res.rows.map(r => mapSchedule(normalizeRow(r)));
}

async function cReceiptNo(c: PoolClient): Promise<string> {
  const row = await qOneClient<{value: string}>(c, 'SELECT value FROM settings WHERE key = $1', [
    'receipt_seq',
  ]);
  const next = toNum(row?.value) + 1;
  await c.query(
    `INSERT INTO settings (key, value) VALUES ('receipt_seq', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [String(next)],
  );
  return 'R-' + String(next).padStart(4, '0');
}

async function qOneClient<T>(
  c: PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const res = await c.query(sql, params as never[]);
  return res.rows.length ? (normalizeRow(res.rows[0] as Record<string, unknown>) as T) : null;
}

async function cSettings(c: PoolClient) {
  const rows = (
    await c.query<{key: string; value: string}>('SELECT key, value FROM settings')
  ).rows;
  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.key] = r.value;
  }
  const g = (k: keyof typeof DEFAULT_SETTINGS) =>
    map[k] ?? String(DEFAULT_SETTINGS[k]);
  return {
    graceDays: toNum(g('graceDays')),
    penaltyRate: toNum(g('penaltyRate')),
    penaltyCap: toNum(g('penaltyCap')),
  };
}

/* -------------------------------- create plan ----------------------------- */

export interface CreatePlanInput {
  sellerId: string;
  buyerId: string;
  productId: string | null;
  productName: string;
  productEmoji: string;
  price: number;
  downPayment: number;
  apr: number;
  term: number;
  startDate: string;
  notes: string;
}

export async function createPlan(input: CreatePlanInput): Promise<Plan> {
  return withTransaction(c => createPlanOn(c, input));
}

/** Plan creation on an existing client — used by createPlan and the seed's
 *  single big transaction. */
export async function createPlanOn(c: PoolClient, input: CreatePlanInput): Promise<Plan> {
    const financed = Math.max(0, input.price - input.downPayment);
    const installment = pmt(financed, input.apr, input.term);
    const schedule = buildSchedule(financed, input.apr, input.term, input.startDate);

    const last = await qOneClient<{planNo: string}>(
      c,
      "SELECT planNo FROM plans WHERE planNo LIKE 'HT-%' ORDER BY planNo DESC LIMIT 1",
    );
    const nextNo = 'HT-' + (Number(String(last?.planNo ?? 'HT-1000').replace(/\D/g, '')) + 1);

    const plan: Plan = {
      id: generateId('pl-'),
      planNo: nextNo,
      sellerId: input.sellerId,
      buyerId: input.buyerId,
      productId: input.productId,
      productName: input.productName,
      productEmoji: input.productEmoji,
      price: input.price,
      downPayment: input.downPayment,
      financed,
      apr: input.apr,
      term: input.term,
      installment,
      startDate: input.startDate,
      status: 'active',
      graceExtra: 0,
      notes: input.notes,
      createdAt: nowIso(),
    };

    await c.query(
      `INSERT INTO plans (id, planNo, sellerId, buyerId, productId, productName, productEmoji,
        price, downPayment, financed, apr, term, installment, startDate, status, graceExtra, notes, createdAt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [plan.id, plan.planNo, plan.sellerId, plan.buyerId, plan.productId, plan.productName,
        plan.productEmoji, plan.price, plan.downPayment, plan.financed, plan.apr, plan.term,
        plan.installment, plan.startDate, plan.status, plan.graceExtra, plan.notes, plan.createdAt],
    );
    for (const row of schedule) {
      await c.query(
        `INSERT INTO plan_schedule (id, planId, dueDate, amount, status) VALUES ($1,$2,$3,$4,'pending')`,
        [generateId('sch-'), plan.id, row.dueDate, row.amount],
      );
    }
    if (input.downPayment > 0) {
      await c.query(
        `INSERT INTO payments (id, receiptNo, planId, buyerId, sellerId, amount, method, date, notes, recordedBy, penalty, type, createdAt)
         VALUES ($1,$2,$3,$4,$5,$6,'Cash',$7,'Down payment',$8,0,'down',$9)`,
        [generateId('pmt-'), await cReceiptNo(c), plan.id, plan.buyerId, plan.sellerId,
          input.downPayment, input.startDate, input.sellerId, nowIso()],
      );
    }
    return plan;
}

/* ------------------------------- record payment --------------------------- */

export async function recordPayment(input: {
  planId: string;
  amount: number;
  method: string;
  date: string;
  notes: string;
  recordedBy: string;
}): Promise<Payment> {
  return withTransaction(async c => {
    const plan = await cGetPlan(c, input.planId);
    if (!plan) {
      throw new Error('Plan not found');
    }
    const schedule = await cSchedule(c, plan.id);
    const pending = schedule
      .filter(s => s.status === 'pending')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const next = pending[0] ?? null;
    const settings = await cSettings(c);
    const outstanding = next ? next.amount - next.paidAmount : 0;
    const penalty = next
      ? computePenalty(Math.max(0, outstanding), effectiveDueDate(next.dueDate, plan.graceExtra), input.date, {
          graceDays: settings.graceDays,
          ratePerMonthPct: settings.penaltyRate,
          capPct: settings.penaltyCap,
        })
      : 0;

    const payment: Payment = {
      id: generateId('pmt-'),
      receiptNo: await cReceiptNo(c),
      planId: plan.id,
      buyerId: plan.buyerId,
      sellerId: plan.sellerId,
      amount: round2(input.amount),
      method: input.method,
      date: input.date,
      notes: input.notes,
      recordedBy: input.recordedBy,
      penalty,
      type: 'installment',
      createdAt: nowIso(),
    };

    // Allocate the payment across pending installments in due order. A
    // payment larger than the next due covers several installments; any
    // remainder lands on the following due as credit ("paid 2 months, half
    // the next").
    let credit = round2(input.amount);
    for (const item of pending) {
      if (credit <= 0) {
        break;
      }
      const owed = round2(item.amount - item.paidAmount);
      if (credit >= owed) {
        credit = round2(credit - owed);
        await c.query(
          "UPDATE plan_schedule SET status = 'paid', paidAmount = amount, paidDate = $1 WHERE id = $2",
          [input.date, item.id],
        );
      } else {
        await c.query('UPDATE plan_schedule SET paidAmount = paidAmount + $1 WHERE id = $2', [
          credit,
          item.id,
        ]);
        credit = 0;
      }
    }
    await c.query(
      `INSERT INTO payments (id, receiptNo, planId, buyerId, sellerId, amount, method, date, notes, recordedBy, penalty, type, createdAt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [payment.id, payment.receiptNo, payment.planId, payment.buyerId, payment.sellerId,
        payment.amount, payment.method, payment.date, payment.notes, payment.recordedBy,
        payment.penalty, payment.type, payment.createdAt],
    );
    const remaining = await qOneClient<{n: string}>(
      c,
      "SELECT COUNT(*)::text AS n FROM plan_schedule WHERE planId = $1 AND status = 'pending'",
      [plan.id],
    );
    if (toNum(remaining?.n) === 0) {
      await c.query("UPDATE plans SET status = 'completed' WHERE id = $1", [plan.id]);
    }
    return payment;
  });
}

/* ------------------------------- early settlement ------------------------- */

export async function settlePlan(
  planId: string,
  recordedBy: string,
  amountOverride?: number,
): Promise<Payment> {
  return withTransaction(async c => {
    const plan = await cGetPlan(c, planId);
    if (!plan) {
      throw new Error('Plan not found');
    }
    const schedule = await cSchedule(c, planId);
    const remaining = schedule
      .filter(s => s.status === 'pending')
      .reduce((a, s) => a + Math.max(0, s.amount - s.paidAmount), 0);
    const quote = earlySettlementQuote(remaining);
    const settleAmount = round2(amountOverride ?? quote.total);

    const payment: Payment = {
      id: generateId('pmt-'),
      receiptNo: await cReceiptNo(c),
      planId: plan.id,
      buyerId: plan.buyerId,
      sellerId: plan.sellerId,
      amount: settleAmount,
      method: 'Cash',
      date: today(),
      notes: amountOverride == null
        ? 'Early settlement — remaining balance paid in full'
        : 'Early settlement — amount adjusted by seller',
      recordedBy,
      penalty: 0,
      type: 'settlement',
      createdAt: nowIso(),
    };

    for (const s of schedule.filter(x => x.status === 'pending')) {
      await c.query("UPDATE plan_schedule SET status = 'paid', paidDate = $1 WHERE id = $2", [
        today(),
        s.id,
      ]);
    }
    await c.query(
      `INSERT INTO payments (id, receiptNo, planId, buyerId, sellerId, amount, method, date, notes, recordedBy, penalty, type, createdAt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [payment.id, payment.receiptNo, payment.planId, payment.buyerId, payment.sellerId,
        payment.amount, payment.method, payment.date, payment.notes, payment.recordedBy,
        payment.penalty, payment.type, payment.createdAt],
    );
    await c.query("UPDATE plans SET status = 'completed' WHERE id = $1", [plan.id]);
    return payment;
  });
}

/* -------------------------------- adjustments ------------------------------ */

export async function resolveAdjustment(
  adjustmentId: string,
  approve: boolean,
  resolverId: string,
  note: string,
): Promise<void> {
  return withTransaction(async c => {
    const res = await c.query('SELECT * FROM adjustments WHERE id = $1', [adjustmentId]);
    if (!res.rows.length) {
      return;
    }
    const adjustment = mapAdjustment(normalizeRow(res.rows[0]));
    if (adjustment.status !== 'pending') {
      return;
    }
    const plan = await cGetPlan(c, adjustment.planId);
    if (!plan) {
      return;
    }
    const settings = await cSettings(c);
    let detailNote = approve ? 'Approved.' : 'Rejected.';
    let detail: {days?: number; months?: number; quote?: {total?: number}} = {};
    try {
      detail = JSON.parse(adjustment.detailJson);
    } catch {
      detail = {};
    }

    if (approve) {
      if (adjustment.type === 'grace') {
        await c.query('UPDATE plans SET graceExtra = $1 WHERE id = $2', [
          plan.graceExtra + (detail.days ?? settings.graceDays),
          plan.id,
        ]);
        detailNote = `Extra ${detail.days ?? settings.graceDays} grace day(s) added.`;
      } else if (adjustment.type === 'holiday') {
        await c.query(
          `UPDATE plan_schedule SET status = 'skipped', note = 'Payment holiday'
           WHERE id = (SELECT id FROM plan_schedule WHERE planId = $1 AND status = 'pending' ORDER BY dueDate LIMIT 1)`,
          [plan.id],
        );
        const last = await qOneClient<{dueDate: string; amount: number}>(
          c,
          'SELECT dueDate, amount FROM plan_schedule WHERE planId = $1 ORDER BY dueDate DESC LIMIT 1',
          [plan.id],
        );
        if (last) {
          await c.query(
            `INSERT INTO plan_schedule (id, planId, dueDate, amount, status) VALUES ($1,$2,$3,$4,'pending')`,
            [generateId('sch-'), plan.id, addMonths(last.dueDate, 1), last.amount],
          );
        }
        detailNote = 'One installment skipped and moved to the end of the term.';
      } else if (adjustment.type === 'reschedule') {
        // NOTE: normalize rows — Postgres folds `dueDate` to `duedate`, and
        // reading it raw would make every due date here collapse to 1900.
        const pending = (
          await c.query("SELECT id, dueDate FROM plan_schedule WHERE planId = $1 AND status = 'pending'", [
            plan.id,
          ])
        ).rows.map(r => normalizeRow(r as Record<string, unknown>));
        for (const r of pending) {
          await c.query('UPDATE plan_schedule SET dueDate = $1 WHERE id = $2', [
            addMonths(toStr(r.dueDate), detail.months ?? 2),
            toStr(r.id),
          ]);
        }
        detailNote = `Remaining installments extended by ${detail.months ?? 2} month(s).`;
      } else if (adjustment.type === 'early') {
        const schedule = await cSchedule(c, plan.id);
        const remaining = schedule
          .filter(s => s.status === 'pending')
          .reduce((a, s) => a + s.amount, 0);
        const quote =
          detail.quote && typeof detail.quote.total === 'number'
            ? detail.quote
            : earlySettlementQuote(remaining);
        const settlement: Payment = {
          id: generateId('pmt-'),
          receiptNo: await cReceiptNo(c),
          planId: plan.id,
          buyerId: plan.buyerId,
          sellerId: plan.sellerId,
          amount: round2(quote.total ?? 0),
          method: 'Cash',
          date: today(),
          notes: 'Early settlement (approved adjustment)',
          recordedBy: resolverId,
          penalty: 0,
          type: 'settlement',
          createdAt: nowIso(),
        };
        for (const s of schedule.filter(x => x.status === 'pending')) {
          await c.query("UPDATE plan_schedule SET status = 'paid', paidDate = $1 WHERE id = $2", [
            today(),
            s.id,
          ]);
        }
        await c.query(
          `INSERT INTO payments (id, receiptNo, planId, buyerId, sellerId, amount, method, date, notes, recordedBy, penalty, type, createdAt)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [settlement.id, settlement.receiptNo, settlement.planId, settlement.buyerId,
            settlement.sellerId, settlement.amount, settlement.method, settlement.date,
            settlement.notes, settlement.recordedBy, settlement.penalty, settlement.type,
            settlement.createdAt],
        );
        await c.query("UPDATE plans SET status = 'completed' WHERE id = $1", [plan.id]);
        detailNote = 'Early settlement approved — plan completed.';
      }
    }

    await c.query(
      'UPDATE adjustments SET status = $1, resolvedAt = $2, note = $3 WHERE id = $4',
      [approve ? 'approved' : 'rejected', nowIso(), note || detailNote, adjustmentId],
    );
  });
}

/* ------------------------------- derived view ------------------------------ */

/** The plan + its live numbers (mirrors the mobile planWithDerived). */
export async function planWithDerived(plan: Plan): Promise<PlanDerived> {
  const schedule = await scheduleForPlan(plan.id);
  const pending = schedule.filter(s => s.status === 'pending');
  const next = pending.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] ?? null;
  const settings = await getSettings();
  const effective = next ? effectiveDueDate(next.dueDate, plan.graceExtra) : null;
  const outstandingNext = next ? Math.max(0, next.amount - next.paidAmount) : 0;
  const penalty = next
    ? computePenalty(outstandingNext, effective ?? next.dueDate, today(), {
        graceDays: settings.graceDays,
        ratePerMonthPct: settings.penaltyRate,
        capPct: settings.penaltyCap,
      })
    : 0;
  return {
    plan,
    nextDue: next,
    // remaining counts only what is still owed (partial credits deducted)
    remaining: pending.reduce((a, s) => a + Math.max(0, s.amount - s.paidAmount), 0),
    penalty,
    paidCount: schedule.filter(s => s.status === 'paid').length,
    status: planStatus(next ? next.dueDate : null, effective, today(), settings.graceDays),
  };
}

export async function scheduleForPlan(planId: string): Promise<ScheduleItem[]> {
  const rows = await q('SELECT * FROM plan_schedule WHERE planId = $1 ORDER BY dueDate', [planId]);
  return rows.map(mapSchedule);
}

/* ------------------------------ user creation ----------------------------- */

/** Create a user with a hashed password (registration + seeded accounts). */
export async function insertUserWithHash(user: {
  id: string;
  name: string;
  email: string;
  password: string;
  phone: string;
  role: User['role'];
  status: User['status'];
  joinedAt: string;
}): Promise<void> {
  await q(
    `INSERT INTO users (id, name, email, password, phone, role, status, joinedAt)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [user.id, user.name, user.email.toLowerCase().trim(), hashPassword(user.password),
      user.phone, user.role, user.status, user.joinedAt],
  );
}
