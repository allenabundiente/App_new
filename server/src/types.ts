/** Server-side contracts — identical to the mobile app's src/types.ts so the
 *  API can return the exact shapes the app already knows. */

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
  joinedAt: string;
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
  dueDate: string;
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
  date: string;
  notes: string;
  recordedBy: string;
  penalty: number;
  type: PaymentType;
  createdAt: string;
}

export type AdjustmentType = 'holiday' | 'reschedule' | 'grace' | 'early';
export type AdjustmentStatus = 'pending' | 'approved' | 'rejected';

export interface Adjustment {
  id: string;
  planId: string;
  buyerId: string;
  type: AdjustmentType;
  reason: string;
  detailJson: string;
  status: AdjustmentStatus;
  createdAt: string;
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
  createdAt: string;
}

export interface Message {
  id: string;
  planId: string;
  senderId: string;
  recipientId: string;
  text: string;
  createdAt: string;
  isRead: boolean;
}

export interface AuditEntry {
  id: string;
  userId: string;
  action: string;
  detail: string;
  createdAt: string;
}

export interface AppSettings {
  businessName: string;
  businessAddr: string;
  businessPhone: string;
  taxId: string;
  currency: string;
  graceDays: number;
  penaltyRate: number;
  penaltyCap: number;
  defaultApr: number;
  reminderLead: number;
}

export interface SettlementQuote {
  remaining: number;
  incentive: number;
  fee: number;
  total: number;
}

/** The plan + derived numbers the UI shows (mirrors planWithDerived). */
export interface PlanDerived {
  plan: Plan;
  nextDue: ScheduleItem | null;
  remaining: number;
  penalty: number;
  paidCount: number;
  status: PlanStatus;
}
