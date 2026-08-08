import React, {useMemo} from 'react';
import {StyleSheet, Text} from 'react-native';
import {useAppStore} from '../store/AppStore';
import {typography, useTheme, useThemedStyles, type Palette} from '../theme';
import {EmptyState, ListRow, Screen, Section} from '../components/ui';
import {formatMoney} from '../utils/money';
import {formatDate} from '../utils/date';

export function BuyerReceiptsScreen() {
  const {user, payments, push} = useAppStore();
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);
  const myPayments = useMemo(
    () => payments.filter(p => p.buyerId === user?.id),
    [payments, user?.id],
  );

  return (
    <Screen>
      <Section title={`${myPayments.length} receipts`} />
      {myPayments.length === 0 ? (
        <EmptyState
          icon="tab.receipts"
          label="R"
          title="No receipts yet"
          subtitle="Every payment you make gets a digital receipt here."
        />
      ) : (
        myPayments.map(p => (
          <ListRow
            key={p.id}
            icon="tab.receipts"
            title={p.receiptNo}
            subtitle={`${formatDate(p.date)} · ${p.method} · ${p.type}${p.penalty ? ` · penalty ${formatMoney(p.penalty)}` : ''}`}
            onPress={() => push('receipt', {paymentId: p.id})}
            right={
              <Text style={[styles.amount, p.penalty > 0 && {color: colors.danger}]}>
                {formatMoney(p.amount)}
              </Text>
            }
          />
        ))
      )}
    </Screen>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    amount: {...typography.price, color: c.success},
  });
