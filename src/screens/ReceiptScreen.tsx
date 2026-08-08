import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {radius, spacing, typography, useTheme, useThemedStyles, type Palette} from '../theme';
import {EmptyState, Screen} from '../components/ui';
import {formatMoney} from '../utils/money';
import {formatDate} from '../utils/date';
import {getPayment, getPlan, getSettings} from '../db/dataAccess';
import type {AppSettings, Payment, Plan} from '../types';

export function ReceiptScreen({paymentId}: {paymentId: string}) {
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);
  const [payment, setPayment] = useState<Payment | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    (async () => {
      const p = await getPayment(paymentId);
      if (!p) {
        return;
      }
      const [pl, st] = await Promise.all([getPlan(p.planId), getSettings()]);
      setPayment(p);
      setPlan(pl);
      setSettings(st);
    })();
  }, [paymentId]);

  if (!payment || !plan || !settings) {
    return (
      <Screen>
        <EmptyState icon="tab.receipts" label="R" title="Loading receipt…" />
      </Screen>
    );
  }

  const total = payment.amount + payment.penalty;
  const business = settings.businessName;

  return (
    <Screen scroll style={styles.screen}>
      <View style={styles.receipt}>
        <Text style={styles.storeName}>{business}</Text>
        <Text style={styles.storeMeta}>{settings.businessAddr}</Text>
        <Text style={styles.storeMeta}>
          {settings.businessPhone} · TIN {settings.taxId}
        </Text>

        <View style={styles.divider} />

        <Text style={styles.receiptTitle}>OFFICIAL RECEIPT</Text>
        <Text style={styles.receiptNo}>{payment.receiptNo}</Text>
        <Text style={styles.receiptMeta}>Issued {formatDate(payment.date)}</Text>

        <View style={styles.divider} />

        <Row label="Plan" value={`${plan.planNo} · ${plan.productName}`} />
        <Row label="Payment type" value={payment.type.toUpperCase()} />
        <Row label="Method" value={payment.method} />
        <Row label="Principal" value={formatMoney(payment.amount)} />
        {payment.penalty > 0 ? (
          <Row label="Late penalty" value={formatMoney(payment.penalty)} danger />
        ) : null}
        <View style={styles.divider} />
        <Row label="TOTAL PAID" value={formatMoney(total)} strong />

        <View style={styles.divider} />

        {payment.notes ? <Text style={styles.notes}>“{payment.notes}”</Text> : null}
        <Text style={styles.footer}>Thank you for your payment!</Text>
        <Text style={styles.footerSmall}>
          Keep this receipt for your records. This is a valid digital receipt.
        </Text>

        <View style={styles.stamp}>
          <Text style={styles.stampText}>PAID</Text>
        </View>
      </View>
    </Screen>
  );
}

function Row({
  label,
  value,
  strong,
  danger,
}: {
  label: string;
  value: string;
  strong?: boolean;
  danger?: boolean;
}) {
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, strong && styles.rowStrong]}>{label}</Text>
      <Text
        style={[styles.rowValue, strong && styles.rowStrong, danger && {color: colors.danger}]}
      >
        {value}
      </Text>
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    screen: {alignItems: 'center', paddingTop: spacing.lg},
    receipt: {
      width: '100%',
      maxWidth: 420,
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.borderStrong,
      padding: spacing.xl,
      gap: spacing.xs,
      alignItems: 'center',
    },
    storeName: {...typography.heading, color: c.text},
    storeMeta: {...typography.caption, color: c.textMuted, textAlign: 'center'},
    divider: {
      width: '100%',
      borderBottomWidth: 1,
      borderBottomColor: c.borderStrong,
      marginVertical: spacing.sm,
      borderStyle: 'dashed',
    },
    receiptTitle: {...typography.label, color: c.textMuted, letterSpacing: 2, marginTop: spacing.xs},
    receiptNo: {...typography.title, color: c.text},
    receiptMeta: {...typography.caption, color: c.textFaint},
    row: {
      width: '100%',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: spacing.xs,
    },
    rowLabel: {...typography.label, color: c.textMuted},
    rowValue: {...typography.label, color: c.text},
    rowStrong: {fontWeight: '800', fontSize: 16, color: c.text},
    notes: {...typography.body, color: c.textMuted, fontStyle: 'italic', textAlign: 'center'},
    footer: {...typography.heading, color: c.success, marginTop: spacing.sm},
    footerSmall: {...typography.caption, color: c.textFaint, textAlign: 'center'},
    stamp: {
      marginTop: spacing.md,
      borderWidth: 2,
      borderColor: c.success,
      borderRadius: radius.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xs,
      transform: [{rotate: '-8deg'}],
      opacity: 0.9,
    },
    stampText: {...typography.heading, color: c.success, letterSpacing: 3},
  });
