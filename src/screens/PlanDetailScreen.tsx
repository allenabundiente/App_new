import React, {useEffect, useState} from 'react';
import {KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View} from 'react-native';
import {useAppStore} from '../store/AppStore';
import {usePlanSummary} from '../hooks/usePlans';
import {colors, radius, spacing, typography} from '../theme';
import {
  Badge,
  Button,
  Card,
  ChipSelect,
  EmptyState,
  Field,
  ListRow,
  ProgressBar,
  Screen,
  Section,
  Sheet,
  toast,
} from '../components/ui';
import {formatMoney, parseMoney} from '../utils/money';
import {formatDate, today} from '../utils/date';
import {
  getPlan,
  getSettings,
  insertAdjustment,
  insertMessage,
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

const METHODS = ['Cash', 'GCash', 'Bank transfer', 'Card'].map(m => ({
  value: m,
  label: m,
}));

export function PlanDetailScreen({planId}: {planId: string}) {
  const {plans, customers, users, isSeller, push, refresh, tick} = useAppStore();
  const [plan, setPlan] = useState<Plan | null>(plans.find(p => p.id === planId) ?? null);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [payOpen, setPayOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
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
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatOpen, plan?.id]);

  if (!plan) {
    return (
      <Screen>
        <EmptyState emoji="🔍" title="Plan not found" />
      </Screen>
    );
  }

  const buyerName = customers.find(c => c.userId === plan.buyerId)?.name ?? 'Buyer';
  const sellerName = users.find(u => u.id === plan.sellerId)?.name ?? 'Seller';
  const paidCount = schedule.filter(s => s.status === 'paid').length;
  const nextDue = summary?.nextDue ?? null;
  const penalty = summary?.penalty ?? 0;
  const remaining = summary?.remaining ?? 0;
  const quote = earlySettlementQuote(remaining);

  return (
    <>
      <Screen scroll>
        {/* Plan header */}
        <Card style={styles.heroCard}>
          <View style={styles.heroTop}>
            <Text style={styles.heroEmoji}>{plan.productEmoji}</Text>
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
          <ProgressBar ratio={paidCount / plan.term} color={summary?.status === 'completed' ? colors.success : colors.primary} />
          <View style={styles.heroMeta}>
            <Text style={styles.heroMetaText}>
              Price {formatMoney(plan.price)} · DP {formatMoney(plan.downPayment)} · {plan.apr}% APR ·{' '}
              {plan.term}-month term
            </Text>
            <Text style={styles.heroMetaText}>
              {isSeller ? `Customer: ${buyerName}` : `Seller: ${sellerName}`}
            </Text>
          </View>
        </Card>

        {/* Next due + penalty */}
        {nextDue ? (
          <Card style={styles.dueCard}>
            <View style={styles.dueLeft}>
              <Text style={styles.dueLabel}>
                Next payment · due {formatDate(nextDue.dueDate)}
              </Text>
              <Text style={styles.dueAmount}>{formatMoney(nextDue.amount)}</Text>
              {penalty > 0 ? (
                <Text style={styles.duePenalty}>
                  ⚠ Late penalty {formatMoney(penalty)} — pays along with this installment
                </Text>
              ) : (
                <Text style={styles.dueOk}>On track — no penalty.</Text>
              )}
            </View>
          </Card>
        ) : null}

        {/* Actions */}
        <View style={styles.actions}>
          {isSeller ? (
            <>
              <Button label="Record payment" icon="💰" onPress={() => setPayOpen(true)} style={styles.action} />
              <Button
                label="Settle early"
                icon="🏁"
                variant="secondary"
                onPress={() => setSettleOpen(true)}
                disabled={remaining <= 0}
                style={styles.action}
              />
            </>
          ) : (
            <Button label="Request adjustment" icon="🔄" onPress={() => setAdjustOpen(true)} style={styles.action} />
          )}
          <Button
            label="Chat"
            icon="💬"
            variant="secondary"
            onPress={() => setChatOpen(true)}
            style={styles.action}
          />
        </View>

        {/* Schedule */}
        <Section title={`Payment schedule (${plan.term} installments)`} />
        {schedule.map((s, i) => (
          <ListRow
            key={s.id}
            emoji={s.status === 'paid' ? '✅' : s.status === 'skipped' ? '⏭️' : i === 0 ? '⏳' : '📅'}
            title={`Installment ${i + 1} — ${formatDate(s.dueDate)}`}
            subtitle={s.status === 'paid' ? `Paid ${s.paidDate ? formatDate(s.paidDate) : ''}${s.note ? ` · ${s.note}` : ''}` : s.note || (s.status === 'skipped' ? 'Skipped (payment holiday)' : 'Awaiting payment')}
            right={<Text style={styles.scheduleAmount}>{formatMoney(s.amount)}</Text>}
            tone={s.status === 'paid' ? 'paid' : s.status === 'skipped' ? 'pending' : 'active'}
          />
        ))}

        {/* Payment history */}
        <Section title={`Payment history (${payments.length})`} />
        {payments.length === 0 ? (
          <EmptyState emoji="🧾" title="No payments yet" subtitle="The first installment payment will appear here." />
        ) : (
          payments.map(p => (
            <ListRow
              key={p.id}
              emoji={p.type === 'settlement' ? '🏁' : p.type === 'down' ? '💵' : '✅'}
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
        onDone={() => {
          setPayOpen(false);
          toast('Payment recorded ✅');
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
          toast('Plan settled — receipt issued 🏁');
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
          toast('Request sent to your seller 📨');
          refresh();
        }}
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

/* ------------------------- Record payment sheet ------------------------- */

function RecordPaymentSheet({
  visible,
  onClose,
  plan,
  nextDue,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  plan: Plan;
  nextDue: ScheduleItem | null;
  onDone: () => void;
}) {
  const {user} = useAppStore();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('Cash');
  const [date, setDate] = useState(today());
  const [penalty, setPenalty] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setAmount(nextDue ? String(nextDue.amount) : '');
      setDate(today());
    }
  }, [visible, nextDue]);

  // Live penalty preview as the date changes.
  useEffect(() => {
    (async () => {
      if (!nextDue) {
        setPenalty(0);
        return;
      }
      const settings = await getSettings();
      setPenalty(
        computePenalty(nextDue.amount, effectiveDueDate(nextDue.dueDate, plan.graceExtra), date, {
          graceDays: settings.graceDays,
          ratePerMonthPct: settings.penaltyRate,
          capPct: settings.penaltyCap,
        }),
      );
    })();
  }, [date, nextDue, plan.graceExtra]);

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
          <Text style={styles.payDueAmount}>{formatMoney(nextDue.amount)}</Text>
        </Card>
      ) : null}
      <Field label="Amount" value={amount} onChangeText={setAmount} keyboardType="numeric" />
      <ChipSelect label="Method" value={method} onChange={setMethod} options={METHODS} />
      <Field label="Payment date (YYYY-MM-DD)" value={date} onChangeText={setDate} autoCapitalize="none" />
      {penalty > 0 ? (
        <Text style={styles.penaltyNote}>
          ⚠ Late fee {formatMoney(penalty)} will be added on top of the amount.
        </Text>
      ) : null}
      <Button label="Save payment" icon="💰" onPress={submit} loading={busy} />
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
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      await settlePlan(plan.id, user?.id ?? '');
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
        <View style={[styles.quoteRow, styles.quoteTotal]}>
          <Text style={styles.quoteLabelStrong}>You pay today</Text>
          <Text style={styles.quoteTotalValue}>{formatMoney(quote.total)}</Text>
        </View>
      </View>
      <Text style={styles.quoteHint}>
        Settling clears all remaining installments and completes the plan. A receipt is issued automatically.
      </Text>
      <Button label="Confirm settlement" icon="🏁" onPress={submit} loading={busy} />
    </Sheet>
  );
}

