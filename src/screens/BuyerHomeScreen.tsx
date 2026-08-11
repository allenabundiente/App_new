import React, {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useAppStore} from '../store/AppStore';
import {usePlans} from '../hooks/usePlans';
import {spacing, typography, useTheme, useThemedStyles, type Palette} from '../theme';
import {AnimatedIn, Button, Card, EmptyState, GradientCard, ListRow, ProgressRing, Screen, Section, Stat} from '../components/ui';
import {formatMoney} from '../utils/money';
import {productImageFor} from '../utils/productImage';
import {daysBetween, formatDate, today} from '../utils/date';

export function BuyerHomeScreen() {
  const {user, plans, payments, products, push, setTab} = useAppStore();
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);
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
  // Hero ring: how much of the total contract value has been paid.
  const totalContract = myPlans.reduce((a, p) => a + p.price, 0);
  const paidRatio = totalContract > 0 ? Math.min(1, totalPaid / totalContract) : 0;

  // Soonest upcoming due across all active plans.
  const upcoming = active
    .map(s => ({
      s,
      days: s.nextDue ? daysBetween(today(), s.nextDue.dueDate) : Infinity,
      outstanding: s.nextDue ? Math.max(0, s.nextDue.amount - s.nextDue.paidAmount) : 0,
    }))
    .sort((a, b) => a.days - b.days)[0];

  const dueSoon = active
    .filter(s => s.nextDue && daysBetween(today(), s.nextDue.dueDate) <= 5)
    .sort((a, b) => (a.nextDue?.dueDate ?? '').localeCompare(b.nextDue?.dueDate ?? ''));

  return (
    <Screen scroll>
      {/* Hero: gradient glass over the aurora, animated paid-vs-contract ring */}
      <AnimatedIn value="buyer-hero">
        <GradientCard stops={[colors.primarySoft, 'rgba(0,0,0,0)']} style={styles.balanceCard}>
          <View style={styles.balanceMain}>
            <View style={styles.balanceLeft}>
              <Text style={styles.balanceLabel}>Total outstanding balance</Text>
              <Text style={styles.balanceValue}>{formatMoney(outstanding)}</Text>
              <Text style={styles.balanceMeta}>
                {active.length} active · {overdue.length} overdue · {completed.length} completed
              </Text>
            </View>
            <ProgressRing ratio={paidRatio} color={colors.success} size={96} strokeWidth={10}>
              <Text style={styles.ringValue}>{Math.round(paidRatio * 100)}%</Text>
              <Text style={styles.ringLabel}>paid</Text>
            </ProgressRing>
          </View>
          <View style={styles.balanceRow}>
            <Text style={styles.balanceMeta}>
              paid {formatMoney(totalPaid)} of {formatMoney(totalContract)} contract value
            </Text>
          </View>
        </GradientCard>
      </AnimatedIn>

      {/* Next payment CTA */}
      {upcoming ? (
        <Button
          label={`Next payment ${formatMoney(upcoming.outstanding)} — view`}
          icon="calendar"
          onPress={() => push('plan-detail', {planId: upcoming.s.plan.id})}
          style={styles.payCta}
        />
      ) : null}

      <AnimatedIn value="buyer-stats" delay={90}>
        <View style={styles.statRow}>
          <Stat
            label="Next payment"
            value={upcoming ? formatMoney(upcoming.outstanding) : '—'}
            sub={upcoming && upcoming.s.nextDue ? `in ${upcoming.days}d · ${formatDate(upcoming.s.nextDue.dueDate)}` : undefined}
            tone={upcoming && upcoming.days < 0 ? 'bad' : 'default'}
          />
          <Stat label="Plans" value={String(myPlans.length)} sub={`${completed.length} done`} tone="good" />
        </View>
      </AnimatedIn>

      {/* Overdue alert */}
      {overdue.length > 0 ? (
        <Card style={styles.overdueCard}>
          <Text style={styles.overdueTitle}>Overdue — act now</Text>
          {overdue.map(s => (
            <ListRow
              key={s.plan.id}
              icon="product"
              label={s.plan.productName}
              image={productImageFor(products, s.plan)}
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
              icon="calendar"
              label={s.plan.productName}
              image={productImageFor(products, s.plan)}
              title={`${s.plan.planNo} · ${s.plan.productName}`}
              subtitle={`${formatMoney(s.nextDue ? Math.max(0, s.nextDue.amount - s.nextDue.paidAmount) : 0)} due ${formatDate(s.nextDue?.dueDate ?? '')}`}
              right={<Text style={styles.dueSoonText}>soon</Text>}
              onPress={() => push('plan-detail', {planId: s.plan.id})}
            />
          ))}
        </>
      ) : null}

      {/* Recent payments */}
      <Section title="Recent payments" action="All receipts" onAction={() => setTab('receipts')} />
      {payments.length === 0 ? (
        <EmptyState
          icon="tab.receipts"
          label="R"
          title="No payments yet"
          subtitle="Your payment history will appear here."
        />
      ) : (
        payments.slice(0, 4).map(p => (
          <ListRow
            key={p.id}
            icon="money"
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

const createStyles = (c: Palette) =>
  StyleSheet.create({
    balanceCard: {
      borderColor: c.primaryBorder,
      marginBottom: spacing.lg,
    },
    balanceLabel: {...typography.label, color: c.textMuted},
    balanceValue: {...typography.display, color: c.violet},
    balanceMain: {flexDirection: 'row', alignItems: 'center', gap: spacing.lg},
    balanceLeft: {flex: 1, gap: spacing.sm, minWidth: 0},
    ringValue: {...typography.title, color: c.text},
    ringLabel: {...typography.caption, color: c.textMuted},
    balanceRow: {flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm},
    balanceMeta: {...typography.caption, color: c.textMuted},
    payCta: {marginBottom: spacing.lg},
    statRow: {flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg},
    overdueCard: {
      backgroundColor: c.dangerSoft,
      borderColor: 'transparent',
      gap: spacing.sm,
      marginBottom: spacing.md,
    },
    overdueTitle: {...typography.heading, color: c.danger},
    dueSoonText: {...typography.label, color: c.warn},
    paidAmount: {...typography.price, color: c.success},
  });
