import React, {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useAppStore} from '../store/AppStore';
import {usePlans} from '../hooks/usePlans';
import {colors, spacing, typography} from '../theme';
import {Button, EmptyState, ListRow, Screen, Section, Stat} from '../components/ui';
import {formatMoney} from '../utils/money';
import {formatDate, monthKey, today, daysBetween} from '../utils/date';

export function SellerHomeScreen() {
  const {user, plans, payments, adjustments, push, setTab} = useAppStore();
  const myPlans = useMemo(
    () => plans.filter(p => p.sellerId === user?.id),
    [plans, user?.id],
  );
  const summaries = usePlans(myPlans);

  const overdue = summaries.filter(s => s.status === 'overdue');
  const active = summaries.filter(s => s.status === 'active');
  const outstanding = summaries
    .filter(s => s.status === 'active' || s.status === 'overdue')
    .reduce((a, s) => a + s.remaining, 0);
  const thisMonth = monthKey(today());
  const collectedThisMonth = payments
    .filter(p => monthKey(p.date) === thisMonth)
    .reduce((a, p) => a + p.amount, 0);
  const pendingRequests = adjustments.filter(a => a.status === 'pending');
  const recentPayments = payments.slice(0, 5);

  return (
    <Screen scroll>
      {/* Greeting + quick actions */}
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Good day, {user?.name.split(' ')[0]} 👋</Text>
        <Text style={styles.heroSub}>
          {active.length} active plans · {overdue.length} need attention
        </Text>
        <View style={styles.heroActions}>
          <Button
            label="New plan"
            icon="➕"
            onPress={() => push('new-plan')}
            small
          />
          <Button
            label="Plans"
            icon="📋"
            variant="secondary"
            onPress={() => setTab('plans')}
            small
          />
        </View>
      </View>

      {/* KPIs */}
      <View style={styles.statRow}>
        <Stat label="Outstanding" value={formatMoney(outstanding)} sub="across all plans" />
        <Stat
          label="Collected this month"
          value={formatMoney(collectedThisMonth)}
          sub={`${payments.length} payments total`}
          tone="good"
        />
      </View>
      <View style={styles.statRow}>
        <Stat
          label="Overdue"
          value={String(overdue.length)}
          sub="follow up now"
          tone={overdue.length ? 'bad' : 'good'}
        />
        <Stat
          label="Pending requests"
          value={String(pendingRequests.length)}
          sub="adjustments to review"
          tone={pendingRequests.length ? 'bad' : 'default'}
        />
      </View>

      {/* Overdue follow-ups */}
      {overdue.length > 0 ? (
        <>
          <Section title="Overdue follow-ups" action="View plans" onAction={() => setTab('plans')} />
          {overdue.slice(0, 3).map(s => {
            const daysLate = s.nextDue ? Math.max(0, daysBetween(s.nextDue.dueDate, today())) : 0;
            return (
              <ListRow
                key={s.plan.id}
                emoji={s.plan.productEmoji}
                title={`${s.plan.planNo} · ${s.plan.productName}`}
                subtitle={`Due ${formatDate(s.nextDue?.dueDate ?? '')} · ₱${s.nextDue?.amount.toLocaleString()} · ${daysLate}d late · penalty ${formatMoney(s.penalty)}`}
                tone="overdue"
                onPress={() => push('plan-detail', {planId: s.plan.id})}
              />
            );
          })}
        </>
      ) : null}

      {/* Pending adjustment requests */}
      {pendingRequests.length > 0 ? (
        <>
          <Section title="Adjustment requests" />
          {pendingRequests.slice(0, 3).map(a => (
            <ListRow
              key={a.id}
              emoji="🔄"
              title={`${a.type} request`}
              subtitle={a.reason}
              tone="pending"
            />
          ))}
        </>
      ) : null}

      {/* Recent payments */}
      <Section title="Recent payments" />
      {recentPayments.length === 0 ? (
        <EmptyState emoji="🧾" title="No payments yet" subtitle="Record your first installment." />
      ) : (
        recentPayments.map(p => (
          <ListRow
            key={p.id}
            emoji="✅"
            title={p.receiptNo}
            subtitle={`${formatDate(p.date)} · ${p.method}${p.penalty ? ` · penalty ${formatMoney(p.penalty)}` : ''}`}
            right={
              <View style={styles.amountWrap}>
                <Text style={styles.amount}>{formatMoney(p.amount)}</Text>
              </View>
            }
          />
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {gap: spacing.sm, marginBottom: spacing.md},
  heroTitle: {...typography.title, color: colors.text},
  heroSub: {...typography.body, color: colors.textMuted},
  heroActions: {flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm},
  statRow: {flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md},
  amountWrap: {alignItems: 'flex-end'},
  amount: {...typography.price, color: colors.success},
});
