/**
 * AppShell — what the user sees after login.
 *
 * Layout: a bottom tab bar (role-scoped) plus a push/pop stack for detail
 * screens (plan detail, new plan, receipt). The header is rendered by the
 * shell so every screen gets back-navigation, the notification bell and the
 * light/dark theme toggle for free.
 */
import React, {useEffect, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useAppStore, type Route} from '../store/AppStore';
import {radius, spacing, typography, useTheme, useThemedStyles, type Palette} from '../theme';
import {Avatar, EmptyState, Sheet} from '../components/ui';
import {AssetIcon} from '../components/AssetIcon';
import {formatDateTime} from '../utils/date';
import {kv} from '../storage/kv';

import {SellerHomeScreen} from '../screens/SellerHomeScreen';
import {SellerPlansScreen} from '../screens/SellerPlansScreen';
import {SellerCustomersScreen} from '../screens/SellerCustomersScreen';
import {SellerProductsScreen} from '../screens/SellerProductsScreen';
import {SellerAdjustmentsScreen} from '../screens/SellerAdjustmentsScreen';
import {BuyerHomeScreen} from '../screens/BuyerHomeScreen';
import {BuyerPlansScreen} from '../screens/BuyerPlansScreen';
import {BuyerReceiptsScreen} from '../screens/BuyerReceiptsScreen';
import {AdminHomeScreen} from '../screens/AdminHomeScreen';
import {AdminUsersScreen} from '../screens/AdminUsersScreen';
import {AdminReportsScreen} from '../screens/AdminReportsScreen';
import {PlanDetailScreen} from '../screens/PlanDetailScreen';
import {NewPlanScreen} from '../screens/NewPlanScreen';
import {ReceiptScreen} from '../screens/ReceiptScreen';
import {ProfileScreen} from '../screens/ProfileScreen';

type TabDef = {id: string; label: string; icon: string};

const TABS: Record<'seller' | 'buyer' | 'admin', TabDef[]> = {
  seller: [
    {id: 'home', label: 'Home', icon: 'tab.home'},
    {id: 'plans', label: 'Plans', icon: 'tab.plans'},
    {id: 'products', label: 'Products', icon: 'tab.products'},
    {id: 'customers', label: 'Customers', icon: 'tab.customers'},
    {id: 'adjustments', label: 'Requests', icon: 'tab.requests'},
  ],
  buyer: [
    {id: 'home', label: 'Home', icon: 'tab.home'},
    {id: 'plans', label: 'My Plans', icon: 'tab.plans'},
    {id: 'receipts', label: 'Receipts', icon: 'tab.receipts'},
  ],
  admin: [
    {id: 'home', label: 'Home', icon: 'tab.home'},
    {id: 'users', label: 'Users', icon: 'tab.users'},
    {id: 'reports', label: 'Reports', icon: 'tab.reports'},
  ],
};

const KEY_NAV_HIDDEN = 'ui.navHidden';

const TAB_TITLES: Record<string, string> = {
  home: 'Home',
  plans: 'Installment Plans',
  products: 'Products',
  customers: 'Customers',
  adjustments: 'Adjustment Requests',
  receipts: 'Payment Receipts',
  users: 'User Management',
  reports: 'Reports & Analytics',
};

function TabScreen({tab}: {tab: string}) {
  const {user} = useAppStore();
  if (!user) {
    return null;
  }
  switch (tab) {
    case 'home':
      return user.role === 'seller' ? (
        <SellerHomeScreen />
      ) : user.role === 'buyer' ? (
        <BuyerHomeScreen />
      ) : (
        <AdminHomeScreen />
      );
    case 'plans':
      return user.role === 'seller' ? <SellerPlansScreen /> : <BuyerPlansScreen />;
    case 'products':
      return <SellerProductsScreen />;
    case 'customers':
      return <SellerCustomersScreen />;
    case 'adjustments':
      return <SellerAdjustmentsScreen />;
    case 'receipts':
      return <BuyerReceiptsScreen />;
    case 'users':
      return <AdminUsersScreen />;
    case 'reports':
      return <AdminReportsScreen />;
    default:
      return null;
  }
}

