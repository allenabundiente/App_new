/**
 * First-boot seed — mirrors the mobile app's seedDatabase. Runs inside ONE
 * transaction so a crash mid-seed never leaves a half-seeded database (and
 * the 'seeded' flag is only written after everything succeeded).
 */
import type {PoolClient} from 'pg';
import {getPool, normalizeRow, q} from './db';
import {generateId} from './services/id';
import {hashPassword} from './auth';
import {createPlanOn, type CreatePlanInput} from './services/planOps';

const USERS: Array<{
  id: string;
  name: string;
  email: string;
  password: string;
  phone: string;
  role: 'admin' | 'seller' | 'buyer';
  status: 'active' | 'pending' | 'suspended';
  joinedAt: string;
}> = [
  {id: 'u-admin', name: 'Andres Reyes', email: 'admin@hulog.ph', password: 'admin123', phone: '+63 917 000 0001', role: 'admin', status: 'active', joinedAt: '2025-06-12'},
  {id: 'u-seller', name: 'Maria Santos', email: 'seller@hulog.ph', password: 'seller123', phone: '+63 917 000 0002', role: 'seller', status: 'active', joinedAt: '2025-08-21'},
  {id: 'u-seller2', name: 'Pedro Lim', email: 'pedro@hulog.ph', password: 'seller123', phone: '+63 917 000 0003', role: 'seller', status: 'active', joinedAt: '2025-10-10'},
  {id: 'u-buyer', name: 'Juan Dela Cruz', email: 'buyer@hulog.ph', password: 'buyer123', phone: '+63 912 345 6789', role: 'buyer', status: 'active', joinedAt: '2026-01-18'},
  {id: 'u-buyer2', name: 'Ana Gonzales', email: 'buyer2@hulog.ph', password: 'buyer123', phone: '+63 912 345 6790', role: 'buyer', status: 'pending', joinedAt: '2026-08-03'},
  {id: 'u-buyer3', name: 'Liza Reyes', email: 'liza@hulog.ph', password: 'buyer123', phone: '+63 912 345 6791', role: 'buyer', status: 'active', joinedAt: '2026-02-26'},
  {id: 'u-buyer4', name: 'Marco Tan', email: 'marco@hulog.ph', password: 'buyer123', phone: '+63 912 345 6792', role: 'buyer', status: 'active', joinedAt: '2026-04-08'},
  {id: 'u-buyer5', name: 'Sofia Villanueva', email: 'sofia@hulog.ph', password: 'buyer123', phone: '+63 912 345 6793', role: 'buyer', status: 'active', joinedAt: '2026-05-08'},
];

const PLANS: Array<CreatePlanInput & {planNo: string; status?: string}> = [
  {planNo: 'HT-1001', sellerId: 'u-seller', buyerId: 'u-buyer', productId: 'p1', productName: 'TechPhone X5 128GB', productEmoji: '', price: 24999, downPayment: 5000, apr: 24, term: 12, startDate: '2025-12-19', notes: '', status: 'active'},
  {planNo: 'HT-1002', sellerId: 'u-seller', buyerId: 'u-buyer3', productId: 'p2', productName: 'Lumina 4K TV 55-inch', productEmoji: '', price: 32999, downPayment: 8000, apr: 30, term: 18, startDate: '2026-04-28', notes: ''},
  {planNo: 'HT-1003', sellerId: 'u-seller', buyerId: 'u-buyer4', productId: 'p3', productName: 'AeroBike MTB Pro', productEmoji: '', price: 18500, downPayment: 2500, apr: 18, term: 9, startDate: '2026-04-08', notes: ''},
  {planNo: 'HT-1004', sellerId: 'u-seller', buyerId: 'u-buyer5', productId: 'p4', productName: 'WashMaster 9kg Washer', productEmoji: '', price: 21400, downPayment: 4000, apr: 24, term: 12, startDate: '2026-06-27', notes: ''},
  {planNo: 'HT-1005', sellerId: 'u-seller', buyerId: 'u-buyer', productId: 'p5', productName: 'CoolBreeze Aircon 1.0HP', productEmoji: '', price: 24500, downPayment: 0, apr: 0, term: 6, startDate: '2025-10-10', notes: '', status: 'completed'},
  {planNo: 'HT-1006', sellerId: 'u-seller2', buyerId: 'u-buyer5', productId: 'p6', productName: 'SoundBar X Pro', productEmoji: '', price: 8900, downPayment: 1000, apr: 24, term: 6, startDate: '2026-06-07', notes: ''},
];

