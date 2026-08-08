/**
 * SQLite schema (react-native-quick-sqlite) for HulogTrack.
 *
 * DESIGN NOTES (read DATABASE.md for the full lesson):
 *  - Every table has a TEXT primary key generated on-device (offline-first:
 *    no autoincrement, no server round-trip needed to mint ids).
 *  - Dates are stored as YYYY-MM-DD TEXT (sortable, timezone-safe for
 *    calendar math). Timestamps are ISO-8601 TEXT.
 *  - Booleans are INTEGER 0/1. Money is REAL (cent precision is enforced in
 *    the domain services with round2).
 *  - Schedule rows are their own table so a plan's timeline is queryable
 *    (next due, overdue buckets) with plain SQL + indexes.
 *  - settings is a tiny key/value table for runtime config.
 */
import type {AppSettings, Customer, Product, User} from '../types';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'buyer',          -- 'admin' | 'seller' | 'buyer'
  status TEXT NOT NULL DEFAULT 'pending',      -- 'active' | 'pending' | 'suspended'
  joinedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY NOT NULL,
  sellerId TEXT NOT NULL,
  userId TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  joinedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY NOT NULL,
  sellerId TEXT NOT NULL,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  -- Legacy icon slot: kept for schema stability; the UI renders AssetIcon
  -- placeholders and will use real assets (see src/assets/manifest.ts).
  emoji TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY NOT NULL,
  planNo TEXT NOT NULL UNIQUE,
  sellerId TEXT NOT NULL,
  buyerId TEXT NOT NULL,
  productId TEXT,
  productName TEXT NOT NULL,
  productEmoji TEXT NOT NULL DEFAULT '',
  price REAL NOT NULL,
  downPayment REAL NOT NULL DEFAULT 0,
  financed REAL NOT NULL,
  apr REAL NOT NULL DEFAULT 0,
  term INTEGER NOT NULL,
  installment REAL NOT NULL,
  startDate TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  graceExtra INTEGER NOT NULL DEFAULT 0,       -- approved grace days added to next due
  notes TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_schedule (
  id TEXT PRIMARY KEY NOT NULL,
  planId TEXT NOT NULL,
  dueDate TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',      -- 'pending' | 'paid' | 'skipped'
  paidDate TEXT,
  note TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (planId) REFERENCES plans(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY NOT NULL,
  receiptNo TEXT NOT NULL,
  planId TEXT NOT NULL,
  buyerId TEXT NOT NULL,
  sellerId TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT NOT NULL DEFAULT 'Cash',
  date TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  recordedBy TEXT NOT NULL,
  penalty REAL NOT NULL DEFAULT 0,
  type TEXT NOT NULL DEFAULT 'installment',    -- 'down' | 'installment' | 'settlement'
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS adjustments (
  id TEXT PRIMARY KEY NOT NULL,
  planId TEXT NOT NULL,
  buyerId TEXT NOT NULL,
  type TEXT NOT NULL,                          -- 'holiday' | 'reschedule' | 'grace' | 'early'
  reason TEXT NOT NULL,
  detailJson TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',      -- 'pending' | 'approved' | 'rejected'
  createdAt TEXT NOT NULL,
  resolvedAt TEXT,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY NOT NULL,
  userId TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  isRead INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  planId TEXT NOT NULL,
  senderId TEXT NOT NULL,
  recipientId TEXT NOT NULL,
  text TEXT NOT NULL,
  isRead INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  userId TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

-- Indexes: query planners use these for the hot paths (a seller's plan list,
-- a buyer's next-due lookup, the monthly collections chart).
CREATE INDEX IF NOT EXISTS idx_plans_seller ON plans(sellerId);
CREATE INDEX IF NOT EXISTS idx_plans_buyer ON plans(buyerId);
CREATE INDEX IF NOT EXISTS idx_schedule_plan ON plan_schedule(planId, status);
CREATE INDEX IF NOT EXISTS idx_schedule_due ON plan_schedule(dueDate);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);
CREATE INDEX IF NOT EXISTS idx_payments_plan ON payments(planId);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(userId, isRead);
CREATE INDEX IF NOT EXISTS idx_messages_plan ON messages(planId);
CREATE INDEX IF NOT EXISTS idx_adjustments_plan ON adjustments(planId, status);
`;

/**
 * Schema version for PRAGMA user_version.
 * When you change the schema, bump this and append a guarded migration step
 * below — see MIGRATIONS for the pattern.
 */
export const SCHEMA_VERSION = 2;

/** A migration is a guarded step that brings an EXISTING database up to a
 *  newer schema. Guarded = it checks (PRAGMA table_info) before ALTERing, so
 *  it is safe to run on both fresh installs and old databases. */
export type Migration = {
  version: number;
  apply: (db: {
    executeAsync: (sql: string, params?: unknown[]) => Promise<unknown>;
  }) => Promise<void>;
};

/**
 * Example real migration: v1 shipped plans without a `notes` column; v2 adds
 * it. On a fresh install SCHEMA already creates the column, so the guard
 * makes this a no-op. On a v1 database the ALTER actually runs.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 2,
    apply: async db => {
      const info = (await db.executeAsync('PRAGMA table_info(plans)')) as {
        rows?: {_array: Array<{name: string}>};
      };
      const hasNotes = (info.rows?._array ?? []).some(c => c.name === 'notes');
      if (!hasNotes) {
        await db.executeAsync(
          "ALTER TABLE plans ADD COLUMN notes TEXT NOT NULL DEFAULT ''",
        );
      }
    },
  },
];

/* ------------------------------------------------------------------ */
/* Seed data (first launch only).                                      */
/* ------------------------------------------------------------------ */

export const DEFAULT_SETTINGS: AppSettings = {
  businessName: 'Santos Appliances & Gadgets',
  businessAddr: '12 Rizal Avenue, Brgy. San Isidro, Quezon City',
  businessPhone: '+63 917 000 2222',
  taxId: '123-456-789-000',
  currency: '₱',
  graceDays: 3,
  penaltyRate: 2, // 2% per month, prorated daily
  penaltyCap: 25, // capped at 25% of the installment
  defaultApr: 24,
  reminderLead: 3,
};

export const seedUsers: User[] = [
  {id: 'u-admin', name: 'Andres Reyes', email: 'admin@hulog.ph', password: 'admin123', phone: '+63 917 000 0001', role: 'admin', status: 'active', joinedAt: '2025-06-12'},
  {id: 'u-seller', name: 'Maria Santos', email: 'seller@hulog.ph', password: 'seller123', phone: '+63 917 000 0002', role: 'seller', status: 'active', joinedAt: '2025-08-21'},
  {id: 'u-seller2', name: 'Pedro Lim', email: 'pedro@hulog.ph', password: 'seller123', phone: '+63 917 000 0003', role: 'seller', status: 'active', joinedAt: '2025-10-10'},
  {id: 'u-buyer', name: 'Juan Dela Cruz', email: 'buyer@hulog.ph', password: 'buyer123', phone: '+63 912 345 6789', role: 'buyer', status: 'active', joinedAt: '2026-01-18'},
  {id: 'u-buyer2', name: 'Ana Gonzales', email: 'buyer2@hulog.ph', password: 'buyer123', phone: '+63 912 345 6790', role: 'buyer', status: 'pending', joinedAt: '2026-08-03'},
  {id: 'u-buyer3', name: 'Liza Reyes', email: 'liza@hulog.ph', password: 'buyer123', phone: '+63 912 345 6791', role: 'buyer', status: 'active', joinedAt: '2026-02-26'},
  {id: 'u-buyer4', name: 'Marco Tan', email: 'marco@hulog.ph', password: 'buyer123', phone: '+63 912 345 6792', role: 'buyer', status: 'active', joinedAt: '2026-04-08'},
  {id: 'u-buyer5', name: 'Sofia Villanueva', email: 'sofia@hulog.ph', password: 'buyer123', phone: '+63 912 345 6793', role: 'buyer', status: 'active', joinedAt: '2026-05-08'},
];

export const seedCustomers: Customer[] = [
  {id: 'c1', sellerId: 'u-seller', userId: 'u-buyer', name: 'Juan Dela Cruz', phone: '+63 912 345 6789', email: 'buyer@hulog.ph', address: '23 Mabini St, QC', notes: 'Repeat customer', joinedAt: '2026-01-18'},
  {id: 'c2', sellerId: 'u-seller', userId: 'u-buyer3', name: 'Liza Reyes', phone: '+63 912 345 6791', email: 'liza@hulog.ph', address: '88 Scout St, QC', notes: '', joinedAt: '2026-02-26'},
  {id: 'c3', sellerId: 'u-seller', userId: 'u-buyer4', name: 'Marco Tan', phone: '+63 912 345 6792', email: 'marco@hulog.ph', address: '5 Luna Ave, Manila', notes: 'Prefers GCash', joinedAt: '2026-04-08'},
  {id: 'c4', sellerId: 'u-seller', userId: 'u-buyer5', name: 'Sofia Villanueva', phone: '+63 912 345 6793', email: 'sofia@hulog.ph', address: '100 Quezon Blvd', notes: '', joinedAt: '2026-05-08'},
  {id: 'c5', sellerId: 'u-seller2', userId: 'u-buyer5', name: 'Sofia Villanueva', phone: '+63 912 345 6793', email: 'sofia@hulog.ph', address: '100 Quezon Blvd', notes: 'Also buys from Pedro', joinedAt: '2026-05-18'},
];

export const seedProducts: Product[] = [
  {id: 'p1', sellerId: 'u-seller', name: 'TechPhone X5 128GB', price: 24999, cost: 21500, stock: 12, emoji: ''},
  {id: 'p2', sellerId: 'u-seller', name: 'Lumina 4K TV 55-inch', price: 32999, cost: 27000, stock: 6, emoji: ''},
  {id: 'p3', sellerId: 'u-seller', name: 'AeroBike MTB Pro', price: 18500, cost: 14000, stock: 8, emoji: ''},
  {id: 'p4', sellerId: 'u-seller', name: 'WashMaster 9kg Washer', price: 21400, cost: 16900, stock: 5, emoji: ''},
  {id: 'p5', sellerId: 'u-seller', name: 'CoolBreeze Aircon 1.0HP', price: 24500, cost: 19000, stock: 7, emoji: ''},
  {id: 'p6', sellerId: 'u-seller2', name: 'SoundBar X Pro', price: 8900, cost: 6200, stock: 15, emoji: ''},
];
