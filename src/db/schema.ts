/**
 * The SQLite tables for HulogTrack.
 *
 * A few things to remember about the design:
 *  - Every table uses a TEXT id we make on the phone, so nothing needs an
 *    autoincrement or a round trip to a server to get an id.
 *  - Dates are YYYY-MM-DD text because it sorts nicely and is safe for
 *    calendar maths. Timestamps are saved as ISO-8601 text.
 *  - Booleans are 0 or 1 and money is REAL. The cent precision is checked
 *    in the services with round2.
 *  - Schedule rows are their own table so we can query a plan's timeline
 *    (next due date, overdue buckets) with plain SQL.
 *  - settings is a small key/value table for the shop's config.
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
  joinedAt TEXT NOT NULL,
  -- Seller: QR image URL/data-URI buyers scan to pay online (GCash etc.).
  qrImage TEXT NOT NULL DEFAULT '',
  -- Admin: when set, this admin only oversees this seller's transactions.
  assignedSellerId TEXT
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
  -- Legacy icon slot: kept for schema stability. The UI renders AssetIcon
  -- placeholders and will use real assets (see src/assets/manifest.ts).
  emoji TEXT NOT NULL DEFAULT '',
  -- Optional product photo: URL (https://…) or data URI. Empty = none.
  image TEXT NOT NULL DEFAULT ''
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
  -- How much has been paid toward this installment (0 = nothing). A payment
  -- larger than the next due covers several installments; the remainder
  -- lands here as credit on the following due ("paid 2 months, half the next").
  paidAmount REAL NOT NULL DEFAULT 0,
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
 * Splits a SQL script into single statements for engines that only run one
 * statement at a time (react-native-quick-sqlite). The `--` comments are
 * stripped first because a semicolon inside a comment would split a
 * statement in two and SQLite would reject it.
 */
