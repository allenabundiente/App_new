import React, {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useAppStore} from '../store/AppStore';
import {spacing, typography, useTheme, useThemedStyles, type Palette} from '../theme';
import {Avatar, Button, Card, Field, ImagePickerField, Screen, toast} from '../components/ui';
import {SkeletonProfile} from '../components/Skeleton';
import {formatDate} from '../utils/date';

const QR_HINT =
  'Choose your payment QR (GCash, Maya, bank) so buyers can scan and pay online. Shown on plan details.';

export function ProfileScreen() {
  const {user, updateProfile, changePassword, logout, backendMode} = useAppStore();
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [qrImage, setQrImage] = useState(user?.qrImage ?? '');
  const [profileBusy, setProfileBusy] = useState(false);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  if (!user) {
    return <Screen><SkeletonProfile /></Screen>;
  }

  const saveProfile = async () => {
    if (!name.trim()) {
      toast('Name cannot be empty.', 'error');
      return;
    }
    setProfileBusy(true);
    try {
      await updateProfile({
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        ...(user.role === 'seller' ? {qrImage: qrImage.trim()} : {}),
      });
      toast('Profile updated');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save your profile.', 'error');
    } finally {
      setProfileBusy(false);
    }
  };

  const savePassword = async () => {
    if (!current) {
      toast('Enter your current password.', 'error');
      return;
    }
    if (next.length < 6) {
      toast('New password must be at least 6 characters.', 'error');
      return;
    }
    if (next !== confirm) {
      toast('New passwords do not match.', 'error');
      return;
    }
    setPwBusy(true);
    try {
      await changePassword(current, next);
      toast('Password changed');
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not change your password.', 'error');
    } finally {
      setPwBusy(false);
    }
  };

  const roleLabel = user.role === 'admin' ? 'Administrator' : user.role === 'seller' ? 'Seller' : 'Buyer';
  const statusColor =
    user.status === 'active' ? colors.success : user.status === 'suspended' ? colors.danger : colors.warn;

  return (
    <Screen scroll>
      {/* Identity card */}
      <Card style={styles.identity}>
        <Avatar name={user.name} size={64} />
        <View style={styles.identityText}>
          <Text style={styles.identityName}>{user.name}</Text>
          <Text style={styles.identityMeta}>{roleLabel}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, {backgroundColor: statusColor}]} />
            <Text style={styles.identityMeta}>{user.status}</Text>
          </View>
        </View>
      </Card>

      {/* Account details */}
      <Text style={styles.sectionTitle}>Account</Text>
      <Card style={styles.formCard}>
        <Field label="Full name" value={name} onChangeText={setName} placeholder="Your name" />
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@hulog.ph"
          autoCapitalize="none"
          keyboardType="email-address"
          autoCorrect={false}
        />
        <Field
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          placeholder="+63 912 345 6789"
          keyboardType="phone-pad"
        />
        {user.role === 'seller' ? (
          <ImagePickerField
            label="Online payment QR"
            value={qrImage}
            onChange={setQrImage}
            compact
            hint={QR_HINT}
          />
        ) : null}
        <Text style={styles.notes}>
          Member since {formatDate(user.joinedAt)} · ID {user.id}
        </Text>
        <Button label="Save profile" onPress={saveProfile} loading={profileBusy} />
      </Card>

      {/* Password */}
      <Text style={styles.sectionTitle}>Password</Text>
      <Card style={styles.formCard}>
        <Field
          label="Current password"
          value={current}
          onChangeText={setCurrent}
          placeholder="••••••••"
          secureTextEntry
        />
        <Field
          label="New password"
          value={next}
          onChangeText={setNext}
          placeholder="At least 6 characters"
          secureTextEntry
        />
        <Field
          label="Confirm new password"
          value={confirm}
          onChangeText={setConfirm}
          placeholder="Repeat the new password"
          secureTextEntry
        />
        <Button label="Change password" variant="secondary" onPress={savePassword} loading={pwBusy} />
      </Card>

      {/* Session */}
      <Text style={styles.sectionTitle}>Session</Text>
      <Card style={styles.formCard}>
        <Text style={styles.notes}>
          Data is stored {backendMode === 'cloud' ? 'in the cloud (hosted server)' : 'on this device (offline SQLite)'}.
        </Text>
        <Button label="Sign out" variant="danger" icon="logout" onPress={logout} />
      </Card>
    </Screen>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    identity: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      marginBottom: spacing.sm,
    },
    identityText: {flex: 1, gap: 2},
    identityName: {...typography.title, color: c.text},
    identityMeta: {...typography.caption, color: c.textMuted, textTransform: 'capitalize'},
    statusRow: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: 2},
    statusDot: {width: 8, height: 8, borderRadius: 4},
    sectionTitle: {
      ...typography.heading,
      color: c.text,
      marginTop: spacing.xl,
      marginBottom: spacing.sm,
    },
    formCard: {gap: spacing.xs},
    notes: {...typography.caption, color: c.textFaint, marginBottom: spacing.sm},
  });
