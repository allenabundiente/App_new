/**
 * PayPal integration tests. The Express app, Postgres (pg-mem), routes,
 * PayPal order rows and webhook event rows are real; only the outbound
 * PayPal HTTP calls are mocked. This covers the failure/retry cases that are
 * hard to trigger by hand in Sandbox.
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import request from 'supertest';
import {newDb} from 'pg-mem';
import {q, qOne, setPool} from './db';
import {seedDatabase} from './seed';

process.env.PAYPAL_CLIENT_ID = 'test-client-id';
process.env.PAYPAL_CLIENT_SECRET = 'test-client-secret';
process.env.PAYPAL_WEBHOOK_ID = 'test-webhook-id';
process.env.PAYPAL_MODE = 'sandbox';
process.env.PAYPAL_CURRENCY = 'PHP';

let app: import('express').Express;
let buyerToken: string;
let planId: string;
let originalFetch: typeof fetch;

type MockOrder = {status: string; captureId?: string};
const paypalOrders = new Map<string, MockOrder>();
let orderSeq = 0;
let verifyStatus = 'SUCCESS';
let nextCaptureFailure: {status: number; name: string; message: string} | null = null;

const WEBHOOK_HEADERS = {
  'paypal-transmission-id': 'transmission-test',
  'paypal-transmission-time': '2026-11-05T10:00:00Z',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-TEST',
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-transmission-sig': 'test-signature',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json'},
  });
}

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return String((input as {url?: string}).url ?? input);
}

function completedBody(orderId: string, captureId: string): unknown {
  return {
    id: orderId,
    status: 'COMPLETED',
    purchase_units: [
      {
        payments: {
          captures: [
            {
              id: captureId,
              status: 'COMPLETED',
              amount: {value: '100.00', currency_code: 'PHP'},
            },
          ],
        },
      },
    ],
  };
}

function orderBody(orderId: string, order: MockOrder): unknown {
  return {
    id: orderId,
    status: order.status,
    purchase_units: [
      {
        payments: order.captureId
          ? {
              captures: [
                {
                  id: order.captureId,
                  status: 'COMPLETED',
                  amount: {value: '100.00', currency_code: 'PHP'},
                },
              ],
            }
          : {captures: []},
      },
    ],
  };
}

function installFetchMock(): void {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown): Promise<Response> => {
    const path = new URL(urlOf(input)).pathname;

    if (path === '/v1/oauth2/token') {
      return jsonResponse({access_token: 'test-access-token', expires_in: 3600});
    }
    if (path === '/v1/notifications/verify-webhook-signature') {
      return jsonResponse({verification_status: verifyStatus});
    }
    if (path === '/v2/checkout/orders') {
      const orderId = `PAYPAL-TEST-${++orderSeq}`;
      paypalOrders.set(orderId, {status: 'CREATED'});
      return jsonResponse({
        id: orderId,
        status: 'CREATED',
        links: [{rel: 'approve', href: `https://sandbox.paypal.com/checkoutnow?token=${orderId}`}],
      });
    }

    const captureMatch = path.match(/^\/v2\/checkout\/orders\/([^/]+)\/capture$/);
    if (captureMatch) {
      const orderId = decodeURIComponent(captureMatch[1]);
      if (nextCaptureFailure) {
        const failure = nextCaptureFailure;
        nextCaptureFailure = null;
        return jsonResponse({name: failure.name, message: failure.message}, failure.status);
      }
      const order = paypalOrders.get(orderId);
      if (!order) {
        return jsonResponse({name: 'RESOURCE_NOT_FOUND', message: 'Order not found.'}, 404);
      }
      if (order.captureId) {
        return jsonResponse({name: 'ORDER_ALREADY_CAPTURED', message: 'Order already captured.'}, 422);
      }
      const captureId = `CAPTURE-${orderId}`;
      paypalOrders.set(orderId, {status: 'COMPLETED', captureId});
      return jsonResponse(completedBody(orderId, captureId));
    }

    const getMatch = path.match(/^\/v2\/checkout\/orders\/([^/]+)$/);
    if (getMatch) {
      const orderId = decodeURIComponent(getMatch[1]);
      const order = paypalOrders.get(orderId);
      if (!order) {
        return jsonResponse({name: 'RESOURCE_NOT_FOUND', message: 'Order not found.'}, 404);
      }
      return jsonResponse(orderBody(orderId, order));
    }

    throw new Error(`Unexpected PayPal mock request: ${path}`);
  }) as typeof fetch;
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({email, password}).expect(200);
  return res.body.token as string;
}

async function createOrder(): Promise<string> {
  const res = await request(app)
    .post('/api/payments/paypal/create-order')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({planId, type: 'monthly'})
    .expect(201);
  return res.body.orderId as string;
}

function captureOrder(orderId: string) {
  return request(app)
    .post('/api/payments/paypal/capture')
    .set('Authorization', `Bearer ${buyerToken}`)
    .send({orderId});
}

function webhook(event: unknown) {
  return request(app)
    .post('/api/payments/paypal/webhook')
    .set(WEBHOOK_HEADERS)
    .send(event as object);
}

async function paymentCount(orderId: string): Promise<number> {
  const row = await qOne<{n: string}>(
    'SELECT COUNT(*)::text AS n FROM payments WHERE notes LIKE $1',
    [`%${orderId}%`],
  );
  return Number(row?.n ?? 0);
}

async function orderStatus(orderId: string): Promise<string> {
  const row = await qOne<{status: string}>(
    'SELECT status FROM paypal_orders WHERE paypalOrderId = $1',
    [orderId],
  );
  return row?.status ?? '';
}

beforeAll(async () => {
  const mem = newDb();
  const {Pool} = mem.adapters.createPg();
  const pool = new Pool();
  setPool(pool);

  const schema = readFileSync(join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await seedDatabase();

  installFetchMock();
  const {createApp} = await import('./app');
  app = createApp();

  buyerToken = await login('buyer@hulog.ph', 'buyer123');
  const plans = await request(app)
    .get('/api/plans?buyerId=u-buyer')
    .set('Authorization', `Bearer ${buyerToken}`)
    .expect(200);
  const plan = (plans.body.plans as Array<{id: string; status: string}>).find(
    p => p.status === 'active',
  );
  if (!plan) {
    throw new Error('No active seeded plan for the PayPal tests.');
  }
  planId = plan.id;
});

beforeEach(() => {
  verifyStatus = 'SUCCESS';
  nextCaptureFailure = null;
});

afterAll(() => {
  setPool(null);
  globalThis.fetch = originalFetch;
});

describe('PayPal capture', () => {
  test('records one payment and treats a repeated capture as already done', async () => {
    const orderId = await createOrder();

    const first = await captureOrder(orderId).expect(200);
    expect(first.body.status).toBe('completed');
    expect(first.body.alreadyCaptured).toBe(false);
    expect(first.body.payment.method).toBe('PayPal');

    const second = await captureOrder(orderId).expect(200);
    expect(second.body.status).toBe('completed');
    expect(second.body.alreadyCaptured).toBe(true);

    expect(await paymentCount(orderId)).toBe(1);
    expect(await orderStatus(orderId)).toBe('captured');
  });

  test('leaves a declined capture retryable and records the retry once', async () => {
    const orderId = await createOrder();
    nextCaptureFailure = {
      status: 422,
      name: 'INSTRUMENT_DECLINED',
      message: 'The instrument presented was either declined by the processor or bank.',
    };

    const failed = await captureOrder(orderId).expect(502);
    expect(failed.body.error).toContain('declined');
    expect(await orderStatus(orderId)).toBe('failed');
    expect(await paymentCount(orderId)).toBe(0);

    const retried = await captureOrder(orderId).expect(200);
    expect(retried.body.status).toBe('completed');
    expect(await paymentCount(orderId)).toBe(1);
    expect(await orderStatus(orderId)).toBe('captured');
  });
});

describe('PayPal webhooks', () => {
  test('reconciles a completed capture and ignores the duplicate delivery', async () => {
    const orderId = await createOrder();
    const captureId = `CAPTURE-${orderId}`;
    paypalOrders.set(orderId, {status: 'COMPLETED', captureId});
    const eventId = `evt-completed-${orderId}`;
    const event = {
      id: eventId,
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: captureId,
        status: 'COMPLETED',
        supplementary_data: {related_ids: {order_id: orderId}},
      },
    };

    const first = await webhook(event).expect(200);
    expect(first.body.result).toBe('processed');
    expect(first.body.duplicate).toBe(false);
    expect(await paymentCount(orderId)).toBe(1);
    expect(await orderStatus(orderId)).toBe('captured');

    const duplicate = await webhook(event).expect(200);
    expect(duplicate.body.duplicate).toBe(true);
    expect(await paymentCount(orderId)).toBe(1);

    const stored = await qOne<{status: string}>(
      'SELECT status FROM paypal_webhook_events WHERE eventId = $1',
      [eventId],
    );
    expect(stored?.status).toBe('processed');
  });

  test('captures an approved order when the app never returned from PayPal', async () => {
    const orderId = await createOrder();
    paypalOrders.set(orderId, {status: 'APPROVED'});
    const event = {
      id: `evt-approved-${orderId}`,
      event_type: 'CHECKOUT.ORDER.APPROVED',
      resource: {id: orderId, status: 'APPROVED'},
    };

    const res = await webhook(event).expect(200);
    expect(res.body.result).toBe('processed');
    expect(await paymentCount(orderId)).toBe(1);
    expect(await orderStatus(orderId)).toBe('captured');
  });

  test('marks a denied capture failed without writing a payment', async () => {
    const orderId = await createOrder();
    const event = {
      id: `evt-denied-${orderId}`,
      event_type: 'PAYMENT.CAPTURE.DENIED',
      resource: {
        id: `CAPTURE-${orderId}`,
        status: 'DENIED',
        supplementary_data: {related_ids: {order_id: orderId}},
      },
    };

    const res = await webhook(event).expect(200);
    expect(res.body.result).toBe('failed');
    expect(await paymentCount(orderId)).toBe(0);
    expect(await orderStatus(orderId)).toBe('failed');
  });

  test('rejects a delivery whose signature PayPal does not verify', async () => {
    verifyStatus = 'FAILURE';
    const res = await webhook({
      id: 'evt-bad-signature',
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {id: 'CAPTURE-X', supplementary_data: {related_ids: {order_id: 'PAYPAL-X'}}},
    }).expect(401);
    expect(res.body.error).toContain('signature');

    const stored = await q<{eventId: string}>(
      'SELECT * FROM paypal_webhook_events WHERE eventId = $1',
      ['evt-bad-signature'],
    );
    expect(stored).toHaveLength(0);
  });

  test('ignores an event for an order this server does not own', async () => {
    const eventId = 'evt-unknown-order';
    const res = await webhook({
      id: eventId,
      event_type: 'PAYMENT.CAPTURE.COMPLETED',
      resource: {
        id: 'CAPTURE-UNKNOWN',
        supplementary_data: {related_ids: {order_id: 'PAYPAL-UNKNOWN'}},
      },
    }).expect(200);
    expect(res.body.result).toBe('ignored');
    expect(await paymentCount('PAYPAL-UNKNOWN')).toBe(0);
  });
});