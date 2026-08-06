/**
 * Cloud client — the app's HTTP bridge to the HulogTrack API (server/).
 *
 * Every function mirrors the LOCAL repository (src/db/repository.ts) 1:1 so
 * the two can be swapped behind src/db/dataAccess.ts. All data returned has
 * the exact camelCase shapes the app's types define.
 *
 * Config lives in MMKV: API base URL (settings.apiBase) and session token
 * (session.apiToken) — set from the login screen's "cloud mode" switch.
 */
import {kv} from '../storage/kv';
import type {
  Adjustment,
  AppSettings,
  Customer,
  Message,
  NotificationItem,
  Payment,
  Plan,
  PlanStatus,
  Product,
  ScheduleItem,
  User,
} from '../types';

export const DEFAULT_API_URL = 'http://localhost:4000';

export function getApiUrl(): string {
  return kv.getString('settings.apiBase') || DEFAULT_API_URL;
}

export function setApiUrl(url: string): void {
  kv.set('settings.apiBase', url.trim().replace(/\/+$/, ''));
}

function getToken(): string | null {
  return kv.getString('session.apiToken') ?? null;
}

export function setToken(token: string | null): void {
  if (token) {
    kv.set('session.apiToken', token);
  } else {
    kv.remove('session.apiToken');
  }
}

/* ------------------------------ HTTP plumbing ------------------------------ */

class ApiError extends Error {}

/** Thrown on 401 — lets callers distinguish "logged out" from other failures. */
export class ApiAuthError extends ApiError {}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  let res: Response;
  try {
    res = await fetch(`${getApiUrl()}${path}`, {...init, headers});
  } catch {
    throw new ApiError(
      `Cannot reach the server at ${getApiUrl()}. Check your API URL and that the server is running.`,
    );
  }
  if (!res.ok) {
    if (res.status === 401) {
      throw new ApiAuthError('Session expired. Please sign in again.');
    }
    const body = (await res.json().catch(() => ({}))) as {error?: string; reason?: string};
    const msg = body.error ?? body.reason ?? `Request failed (${res.status})`;
    throw new ApiError(msg);
  }
  return (await res.json()) as T;
}

/** 401-safe fetch for nullable lookups (boot session restore etc.). */
async function requestNullable<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  try {
    return await request<T>(path, init);
  } catch (e) {
    if (e instanceof ApiAuthError) {
      return null;
    }
    throw e;
  }
}

function qs(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? '?' + parts.join('&') : '';
}

/* ---------------------------------- auth ---------------------------------- */

export async function initDatabase(): Promise<void> {
  // Cloud mode has nothing to initialize locally — the DB lives on the server.
}

export async function signIn(
  email: string,
  password: string,
): Promise<{ok: true; user: User; token: string} | {ok: false; reason: string}> {
  const res = await request<{
    ok: boolean;
    token?: string;
    user?: User;
    reason?: string;
  }>('/api/auth/login', {method: 'POST', body: JSON.stringify({email, password})});
  if (!res.ok || !res.token || !res.user) {
    return {ok: false, reason: res.reason ?? 'Login failed.'};
  }
  setToken(res.token);
  return {ok: true, user: res.user, token: res.token};
}

export async function signUp(input: {
  name: string;
  email: string;
  password: string;
  phone: string;
  role: 'buyer' | 'seller';
}): Promise<{ok: boolean; reason: string}> {
  const res = await request<{ok: boolean; reason: string}>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return {ok: res.ok, reason: res.reason ?? 'Registration failed.'};
}

export async function logOutCloud(): Promise<void> {
  try {
    await request<{ok: boolean}>('/api/auth/logout', {method: 'POST'});
  } catch {
    // Local token cleanup still happens even if the server is unreachable.
  }
  setToken(null);
}

/* ---------------------------------- users --------------------------------- */

export async function getUser(id: string): Promise<User | null> {
  const res = await requestNullable<{user: User | null}>(`/api/users/${encodeURIComponent(id)}`);
  return res?.user ?? null;
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const res = await requestNullable<{user: User | null}>(`/api/users/by-email${qs({email})}`);
  return res?.user ?? null;
}

export async function listUsers(): Promise<User[]> {
  const res = await request<{users: User[]}>('/api/users');
  return res.users;
}

