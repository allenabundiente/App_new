/**
 * Repository — the ONLY place that talks to SQLite.
 *
 * RULES of this layer:
 *  1. Every method is async; quick-sqlite runs queries off the JS thread,
 *     so the UI (and animations) never block.
 *  2. Rows come back as snake_case objects — mappers convert them to the
 *     camelCase contracts in ../types.
 *  3. Multi-step writes (recordPayment, settlePlan, createPlan, applying an
 *     adjustment) run inside a transaction so a crash never leaves the DB
 *     half-updated.
 *  4. The UI never writes SQL — it calls these functions.
 */
import {open, type QuickSQLiteConnection, type QueryResult} from 'react-native-quick-sqlite';
import type {
  Adjustment,
  AppSettings,
  AuditEntry,
  Customer,
  Message,
  NotificationItem,
  Payment,
  Plan,
  Product,
  ScheduleItem,
  User,
} from '../types';
import {generateId} from '../utils/id';
import {nowIso, today} from '../utils/date';
import {round2} from '../utils/money';
import {
  buildSchedule,
  pmt,
} from '../services/amortization';
import {computePenalty, effectiveDueDate, planStatus} from '../services/penalty';
import {earlySettlementQuote} from '../services/earlySettlement';
import {
  DEFAULT_SETTINGS,
  MIGRATIONS,
  SCHEMA,
  seedCustomers,
  seedProducts,
  seedUsers,
  splitStatements,
} from './schema';
import {addMonths} from '../utils/date';

let db: QuickSQLiteConnection | null = null;

export function getDb(): QuickSQLiteConnection {
  if (!db) {
    db = open({name: 'hulogtrack.db', location: 'default'});
  }
  return db;
}

/* ---------------- row helpers ---------------- */

function rowsOf<T>(res: QueryResult): T[] {
  return ((res.rows?._array ?? []) as unknown as T[]) ?? [];
}

function toBool(v: unknown): boolean {
  return v === 1 || v === true || v === '1';
}

function toNum(v: unknown): number {
  return typeof v === 'number' ? v : Number(v) || 0;
}

function toStr(v: unknown): string {
  return v == null ? '' : String(v);
}

/* ---------------- mappers ---------------- */

function mapUser(r: Record<string, unknown>): User {
  return {
    id: toStr(r.id),
    name: toStr(r.name),
    email: toStr(r.email),
    password: toStr(r.password),
    phone: toStr(r.phone),
    role: toStr(r.role) as User['role'],
    status: toStr(r.status) as User['status'],
    joinedAt: toStr(r.joinedAt),
    qrImage: toStr(r.qrImage),
    assignedSellerId: r.assignedSellerId == null ? null : toStr(r.assignedSellerId),
  };
}

function mapCustomer(r: Record<string, unknown>): Customer {
  return {
    id: toStr(r.id),
    sellerId: toStr(r.sellerId),
    userId: toStr(r.userId),
    name: toStr(r.name),
    phone: toStr(r.phone),
    email: toStr(r.email),
    address: toStr(r.address),
    notes: toStr(r.notes),
    joinedAt: toStr(r.joinedAt),
  };
}

function mapProduct(r: Record<string, unknown>): Product {
  return {
    id: toStr(r.id),
    sellerId: toStr(r.sellerId),
    name: toStr(r.name),
    price: toNum(r.price),
    cost: toNum(r.cost),
    stock: toNum(r.stock),
    emoji: toStr(r.emoji),
    image: toStr(r.image),
  };
}

function mapPlan(r: Record<string, unknown>): Plan {
  return {
    id: toStr(r.id),
    planNo: toStr(r.planNo),
    sellerId: toStr(r.sellerId),
    buyerId: toStr(r.buyerId),
    productId: r.productId == null ? null : toStr(r.productId),
    productName: toStr(r.productName),
    productEmoji: toStr(r.productEmoji),
    price: toNum(r.price),
    downPayment: toNum(r.downPayment),
    financed: toNum(r.financed),
    apr: toNum(r.apr),
    term: toNum(r.term),
    installment: toNum(r.installment),
    startDate: toStr(r.startDate),
    status: toStr(r.status) as Plan['status'],
    graceExtra: toNum(r.graceExtra),
    notes: toStr(r.notes),
    createdAt: toStr(r.createdAt),
  };
}

function mapSchedule(r: Record<string, unknown>): ScheduleItem {
  return {
    id: toStr(r.id),
    planId: toStr(r.planId),
    dueDate: toStr(r.dueDate),
    amount: toNum(r.amount),
    paidAmount: toNum(r.paidAmount),
    status: toStr(r.status) as ScheduleItem['status'],
    paidDate: r.paidDate == null ? null : toStr(r.paidDate),
    note: toStr(r.note),
  };
}

function mapPayment(r: Record<string, unknown>): Payment {
  return {
    id: toStr(r.id),
    receiptNo: toStr(r.receiptNo),
    planId: toStr(r.planId),
    buyerId: toStr(r.buyerId),
    sellerId: toStr(r.sellerId),
    amount: toNum(r.amount),
    method: toStr(r.method),
    date: toStr(r.date),
    notes: toStr(r.notes),
    recordedBy: toStr(r.recordedBy),
    penalty: toNum(r.penalty),
    type: toStr(r.type) as Payment['type'],
    createdAt: toStr(r.createdAt),
  };
}

function mapAdjustment(r: Record<string, unknown>): Adjustment {
  return {
    id: toStr(r.id),
    planId: toStr(r.planId),
    buyerId: toStr(r.buyerId),
    type: toStr(r.type) as Adjustment['type'],
    reason: toStr(r.reason),
    detailJson: toStr(r.detailJson),
    status: toStr(r.status) as Adjustment['status'],
    createdAt: toStr(r.createdAt),
    resolvedAt: r.resolvedAt == null ? null : toStr(r.resolvedAt),
    note: toStr(r.note),
  };
}

