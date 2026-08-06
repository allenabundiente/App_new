/**
 * AppShell — what the user sees after login.
 *
 * Layout: a bottom tab bar (role-scoped) plus a push/pop stack for detail
 * screens (plan detail, new plan, receipt). The header is rendered by the
 * shell so every screen gets back-navigation and the notification bell for
 * free.
 */
import React, {useState} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useAppStore, type Route} from '../store/AppStore';
import {colors, radius, spacing, typography} from '../theme';
import {Avatar, EmptyState, Sheet} from '../components/ui';
import {formatDateTime} from '../utils/date';

import {SellerHomeScreen} from '../screens/SellerHomeScreen';
import {SellerPlansScreen} from '../screens/SellerPlansScreen';
import {SellerCustomersScreen} from '../screens/SellerCustomersScreen';
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

type TabDef = {id: string; label: string; emoji: string};

const TABS: Record<'seller' | 'buyer' | 'admin', TabDef[]> = {
  seller: [
    {id: 'home', label: 'Home', emoji: '📊'},
    {id: 'plans', label: 'Plans', emoji: '📋'},
    {id: 'customers', label: 'Customers', emoji: '👥'},
    {id: 'adjustments', label: 'Requests', emoji: '🔄'},
  ],
  buyer: [
    {id: 'home', label: 'Home', emoji: '🏠'},
    {id: 'plans', label: 'My Plans', emoji: '🛍️'},
    {id: 'receipts', label: 'Receipts', emoji: '🧾'},
  ],
  admin: [
    {id: 'home', label: 'Home', emoji: '📊'},
    {id: 'users', label: 'Users', emoji: '👥'},
    {id: 'reports', label: 'Reports', emoji: '📈'},
  ],
};

const TAB_TITLES: Record<string, string> = {
  home: 'Home',
  plans: 'Installment Plans',
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
    default:
      return null;
  }
}

function NotificationsSheet({visible, onClose}: {visible: boolean; onClose: () => void}) {
  const {notifications} = useAppStore();
  return (
    <Sheet visible={visible} onClose={onClose} title="Notifications">
      {notifications.length === 0 ? (
        <EmptyState emoji="🔕" title="Nothing yet" subtitle="Updates will appear here." />
      ) : (
        // Plain map — Sheet already scrolls, and a FlatList nested inside a
        // ScrollView breaks virtualization and logs an RN warning.
        notifications.map(item => (
          <View
            key={item.id}
            style={[
              styles.notif,
              item.isRead ? null : {backgroundColor: colors.primarySoft},
            ]}
          >
            <Text style={styles.notifTitle}>
              {item.isRead ? null : <Text style={{color: colors.violet}}>● </Text>}
              {item.title}
            </Text>
            <Text style={styles.notifBody}>{item.body}</Text>
            <Text style={styles.notifTime}>{formatDateTime(item.createdAt)}</Text>
          </View>
        ))
      )}
    </Sheet>
  );
}