export async function updateUserStatus(id: string, status: User['status']): Promise<void> {
  await request<{ok: boolean}>(`/api/users/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({status}),
  });
}

/* ----------------------------- customers/products ------------------------- */

export async function listCustomers(sellerId: string): Promise<Customer[]> {
  const res = await request<{customers: Customer[]}>(`/api/customers${qs({sellerId})}`);
  return res.customers;
}

export async function createCustomerWithUser(input: {
  sellerId: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}): Promise<Customer> {
  const res = await request<{customer: Customer}>('/api/customers', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.customer;
}

export async function listProducts(sellerId: string): Promise<Product[]> {
  const res = await request<{products: Product[]}>(`/api/products${qs({sellerId})}`);
  return res.products;
}

/* ---------------------------------- plans --------------------------------- */

export async function listPlans(opts?: {sellerId?: string; buyerId?: string}): Promise<Plan[]> {
  const res = await request<{plans: Plan[]}>(
    `/api/plans${qs({sellerId: opts?.sellerId, buyerId: opts?.buyerId})}`,
  );
  return res.plans;
}

export async function getPlan(id: string): Promise<Plan | null> {
  const res = await requestNullable<{plan: Plan | null}>(`/api/plans/${encodeURIComponent(id)}`);
  return res?.plan ?? null;
}

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
  const res = await request<{plan: Plan}>('/api/plans', {method: 'POST', body: JSON.stringify(input)});
  return res.plan;
}

export async function scheduleForPlan(planId: string): Promise<ScheduleItem[]> {
  const res = await request<{schedule: ScheduleItem[]}>(
    `/api/plans/${encodeURIComponent(planId)}/schedule`,
  );
  return res.schedule;
}

/** Derived numbers for a plan (next due, penalty, remaining) — server-side. */
export async function planWithDerived(plan: Plan): Promise<{
  plan: Plan;
  nextDue: ScheduleItem | null;
  remaining: number;
  penalty: number;
  paidCount: number;
  status: PlanStatus;
}> {
  const res = await request<{derived: {
    plan: Plan;
    nextDue: ScheduleItem | null;
    remaining: number;
    penalty: number;
    paidCount: number;
    status: PlanStatus;
  } | null}>(`/api/plans/${encodeURIComponent(plan.id)}/derived`);
  if (!res.derived) {
    throw new Error('Plan not found.');
  }
  return res.derived;
}

/* -------------------------------- payments -------------------------------- */

export async function paymentsForPlan(planId: string): Promise<Payment[]> {
  const res = await request<{payments: Payment[]}>(
    `/api/plans/${encodeURIComponent(planId)}/payments`,
  );
  return res.payments;
}

export async function paymentsForBuyer(buyerId: string): Promise<Payment[]> {
  const res = await request<{payments: Payment[]}>(`/api/payments${qs({buyerId})}`);
  return res.payments;
}

export async function paymentsForSeller(sellerId: string): Promise<Payment[]> {
  const res = await request<{payments: Payment[]}>(`/api/payments${qs({sellerId})}`);
  return res.payments;
}

export async function listAllPayments(): Promise<Payment[]> {
  const res = await request<{payments: Payment[]}>('/api/payments');
  return res.payments;
}

export async function getPayment(id: string): Promise<Payment | null> {
  const res = await requestNullable<{payment: Payment | null}>(`/api/payments/${encodeURIComponent(id)}`);
  return res?.payment ?? null;
}

export async function recordPayment(input: {
  planId: string;
  amount: number;
  method: string;
  date: string;
  notes: string;
  recordedBy: string;
}): Promise<Payment> {
  const res = await request<{payment: Payment}>(
    `/api/plans/${encodeURIComponent(input.planId)}/payments`,
    {method: 'POST', body: JSON.stringify(input)},
  );
  return res.payment;
}

export async function settlePlan(planId: string, recordedBy: string): Promise<Payment> {
  const res = await request<{payment: Payment}>(
    `/api/plans/${encodeURIComponent(planId)}/settle`,
    {method: 'POST', body: JSON.stringify({recordedBy})},
  );
  return res.payment;
}

/* ------------------------------- adjustments ------------------------------ */

export async function listAdjustments(opts?: {
  buyerId?: string;
  status?: Adjustment['status'];
}): Promise<Adjustment[]> {
  const res = await request<{adjustments: Adjustment[]}>(
    `/api/adjustments${qs({buyerId: opts?.buyerId, status: opts?.status})}`,
  );
  return res.adjustments;
}

export async function listPendingAdjustmentsForSeller(sellerId: string): Promise<Adjustment[]> {
  const res = await request<{adjustments: Adjustment[]}>(
    `/api/adjustments/pending${qs({sellerId})}`,
  );
  return res.adjustments;
}

export async function insertAdjustment(adjustment: Adjustment): Promise<void> {
  await request<{adjustment: Adjustment}>('/api/adjustments', {
    method: 'POST',
    body: JSON.stringify(adjustment),
  });
}

export async function resolveAdjustment(
  adjustmentId: string,
  approve: boolean,
  resolverId: string,
  note: string,
): Promise<void> {
  await request<{ok: boolean}>(`/api/adjustments/${encodeURIComponent(adjustmentId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({approve, resolverId, note}),
  });
}

/* ----------------------------- notifications ------------------------------ */

export async function insertNotification(input: {
  userId: string;
  type: NotificationItem['type'];
  title: string;
  body: string;
}): Promise<void> {
  await request<{notification: NotificationItem}>('/api/notifications', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function notificationsForUser(userId: string, limit = 30): Promise<NotificationItem[]> {
  const res = await request<{notifications: NotificationItem[]}>(
    `/api/notifications${qs({userId, limit})}`,
  );
  return res.notifications;
}

export async function unreadNotificationCount(userId: string): Promise<number> {
  const res = await request<{count: number}>(`/api/notifications/unread${qs({userId})}`);
  return res.count;
}

/* -------------------------------- messages -------------------------------- */

export async function insertMessage(message: Message): Promise<void> {
  await request<{message: Message}>('/api/messages', {method: 'POST', body: JSON.stringify(message)});
}

export async function messagesForPlan(planId: string): Promise<Message[]> {
  const res = await request<{messages: Message[]}>(`/api/messages${qs({planId})}`);
  return res.messages;
}

/* ---------------------------------- audit --------------------------------- */

export async function addAudit(userId: string, action: string, detail: string): Promise<void> {
  await request<{ok: boolean}>('/api/audit', {method: 'POST', body: JSON.stringify({userId, action, detail})});
}

export async function listAudit(limit = 100): Promise<{id: string; userId: string; action: string; detail: string; createdAt: string}[]> {
  const res = await request<{audit: {id: string; userId: string; action: string; detail: string; createdAt: string}[]}>(
    `/api/audit${qs({limit})}`,
  );
  return res.audit;
}

/* -------------------------------- settings -------------------------------- */

export async function getSettings(): Promise<AppSettings> {
  const res = await request<{settings: AppSettings}>('/api/settings');
  return res.settings;
}
