import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useAppStore} from '../store/AppStore';
import {spacing, typography, useThemedStyles, type Palette} from '../theme';
import {
  Avatar,
  Button,
  ChipSelect,
  EmptyState,
  ListRow,
  Screen,
  Section,
  Sheet,
  toast,
} from '../components/ui';
import {formatDate} from '../utils/date';

const ROLE_FILTERS = [
  {value: 'all', label: 'All'},
  {value: 'buyer', label: 'Buyers'},
  {value: 'seller', label: 'Sellers'},
  {value: 'admin', label: 'Admins'},
];

const STATUS_FILTERS = [
  {value: 'all', label: 'All'},
  {value: 'active', label: 'Active'},
  {value: 'pending', label: 'Pending'},
  {value: 'suspended', label: 'Suspended'},
];

export function AdminUsersScreen() {
  const {users, verifyUser, plans} = useAppStore();
  const styles = useThemedStyles(createStyles);
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [detailId, setDetailId] = useState<string | null>(null);

  const filtered = users.filter(
    u =>
      (roleFilter === 'all' || u.role === roleFilter) &&
      (statusFilter === 'all' || u.status === statusFilter),
  );

  const detail = users.find(u => u.id === detailId) ?? null;
  const detailPlanCount = detail
    ? plans.filter(p => p.buyerId === detail.id || p.sellerId === detail.id).length
    : 0;

  const act = async (id: string, approve: boolean) => {
    await verifyUser(id, approve);
    toast(approve ? 'Account verified' : 'Account suspended');
  };

  return (
    <Screen>
      <ChipSelect options={ROLE_FILTERS} value={roleFilter} onChange={setRoleFilter} />
      <View style={styles.statusWrap}>
        <ChipSelect options={STATUS_FILTERS} value={statusFilter} onChange={setStatusFilter} />
      </View>

      {filtered.length === 0 ? (
        <EmptyState icon="tab.users" label="U" title="No users match" />
      ) : (
        <>
          <Section title={`${filtered.length} user${filtered.length === 1 ? '' : 's'}`} />
          {filtered.map(u => (
            <ListRow
              key={u.id}
              icon="tab.users"
              label={u.name}
              title={u.name}
              subtitle={`${u.email} · joined ${formatDate(u.joinedAt)}`}
              tone={u.status}
              onPress={() => setDetailId(u.id)}
              right={<Text style={styles.chev}>›</Text>}
            />
          ))}
        </>
      )}

      <Sheet visible={!!detail} onClose={() => setDetailId(null)} title="User details">
        {detail ? (
          <>
            <View style={styles.detailHeader}>
              <Avatar name={detail.name} size={56} />
              <View style={styles.detailInfo}>
                <Text style={styles.detailName}>{detail.name}</Text>
                <Text style={styles.detailMeta}>
                  {detail.email} · {detail.phone}
                </Text>
                <Text style={styles.detailMeta}>
                  {detail.role.toUpperCase()} · {detail.status} · since {formatDate(detail.joinedAt)}
                </Text>
                <Text style={styles.detailMeta}>{detailPlanCount} plan(s) involved</Text>
              </View>
            </View>
            <View style={styles.detailActions}>
              {detail.status !== 'active' ? (
                <Button
                  label="Approve / activate"
                  variant="success"
                  onPress={async () => {
                    await act(detail.id, true);
                    setDetailId(null);
                  }}
                  style={styles.detailAction}
                />
              ) : null}
              {detail.status !== 'suspended' ? (
                <Button
                  label="Suspend"
                  variant="danger"
                  onPress={async () => {
                    await act(detail.id, false);
                    setDetailId(null);
                  }}
                  style={styles.detailAction}
                />
              ) : null}
            </View>
          </>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    statusWrap: {marginTop: spacing.sm},
    chev: {color: c.textFaint, fontSize: 20},
    detailHeader: {flexDirection: 'row', gap: spacing.lg, alignItems: 'center'},
    detailInfo: {flex: 1, gap: 2},
    detailName: {...typography.heading, color: c.text},
    detailMeta: {...typography.caption, color: c.textMuted},
    detailActions: {flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg},
    detailAction: {flex: 1},
  });
