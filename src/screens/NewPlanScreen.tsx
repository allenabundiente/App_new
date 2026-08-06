import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useAppStore} from '../store/AppStore';
import {colors, radius, spacing, typography} from '../theme';
import {Button, ChipSelect, EmptyState, Field, Screen, toast} from '../components/ui';
import {formatMoney, parseMoney, round2} from '../utils/money';
import {addDays, today} from '../utils/date';
import {createPlan} from '../db/dataAccess';
import {pmt, totalInterest, totalPayable} from '../services/amortization';

const TERM_OPTIONS = [3, 6, 9, 12, 18, 24].map(t => ({value: String(t), label: `${t} mo`}));
const APR_OPTIONS = [0, 12, 18, 24, 30, 36].map(a => ({value: String(a), label: a ? `${a}%` : '0%'}));
const DATE_OPTIONS = [
  {value: today(), label: 'Today'},
  {value: addDays(today(), 7), label: '+1 week'},
  {value: addDays(today(), 30), label: '+1 month'},
];

export function NewPlanScreen() {
  const {user, customers, products, push, refresh} = useAppStore();
  const [customerId, setCustomerId] = useState('');
  const [productId, setProductId] = useState('');
  const [price, setPrice] = useState('');
  const [down, setDown] = useState('');
  const [apr, setApr] = useState('24');
  const [term, setTerm] = useState('12');
  const [startDate, setStartDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const product = products.find(p => p.id === productId) ?? null;
  const priceNum = parseMoney(price || (product ? String(product.price) : ''));
  const downNum = parseMoney(down);
  const financed = Math.max(0, priceNum - downNum);
  const installment = pmt(financed, Number(apr) || 0, Number(term) || 0);
  const interest = totalInterest(financed, installment, Number(term) || 0);

  const customer = customers.find(c => c.id === customerId);

  const pickProduct = (id: string) => {
    setProductId(id);
    const p = products.find(x => x.id === id);
    if (p) {
      setPrice(String(p.price));
    }
  };

  const submit = async () => {
    if (!customer || !product) {
      setError('Pick a customer and a product.');
      return;
    }
    if (financed <= 0) {
      setError('Price must be greater than the down payment.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const plan = await createPlan({
        sellerId: user?.id ?? '',
        buyerId: customer.userId,
        productId: product.id,
        productName: product.name,
        productEmoji: product.emoji,
        price: priceNum,
        downPayment: downNum,
        apr: Number(apr) || 0,
        term: Number(term) || 0,
        startDate,
        notes,
      });
      toast(`Plan created — ${formatMoney(installment)}/month`);
      await refresh();
      push('plan-detail', {planId: plan.id});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the plan.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      {customers.length === 0 ? (
        <EmptyState
          emoji="👥"
          title="Add a customer first"
          subtitle="You need at least one customer to create a plan."
        />
      ) : (
        <>
          <ChipSelect
            label="Customer"
            value={customerId}
            onChange={setCustomerId}
            options={customers.map(c => ({value: c.id, label: c.name.split(' ')[0]}))}
          />

          {products.length === 0 ? (
            <EmptyState emoji="📦" title="No products" subtitle="Add products before creating plans." />
          ) : (
            <ChipSelect
              label="Product"
              value={productId}
              onChange={pickProduct}
              options={products.map(p => ({
                value: p.id,
                label: `${p.emoji} ${p.name}`,
              }))}
            />
          )}

          <View style={styles.row}>
            <View style={styles.half}>
              <Field
                label="Selling price"
                value={price}
                onChangeText={setPrice}
                keyboardType="numeric"
                placeholder="0.00"
              />
            </View>
            <View style={styles.half}>
              <Field
                label="Down payment"
                value={down}
                onChangeText={setDown}
                keyboardType="numeric"
                placeholder="0.00"
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={styles.half}>
              <ChipSelect label="APR" value={apr} onChange={setApr} options={APR_OPTIONS} />
            </View>
            <View style={styles.half}>
              <ChipSelect label="Term" value={term} onChange={setTerm} options={TERM_OPTIONS} />
            </View>
          </View>

          <ChipSelect label="First payment due" value={startDate} onChange={setStartDate} options={DATE_OPTIONS} />
          <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional — agreement notes" />

          {/* Live amortization preview */}
          <View style={styles.preview}>
            <Text style={styles.previewTitle}>Plan preview</Text>
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>Financed amount</Text>
              <Text style={styles.previewValue}>{formatMoney(financed)}</Text>
            </View>
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>Monthly installment</Text>
              <Text style={styles.previewValueStrong}>{formatMoney(installment)}</Text>
            </View>
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>Total payable ({term} months)</Text>
              <Text style={styles.previewValue}>{formatMoney(totalPayable(installment, Number(term) || 0))}</Text>
            </View>
            <View style={styles.previewRow}>
              <Text style={styles.previewLabel}>Interest cost</Text>
              <Text style={styles.previewValue}>{formatMoney(round2(interest))}</Text>
            </View>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            label="Create plan"
            icon="📋"
            onPress={submit}
            loading={busy}
            disabled={!customer || !product}
          />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {flexDirection: 'row', gap: spacing.md},
  half: {flex: 1},
  preview: {
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.primaryBorder,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  previewTitle: {...typography.heading, color: colors.violet},
  previewRow: {flexDirection: 'row', justifyContent: 'space-between'},
  previewLabel: {...typography.label, color: colors.textMuted},
  previewValue: {...typography.label, color: colors.text},
  previewValueStrong: {...typography.price, color: colors.success},
  error: {
    ...typography.label,
    color: colors.danger,
    backgroundColor: colors.dangerSoft,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
});
