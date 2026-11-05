/**
 * PayPal webhook handling.
 *
 * Every delivery is verified with PayPal, stored under its event id, and then
 * reconciled against the local order. The event id is the idempotency key, so
 * PayPal retries and duplicate deliveries cannot record a payment twice.
 *
 * The webhook is a safety net, not the primary path: the app still captures
 * when it returns from the browser. If the app closed, lost the network, or
 * the return deep link never arrived, the webhook finishes recording the
 * payment from PayPal's authoritative capture state.
 */
import {toStr} from '../convert';
import {getPool, normalizeRow, q} from '../db';
import {nowIso} from './date';
import {generateId} from './id';
import {verifyPaypalWebhook, type PaypalWebhookHeaders} from './paypal';
import {
  failPaypalOrder,
  PaypalHttpError,
  reconcilePaypalOrder,
  type PaypalReconcileResult,
} from './paypalPayments';

export interface PaypalWebhookEvent {
  id: string;
  event_type: string;
  resource?: unknown;
  [key: string]: unknown;
}

export interface PaypalWebhookResult {
  ok: true;
  duplicate: boolean;
  result: 'processed' | 'ignored' | 'pending' | 'failed';
  orderId?: string;
  message: string;
}

interface WebhookEventRow {
  eventId: string;
  status: string;
  receivedAt: string;
  claimToken?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function parseEvent(value: unknown): PaypalWebhookEvent | null {
  const event = asRecord(value);
  if (!event || !toStr(event.id).trim() || !toStr(event.event_type).trim()) {
    return null;
  }
  return event as PaypalWebhookEvent;
}

/** Gets the order and capture ids out of the two PayPal resource shapes. */
function eventIds(event: PaypalWebhookEvent): {orderId: string; captureId: string} {
  const resource = asRecord(event.resource);
  const type = toStr(event.event_type);
  if (type.startsWith('CHECKOUT.ORDER.')) {
    return {orderId: toStr(resource?.id), captureId: ''};
  }
  const supplementary = asRecord(resource?.supplementary_data);
  const related = asRecord(supplementary?.related_ids);
  return {
    orderId: toStr(related?.order_id),
    captureId: toStr(resource?.id),
  };
}

/**
 * Claims an event for processing. A fresh `processing` row means another
 * request is working on it; an old one is treated as abandoned. A failed
 * event is deliberately retryable because PayPal will deliver it again.
 */
async function claimEvent(event: PaypalWebhookEvent, orderId: string, captureId: string): Promise<boolean> {
  const token = generateId('whc-');
  const receivedAt = nowIso();
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO paypal_webhook_events
        (eventId, eventType, paypalOrderId, captureId, status, error, claimToken, receivedAt, processedAt)
       VALUES ($1,$2,$3,$4,'processing',NULL,$5,$6,NULL)
       ON CONFLICT (eventId) DO NOTHING`,
      [event.id, event.event_type, orderId || null, captureId || null, token, receivedAt],
    );
    const result = await client.query(
      'SELECT * FROM paypal_webhook_events WHERE eventId = $1 FOR UPDATE',
      [event.id],
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return false;
    }
    const existing = normalizeRow(
      result.rows[0] as Record<string, unknown>,
    ) as unknown as WebhookEventRow;
    if (existing.claimToken === token) {
      await client.query('COMMIT');
      return true;
    }
    if (existing.status === 'processing') {
      const age = Date.now() - Date.parse(existing.receivedAt);
      if (!Number.isFinite(age) || age < 2 * 60 * 1000) {
        await client.query('COMMIT');
        return false;
      }
    } else if (existing.status !== 'failed') {
      await client.query('COMMIT');
      return false;
    }

    await client.query(
      `UPDATE paypal_webhook_events
       SET status = 'processing', error = NULL, claimToken = $1,
           receivedAt = $2, processedAt = NULL
       WHERE eventId = $3`,
      [token, receivedAt, event.id],
    );
    await client.query('COMMIT');
    return true;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function finishEvent(eventId: string, status: string, error: string | null): Promise<void> {
  await q(
    `UPDATE paypal_webhook_events
     SET status = $1, error = $2, processedAt = $3
     WHERE eventId = $4`,
    [status, error ? error.slice(0, 500) : null, nowIso(), eventId],
  );
}

function ignored(message: string, orderId = ''): PaypalWebhookResult {
  return {ok: true, duplicate: false, result: 'ignored', orderId: orderId || undefined, message};
}

async function processEvent(
  event: PaypalWebhookEvent,
  orderId: string,
  captureId: string,
): Promise<PaypalWebhookResult> {
  const type = toStr(event.event_type);
  if (!orderId) {
    return ignored('The event has no related PayPal order; nothing to reconcile.');
  }

  let result: PaypalReconcileResult;
  if (type === 'PAYMENT.CAPTURE.DENIED') {
    const failed = await failPaypalOrder(orderId, captureId || null, 'PayPal denied the payment.');
    return {
      ok: true,
      duplicate: false,
      result: failed ? 'failed' : 'ignored',
      orderId,
      message: failed ? 'PayPal denied the payment.' : 'The order was already captured; denial ignored.',
    };
  }

  if (type === 'PAYMENT.CAPTURE.REFUNDED' || type === 'PAYMENT.CAPTURE.REVERSED') {
    // Reversing a completed payment changes the schedule and the receipt.
    // That is a business decision, so record the event and leave the payment
    // untouched instead of silently rewriting history.
    return ignored(
      'Refund/reversal recorded. The payment was not changed automatically; review it in PayPal.',
      orderId,
    );
  }

  if (type === 'CHECKOUT.ORDER.APPROVED') {
    result = await reconcilePaypalOrder(orderId, {captureIfApproved: true});
  } else if (
    type === 'CHECKOUT.ORDER.COMPLETED' ||
    type === 'PAYMENT.CAPTURE.COMPLETED' ||
    type === 'PAYMENT.CAPTURE.PENDING'
  ) {
    result = await reconcilePaypalOrder(orderId);
  } else {
    return ignored(`PayPal event ${type} is not used by this server.`, orderId);
  }

  return {
    ok: true,
    duplicate: false,
    result: result.status === 'captured' ? 'processed' : result.status,
    orderId,
    message: result.message,
  };
}

/** Verifies, deduplicates and reconciles one PayPal webhook delivery. */
export async function handlePaypalWebhook(input: {
  headers: PaypalWebhookHeaders;
  event: unknown;
}): Promise<PaypalWebhookResult> {
  const event = parseEvent(input.event);
  if (!event) {
    throw new PaypalHttpError('Invalid PayPal webhook payload.', 400);
  }

  const missing = Object.entries(input.headers)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new PaypalHttpError(`Missing PayPal webhook header: ${missing.join(', ')}.`, 400);
  }

  const verified = await verifyPaypalWebhook({headers: input.headers, event});
  if (!verified) {
    throw new PaypalHttpError('PayPal webhook signature verification failed.', 401);
  }

  const ids = eventIds(event);
  const claimed = await claimEvent(event, ids.orderId, ids.captureId);
  if (!claimed) {
    return {
      ok: true,
      duplicate: true,
      result: 'ignored',
      orderId: ids.orderId || undefined,
      message: 'This PayPal event was already handled.',
    };
  }

  try {
    const result = await processEvent(event, ids.orderId, ids.captureId);
    await finishEvent(event.id, result.result === 'ignored' ? 'ignored' : 'processed', null);
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'PayPal webhook processing failed.';
    await finishEvent(event.id, 'failed', message);
    throw e;
  }
}