import React, {useEffect, useRef, useState} from 'react';
import {Alert, StyleSheet, Text, TextInput, View} from 'react-native';
import {useAppStore} from '../store/AppStore';
import {spacing, typography, useTheme, useThemedStyles, type Palette} from '../theme';
import {Avatar, Button, Card, Field, GradientCardLight, ImagePickerField, Screen, toast} from '../components/ui';
import {SkeletonProfile} from '../components/Skeleton';
import {formatDate} from '../utils/date';
import {
  notificationPermissionState,
  openNotificationSettings,
  requestNotificationPermission,
  sendTestNotification,
  type NotificationPermissionState,
} from '../services/notifications';

const QR_HINT =
  'Choose your payment QR (GCash, Maya, bank) so buyers can scan and pay online. Shown on plan details.';

export function ProfileScreen() {
  const {user, updateProfile, changePassword, logout} = useAppStore();
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);
  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const newPasswordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [qrImage, setQrImage] = useState(user?.qrImage ?? '');
  const [profileBusy, setProfileBusy] = useState(false);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const [notifStatus, setNotifStatus] = useState<NotificationPermissionState>('not-determined');
  const [notifBusy, setNotifBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void notificationPermissionState().then(state => {
      if (alive) {
        setNotifStatus(state);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

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

  const enableNotifications = async () => {
    setNotifBusy(true);
    try {
      const state = await requestNotificationPermission();
      setNotifStatus(state);
      if (state === 'authorized') {
        toast('Notifications enabled');
      } else if (state === 'unavailable') {
        toast('Notifications are not available on this device.', 'error');
      } else {
        Alert.alert(
          'Notifications are off',
          'Enable notifications for HulogTrack in your device settings to get due-date and chat alerts.',
          [
            {text: 'Not now', style: 'cancel'},
            {text: 'Open settings', onPress: () => void openNotificationSettings()},
          ],
        );
      }
    } finally {
      setNotifBusy(false);
    }
  };

  const testNotification = async () => {
    setNotifBusy(true);
    try {
      const sent = await sendTestNotification();
      toast(
        sent ? 'Test notification sent' : 'Notifications are off. Enable them first.',
        sent ? 'success' : 'error',
      );
    } finally {
      setNotifBusy(false);
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
      <GradientCardLight stops={colors.cardGradientBrand} style={styles.identity}>
        <Avatar name={user.name} size={64} />
        <View style={styles.identityText}>
          <Text style={styles.identityName}>{user.name}</Text>
          <Text style={styles.identityMeta}>{roleLabel}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, {backgroundColor: statusColor}]} />
            <Text style={styles.identityMeta}>{user.status}</Text>
          </View>
        </View>
      </GradientCardLight>

      {/* Account details */}
      <Text style={styles.sectionTitle}>Account</Text>
      <Card style={styles.formCard}>
        <Field
          label="Full name"
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          autoComplete="name"
          returnKeyType="next"
          onSubmitEditing={() => emailRef.current?.focus()}
        />
        <Field
          ref={emailRef}
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@hulog.ph"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          autoCorrect={false}
          returnKeyType="next"
          onSubmitEditing={() => phoneRef.current?.focus()}
        />
        <Field
          ref={phoneRef}
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          placeholder="+63 912 345 6789"
          keyboardType="phone-pad"
          autoComplete="tel"
          returnKeyType="done"
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
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="next"
          onSubmitEditing={() => newPasswordRef.current?.focus()}
        />
        <Field
          ref={newPasswordRef}
          label="New password"
          value={next}
          onChangeText={setNext}
          placeholder="At least 6 characters"
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
        />
        <Field
          ref={confirmRef}
          label="Confirm new password"
          value={confirm}
          onChangeText={setConfirm}
          placeholder="Repeat the new password"
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={() => void savePassword()}
        />
        <Button label="Change password" variant="secondary" onPress={savePassword} loading={pwBusy} />
      </Card>

      {/* Device notifications */}
      <Text style={styles.sectionTitle}>Notifications</Text>
      <Card style={styles.formCard}>
        <Text style={styles.notes}>
          Due dates, payments, and chat alerts appear in your phone’s notification tray. Tap one
          to open the related plan.
        </Text>
        {notifStatus === 'authorized' ? (
          <>
            <Button
              label="Send test notification"
              variant="secondary"
              onPress={testNotification}
              loading={notifBusy}
            />
            <Button
              label="Open notification settings"
              variant="ghost"
              onPress={() => void openNotificationSettings()}
            />
          </>
        ) : (
          <Button
            label="Enable notifications"
            onPress={enableNotifications}
            loading={notifBusy}
          />
        )}
      </Card>

      {/* Session */}
      <Text style={styles.sectionTitle}>Session</Text>
      <Card style={styles.formCard}>
        <Text style={styles.notes}>
          Your data is stored on the HulogTrack server and stays in sync between devices.
        </Text>
        <Button
          label="Sign out"
          variant="danger"
          icon="logout"
          onPress={() =>
            Alert.alert('Sign out?', 'You can sign in again anytime.', [
              {text: 'Cancel', style: 'cancel'},
              {text: 'Sign out', style: 'destructive', onPress: logout},
            ])
          }
        />
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
