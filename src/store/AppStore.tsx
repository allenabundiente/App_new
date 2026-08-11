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
  useRef,
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
  changePassword as changePasswordFn,
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
  markNotificationsRead,
  notificationsForUser,
  paymentsForBuyer,
  paymentsForSeller,
  setAdminAssignment,
  setBackendMode,
  signIn,
  signUp,
  unreadNotificationCount,
  updateUserProfile,
  updateUserRole,
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
  /** Notifications that arrived since the last poll — the shell pops these. */
  incoming: NotificationItem[];
  clearIncoming: () => void;
  /** Increments after every refresh — screens use it as a useEffect dep. */
  tick: number;
  refresh: () => Promise<void>;
  notify: (userId: string, title: string, body: string) => Promise<void>;
  /** Mark every notification read (called when the bell sheet opens). */
  markAllRead: () => Promise<void>;
  /** Save profile edits and refresh the signed-in user. */
  updateProfile: (
    patch: Partial<Pick<User, 'name' | 'email' | 'phone' | 'qrImage'>>,
  ) => Promise<void>;
  /** Change the signed-in user's password (throws on wrong current password). */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;

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
  /** Admin-only: promote/demote a user's role. */
  setUserRole: (id: string, role: User['role']) => Promise<void>;
  /** Admin-only: scope an admin to oversee one seller (null = all). */
  assignAdmin: (id: string, sellerId: string | null) => Promise<void>;
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
  const [incoming, setIncoming] = useState<NotificationItem[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [unread, setUnread] = useState(0);
  const [tick, setTick] = useState(0);
  // Mirror of `notifications` for the poll diff — only items the user has NOT
  // already seen in the sheet are treated as "incoming" popups.
  const notificationsRef = useRef<NotificationItem[]>([]);
  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

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
    // An admin with assignedSellerId only oversees that seller's shop — scope
    // every collection to it (matches the server-side adminScope filter).
    const adminSeller = current?.role === 'admin' ? (current.assignedSellerId ?? null) : null;
    const [plansAll, usersAll, auditAll] = await Promise.all([
      listPlans(adminSeller ? {sellerId: adminSeller} : undefined),
      listUsers(),
      listAudit(120, adminSeller ?? undefined),
    ]);
    setPlans(plansAll);
    // A scoped manager admin only ever sees the assigned seller's shop: the
    // seller, the buyers with plans in that shop, and themselves.
    if (adminSeller && current) {
      const scopedIds = new Set([
        current.id,
        adminSeller,
        ...plansAll.filter(p => p.sellerId === adminSeller).map(p => p.buyerId),
      ]);
      setUsers(usersAll.filter(u => scopedIds.has(u.id)));
    } else {
      setUsers(usersAll);
    }
    setAudit(auditAll);
    setIncoming([]);

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
      } else if (adminSeller) {
        // Scoped admin — only the assigned seller's shop.
        const [custs, prods, pmts, adjs, notifs, unreadN] = await Promise.all([
          listCustomers(adminSeller),
          listProducts(adminSeller),
          paymentsForSeller(adminSeller),
          listPendingAdjustmentsForSeller(adminSeller),
          notificationsForUser(current.id),
          unreadNotificationCount(current.id),
        ]);
        setCustomers(custs);
        setProducts(prods);
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

  const setUserRole = useCallback(
    async (id: string, role: User['role']) => {
      await updateUserRole(id, role);
      await refresh();
    },
    [refresh],
  );

  const assignAdmin = useCallback(
    async (id: string, sellerId: string | null) => {
      await setAdminAssignment(id, sellerId);
      await refresh();
    },
    [refresh],
  );

  const notify = useCallback(
    async (userId: string, title: string, body: string) => {
      await insertNotification({ userId, type: 'info', title, body });
      await refresh();
    },
    [refresh],
  );

  const markAllRead = useCallback(async () => {
    if (!user) {
      return;
    }
    await markNotificationsRead(user.id);
    setNotifications(prev => prev.map(n => ({...n, isRead: true})));
    setUnread(0);
    setIncoming([]);
  }, [user]);

  const clearIncoming = useCallback(() => {
    setIncoming([]);
  }, []);

  // Lightweight poll: keeps the bell badge and notification sheet fresh and
  // surfaces newly-arrived notifications (chat messages, payment received,
  // due reminders) as in-app popups while the app is open. Full refresh() is
  // intentionally avoided — this only touches notifications.
  const pollNotifications = useCallback(async () => {
    if (!user) {
      return;
    }
    try {
      const [list, n] = await Promise.all([
        notificationsForUser(user.id, 30),
        unreadNotificationCount(user.id),
      ]);
      setUnread(n);
      const known = new Set(notificationsRef.current.map(x => x.id));
      const fresh = list.filter(x => !known.has(x.id));
      if (fresh.length) {
        setIncoming(prev => [...fresh, ...prev]);
      }
      setNotifications(list);
    } catch {
      // Transient network blip — the next tick retries.
    }
  }, [user]);

  // Poll shortly after boot/login, then every 20s while signed in.
  useEffect(() => {
    if (!user) {
      return;
    }
    const first = setTimeout(() => {
      void pollNotifications();
    }, 1500);
    const id = setInterval(() => {
      void pollNotifications();
    }, 20000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [user, pollNotifications]);

  const updateProfile = useCallback(
    async (patch: Partial<Pick<User, 'name' | 'email' | 'phone' | 'qrImage'>>) => {
      if (!user) {
        return;
      }
      await updateUserProfile(user.id, patch);
      const fresh = await getUser(user.id);
      if (fresh) {
        setUser(fresh);
      }
      await refresh(fresh ?? user);
    },
    [refresh, user],
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      if (!user) {
        return;
      }
      await changePasswordFn(user.id, currentPassword, newPassword);
    },
    [user],
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
      incoming,
      clearIncoming,
      audit,
      unread,
      tick,
      refresh,
      notify,
      markAllRead,
      updateProfile,
      changePassword,
      tab,
      setTab,
      stack,
      push,
      pop,
      resetStack,
      top,
      verifyUser,
      setUserRole,
      assignAdmin,
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
      incoming,
      clearIncoming,
      audit,
      unread,
      tick,
      refresh,
      notify,
      markAllRead,
      updateProfile,
      changePassword,
      tab,
      stack,
      push,
      pop,
      resetStack,
      top,
      verifyUser,
      setUserRole,
      assignAdmin,
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
