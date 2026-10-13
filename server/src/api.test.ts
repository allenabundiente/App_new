/**
 * Tests for the API. These run the real Express app against an in-memory
 * Postgres (pg-mem), so the routes, the services and the SQL all get tested
 * without needing a database server.
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
  // pg-mem gives us its own Pool and Client so the app can't tell the
  // difference from the real thing.
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
    expect(me.body.user.password).toBe(''); // the hash must never leak
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
    expect(payments.body.payments).toHaveLength(1); // just the down payment
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
    // Installment 2 is due 2026-10-01. Paying 9 days late is past the 3 day
    // grace period, so a penalty should be added.
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
    // The old due date should not be there any more.
    const old = after.body.schedule.find(
      (s: {dueDate: string; status: string}) => s.status === 'pending' && s.dueDate === nextDueDate,
    );
    expect(old).toBeUndefined();
    // The same installment is now due 2 months later. This is the check
    // that caught the bug where the date came back as 1900-02-01.
    const expected = addMonths(nextDueDate, 2);
    const pushed = after.body.schedule.find(
      (s: {dueDate: string; status: string}) => s.status === 'pending' && s.dueDate === expected,
    );
    expect(pushed).toBeDefined();
  });
});

describe('profile & notifications', () => {
  test('user can edit their own profile (name/phone)', async () => {
    const res = await request(app)
      .patch('/api/users/u-buyer5/profile')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({name: 'Sofia V. Tan', phone: '+63 917 111 2222'})
      .expect(200);
    expect(res.body.user.name).toBe('Sofia V. Tan');
    expect(res.body.user.phone).toBe('+63 917 111 2222');
    // the password hash shouldn't come back from the profile route either
    expect(res.body.user.password).toBe('');
  });

  test('cannot take another user\'s email', async () => {
    await request(app)
      .patch('/api/users/u-buyer5/profile')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({email: 'seller@hulog.ph'})
      .expect(409);
  });

  test('cannot edit someone else\'s profile as a non-admin', async () => {
    await request(app)
      .patch('/api/users/u-buyer/profile')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({name: 'Hacked'})
      .expect(403);
  });

  test('password change requires the current password and works after', async () => {
    await request(app)
      .post('/api/users/u-buyer5/password')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({currentPassword: 'wrong', newPassword: 'newpass123'})
      .expect(401);

    await request(app)
      .post('/api/users/u-buyer5/password')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({currentPassword: 'buyer123', newPassword: 'newpass123'})
      .expect(200);

    // The old password stops working and the new one logs in.
    await request(app)
      .post('/api/auth/login')
      .send({email: 'sofia@hulog.ph', password: 'buyer123'})
      .expect(401);
    await request(app)
      .post('/api/auth/login')
      .send({email: 'sofia@hulog.ph', password: 'newpass123'})
      .expect(200);

    // Put it back so the tests further down still work.
    await request(app)
      .post('/api/users/u-buyer5/password')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({currentPassword: 'newpass123', newPassword: 'buyer123'})
      .expect(200);
  });

  test('opening the notification sheet marks everything read', async () => {
    const before = await request(app)
      .get('/api/notifications/unread?userId=u-buyer5')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);
    expect(before.body.count).toBeGreaterThan(0);

    await request(app)
      .post('/api/notifications/read')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({userId: 'u-buyer5'})
      .expect(200);

    const after = await request(app)
      .get('/api/notifications/unread?userId=u-buyer5')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);
    expect(after.body.count).toBe(0);
  });
});

describe('chat notifications', () => {
  test('sending a message notifies the recipient; chat-read clears per plan', async () => {
    // u-seller has two plans with Sofia.
    const plans = await request(app)
      .get('/api/plans?buyerId=u-buyer5')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    const planA = plans.body.plans.find((p: {planNo: string}) => p.planNo === 'HT-1004');
    const planB = plans.body.plans.find((p: {planNo: string}) => p.planNo === 'HT-1006');
    expect(planA).toBeTruthy();
    expect(planB).toBeTruthy();

    // u-seller sends Sofia a message on HT-1004.
    await request(app)
      .post('/api/messages')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        planId: planA.id,
        senderId: 'u-seller',
        recipientId: 'u-buyer5',
        text: 'Hi Sofia — installments on track!',
      })
      .expect(201);

    // Sofia gets a notification with the plan id in front of the message.
    const notifs = await request(app)
      .get('/api/notifications?userId=u-buyer5')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);
    const chatNotifs = notifs.body.notifications.filter((n: {type: string}) => n.type === 'chat');
    const forA = chatNotifs.find((n: {body: string}) => n.body.startsWith(`${planA.id}|`));
    expect(forA).toBeTruthy();
    expect(forA.title).toBe('New message on HT-1004');
    expect(forA.body).toContain('Hi Sofia — installments on track!');
    expect(forA.isRead).toBe(false);

    // Marking the first plan's chat as read only clears that one.
    await request(app)
      .post('/api/notifications/chat-read')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({userId: 'u-buyer5', planId: planA.id})
      .expect(200);

    const after = await request(app)
      .get('/api/notifications?userId=u-buyer5')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);
    const chatAfter = after.body.notifications.filter((n: {type: string}) => n.type === 'chat');
    const aRead = chatAfter.find((n: {body: string}) => n.body.startsWith(`${planA.id}|`));
    expect(aRead.isRead).toBe(true);
    // Nothing was ever sent on the second plan, so no notification for it.
    const bNotifs = chatAfter.filter((n: {body: string}) => n.body.startsWith(`${planB.id}|`));
    expect(bNotifs.length).toBe(0);
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
    // This plan's installments were due months ago so it should be overdue.
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

    // The buyer gets the overdue message and the seller gets their own.
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

    // Running it a second time shouldn't add anything.
    const second = await request(app)
      .post('/api/cron/reminders')
      .set('x-cron-secret', 'test-secret')
      .expect(200);
    expect(second.body.generated).toBe(0);
  });
});

describe('advance payments', () => {
  test('a doubled payment covers two installments and credits the third', async () => {
    // A new plan: 3 monthly installments of 1000, no interest, no down payment.
    const plan = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        sellerId: 'u-seller',
        buyerId: 'u-buyer5',
        productId: 'p1',
        productName: 'Advance Test',
        productEmoji: '📦',
        price: 3000,
        downPayment: 0,
        apr: 0,
        term: 3,
        startDate: '2026-08-01',
        notes: '',
      })
      .expect(201);
    const pid = plan.body.plan.id as string;

    // Paying 2500 against a 1000/mo plan pays installments 1 and 2 in full
    // and puts 500 toward the third.
    await request(app)
      .post(`/api/plans/${pid}/payments`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({amount: 2500, method: 'Cash', date: '2026-08-10', notes: '', recordedBy: 'u-seller'})
      .expect(201);

    const schedule = await request(app)
      .get(`/api/plans/${pid}/schedule`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    const rows = schedule.body.schedule as Array<{
      dueDate: string;
      amount: number;
      paidAmount: number;
      status: string;
    }>;
    expect(rows.filter(r => r.status === 'paid')).toHaveLength(2);
    // The third one is still pending but half of it is covered.
    const third = rows[2];
    expect(third.status).toBe('pending');
    expect(third.paidAmount).toBe(500);

    const derived = await request(app)
      .get(`/api/plans/${pid}/derived`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    // Only 500 is left once the credit is taken off the balance.
    expect(derived.body.derived.remaining).toBe(500);
  });

  test('overpaying the final installments completes the plan', async () => {
    const plan = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        sellerId: 'u-seller',
        buyerId: 'u-buyer5',
        productId: 'p1',
        productName: 'Final Test',
        productEmoji: '📦',
        price: 2000,
        downPayment: 0,
        apr: 0,
        term: 2,
        startDate: '2026-08-01',
        notes: '',
      })
      .expect(201);
    const pid = plan.body.plan.id as string;

    await request(app)
      .post(`/api/plans/${pid}/payments`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({amount: 5000, method: 'Cash', date: '2026-08-10', notes: '', recordedBy: 'u-seller'})
      .expect(201);

    const derived = await request(app)
      .get(`/api/plans/${pid}/derived`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect(derived.body.derived.status).toBe('completed');
    expect(derived.body.derived.remaining).toBe(0);
  });
});

describe('early settlement edit', () => {
  test('settle accepts a seller-adjusted amount', async () => {
    const plan = await request(app)
      .post('/api/plans')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        sellerId: 'u-seller',
        buyerId: 'u-buyer5',
        productId: 'p1',
        productName: 'Settle Edit Test',
        productEmoji: '📦',
        price: 6000,
        downPayment: 1000,
        apr: 24,
        term: 6,
        startDate: '2026-08-01',
        notes: '',
      })
      .expect(201);
    const pid = plan.body.plan.id as string;

    const res = await request(app)
      .post(`/api/plans/${pid}/settle`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({recordedBy: 'u-seller', amount: 1234.5})
      .expect(201);
    expect(res.body.payment.amount).toBe(1234.5);
    expect(res.body.payment.type).toBe('settlement');
    expect(res.body.payment.notes).toContain('adjusted');

    const derived = await request(app)
      .get(`/api/plans/${pid}/derived`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect(derived.body.derived.status).toBe('completed');
  });
});

describe('admin roles & oversight', () => {
  test('an admin can promote a user and scope another admin to one seller', async () => {
    // u-buyer2 starts out pending, so activate them before making them an
    // admin. This test needs a loggable admin.
    await request(app)
      .patch('/api/users/u-buyer2/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({status: 'active'})
      .expect(200);

    // Make u-buyer2 an admin.
    await request(app)
      .patch('/api/users/u-buyer2/role')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({role: 'admin'})
      .expect(200);

    // Limit the new admin to u-seller's shop.
    await request(app)
      .patch('/api/users/u-buyer2/assignment')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({sellerId: 'u-seller'})
      .expect(200);

    // Regular users aren't allowed to change anyone's role.
    await request(app)
      .patch('/api/users/u-buyer/role')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({role: 'admin'})
      .expect(403);
  });

  test('a scoped admin only sees the assigned seller\'s data', async () => {
    // u-buyer2 is now an admin for u-seller's shop. Log in as them.
    const scopedToken = await login('buyer2@hulog.ph', 'buyer123');

    const payments = await request(app)
      .get('/api/payments')
      .set('Authorization', `Bearer ${scopedToken}`)
      .expect(200);
    const sellerIds = new Set(payments.body.payments.map((p: {sellerId: string}) => p.sellerId));
    expect(sellerIds.has('u-seller')).toBe(true);
    expect(sellerIds.has('u-seller2')).toBe(false);

    const plans = await request(app)
      .get('/api/plans')
      .set('Authorization', `Bearer ${scopedToken}`)
      .expect(200);
    const planSellers = new Set(plans.body.plans.map((p: {sellerId: string}) => p.sellerId));
    expect(planSellers.has('u-seller2')).toBe(false);

    // The shop data is filtered too. Asking for a different shop still
    // gives you the assigned seller's customers and products.
    const customers = await request(app)
      .get('/api/customers?sellerId=u-seller2')
      .set('Authorization', `Bearer ${scopedToken}`)
      .expect(200);
    expect(customers.body.customers.length).toBeGreaterThan(0);
    for (const c of customers.body.customers) {
      expect(c.sellerId).toBe('u-seller');
    }

    const products = await request(app)
      .get('/api/products?sellerId=u-seller2')
      .set('Authorization', `Bearer ${scopedToken}`)
      .expect(200);
    expect(products.body.products.length).toBeGreaterThan(0);
    for (const p of products.body.products) {
      expect(p.sellerId).toBe('u-seller');
    }

    // The audit log only shows what the assigned seller did.
    const audit = await request(app)
      .get('/api/audit')
      .set('Authorization', `Bearer ${scopedToken}`)
      .expect(200);
    for (const a of audit.body.audit) {
      expect(a.userId).toBe('u-seller');
    }

    // The user list is limited to the shop: the seller, their buyers and themselves.
    const users = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${scopedToken}`)
      .expect(200);
    const scopedIds = new Set(users.body.users.map((u: {id: string}) => u.id));
    expect(scopedIds.has('u-seller')).toBe(true);
    expect(scopedIds.has('u-buyer')).toBe(true); // u-seller's customer
    expect(scopedIds.has('u-buyer2')).toBe(true); // themself
    expect(scopedIds.has('u-seller2')).toBe(false);
    expect(scopedIds.has('u-admin')).toBe(false);

    // Asking for something outside their scope gives a 403.
    const allPlans = await request(app)
      .get('/api/plans')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const otherPlan = allPlans.body.plans.find((p: {sellerId: string}) => p.sellerId === 'u-seller2');
    expect(otherPlan).toBeTruthy();
    await request(app)
      .get(`/api/plans/${otherPlan.id}`)
      .set('Authorization', `Bearer ${scopedToken}`)
      .expect(403);
    await request(app)
      .get(`/api/plans/${otherPlan.id}/schedule`)
      .set('Authorization', `Bearer ${scopedToken}`)
      .expect(403);
    await request(app)
      .get(`/api/plans/${otherPlan.id}/payments`)
      .set('Authorization', `Bearer ${scopedToken}`)
      .expect(403);
    await request(app)
      .get(`/api/plans/${otherPlan.id}/derived`)
      .set('Authorization', `Bearer ${scopedToken}`)
      .expect(403);

    // An admin with no scope can still see everything.
    const allPayments = await request(app)
      .get('/api/payments')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const allSellers = new Set(allPayments.body.payments.map((p: {sellerId: string}) => p.sellerId));
    expect(allSellers.has('u-seller2')).toBe(true);
  });
});
