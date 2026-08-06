import React, {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useAppStore} from '../store/AppStore';
import {usePlans} from '../hooks/usePlans';
import {colors, spacing, typography} from '../theme';
import {Card, EmptyState, ListRow, Screen, Section, Stat} from '../components/ui';
import {formatMoney} from '../utils/money';
import {daysBetween, formatDate, today} from '../utils/date';

export function BuyerHomeScreen() {
  const {user, plans, payments, push, setTab} = useAppStore();
  const myPlans = useMemo(
    () => plans.filter(p => p.buyerId === user?.id),
    [plans, user?.id],
  );
  const summaries = usePlans(myPlans);

  const active = summaries.filter(s => s.status === 'active');
  const overdue = summaries.filter(s => s.status === 'overdue' || s.status === 'defaulted');
  const completed = summaries.filter(s => s.status === 'completed');

  const outstanding = summaries
    .filter(s => s.status === 'active' || s.status === 'overdue' || s.status === 'defaulted')
    .reduce((a, s) => a + s.remaining, 0);
  const totalPaid = payments.reduce((a, p) => a + p.amount, 0);

  // Soonest upcoming due across all active plans.
  const upcoming = active
    .map(s => ({s, days: s.nextDue ? daysBetween(today(), s.nextDue.dueDate) : Infinity}))
    .sort((a, b) => a.days - b.days)[0];

  const dueSoon = active
    .filter(s => s.nextDue && daysBetween(today(), s.nextDue.dueDate) <= 5)
    .sort((a, b) =>
      (a.nextDue?.dueDate ?? '').localeCompare(b.nextDue?.dueDate ?? ''),
    );

  return (
    <Screen scroll>
      <Card style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Total outstanding balance</Text>
        <Text style={styles.balanceValue}>{formatMoney(outstanding)}</Text>
        <View style={styles.balanceRow}>
          <Text style={styles.balanceMeta}>
            {active.length} active · {overdue.length} overdue · {completed.length} completed
          </Text>
          <Text style={styles.balanceMeta}>paid {formatMoney(totalPaid)}</Text>
        </View>
      </Card>

      <View style={styles.statRow}>
        <Stat label="Next payment" value={upcoming ? formatMoney(upcoming.s.nextDue?.amount ?? 0) : '—'} sub={upcoming && upcoming.s.nextDue ? `in ${upcoming.days}d · ${formatDate(upcoming.s.nextDue.dueDate)}` : undefined} tone={upcoming && upcoming.days < 0 ? 'bad' : 'default'} />
        <Stat
          label="Plans"
          value={String(myPlans.length)}
          sub={`${completed.length} done 🎉`}
          tone="good"
        />
      </View>

      {/* Overdue alert */}
      {overdue.length > 0 ? (
        <Card style={styles.overdueCard}>
          <Text style={styles.overdueTitle}>🚨 Overdue</Text>
          {overdue.map(s => (
            <ListRow
              key={s.plan.id}
              emoji={s.plan.productEmoji}
              title={`${s.plan.planNo} · ${s.plan.productName}`}
              subtitle={`${s.penalty > 0 ? `Penalty ${formatMoney(s.penalty)} · ` : ''}due ${formatDate(s.nextDue?.dueDate ?? '')}`}
              tone="overdue"
              onPress={() => push('plan-detail', {planId: s.plan.id})}
            />
          ))}
        </Card>
      ) : null}

      {/* Due soon */}
      {dueSoon.length > 0 ? (
        <>
          <Section title="Due in the next 5 days" />
          {dueSoon.map(s => (
            <ListRow
              key={s.plan.id}
              emoji="⏰"
              title={`${s.plan.planNo} · ${s.plan.productName}`}
              subtitle={`${formatMoney(s.nextDue?.amount ?? 0)} due ${formatDate(s.nextDue?.dueDate ?? '')}`}
              right={<Text style={styles.dueSoonText}>soon</Text>}
              onPress={() => push('plan-detail', {planId: s.plan.id})}
            />
          ))}
        </>
      ) : null}

      {/* Recent payments */}
      <Section title="Recent payments" action="All receipts" onAction={() => setTab('receipts')} />
      {payments.length === 0 ? (
        <EmptyState emoji="🧾" title="No payments yet" subtitle="Your payment history will appear here." />
      ) : (
        payments.slice(0, 4).map(p => (
          <ListRow
            key={p.id}
            emoji="✅"
            title={p.receiptNo}
            subtitle={`${formatDate(p.date)} · ${p.method}`}
            onPress={() => push('receipt', {paymentId: p.id})}
            right={<Text style={styles.paidAmount}>{formatMoney(p.amount)}</Text>}
          />
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  balanceCard: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primaryBorder,
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  balanceLabel: {...typography.label, color: colors.textMuted},
  balanceValue: {...typography.display, color: colors.violet},
  balanceRow: {flexDirection: 'row', justifyContent: 'space-between'},
  balanceMeta: {...typography.caption, color: colors.textMuted},
  statRow: {flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md},
  overdueCard: {
    backgroundColor: colors.dangerSoft,
    borderColor: 'transparent',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  overdueTitle: {...typography.heading, color: colors.danger},
  dueSoonText: {...typography.label, color: colors.warn},
  paidAmount: {...typography.price, color: colors.success},
});
