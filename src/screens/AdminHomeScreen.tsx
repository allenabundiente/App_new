import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useAppStore} from '../store/AppStore';
import {radius, spacing, typography, useThemedStyles, type Palette} from '../theme';
import {Button, EmptyState, ListRow, Screen, Section, Stat} from '../components/ui';
import {formatMoney} from '../utils/money';
import {formatDateTime} from '../utils/date';

export function AdminHomeScreen() {
  const {users, plans, payments, audit, verifyUser, setTab, user} = useAppStore();
  const styles = useThemedStyles(createStyles);

  // Manager admins oversee one seller's shop — every number below is already
  // scoped by the store, so the banner just makes the scope visible.
  const scopedSellerId = user?.role === 'admin' ? (user.assignedSellerId ?? null) : null;
  const scopedSellerName = scopedSellerId
    ? (users.find(u => u.id === scopedSellerId)?.name ?? 'assigned seller')
    : null;

  const pendingUsers = users.filter(u => u.status === 'pending');
  const outstanding = plans
    .filter(p => p.status === 'active' || p.status === 'overdue')
    .reduce((a, p) => a + p.financed, 0);
  const totalCollected = payments.reduce((a, p) => a + p.amount, 0);
  const buyers = users.filter(u => u.role === 'buyer').length;
  const sellers = users.filter(u => u.role === 'seller').length;

  const recentAudit = audit.slice(0, 6);

  return (
    <Screen scroll>
      {scopedSellerName ? (
        <View style={styles.scopeCard}>
          <Text style={styles.scopeLabel}>MANAGING SHOP</Text>
          <Text style={styles.scopeName}>{scopedSellerName}</Text>
          <Text style={styles.scopeSub}>
            You only see this seller's plans, payments and activity.
          </Text>
        </View>
      ) : null}
      <View style={styles.statRow}>
        <Stat
          label={scopedSellerName ? 'Shop accounts' : 'Active users'}
          value={String(users.length)}
          sub={`${sellers} seller${sellers === 1 ? '' : 's'} · ${buyers} buyer${buyers === 1 ? '' : 's'}`}
        />
        <Stat
          label={scopedSellerName ? 'Pending in shop' : 'Pending verification'}
          value={String(pendingUsers.length)}
          sub="new accounts to review"
          tone={pendingUsers.length ? 'bad' : 'good'}
        />
      </View>
      <View style={styles.statRow}>
        <Stat label="Outstanding exposure" value={formatMoney(outstanding)} sub="financed balance" tone="brand" />
        <Stat label="All-time collections" value={formatMoney(totalCollected)} sub={`${payments.length} payments`} tone="good" />
      </View>

      {/* Verification queue */}
      <Section
        title="Verification queue"
        action={pendingUsers.length ? 'Review all' : undefined}
        onAction={() => setTab('users')}
      />
      {pendingUsers.length === 0 ? (
        <EmptyState
          icon="check"
          label="C"
          title="No pending accounts"
          subtitle="New registrations land here for review."
        />
      ) : (
        pendingUsers.slice(0, 3).map(u => (
          <View key={u.id} style={styles.verifyCard}>
            <View style={styles.verifyInfo}>
              <Text style={styles.verifyName}>{u.name}</Text>
              <Text style={styles.verifyMeta}>
                {u.email} · {u.role} · joined {u.joinedAt}
              </Text>
            </View>
            <View style={styles.verifyActions}>
              <Button label="Verify" variant="success" small onPress={() => verifyUser(u.id, true)} />
              <Button label="Suspend" variant="danger" small onPress={() => verifyUser(u.id, false)} />
            </View>
          </View>
        ))
      )}

      {/* Recent activity */}
      <Section title="Recent activity" />
      {recentAudit.length === 0 ? (
        <EmptyState icon="tab.reports" label="R" title="No activity yet" />
      ) : (
        recentAudit.map(a => (
          <ListRow
            key={a.id}
            icon={a.action.includes('payment') ? 'money' : a.action.includes('plan') ? 'tab.plans' : 'tab.users'}
            title={a.action}
            subtitle={a.detail}
            right={<Text style={styles.auditTime}>{formatDateTime(a.createdAt)}</Text>}
          />
        ))
      )}
    </Screen>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    statRow: {flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md},
    verifyCard: {
      backgroundColor: c.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.md,
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    verifyInfo: {gap: 2},
    verifyName: {...typography.heading, color: c.text},
    verifyMeta: {...typography.caption, color: c.textMuted},
    verifyActions: {flexDirection: 'row', gap: spacing.sm},
    auditTime: {...typography.caption, color: c.textFaint},
    scopeCard: {
      backgroundColor: c.primarySoft,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.primaryBorder,
      padding: spacing.md,
      gap: 2,
      marginBottom: spacing.md,
    },
    scopeLabel: {...typography.caption, color: c.textMuted, letterSpacing: 1},
    scopeName: {...typography.heading, color: c.text},
    scopeSub: {...typography.caption, color: c.textMuted},
  });
