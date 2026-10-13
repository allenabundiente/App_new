/**
 * Caches the store's lists in MMKV.
 *
 * When the app starts we show this cached data straight away so the screen
 * isn't empty, then the real database query runs in the background. The
 * cache is written again after every refresh so it is never stale for long.
 *
 * Keys start with `cache.` so they don't clash with anything else.
 */
import {kv} from './kv';
import type {
  Adjustment,
  AuditEntry,
  Customer,
  NotificationItem,
  Payment,
  Plan,
  Product,
  User,
} from '../types';

const PREFIX = 'cache.';

function read<T>(key: string): T | null {
  try {
    const raw = kv.getString(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    kv.set(PREFIX + key, JSON.stringify(value));
  } catch {
    // The value was too big or not valid JSON, so just skip it.
  }
}

function remove(key: string): void {
  kv.remove(PREFIX + key);
}

/* ------- typed accessors ------- */

export const dataCache = {
  getUsers(): User[] | null { return read<User[]>('users'); },
  setUsers(v: User[]) { write('users', v); },

  getPlans(): Plan[] | null { return read<Plan[]>('plans'); },
  setPlans(v: Plan[]) { write('plans', v); },

  getPayments(): Payment[] | null { return read<Payment[]>('payments'); },
  setPayments(v: Payment[]) { write('payments', v); },

  getCustomers(): Customer[] | null { return read<Customer[]>('customers'); },
  setCustomers(v: Customer[]) { write('customers', v); },

  getProducts(): Product[] | null { return read<Product[]>('products'); },
  setProducts(v: Product[]) { write('products', v); },

  getAdjustments(): Adjustment[] | null { return read<Adjustment[]>('adjustments'); },
  setAdjustments(v: Adjustment[]) { write('adjustments', v); },

  getNotifications(): NotificationItem[] | null { return read<NotificationItem[]>('notifications'); },
  setNotifications(v: NotificationItem[]) { write('notifications', v); },

  getAudit(): AuditEntry[] | null { return read<AuditEntry[]>('audit'); },
  setAudit(v: AuditEntry[]) { write('audit', v); },

  getUnread(): number | null {
    const raw = kv.getString(PREFIX + 'unread');
    return raw != null ? Number(raw) : null;
  },
  setUnread(v: number) { write('unread', v); },

  /** Clears every cached list. Called on logout. */
  clearAll(): void {
    for (const k of [
      'users', 'plans', 'payments', 'customers', 'products',
      'adjustments', 'notifications', 'audit', 'unread',
    ]) {
      remove(k);
    }
  },
};
