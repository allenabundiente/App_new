import React, {useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useAppStore} from '../store/AppStore';
import {usePlans} from '../hooks/usePlans';
import {typography, useTheme, useThemedStyles, type Palette} from '../theme';
import {EmptyState, ListRow, ProgressBar, Screen} from '../components/ui';
import {formatMoney} from '../utils/money';
import {formatDate} from '../utils/date';
import {productImageFor} from '../utils/productImage';

export function BuyerPlansScreen() {
  const {user, plans, products, push} = useAppStore();
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);
  const myPlans = useMemo(
    () => plans.filter(p => p.buyerId === user?.id),
    [plans, user?.id],
  );
  const summaries = usePlans(myPlans);

  if (myPlans.length === 0) {
    return (
      <Screen>
        <EmptyState
          icon="tab.plans"
          label="P"
          title="No installment plans yet"
          subtitle="When a seller creates a plan for you, it shows up here."
        />
      </Screen>
    );
  }

  return (
    <Screen>
      {summaries.map(s => (
        <ListRow
          key={s.plan.id}
          icon="product"
          label={s.plan.productName}
          image={productImageFor(products, s.plan)}
          title={s.plan.productName}
          subtitle={`${s.plan.planNo} · ${formatMoney(s.plan.installment)}/mo · ${s.paidCount}/${s.plan.term} paid`}
          tone={s.status}
          onPress={() => push('plan-detail', {planId: s.plan.id})}
          right={
            <View style={styles.right}>
              <Text style={styles.amount}>{formatMoney(s.remaining)}</Text>
              <Text style={styles.due}>
                {s.nextDue ? `due ${formatDate(s.nextDue.dueDate)}` : 'settled'}
              </Text>
              <ProgressBar
                ratio={s.paidCount / s.plan.term}
                color={s.status === 'completed' ? colors.success : colors.primary}
              />
            </View>
          }
        />
      ))}
    </Screen>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    right: {alignItems: 'flex-end', gap: 3, width: 110},
    amount: {...typography.price, color: c.text},
    due: {...typography.caption, color: c.textFaint},
  });
