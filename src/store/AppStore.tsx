/**
 * AppStore — global state for HulogTrack.
 *
 * Mirrors SnackYard's pattern: the store owns the session, holds DB-backed
 * collections in memory for fast renders, and every mutation goes through
 * the repository (the ONLY layer that touches SQLite), then calls refresh().
 *
 * Navigation is intentionally tiny: a tab index + a push/pop stack of named
 * routes. No router library — for a two-portal app a state stack is simpler
 * to teach and to test.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
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
import {
  getBackendMode,
  getUser,
  initDatabase,
  insertNotification,
  listAdjustments,
  listAllPayments,
  listAudit,
  listCustomers,
  listPendingAdjustmentsForSeller,
  listPlans,
  listProducts,
  listUsers,
  logOut,
  notificationsForUser,
  paymentsForBuyer,
  paymentsForSeller,
  setBackendMode,
  signIn,
  signUp,
  unreadNotificationCount,
  updateUserStatus,
} from '../db/dataAccess';
import {ApiAuthError} from '../api/client';
import {session} from '../storage/kv';

export type LoginResult = { ok: true } | { ok: false; reason: string };

export type Route = { name: string; params?: Record<string, unknown> };

interface AppStoreValue {
  ready: boolean;
  bootError: string | null;      // Session
      user: User | null;
      login: (email: string, password: string) => Promise<LoginResult>;
      register: (input: {
        name: string;
        email: string;
        password: string;
        phone: string;
        role: 'buyer' | 'seller';
      }) => Promise<LoginResult>;
      logout: () => void;
      backendMode: 'local' | 'cloud';
      setBackendMode: (mode: 'local' | 'cloud') => void;
  isAdmin: boolean;
  isSeller: boolean;
  isBuyer: boolean;

  // Data (role-scoped; refresh() reloads after any mutation)
  users: User[];
  customers: Customer[];
  products: Product[];
  plans: Plan[];
  payments: Payment[];
  adjustments: Adjustment[];
  notifications: NotificationItem[];
  audit: AuditEntry[];
  unread: number;
  /** Increments after every refresh — screens use it as a useEffect dep. */
  tick: number;
  refresh: () => Promise<void>;
  notify: (userId: string, title: string, body: string) => Promise<void>;

  // Navigation
  tab: string;
  setTab: (tab: string) => void;
  stack: Route[];
  push: (name: string, params?: Record<string, unknown>) => void;
  pop: () => void;
  resetStack: () => void;
  top: Route | null;

  // Admin helpers
  verifyUser: (id: string, approve: boolean) => Promise<void>;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [userId, setUserId] = useState<string | null>(session.getUserId());

  const [users, setUsers] = useState<User[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [unread, setUnread] = useState(0);
  const [tick, setTick] = useState(0);

  const [tab, setTab] = useState('home');
  const [stack, setStack] = useState<Route[]>([]);
  const [backendMode, setBackendModeState] = useState<'local' | 'cloud'>(
    getBackendMode(),
  );

  const changeBackendMode = useCallback((mode: 'local' | 'cloud') => {
    setBackendMode(mode);
    setBackendModeState(mode);
    setUser(null);
    setUserId(null);
    session.setUserId(null);
    setStack([]);
  }, []);

  /**
   * Reload every collection relevant to the signed-in role.
   * Accepts an explicit user because right after login the `user` state has
   * not re-rendered yet — passing it avoids a stale-closure miss.
   */
  const refresh = useCallback(async (forUser?: User | null) => {
    const current = forUser ?? user ?? null;
    const [plansAll, usersAll, auditAll] = await Promise.all([
      listPlans(),
      listUsers(),
      listAudit(120),
    ]);
    setPlans(plansAll);
    setUsers(usersAll);
    setAudit(auditAll);

    if (current) {
      if (current.role === 'seller') {
        const [custs, prods, pmts, adjs, notifs, unreadN] = await Promise.all([
          listCustomers(current.id),
          listProducts(current.id),
          paymentsForSeller(current.id),
          listPendingAdjustmentsForSeller(current.id),
          notificationsForUser(current.id),
          unreadNotificationCount(current.id),
        ]);
        setCustomers(custs);
        setProducts(prods);
        setPayments(pmts);
        setAdjustments(adjs);
        setNotifications(notifs);
        setUnread(unreadN);
      } else if (current.role === 'buyer') {
        const [pmts, adjs, notifs, unreadN] = await Promise.all([
          paymentsForBuyer(current.id),
          listAdjustments({ buyerId: current.id }),
          notificationsForUser(current.id),
          unreadNotificationCount(current.id),
        ]);
        setCustomers([]);
        setProducts([]);
        setPayments(pmts);
        setAdjustments(adjs);
        setNotifications(notifs);
        setUnread(unreadN);
      } else {
        const [adjs, allPayments, notifs, unreadN] = await Promise.all([
          listAdjustments({ status: 'pending' }),
          listAllPayments(),
          notificationsForUser(current.id),
          unreadNotificationCount(current.id),
        ]);
        setCustomers([]);
        setProducts([]);
        setPayments(allPayments);
        setAdjustments(adjs);
        setNotifications(notifs);
        setUnread(unreadN);
      }
    }
    setTick(t => t + 1);
  }, [user]);

  // Boot: init the active backend (SQLite schema+seed, or cloud), restore
  // session, hydrate.
  useEffect(() => {
    (async () => {
      try {
        await initDatabase();
        if (userId) {
          const saved = await getUser(userId);
          setUser(saved);
          await refresh(saved);
        } else {
          await refresh(null);
        }
        setReady(true);
      } catch (err) {
        if (err instanceof ApiAuthError) {
          // Expired/revoked cloud token at boot → land on the login screen
          // instead of a dead-end error screen.
          session.setUserId(null);
          setUserId(null);
          setUser(null);
        } else {
          setBootError(err instanceof Error ? err.message : String(err));
        }
        setReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const res = await signIn(email, password);
      if (!res.ok) {
        return { ok: false, reason: res.reason };
      }
      setUser(res.user);
      setUserId(res.user.id);
      session.setUserId(res.user.id);
      session.setLastEmail(email);
      await refresh(res.user);
      return { ok: true };
    },
    [refresh],
  );

  const register = useCallback(
    async (input: {
      name: string;
      email: string;
      password: string;
      phone: string;
      role: 'buyer' | 'seller';
    }): Promise<LoginResult> => {
      // Registration always reports ok:false with a notice — new accounts
      // must be verified by an admin before the first sign-in.
      return signUp(input);
    },
    [],
  );

  const logout = useCallback(() => {
    void logOut(); // cloud: invalidate the server session; local: no-op
    setUser(null);
    setUserId(null);
    session.setUserId(null);
    setStack([]);
    setTab('home');
  }, []);

  const verifyUser = useCallback(
    async (id: string, approve: boolean) => {
      const target = users.find(u => u.id === id);
      await updateUserStatus(id, approve ? 'active' : 'suspended');
      if (user) {
        await insertNotification({
          userId: id,
          type: approve ? 'success' : 'warn',
          title: approve ? 'Account verified' : 'Account suspended',
          body: `Your account (${target?.name ?? id}) was ${approve ? 'verified by' : 'reviewed by'} an admin.`,
        });
      }
      await refresh();
    },
    [refresh, user, users],
  );

  const notify = useCallback(
    async (userId: string, title: string, body: string) => {
      await insertNotification({ userId, type: 'info', title, body });
      await refresh();
    },
    [refresh],
  );

  const push = useCallback((name: string, params?: Record<string, unknown>) => {
    setStack(prev => [...prev, { name, params }]);
  }, []);

  const pop = useCallback(() => {
    setStack(prev => prev.slice(0, -1));
  }, []);

  const resetStack = useCallback(() => {
    setStack([]);
  }, []);

  const top = stack.length ? stack[stack.length - 1] : null;

  const value = useMemo<AppStoreValue>(
    () => ({
      ready,
      bootError,
      user,
      login,
      register,
      logout,
      backendMode,
      setBackendMode: changeBackendMode,
      isAdmin: user?.role === 'admin',
      isSeller: user?.role === 'seller',
      isBuyer: user?.role === 'buyer',
      users,
      customers,
      products,
      plans,
      payments,
      adjustments,
      notifications,
      audit,
      unread,
      tick,
      refresh,
      notify,
      tab,
      setTab,
      stack,
      push,
      pop,
      resetStack,
      top,
      verifyUser,
    }),
    [
      ready,
      bootError,
      user,
      login,
      register,
      logout,
      backendMode,
      changeBackendMode,
      users,
      customers,
      products,
      plans,
      payments,
      adjustments,
      notifications,
      audit,
      unread,
      tick,
      refresh,
      notify,
      tab,
      stack,
      push,
      pop,
      resetStack,
      top,
      verifyUser,
    ],
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore(): AppStoreValue {
  const ctx = useContext(AppStoreContext);
  if (!ctx) {
    throw new Error('useAppStore must be used inside <AppStoreProvider>');
  }
  return ctx;
}