export function AppShell() {
  const {
    user,
    tab,
    setTab,
    pop,
    top,
    logout,
    unread,
    isSeller,
    isBuyer,
    adjustments,
  } = useAppStore();
  const {width} = useWindowDimensions();
  const isTablet = width >= 760;
  const [notifOpen, setNotifOpen] = useState(false);

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
      <Text style={styles.headerBtnText}>‹ Back</Text>
    </Pressable>
  ) : (
    <View style={{flexDirection: 'row', alignItems: 'center', gap: spacing.sm}}>
      <Avatar name={user?.name ?? '?'} size={34} />
      <View>
        <Text style={styles.headerName} numberOfLines={1}>
          {user?.name}
        </Text>
        <Text style={styles.headerRole}>
          {isSeller ? 'Seller' : isBuyer ? 'Buyer' : 'Administrator'}
        </Text>
      </View>
    </View>
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
              onPress={() => setNotifOpen(true)}
              hitSlop={10}
              style={styles.headerBtn}
            >
              <Text style={styles.headerBtnText}>🔔</Text>
              {unread > 0 ? (
                <View style={styles.unreadDot}>
                  <Text style={styles.unreadText}>{unread > 9 ? '9+' : unread}</Text>
                </View>
              ) : null}
            </Pressable>
          )}
          <Pressable onPress={logout} hitSlop={10} style={styles.headerBtn}>
            <Text style={styles.headerBtnText}>⎋</Text>
          </Pressable>
        </View>
      </View>

      {/* Body */}
      <View style={styles.body}>
        {route ? (
          <RouteScreen route={route} />
        ) : isTablet ? (
          <View style={styles.tabletRow}>
            <View style={styles.rail}>
              {tabs.map(t => (
                <Pressable
                  key={t.id}
                  onPress={() => setTab(t.id)}
                  style={[styles.railItem, tab === t.id && styles.railItemActive]}
                >
                  <Text style={styles.railEmoji}>{t.emoji}</Text>
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
            </View>
            <View style={styles.tabContent}>
              <TabScreen tab={tab} />
            </View>
          </View>
        ) : (
          <TabScreen tab={tab} />
        )}
      </View>

      {/* Bottom tab bar (phones) */}
      {!route && !isTablet && (
        <View style={styles.tabBar}>
          {tabs.map(t => {
            const badge = tabBadge(t.id);
            return (
              <Pressable
                key={t.id}
                onPress={() => setTab(t.id)}
                style={[styles.tabItem, tab === t.id && styles.tabItemActive]}
              >
                <View>
                  <Text style={[styles.tabEmoji, tab === t.id && styles.tabEmojiActive]}>
                    {t.emoji}
                  </Text>
                  {badge > 0 ? (
                    <View style={styles.tabDot}>
                      <Text style={styles.tabDotText}>{badge}</Text>
                    </View>
                  ) : null}
                </View>
                <Text
                  style={[styles.tabLabel, tab === t.id && styles.tabLabelActive]}
                  numberOfLines={1}
                >
                  {t.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
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
    default:
      return name;
  }
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: colors.background},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  headerName: {...typography.label, color: colors.text, fontWeight: '700'},
  headerRole: {...typography.caption, color: colors.textMuted},
  headerTitle: {...typography.heading, color: colors.text, flex: 1, textAlign: 'center'},
  headerActions: {flexDirection: 'row', gap: spacing.sm},
  headerBtn: {
    minWidth: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  headerBtnText: {color: colors.text, fontSize: 16, fontWeight: '600'},

  body: {flex: 1},
  tabletRow: {flex: 1, flexDirection: 'row'},
  tabContent: {flex: 1},
  rail: {
    width: 104,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  railItem: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: 3,
    marginHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  railItemActive: {backgroundColor: colors.primarySoft},
  railEmoji: {fontSize: 20},
  railLabel: {...typography.caption, color: colors.textMuted},
  railLabelActive: {color: colors.violet, fontWeight: '700'},
  railDot: {
    position: 'absolute',
    top: 4,
    right: 8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  railDotText: {color: '#fff', fontSize: 9, fontWeight: '800'},

  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: spacing.xs,
    paddingTop: spacing.xs,
  },
  tabItem: {flex: 1, alignItems: 'center', gap: 2, paddingVertical: spacing.xs},
  tabItemActive: {},
  tabEmoji: {fontSize: 20, opacity: 0.55},
  tabEmojiActive: {opacity: 1},
  tabLabel: {...typography.caption, color: colors.textMuted},
  tabLabelActive: {color: colors.violet, fontWeight: '700'},
  tabDot: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.danger,
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
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  unreadText: {color: '#fff', fontSize: 9, fontWeight: '800'},

  notif: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  notifTitle: {...typography.label, color: colors.text},
  notifBody: {...typography.caption, color: colors.textMuted, marginTop: 2},
  notifTime: {...typography.caption, color: colors.textFaint, marginTop: spacing.xs},
});