export function splitStatements(sql: string): string[] {
  const stripped = sql
    .split('\n')
    .map(line => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
  return stripped
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * The schema version we store in PRAGMA user_version.
 * When you change the tables, bump this number and add a step to MIGRATIONS
 * below.
 */
export const SCHEMA_VERSION = 4;

/** A migration step updates a database that already exists to a newer
 *  schema. It checks the table first with PRAGMA table_info so it is safe
 *  to run on both a fresh install and an old database. */
export type Migration = {
  version: number;
  apply: (db: {
    executeAsync: (sql: string, params?: unknown[]) => Promise<unknown>;
  }) => Promise<void>;
};

/**
 * An example of a real migration. Version 1 shipped without a `notes`
 * column on plans, version 2 added it. On a fresh install SCHEMA already
 * creates the column so the guard makes this do nothing, but on an old
 * version 1 database the ALTER actually runs.
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
  {
    version: 3,
    apply: async db => {
      const info = (await db.executeAsync('PRAGMA table_info(products)')) as {
        rows?: {_array: Array<{name: string}>};
      };
      const hasImage = (info.rows?._array ?? []).some(c => c.name === 'image');
      if (!hasImage) {
        await db.executeAsync(
          "ALTER TABLE products ADD COLUMN image TEXT NOT NULL DEFAULT ''",
        );
      }
    },
  },
  {
    version: 4,
    apply: async db => {
      const usersInfo = (await db.executeAsync('PRAGMA table_info(users)')) as {
        rows?: {_array: Array<{name: string}>};
      };
      const userCols = new Set((usersInfo.rows?._array ?? []).map(c => c.name));
      if (!userCols.has('qrImage')) {
        await db.executeAsync("ALTER TABLE users ADD COLUMN qrImage TEXT NOT NULL DEFAULT ''");
      }
      if (!userCols.has('assignedSellerId')) {
        await db.executeAsync('ALTER TABLE users ADD COLUMN assignedSellerId TEXT');
      }
      const schInfo = (await db.executeAsync('PRAGMA table_info(plan_schedule)')) as {
        rows?: {_array: Array<{name: string}>};
      };
      const hasPaid = (schInfo.rows?._array ?? []).some(c => c.name === 'paidAmount');
      if (!hasPaid) {
        await db.executeAsync(
          'ALTER TABLE plan_schedule ADD COLUMN paidAmount REAL NOT NULL DEFAULT 0',
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
  penaltyRate: 2, // 2% per month
  penaltyCap: 25, // never more than 25% of the installment
  defaultApr: 24,
  reminderLead: 3,
};

export const seedUsers: User[] = [
  {id: 'u-admin', name: 'Andres Reyes', email: 'admin@hulog.ph', password: 'admin123', phone: '+63 917 000 0001', role: 'admin', status: 'active', joinedAt: '2025-06-12', qrImage: '', assignedSellerId: null},
  {id: 'u-seller', name: 'Maria Santos', email: 'seller@hulog.ph', password: 'seller123', phone: '+63 917 000 0002', role: 'seller', status: 'active', joinedAt: '2025-08-21', qrImage: '', assignedSellerId: null},
  {id: 'u-seller2', name: 'Pedro Lim', email: 'pedro@hulog.ph', password: 'seller123', phone: '+63 917 000 0003', role: 'seller', status: 'active', joinedAt: '2025-10-10', qrImage: '', assignedSellerId: null},
  {id: 'u-buyer', name: 'Juan Dela Cruz', email: 'buyer@hulog.ph', password: 'buyer123', phone: '+63 912 345 6789', role: 'buyer', status: 'active', joinedAt: '2026-01-18', qrImage: '', assignedSellerId: null},
  {id: 'u-buyer2', name: 'Ana Gonzales', email: 'buyer2@hulog.ph', password: 'buyer123', phone: '+63 912 345 6790', role: 'buyer', status: 'pending', joinedAt: '2026-08-03', qrImage: '', assignedSellerId: null},
  {id: 'u-buyer3', name: 'Liza Reyes', email: 'liza@hulog.ph', password: 'buyer123', phone: '+63 912 345 6791', role: 'buyer', status: 'active', joinedAt: '2026-02-26', qrImage: '', assignedSellerId: null},
  {id: 'u-buyer4', name: 'Marco Tan', email: 'marco@hulog.ph', password: 'buyer123', phone: '+63 912 345 6792', role: 'buyer', status: 'active', joinedAt: '2026-04-08', qrImage: '', assignedSellerId: null},
  {id: 'u-buyer5', name: 'Sofia Villanueva', email: 'sofia@hulog.ph', password: 'buyer123', phone: '+63 912 345 6793', role: 'buyer', status: 'active', joinedAt: '2026-05-08', qrImage: '', assignedSellerId: null},
];

export const seedCustomers: Customer[] = [
  {id: 'c1', sellerId: 'u-seller', userId: 'u-buyer', name: 'Juan Dela Cruz', phone: '+63 912 345 6789', email: 'buyer@hulog.ph', address: '23 Mabini St, QC', notes: 'Repeat customer', joinedAt: '2026-01-18'},
  {id: 'c2', sellerId: 'u-seller', userId: 'u-buyer3', name: 'Liza Reyes', phone: '+63 912 345 6791', email: 'liza@hulog.ph', address: '88 Scout St, QC', notes: '', joinedAt: '2026-02-26'},
  {id: 'c3', sellerId: 'u-seller', userId: 'u-buyer4', name: 'Marco Tan', phone: '+63 912 345 6792', email: 'marco@hulog.ph', address: '5 Luna Ave, Manila', notes: 'Prefers GCash', joinedAt: '2026-04-08'},
  {id: 'c4', sellerId: 'u-seller', userId: 'u-buyer5', name: 'Sofia Villanueva', phone: '+63 912 345 6793', email: 'sofia@hulog.ph', address: '100 Quezon Blvd', notes: '', joinedAt: '2026-05-08'},
  {id: 'c5', sellerId: 'u-seller2', userId: 'u-buyer5', name: 'Sofia Villanueva', phone: '+63 912 345 6793', email: 'sofia@hulog.ph', address: '100 Quezon Blvd', notes: 'Also buys from Pedro', joinedAt: '2026-05-18'},
];

export const seedProducts: Product[] = [
  {id: 'p1', sellerId: 'u-seller', name: 'TechPhone X5 128GB', price: 24999, cost: 21500, stock: 12, emoji: '', image: ''},
  {id: 'p2', sellerId: 'u-seller', name: 'Lumina 4K TV 55-inch', price: 32999, cost: 27000, stock: 6, emoji: '', image: ''},
  {id: 'p3', sellerId: 'u-seller', name: 'AeroBike MTB Pro', price: 18500, cost: 14000, stock: 8, emoji: '', image: ''},
  {id: 'p4', sellerId: 'u-seller', name: 'WashMaster 9kg Washer', price: 21400, cost: 16900, stock: 5, emoji: '', image: ''},
  {id: 'p5', sellerId: 'u-seller', name: 'CoolBreeze Aircon 1.0HP', price: 24500, cost: 19000, stock: 7, emoji: '', image: ''},
  {id: 'p6', sellerId: 'u-seller2', name: 'SoundBar X Pro', price: 8900, cost: 6200, stock: 15, emoji: '', image: ''},
];