function mapNotification(r: Record<string, unknown>): NotificationItem {
  return {
    id: toStr(r.id),
    userId: toStr(r.userId),
    type: toStr(r.type) as NotificationItem['type'],
    title: toStr(r.title),
    body: toStr(r.body),
    isRead: toBool(r.isRead),
    createdAt: toStr(r.createdAt),
  };
}

function mapMessage(r: Record<string, unknown>): Message {
  return {
    id: toStr(r.id),
    planId: toStr(r.planId),
    senderId: toStr(r.senderId),
    recipientId: toStr(r.recipientId),
    text: toStr(r.text),
    isRead: toBool(r.isRead),
    createdAt: toStr(r.createdAt),
  };
}

function mapAudit(r: Record<string, unknown>): AuditEntry {
  return {
    id: toStr(r.id),
    userId: toStr(r.userId),
    action: toStr(r.action),
    detail: toStr(r.detail),
    createdAt: toStr(r.createdAt),
  };
}

/* ---------------- init / migrations ---------------- */

/**
 * Run multi-statement SQL. quick-sqlite executes one statement per call, so
 * the statements are split first (see splitStatements — comments are
 * stripped there so a `;` in a comment can't break the split) and executed
 * one by one.
 */
async function execBatch(database: QuickSQLiteConnection, sql: string): Promise<void> {
  for (const stmt of splitStatements(sql)) {
    await database.executeAsync(stmt + ';');
  }
}

async function getUserVersion(database: QuickSQLiteConnection): Promise<number> {
  const res = await database.executeAsync('PRAGMA user_version;');
  const arr = rowsOf<Record<string, unknown>>(res);
  return toNum(arr[0]?.user_version);
}

async function runMigrations(database: QuickSQLiteConnection): Promise<void> {
  let version = await getUserVersion(database);
  for (const migration of MIGRATIONS) {
    if (migration.version <= version) {
      continue;
    }
    await database.executeAsync('BEGIN;');
    try {
      await migration.apply(database);
      await database.executeAsync(`PRAGMA user_version = ${migration.version};`);
      await database.executeAsync('COMMIT;');
      version = migration.version;
    } catch (e) {
      await database.executeAsync('ROLLBACK;');
      throw e;
    }
  }
}

/** Idempotent boot: open, WAL, schema, migrations, seed-on-first-run. */
export async function initDatabase(): Promise<void> {
  const database = getDb();
  await database.executeAsync('PRAGMA journal_mode = WAL;');
  await database.executeAsync('PRAGMA foreign_keys = ON;');

  // Create any missing tables. We deliberately do NOT set user_version here —
  // runMigrations owns versioning, so a pre-existing v1 database is correctly
  // upgraded (migration v2's guarded ALTER actually runs) instead of being
  // stamped as current and skipped.
  await execBatch(database, SCHEMA);

  await runMigrations(database);

  const seeded = await getSetting('seeded');
  if (seeded !== '1') {
    await seedDatabase();
  }
}

/* ---------------- settings ---------------- */

