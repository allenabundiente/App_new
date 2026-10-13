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
import {dataCache} from '../storage/dataCache';

export type LoginResult = { ok: true } | { ok: false; reason: string };

export type Route = { name: string; params?: Record<string, unknown> };

interface AppStoreValue {
  ready: boolean;
  bootError: string | null;
  // Session
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

  // Data. Only the parts the current role is allowed to see.
  users: User[];
  customers: Customer[];
  products: Product[];
  plans: Plan[];
  payments: Payment[];
  adjustments: Adjustment[];
  notifications: NotificationItem[];
  audit: AuditEntry[];
  unread: number;
  /** True while a refresh is running, used for the pull-to-refresh spinner. */
  refreshing: boolean;
  /** New notifications since the last poll. The shell shows these as popups. */
  incoming: NotificationItem[];
  clearIncoming: () => void;
  /** Goes up by one after every refresh. Screens use it in useEffect. */
  tick: number;
  refresh: (forUser?: User | null, fromPull?: boolean) => Promise<void>;
  notify: (userId: string, title: string, body: string) => Promise<void>;
  /** Marks everything as read. Called when the bell sheet is opened. */
  markAllRead: () => Promise<void>;
  /** Saves profile changes and reloads the current user. */
  updateProfile: (
    patch: Partial<Pick<User, 'name' | 'email' | 'phone' | 'qrImage'>>,
  ) => Promise<void>;
  /** Changes the current user's password. Throws if the old one is wrong. */
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
  /** Admin only: change a user's role. */
  setUserRole: (id: string, role: User['role']) => Promise<void>;
  /** Admin only: limit another admin to one seller. Null means all. */
  assignAdmin: (id: string, sellerId: string | null) => Promise<void>;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [userId, setUserId] = useState<string | null>(session.getUserId());
  // Load the cached data first so the screens aren't empty on startup.
  const [users, setUsers] = useState<User[]>(() => dataCache.getUsers() ?? []);
  const [customers, setCustomers] = useState<Customer[]>(() => dataCache.getCustomers() ?? []);
  const [products, setProducts] = useState<Product[]>(() => dataCache.getProducts() ?? []);
  const [plans, setPlans] = useState<Plan[]>(() => dataCache.getPlans() ?? []);
  const [payments, setPayments] = useState<Payment[]>(() => dataCache.getPayments() ?? []);
  const [adjustments, setAdjustments] = useState<Adjustment[]>(() => dataCache.getAdjustments() ?? []);
  const [notifications, setNotifications] = useState<NotificationItem[]>(() => dataCache.getNotifications() ?? []);
  const [incoming, setIncoming] = useState<NotificationItem[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>(() => dataCache.getAudit() ?? []);
  const [unread, setUnread] = useState(() => dataCache.getUnread() ?? 0);
  const [tick, setTick] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // Copies of the notifications we have already seen, so the poll can tell
  // which ones are actually new and should pop up.
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
   * Reloads every list the current role needs.
   * It takes a user on purpose because right after logging in the `user`
   * state hasn't updated yet, so passing it in avoids using the old one.
   * Pass `showSpinner` when this came from pull-to-refresh.
   */
  const refresh = useCallback(async (forUser?: User | null, fromPull = false) => {
    if (fromPull) {
      setRefreshing(true);
    }
    const current = forUser ?? user ?? null;
    // If an admin has an assignedSellerId they only see that seller's shop,
    // so every list here is filtered to match.
    const adminSeller = current?.role === 'admin' ? (current.assignedSellerId ?? null) : null;
    const [plansAll, usersAll, auditAll] = await Promise.all([
      listPlans(adminSeller ? {sellerId: adminSeller} : undefined),
      listUsers(),
      listAudit(120, adminSeller ?? undefined),
    ]);
    setPlans(plansAll);
    // A scoped admin only sees one shop: the seller, the buyers with plans
    // there, and themselves.
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
        dataCache.setCustomers(custs);
        dataCache.setProducts(prods);
        dataCache.setPayments(pmts);
        dataCache.setAdjustments(adjs);
        dataCache.setNotifications(notifs);
        dataCache.setUnread(unreadN);
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
        dataCache.setPayments(pmts);
        dataCache.setAdjustments(adjs);
        dataCache.setNotifications(notifs);
        dataCache.setUnread(unreadN);
      } else if (adminSeller) {
        // Scoped admin: only that seller's shop.
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
        dataCache.setCustomers(custs);
        dataCache.setProducts(prods);
        dataCache.setPayments(pmts);
        dataCache.setAdjustments(adjs);
        dataCache.setNotifications(notifs);
        dataCache.setUnread(unreadN);
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
        dataCache.setPayments(allPayments);
        dataCache.setAdjustments(adjs);
        dataCache.setNotifications(notifs);
        dataCache.setUnread(unreadN);
      }
    }
    // Save to the MMKV cache so the next launch starts instantly.
    dataCache.setUsers(usersAll);
    dataCache.setPlans(plansAll);
    dataCache.setAudit(auditAll);
    if (fromPull) {
      setRefreshing(false);
    }
    setTick(t => t + 1);
  }, [user]);

  // Startup: open whichever backend is active, restore the session, then
  // load the cached data.
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
          // The saved cloud token is no longer valid, so just go to the
          // login screen instead of showing an error.
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
    // Signing up always comes back with ok:false and a message, because
    // an admin has to verify the account before the first login.
      return signUp(input);
    },
    [],
  );

  const logout = useCallback(() => {
    void logOut(); // in cloud mode this kills the server session
    setUser(null);
    setUserId(null);
    session.setUserId(null);
    setStack([]);
    setTab('home');
    dataCache.clearAll();
  }, []);

  const verifyUser = useCallback(
    async (id: string, approve: boolean) => {
    // Change the status straight away so the UI feels instant.
      setUsers(prev => prev.map(u => u.id === id ? {...u, status: approve ? 'active' as const : 'suspended' as const} : u));
      try {
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
      } catch {
        // Put it back if the server said no.
        await refresh();
      }
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

  // Poll every so often to keep the bell badge and the notification list
  // fresh, and to pop up new ones (chat messages, payments, due reminders)
  // while the app is open. It doesn't call refresh() because that would
  // reload everything - this only looks at notifications.
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
    // Probably just a quick network hiccup, the next tick will try again.
    }
  }, [user]);

  // First poll shortly after startup or login, then every 20 seconds.
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
      refreshing,
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
      refreshing,
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
