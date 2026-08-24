import React, {useEffect, useRef, useState} from 'react';
import {Image, KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View} from 'react-native';
import {useAppStore} from '../store/AppStore';
import {usePlanSummary} from '../hooks/usePlans';
import {radius, spacing, typography, useTheme, useThemedStyles, type Palette} from '../theme';
import {
  Badge,
  Button,
  Card,
  ChipSelect,
  EmptyState,
  Field,
  GradientCardLight,
  ListRow,
  PlanIcon,
  ProgressBar,
  Screen,
  Section,
  Sheet,
  toast,
} from '../components/ui';
import {SkeletonPlanDetail, SkeletonChatBubbles} from '../components/Skeleton';
import {formatMoney, parseMoney} from '../utils/money';
import {formatDate, today} from '../utils/date';
import {
  getPlan,
  getSettings,
  insertAdjustment,
  insertMessage,
  markChatNotificationsRead,
  markMessagesRead,
  messagesForPlan,
  paymentsForPlan,
  recordPayment,
  scheduleForPlan,
  settlePlan,
} from '../db/dataAccess';
import {computePenalty, effectiveDueDate} from '../services/penalty';
import {earlySettlementQuote} from '../services/earlySettlement';
import type {AdjustmentType, Message, Payment, Plan, ScheduleItem} from '../types';
import {generateId} from '../utils/id';

const METHODS = ['Cash', 'GCash', 'Bank transfer', 'Card', 'Maya'].map(m => ({
  value: m,
  label: m,
}));

/** E-wallet methods that use a QR code for payment (same as the web preview). */
const QR_METHODS = ['GCash', 'Maya'];

