import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useAppStore} from '../store/AppStore';
import {radius, spacing, typography, useThemedStyles, type Palette} from '../theme';
import {
  Button,
  EmptyState,
  Field,
  ListRow,
  Screen,
  Section,
  Sheet,
  toast,
} from '../components/ui';
import {AssetIcon} from '../components/AssetIcon';
import {formatMoney, parseMoney} from '../utils/money';
import {createProduct, deleteProduct, updateProduct} from '../db/dataAccess';
import type {Product} from '../types';

export function SellerProductsScreen() {
  const {user, products, refresh} = useAppStore();
  const styles = useThemedStyles(createStyles);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Product | null>(null);

  const stockValue = products.reduce((a, p) => a + p.price * p.stock, 0);

  return (
    <Screen>
      <View style={styles.hero}>
        <View style={styles.heroText}>
          <Text style={styles.heroTitle}>Your catalog</Text>
          <Text style={styles.heroSub}>
            {products.length} product{products.length === 1 ? '' : 's'} · stock value{' '}
            {formatMoney(stockValue)}
          </Text>
        </View>
        <Button
          label="Add product"
          icon="plus"
          small
          onPress={() => setAddOpen(true)}
          style={styles.addBtn}
        />
      </View>

      {products.length === 0 ? (
        <EmptyState
          icon="product"
          label="P"
          title="No products yet"
          subtitle="Add the items you sell so you can build installment plans on top of them."
          action="Add your first product"
          onAction={() => setAddOpen(true)}
        />
      ) : (
        <>
          <Section title="Products" />
          {products.map(p => (
            <ListRow
              key={p.id}
              icon="product"
              label={p.name}
              image={p.image || undefined}
              title={p.name}
              subtitle={`Sells ${formatMoney(p.price)} · costs ${formatMoney(p.cost)} · ${p.stock} in stock`}
              onPress={() => setEditing(p)}
              right={
                <View style={styles.rowRight}>
                  <Text style={styles.margin}>
                    +{formatMoney(Math.max(0, p.price - p.cost))}/unit
                  </Text>
                  <View style={styles.rowActions}>
                    <Button
                      label="Edit"
                      variant="secondary"
                      small
                      onPress={() => setEditing(p)}
                    />
                  </View>
                </View>
              }
            />
          ))}
        </>
      )}

      {/* Add */}
      <ProductFormSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add product"
        sellerId={user?.id ?? ''}
        onDone={() => {
          setAddOpen(false);
          toast('Product added');
          refresh();
        }}
      />

      {/* Edit */}
      <ProductFormSheet
        visible={!!editing}
        onClose={() => setEditing(null)}
        title="Edit product"
        sellerId={user?.id ?? ''}
        product={editing ?? undefined}
        onDone={() => {
          setEditing(null);
          toast('Product updated');
          refresh();
        }}
      />

      {/* Delete confirm */}
      <Sheet
        visible={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete product?"
      >
        {confirmDelete ? (
          <>
            <View style={styles.deleteRow}>
              <AssetIcon name="product" label={confirmDelete.name} size={44} />
              <View style={styles.deleteInfo}>
                <Text style={styles.deleteName}>{confirmDelete.name}</Text>
                <Text style={styles.deleteSub}>
                  {formatMoney(confirmDelete.price)} · {confirmDelete.stock} in stock
                </Text>
              </View>
            </View>
            <Text style={styles.deleteWarn}>
              Deleting a product does not affect existing plans — they keep their
              own copy of the product name and price. This cannot be undone.
            </Text>
            <Button
              label="Delete product"
              variant="danger"
              icon="trash"
              onPress={async () => {
                const id = confirmDelete.id;
                setConfirmDelete(null);
                try {
                  await deleteProduct(id);
                  toast('Product deleted');
                  refresh();
                } catch (e) {
                  toast(e instanceof Error ? e.message : 'Could not delete the product.', 'error');
                }
              }}
            />
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

/* --------------------------- Add / edit sheet --------------------------- */

function ProductFormSheet({
  visible,
  onClose,
  title,
  sellerId,
  product,
  onDone,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  sellerId: string;
  product?: Product;
  onDone: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [stock, setStock] = useState('');
  const [image, setImage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill when opening for edit; reset for a fresh add.
  const [lastKey, setLastKey] = useState('');
  const key = visible ? (product?.id ?? 'new') : 'closed';
  if (key !== lastKey) {
    setLastKey(key);
    setName(product?.name ?? '');
    setPrice(product ? String(product.price) : '');
    setCost(product ? String(product.cost) : '');
    setStock(product ? String(product.stock) : '');
    setImage(product?.image ?? '');
    setError(null);
  }

  const submit = async () => {
    if (!name.trim()) {
      setError('Give the product a name, e.g. “TechPhone X5”.');
      return;
    }
    const priceNum = parseMoney(price);
    const costNum = parseMoney(cost);
    const stockNum = Math.max(0, Math.round(parseMoney(stock)));
    if (priceNum <= 0) {
      setError('Selling price must be greater than zero.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const patch = {
        name: name.trim(),
        price: priceNum,
        cost: costNum,
        stock: stockNum,
        image: image.trim(),
      };
      if (product) {
        await updateProduct(product.id, patch);
      } else {
        await createProduct({
          sellerId,
          ...patch,
        });
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the product.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <Field
        label="Product name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. TechPhone X5 128GB"
      />
      <Field
        label="Selling price"
        value={price}
        onChangeText={setPrice}
        keyboardType="numeric"
        placeholder="0.00"
        hint="What the customer pays for this item."
      />
      <Field
        label="Cost"
        value={cost}
        onChangeText={setCost}
        keyboardType="numeric"
        placeholder="0.00"
        hint="What it costs you — used to show your margin."
      />
      <Field
        label="Stock"
        value={stock}
        onChangeText={setStock}
        keyboardType="numeric"
        placeholder="0"
        hint="How many units you currently have."
      />
      <Field
        label="Product photo URL"
        value={image}
        onChangeText={setImage}
        placeholder="https://example.com/photo.jpg"
        autoCapitalize="none"
        autoCorrect={false}
        hint="Optional — paste a link to a product photo. Shown in your catalog."
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label={product ? 'Save changes' : 'Add product'} onPress={submit} loading={busy} />
    </Sheet>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    hero: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      marginBottom: spacing.md,
    },
    heroText: {flex: 1, gap: 2},
    heroTitle: {...typography.title, color: c.text},
    heroSub: {...typography.body, color: c.textMuted},
    addBtn: {marginLeft: 'auto'},

    rowRight: {alignItems: 'flex-end', gap: spacing.xs},
    margin: {...typography.caption, color: c.success, fontWeight: '700'},
    rowActions: {flexDirection: 'row', gap: spacing.sm},

    deleteRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md},
    deleteInfo: {flex: 1, gap: 2},
    deleteName: {...typography.heading, color: c.text},
    deleteSub: {...typography.caption, color: c.textMuted},
    deleteWarn: {
      ...typography.body,
      color: c.textMuted,
      backgroundColor: c.dangerSoft,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.lg,
    },

    error: {
      ...typography.label,
      color: c.danger,
      backgroundColor: c.dangerSoft,
      padding: spacing.md,
      borderRadius: radius.md,
      marginBottom: spacing.sm,
    },
  });