/* ------------------------ Adjustment request sheet ----------------------- */

const ADJ_TYPES: Array<{value: AdjustmentType; label: string; emoji: string}> = [
  {value: 'holiday', label: 'Skip one payment', emoji: '⏭️'},
  {value: 'reschedule', label: 'Extend term', emoji: '📅'},
  {value: 'grace', label: 'Extra grace days', emoji: '⏳'},
  {value: 'early', label: 'Settle early', emoji: '🏁'},
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
        options={ADJ_TYPES.map(t => ({value: t.value, label: `${t.emoji} ${t.label}`}))}
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
  const [text, setText] = useState('');

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
        {messages.length === 0 ? (
          <EmptyState emoji="💬" title="No messages yet" subtitle="Say hello to start the conversation." />
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

const styles = StyleSheet.create({
  heroCard: {gap: spacing.md},
  heroTop: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  heroEmoji: {fontSize: 40},
  heroInfo: {flex: 1},
  heroTitle: {...typography.heading, color: colors.text},
  heroNo: {...typography.caption, color: colors.textMuted},
  heroStats: {flexDirection: 'row', justifyContent: 'space-between'},
  heroStat: {gap: 2},
  heroStatValue: {...typography.price, color: colors.text},
  heroStatLabel: {...typography.caption, color: colors.textMuted},
  heroMeta: {gap: 2},
  heroMetaText: {...typography.caption, color: colors.textFaint},

  dueCard: {backgroundColor: colors.surfaceAlt, borderColor: colors.primaryBorder, marginTop: spacing.md},
  dueLeft: {gap: spacing.xs},
  dueLabel: {...typography.label, color: colors.textMuted},
  dueAmount: {...typography.priceLarge, color: colors.text},
  duePenalty: {...typography.label, color: colors.danger},
  dueOk: {...typography.label, color: colors.success},

  actions: {flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md},
  action: {flex: 1},

  scheduleAmount: {...typography.price, color: colors.text},

  payDueCard: {marginBottom: spacing.md, backgroundColor: colors.successSoft, borderColor: 'transparent'},
  payDueLabel: {...typography.label, color: colors.textMuted},
  payDueAmount: {...typography.priceLarge, color: colors.success},
  penaltyNote: {
    ...typography.label,
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },

  quote: {gap: spacing.sm, marginBottom: spacing.md},
  quoteRow: {flexDirection: 'row', justifyContent: 'space-between'},
  quoteLabel: {...typography.label, color: colors.textMuted},
  quoteValue: {...typography.label, color: colors.text},
  quoteTotal: {borderTopWidth: 1, borderTopColor: colors.borderStrong, paddingTop: spacing.sm},
  quoteLabelStrong: {...typography.heading, color: colors.text},
  quoteTotalValue: {...typography.priceLarge, color: colors.success},
  quoteHint: {...typography.caption, color: colors.textFaint, marginBottom: spacing.md},
  quoteMini: {marginBottom: spacing.md},
  quoteMiniLabel: {...typography.label, color: colors.violet},

  error: {
    ...typography.label,
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
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
  bubbleMine: {alignSelf: 'flex-end', backgroundColor: colors.primary},
  bubbleTheirs: {alignSelf: 'flex-start', backgroundColor: colors.surfaceAlt},
  bubbleText: {...typography.body, color: colors.text},
  bubbleTextMine: {color: '#fff'},
  chatInputRow: {flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm, marginTop: spacing.md},
  chatInput: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.text,
    fontSize: 14,
    maxHeight: 100,
  },
  sendBtn: {},
});