function RouteScreen({route}: {route: Route}) {
  switch (route.name) {
    case 'plan-detail':
      return <PlanDetailScreen planId={String(route.params?.planId ?? '')} />;
    case 'new-plan':
      return <NewPlanScreen />;
    case 'receipt':
      return <ReceiptScreen paymentId={String(route.params?.paymentId ?? '')} />;
    case 'profile':
      return <ProfileScreen />;
    default:
      return null;
  }
}

/** Strip the internal `{planId}|` prefix chat notifications carry. */
function displayBody(body: string): string {
  const sep = body.indexOf('|');
  return sep >= 0 ? body.slice(sep + 1) : body;
}

function notifIcon(type: string): string {
  switch (type) {
    case 'chat':
      return 'chat';
    case 'money':
      return 'money';
    case 'success':
      return 'check';
    case 'warn':
    case 'danger':
      return 'bell';
    default:
      return 'bell';
  }
}

function NotificationsSheet({visible, onClose}: {visible: boolean; onClose: () => void}) {
  const {notifications} = useAppStore();
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <Sheet visible={visible} onClose={onClose} title="Notifications">
      {notifications.length === 0 ? (
        <EmptyState icon="bell" title="Nothing yet" subtitle="Updates will appear here." />
      ) : (
        // Plain map — Sheet already scrolls, and a FlatList nested inside a
        // ScrollView breaks virtualization and logs an RN warning.
        notifications.map(item => (
          <View
            key={item.id}
            style={[styles.notif, item.isRead ? null : {backgroundColor: colors.primarySoft}]}
          >
            <View style={styles.notifRow}>
              <AssetIcon
                name={notifIcon(item.type)}
                size={18}
                plain
                subtle={item.isRead}
                rounded={7}
              />
              <View style={styles.notifInfo}>
                <Text style={styles.notifTitle}>
                  {item.isRead ? null : <Text style={{color: colors.violet}}>● </Text>}
                  {item.title}
                </Text>
                <Text style={styles.notifBody}>{displayBody(item.body)}</Text>
                <Text style={styles.notifTime}>{formatDateTime(item.createdAt)}</Text>
              </View>
            </View>
          </View>
        ))
      )}
    </Sheet>
  );
}

/**
 * Live popup for notifications that arrive while the app is open (chat
 * messages, payments, due reminders). Sits over the content, auto-dismisses.
 */
function IncomingBanner() {
  const {incoming, clearIncoming, markAllRead} = useAppStore();
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);
  const [notifOpen, setNotifOpen] = useState(false);
  const top = incoming[0] ?? null;

  // Auto-dismiss after 6 seconds.
  useEffect(() => {
    if (!top) {
      return;
    }
    const t = setTimeout(clearIncoming, 6000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top?.id]);

  if (!top) {
    return null;
  }
  return (
    <>
      <Pressable style={styles.banner} onPress={clearIncoming} accessibilityLabel="Dismiss notification">
        <AssetIcon name={notifIcon(top.type)} size={20} plain tint={colors.violet} rounded={8} />
        <View style={styles.bannerInfo}>
          <Text style={styles.bannerTitle} numberOfLines={1}>
            {top.title}
          </Text>
          <Text style={styles.bannerBody} numberOfLines={2}>
            {displayBody(top.body)}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            clearIncoming();
            setNotifOpen(true);
            void markAllRead();
          }}
          hitSlop={8}
          style={styles.bannerAction}
          accessibilityLabel="Open notifications"
        >
          <Text style={styles.bannerActionText}>View</Text>
        </Pressable>
      </Pressable>
      <NotificationsSheet visible={notifOpen} onClose={() => setNotifOpen(false)} />
    </>
  );
}

