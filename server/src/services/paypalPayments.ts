/**
 * The PayPal payment rules.
 *
 * The important part is that the buyer never sends an amount. We look at the
 * plan's schedule and work out the monthly fee, the advance amount or the
 * early-settlement total here. That amount is stored on the PayPal order row
 * and reused when the payment is captured, so a retry cannot change it.
 *
 * Capturing is idempotent: a PayPal order can only be marked captured once,
 * and `capturePaypalForUser` returns the original payment if it is called
 * again. Double taps and network retries therefore never double-record a
 * payment (and PayPal itself only allows one capture per order).
 */
import type {PoolClient} from 'pg';
import {
  getPool,
  getSettings,
  mapPayment,
  mapPlan,
  mapSchedule,
  normalizeRow,
  q,
  qOne,
} from '../db';
import {toNum, toStr} from '../convert';
import type {Payment, Plan, ScheduleItem, User} from '../types';
import {isPaypalConfigured, paypalConfig} from '../config';
import {
  capturePaypalOrder,
  createPaypalOrder,
  getPaypalOrder,
  PaypalError,
} from './paypal';
import {scheduleForPlan, cReceiptNo} from './planOps';
import {computePenalty, effectiveDueDate} from './penalty';
import {earlySettlementQuote} from './earlySettlement';
import {nowIso, today} from './date';
import {generateId} from './id';
import {round2} from './money';

export type PaypalPaymentType = 'monthly' | 'advance' | 'settle';

export interface PaypalBreakdownRow {
  label: string;
  amount: number;
  tone: 'principal' | 'penalty' | 'discount' | 'fee';
}

export interface PaypalQuote {
  type: PaypalPaymentType;
  amount: number;
  principal: number;
  penalty: number;
  currency: string;
  label: string;
  note: string;
  available: boolean;
  remaining: number;
  breakdown: PaypalBreakdownRow[];
}

/** A route-level failure with the HTTP status the client should see. */
export class PaypalHttpError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/* ------------------------------- order rows ------------------------------- */

export interface PaypalOrderRow {
  id: string;
  paypalOrderId: string;
  planId: string;
  buyerId: string;
  sellerId: string;
  type: PaypalPaymentType;
  amount: number;
  principal: number;
  penalty: number;
  currency: string;
  status: string;
  captureId: string | null;
  paymentId: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  capturedAt: string | null;
}

function mapOrder(r: Record<string, unknown>): PaypalOrderRow {
  return {
    id: toStr(r.id),
    paypalOrderId: toStr(r.paypalOrderId),
    planId: toStr(r.planId),
    buyerId: toStr(r.buyerId),
    sellerId: toStr(r.sellerId),
    type: toStr(r.type) as PaypalPaymentType,
    amount: toNum(r.amount),
    principal: toNum(r.principal),
    penalty: toNum(r.penalty),
    currency: toStr(r.currency),
    status: toStr(r.status),
    captureId: r.captureId == null ? null : toStr(r.captureId),
    paymentId: r.paymentId == null ? null : toStr(r.paymentId),
    error: r.error == null ? null : toStr(r.error),
    createdAt: toStr(r.createdAt),
    updatedAt: toStr(r.updatedAt),
    capturedAt: r.capturedAt == null ? null : toStr(r.capturedAt),
  };
}

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

async function loadOrder(orderId: string): Promise<PaypalOrderRow | null> {
  const row = await qOne('SELECT * FROM paypal_orders WHERE paypalOrderId = $1', [orderId]);
  return row ? mapOrder(row) : null;
}

async function loadPlan(planId: string): Promise<Plan | null> {
  const row = await qOne('SELECT * FROM plans WHERE id = $1', [planId]);
  return row ? mapPlan(row) : null;
}

export async function loadPlanForBuyer(planId: string, user: User): Promise<Plan> {
  const plan = await loadPlan(planId);
  if (!plan) {
    throw new PaypalHttpError('Plan not found.', 404);
  }
  if (plan.buyerId !== user.id) {
    throw new PaypalHttpError('You can only pay for your own plan.', 403);
  }
  return plan;
}

