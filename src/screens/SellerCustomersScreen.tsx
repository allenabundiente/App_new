import React, {useMemo, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useAppStore} from '../store/AppStore';
import {usePlans} from '../hooks/usePlans';
import {radius, spacing, typography, useThemedStyles, type Palette} from '../theme';
import {productImageFor} from '../utils/productImage';
import {
  Avatar,
  Button,
  EmptyState,
  Field,
  ListRow,
  Screen,
  Section,
  Sheet,
  toast,
} from '../components/ui';
import {formatMoney} from '../utils/money';
import {createCustomerWithUser} from '../db/dataAccess';

export function SellerCustomersScreen() {
  const {user, customers, plans, products, push, refresh, refreshing} = useAppStore();
  const styles = useThemedStyles(createStyles);
  const [addOpen, setAddOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const myPlans = useMemo(
    () => plans.filter(p => p.sellerId === user?.id),
    [plans, user?.id],
  );
  const summaries = usePlans(myPlans);

  const detail = customers.find(c => c.id === detailId) ?? null;
  const detailPlans = detail
    ? summaries.filter(s => s.plan.buyerId === detail.userId)
    : [];

  const statsFor = (userId: string) => {
    const list = summaries.filter(s => s.plan.buyerId === userId);
    return {
      count: list.length,
      outstanding: list
        .filter(s => s.status === 'active' || s.status === 'overdue')
        .reduce((a, s) => a + s.remaining, 0),
    };
  };

  return (
    <Screen refreshing={refreshing} onRefresh={() => void refresh(undefined, true)}>
      <Button label="Add customer" icon="plus" onPress={() => setAddOpen(true)} style={styles.addBtn} />
      {customers.length === 0 ? (
        <EmptyState
          icon="tab.customers"
          label="C"
          title="No customers yet"
          subtitle="Add your first customer to start creating plans."
          action="Add customer"
          onAction={() => setAddOpen(true)}
        />
      ) : (
        <>
          <Section title={`${customers.length} customers`} />
          {customers.map(c => {
            const st = statsFor(c.userId);
            return (
              <ListRow
                key={c.id}
                icon="tab.customers"
                label={c.name}
                title={c.name}
                subtitle={`${st.count} plan${st.count === 1 ? '' : 's'} · outstanding ${formatMoney(st.outstanding)}`}
                onPress={() => setDetailId(c.id)}
                right={<Text style={styles.chev}>›</Text>}
              />
            );
          })}
        </>
      )}

      <AddCustomerSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        sellerId={user?.id ?? ''}
        onDone={() => {
          setAddOpen(false);
          toast('Customer added — they can sign in with buyer123');
          refresh();
        }}
      />

      <Sheet visible={!!detail} onClose={() => setDetailId(null)} title={detail?.name ?? 'Customer'}>
        {detail ? (
          <>
            <View style={styles.detailHeader}>
              <Avatar name={detail.name} size={56} />
              <View style={styles.detailInfo}>
                <Text style={styles.detailLine}>
                  <Text style={styles.detailLabel}>Phone · </Text>
                  {detail.phone || '—'}
                </Text>
                <Text style={styles.detailLine}>
                  <Text style={styles.detailLabel}>Email · </Text>
                  {detail.email || '—'}
                </Text>
                <Text style={styles.detailLine}>
                  <Text style={styles.detailLabel}>Address · </Text>
                  {detail.address || '—'}
                </Text>
              </View>
            </View>
            {detail.notes ? <Text style={styles.detailNotes}>“{detail.notes}”</Text> : null}
            <Section title="Plans" />
            {detailPlans.length === 0 ? (
              <EmptyState
                icon="tab.plans"
                label="P"
                title="No plans yet"
                subtitle="Create a plan for this customer."
              />
            ) : (
              detailPlans.map(s => (
                <ListRow
                  key={s.plan.id}
                  icon="product"
                  label={s.plan.productName}
                  image={productImageFor(products, s.plan)}
                  title={`${s.plan.planNo} · ${s.plan.productName}`}
                  subtitle={`${formatMoney(s.remaining)} remaining`}
                  tone={s.status}
                  onPress={() => {
                    setDetailId(null);
                    push('plan-detail', {planId: s.plan.id});
                  }}
                />
              ))
            )}
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

function AddCustomerSheet({
  visible,
  onClose,
  sellerId,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  sellerId: string;
  onDone: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) {
      setError('Customer name is required.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createCustomerWithUser({
        sellerId,
        name,
        phone,
        email: email.toLowerCase().trim(),
        address,
        notes,
      });
      setName('');
      setPhone('');
      setEmail('');
      setAddress('');
      setNotes('');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save customer.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Add customer">
      <Field label="Full name" value={name} onChangeText={setName} placeholder="e.g. Ana Gonzales" />
      <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="+63 912 345 6789" keyboardType="phone-pad" />
      <Field label="Email" value={email} onChangeText={setEmail} placeholder="ana@example.com" autoCapitalize="none" keyboardType="email-address" />
      <Field label="Address" value={address} onChangeText={setAddress} placeholder="Street, Barangay, City" />
      <Field label="Notes" value={notes} onChangeText={setNotes} placeholder="Optional — preferences, reminders" />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label="Save customer" onPress={submit} loading={busy} />
      <Text style={styles.hint}>
        The customer gets a buyer account (password: buyer123) so they can sign in and track their plans.
      </Text>
    </Sheet>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    addBtn: {marginBottom: spacing.md},
    chev: {color: c.textFaint, fontSize: 20},
    detailHeader: {flexDirection: 'row', gap: spacing.lg, alignItems: 'center'},
    detailInfo: {gap: 2, flex: 1},
    detailLine: {...typography.label, color: c.textMuted},
    detailLabel: {color: c.textFaint},
    detailNotes: {
      ...typography.body,
      color: c.textMuted,
      fontStyle: 'italic',
      marginTop: spacing.md,
    },
    error: {
      ...typography.label,
      color: c.danger,
      backgroundColor: c.dangerSoft,
      padding: spacing.md,
      borderRadius: radius.md,
      marginBottom: spacing.sm,
    },
    hint: {
      ...typography.caption,
      color: c.textFaint,
      marginTop: spacing.md,
      textAlign: 'center',
    },
  });