export async function getSetting(key: string): Promise<string | null> {
  const res = await getDb().executeAsync('SELECT value FROM settings WHERE key = ?', [key]);
  const arr = rowsOf<Record<string, unknown>>(res);
  return arr.length ? toStr(arr[0].value) : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await getDb().executeAsync(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}

export async function getSettings(): Promise<AppSettings> {
  const res = await getDb().executeAsync('SELECT key, value FROM settings');
  const rows = rowsOf<Record<string, unknown>>(res);
  const map: Record<string, string> = {};
  for (const r of rows) {
    map[toStr(r.key)] = toStr(r.value);
  }
  return {
    businessName: map.businessName ?? DEFAULT_SETTINGS.businessName,
    businessAddr: map.businessAddr ?? DEFAULT_SETTINGS.businessAddr,
    businessPhone: map.businessPhone ?? DEFAULT_SETTINGS.businessPhone,
    taxId: map.taxId ?? DEFAULT_SETTINGS.taxId,
    currency: map.currency ?? DEFAULT_SETTINGS.currency,
    graceDays: toNum(map.graceDays ?? DEFAULT_SETTINGS.graceDays),
    penaltyRate: toNum(map.penaltyRate ?? DEFAULT_SETTINGS.penaltyRate),
    penaltyCap: toNum(map.penaltyCap ?? DEFAULT_SETTINGS.penaltyCap),
    defaultApr: toNum(map.defaultApr ?? DEFAULT_SETTINGS.defaultApr),
    reminderLead: toNum(map.reminderLead ?? DEFAULT_SETTINGS.reminderLead),
  };
}

export async function saveSettings(partial: Partial<AppSettings>): Promise<void> {
  const current = await getSettings();
  const next = {...current, ...partial};
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
}

/** Monotonic receipt numbering — the counter lives in settings. */
export async function nextReceiptNo(): Promise<string> {
  const current = toNum(await getSetting('receipt_seq'));
  const next = current + 1;
  await setSetting('receipt_seq', String(next));
  return 'R-' + String(next).padStart(4, '0');
}

/* ---------------- users / auth ---------------- */

export async function findUserByEmail(email: string): Promise<User | null> {
  const res = await getDb().executeAsync('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
  const arr = rowsOf<Record<string, unknown>>(res);
  return arr.length ? mapUser(arr[0]) : null;
}

export async function getUser(id: string): Promise<User | null> {
  const res = await getDb().executeAsync('SELECT * FROM users WHERE id = ?', [id]);
  const arr = rowsOf<Record<string, unknown>>(res);
  return arr.length ? mapUser(arr[0]) : null;
}

export async function listUsers(): Promise<User[]> {
  const res = await getDb().executeAsync('SELECT * FROM users ORDER BY joinedAt DESC');
  return rowsOf<Record<string, unknown>>(res).map(mapUser);
}

export async function insertUser(user: User): Promise<void> {
  await getDb().executeAsync(
    `INSERT INTO users (id, name, email, password, phone, role, status, joinedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [user.id, user.name, user.email, user.password, user.phone, user.role, user.status, user.joinedAt],
  );
}

export async function updateUserStatus(id: string, status: User['status']): Promise<void> {
  await getDb().executeAsync('UPDATE users SET status = ? WHERE id = ?', [status, id]);
}

/** Admin-only: change a user's role (e.g. promote to admin). */
export async function updateUserRole(id: string, role: User['role']): Promise<void> {
  await getDb().executeAsync('UPDATE users SET role = ? WHERE id = ?', [role, id]);
  // A demoted admin loses any seller oversight scope.
  if (role !== 'admin') {
    await getDb().executeAsync('UPDATE users SET assignedSellerId = NULL WHERE id = ?', [id]);
  }
}

/** Admin-only: scope an admin to oversee one seller (null = all). */
export async function setAdminAssignment(id: string, sellerId: string | null): Promise<void> {
  await getDb().executeAsync('UPDATE users SET assignedSellerId = ? WHERE id = ?', [sellerId, id]);
}

/** Edit the signed-in user's own profile (name, contact details, seller QR). */
export async function updateUserProfile(
  id: string,
  patch: Partial<Pick<User, 'name' | 'email' | 'phone' | 'qrImage'>>,
): Promise<void> {
  const fields: string[] = [];
  const params: unknown[] = [];
  const allowed: Array<keyof Pick<User, 'name' | 'email' | 'phone' | 'qrImage'>> = [
    'name',
    'email',
    'phone',
    'qrImage',
  ];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(key === 'email' ? String(patch[key]).trim().toLowerCase() : patch[key]);
    }
  }
  if (!fields.length) {
    return;
  }
  params.push(id);
  await getDb().executeAsync(
    `UPDATE users SET ${fields.join(', ')} WHERE id = ?`,
    params,
  );
}

/**
 * Change the user's password. Local mode stores plaintext (see dataAccess
 * signIn) so we verify the current password here before replacing it.
 */
export async function changePassword(
  id: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const res = await getDb().executeAsync('SELECT password FROM users WHERE id = ?', [id]);
  const arr = rowsOf<Record<string, unknown>>(res);
  const stored = arr.length ? toStr(arr[0].password) : '';
  if (!stored || stored !== currentPassword) {
    throw new Error('Current password is incorrect.');
  }
  if (newPassword.length < 6) {
    throw new Error('New password must be at least 6 characters.');
  }
  await getDb().executeAsync('UPDATE users SET password = ? WHERE id = ?', [newPassword, id]);
}

/* ---------------- customers / products ---------------- */

export async function listCustomers(sellerId: string): Promise<Customer[]> {
  const res = await getDb().executeAsync(
    'SELECT * FROM customers WHERE sellerId = ? ORDER BY name',
    [sellerId],
  );
  return rowsOf<Record<string, unknown>>(res).map(mapCustomer);
}

export async function insertCustomer(customer: Customer): Promise<void> {
  await getDb().executeAsync(
    `INSERT INTO customers (id, sellerId, userId, name, phone, email, address, notes, joinedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [customer.id, customer.sellerId, customer.userId, customer.name, customer.phone, customer.email, customer.address, customer.notes, customer.joinedAt],
  );
}

/**
 * Create a customer AND their buyer account in one transaction — a customer
 * needs a linked user so they can log into the buyer portal. If the second
 * INSERT fails the first rolls back too (no orphan rows).
 */
export async function createCustomerWithUser(input: {
  sellerId: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}): Promise<Customer> {
  const buyerId = generateId('u-');
  const customer: Customer = {
    id: generateId('c-'),
    sellerId: input.sellerId,
    userId: buyerId,
    name: input.name,
    phone: input.phone,
    email: input.email,
    address: input.address,
    notes: input.notes,
    joinedAt: today(),
  };
  const buyer: User = {
    id: buyerId,
    name: input.name,
    email: input.email,
    password: 'buyer123', // default first-login password; changeable later
    phone: input.phone,
    role: 'buyer',
    status: 'active',
    joinedAt: today(),
    qrImage: '',
    assignedSellerId: null,
  };
  const database = getDb();
  await database.executeAsync('BEGIN;');
  try {
    await insertUser(buyer);
    await insertCustomer(customer);
    await database.executeAsync('COMMIT;');
  } catch (e) {
    await database.executeAsync('ROLLBACK;');
    throw e;
  }
  return customer;
}

export async function listProducts(sellerId: string): Promise<Product[]> {
  const res = await getDb().executeAsync(
    'SELECT * FROM products WHERE sellerId = ? ORDER BY name',
    [sellerId],
  );
  return rowsOf<Record<string, unknown>>(res).map(mapProduct);
}

export async function insertProduct(product: Product): Promise<void> {
  await getDb().executeAsync(
    `INSERT INTO products (id, sellerId, name, price, cost, stock, emoji, image)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [product.id, product.sellerId, product.name, product.price, product.cost, product.stock, product.emoji, product.image],
  );
}

export async function updateProduct(
  id: string,
  patch: Partial<Pick<Product, 'name' | 'price' | 'cost' | 'stock' | 'emoji' | 'image'>>,
): Promise<void> {
  const fields: string[] = [];
  const params: unknown[] = [];
  const allowed: Array<keyof Pick<Product, 'name' | 'price' | 'cost' | 'stock' | 'emoji' | 'image'>> = [
    'name',
    'price',
    'cost',
    'stock',
    'emoji',
    'image',
  ];
  for (const key of allowed) {
    if (patch[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(patch[key]);
    }
  }
  if (!fields.length) {
    return;
  }
  params.push(id);
  await getDb().executeAsync(
    `UPDATE products SET ${fields.join(', ')} WHERE id = ?`,
    params,
  );
}

export async function deleteProduct(id: string): Promise<void> {
  await getDb().executeAsync('DELETE FROM products WHERE id = ?', [id]);
}

/* ---------------- plans & schedule ---------------- */

export async function listPlans(opts?: {sellerId?: string; buyerId?: string}): Promise<Plan[]> {
  let sql = 'SELECT * FROM plans';
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts?.sellerId) {
    where.push('sellerId = ?');
    params.push(opts.sellerId);
  }
  if (opts?.buyerId) {
    where.push('buyerId = ?');
    params.push(opts.buyerId);
  }
  if (where.length) {
    sql += ' WHERE ' + where.join(' AND ');
  }
  sql += ' ORDER BY createdAt DESC';
  const res = await getDb().executeAsync(sql, params);
  return rowsOf<Record<string, unknown>>(res).map(mapPlan);
}

export async function getPlan(id: string): Promise<Plan | null> {
  const res = await getDb().executeAsync('SELECT * FROM plans WHERE id = ?', [id]);
  const arr = rowsOf<Record<string, unknown>>(res);
  return arr.length ? mapPlan(arr[0]) : null;
}

export async function scheduleForPlan(planId: string): Promise<ScheduleItem[]> {
  const res = await getDb().executeAsync(
    'SELECT * FROM plan_schedule WHERE planId = ? ORDER BY dueDate',
    [planId],
  );
  return rowsOf<Record<string, unknown>>(res).map(mapSchedule);
}

/** The next unpaid installment (null when the plan is fully paid). */
export async function nextDue(planId: string): Promise<ScheduleItem | null> {
  const res = await getDb().executeAsync(
    "SELECT * FROM plan_schedule WHERE planId = ? AND status = 'pending' ORDER BY dueDate LIMIT 1",
    [planId],
  );
  const arr = rowsOf<Record<string, unknown>>(res);
  return arr.length ? mapSchedule(arr[0]) : null;
}

export async function updatePlanStatus(id: string, status: Plan['status']): Promise<void> {
  await getDb().executeAsync('UPDATE plans SET status = ? WHERE id = ?', [status, id]);
}

export async function updatePlanGrace(id: string, graceExtra: number): Promise<void> {
  await getDb().executeAsync('UPDATE plans SET graceExtra = ? WHERE id = ?', [graceExtra, id]);
}

async function insertScheduleRows(planId: string, rows: Array<{dueDate: string; amount: number}>): Promise<void> {
  for (const row of rows) {
    await getDb().executeAsync(
      `INSERT INTO plan_schedule (id, planId, dueDate, amount, status) VALUES (?, ?, ?, ?, 'pending')`,
      [generateId('sch-'), planId, row.dueDate, row.amount],
    );
  }
}

/**
 * Insert a plan WITHOUT managing a transaction — the CALLER owns the
 * transaction. This lets the seed run all six demo plans inside its single
 * big BEGIN/COMMIT instead of nesting transactions (SQLite ignores nested
 * BEGIN, so an inner COMMIT would commit the whole outer transaction).
 */
async function insertPlanFull(
  database: QuickSQLiteConnection,
  input: {
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
  },
): Promise<Plan> {
  const financed = Math.max(0, input.price - input.downPayment);
  const installment = pmt(financed, input.apr, input.term);
  const schedule = buildSchedule(financed, input.apr, input.term, input.startDate);

  const maxNoRes = await database.executeAsync(
    "SELECT planNo FROM plans WHERE planNo LIKE 'HT-%' ORDER BY planNo DESC LIMIT 1",
  );
  const lastNo = rowsOf<Record<string, unknown>>(maxNoRes)[0]?.planNo ?? 'HT-1000';
  const nextNo = 'HT-' + (Number(String(lastNo).replace(/\D/g, '')) + 1);

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

  await database.executeAsync(
    `INSERT INTO plans (id, planNo, sellerId, buyerId, productId, productName, productEmoji,
      price, downPayment, financed, apr, term, installment, startDate, status, graceExtra, notes, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [plan.id, plan.planNo, plan.sellerId, plan.buyerId, plan.productId, plan.productName,
      plan.productEmoji, plan.price, plan.downPayment, plan.financed, plan.apr, plan.term,
      plan.installment, plan.startDate, plan.status, plan.graceExtra, plan.notes, plan.createdAt],
  );
  await insertScheduleRows(plan.id, schedule);
  if (input.downPayment > 0) {
    await database.executeAsync(
      `INSERT INTO payments (id, receiptNo, planId, buyerId, sellerId, amount, method, date, notes, recordedBy, penalty, type, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, 'Cash', ?, 'Down payment', ?, 0, 'down', ?)`,
      [generateId('pmt-'), await nextReceiptNo(), plan.id, plan.buyerId, plan.sellerId,
        input.downPayment, input.startDate, input.sellerId, nowIso()],
    );
  }
  return plan;
}

/**
 * Create a plan atomically: plan row + full schedule + optional down-payment
 * record. If anything fails, the whole thing rolls back.
 */
export async function createPlan(input: {
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
}): Promise<Plan> {
  const database = getDb();
  await database.executeAsync('BEGIN;');
  try {
    const plan = await insertPlanFull(database, input);
    await database.executeAsync('COMMIT;');
    return plan;
  } catch (e) {
    await database.executeAsync('ROLLBACK;');
    throw e;
  }
}

/* ---------------- payments ---------------- */

export async function paymentsForPlan(planId: string): Promise<Payment[]> {
  const res = await getDb().executeAsync(
    'SELECT * FROM payments WHERE planId = ? ORDER BY date DESC',
    [planId],
  );
  return rowsOf<Record<string, unknown>>(res).map(mapPayment);
}

export async function paymentsForBuyer(buyerId: string): Promise<Payment[]> {
  const res = await getDb().executeAsync(
    'SELECT * FROM payments WHERE buyerId = ? ORDER BY date DESC, createdAt DESC',
    [buyerId],
  );
  return rowsOf<Record<string, unknown>>(res).map(mapPayment);
}

export async function paymentsForSeller(sellerId: string): Promise<Payment[]> {
  const res = await getDb().executeAsync(
    'SELECT * FROM payments WHERE sellerId = ? ORDER BY date DESC, createdAt DESC',
    [sellerId],
  );
  return rowsOf<Record<string, unknown>>(res).map(mapPayment);
}

export async function listAllPayments(): Promise<Payment[]> {
  const res = await getDb().executeAsync(
    'SELECT * FROM payments ORDER BY date DESC, createdAt DESC',
  );
  return rowsOf<Record<string, unknown>>(res).map(mapPayment);
}

export async function getPayment(id: string): Promise<Payment | null> {
  const res = await getDb().executeAsync('SELECT * FROM payments WHERE id = ?', [id]);
  const arr = rowsOf<Record<string, unknown>>(res);
  return arr.length ? mapPayment(arr[0]) : null;
}

/**
 * Record an installment payment — THE critical write, fully transactional:
 *  1. read the plan + next due + settings INSIDE the transaction, so two
 *     rapid submissions can never both claim the same installment
 *  2. mark the next pending due as paid
 *  3. insert the payment row (penalty recomputed from the chosen date)
 *  4. complete the plan when no dues remain
 *  5. notify the buyer + audit (best-effort, after commit)
 */
export async function recordPayment(input: {
  planId: string;
  amount: number;
  method: string;
  date: string;
  notes: string;
  recordedBy: string;
}): Promise<Payment> {
  const database = getDb();
  await database.executeAsync('BEGIN;');
  let payment: Payment | null = null;
  try {
    const plan = await getPlan(input.planId);
    if (!plan) {
      throw new Error('Plan not found');
    }
    const schedule = await scheduleForPlan(plan.id);
    const pending = schedule
      .filter(s => s.status === 'pending')
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const due = pending[0] ?? null;
    const settings = await getSettings();
    const outstanding = due ? due.amount - due.paidAmount : 0;
    const penalty = due
      ? computePenalty(Math.max(0, outstanding), effectiveDueDate(due.dueDate, plan.graceExtra), input.date, {
          graceDays: settings.graceDays,
          ratePerMonthPct: settings.penaltyRate,
          capPct: settings.penaltyCap,
        })
      : 0;

    payment = {
      id: generateId('pmt-'),
      receiptNo: await nextReceiptNo(),
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
        await database.executeAsync(
          "UPDATE plan_schedule SET status = 'paid', paidAmount = amount, paidDate = ? WHERE id = ?",
          [input.date, item.id],
        );
      } else {
        await database.executeAsync(
          'UPDATE plan_schedule SET paidAmount = paidAmount + ? WHERE id = ?',
          [credit, item.id],
        );
        credit = 0;
      }
    }
    await database.executeAsync(
      `INSERT INTO payments (id, receiptNo, planId, buyerId, sellerId, amount, method, date, notes, recordedBy, penalty, type, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [payment.id, payment.receiptNo, payment.planId, payment.buyerId, payment.sellerId,
        payment.amount, payment.method, payment.date, payment.notes, payment.recordedBy,
        payment.penalty, payment.type, payment.createdAt],
    );
    const remaining = await database.executeAsync(
      "SELECT COUNT(*) AS n FROM plan_schedule WHERE planId = ? AND status = 'pending'",
      [plan.id],
    );
    const left = toNum(rowsOf<Record<string, unknown>>(remaining)[0]?.n);
    if (left === 0) {
      await updatePlanStatus(plan.id, 'completed');
    }
    await database.executeAsync('COMMIT;');

    await insertNotification({
      userId: plan.buyerId,
      type: 'money',
      title: 'Payment received',
      body: `${payment.amount} recorded on ${plan.planNo}. Receipt ${payment.receiptNo}.`,
    });
    await addAudit(input.recordedBy, 'payment.record', `Recorded ${payment.amount} on ${plan.planNo}`);
    return payment;
  } catch (e) {
    await database.executeAsync('ROLLBACK;');
    throw e;
  }
}

/**
 * Early settlement — quote, then mark every pending due paid in one txn.
 * Pass an explicit amount to override the auto-quote (seller-adjusted payoff).
 */
export async function settlePlan(
  planId: string,
  recordedBy: string,
  amountOverride?: number,
): Promise<Payment> {
  const plan = await getPlan(planId);
  if (!plan) {
    throw new Error('Plan not found');
  }
  const schedule = await scheduleForPlan(planId);
  const remaining = schedule
    .filter(s => s.status === 'pending')
    .reduce((a, s) => a + Math.max(0, s.amount - s.paidAmount), 0);
  const quote = earlySettlementQuote(remaining);
  const settleAmount = round2(amountOverride ?? quote.total);

  const payment: Payment = {
    id: generateId('pmt-'),
    receiptNo: await nextReceiptNo(),
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

  const database = getDb();
  await database.executeAsync('BEGIN;');
  try {
    // Insert EXACTLY the payment built above — one receipt number, one id,
    // so what we return matches the row in the database.
    await applySettlementWrites(database, plan, payment);
    await database.executeAsync('COMMIT;');
  } catch (e) {
    await database.executeAsync('ROLLBACK;');
    throw e;
  }

  const saved = Math.max(0, round2(remaining - payment.amount));
  await insertNotification({
    userId: plan.buyerId,
    type: 'success',
    title: 'Plan settled early',
    body: `${plan.planNo} settled for ${payment.amount} — you saved ${saved}.`,
  });
  await addAudit(recordedBy, 'plan.settle', `Early settlement of ${plan.planNo}`);
  return payment;
}

/* ---------------- adjustments ---------------- */

export async function listAdjustments(opts?: {buyerId?: string; status?: Adjustment['status']}): Promise<Adjustment[]> {
  let sql = 'SELECT * FROM adjustments';
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts?.buyerId) {
    where.push('buyerId = ?');
    params.push(opts.buyerId);
  }
  if (opts?.status) {
    where.push('status = ?');
    params.push(opts.status);
  }
  if (where.length) {
    sql += ' WHERE ' + where.join(' AND ');
  }
  sql += ' ORDER BY createdAt DESC';
  const res = await getDb().executeAsync(sql, params);
  return rowsOf<Record<string, unknown>>(res).map(mapAdjustment);
}

export async function listPendingAdjustmentsForSeller(sellerId: string): Promise<Adjustment[]> {
  const res = await getDb().executeAsync(
    `SELECT a.* FROM adjustments a
     JOIN plans p ON p.id = a.planId
     WHERE a.status = 'pending' AND p.sellerId = ?
     ORDER BY a.createdAt DESC`,
    [sellerId],
  );
  return rowsOf<Record<string, unknown>>(res).map(mapAdjustment);
}

export async function insertAdjustment(adjustment: Adjustment): Promise<void> {
  await getDb().executeAsync(
    `INSERT INTO adjustments (id, planId, buyerId, type, reason, detailJson, status, createdAt, resolvedAt, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [adjustment.id, adjustment.planId, adjustment.buyerId, adjustment.type, adjustment.reason,
      adjustment.detailJson, adjustment.status, adjustment.createdAt, adjustment.resolvedAt, adjustment.note],
  );
}

/**
 * Approve an adjustment — each type mutates the schedule differently. This
 * is where "payment holiday", "reschedule" and "extra grace" become real.
 */
export async function resolveAdjustment(
  adjustmentId: string,
  approve: boolean,
  resolverId: string,
  note: string,
): Promise<void> {
  const res = await getDb().executeAsync('SELECT * FROM adjustments WHERE id = ?', [adjustmentId]);
  const arr = rowsOf<Record<string, unknown>>(res);
  if (!arr.length) {
    return;
  }
  const adjustment = mapAdjustment(arr[0]);
  if (adjustment.status !== 'pending') {
    return;
  }
  const plan = await getPlan(adjustment.planId);
  if (!plan) {
    return;
  }
  const settings = await getSettings();
  let detailNote = approve ? 'Approved.' : 'Rejected.';
  const detail = safeParseJson(adjustment.detailJson) as {
    days?: number;
    months?: number;
    quote?: {total?: number; incentive?: number};
  };

  const database = getDb();
  await database.executeAsync('BEGIN;');
  try {
    if (approve) {
      if (adjustment.type === 'grace') {
        await updatePlanGrace(plan.id, plan.graceExtra + (detail.days ?? settings.graceDays));
        detailNote = `Extra ${detail.days ?? settings.graceDays} grace day(s) added.`;
      } else if (adjustment.type === 'holiday') {
        await database.executeAsync(
          "UPDATE plan_schedule SET status = 'skipped', note = 'Payment holiday' WHERE id = (SELECT id FROM plan_schedule WHERE planId = ? AND status = 'pending' ORDER BY dueDate LIMIT 1)",
          [plan.id],
        );
        const last = await getDb().executeAsync(
          'SELECT dueDate, amount FROM plan_schedule WHERE planId = ? ORDER BY dueDate DESC LIMIT 1',
          [plan.id],
        );
        const lastRow = rowsOf<Record<string, unknown>>(last)[0];
        if (lastRow) {
          await database.executeAsync(
            `INSERT INTO plan_schedule (id, planId, dueDate, amount, status) VALUES (?, ?, ?, ?, 'pending')`,
            [generateId('sch-'), plan.id, addMonths(toStr(lastRow.dueDate), 1), toNum(lastRow.amount)],
          );
        }
        detailNote = 'One installment skipped and moved to the end of the term.';
      } else if (adjustment.type === 'reschedule') {
        await shiftPendingDues(plan.id, detail.months ?? 2);
        detailNote = `Remaining installments extended by ${detail.months ?? 2} month(s).`;
      } else if (adjustment.type === 'early') {
        const quote =
          detail.quote && typeof detail.quote.total === 'number'
            ? detail.quote
            : earlySettlementQuote(
                (await scheduleForPlan(plan.id))
                  .filter(s => s.status === 'pending')
                  .reduce((a, s) => a + s.amount, 0),
              );
        const settlement: Payment = {
          id: generateId('pmt-'),
          receiptNo: await nextReceiptNo(),
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
        await applySettlementWrites(database, plan, settlement);
        detailNote = 'Early settlement approved — plan completed.';
      }
    }
    await database.executeAsync(
      `UPDATE adjustments SET status = ?, resolvedAt = ?, note = ? WHERE id = ?`,
      [approve ? 'approved' : 'rejected', nowIso(), note || detailNote, adjustmentId],
    );
    await database.executeAsync('COMMIT;');
  } catch (e) {
    await database.executeAsync('ROLLBACK;');
    throw e;
  }

  await insertNotification({
    userId: plan.buyerId,
    type: approve ? 'success' : 'warn',
    title: approve ? 'Adjustment approved' : 'Adjustment rejected',
    body: `${adjustment.type} request for ${plan.planNo}: ${note || detailNote}`,
  });
  await addAudit(resolverId, 'adjustment.resolve', `${approve ? 'Approved' : 'Rejected'} ${adjustment.type} on ${plan.planNo}`);
}

async function shiftPendingDues(planId: string, months: number): Promise<void> {
  const res = await getDb().executeAsync(
    "SELECT id, dueDate FROM plan_schedule WHERE planId = ? AND status = 'pending'",
    [planId],
  );
  for (const r of rowsOf<Record<string, unknown>>(res)) {
    await getDb().executeAsync('UPDATE plan_schedule SET dueDate = ? WHERE id = ?', [
      addMonths(toStr(r.dueDate), months),
      toStr(r.id),
    ]);
  }
}

/* ---------------- notifications ---------------- */

export async function insertNotification(input: {
  userId: string;
  type: NotificationItem['type'];
  title: string;
  body: string;
}): Promise<void> {
  await getDb().executeAsync(
    `INSERT INTO notifications (id, userId, type, title, body, isRead, createdAt)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
    [generateId('n-'), input.userId, input.type, input.title, input.body, nowIso()],
  );
}

export async function notificationsForUser(userId: string, limit = 30): Promise<NotificationItem[]> {
  const res = await getDb().executeAsync(
    'SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC LIMIT ?',
    [userId, limit],
  );
  return rowsOf<Record<string, unknown>>(res).map(mapNotification);
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  const res = await getDb().executeAsync(
    'SELECT COUNT(*) AS n FROM notifications WHERE userId = ? AND isRead = 0',
    [userId],
  );
  return toNum(rowsOf<Record<string, unknown>>(res)[0]?.n);
}

export async function markNotificationsRead(userId: string): Promise<void> {
  await getDb().executeAsync('UPDATE notifications SET isRead = 1 WHERE userId = ?', [userId]);
}

/* ---------------- messages ---------------- */

export async function insertMessage(message: Message): Promise<void> {
  await getDb().executeAsync(
    `INSERT INTO messages (id, planId, senderId, recipientId, text, isRead, createdAt)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
    [message.id, message.planId, message.senderId, message.recipientId, message.text, nowIso()],
  );
}

export async function messagesForPlan(planId: string): Promise<Message[]> {
  const res = await getDb().executeAsync(
    'SELECT * FROM messages WHERE planId = ? ORDER BY createdAt',
    [planId],
  );
  return rowsOf<Record<string, unknown>>(res).map(mapMessage);
}

export async function markMessagesRead(planId: string, userId: string): Promise<void> {
  await getDb().executeAsync(
    'UPDATE messages SET isRead = 1 WHERE planId = ? AND recipientId = ?',
    [planId, userId],
  );
}

/* ---------------- audit ---------------- */

export async function addAudit(userId: string, action: string, detail: string): Promise<void> {
  await getDb().executeAsync(
    'INSERT INTO audit_log (id, userId, action, detail, createdAt) VALUES (?, ?, ?, ?, ?)',
    [generateId('a-'), userId, action, detail, nowIso()],
  );
}

export async function listAudit(limit = 100): Promise<AuditEntry[]> {
  const res = await getDb().executeAsync(
    'SELECT * FROM audit_log ORDER BY createdAt DESC LIMIT ?',
    [limit],
  );
  return rowsOf<Record<string, unknown>>(res).map(mapAudit);
}

/* ---------------- helpers ---------------- */

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Settlement writes WITHOUT their own transaction — call inside one. The
 *  payment row inserted is exactly the object passed in (one receipt no). */
async function applySettlementWrites(
  database: QuickSQLiteConnection,
  plan: Plan,
  payment: Payment,
): Promise<void> {
  for (const s of (await scheduleForPlan(plan.id)).filter(x => x.status === 'pending')) {
    await database.executeAsync(
      "UPDATE plan_schedule SET status = 'paid', paidDate = ? WHERE id = ?",
      [today(), s.id],
    );
  }
  await database.executeAsync(
    `INSERT INTO payments (id, receiptNo, planId, buyerId, sellerId, amount, method, date, notes, recordedBy, penalty, type, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [payment.id, payment.receiptNo, payment.planId, payment.buyerId, payment.sellerId,
      payment.amount, payment.method, payment.date, payment.notes, payment.recordedBy,
      payment.penalty, payment.type, payment.createdAt],
  );
  await updatePlanStatus(plan.id, 'completed');
}

/* ---------------- seed ---------------- */

async function seedDatabase(): Promise<void> {
  const database = getDb();
  await database.executeAsync('BEGIN;');
  try {
    for (const u of seedUsers) {
      await insertUser(u);
    }
    for (const c of seedCustomers) {
      await insertCustomer(c);
    }
    for (const p of seedProducts) {
      await insertProduct(p);
    }
    await saveSettings(DEFAULT_SETTINGS);

    // Plan 1 — Juan / TechPhone (active, 7 of 12 paid)
    // NOTE: insertPlanFull, not createPlan — we are already inside the seed's
    // transaction, and nested BEGIN/COMMIT would break its atomicity.
    await insertPlanFull(database, {
      sellerId: 'u-seller', buyerId: 'u-buyer', productId: 'p1',
      productName: 'TechPhone X5 128GB', productEmoji: '', price: 24999,
      downPayment: 5000, apr: 24, term: 12, startDate: '2025-12-19', notes: '',
    });
    // Plan 2 — Liza / Lumina TV (active, 3 of 18 paid)
    await insertPlanFull(database, {
      sellerId: 'u-seller', buyerId: 'u-buyer3', productId: 'p2',
      productName: 'Lumina 4K TV 55-inch', productEmoji: '', price: 32999,
      downPayment: 8000, apr: 30, term: 18, startDate: '2026-04-28', notes: '',
    });
    // Plan 3 — Marco / AeroBike (overdue — 2 of 9 paid)
    await insertPlanFull(database, {
      sellerId: 'u-seller', buyerId: 'u-buyer4', productId: 'p3',
      productName: 'AeroBike MTB Pro', productEmoji: '', price: 18500,
      downPayment: 2500, apr: 18, term: 9, startDate: '2026-04-08', notes: '',
    });
    // Plan 4 — Sofia / WashMaster (active, 1 of 12 paid)
    await insertPlanFull(database, {
      sellerId: 'u-seller', buyerId: 'u-buyer5', productId: 'p4',
      productName: 'WashMaster 9kg Washer', productEmoji: '', price: 21400,
      downPayment: 4000, apr: 24, term: 12, startDate: '2026-06-27', notes: '',
    });
    // Plan 5 — Juan / CoolBreeze (completed, 6 of 6)
    await insertPlanFull(database, {
      sellerId: 'u-seller', buyerId: 'u-buyer', productId: 'p5',
      productName: 'CoolBreeze Aircon 1.0HP', productEmoji: '', price: 24500,
      downPayment: 0, apr: 0, term: 6, startDate: '2025-10-10', notes: '',
    });
    // Plan 6 — Sofia / SoundBar (Pedro's shop)
    await insertPlanFull(database, {
      sellerId: 'u-seller2', buyerId: 'u-buyer5', productId: 'p6',
      productName: 'SoundBar X Pro', productEmoji: '', price: 8900,
      downPayment: 1000, apr: 24, term: 6, startDate: '2026-06-07', notes: '',
    });

    // Mark installments as paid for history (dates line up with due dates)
    await backfillPaidInstallments('pl-', 'HT-1001', 7);
    await backfillPaidInstallments('pl-', 'HT-1002', 3);
    await backfillPaidInstallments('pl-', 'HT-1003', 2);
    await backfillPaidInstallments('pl-', 'HT-1004', 1);
    await backfillPaidInstallments('pl-', 'HT-1005', 6);
    await backfillPaidInstallments('pl-', 'HT-1006', 2);
    await setPlanStatusByNo('HT-1005', 'completed');

    // A seeded pending adjustment: Marco wants a reschedule on HT-1003
    await insertAdjustment({
      id: 'ad-1', planId: (await planByNo('HT-1003'))?.id ?? '',
      buyerId: 'u-buyer4', type: 'reschedule',
      reason: 'Salary delayed this month, can I extend the remaining term by 2 months?',
      detailJson: JSON.stringify({months: 2}), status: 'pending',
      createdAt: new Date(Date.now() - 2 * 86400000).toISOString(), resolvedAt: null, note: '',
    });

    await getDb().executeAsync(
      `INSERT INTO notifications (id, userId, type, title, body, isRead, createdAt)
       VALUES (?, 'u-admin', 'info', 'New account awaiting verification', 'Ana Gonzales registered as a buyer.', 0, ?)`,
      [generateId('n-'), new Date(Date.now() - 3 * 86400000).toISOString()],
    );
    await setSetting('seeded', '1');
    await database.executeAsync('COMMIT;');
  } catch (e) {
    await database.executeAsync('ROLLBACK;');
    throw e;
  }
}

async function planByNo(planNo: string): Promise<Plan | null> {
  const res = await getDb().executeAsync('SELECT * FROM plans WHERE planNo = ?', [planNo]);
  const arr = rowsOf<Record<string, unknown>>(res);
  return arr.length ? mapPlan(arr[0]) : null;
}

async function setPlanStatusByNo(planNo: string, status: Plan['status']): Promise<void> {
  const plan = await planByNo(planNo);
  if (plan) {
    await updatePlanStatus(plan.id, status);
  }
}

/** Pay the first N installments of a plan (seeded payment history). */
async function backfillPaidInstallments(prefix: string, planNo: string, count: number): Promise<void> {
  const plan = await planByNo(planNo);
  if (!plan) {
    return;
  }
  const res = await getDb().executeAsync(
    "SELECT * FROM plan_schedule WHERE planId = ? AND status = 'pending' ORDER BY dueDate LIMIT ?",
    [plan.id, count],
  );
  const dues = rowsOf<Record<string, unknown>>(res);
  const methods = ['Cash', 'GCash', 'Bank transfer'];
  let i = 0;
  for (const due of dues) {
    await getDb().executeAsync(
      "UPDATE plan_schedule SET status = 'paid', paidDate = ? WHERE id = ?",
      [toStr(due.dueDate), toStr(due.id)],
    );
    await getDb().executeAsync(
      `INSERT INTO payments (id, receiptNo, planId, buyerId, sellerId, amount, method, date, notes, recordedBy, penalty, type, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, 0, 'installment', ?)`,
      [generateId(prefix + 'pmt-'), await nextReceiptNo(), plan.id, plan.buyerId, plan.sellerId,
        toNum(due.amount), methods[i % methods.length], toStr(due.dueDate), plan.sellerId,
        toStr(due.dueDate) + 'T09:00:00'],
    );
    i++;
  }
}

/** Domain helpers the UI uses to display plans without raw SQL. */

export async function planWithDerived(plan: Plan): Promise<{
  plan: Plan;
  nextDue: ScheduleItem | null;
  remaining: number;
  penalty: number;
  paidCount: number;
  status: Plan['status'];
}> {
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