export function parsePaypalType(value: unknown): PaypalPaymentType {
  const type = toStr(value);
  if (type === 'monthly' || type === 'advance' || type === 'settle') {
    return type;
  }
  throw new PaypalHttpError('Payment type must be monthly, advance or settle.', 400);
}

/* --------------------------------- quotes -------------------------------- */

/**
 * Works out what the buyer would pay for one payment type on this plan.
 * Everything here comes from plan_schedule; the client only picks the type.
 */
export async function quoteForPlan(
  plan: Plan,
  type: PaypalPaymentType,
): Promise<PaypalQuote> {
  const schedule = await scheduleForPlan(plan.id);
  const settings = await getSettings();
  const pending = schedule
    .filter(item => item.status === 'pending')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const paidCount = schedule.filter(item => item.status === 'paid').length;
  const remaining = round2(
    pending.reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0),
  );
  const currency = paypalConfig.currency;

  const base = {
    type,
    currency,
    remaining,
    principal: 0,
    penalty: 0,
    amount: 0,
    available: false,
    breakdown: [] as PaypalBreakdownRow[],
  };

  if (pending.length === 0 || remaining <= 0) {
    return {
      ...base,
      label: type === 'settle' ? 'Settle early' : type === 'advance' ? 'Advance payment' : 'Monthly fee',
      note: 'This plan is paid in full — there is no balance left to pay.',
    };
  }

  const first = pending[0];
  const firstOutstanding = round2(Math.max(0, first.amount - first.paidAmount));
  const penalty = computePenalty(
    firstOutstanding,
    effectiveDueDate(first.dueDate, plan.graceExtra),
    today(),
    {
      graceDays: settings.graceDays,
      ratePerMonthPct: settings.penaltyRate,
      capPct: settings.penaltyCap,
    },
  );

  if (type === 'monthly') {
    const amount = round2(firstOutstanding + penalty);
    return {
      ...base,
      principal: firstOutstanding,
      penalty,
      amount,
      available: amount > 0,
      label: 'Monthly fee',
      note: `Installment ${paidCount + 1} of ${plan.term}, due ${first.dueDate}.${
        penalty > 0 ? ' The late penalty is included.' : ''
      }`,
      breakdown: [
        {
          label: `Installment ${paidCount + 1} — due ${first.dueDate}`,
          amount: firstOutstanding,
          tone: 'principal',
        },
        ...(penalty > 0
          ? [{label: 'Late penalty', amount: penalty, tone: 'penalty' as const}]
          : []),
      ],
    };
  }

  if (type === 'advance') {
    if (pending.length < 2) {
      return {
        ...base,
        label: 'Advance payment',
        note: 'An advance payment needs at least two unpaid installments. Pay the monthly fee instead.',
      };
    }
    const covered = pending.slice(0, 2);
    const principal = round2(
      covered.reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0),
    );
    const amount = round2(principal + penalty);
    return {
      ...base,
      principal,
      penalty,
      amount,
      available: amount > 0,
      label: 'Advance payment (next 2 months)',
      note: `Covers installments ${paidCount + 1} and ${paidCount + 2}. Any extra credit carries to the month after.`,
      breakdown: [
        ...covered.map((item, index) => ({
          label: `Installment ${paidCount + index + 1} — due ${item.dueDate}`,
          amount: round2(Math.max(0, item.amount - item.paidAmount)),
          tone: 'principal' as const,
        })),
        ...(penalty > 0
          ? [{label: 'Late penalty', amount: penalty, tone: 'penalty' as const}]
          : []),
      ],
    };
  }

  const quote = earlySettlementQuote(remaining);
  return {
    ...base,
    principal: remaining,
    amount: round2(quote.total),
    available: quote.total > 0,
    label: 'Settle early',
    note: `Pays off all ${pending.length} remaining installment${
      pending.length === 1 ? '' : 's'
    } and completes the plan.`,
    breakdown: [
      {label: 'Remaining balance', amount: remaining, tone: 'principal'},
      {label: 'Early-pay discount (2%)', amount: -quote.incentive, tone: 'discount'},
      {label: 'Processing fee', amount: quote.fee, tone: 'fee'},
    ],
  };
}

