/**
 * Buyer-side PayPal checkout.
 *
 * The app never calculates or sends an amount. It asks the server for a
 * quote, creates an order server-side, opens the PayPal approval page in the
 * phone's browser, then captures the same order when the buyer comes back
 * (deep link or app foreground). Capture is idempotent on the server, so
 * tapping "check payment" twice cannot charge or record twice.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, AppState, Linking, StyleSheet, Text, View} from 'react-native';
import {
  capturePaypalOrder,
  createPaypalOrder,
  paypalQuote,
  type PaypalOrder,
  type PaypalPaymentType,
  type PaypalQuoteResponse,
} from '../db/dataAccess';
import type {Payment} from '../types';
import {radius, spacing, typography, useTheme, useThemedStyles, type Palette} from '../theme';
import {Button, DetailRow, Divider, Sheet, toast} from './ui';
import {formatMoney, formatMoneyCode} from '../utils/money';

type Step =
  | 'review'
  | 'confirm'
  | 'waiting'
  | 'success'
  | 'pending'
  | 'failed'
  | 'cancelled';

const TYPES: Array<{value: PaypalPaymentType; label: string}> = [
  {value: 'monthly', label: 'Monthly fee'},
  {value: 'advance', label: 'Advance (2 months)'},
  {value: 'settle', label: 'Settle early'},
];

export function PayPalSheet({
  visible,
  onClose,
  planId,
  planNo,
  remaining,
  onPaid,
  onViewReceipt,
}: {
  visible: boolean;
  onClose: () => void;
  planId: string;
  planNo: string;
  remaining: number;
  onPaid: () => void;
  onViewReceipt?: (paymentId: string) => void;
}) {
  const styles = useThemedStyles(createStyles);
  const {colors} = useTheme();
  const [type, setType] = useState<PaypalPaymentType>('monthly');
  const [data, setData] = useState<PaypalQuoteResponse | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteBusy, setQuoteBusy] = useState(false);
  const [step, setStep] = useState<Step>('review');
  const [order, setOrder] = useState<PaypalOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Payment | null>(null);

  const stepRef = useRef<Step>('review');
  const orderRef = useRef<PaypalOrder | null>(null);
  const openedAt = useRef(0);
  const captureLock = useRef(false);
  // Set when PayPal sends the buyer back on the cancel URL. AppState fires
  // right after the deep link, and without this guard it would immediately
  // try to capture the cancelled order and overwrite the cancel screen.
  const cancelledRef = useRef(false);

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const loadQuote = useCallback(
    async (nextType: PaypalPaymentType) => {
      setQuoteBusy(true);
      setQuoteError(null);
      try {
        setData(await paypalQuote(planId, nextType));
      } catch (err) {
        setQuoteError(
          err instanceof Error ? err.message : 'Could not work out the amount right now.',
        );
      } finally {
        setQuoteBusy(false);
      }
    },
    [planId],
  );

  // Start fresh every time the sheet opens, and load the monthly quote.
  useEffect(() => {
    if (!visible) {
      return;
    }
    setType('monthly');
    setStep('review');
    setOrder(null);
    orderRef.current = null;
    setReceipt(null);
    setError(null);
    setData(null);
    cancelledRef.current = false;
    void loadQuote('monthly');
  }, [visible, loadQuote]);

  const changeType = (next: PaypalPaymentType) => {
    if (next === type) {
      return;
    }
    setType(next);
    setData(null);
    setError(null);
    void loadQuote(next);
  };

  const capture = useCallback(async () => {
    const current = orderRef.current;
    if (!current || captureLock.current) {
      return;
    }
    captureLock.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await capturePaypalOrder(current.orderId);
      if (res.status === 'completed') {
        setReceipt(res.payment);
        setStep('success');
        toast(res.alreadyCaptured ? 'Payment was already recorded' : 'PayPal payment received');
        onPaid();
      } else {
        setStep('pending');
        setError(res.message);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not confirm the payment.';
      // A 409 "not approved yet" just means the buyer is still in PayPal.
      if (/not approved|not confirmed|approve/i.test(msg)) {
        setStep('waiting');
        setError('PayPal has not confirmed yet. Finish approving, then check again.');
      } else {
        setStep('failed');
        setError(msg);
      }
    } finally {
      captureLock.current = false;
      setBusy(false);
    }
  }, [onPaid]);

  // PayPal sends the buyer back on hulogtrack://paypal/return. AppState also
  // fires when they switch back manually, so both paths try the same capture.
  useEffect(() => {
    if (!visible) {
      return;
    }
    const sub = Linking.addEventListener('url', ({url}) => {
      if (!url.toLowerCase().includes('paypal')) {
        return;
      }
      if (url.toLowerCase().includes('cancel')) {
        cancelledRef.current = true;
        stepRef.current = 'cancelled';
        setStep('cancelled');
        setError(null);
        return;
      }
      if (orderRef.current) {
        cancelledRef.current = false;
        stepRef.current = 'waiting';
        setStep('waiting');
        void capture();
      }
    });
    const app = AppState.addEventListener('change', state => {
      if (
        state === 'active' &&
        orderRef.current &&
        !cancelledRef.current &&
        stepRef.current === 'waiting' &&
        Date.now() - openedAt.current > 1200
      ) {
        void capture();
      }
    });
    return () => {
      sub.remove();
      app.remove();
    };
  }, [visible, capture]);

  const openApproval = async (which: PaypalOrder) => {
    openedAt.current = Date.now();
    cancelledRef.current = false;
    setStep('waiting');
    try {
      const canOpen = await Linking.canOpenURL(which.approvalUrl);
      if (!canOpen) {
        throw new Error('This device cannot open the PayPal checkout page.');
      }
      await Linking.openURL(which.approvalUrl);
    } catch (err) {
      setStep('failed');
      setError(err instanceof Error ? err.message : 'Could not open PayPal.');
    }
  };

  const startOrder = async () => {
    if (busy || !data?.quote.available) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createPaypalOrder(planId, type);
      setOrder(created);
      orderRef.current = created;
      await openApproval(created);
    } catch (err) {
      setStep('failed');
      setError(err instanceof Error ? err.message : 'Could not start the PayPal payment.');
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    if (!orderRef.current || busy) {
      return;
    }
    setBusy(true);
    setError(null);
    await openApproval(orderRef.current);
    setBusy(false);
  };

  const startOver = () => {
    cancelledRef.current = false;
    setOrder(null);
    orderRef.current = null;
    setStep('review');
    setError(null);
    setReceipt(null);
    void loadQuote(type);
  };

  const quote = data?.quote;
  const amountText = quote ? formatMoneyCode(quote.amount, quote.currency) : '';
  const outstanding = Math.max(0, remaining);

  return (
    <Sheet visible={visible} onClose={busy ? () => undefined : onClose} title="Pay with PayPal">
      {outstanding <= 0 && step !== 'success' ? (
        <View style={styles.noticeGood}>
          <Text style={styles.noticeTitle}>This plan is paid in full</Text>
          <Text style={styles.noticeText}>There is no remaining balance to pay.</Text>
          <Button label="Close" variant="secondary" onPress={onClose} />
        </View>
      ) : step === 'success' && receipt ? (
        <View style={styles.stack}>
          <View style={styles.noticeGood}>
            <Text style={styles.bigIcon}>✓</Text>
            <Text style={styles.noticeTitle}>Payment complete</Text>
            <Text style={styles.noticeText}>
              {formatMoneyCode(receipt.amount + receipt.penalty, quote?.currency ?? 'PHP')} was paid
              through PayPal and added to this plan.
            </Text>
          </View>
          <View style={styles.card}>
            <DetailRow label="Receipt no." value={receipt.receiptNo} strong />
            <Divider />
            <DetailRow label="Method" value="PayPal" />
            <DetailRow
              label="Amount"
              value={formatMoneyCode(receipt.amount, quote?.currency ?? 'PHP')}
            />
            {receipt.penalty > 0 ? (
              <DetailRow
                label="Late penalty"
                value={formatMoneyCode(receipt.penalty, quote?.currency ?? 'PHP')}
                tone="bad"
              />
            ) : null}
            <DetailRow label="Plan" value={planNo} />
          </View>
          {onViewReceipt ? (
            <Button
              label="View receipt"
              icon="tab.receipts"
              onPress={() => {
                onClose();
                onViewReceipt(receipt.id);
              }}
            />
          ) : null}
          <Button label="Done" variant="secondary" onPress={onClose} />
        </View>
      ) : step === 'waiting' ? (
        <View style={styles.stack}>
          <View style={styles.noticeWarn}>
            <ActivityIndicator color={colors.warn} />
            <Text style={styles.noticeTitle}>Approve the payment in PayPal</Text>
            <Text style={styles.noticeText}>
              We opened PayPal in your browser. After you approve, come back here — we check the
              same order, so you cannot be charged twice.
            </Text>
          </View>
          <View style={styles.card}>
            <DetailRow label="Paying" value={quote?.label ?? 'PayPal payment'} />
            <DetailRow label="Plan" value={planNo} />
            <Divider />
            <DetailRow label="Amount" value={amountText} strong />
          </View>
          {error ? <Text style={styles.warnText}>{error}</Text> : null}
          <Button
            label="I've approved — check payment"
            icon="check"
            onPress={() => void capture()}
            loading={busy}
          />
          <Button label="Open PayPal again" variant="secondary" onPress={() => void reopen()} disabled={busy} />
          <Button
            label="Close — nothing is charged"
            variant="ghost"
            onPress={onClose}
            disabled={busy}
          />
        </View>
      ) : step === 'pending' ? (
        <View style={styles.stack}>
          <View style={styles.noticeWarn}>
            <Text style={styles.bigIcon}>⏳</Text>
            <Text style={styles.noticeTitle}>PayPal is still processing</Text>
            <Text style={styles.noticeText}>{error ?? 'This can take a few minutes.'}</Text>
          </View>
          <Button label="Check again" onPress={() => void capture()} loading={busy} />
          <Button label="Close" variant="secondary" onPress={onClose} disabled={busy} />
        </View>
      ) : step === 'failed' || step === 'cancelled' ? (
        <View style={styles.stack}>
          <View style={step === 'cancelled' ? styles.noticeWarn : styles.noticeBad}>
            <Text style={styles.bigIcon}>{step === 'cancelled' ? '↩' : '!'}</Text>
            <Text style={styles.noticeTitle}>
              {step === 'cancelled' ? 'Payment cancelled' : 'Payment did not go through'}
            </Text>
            <Text style={styles.noticeText}>
              {step === 'cancelled'
                ? 'Nothing was charged. You can start again whenever you are ready.'
                : error ?? 'PayPal could not finish this payment.'}
            </Text>
          </View>
          {order ? (
            <>
              <Button label="Check payment again" icon="check" onPress={() => void capture()} loading={busy} />
              <Button label="Open PayPal again" variant="secondary" onPress={() => void reopen()} disabled={busy} />
            </>
          ) : null}
          {step === 'cancelled' ? (
            <Button label="Start again" variant="secondary" onPress={startOver} disabled={busy} />
          ) : !order ? (
            <Button
              label="Back to payment options"
              variant="secondary"
              onPress={startOver}
              disabled={busy}
            />
          ) : null}
          <Button label="Close" variant="ghost" onPress={onClose} disabled={busy} />
        </View>
      ) : (
        <View style={styles.stack}>
          <View style={styles.card}>
            <DetailRow label="Plan" value={planNo} />
            <DetailRow label="Remaining balance" value={formatMoney(outstanding)} strong />
          </View>

          {step === 'review' ? (
            <>
              <View>
                <Text style={styles.fieldLabel}>What are you paying?</Text>
                <View style={styles.typeRow}>
                  {TYPES.map(t => {
                    const active = t.value === type;
                    return (
                      <Button
                        key={t.value}
                        label={t.label}
                        small
                        variant={active ? 'primary' : 'secondary'}
                        onPress={() => changeType(t.value)}
                        style={styles.typeChip}
                      />
                    );
                  })}
                </View>
              </View>

              {quoteBusy ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.loadingText}>Working out the amount…</Text>
                </View>
              ) : quoteError ? (
                <View style={styles.noticeBad}>
                  <Text style={styles.noticeTitle}>Could not load the amount</Text>
                  <Text style={styles.noticeText}>{quoteError}</Text>
                  <Button label="Try again" small variant="secondary" onPress={() => void loadQuote(type)} />
                </View>
              ) : data && !data.enabled ? (
                <View style={styles.noticeWarn}>
                  <Text style={styles.noticeTitle}>PayPal is not set up yet</Text>
                  <Text style={styles.noticeText}>
                    The server needs its PayPal sandbox keys before buyers can pay online. Nothing
                    will be charged until then.
                  </Text>
                </View>
              ) : quote ? (
                <>
                  <View style={styles.amountCard}>
                    <Text style={styles.amountLabel}>{quote.label}</Text>
                    <Text style={styles.amountValue}>
                      {formatMoneyCode(quote.amount, quote.currency)}
                    </Text>
                    <Text style={styles.amountNote}>{quote.note}</Text>
                  </View>
                  <View style={styles.card}>
                    {quote.breakdown.map(row => (
                      <DetailRow
                        key={row.label}
                        label={row.label}
                        value={`${row.tone === 'discount' ? '−' : ''}${formatMoneyCode(
                          row.tone === 'discount' ? Math.abs(row.amount) : row.amount,
                          quote.currency,
                        )}`}
                        tone={
                          row.tone === 'discount'
                            ? 'good'
                            : row.tone === 'penalty'
                              ? 'bad'
                              : 'muted'
                        }
                      />
                    ))}
                    <Divider />
                    <DetailRow
                      label="Total"
                      value={formatMoneyCode(quote.amount, quote.currency)}
                      strong
                    />
                  </View>
                  {!quote.available ? (
                    <View style={styles.noticeWarn}>
                      <Text style={styles.noticeText}>{quote.note}</Text>
                    </View>
                  ) : null}
                  <Button
                    label="Continue to PayPal"
                    icon="card"
                    onPress={() => setStep('confirm')}
                    disabled={!data.enabled || !quote.available || quoteBusy}
                  />
                  <Text style={styles.footnote}>
                    The amount is calculated by HulogTrack from this plan. You will approve it on
                    PayPal.
                  </Text>
                </>
              ) : null}
            </>
          ) : (
            <>
              <View style={styles.amountCard}>
                <Text style={styles.amountLabel}>You are about to pay</Text>
                <Text style={styles.amountValue}>{amountText}</Text>
                <Text style={styles.amountNote}>{quote?.label}</Text>
              </View>
              <View style={styles.card}>
                <DetailRow label="Plan" value={planNo} />
                <DetailRow label="Payment type" value={quote?.label ?? 'PayPal'} />
                <Divider />
                <DetailRow label="Amount" value={amountText} strong />
              </View>
              <Text style={styles.footnote}>
                PayPal opens in your browser. No money moves until you approve there. Cancelling
                costs nothing.
              </Text>
              <Button
                label={`Pay ${amountText} with PayPal`}
                icon="card"
                onPress={() => void startOrder()}
                loading={busy}
              />
              <Button label="Go back" variant="ghost" onPress={() => setStep('review')} disabled={busy} />
            </>
          )}
        </View>
      )}
    </Sheet>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    stack: {gap: spacing.md},
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      borderTopColor: c.shine,
      padding: spacing.lg,
      gap: spacing.xs,
    },
    fieldLabel: {
      ...typography.label,
      color: c.textMuted,
      marginBottom: spacing.sm,
    },
    typeRow: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
    typeChip: {flexGrow: 1},
    amountCard: {
      backgroundColor: c.primarySoft,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.primaryBorder,
      borderTopColor: c.shine,
      padding: spacing.lg,
      alignItems: 'center',
    },
    amountLabel: {...typography.label, color: c.textMuted},
    amountValue: {...typography.priceLarge, color: c.text, marginTop: spacing.xs},
    amountNote: {
      ...typography.caption,
      color: c.textMuted,
      textAlign: 'center',
      marginTop: spacing.xs,
    },
    loadingRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg},
    loadingText: {...typography.body, color: c.textMuted},
    noticeWarn: {
      backgroundColor: c.warnSoft,
      borderWidth: 1,
      borderColor: c.warn,
      borderRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    noticeGood: {
      backgroundColor: c.successSoft,
      borderWidth: 1,
      borderColor: c.success,
      borderRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    noticeBad: {
      backgroundColor: c.dangerSoft,
      borderWidth: 1,
      borderColor: c.danger,
      borderRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.sm,
    },
    noticeTitle: {...typography.heading, color: c.text},
    noticeText: {...typography.body, color: c.textMuted},
    bigIcon: {...typography.display, color: c.text, textAlign: 'center'},
    warnText: {...typography.label, color: c.warn},
    footnote: {...typography.caption, color: c.textFaint, textAlign: 'center'},
  });
