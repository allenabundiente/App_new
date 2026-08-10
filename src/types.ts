/**
 * HulogTrack — Data Contracts
 * These mirror the SQLite schema in src/db/schema.ts 1:1.
 * The DB stores snake_case; every repository mapper converts to these shapes.
 */

export type Role = 'admin' | 'seller' | 'buyer';
export type UserStatus = 'active' | 'pending' | 'suspended';

export interface User {
  id: string;
  name: string;
  email: string;
  password: string;
  phone: string;
  role: Role;
  status: UserStatus;
  joinedAt: string; // YYYY-MM-DD
}

export interface Customer {
  id: string;
  sellerId: string;
  userId: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  joinedAt: string;
}

export interface Product {
  id: string;
  sellerId: string;
  name: string;
  price: number;
  cost: number;
  stock: number;
  emoji: string;
  /** Optional product photo — a URL (https://…) or a data URI. Empty = none. */
  image: string;
}

export type PlanStatus = 'active' | 'overdue' | 'defaulted' | 'completed' | 'cancelled';

export interface Plan {
  id: string;
  planNo: string;
  sellerId: string;
  buyerId: string;
  productId: string | null;
  productName: string;
  productEmoji: string;
  price: number;
  downPayment: number;
  financed: number;
  apr: number;
  term: number;
  installment: number;
  startDate: string;
  status: PlanStatus;
  graceExtra: number;
  notes: string;
  createdAt: string;
}

export type ScheduleStatus = 'pending' | 'paid' | 'skipped';

export interface ScheduleItem {
  id: string;
  planId: string;
  dueDate: string; // YYYY-MM-DD
  amount: number;
  status: ScheduleStatus;
  paidDate: string | null;
  note: string;
}

export type PaymentType = 'down' | 'installment' | 'settlement';

export interface Payment {
  id: string;
  receiptNo: string;
  planId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
  method: string;
  date: string; // YYYY-MM-DD
  notes: string;
  recordedBy: string;
  penalty: number;
  type: PaymentType;
  createdAt: string; // ISO
}

export type AdjustmentType = 'holiday' | 'reschedule' | 'grace' | 'early';
export type AdjustmentStatus = 'pending' | 'approved' | 'rejected';

export interface Adjustment {
  id: string;
  planId: string;
  buyerId: string;
  type: AdjustmentType;
  reason: string;
  detailJson: string; // {"days":5} | {"months":2} | {"quote":{...}}
  status: AdjustmentStatus;
  createdAt: string; // ISO
  resolvedAt: string | null;
  note: string;
}

export interface NotificationItem {
  id: string;
  userId: string;
  type: 'money' | 'success' | 'warn' | 'danger' | 'info' | 'plan';
  title: string;
  body: string;
  isRead: boolean;
  createdAt: string; // ISO
}

export interface Message {
  id: string;
  planId: string;
  senderId: string;
  recipientId: string;
  text: string;
  createdAt: string; // ISO
  isRead: boolean;
}

export interface AuditEntry {
  id: string;
  userId: string;
  action: string;
  detail: string;
  createdAt: string; // ISO
}

/** Business settings persisted in the settings table. */
export interface AppSettings {
  businessName: string;
  businessAddr: string;
  businessPhone: string;
  taxId: string;
  currency: string;
  graceDays: number;
  penaltyRate: number; // % per month, prorated daily
  penaltyCap: number; // % of installment
  defaultApr: number;
  reminderLead: number; // days before due
}

/** Early settlement quote. */
export interface SettlementQuote {
  remaining: number;
  incentive: number;
  fee: number;
  total: number;
}