export function PlanDetailScreen({
  planId,
  openChat = false,
}: {
  planId: string;
  /** Open the chat thread right away (used when deep-linking from a notification). */
  openChat?: boolean;
}) {
  const {plans, customers, users, products, user, isSeller, push, refresh, tick} = useAppStore();
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);
  const [plan, setPlan] = useState<Plan | null>(plans.find(p => p.id === planId) ?? null);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(openChat);
  const [qrOpen, setQrOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);

  const summary = usePlanSummary(plan);

  // Re-fetch on tick: after recordPayment/settle/adjustment the store bumps
  // tick, so the schedule and payment list refresh in place (no stale rows).
  useEffect(() => {
    let alive = true;
    (async () => {
      const p = plan ?? (await getPlan(planId));
      if (!p) {
        return;
      }
      const [sch, pmts] = await Promise.all([scheduleForPlan(p.id), paymentsForPlan(p.id)]);
      if (alive) {
        setPlan(p);
        setSchedule(sch);
        setPayments(pmts);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, tick]);

  const loadMessages = async () => {
    if (plan) {
      setMessages(await messagesForPlan(plan.id));
    }
  };

  useEffect(() => {
    if (chatOpen) {
      loadMessages();
      // Opening the chat clears its unread badge: mark the thread read and
      // the chat notifications it generated, then resync the bell.
      if (user && plan) {
        void markMessagesRead(plan.id, user.id);
        void markChatNotificationsRead(plan.id, user.id);
        void refresh();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatOpen, plan?.id]);

  // Show skeleton while plan detail data (schedule + payments) is still loading.
  if (!plan) {
    return (
      <Screen>
        <SkeletonPlanDetail />
      </Screen>
    );
  }
  if (schedule.length === 0 && payments.length === 0) {
    return (
      <Screen>
        <SkeletonPlanDetail />
      </Screen>
    );
  }

  const buyerName = customers.find(c => c.userId === plan.buyerId)?.name ?? 'Buyer';
  const sellerName = users.find(u => u.id === plan.sellerId)?.name ?? 'Seller';
  const sellerQr = users.find(u => u.id === plan.sellerId)?.qrImage ?? '';
  const showQr = !isSeller && sellerQr && user?.role === 'buyer';
  const paidCount = schedule.filter(s => s.status === 'paid').length;
  const nextDue = summary?.nextDue ?? null;
  const penalty = summary?.penalty ?? 0;
  const remaining = summary?.remaining ?? 0;
  const quote = earlySettlementQuote(remaining);
  // What the next installment still owes (partial credits already deducted).
  const nextDueOutstanding = nextDue ? Math.max(0, nextDue.amount - nextDue.paidAmount) : 0;

  return (
    <>
      <Screen scroll>
        {/* Plan header */}
        <GradientCardLight stops={colors.cardGradientBrand} style={styles.heroCard}>
          <View style={styles.heroTop}>
            <PlanIcon plan={plan} products={products} size={48} rounded={14} />
            <View style={styles.heroInfo}>
              <Text style={styles.heroTitle}>{plan.productName}</Text>
              <Text style={styles.heroNo}>
                {plan.planNo} · started {formatDate(plan.startDate)}
              </Text>
            </View>
            <Badge label={summary?.status ?? plan.status} tone={summary?.status ?? plan.status} />
          </View>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{formatMoney(plan.installment)}</Text>
              <Text style={styles.heroStatLabel}>monthly</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{formatMoney(remaining)}</Text>
              <Text style={styles.heroStatLabel}>remaining</Text>
            </View>
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>
                {paidCount}/{plan.term}
              </Text>
              <Text style={styles.heroStatLabel}>paid</Text>
            </View>
          </View>
          <ProgressBar
            ratio={paidCount / plan.term}
            color={summary?.status === 'completed' ? colors.success : colors.primary}
          />
          <View style={styles.heroMeta}>
            <Text style={styles.heroMetaText}>
              Price {formatMoney(plan.price)} · DP {formatMoney(plan.downPayment)} · {plan.apr}% APR ·{' '}
              {plan.term}-month term
            </Text>
            <Text style={styles.heroMetaText}>
              {isSeller ? `Customer: ${buyerName}` : `Seller: ${sellerName}`}
            </Text>
          </View>
        </GradientCardLight>

        {/* Next due + penalty */}
        {nextDue ? (
          <Card style={styles.dueCard}>
            <View style={styles.dueLeft}>
              <Text style={styles.dueLabel}>Next payment · due {formatDate(nextDue.dueDate)}</Text>
              <Text style={styles.dueAmount}>{formatMoney(nextDueOutstanding)}</Text>
              {nextDue.paidAmount > 0 ? (
                <Text style={styles.dueOk}>
                  {formatMoney(nextDue.paidAmount)} already paid toward this installment —{' '}
                  {formatMoney(nextDueOutstanding)} left
                </Text>
              ) : null}
              {penalty > 0 ? (
                <Text style={styles.duePenalty}>
                  Late penalty {formatMoney(penalty)} — pays along with this installment
                </Text>
              ) : (
                <Text style={styles.dueOk}>On track — no penalty.</Text>
              )}
            </View>
          </Card>
        ) : null}

        {/* Actions */}
        {showQr ? (
          <Button
            label="Pay online — scan to pay"
            icon="card"
            onPress={() => setQrOpen(true)}
            style={styles.qrButton}
          />
        ) : null}
        <View style={styles.actions}>
          {isSeller ? (
            <>
              <Button label="Record payment" icon="money" onPress={() => setPayOpen(true)} style={styles.action} />
              <Button
                label="Settle early"
                icon="flag"
                variant="secondary"
                onPress={() => setSettleOpen(true)}
                disabled={remaining <= 0}
                style={styles.action}
              />
            </>
          ) : (
            <Button label="Request adjustment" icon="tab.requests" onPress={() => setAdjustOpen(true)} style={styles.action} />
          )}
          <Button
            label="Chat"
            icon="chat"
            variant="secondary"
            onPress={() => setChatOpen(true)}
            style={styles.action}
          />
        </View>

        {/* Schedule */}
        <Section title={`Payment schedule (${plan.term} installments)`} />
        {schedule.map((s, i) => {
          const outstanding = Math.max(0, s.amount - s.paidAmount);
          const partial = s.status === 'pending' && s.paidAmount > 0;
          return (
            <ListRow
              key={s.id}
              icon={s.status === 'paid' ? 'check' : s.status === 'skipped' ? 'calendar' : 'schedule'}
              title={`Installment ${i + 1} — ${formatDate(s.dueDate)}`}
              subtitle={
                s.status === 'paid'
                  ? `Paid ${s.paidDate ? formatDate(s.paidDate) : ''}${s.note ? ` · ${s.note}` : ''}`
                  : partial
                    ? `${formatMoney(s.paidAmount)} of ${formatMoney(s.amount)} paid — ${formatMoney(outstanding)} left`
                    : s.note || (s.status === 'skipped' ? 'Skipped (payment holiday)' : 'Awaiting payment')
              }
              right={
                <Text style={[styles.scheduleAmount, partial && {color: colors.success}]}>
                  {partial ? formatMoney(outstanding) : formatMoney(s.amount)}
                </Text>
              }
              tone={s.status === 'paid' ? 'paid' : s.status === 'skipped' ? 'pending' : partial ? 'paid' : 'active'}
            />
          );
        })}

        {/* Payment history */}
        <Section title={`Payment history (${payments.length})`} />
        {payments.length === 0 ? (
          <EmptyState
            icon="tab.receipts"
            label="R"
            title="No payments yet"
            subtitle="The first installment payment will appear here."
          />
        ) : (
          payments.map(p => (
            <ListRow
              key={p.id}
              icon={p.type === 'settlement' ? 'flag' : p.type === 'down' ? 'money' : 'check'}
              title={`${p.receiptNo} · ${p.method}`}
              subtitle={`${formatDate(p.date)} · ${p.type}${p.penalty ? ` · penalty ${formatMoney(p.penalty)}` : ''}`}
              onPress={() => push('receipt', {paymentId: p.id})}
              right={<Text style={styles.scheduleAmount}>{formatMoney(p.amount)}</Text>}
            />
          ))
        )}
      </Screen>

      {/* ---- Modals ---- */}
      <RecordPaymentSheet
        visible={payOpen}
        onClose={() => setPayOpen(false)}
        plan={plan}
        nextDue={nextDue}
        sellerQr={sellerQr}
        onDone={() => {
          setPayOpen(false);
          toast('Payment recorded');
          refresh();
        }}
      />
      <SettleSheet
        visible={settleOpen}
        onClose={() => setSettleOpen(false)}
        plan={plan}
        quote={quote}
        onDone={() => {
          setSettleOpen(false);
          toast('Plan settled — receipt issued');
          refresh();
        }}
      />
      <AdjustSheet
        visible={adjustOpen}
        onClose={() => setAdjustOpen(false)}
        plan={plan}
        remaining={remaining}
        onDone={() => {
          setAdjustOpen(false);
          toast('Request sent to your seller');
          refresh();
        }}
      />
      <QrSheet
        visible={qrOpen}
        onClose={() => setQrOpen(false)}
        plan={plan}
        sellerQr={sellerQr}
        sellerName={sellerName}
        nextDue={nextDue}
      />
      <ChatSheet
        visible={chatOpen}
        onClose={() => setChatOpen(false)}
        plan={plan}
        messages={messages}
        onSent={loadMessages}
      />
    </>
  );
}

/* --------------------------- Payment QR modal --------------------------- */

function QrSheet({
  visible,
  onClose,
  plan,
  sellerQr,
  sellerName,
  nextDue,
}: {
  visible: boolean;
  onClose: () => void;
  plan: Plan;
  sellerQr: string;
  sellerName: string;
  nextDue: ScheduleItem | null;
}) {
  const styles = useThemedStyles(createStyles);
  const outstanding = nextDue ? Math.max(0, nextDue.amount - nextDue.paidAmount) : 0;
  return (
    <Sheet visible={visible} onClose={onClose} title="Pay online — scan to pay">
      <View style={styles.qrModal}>
        {/* QR codes need a white backing to scan reliably — white card +
            the app's white QR frame underneath. */}
        <View style={styles.qrFrame}>
          <Image source={{uri: sellerQr}} style={styles.qrModalImg} resizeMode="contain" />
        </View>
        <Text style={styles.qrModalCaption}>
          Open your e-wallet and scan the QR to pay {sellerName} for {plan.planNo}.
        </Text>
        {nextDue ? (
          <Text style={styles.qrAmount}>
            Next due {formatMoney(outstanding)} on {formatDate(nextDue.dueDate)}
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}

/* ------------------------- Record payment sheet ------------------------- */

function RecordPaymentSheet({
  visible,
  onClose,
  plan,
  nextDue,
  sellerQr,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  plan: Plan;
  nextDue: ScheduleItem | null;
  sellerQr: string;
  onDone: () => void;
}) {
  const {user} = useAppStore();
  const styles = useThemedStyles(createStyles);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Cash');
  const [date, setDate] = useState(today());
  const [penalty, setPenalty] = useState(0);
  const [busy, setBusy] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);

  const outstanding = nextDue ? Math.max(0, nextDue.amount - nextDue.paidAmount) : 0;

  useEffect(() => {
    if (visible) {
      setAmount(outstanding ? String(outstanding) : '');
      setDate(today());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, outstanding]);

  // Live penalty preview as the date changes.
  useEffect(() => {
    (async () => {
      if (!nextDue) {
        setPenalty(0);
        return;
      }
      const settings = await getSettings();
      setPenalty(
        computePenalty(outstanding, effectiveDueDate(nextDue.dueDate, plan.graceExtra), date, {
          graceDays: settings.graceDays,
          ratePerMonthPct: settings.penaltyRate,
          capPct: settings.penaltyCap,
        }),
      );
    })();
  }, [date, nextDue, plan.graceExtra, outstanding]);

  const submit = async () => {
    const amt = parseMoney(amount);
    if (amt <= 0) {
      toast('Enter a valid amount.', 'error');
      return;
    }
    setBusy(true);
    try {
      await recordPayment({
        planId: plan.id,
        amount: amt,
        method,
        date,
        notes: '',
        recordedBy: user?.id ?? '',
      });
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not record payment.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Record payment">
      {nextDue ? (
        <Card style={styles.payDueCard}>
          <Text style={styles.payDueLabel}>Paying installment due {formatDate(nextDue.dueDate)}</Text>
          <Text style={styles.payDueAmount}>{formatMoney(outstanding)}</Text>
          {nextDue.paidAmount > 0 ? (
            <Text style={styles.payDueHint}>
              {formatMoney(nextDue.paidAmount)} already paid — this shows the remaining balance.
            </Text>
          ) : null}
        </Card>
      ) : null}
      <Field label="Amount" value={amount} onChangeText={setAmount} keyboardType="numeric" />
      <Text style={styles.advanceHint}>
        Paying more than the monthly installment? The extra automatically covers the next months — e.g. pay 2×
        and it counts as 2 months, with any remainder credited toward the following due.
      </Text>
      <ChipSelect label="Method" value={method} onChange={setMethod} options={METHODS} />
      {QR_METHODS.includes(method) ? (
        sellerQr ? (
          <Button
            label="Show payment QR"
            icon="card"
            variant="secondary"
            onPress={() => setQrOpen(true)}
          />
        ) : (
          <Text style={styles.qrMissing}>
            No payment QR set yet — add one in My Profile so buyers can scan to pay.
          </Text>
        )
      ) : null}
      <Field label="Payment date (YYYY-MM-DD)" value={date} onChangeText={setDate} autoCapitalize="none" />
      {penalty > 0 ? (
        <Text style={styles.penaltyNote}>
          Late fee {formatMoney(penalty)} will be added on top of the amount.
        </Text>
      ) : null}
      <Button label="Save payment" icon="money" onPress={submit} loading={busy} />

      <Sheet visible={qrOpen} onClose={() => setQrOpen(false)} title="Payment QR">
        <View style={styles.qrModal}>
          <Image source={{uri: sellerQr}} style={styles.qrModalImg} resizeMode="contain" />
          <Text style={styles.qrModalCaption}>
            Buyer scans this QR to pay via {method}.
          </Text>
        </View>
      </Sheet>
    </Sheet>
  );
}

/* --------------------------- Settle early sheet -------------------------- */

function SettleSheet({
  visible,
  onClose,
  plan,
  quote,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  plan: Plan;
  quote: {remaining: number; incentive: number; fee: number; total: number};
  onDone: () => void;
}) {
  const {user} = useAppStore();
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);
  const [amount, setAmount] = useState(String(quote.total));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setAmount(String(quote.total));
    }
  }, [visible, quote.total]);

  const submit = async () => {
    const amt = parseMoney(amount);
    if (amt <= 0) {
      toast('Enter a valid settlement amount.', 'error');
      return;
    }
    setBusy(true);
    try {
      await settlePlan(plan.id, user?.id ?? '', amt);
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not settle.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Early settlement">
      <View style={styles.quote}>
        <View style={styles.quoteRow}>
          <Text style={styles.quoteLabel}>Remaining balance</Text>
          <Text style={styles.quoteValue}>{formatMoney(quote.remaining)}</Text>
        </View>
        <View style={styles.quoteRow}>
          <Text style={styles.quoteLabel}>Early-pay incentive (2%)</Text>
          <Text style={[styles.quoteValue, {color: colors.success}]}>−{formatMoney(quote.incentive)}</Text>
        </View>
        <View style={styles.quoteRow}>
          <Text style={styles.quoteLabel}>Processing fee</Text>
          <Text style={styles.quoteValue}>{formatMoney(quote.fee)}</Text>
        </View>
      </View>
      <Field
        label="Settlement amount"
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        hint="Auto-filled from the quote — sellers may adjust it (e.g. waive more interest)."
      />
      <Text style={styles.quoteHint}>
        Settling clears all remaining installments and completes the plan. A receipt is issued automatically.
      </Text>
      <Button label="Confirm settlement" icon="flag" onPress={submit} loading={busy} />
    </Sheet>
  );
}

/* ------------------------ Adjustment request sheet ----------------------- */

const ADJ_TYPES: Array<{value: AdjustmentType; label: string}> = [
  {value: 'holiday', label: 'Skip one payment'},
  {value: 'reschedule', label: 'Extend term'},
  {value: 'grace', label: 'Extra grace days'},
  {value: 'early', label: 'Settle early'},
];

function AdjustSheet({
  visible,
  onClose,
  plan,
  remaining,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  plan: Plan;
  remaining: number;
  onDone: () => void;
}) {
  const {user} = useAppStore();
  const styles = useThemedStyles(createStyles);
  const [type, setType] = useState<AdjustmentType>('holiday');
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('');
  const [months, setMonths] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quote = earlySettlementQuote(remaining);

  useEffect(() => {
    if (visible) {
      setType('holiday');
      setReason('');
      setDays('');
      setMonths('');
      setError(null);
    }
  }, [visible]);

  const submit = async () => {
    if (!reason.trim()) {
      setError('Tell the seller why you need this.');
      return;
    }
    let detailJson = '{}';
    if (type === 'grace') {
      detailJson = JSON.stringify({days: parseMoney(days) || undefined});
    } else if (type === 'reschedule') {
      detailJson = JSON.stringify({months: parseMoney(months) || undefined});
    } else if (type === 'early') {
      detailJson = JSON.stringify({quote: {total: quote.total, incentive: quote.incentive, remaining}});
    }
    setBusy(true);
    setError(null);
    try {
      await insertAdjustment({
        id: generateId('ad-'),
        planId: plan.id,
        buyerId: user?.id ?? '',
        type,
        reason: reason.trim(),
        detailJson,
        status: 'pending',
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        note: '',
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit request.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Request an adjustment">
      <ChipSelect
        label="What do you need?"
        value={type}
        onChange={v => setType(v as AdjustmentType)}
        options={ADJ_TYPES.map(t => ({value: t.value, label: t.label}))}
      />
      {type === 'grace' ? (
        <Field label="Extra grace days" value={days} onChangeText={setDays} keyboardType="numeric" placeholder="e.g. 7" />
      ) : null}
      {type === 'reschedule' ? (
        <Field label="Extra months" value={months} onChangeText={setMonths} keyboardType="numeric" placeholder="e.g. 2" />
      ) : null}
      {type === 'early' ? (
        <Card style={styles.quoteMini}>
          <Text style={styles.quoteMiniLabel}>
            Payoff quote: {formatMoney(quote.total)} (save {formatMoney(quote.incentive)})
          </Text>
        </Card>
      ) : null}
      <Field label="Reason" value={reason} onChangeText={setReason} placeholder="Explain your situation…" multiline />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="Send request" onPress={submit} loading={busy} />
    </Sheet>
  );
}

/* ------------------------------ Chat sheet ------------------------------ */

function ChatSheet({
  visible,
  onClose,
  plan,
  messages,
  onSent,
}: {
  visible: boolean;
  onClose: () => void;
  plan: Plan;
  messages: Message[];
  onSent: () => void;
}) {
  const {user} = useAppStore();
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);

  // Track when messages arrive to show skeleton during load.
  const prevVisible = useRef(visible);
  useEffect(() => {
    if (visible && !prevVisible.current) {
      setLoading(true);
    }
    prevVisible.current = visible;
  }, [visible]);
  useEffect(() => {
    if (visible && messages.length > 0) {
      setLoading(false);
    }
  }, [visible, messages.length]);

  const me = user?.id ?? '';
  const otherId = plan.sellerId === me ? plan.buyerId : plan.sellerId;

  const send = async () => {
    if (!text.trim()) {
      return;
    }
    await insertMessage({
      id: generateId('m-'),
      planId: plan.id,
      senderId: me,
      recipientId: otherId,
      text: text.trim(),
      isRead: false,
      createdAt: new Date().toISOString(),
    });
    setText('');
    onSent();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={`Chat about ${plan.planNo}`}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {loading ? (
          // Shimmer skeleton bubbles while messages load.
          <SkeletonChatBubbles />
        ) : messages.length === 0 ? (
          <EmptyState icon="chat" label="C" title="No messages yet" subtitle="Say hello to start the conversation." />
        ) : (
          messages.map(m => {
            const mine = m.senderId === me;
            return (
              <View key={m.id} style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>{m.text}</Text>
              </View>
            );
          })
        )}
        <View style={styles.chatInputRow}>
          <TextInput
            style={styles.chatInput}
            value={text}
            onChangeText={setText}
            placeholder="Type a message…"
            placeholderTextColor={colors.textFaint}
            multiline
          />
          <Button label="Send" small onPress={send} style={styles.sendBtn} />
        </View>
      </KeyboardAvoidingView>
    </Sheet>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    heroCard: {gap: spacing.md},
    heroTop: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
    heroInfo: {flex: 1},
    heroTitle: {...typography.heading, color: c.text},
    heroNo: {...typography.caption, color: c.textMuted},
    heroStats: {flexDirection: 'row', justifyContent: 'space-between'},
    heroStat: {gap: 2},
    heroStatValue: {...typography.price, color: c.text},
    heroStatLabel: {...typography.caption, color: c.textMuted},
    heroMeta: {gap: 2},
    heroMetaText: {...typography.caption, color: c.textFaint},

    dueCard: {backgroundColor: c.surfaceAlt, borderColor: c.primaryBorder, marginTop: spacing.md},
    dueLeft: {gap: spacing.xs},
    dueLabel: {...typography.label, color: c.textMuted},
    dueAmount: {...typography.priceLarge, color: c.text},
    duePenalty: {...typography.label, color: c.danger},
    dueOk: {...typography.label, color: c.success},

    actions: {flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md},
    action: {flex: 1},
    qrButton: {marginTop: spacing.md},

    qrModal: {alignItems: 'center', gap: spacing.md},
    qrFrame: {
      backgroundColor: '#ffffff',
      borderRadius: radius.lg,
      padding: spacing.md,
      shadowColor: c.shadow,
      shadowOpacity: 0.12,
      shadowRadius: 12,
      shadowOffset: {width: 0, height: 4},
      elevation: 2,
    },
    qrModalImg: {
      width: 220,
      height: 220,
      borderRadius: radius.md,
    },
    qrModalCaption: {...typography.caption, color: c.textMuted, textAlign: 'center'},
    qrAmount: {...typography.label, color: c.success, fontWeight: '700'},
    qrMissing: {...typography.caption, color: c.textFaint},

    scheduleAmount: {...typography.price, color: c.text},

    payDueCard: {marginBottom: spacing.md, backgroundColor: c.successSoft, borderColor: 'transparent'},
    payDueLabel: {...typography.label, color: c.textMuted},
    payDueAmount: {...typography.priceLarge, color: c.success},
    payDueHint: {...typography.caption, color: c.textMuted, marginTop: spacing.xs},
    advanceHint: {
      ...typography.caption,
      color: c.textFaint,
      backgroundColor: c.surfaceAlt,
      borderRadius: radius.sm,
      padding: spacing.sm,
      marginBottom: spacing.md,
    },
    penaltyNote: {
      ...typography.label,
      color: c.danger,
      backgroundColor: c.dangerSoft,
      padding: spacing.md,
      borderRadius: radius.md,
      marginBottom: spacing.md,
    },

    quote: {gap: spacing.sm, marginBottom: spacing.md},
    quoteRow: {flexDirection: 'row', justifyContent: 'space-between'},
    quoteLabel: {...typography.label, color: c.textMuted},
    quoteValue: {...typography.label, color: c.text},
    quoteTotal: {borderTopWidth: 1, borderTopColor: c.borderStrong, paddingTop: spacing.sm},
    quoteLabelStrong: {...typography.heading, color: c.text},
    quoteTotalValue: {...typography.priceLarge, color: c.success},
    quoteHint: {...typography.caption, color: c.textFaint, marginBottom: spacing.md},
    quoteMini: {marginBottom: spacing.md},
    quoteMiniLabel: {...typography.label, color: c.violet},

    error: {
      ...typography.label,
      color: c.danger,
      backgroundColor: c.dangerSoft,
      padding: spacing.md,
      borderRadius: radius.md,
      marginBottom: spacing.sm,
    },

    bubble: {
      maxWidth: '82%',
      padding: spacing.md,
      borderRadius: radius.lg,
      marginBottom: spacing.sm,
    },
    bubbleMine: {alignSelf: 'flex-end', backgroundColor: c.primary},
    bubbleTheirs: {alignSelf: 'flex-start', backgroundColor: c.surfaceAlt},
    bubbleText: {...typography.body, color: c.text},
    bubbleTextMine: {color: '#fff'},
    chatInputRow: {flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.md},
    chatInput: {
      flex: 1,
      backgroundColor: c.surfaceAlt,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.borderStrong,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      color: c.text,
      fontSize: 14,
      maxHeight: 100,
    },
    sendBtn: {},
  });