export async function seedDatabase(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    for (const u of USERS) {
      await client.query(
        `INSERT INTO users (id, name, email, password, phone, role, status, joinedAt)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [u.id, u.name, u.email, hashPassword(u.password), u.phone, u.role, u.status, u.joinedAt],
      );
    }

    const customers = [
      {id: 'c1', sellerId: 'u-seller', userId: 'u-buyer', name: 'Juan Dela Cruz', phone: '+63 912 345 6789', email: 'buyer@hulog.ph', address: '23 Mabini St, QC', notes: 'Repeat customer', joinedAt: '2026-01-18'},
      {id: 'c2', sellerId: 'u-seller', userId: 'u-buyer3', name: 'Liza Reyes', phone: '+63 912 345 6791', email: 'liza@hulog.ph', address: '88 Scout St, QC', notes: '', joinedAt: '2026-02-26'},
      {id: 'c3', sellerId: 'u-seller', userId: 'u-buyer4', name: 'Marco Tan', phone: '+63 912 345 6792', email: 'marco@hulog.ph', address: '5 Luna Ave, Manila', notes: 'Prefers GCash', joinedAt: '2026-04-08'},
      {id: 'c4', sellerId: 'u-seller', userId: 'u-buyer5', name: 'Sofia Villanueva', phone: '+63 912 345 6793', email: 'sofia@hulog.ph', address: '100 Quezon Blvd', notes: '', joinedAt: '2026-05-08'},
      {id: 'c5', sellerId: 'u-seller2', userId: 'u-buyer5', name: 'Sofia Villanueva', phone: '+63 912 345 6793', email: 'sofia@hulog.ph', address: '100 Quezon Blvd', notes: 'Also buys from Pedro', joinedAt: '2026-05-18'},
    ];
    for (const c of customers) {
      await client.query(
        `INSERT INTO customers (id, sellerId, userId, name, phone, email, address, notes, joinedAt)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [c.id, c.sellerId, c.userId, c.name, c.phone, c.email, c.address, c.notes, c.joinedAt],
      );
    }

    const products = [
      {id: 'p1', sellerId: 'u-seller', name: 'TechPhone X5 128GB', price: 24999, cost: 21500, stock: 12, emoji: ''},
      {id: 'p2', sellerId: 'u-seller', name: 'Lumina 4K TV 55-inch', price: 32999, cost: 27000, stock: 6, emoji: ''},
      {id: 'p3', sellerId: 'u-seller', name: 'AeroBike MTB Pro', price: 18500, cost: 14000, stock: 8, emoji: ''},
      {id: 'p4', sellerId: 'u-seller', name: 'WashMaster 9kg Washer', price: 21400, cost: 16900, stock: 5, emoji: ''},
      {id: 'p5', sellerId: 'u-seller', name: 'CoolBreeze Aircon 1.0HP', price: 24500, cost: 19000, stock: 7, emoji: ''},
      {id: 'p6', sellerId: 'u-seller2', name: 'SoundBar X Pro', price: 8900, cost: 6200, stock: 15, emoji: ''},
    ];
    for (const p of products) {
      await client.query(
        `INSERT INTO products (id, sellerId, name, price, cost, stock, emoji) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [p.id, p.sellerId, p.name, p.price, p.cost, p.stock, p.emoji],
      );
    }

    for (const p of PLANS) {
      await createPlanOn(client, {
        sellerId: p.sellerId,
        buyerId: p.buyerId,
        productId: p.productId,
        productName: p.productName,
        productEmoji: p.productEmoji,
        price: p.price,
        downPayment: p.downPayment,
        apr: p.apr,
        term: p.term,
        startDate: p.startDate,
        notes: p.notes,
      });
      if (p.status) {
        await client.query('UPDATE plans SET status = $1 WHERE planNo = $2', [p.status, p.planNo]);
      }
    }

    // Paid-installment history (dates line up with due dates).
    const backfill = [
      {planNo: 'HT-1001', count: 7},
      {planNo: 'HT-1002', count: 3},
      {planNo: 'HT-1003', count: 2},
      {planNo: 'HT-1004', count: 1},
      {planNo: 'HT-1005', count: 6},
      {planNo: 'HT-1006', count: 2},
    ];
    const methods = ['Cash', 'GCash', 'Bank transfer'];
    for (const b of backfill) {
      const plan = await qOneRow<{id: string; buyerId: string; sellerId: string}>(
        client,
        'SELECT id, buyerId, sellerId FROM plans WHERE planNo = $1',
        [b.planNo],
      );
      if (!plan) {
        continue;
      }
      const dues = (
        await client.query(
          "SELECT * FROM plan_schedule WHERE planId = $1 AND status = 'pending' ORDER BY dueDate LIMIT $2",
          [plan.id, b.count],
        )
      ).rows.map(r => normalizeRow(r as Record<string, unknown>));
      let i = 0;
      for (const due of dues) {
        await client.query("UPDATE plan_schedule SET status = 'paid', paidDate = $1 WHERE id = $2", [
          String(due.dueDate),
          String(due.id),
        ]);
        await client.query(
          `INSERT INTO payments (id, receiptNo, planId, buyerId, sellerId, amount, method, date, notes, recordedBy, penalty, type, createdAt)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'', $9, 0, 'installment', $10)`,
          [generateId('pmt-'), await cReceiptNo(client), plan.id, plan.buyerId, plan.sellerId,
            Number(due.amount), methods[i % methods.length], String(due.dueDate), plan.sellerId,
            `${String(due.dueDate)}T09:00:00`],
        );
        i++;
      }
    }

    // A seeded pending adjustment: Marco wants a reschedule on HT-1003.
    const plan3 = await qOneRow<{id: string}>(client, 'SELECT id FROM plans WHERE planNo = $1', [
      'HT-1003',
    ]);
    if (plan3) {
      await client.query(
        `INSERT INTO adjustments (id, planId, buyerId, type, reason, detailJson, status, createdAt, resolvedAt, note)
         VALUES ($1,$2,'u-buyer4','reschedule','Salary delayed this month, can I extend the remaining term by 2 months?','{"months":2}','pending',$3,NULL,'')`,
        [generateId('ad-'), plan3.id, new Date(Date.now() - 2 * 86400000).toISOString()],
      );
    }

    await client.query(
      `INSERT INTO notifications (id, userId, type, title, body, isRead, createdAt)
       VALUES ($1,'u-admin','info','New account awaiting verification','Ana Gonzales registered as a buyer.',0,$2)`,
      [generateId('n-'), new Date(Date.now() - 3 * 86400000).toISOString()],
    );

    const defaults = {
      businessName: 'Santos Appliances & Gadgets',
      businessAddr: '12 Rizal Avenue, Brgy. San Isidro, Quezon City',
      businessPhone: '+63 917 000 2222',
      taxId: '123-456-789-000',
      currency: '₱',
      graceDays: '3',
      penaltyRate: '2',
      penaltyCap: '25',
      defaultApr: '24',
      reminderLead: '3',
    };
    for (const [k, v] of Object.entries(defaults)) {
      await client.query(
        `INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [k, v],
      );
    }
    await client.query(
      `INSERT INTO settings (key, value) VALUES ('seeded','1') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

async function qOneRow<T>(c: PoolClient, sql: string, params: unknown[] = []): Promise<T | null> {
  const res = await c.query(sql, params as never[]);
  return res.rows.length ? (normalizeRow(res.rows[0] as Record<string, unknown>) as T) : null;
}

/** Receipt counter scoped to the seed's client. */
async function cReceiptNo(c: PoolClient): Promise<string> {
  const row = await qOneRow<{value: string}>(
    c,
    "SELECT value FROM settings WHERE key = 'receipt_seq'",
  );
  const next = Number(row?.value || 0) + 1;
  await c.query(
    `INSERT INTO settings (key, value) VALUES ('receipt_seq',$1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [String(next)],
  );
  return 'R-' + String(next).padStart(4, '0');
}

/** Public helper: has the DB been seeded yet? */
export async function isSeeded(): Promise<boolean> {
  const rows = await q<{value: string}>("SELECT value FROM settings WHERE key = 'seeded'");
  return rows.length > 0 && rows[0].value === '1';
}
