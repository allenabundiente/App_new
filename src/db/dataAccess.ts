/**
 * Data access facade — ONE contract, TWO backends.
 *
 *   • 'local' — the on-device SQLite repository (default; fully offline).
 *   • 'cloud' — the HulogTrack API (server/), free-tier hosted Postgres.
 *
 * Every function in this module has the same signature on both backends, so
 * screens never know (or care) where the data lives. Switch modes at runtime
 * from the login screen; the choice is persisted in MMKV.
 */
import {kv} from '../storage/kv';
import * as local from './repository';
import * as cloud from '../api/client';
import {generateId} from '../utils/id';
import {today} from '../utils/date';
import type {
  Adjustment,
  AppSettings,
  Customer,
  Message,
  NotificationItem,
  Payment,
  Plan,
  Product,
  ScheduleItem,
  User,
} from '../types';

export type BackendMode = 'local' | 'cloud';

const KEY_MODE = 'backend.mode';

export function getBackendMode(): BackendMode {
  return kv.getString(KEY_MODE) === 'cloud' ? 'cloud' : 'local';
}

export function setBackendMode(mode: BackendMode): void {
  kv.set(KEY_MODE, mode);
  // A mode switch invalidates any cloud session token.
  if (mode === 'local') {
    cloud.setToken(null);
  }
}

/* ------------------------------ auth (composed) --------------------------- */

export type SignInResult =
  | {ok: true; user: User; token: string | null}
  | {ok: false; reason: string};

export async function signIn(email: string, password: string): Promise<SignInResult> {
  if (getBackendMode() === 'cloud') {
    const res = await cloud.signIn(email, password);
    return res.ok ? {ok: true, user: res.user, token: res.token} : {ok: false, reason: res.reason};
  }
  const found = await local.findUserByEmail(email);
  if (!found || found.password !== password) {
    return {ok: false, reason: 'Incorrect email or password.'};
  }
  if (found.status === 'suspended') {
    return {ok: false, reason: 'This account is suspended. Contact support.'};
  }
  if (found.status === 'pending') {
    return {ok: false, reason: 'Your account is awaiting verification by an admin.'};
  }
  await local.addAudit(found.id, 'auth.login', `${found.name} signed in`);
  return {ok: true, user: found, token: null};
}

export async function signUp(input: {
  name: string;
  email: string;
  password: string;
  phone: string;
  role: 'buyer' | 'seller';
}): Promise<{ok: boolean; reason: string}> {
  if (getBackendMode() === 'cloud') {
    return cloud.signUp(input);
  }
  const exists = await local.findUserByEmail(input.email);
  if (exists) {
    return {ok: false, reason: 'An account with that email already exists.'};
  }
  const newUser: User = {
    id: generateId('u-'),
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    password: input.password,
    phone: input.phone.trim(),
    role: input.role,
    status: 'pending',
    joinedAt: today(),
    qrImage: '',
    assignedSellerId: null,
  };
  await local.insertUser(newUser);
  const admin = (await local.listUsers()).find(u => u.role === 'admin');
  if (admin) {
    await local.insertNotification({
      userId: admin.id,
      type: 'info',
      title: 'New account awaiting verification',
      body: `${newUser.name} registered as a ${input.role}.`,
    });
  }
  return {ok: false, reason: 'Account created! An admin will verify it before you can sign in.'};
}

export async function logOut(): Promise<void> {
  if (getBackendMode() === 'cloud') {
    await cloud.logOutCloud();
  }
}

/* --------------------- pass-throughs (identical contracts) ---------------- */

export const initDatabase = () =>
  getBackendMode() === 'cloud' ? cloud.initDatabase() : local.initDatabase();

export const getUser = (id: string): Promise<User | null> =>
  getBackendMode() === 'cloud' ? cloud.getUser(id) : local.getUser(id);

export const findUserByEmail = (email: string): Promise<User | null> =>
  getBackendMode() === 'cloud' ? cloud.findUserByEmail(email) : local.findUserByEmail(email);

export const listUsers = (): Promise<User[]> =>
  getBackendMode() === 'cloud' ? cloud.listUsers() : local.listUsers();

