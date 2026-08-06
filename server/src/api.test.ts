/**
 * API integration tests — run the REAL Express app against an in-memory
 * Postgres emulator (pg-mem), so the full stack (routes → services → SQL)
 * is exercised without a database server or network.
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import request from 'supertest';
import {newDb} from 'pg-mem';
import {setPool} from './db';
import {createApp} from './app';
import {seedDatabase} from './seed';
import {addMonths} from './services/date';

let app: ReturnType<typeof createApp>;
let adminToken: string;
let sellerToken: string;
let buyerToken: string;
let createdPlanId: string;

beforeAll(async () => {
  const mem = newDb();
  // pg-mem ships a drop-in pg Pool/Client pair — the standard way to test
  // node-postgres code without a real database server.
  const {Pool} = mem.adapters.createPg();
  const pool = new Pool();
  setPool(pool);

  const schema = readFileSync(join(__dirname, '..', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await seedDatabase();

  process.env.CRON_SECRET = 'test-secret';
  app = createApp();
});

afterAll(async () => {
  setPool(null);
});

async function login(email: string, password: string): Promise<string> {
  const res = await request(app)
    .post('/api/auth/login')
    .send({email, password})
    .expect(200);
  return res.body.token as string;
}

describe('auth', () => {
  test('demo admin can log in and fetch /api/me', async () => {
    adminToken = await login('admin@hulog.ph', 'admin123');
    const me = await request(app)
      .get('/api/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(me.body.user.email).toBe('admin@hulog.ph');
    expect(me.body.user.password).toBe(''); // hash never leaks
  });

  test('wrong password is rejected', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({email: 'seller@hulog.ph', password: 'nope'})
      .expect(401);
    expect(res.body.reason).toContain('Incorrect');
  });

  test('pending account cannot log in', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({email: 'buyer2@hulog.ph', password: 'buyer123'})
      .expect(403);
    expect(res.body.reason).toContain('verification');
  });

  test('requests without a token are rejected', async () => {
    await request(app).get('/api/plans').expect(401);
  });
});

describe('seller flow', () => {
  test('seller sees seeded plans with an overdue one', async () => {
    sellerToken = await login('seller@hulog.ph', 'seller123');
    const res = await request(app)
      .get('/api/plans?sellerId=u-seller')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect(res.body.plans.length).toBe(5);
    const overdue = res.body.plans.find((p: {planNo: string}) => p.planNo === 'HT-1003');
    const derived = await request(app)
      .get(`/api/plans/${overdue.id}/derived`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect(derived.body.derived.status).toBe('overdue');
    expect(derived.body.derived.penalty).toBeGreaterThan(0);
  });

  test('create a plan generates a schedule and a receipt-numbered down payment', async () => {
    const res = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        sellerId: 'u-seller',
        buyerId: 'u-buyer5',
        productId: 'p1',
        productName: 'TechPhone X5 128GB',
        productEmoji: '📱',
        price: 12000,
        downPayment: 2000,
        apr: 24,
        term: 6,
        startDate: '2026-08-01',
        notes: '',
      })
      .expect(201);
    createdPlanId = res.body.plan.id;
    expect(res.body.plan.planNo).toMatch(/^HT-\d{4}$/);
    expect(res.body.plan.installment).toBeGreaterThan(0);

    const schedule = await request(app)
      .get(`/api/plans/${createdPlanId}/schedule`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect(schedule.body.schedule).toHaveLength(6);
    expect(schedule.body.schedule[0].dueDate).toBe('2026-09-01');

    const payments = await request(app)
      .get(`/api/plans/${createdPlanId}/payments`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect(payments.body.payments).toHaveLength(1); // the down payment
    expect(payments.body.payments[0].type).toBe('down');
  });

  test('record a payment marks the installment paid and notifies the buyer', async () => {
    const res = await request(app)
      .post(`/api/plans/${createdPlanId}/payments`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({amount: 1800, method: 'GCash', date: '2026-09-01', notes: '', recordedBy: 'u-seller'})
      .expect(201);
    expect(res.body.payment.receiptNo).toMatch(/^R-\d{4}$/);

    const schedule = await request(app)
      .get(`/api/plans/${createdPlanId}/schedule`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect(schedule.body.schedule[0].status).toBe('paid');

    buyerToken = await login('sofia@hulog.ph', 'buyer123');
    const notifs = await request(app)
      .get('/api/notifications?userId=u-buyer5')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);
    expect(notifs.body.notifications.some((n: {title: string}) => n.title.includes('Payment received'))).toBe(true);
  });

  test('a late payment accrues a penalty', async () => {
    // Installment #2 is due 2026-10-01; paying 9 days past it (beyond the
    // 3-day grace) must attach a penalty.
    const res = await request(app)
      .post(`/api/plans/${createdPlanId}/payments`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({amount: 1800, method: 'Cash', date: '2026-10-10', notes: 'late', recordedBy: 'u-seller'})
      .expect(201);
    expect(res.body.payment.penalty).toBeGreaterThan(0);
  });
});

describe('adjustments', () => {
  test('buyer requests a reschedule; seller approves; dues shift by 2 months', async () => {
    const before = await request(app)
      .get(`/api/plans/${createdPlanId}/schedule`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);
    const nextDueDate = before.body.schedule.find((s: {status: string}) => s.status === 'pending')
      .dueDate as string;

    const reqRes = await request(app)
      .post('/api/adjustments')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({
        planId: createdPlanId,
        buyerId: 'u-buyer5',
        type: 'reschedule',
        reason: 'Need more time',
        detailJson: JSON.stringify({months: 2}),
      })
      .expect(201);

    const pending = await request(app)
      .get(`/api/adjustments/pending?sellerId=u-seller`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect(pending.body.adjustments.some((a: {id: string}) => a.id === reqRes.body.adjustment.id)).toBe(true);

    await request(app)
      .post(`/api/adjustments/${reqRes.body.adjustment.id}/resolve`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({approve: true, resolverId: 'u-seller', note: ''})
      .expect(200);

    const after = await request(app)
      .get(`/api/plans/${createdPlanId}/schedule`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    // The old due date must be gone…
    const old = after.body.schedule.find(
      (s: {dueDate: string; status: string}) => s.status === 'pending' && s.dueDate === nextDueDate,
    );
    expect(old).toBeUndefined();
    // …and the same installment must now be due 2 months later (this exact
    // assertion would have caught the 1900-02-01 due-date bug).
    const expected = addMonths(nextDueDate, 2);
    const pushed = after.body.schedule.find(
      (s: {dueDate: string; status: string}) => s.status === 'pending' && s.dueDate === expected,
    );
    expect(pushed).toBeDefined();
  });
});

describe('health & due-reminder cron', () => {
  test('health endpoint is public (no token needed)', async () => {
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body.ok).toBe(true);
  });

  test('cron endpoint rejects a missing/wrong secret', async () => {
    await request(app).post('/api/cron/reminders').expect(401);
    await request(app)
      .post('/api/cron/reminders')
      .set('x-cron-secret', 'wrong')
      .expect(401);
  });

  test('generates buyer + seller due reminders once, then dedups', async () => {
    // A plan whose installments fell due months ago → overdue for sure.
    const plan = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        sellerId: 'u-seller',
        buyerId: 'u-buyer5',
        productId: 'p1',
        productName: 'Old TV',
        productEmoji: '📺',
        price: 6000,
        downPayment: 1000,
        apr: 24,
        term: 3,
        startDate: '2026-01-01',
        notes: '',
      })
      .expect(201);
    const planNo = plan.body.plan.planNo as string;

    const first = await request(app)
      .post('/api/cron/reminders')
      .set('x-cron-secret', 'test-secret')
      .expect(200);
    expect(first.body.ok).toBe(true);
    expect(first.body.generated).toBeGreaterThan(0);

    // Buyer was alerted (overdue) and seller got the parallel alert.
    const buyerNotifs = await request(app)
      .get('/api/notifications?userId=u-buyer5')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);
    const buyerBodies = buyerNotifs.body.notifications.map((n: {body: string}) => String(n.body));
    expect(buyerBodies.some((b: string) => b.includes(planNo))).toBe(true);

    const sellerNotifs = await request(app)
      .get('/api/notifications?userId=u-seller')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    const sellerBodies = sellerNotifs.body.notifications.map((n: {body: string}) => String(n.body));
    expect(sellerBodies.some((b: string) => b.includes(planNo))).toBe(true);

    // Second run must not duplicate anything.
    const second = await request(app)
      .post('/api/cron/reminders')
      .set('x-cron-secret', 'test-secret')
      .expect(200);
    expect(second.body.generated).toBe(0);
  });
});

describe('admin', () => {
  test('admin sees all payments and can verify a pending user', async () => {
    const res = await request(app)
      .get('/api/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.payments.length).toBeGreaterThan(0);

    await request(app)
      .patch('/api/users/u-buyer2/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({status: 'active'})
      .expect(200);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({email: 'buyer2@hulog.ph', password: 'buyer123'})
      .expect(200);
    expect(loginRes.body.token).toBeTruthy();
  });
});