export async function quoteForBuyer(
  planId: string,
  type: PaypalPaymentType,
  user: User,
): Promise<{enabled: boolean; currency: string; quote: PaypalQuote}> {
  const plan = await loadPlanForBuyer(planId, user);
  return {
    enabled: isPaypalConfigured(),
    currency: paypalConfig.currency,
    quote: await quoteForPlan(plan, type),
  };
}

/* ------------------------------ create order ----------------------------- */

export interface CreatedPaypalOrder {
  orderId: string;
  approvalUrl: string;
  planId: string;
  planNo: string;
  type: PaypalPaymentType;
  amount: number;
  currency: string;
  label: string;
}

export async function createPaypalOrderForBuyer(input: {
  planId: string;
  type: PaypalPaymentType;
  user: User;
}): Promise<CreatedPaypalOrder> {
  if (!isPaypalConfigured()) {
    throw new PaypalHttpError(
      'PayPal is not configured on the server. Add PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to the repo-root .env and restart the API.',
      503,
    );
  }

  const plan = await loadPlanForBuyer(input.planId, input.user);
  if (plan.status === 'completed' || plan.status === 'cancelled') {
    throw new PaypalHttpError('This plan is already closed.', 409);
  }
  const quote = await quoteForPlan(plan, input.type);
  if (!quote.available || quote.amount <= 0) {
    throw new PaypalHttpError(quote.note || 'There is no amount to pay right now.', 400);
  }

  const internalId = generateId('ppo-');
  const createdAt = nowIso();
  const order = await createPaypalOrder({
    amount: quote.amount,
    currency: quote.currency,
    description: `HulogTrack ${plan.planNo} — ${quote.label}`,
    customId: `${internalId}|${plan.id}`,
  });

  await q(
    `INSERT INTO paypal_orders
      (id, paypalOrderId, planId, buyerId, sellerId, type, amount, principal, penalty,
       currency, status, captureId, paymentId, error, createdAt, updatedAt, capturedAt)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'created',NULL,NULL,NULL,$11,$11,NULL)`,
    [
      internalId,
      order.orderId,
      plan.id,
      input.user.id,
      plan.sellerId,
      input.type,
      quote.amount,
      quote.principal,
      quote.penalty,
      quote.currency,
      createdAt,
    ],
  );

  return {
    orderId: order.orderId,
    approvalUrl: order.approvalUrl,
    planId: plan.id,
    planNo: plan.planNo,
    type: input.type,
    amount: quote.amount,
    currency: quote.currency,
    label: quote.label,
  };
}

/* -------------------------------- capture -------------------------------- */

export type PaypalCaptureResult =
  | {
      status: 'completed';
      payment: Payment;
      alreadyCaptured: boolean;
      message: string;
    }
  | {status: 'pending'; message: string};

