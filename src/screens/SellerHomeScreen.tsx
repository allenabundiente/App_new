import React, {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useAppStore} from '../store/AppStore';
import {usePlans} from '../hooks/usePlans';
import {spacing, typography, useTheme, useThemedStyles, type Palette} from '../theme';
import {AnimatedIn, Button, EmptyState, GradientCard, ListRow, ProgressRing, Screen, Section, Stat} from '../components/ui';
import {formatMoney} from '../utils/money';
import {productImageFor} from '../utils/productImage';
import {daysBetween, formatDate, monthKey, today} from '../utils/date';

export function SellerHomeScreen() {
  const {user, plans, payments, adjustments, products, push, setTab} = useAppStore();
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);
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
  const totalCollected = payments.reduce((a, p) => a + p.amount, 0);
  // Hero ring: collected-to-date as a share of the live portfolio value.
  const collectedRatio =
    totalCollected + outstanding > 0 ? totalCollected / (totalCollected + outstanding) : 0;

  return (
    <Screen scroll>
      {/* Hero: gradient glass card, greeting + quick actions + collected ring */}
      <AnimatedIn value="seller-hero">
        <GradientCard stops={[colors.infoSoft, 'rgba(0,0,0,0)']} style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View style={styles.heroText}>
              <Text style={styles.heroTitle}>Good day, {user?.name.split(' ')[0]}</Text>
              <Text style={styles.heroSub}>
                {active.length} active plans · {overdue.length} need attention
              </Text>
            </View>
            <ProgressRing ratio={collectedRatio} color={colors.info} size={84} strokeWidth={9}>
              <Text style={styles.ringValue}>{Math.round(collectedRatio * 100)}%</Text>
              <Text style={styles.ringLabel}>collected</Text>
            </ProgressRing>
          </View>
          <View style={styles.heroActions}>
            <Button label="New plan" icon="plus" onPress={() => push('new-plan')} small />
            <Button label="Products" icon="product" variant="secondary" onPress={() => setTab('products')} small />
          </View>
        </GradientCard>
      </AnimatedIn>

      {/* KPIs */}
      <AnimatedIn value="seller-stats" delay={90}>
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
      </AnimatedIn>

      {/* Overdue follow-ups */}
      {overdue.length > 0 ? (
        <>
          <Section title="Overdue follow-ups" action="View plans" onAction={() => setTab('plans')} />
          {overdue.slice(0, 3).map(s => {
            const daysLate = s.nextDue ? Math.max(0, daysBetween(s.nextDue.dueDate, today())) : 0;
            return (
              <ListRow
                key={s.plan.id}
                icon="product"
                label={s.plan.productName}
                image={productImageFor(products, s.plan)}
                title={`${s.plan.planNo} · ${s.plan.productName}`}
                subtitle={`Due ${formatDate(s.nextDue?.dueDate ?? '')} · ${formatMoney(s.nextDue ? Math.max(0, s.nextDue.amount - s.nextDue.paidAmount) : 0)} · ${daysLate}d late · penalty ${formatMoney(s.penalty)}`}
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
              icon="tab.requests"
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
        <EmptyState
          icon="money"
          label="P"
          title="No payments yet"
          subtitle="Record your first installment."
        />
      ) : (
        recentPayments.map(p => (
          <ListRow
            key={p.id}
            icon="money"
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

const createStyles = (c: Palette) =>
  StyleSheet.create({
    heroCard: {
      borderColor: c.borderStrong,
      marginBottom: spacing.lg,
    },
    heroTop: {flexDirection: 'row', alignItems: 'center', gap: spacing.lg},
    heroText: {flex: 1, minWidth: 0, gap: spacing.xs},
    heroTitle: {...typography.title, color: c.text},
    heroSub: {...typography.body, color: c.textMuted},
    ringValue: {...typography.title, color: c.text},
    ringLabel: {...typography.caption, color: c.textMuted},
    heroActions: {flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg},
    statRow: {flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg},
    amountWrap: {alignItems: 'flex-end'},
    amount: {...typography.price, color: c.success},
  });
