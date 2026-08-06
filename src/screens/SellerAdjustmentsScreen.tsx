import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useAppStore} from '../store/AppStore';
import {colors, radius, spacing, typography} from '../theme';
import {Badge, Button, EmptyState, Screen, Section} from '../components/ui';
import {formatDateTime} from '../utils/date';
import {resolveAdjustment} from '../db/dataAccess';

const TYPE_LABEL: Record<string, string> = {
  holiday: 'Payment holiday',
  reschedule: 'Reschedule',
  grace: 'Extra grace days',
  early: 'Early settlement',
};

export function SellerAdjustmentsScreen() {
  const {user, adjustments, plans, refresh} = useAppStore();
  const pending = adjustments.filter(a => a.status === 'pending');

  const planOf = (planId: string) => plans.find(p => p.id === planId);

  const decide = async (adjustmentId: string, approve: boolean) => {
    await resolveAdjustment(adjustmentId, approve, user?.id ?? '', '');
    await refresh();
  };

  return (
    <Screen>
      <Section title={`${pending.length} pending request${pending.length === 1 ? '' : 's'}`} />
      {pending.length === 0 ? (
        <EmptyState
          emoji="✅"
          title="All caught up"
          subtitle="Buyer adjustment requests will appear here."
        />
      ) : (
        pending.map(a => {
          const plan = planOf(a.planId);
          return (
            <View key={a.id} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>
                  {TYPE_LABEL[a.type] ?? a.type}
                </Text>
                <Badge label="pending" tone="pending" />
              </View>
              {plan ? (
                <Text style={styles.cardPlan}>
                  {plan.productEmoji} {plan.planNo} · {plan.productName}
                </Text>
              ) : null}
              <Text style={styles.cardReason}>“{a.reason}”</Text>
              <Text style={styles.cardTime}>{formatDateTime(a.createdAt)}</Text>
              <View style={styles.cardActions}>
                <Button
                  label="Approve"
                  variant="success"
                  small
                  onPress={() => decide(a.id, true)}
                  style={styles.actionBtn}
                />
                <Button
                  label="Reject"
                  variant="danger"
                  small
                  onPress={() => decide(a.id, false)}
                  style={styles.actionBtn}
                />
              </View>
            </View>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  cardTop: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  cardTitle: {...typography.heading, color: colors.text},
  cardPlan: {...typography.label, color: colors.violet},
  cardReason: {...typography.body, color: colors.textMuted, fontStyle: 'italic'},
  cardTime: {...typography.caption, color: colors.textFaint},
  cardActions: {flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs},
  actionBtn: {flex: 1},
});