export const updateUserStatus = (id: string, status: User['status']): Promise<void> =>
  getBackendMode() === 'cloud'
    ? cloud.updateUserStatus(id, status)
    : local.updateUserStatus(id, status);

export const updateUserRole = (id: string, role: User['role']): Promise<void> =>
  getBackendMode() === 'cloud' ? cloud.updateUserRole(id, role) : local.updateUserRole(id, role);

export const setAdminAssignment = (id: string, sellerId: string | null): Promise<void> =>
  getBackendMode() === 'cloud'
    ? cloud.setAdminAssignment(id, sellerId)
    : local.setAdminAssignment(id, sellerId);

export const updateUserProfile = (
  id: string,
  patch: Partial<Pick<User, 'name' | 'email' | 'phone' | 'qrImage'>>,
): Promise<void> =>
  getBackendMode() === 'cloud'
    ? cloud.updateUserProfile(id, patch)
    : local.updateUserProfile(id, patch);

export const changePassword = (
  id: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> =>
  getBackendMode() === 'cloud'
    ? cloud.changePassword(id, currentPassword, newPassword)
    : local.changePassword(id, currentPassword, newPassword);

export const listCustomers = (sellerId: string): Promise<Customer[]> =>
  getBackendMode() === 'cloud' ? cloud.listCustomers(sellerId) : local.listCustomers(sellerId);

export const createCustomerWithUser = (input: {
  sellerId: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}): Promise<Customer> =>
  getBackendMode() === 'cloud'
    ? cloud.createCustomerWithUser(input)
    : local.createCustomerWithUser(input);

export const listProducts = (sellerId: string): Promise<Product[]> =>
  getBackendMode() === 'cloud' ? cloud.listProducts(sellerId) : local.listProducts(sellerId);

export async function createProduct(input: {
  sellerId: string;
  name: string;
  price: number;
  cost: number;
  stock: number;
  emoji?: string;
  image?: string;
}): Promise<Product> {
  if (getBackendMode() === 'cloud') {
    return cloud.createProduct(input);
  }
  const product: Product = {
    id: generateId('p-'),
    sellerId: input.sellerId,
    name: input.name.trim(),
    price: input.price,
    cost: input.cost,
    stock: input.stock,
    emoji: input.emoji ?? '',
    image: input.image ?? '',
  };
  await local.insertProduct(product);
  return product;
}

export const updateProduct = (
  id: string,
  patch: Partial<Pick<Product, 'name' | 'price' | 'cost' | 'stock' | 'emoji' | 'image'>>,
): Promise<void> =>
  getBackendMode() === 'cloud' ? cloud.updateProduct(id, patch) : local.updateProduct(id, patch);

export const deleteProduct = (id: string): Promise<void> =>
  getBackendMode() === 'cloud' ? cloud.deleteProduct(id) : local.deleteProduct(id);

export const listPlans = (opts?: {sellerId?: string; buyerId?: string}): Promise<Plan[]> =>
  getBackendMode() === 'cloud' ? cloud.listPlans(opts) : local.listPlans(opts);

export const getPlan = (id: string): Promise<Plan | null> =>
  getBackendMode() === 'cloud' ? cloud.getPlan(id) : local.getPlan(id);

export const createPlan = (input: {
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
}): Promise<Plan> =>
  getBackendMode() === 'cloud' ? cloud.createPlan(input) : local.createPlan(input);

export const scheduleForPlan = (planId: string): Promise<ScheduleItem[]> =>
  getBackendMode() === 'cloud' ? cloud.scheduleForPlan(planId) : local.scheduleForPlan(planId);

export const planWithDerived = (plan: Plan) =>
  getBackendMode() === 'cloud' ? cloud.planWithDerived(plan) : local.planWithDerived(plan);

export const paymentsForPlan = (planId: string): Promise<Payment[]> =>
  getBackendMode() === 'cloud' ? cloud.paymentsForPlan(planId) : local.paymentsForPlan(planId);

export const paymentsForBuyer = (buyerId: string): Promise<Payment[]> =>
  getBackendMode() === 'cloud' ? cloud.paymentsForBuyer(buyerId) : local.paymentsForBuyer(buyerId);

export const paymentsForSeller = (sellerId: string): Promise<Payment[]> =>
  getBackendMode() === 'cloud' ? cloud.paymentsForSeller(sellerId) : local.paymentsForSeller(sellerId);

export const listAllPayments = (): Promise<Payment[]> =>
  getBackendMode() === 'cloud' ? cloud.listAllPayments() : local.listAllPayments();

export const getPayment = (id: string): Promise<Payment | null> =>
  getBackendMode() === 'cloud' ? cloud.getPayment(id) : local.getPayment(id);

export const recordPayment = (input: {
  planId: string;
  amount: number;
  method: string;
  date: string;
  notes: string;
  recordedBy: string;
}): Promise<Payment> =>
  getBackendMode() === 'cloud' ? cloud.recordPayment(input) : local.recordPayment(input);

export const settlePlan = (
  planId: string,
  recordedBy: string,
  amount?: number,
): Promise<Payment> =>
  getBackendMode() === 'cloud'
    ? cloud.settlePlan(planId, recordedBy, amount)
    : local.settlePlan(planId, recordedBy, amount);

export const listAdjustments = (opts?: {buyerId?: string; status?: Adjustment['status']}): Promise<Adjustment[]> =>
  getBackendMode() === 'cloud' ? cloud.listAdjustments(opts) : local.listAdjustments(opts);

export const listPendingAdjustmentsForSeller = (sellerId: string): Promise<Adjustment[]> =>
  getBackendMode() === 'cloud'
    ? cloud.listPendingAdjustmentsForSeller(sellerId)
    : local.listPendingAdjustmentsForSeller(sellerId);

export const insertAdjustment = (adjustment: Adjustment): Promise<void> =>
  getBackendMode() === 'cloud'
    ? cloud.insertAdjustment(adjustment)
    : local.insertAdjustment(adjustment);

export const resolveAdjustment = (
  adjustmentId: string,
  approve: boolean,
  resolverId: string,
  note: string,
): Promise<void> =>
  getBackendMode() === 'cloud'
    ? cloud.resolveAdjustment(adjustmentId, approve, resolverId, note)
    : local.resolveAdjustment(adjustmentId, approve, resolverId, note);

export const insertNotification = (input: {
  userId: string;
  type: NotificationItem['type'];
  title: string;
  body: string;
}): Promise<void> =>
  getBackendMode() === 'cloud' ? cloud.insertNotification(input) : local.insertNotification(input);

export const notificationsForUser = (userId: string, limit = 30): Promise<NotificationItem[]> =>
  getBackendMode() === 'cloud'
    ? cloud.notificationsForUser(userId, limit)
    : local.notificationsForUser(userId, limit);

export const unreadNotificationCount = (userId: string): Promise<number> =>
  getBackendMode() === 'cloud'
    ? cloud.unreadNotificationCount(userId)
    : local.unreadNotificationCount(userId);

export const markNotificationsRead = (userId: string): Promise<void> =>
  getBackendMode() === 'cloud'
    ? cloud.markNotificationsRead(userId)
    : local.markNotificationsRead(userId);

export const insertMessage = (message: Message): Promise<void> =>
  getBackendMode() === 'cloud' ? cloud.insertMessage(message) : local.insertMessage(message);

export const messagesForPlan = (planId: string): Promise<Message[]> =>
  getBackendMode() === 'cloud' ? cloud.messagesForPlan(planId) : local.messagesForPlan(planId);

export const addAudit = (userId: string, action: string, detail: string): Promise<void> =>
  getBackendMode() === 'cloud' ? cloud.addAudit(userId, action, detail) : local.addAudit(userId, action, detail);

export const listAudit = (limit = 100) =>
  getBackendMode() === 'cloud' ? cloud.listAudit(limit) : local.listAudit(limit);

export const getSettings = (): Promise<AppSettings> =>
  getBackendMode() === 'cloud' ? cloud.getSettings() : local.getSettings();
