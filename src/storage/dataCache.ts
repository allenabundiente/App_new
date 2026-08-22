/**
 * DataCache — MMKV-backed cache for store collections.
 *
 * On boot the app hydrates from this cache instantly (sub-millisecond MMKV
 * reads) so the user sees their last-known data immediately while the real
 * DB query runs in the background. After every `refresh()` the cache is
 * updated so the next cold start is always fresh.
 *
 * All values are JSON-serialised arrays/objects. Keys are namespaced with
 * `cache.` to avoid collisions with other MMKV usage.
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
    // MMKV value too large or serialisation error — silently skip.
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

  /** Wipe every cached collection (called on logout). */
  clearAll(): void {
    for (const k of [
      'users', 'plans', 'payments', 'customers', 'products',
      'adjustments', 'notifications', 'audit', 'unread',
    ]) {
      remove(k);
    }
  },
};
