/**
 * The shapes of our data. These match the tables in src/db/schema.ts.
 * The database keeps column names in snake_case and the mappers in the
 * repository turn them into these.
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
  /** Seller's QR code that buyers scan to pay. */
  qrImage: string;
  /** If this is set the admin can only see this one seller's sales. */
  assignedSellerId: string | null;
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
  /** Product photo. Can be a web link or a data URI, empty means none. */
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
  /** How much of this installment is already paid. */
  paidAmount: number;
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
  type: 'money' | 'success' | 'warn' | 'danger' | 'info' | 'plan' | 'chat';
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

/** Shop settings saved in the settings table. */
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

/** What it costs to settle a plan early. */
export interface SettlementQuote {
  remaining: number;
  incentive: number;
  fee: number;
  total: number;
}
