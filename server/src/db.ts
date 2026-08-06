/**
 * Server database layer.
 * - Pool is created from DATABASE_URL (or injected for tests — pg-mem).
 * - `q()` is the one query helper; rows are plain objects.
 * - Mappers convert snake_case rows to the camelCase contracts in types.ts,
 *   exactly like the mobile repository does.
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {Pool, type QueryResult} from 'pg';
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
} from './types';
import {toNum, toStr} from './convert';

let pool: Pool | null = null;

/** Create (or reuse) the connection pool. Used by app bootstrap. */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({connectionString: process.env.DATABASE_URL});
  }
  return pool;
}

/** Tests inject an in-memory pool (pg-mem) before routes are exercised. */
export function setPool(p: Pool | null): void {
  pool = p;
}

/* ------------------------------ query helper ------------------------------ */

/**
 * Postgres folds unquoted identifiers to lowercase, so a row from
 * `SELECT planNo …` arrives keyed as `planno`. This dict maps every lowercase
 * column back to its camelCase contract name so mappers can stay clean.
 */
const COLUMN_ALIASES: Record<string, string> = {
  id: 'id', name: 'name', email: 'email', password: 'password', phone: 'phone',
  role: 'role', status: 'status', notes: 'notes', text: 'text', title: 'title',
  body: 'body', reason: 'reason', type: 'type', method: 'method', date: 'date',
  address: 'address', emoji: 'emoji', apr: 'apr', term: 'term', stock: 'stock',
  price: 'price', cost: 'cost', action: 'action', detail: 'detail', value: 'value',
  key: 'key', n: 'n', amount: 'amount', count: 'count', token: 'token',
  joinedat: 'joinedAt', userid: 'userId', sellerid: 'sellerId', buyerid: 'buyerId',
  productid: 'productId', productname: 'productName', productemoji: 'productEmoji',
  downpayment: 'downPayment', financed: 'financed', installment: 'installment',
  startdate: 'startDate', graceextra: 'graceExtra', createdat: 'createdAt',
  planno: 'planNo', planid: 'planId', duedate: 'dueDate', paiddate: 'paidDate',
  receiptno: 'receiptNo', recordedby: 'recordedBy', detailjson: 'detailJson',
  resolvedat: 'resolvedAt', isread: 'isRead', senderid: 'senderId',
  recipientid: 'recipientId', currency: 'currency', businessname: 'businessName',
  businessaddr: 'businessAddr', businessphone: 'businessPhone', taxid: 'taxId',
  gracedays: 'graceDays', penaltyrate: 'penaltyRate', penaltycap: 'penaltyCap',
  defaultapr: 'defaultApr', reminderlead: 'reminderLead',
};

/** Normalize a raw pg row's keys to camelCase (identity for unknown keys). */
export function normalizeRow<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(row)) {
    out[COLUMN_ALIASES[k] ?? k] = row[k];
  }
  return out as T;
}

export async function q<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res: QueryResult = await getPool().query(sql, params as never[]);
  return ((res.rows as unknown as Record<string, unknown>[]) ?? []).map(r =>
    normalizeRow(r),
  ) as T[];
}

export async function qOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await q<T>(sql, params);
  return rows.length ? rows[0] : null;
}

/* --------------------------------- mappers --------------------------------- */

export function mapUser(r: Record<string, unknown>): User {
  return {
    id: toStr(r.id),
    name: toStr(r.name),
    email: toStr(r.email),
    password: toStr(r.password),
    phone: toStr(r.phone),
    role: toStr(r.role) as User['role'],
    status: toStr(r.status) as User['status'],
    joinedAt: toStr(r.joinedAt),
  };
}

export function mapCustomer(r: Record<string, unknown>): Customer {
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

export function mapProduct(r: Record<string, unknown>): Product {
  return {
    id: toStr(r.id),
    sellerId: toStr(r.sellerId),
    name: toStr(r.name),
    price: toNum(r.price),
    cost: toNum(r.cost),
    stock: toNum(r.stock),
    emoji: toStr(r.emoji),
  };
}

export function mapPlan(r: Record<string, unknown>): Plan {
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

export function mapSchedule(r: Record<string, unknown>): ScheduleItem {
  return {
    id: toStr(r.id),
    planId: toStr(r.planId),
    dueDate: toStr(r.dueDate),
    amount: toNum(r.amount),
    status: toStr(r.status) as ScheduleItem['status'],
    paidDate: r.paidDate == null ? null : toStr(r.paidDate),
    note: toStr(r.note),
  };
}

export function mapPayment(r: Record<string, unknown>): Payment {
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

export function mapAdjustment(r: Record<string, unknown>): Adjustment {
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

export function mapNotification(r: Record<string, unknown>): NotificationItem {
  return {
    id: toStr(r.id),
    userId: toStr(r.userId),
    type: toStr(r.type) as NotificationItem['type'],
    title: toStr(r.title),
    body: toStr(r.body),
    isRead: r.isRead === 1 || r.isRead === true || r.isRead === '1' || r.isRead === 'true',
    createdAt: toStr(r.createdAt),
  };
}

export function mapMessage(r: Record<string, unknown>): Message {
  return {
    id: toStr(r.id),
    planId: toStr(r.planId),
    senderId: toStr(r.senderId),
    recipientId: toStr(r.recipientId),
    text: toStr(r.text),
    isRead: r.isRead === 1 || r.isRead === true || r.isRead === '1' || r.isRead === 'true',
    createdAt: toStr(r.createdAt),
  };
}

export function mapAudit(r: Record<string, unknown>): AuditEntry {
  return {
    id: toStr(r.id),
    userId: toStr(r.userId),
    action: toStr(r.action),
    detail: toStr(r.detail),
    createdAt: toStr(r.createdAt),
  };
}

/* -------------------------------- settings -------------------------------- */

export const DEFAULT_SETTINGS: AppSettings = {
  businessName: 'Santos Appliances & Gadgets',
  businessAddr: '12 Rizal Avenue, Brgy. San Isidro, Quezon City',
  businessPhone: '+63 917 000 2222',
  taxId: '123-456-789-000',
  currency: '₱',
  graceDays: 3,
  penaltyRate: 2,
  penaltyCap: 25,
  defaultApr: 24,
  reminderLead: 3,
};

export async function getSetting(key: string): Promise<string | null> {
  const row = await qOne<{value: string}>('SELECT value FROM settings WHERE key = $1', [key]);
  return row ? row.value : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await q(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  );
}

export async function getSettings(): Promise<AppSettings> {
  const rows = await q<{key: string; value: string}>('SELECT key, value FROM settings');
  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.key] = r.value;
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

/** Monotonic receipt counter — lives in settings, same as the app. */
export async function nextReceiptNo(): Promise<string> {
  const current = toNum(await getSetting('receipt_seq'));
  const next = current + 1;
  await setSetting('receipt_seq', String(next));
  return 'R-' + String(next).padStart(4, '0');
}

/* ------------------------------ schema bootstrap -------------------------- */

/** Apply schema.sql (CREATE TABLE IF NOT EXISTS …) — idempotent. */
export async function ensureSchema(): Promise<void> {
  const sql = readFileSync(join(__dirname, '..', 'schema.sql'), 'utf8');
  // pg driver executes a multi-statement string in one round trip.
  await getPool().query(sql);
}
