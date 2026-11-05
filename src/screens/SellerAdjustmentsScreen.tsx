import React, {useState} from 'react';
import {Alert, StyleSheet, Text, View} from 'react-native';
import {useAppStore} from '../store/AppStore';
import {radius, spacing, typography, useThemedStyles, type Palette} from '../theme';
import {Badge, Button, EmptyState, PlanIcon, Screen, Section, toast} from '../components/ui';
import {formatDateTime} from '../utils/date';
import {resolveAdjustment} from '../db/dataAccess';

const TYPE_LABEL: Record<string, string> = {
  holiday: 'Payment holiday',
  reschedule: 'Reschedule',
  grace: 'Extra grace days',
  early: 'Early settlement',
};

export function SellerAdjustmentsScreen() {
  const {user, adjustments, plans, products, refresh, refreshing} = useAppStore();
  const styles = useThemedStyles(createStyles);
  const pending = adjustments.filter(a => a.status === 'pending');
  const [deciding, setDeciding] = useState<string | null>(null);

  const planOf = (planId: string) => plans.find(p => p.id === planId);

  const decide = async (adjustmentId: string, approve: boolean) => {
    setDeciding(adjustmentId);
    try {
      await resolveAdjustment(adjustmentId, approve, user?.id ?? '', '');
      await refresh();
      toast(approve ? 'Request approved' : 'Request rejected');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update the request.', 'error');
    } finally {
      setDeciding(null);
    }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={() => void refresh(undefined, true)}>
      <Section title={`${pending.length} pending request${pending.length === 1 ? '' : 's'}`} />
      {pending.length === 0 ? (
        <EmptyState
          icon="check"
          label="C"
          title="All caught up"
          subtitle="Buyer adjustment requests will appear here."
        />
      ) : (
        pending.map(a => {
          const plan = planOf(a.planId);
          return (
            <View key={a.id} style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.cardTitle}>{TYPE_LABEL[a.type] ?? a.type}</Text>
                <Badge label="Pending" tone="pending" />
              </View>
              {plan ? (
                <View style={styles.cardPlanRow}>
                  <PlanIcon plan={plan} products={products} size={26} rounded={8} />
                  <Text style={styles.cardPlan}>
                    {plan.planNo} · {plan.productName}
                  </Text>
                </View>
              ) : null}
              <Text style={styles.cardReason}>“{a.reason}”</Text>
              <Text style={styles.cardTime}>{formatDateTime(a.createdAt)}</Text>
              <View style={styles.cardActions}>
                <Button
                  label="Approve"
                  variant="success"
                  small
                  onPress={() => void decide(a.id, true)}
                  loading={deciding === a.id}
                  disabled={deciding !== null}
                  style={styles.actionBtn}
                />
                <Button
                  label="Reject"
                  variant="danger"
                  small
                  onPress={() =>
                    Alert.alert(
                      'Reject this request?',
                      'The buyer will be told the request was rejected.',
                      [
                        {text: 'Keep it', style: 'cancel'},
                        {text: 'Reject', style: 'destructive', onPress: () => void decide(a.id, false)},
                      ],
                    )
                  }
                  disabled={deciding !== null}
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

const createStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.lg,
      marginBottom: spacing.md,
      gap: spacing.sm,
    },
    cardTop: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
    cardTitle: {...typography.heading, color: c.text},
    cardPlanRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
    cardPlan: {...typography.label, color: c.violet, flex: 1},
    cardReason: {...typography.body, color: c.textMuted, fontStyle: 'italic'},
    cardTime: {...typography.caption, color: c.textFaint},
    cardActions: {flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs},
    actionBtn: {flex: 1},
  });