/** Captures an approved order and records the payment exactly once. */
export async function capturePaypalForBuyer(input: {
  orderId: string;
  user: User;
}): Promise<PaypalCaptureResult> {
  const orderId = input.orderId.trim();
  if (!orderId) {
    throw new PaypalHttpError('Missing PayPal order id.', 400);
  }

  const before = await loadOrder(orderId);
  if (!before) {
    throw new PaypalHttpError('That PayPal order was not found. Start the payment again.', 404);
  }
  if (before.buyerId !== input.user.id) {
    throw new PaypalHttpError('This PayPal order belongs to another account.', 403);
  }

  if (before.status === 'captured') {
    return {
      status: 'completed',
      payment: await paymentForOrder(before),
      alreadyCaptured: true,
      message: 'This payment was already completed — no second charge was made.',
    };
  }

  // Claim the order atomically. A stale "capturing" row (for example from a
  // request that died mid-flight) can be retried after two minutes.
  const staleBefore = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const claimed = await q(
    `UPDATE paypal_orders
     SET status = 'capturing', updatedAt = $1
     WHERE paypalOrderId = $2
       AND (status IN ('created', 'approved', 'pending', 'failed')
            OR (status = 'capturing' AND updatedAt < $3))
     RETURNING *`,
    [nowIso(), orderId, staleBefore],
  );
  if (!claimed.length) {
    const current = await loadOrder(orderId);
    if (current?.status === 'captured') {
      return {
        status: 'completed',
        payment: await paymentForOrder(current),
        alreadyCaptured: true,
        message: 'This payment was already completed — no second charge was made.',
      };
    }
    throw new PaypalHttpError(
      'This payment is already being checked. Wait a moment and try again.',
      409,
    );
  }

  let capture;
  try {
    capture = await capturePaypalOrder(orderId);
  } catch (e) {
    if (e instanceof PaypalError) {
      const already = e.code === 'ORDER_ALREADY_CAPTURED' || /already captured/i.test(e.message);
      if (already) {
        // The buyer (or a retry) captured it moments earlier. Read the order
        // back and finish recording it instead of charging again.
        try {
          const existing = await getPaypalOrder(orderId);
          if (existing.orderStatus === 'COMPLETED' || existing.captureStatus === 'COMPLETED') {
            return finalizeCapture(orderId, existing.captureId || before.captureId || '');
          }
          await markOrder(orderId, 'pending', null, e.message);
          return {
            status: 'pending',
            message: 'PayPal is still processing this payment. Check again in a moment.',
          };
        } catch (readError) {
          await markOrder(orderId, 'failed', null, describeError(readError));
          throw new PaypalHttpError(describeError(readError), 502);
        }
      }

      if (e.code === 'ORDER_NOT_APPROVED') {
        // Still waiting on the buyer — keep it claimable for the next check.
        await markOrder(orderId, 'created', null, e.message);
        throw new PaypalHttpError(
          'PayPal has not confirmed the payment yet. Approve it in PayPal, then come back and check again.',
          409,
        );
      }

      await markOrder(orderId, 'failed', null, e.message);
      throw new PaypalHttpError(describeError(e), e.status === 503 ? 503 : 502);
    }
    await markOrder(orderId, 'failed', null, describeError(e));
    throw new PaypalHttpError(describeError(e), 502);
  }

  if (capture.captureStatus !== 'COMPLETED') {
    await markOrder(orderId, 'pending', capture.captureId || null, 'PayPal is still processing.');
    return {
      status: 'pending',
      message: 'PayPal is still processing this payment. Check again in a moment.',
    };
  }

  return finalizeCapture(orderId, capture.captureId);
}

async function markOrder(
  orderId: string,
  status: string,
  captureId: string | null,
  error: string | null,
): Promise<void> {
  await q(
    `UPDATE paypal_orders
     SET status = $1, captureId = COALESCE($2, captureId), error = $3, updatedAt = $4
     WHERE paypalOrderId = $5 AND status <> 'captured'`,
    [status, captureId, error ? error.slice(0, 500) : null, nowIso(), orderId],
  );
}

function describeError(e: unknown): string {
  if (e instanceof PaypalError) {
    return e.message;
  }
  if (e instanceof Error) {
    return e.message;
  }
  return 'PayPal could not complete the payment.';
}

async function paymentForOrder(order: PaypalOrderRow): Promise<Payment> {
  if (!order.paymentId) {
    throw new PaypalHttpError('The recorded payment could not be found.', 500);
  }
  const row = await qOne('SELECT * FROM payments WHERE id = $1', [order.paymentId]);
  if (!row) {
    throw new PaypalHttpError('The recorded payment could not be found.', 500);
  }
  return mapPayment(row);
}

/**
 * Writes the payment row and the schedule changes in one transaction, then
 * links the PayPal order to the payment. If this is called twice, the second
 * call returns the original payment and writes nothing.
 */
