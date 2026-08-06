import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useAppStore} from '../store/AppStore';
import {usePlans} from '../hooks/usePlans';
import {colors, spacing, typography} from '../theme';
import {Button, ChipSelect, EmptyState, ListRow, Screen} from '../components/ui';
import {formatMoney} from '../utils/money';
import {formatDate} from '../utils/date';

const FILTERS = [
  {value: 'all', label: 'All'},
  {value: 'active', label: 'Active'},
  {value: 'overdue', label: 'Overdue'},
  {value: 'completed', label: 'Done'},
];

export function SellerPlansScreen() {
  const {user, plans, customers, push} = useAppStore();
  const [filter, setFilter] = useState('all');
  const myPlans = useMemo(
    () => plans.filter(p => p.sellerId === user?.id),
    [plans, user?.id],
  );
  const summaries = usePlans(myPlans);

  const buyerName = (buyerId: string) =>
    customers.find(c => c.userId === buyerId)?.name ?? 'Customer';

  const filtered = summaries.filter(s =>
    filter === 'all' ? true : s.status === filter,
  );

  const activeCount = summaries.filter(s => s.status === 'active').length;
  const overdueCount = summaries.filter(s => s.status === 'overdue').length;
  const doneCount = summaries.filter(s => s.status === 'completed').length;

  return (
    <Screen>
      <View style={styles.top}>
        <ChipSelect options={FILTERS} value={filter} onChange={setFilter} />
        <Button
          label="New plan"
          icon="➕"
          small
          onPress={() => push('new-plan')}
          style={styles.newBtn}
        />
      </View>
      <View style={styles.counts}>
        <Text style={styles.count}>{activeCount} active</Text>
        <Text style={[styles.count, {color: colors.danger}]}>
          {overdueCount} overdue
        </Text>
        <Text style={styles.count}>{doneCount} completed</Text>
      </View>

      {filtered.length === 0 ? (
        <EmptyState
          emoji="📋"
          title="No plans here"
          subtitle="Create a new installment plan for a customer."
        />
      ) : (
        filtered.map(s => (
          <ListRow
            key={s.plan.id}
            emoji={s.plan.productEmoji}
            title={`${s.plan.planNo} · ${s.plan.productName}`}
            subtitle={`${buyerName(s.plan.buyerId)} · ${s.plan.term}-mo term`}
            tone={s.status}
            onPress={() => push('plan-detail', {planId: s.plan.id})}
            right={
              <View style={styles.rowRight}>
                <Text style={styles.rowAmount}>{formatMoney(s.remaining)}</Text>
                <Text style={styles.rowDue}>
                  {s.nextDue ? `due ${formatDate(s.nextDue.dueDate)}` : 'paid in full'}
                </Text>
              </View>
            }
          />
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  top: {flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.xs},
  newBtn: {marginTop: spacing.md},
  counts: {flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.md},
  count: {...typography.caption, color: colors.textMuted},
  rowRight: {alignItems: 'flex-end', gap: 2},
  rowAmount: {...typography.price, color: colors.text},
  rowDue: {...typography.caption, color: colors.textFaint},
});
