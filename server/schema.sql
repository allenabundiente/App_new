-- HulogTrack — Postgres schema
-- Mirrors the mobile SQLite schema (src/db/schema.ts) 1:1 so a plan,
-- payment, or adjustment created on the server has the same shape on the
-- device. All ids are TEXT generated on the client/server (no SERIAL —
-- offline-first design keeps working).
--
-- Run via:  psql $DATABASE_URL -f schema.sql
-- The server also applies this automatically at boot if the tables are
-- missing (see src/db.ts → ensureSchema), so you usually never run this
-- by hand.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'buyer',
  status TEXT NOT NULL DEFAULT 'pending',
  joinedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
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
  id TEXT PRIMARY KEY,
  sellerId TEXT NOT NULL,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  emoji TEXT NOT NULL DEFAULT '🛍️'
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  planNo TEXT NOT NULL UNIQUE,
  sellerId TEXT NOT NULL,
  buyerId TEXT NOT NULL,
  productId TEXT,
  productName TEXT NOT NULL,
  productEmoji TEXT NOT NULL DEFAULT '📦',
  price REAL NOT NULL,
  downPayment REAL NOT NULL DEFAULT 0,
  financed REAL NOT NULL,
  apr REAL NOT NULL DEFAULT 0,
  term INTEGER NOT NULL,
  installment REAL NOT NULL,
  startDate TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  graceExtra INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_schedule (
  id TEXT PRIMARY KEY,
  planId TEXT NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  dueDate TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  paidDate TEXT,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
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
  type TEXT NOT NULL DEFAULT 'installment',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS adjustments (
  id TEXT PRIMARY KEY,
  planId TEXT NOT NULL,
  buyerId TEXT NOT NULL,
  type TEXT NOT NULL,
  reason TEXT NOT NULL,
  detailJson TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  createdAt TEXT NOT NULL,
  resolvedAt TEXT,
  note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  isRead INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL,
  dedupKey TEXT
);

-- Server-side due reminders stamp a deterministic dedup key so each reminder
-- is emitted exactly once (see src/services/reminders.ts). Partial unique
-- index: manual notifications have NULL dedupKey and are never blocked.
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedupKey TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedup
  ON notifications(dedupKey) WHERE dedupKey IS NOT NULL;

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  planId TEXT NOT NULL,
  senderId TEXT NOT NULL,
  recipientId TEXT NOT NULL,
  text TEXT NOT NULL,
  isRead INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plans_seller ON plans(sellerId);
CREATE INDEX IF NOT EXISTS idx_plans_buyer ON plans(buyerId);
CREATE INDEX IF NOT EXISTS idx_schedule_plan ON plan_schedule(planId, status);
CREATE INDEX IF NOT EXISTS idx_schedule_due ON plan_schedule(dueDate);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);
CREATE INDEX IF NOT EXISTS idx_payments_plan ON payments(planId);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(userId, isRead);
CREATE INDEX IF NOT EXISTS idx_messages_plan ON messages(planId);
CREATE INDEX IF NOT EXISTS idx_adjustments_plan ON adjustments(planId, status);