async function finalizeCapture(orderId: string, captureId: string): Promise<PaypalCaptureResult> {
  const result = await withTransaction(async c => {
    const orderRes = await c.query('SELECT * FROM paypal_orders WHERE paypalOrderId = $1', [
      orderId,
    ]);
    if (!orderRes.rows.length) {
      throw new PaypalHttpError('That PayPal order was not found.', 404);
    }
    const order = mapOrder(normalizeRow(orderRes.rows[0] as Record<string, unknown>));
    if (order.status === 'captured' && order.paymentId) {
      const paymentRes = await c.query('SELECT * FROM payments WHERE id = $1', [order.paymentId]);
      return {
        alreadyCaptured: true,
        payment: paymentRes.rows.length
          ? mapPayment(normalizeRow(paymentRes.rows[0] as Record<string, unknown>))
          : null,
        plan: null as Plan | null,
      };
    }

    const planRes = await c.query('SELECT * FROM plans WHERE id = $1', [order.planId]);
    if (!planRes.rows.length) {
      throw new PaypalHttpError('Plan not found.', 404);
    }
    const plan = mapPlan(normalizeRow(planRes.rows[0] as Record<string, unknown>));

    const scheduleRes = await c.query(
      'SELECT * FROM plan_schedule WHERE planId = $1 ORDER BY dueDate',
      [plan.id],
    );
    const schedule: ScheduleItem[] = scheduleRes.rows.map(row =>
      mapSchedule(normalizeRow(row as Record<string, unknown>)),
    );
    const pending = schedule.filter(item => item.status === 'pending');
    const remaining = round2(
      pending.reduce((sum, item) => sum + Math.max(0, item.amount - item.paidAmount), 0),
    );

    const paidDate = today();
    if (order.type === 'settle') {
      for (const item of pending) {
        await c.query(
          "UPDATE plan_schedule SET status = 'paid', paidDate = $1 WHERE id = $2",
          [paidDate, item.id],
        );
      }
    } else {
      // Same credit rule as recordPayment: spread the principal over the
      // pending installments in order, and leave any remainder as credit on
      // the following one.
      let credit = round2(Math.min(order.principal, remaining));
      for (const item of pending) {
        if (credit <= 0) {
          break;
        }
        const owed = round2(item.amount - item.paidAmount);
        if (owed <= 0) {
          continue;
        }
        if (credit >= owed) {
          credit = round2(credit - owed);
          await c.query(
            "UPDATE plan_schedule SET status = 'paid', paidAmount = amount, paidDate = $1 WHERE id = $2",
            [paidDate, item.id],
          );
        } else {
          await c.query('UPDATE plan_schedule SET paidAmount = paidAmount + $1 WHERE id = $2', [
            credit,
            item.id,
          ]);
          credit = 0;
        }
      }
    }

    const left = await c.query(
      "SELECT COUNT(*)::text AS n FROM plan_schedule WHERE planId = $1 AND status = 'pending'",
      [plan.id],
    );
    if (toNum(normalizeRow(left.rows[0] as Record<string, unknown>).n) === 0) {
      await c.query("UPDATE plans SET status = 'completed' WHERE id = $1", [plan.id]);
    }

    const payment: Payment = {
      id: generateId('pmt-'),
      receiptNo: await cReceiptNo(c),
      planId: plan.id,
      buyerId: plan.buyerId,
      sellerId: plan.sellerId,
      // Monthly/advance keep the penalty separate; a settlement's total
      // already includes the early-pay discount and processing fee, so the
      // receipt must equal what PayPal actually charged.
      amount: round2(order.type === 'settle' ? order.amount : order.principal),
      method: 'PayPal',
      date: paidDate,
      notes: `PayPal ${typeLabel(order.type)} · Order ${orderId}${
        captureId ? ` · Capture ${captureId}` : ''
      }`,
      recordedBy: plan.buyerId,
      penalty: round2(order.penalty),
      type: order.type === 'settle' ? 'settlement' : 'installment',
      createdAt: nowIso(),
    };

    await c.query(
      `INSERT INTO payments
        (id, receiptNo, planId, buyerId, sellerId, amount, method, date, notes,
         recordedBy, penalty, type, createdAt)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        payment.id,
        payment.receiptNo,
        payment.planId,
        payment.buyerId,
        payment.sellerId,
        payment.amount,
        payment.method,
        payment.date,
        payment.notes,
        payment.recordedBy,
        payment.penalty,
        payment.type,
        payment.createdAt,
      ],
    );

    await c.query(
      `UPDATE paypal_orders
       SET status = 'captured', captureId = $1, paymentId = $2, capturedAt = $3,
           updatedAt = $3, error = NULL
       WHERE paypalOrderId = $4 AND status <> 'captured'`,
      [captureId || null, payment.id, nowIso(), orderId],
    );

    return {alreadyCaptured: false, payment, plan};
  });

  if (!result.payment) {
    throw new PaypalHttpError('The recorded payment could not be found.', 500);
  }

  if (!result.alreadyCaptured) {
    await afterPayment(result.payment, result.plan, orderId);
  }

  return {
    status: 'completed',
    payment: result.payment,
    alreadyCaptured: result.alreadyCaptured,
    message: result.alreadyCaptured
      ? 'This payment was already completed — no second charge was made.'
      : 'Payment completed.',
  };
}

/* -------------------------- webhook reconciliation ------------------------ */

export interface PaypalReconcileResult {
  status: 'captured' | 'pending' | 'failed' | 'ignored';
  orderId: string;
  message: string;
  paymentId?: string;
}

type ReconcileClaim = 'claimed' | 'captured' | 'busy';

function completedPaymentId(result: PaypalCaptureResult): string {
  if (result.status !== 'completed') {
    throw new PaypalHttpError('The payment was not completed.', 500);
  }
  return result.payment.id;
}

/**
 * Claims an order for reconciliation. The same stale-after-two-minutes rule
 * as a normal capture applies, so a webhook can safely take over when the app
 * lost its connection mid-capture.
 */
async function claimOrderForReconciliation(orderId: string): Promise<ReconcileClaim> {
  const staleBefore = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const claimed = await q(
    `UPDATE paypal_orders
     SET status = 'capturing', updatedAt = $1
     WHERE paypalOrderId = $2
       AND (status IN ('created', 'approved', 'pending', 'failed')
            OR (status = 'capturing' AND updatedAt < $3))
     RETURNING id`,
    [nowIso(), orderId, staleBefore],
  );
  if (claimed.length) {
    return 'claimed';
  }
  const current = await loadOrder(orderId);
  return current?.status === 'captured' ? 'captured' : 'busy';
}

/** Marks an order failed without touching an already-captured payment. */
export async function failPaypalOrder(
  orderId: string,
  captureId: string | null,
  reason: string,
): Promise<boolean> {
  const order = await loadOrder(orderId);
  if (!order || order.status === 'captured') {
    return false;
  }
  await markOrder(orderId, 'failed', captureId, reason);
  return true;
}

/**
 * Reconciles a local order with PayPal's current state. This is what webhooks
 * call when the app was closed, lost the network or never came back from the
 * browser. It is idempotent: finalizeCapture records the payment only once.
 */
export async function reconcilePaypalOrder(
  orderId: string,
  options: {captureIfApproved?: boolean} = {},
): Promise<PaypalReconcileResult> {
  const order = await loadOrder(orderId);
  if (!order) {
    return {
      status: 'ignored',
      orderId,
      message: 'No local PayPal order matches this webhook event.',
    };
  }
  if (order.status === 'captured') {
    return {
      status: 'captured',
      orderId,
      paymentId: order.paymentId ?? undefined,
      message: 'This payment was already completed — no second charge was made.',
    };
  }

  let remote;
  try {
    remote = await getPaypalOrder(orderId);
  } catch (e) {
    if (
      e instanceof PaypalError &&
      (e.code === 'RESOURCE_NOT_FOUND' || e.code === 'INVALID_RESOURCE_ID')
    ) {
      await failPaypalOrder(orderId, order.captureId, 'PayPal could not find this order.');
      return {status: 'failed', orderId, message: 'PayPal could not find this order.'};
    }
    throw e;
  }

  if (remote.orderStatus === 'COMPLETED' || remote.captureStatus === 'COMPLETED') {
    if (!remote.captureId) {
      await markOrder(orderId, 'pending', null, 'PayPal completed the order without a capture id.');
      return {
        status: 'pending',
        orderId,
        message: 'PayPal completed the order but has not returned a capture id yet.',
      };
    }
    const claim = await claimOrderForReconciliation(orderId);
    if (claim === 'busy') {
      throw new PaypalHttpError('PayPal is still finalizing this payment. Retry the webhook shortly.', 503);
    }
    if (claim === 'captured') {
      const current = await loadOrder(orderId);
      return {
        status: 'captured',
        orderId,
        paymentId: current?.paymentId ?? undefined,
        message: 'This payment was already completed — no second charge was made.',
      };
    }
    const result = await finalizeCapture(orderId, remote.captureId);
    return {
      status: 'captured',
      orderId,
      paymentId: completedPaymentId(result),
      message: result.message,
    };
  }

  if (options.captureIfApproved && remote.orderStatus === 'APPROVED') {
    const claim = await claimOrderForReconciliation(orderId);
    if (claim === 'busy') {
      throw new PaypalHttpError('PayPal is still finalizing this payment. Retry the webhook shortly.', 503);
    }
    if (claim === 'captured') {
      const current = await loadOrder(orderId);
      return {
        status: 'captured',
        orderId,
        paymentId: current?.paymentId ?? undefined,
        message: 'This payment was already completed — no second charge was made.',
      };
    }

    try {
      const capture = await capturePaypalOrder(orderId);
      if (capture.captureStatus !== 'COMPLETED') {
        await markOrder(orderId, 'pending', capture.captureId || null, 'PayPal is still processing.');
        return {
          status: 'pending',
          orderId,
          message: 'PayPal is still processing this payment.',
        };
      }
      const result = await finalizeCapture(orderId, capture.captureId);
      return {status: 'captured', orderId, paymentId: completedPaymentId(result), message: result.message};
    } catch (e) {
      if (e instanceof PaypalError) {
        if (e.code === 'ORDER_ALREADY_CAPTURED' || /already captured/i.test(e.message)) {
          const existing = await getPaypalOrder(orderId);
          if (
            (existing.orderStatus === 'COMPLETED' || existing.captureStatus === 'COMPLETED') &&
            existing.captureId
          ) {
            const result = await finalizeCapture(orderId, existing.captureId);
            return {status: 'captured', orderId, paymentId: completedPaymentId(result), message: result.message};
          }
          await markOrder(orderId, 'pending', existing.captureId || null, 'PayPal is still processing.');
          return {status: 'pending', orderId, message: 'PayPal is still processing this payment.'};
        }
        if (e.code === 'ORDER_NOT_APPROVED') {
          await markOrder(orderId, 'created', null, e.message);
          return {status: 'pending', orderId, message: 'PayPal has not confirmed the approval yet.'};
        }
        await markOrder(orderId, 'failed', null, e.message);
        return {status: 'failed', orderId, message: e.message};
      }
      throw e;
    }
  }

  if (
    remote.orderStatus === 'VOIDED' ||
    remote.captureStatus === 'DENIED' ||
    remote.captureStatus === 'FAILED'
  ) {
    const failed = await failPaypalOrder(
      orderId,
      remote.captureId || null,
      'PayPal did not complete this payment.',
    );
    return {
      status: failed ? 'failed' : 'ignored',
      orderId,
      message: failed ? 'PayPal did not complete this payment.' : 'The order was already captured.',
    };
  }

  await markOrder(orderId, 'pending', remote.captureId || null, 'PayPal is still processing.');
  return {
    status: 'pending',
    orderId,
    message: 'PayPal is still processing this payment.',
  };
}

/** Notifications and the audit entry, written after the payment commits. */
async function afterPayment(
  payment: Payment,
  plan: Plan | null,
  orderId: string,
): Promise<void> {
  if (!plan) {
    return;
  }
  const body = `${plan.id}|${payment.amount} paid via PayPal on ${plan.planNo}. Receipt ${payment.receiptNo}.`;
  await q(
    `INSERT INTO notifications (id, userId, type, title, body, isRead, createdAt)
     VALUES ($1,$2,'money','PayPal payment received',$3,0,$4)`,
    [generateId('n-'), plan.sellerId, body, nowIso()],
  );
  await q(
    `INSERT INTO notifications (id, userId, type, title, body, isRead, createdAt)
     VALUES ($1,$2,'success','PayPal payment confirmed',$3,0,$4)`,
    [generateId('n-'), plan.buyerId, body, nowIso()],
  );
  await q(
    'INSERT INTO audit_log (id, userId, action, detail, createdAt) VALUES ($1,$2,$3,$4,$5)',
    [
      generateId('a-'),
      plan.buyerId,
      'payment.paypal',
      `PayPal ${typeLabel(payment.type === 'settlement' ? 'settle' : 'monthly')} ${payment.amount} on ${plan.planNo} (order ${orderId})`,
      nowIso(),
    ],
  );
}

function typeLabel(type: PaypalPaymentType | string): string {
  switch (type) {
    case 'monthly':
      return 'Monthly fee';
    case 'advance':
      return 'Advance payment';
    case 'settle':
      return 'Early settlement';
    default:
      return 'Payment';
  }
}
