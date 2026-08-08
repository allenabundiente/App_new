import React, {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useAppStore} from '../store/AppStore';
import {radius, spacing, typography, useTheme, useThemedStyles, type Palette} from '../theme';
import {Card, EmptyState, ListRow, Screen, Section, Stat} from '../components/ui';
import {formatMoney} from '../utils/money';
import {monthKey} from '../utils/date';

function lastMonths(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

export function AdminReportsScreen() {
  const {payments, plans, users} = useAppStore();
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);

  const months = lastMonths(6);
  const monthly = useMemo(() => {
    return months.map(m => ({
      key: m,
      label: new Date(m + '-01').toLocaleDateString('en-PH', {month: 'short'}),
      total: payments
        .filter(p => monthKey(p.date) === m)
        .reduce((a, p) => a + p.amount, 0),
    }));
  }, [months, payments]);

  const maxMonthly = Math.max(1, ...monthly.map(m => m.total));
  const thisMonth = monthly[monthly.length - 1]?.total ?? 0;
  const prevMonth = monthly[monthly.length - 2]?.total ?? 0;
  const delta = prevMonth > 0 ? ((thisMonth - prevMonth) / prevMonth) * 100 : 0;

  const statusCount = (s: string) => plans.filter(p => p.status === s).length;

  // Top products by collections (join payments → plan).
  const byProduct = useMemo(() => {
    const map = new Map<string, {name: string; total: number}>();
    for (const p of payments) {
      const plan = plans.find(x => x.id === p.planId);
      if (!plan) {
        continue;
      }
      const cur = map.get(plan.productName) ?? {name: plan.productName, total: 0};
      cur.total += p.amount;
      map.set(plan.productName, cur);
    }
    return [...map.values()].sort((a, b) => b.total - a.total).slice(0, 5);
  }, [payments, plans]);

  const sellerNames = (id: string) => users.find(u => u.id === id)?.name ?? 'Unknown';

  return (
    <Screen scroll>
      <View style={styles.statRow}>
        <Stat
          label="Collected this month"
          value={formatMoney(thisMonth)}
          sub={delta >= 0 ? `▲ ${delta.toFixed(1)}% vs last month` : `▼ ${Math.abs(delta).toFixed(1)}% vs last month`}
          tone={delta >= 0 ? 'good' : 'bad'}
        />
        <Stat label="Plans" value={String(plans.length)} sub={`${statusCount('active')} active`} tone="brand" />
      </View>

      <Section title="Collections — last 6 months" />
      <Card style={styles.chartCard}>
        <View style={styles.chart}>
          {monthly.map(m => (
            <View key={m.key} style={styles.barCol}>
              <Text style={styles.barValue}>{m.total > 0 ? formatMoney(m.total).replace(/\.00$/, '') : ''}</Text>
              <View style={[styles.bar, {height: Math.max(4, (m.total / maxMonthly) * 110)}]} />
              <Text style={styles.barLabel}>{m.label}</Text>
            </View>
          ))}
        </View>
      </Card>

      <Section title="Plan status" />
      <View style={styles.statusRow}>
        {[
          {label: 'On track', n: statusCount('active'), color: colors.primary},
          {label: 'Overdue', n: statusCount('overdue'), color: colors.warn},
          {label: 'Defaulted', n: statusCount('defaulted'), color: colors.danger},
          {label: 'Completed', n: statusCount('completed'), color: colors.success},
        ].map(s => (
          <View key={s.label} style={[styles.statusPill, {borderColor: s.color}]}>
            <Text style={[styles.statusNum, {color: s.color}]}>{s.n}</Text>
            <Text style={styles.statusLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      <Section title="Top products by collections" />
      {byProduct.length === 0 ? (
        <EmptyState
          icon="product"
          label="P"
          title="No data yet"
          subtitle="Collections will appear once payments are recorded."
        />
      ) : (
        byProduct.map(p => (
          <ListRow
            key={p.name}
            icon="product"
            label={p.name}
            title={p.name}
            right={<Text style={styles.rev}>{formatMoney(p.total)}</Text>}
          />
        ))
      )}

      <Section title="Sellers" />
      {users
        .filter(u => u.role === 'seller')
        .map(u => {
          const p = plans.filter(x => x.sellerId === u.id);
          const collected = payments
            .filter(x => x.sellerId === u.id)
            .reduce((a, x) => a + x.amount, 0);
          return (
            <ListRow
              key={u.id}
              icon="tab.users"
              label={sellerNames(u.id)}
              title={sellerNames(u.id)}
              subtitle={`${p.length} plans · ${p.filter(x => x.status === 'overdue').length} overdue`}
              right={<Text style={styles.rev}>{formatMoney(collected)}</Text>}
            />
          );
        })}
    </Screen>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    statRow: {flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md},
    chartCard: {paddingVertical: spacing.lg},
    chart: {flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 150},
    barCol: {flex: 1, alignItems: 'center', gap: 4, height: 150, justifyContent: 'flex-end'},
    barValue: {...typography.caption, color: c.textMuted, fontSize: 9},
    bar: {
      width: 22,
      backgroundColor: c.primary,
      borderRadius: radius.sm,
      minHeight: 4,
    },
    barLabel: {...typography.caption, color: c.textMuted},
    statusRow: {flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap'},
    statusPill: {
      flex: 1,
      minWidth: 70,
      borderWidth: 1,
      borderRadius: radius.md,
      padding: spacing.sm,
      alignItems: 'center',
      gap: 2,
      backgroundColor: c.surface,
    },
    statusNum: {...typography.title},
    statusLabel: {...typography.caption, color: c.textMuted},
    rev: {...typography.price, color: c.success},
  });