export function AppShell() {
  const {
    user,
    tab,
    setTab,
    push,
    pop,
    top,
    logout,
    unread,
    markAllRead,
    isSeller,
    isBuyer,
    adjustments,
  } = useAppStore();
  const {colors, toggle} = useTheme();
  const styles = useThemedStyles(createStyles);
  const {width} = useWindowDimensions();
  const isTablet = width >= 760;
  const [notifOpen, setNotifOpen] = useState(false);
  // Collapsible navigation: hide the tab bar / rail to reclaim screen space.
  const [navHidden, setNavHidden] = useState(() => kv.getBoolean(KEY_NAV_HIDDEN) ?? false);
  const setNavHiddenPersisted = (hidden: boolean) => {
    kv.set(KEY_NAV_HIDDEN, hidden);
    setNavHidden(hidden);
  };

  const role = isSeller ? 'seller' : isBuyer ? 'buyer' : 'admin';
  const tabs = TABS[role];
  const route = top; // top of the stack (null when showing tabs)
  const title = route ? titleOf(route.name) : TAB_TITLES[tab];

  // Pending adjustment badge for sellers, unread badge for everyone.
  const tabBadge = (id: string) => {
    if (id === 'adjustments' && isSeller) {
      return adjustments.filter(a => a.status === 'pending').length;
    }
    return 0;
  };

  const headerLeft = route ? (
    <Pressable onPress={pop} hitSlop={12} style={styles.headerBtn}>
      <View style={styles.headerBackInner}>
        <AssetIcon name="back" size={18} plain />
        <Text style={styles.headerBackText}>Back</Text>
      </View>
    </Pressable>
  ) : (
    <Pressable
      onPress={() => push('profile')}
      style={styles.headerUser}
      accessibilityLabel="Open profile"
    >
      <Avatar name={user?.name ?? '?'} size={34} />
      <View style={styles.headerUserText}>
        <Text style={styles.headerName} numberOfLines={1}>
          {user?.name}
        </Text>
        <Text style={styles.headerRole} numberOfLines={1}>
          {isSeller ? 'Seller' : isBuyer ? 'Buyer' : 'Administrator'}
        </Text>
      </View>
    </Pressable>
  );

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        {headerLeft}
        {route ? (
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        <View style={styles.headerActions}>
          {!route && (
            <Pressable
              onPress={() => {
                setNotifOpen(true);
                void markAllRead(); // opening the sheet clears the red dot
              }}
              hitSlop={10}
              style={styles.headerBtn}
            >
              <AssetIcon name="bell" size={20} plain subtle />
              {unread > 0 ? (
                <View style={styles.unreadDot}>
                  <Text style={styles.unreadText}>{unread > 9 ? '9+' : unread}</Text>
                </View>
              ) : null}
            </Pressable>
          )}
          <Pressable onPress={toggle} hitSlop={10} style={styles.headerBtn} accessibilityLabel="Toggle light or dark mode">
            <AssetIcon name="theme" size={20} plain subtle />
          </Pressable>
          <Pressable onPress={logout} hitSlop={10} style={styles.headerBtn} accessibilityLabel="Sign out">
            <AssetIcon name="logout" size={20} plain subtle />
          </Pressable>
        </View>
      </View>

      {/* Body */}
      <View style={styles.body}>
        {route ? (
          <RouteScreen route={route} />
        ) : isTablet ? (
          navHidden ? (
            <TabScreen tab={tab} />
          ) : (
            <View style={styles.tabletRow}>
              <View style={styles.rail}>
                {tabs.map(t => (
                  <Pressable
                    key={t.id}
                    onPress={() => setTab(t.id)}
                    style={[styles.railItem, tab === t.id && styles.railItemActive]}
                  >
                    <AssetIcon name={t.icon} size={22} subtle={tab !== t.id} rounded={8} />
                    <Text
                      style={[styles.railLabel, tab === t.id && styles.railLabelActive]}
                      numberOfLines={1}
                    >
                      {t.label}
                    </Text>
                    {tabBadge(t.id) > 0 ? (
                      <View style={styles.railDot}>
                        <Text style={styles.railDotText}>{tabBadge(t.id)}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => setNavHiddenPersisted(true)}
                  style={styles.railCollapse}
                  accessibilityLabel="Hide navigation"
                >
                  <AssetIcon name="chevron-left" size={16} plain subtle />
                  <Text style={styles.railCollapseText}>Hide</Text>
                </Pressable>
              </View>
              <View style={styles.tabContent}>
                <TabScreen tab={tab} />
              </View>
            </View>
          )
        ) : (
          <TabScreen tab={tab} />
        )}
        <IncomingBanner />
      </View>

      {/* Bottom tab bar (phones) — with a grip to collapse it */}
      {!route && !isTablet &&
        (navHidden ? (
          <Pressable
            onPress={() => setNavHiddenPersisted(false)}
            style={styles.navFab}
            accessibilityLabel="Show navigation"
          >
            <AssetIcon name="chevron-up" size={22} plain tint={colors.white} />
          </Pressable>
        ) : (
          <View style={styles.tabBar}>
            <Pressable
              onPress={() => setNavHiddenPersisted(true)}
              style={styles.tabGrip}
              accessibilityLabel="Hide navigation"
            >
              <AssetIcon name="chevron-down" size={14} plain subtle />
            </Pressable>
            {tabs.map(t => {
              const badge = tabBadge(t.id);
              const active = tab === t.id;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setTab(t.id)}
                  style={[styles.tabItem, active && styles.tabItemActive]}
                >
                  <View style={styles.tabIconWrap}>
                    <AssetIcon name={t.icon} size={22} subtle={!active} rounded={8} />
                    {badge > 0 ? (
                      <View style={styles.tabDot}>
                        <Text style={styles.tabDotText}>{badge}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.tabLabel, active && styles.tabLabelActive]} numberOfLines={1}>
                    {t.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}

      {/* Floating expand button when the nav is hidden (tablet: left, where the rail was) */}
      {!route && navHidden && isTablet && (
        <Pressable
          onPress={() => setNavHiddenPersisted(false)}
          style={[styles.navFab, styles.navFabLeft]}
          accessibilityLabel="Show navigation"
        >
          <AssetIcon name="chevron-right" size={22} plain tint={colors.white} />
        </Pressable>
      )}

      <NotificationsSheet visible={notifOpen} onClose={() => setNotifOpen(false)} />
    </SafeAreaView>
  );
}

function titleOf(name: string): string {
  switch (name) {
    case 'plan-detail':
      return 'Plan Detail';
    case 'new-plan':
      return 'New Installment Plan';
    case 'receipt':
      return 'Digital Receipt';
    case 'profile':
      return 'My Profile';
    default:
      return name;
  }
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    root: {flex: 1, backgroundColor: 'transparent'},
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
      backgroundColor: c.glassStrong,
    },
    headerUser: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      flexShrink: 1,
      minWidth: 0,
      marginRight: spacing.sm,
    },
    headerUserText: {flexShrink: 1, minWidth: 0},
    headerName: {...typography.label, color: c.text, fontWeight: '700'},
    headerRole: {...typography.caption, color: c.textMuted},
    headerTitle: {...typography.heading, color: c.text, flex: 1, textAlign: 'center'},
    headerActions: {flexDirection: 'row', gap: spacing.sm},
    headerBtn: {
      minWidth: 40,
      height: 40,
      borderRadius: radius.pill,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      borderTopColor: c.shine,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.sm,
    },
    headerBackInner: {flexDirection: 'row', alignItems: 'center', gap: 4},
    headerBackText: {color: c.text, fontSize: 15, fontWeight: '600'},

    body: {flex: 1, position: 'relative'},
    tabletRow: {flex: 1, flexDirection: 'row'},
    tabContent: {flex: 1},
    rail: {
      width: 110,
      backgroundColor: c.glassStrong,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      borderTopColor: c.shine,
      margin: spacing.md,
      marginRight: 0,
      paddingVertical: spacing.md,
      gap: spacing.xs,
      shadowColor: c.shadow,
      shadowOpacity: 0.16,
      shadowRadius: 18,
      shadowOffset: {width: 0, height: 8},
      elevation: 4,
    },
    railItem: {
      alignItems: 'center',
      paddingVertical: spacing.md,
      gap: 3,
      marginHorizontal: spacing.sm,
      borderRadius: radius.md,
    },
    railItemActive: {backgroundColor: c.primarySoft},
    railLabel: {...typography.caption, color: c.textMuted},
    railLabelActive: {color: c.violet, fontWeight: '700'},
    railDot: {
      position: 'absolute',
      top: 4,
      right: 8,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: c.danger,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 3,
    },
    railDotText: {color: '#fff', fontSize: 9, fontWeight: '800'},

    tabBar: {
      flexDirection: 'row',
      backgroundColor: c.glassStrong,
      borderRadius: radius.xxl,
      borderWidth: 1,
      borderColor: c.border,
      borderTopColor: c.shine,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      paddingBottom: spacing.xs,
      shadowColor: c.shadow,
      shadowOpacity: 0.22,
      shadowRadius: 20,
      shadowOffset: {width: 0, height: 10},
      elevation: 8,
    },
    tabGrip: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      height: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    tabItem: {flex: 1, alignItems: 'center', gap: 2, paddingVertical: spacing.xs, paddingTop: spacing.xl},
    tabItemActive: {},
    tabIconWrap: {position: 'relative'},
    tabLabel: {...typography.caption, color: c.textMuted},
    tabLabelActive: {color: c.violet, fontWeight: '700'},
    tabDot: {
      position: 'absolute',
      top: -4,
      right: -8,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: c.danger,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 3,
    },
    tabDotText: {color: '#fff', fontSize: 9, fontWeight: '800'},

    unreadDot: {
      position: 'absolute',
      top: -2,
      right: -2,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: c.danger,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 3,
    },
    unreadText: {color: '#fff', fontSize: 9, fontWeight: '800'},

    railCollapse: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      marginTop: 'auto',
      paddingVertical: spacing.sm,
      borderRadius: radius.md,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    railCollapseText: {...typography.caption, color: c.textMuted},

    navFab: {
      position: 'absolute',
      right: spacing.lg,
      bottom: spacing.lg,
      width: 54,
      height: 54,
      borderRadius: 27,
      backgroundColor: c.primary,
      borderWidth: 1,
      borderColor: c.primaryBorder,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: c.shadow,
      shadowOpacity: 0.35,
      shadowRadius: 14,
      shadowOffset: {width: 0, height: 6},
      elevation: 8,
    },
    navFabLeft: {left: spacing.lg, right: undefined},

    notif: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      borderTopColor: c.shine,
      padding: spacing.md,
      marginBottom: spacing.sm,
    },
    notifRow: {flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm},
    notifInfo: {flex: 1, minWidth: 0},
    notifTitle: {...typography.label, color: c.text},
    notifBody: {...typography.caption, color: c.textMuted, marginTop: 2},
    notifTime: {...typography.caption, color: c.textFaint, marginTop: spacing.xs},

    banner: {
      position: 'absolute',
      top: spacing.sm,
      left: spacing.lg,
      right: spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: c.glassStrong,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      borderTopColor: c.shine,
      padding: spacing.md,
      shadowColor: c.shadow,
      shadowOpacity: 0.25,
      shadowRadius: 16,
      shadowOffset: {width: 0, height: 8},
      elevation: 10,
      zIndex: 50,
    },
    bannerInfo: {flex: 1, minWidth: 0},
    bannerTitle: {...typography.label, color: c.text, fontWeight: '700'},
    bannerBody: {...typography.caption, color: c.textMuted, marginTop: 1},
    bannerAction: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      backgroundColor: c.primary,
    },
    bannerActionText: {color: '#fff', fontSize: 13, fontWeight: '700'},
  });
