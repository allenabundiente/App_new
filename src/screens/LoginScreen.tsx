import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Pressable, StyleSheet, Text, TextInput, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {useAppStore} from '../store/AppStore';
import {
  radius,
  spacing,
  typography,
  useTheme,
  useThemedStyles,
  type Palette,
} from '../theme';
import {Button, Field, GradientCardLight} from '../components/ui';
import {GlassBlur} from '../components/GlassBlur';
import {AssetIcon} from '../components/AssetIcon';
import {BrandLogo} from '../components/BrandLogo';
import {KeyboardAwareScreen} from '../components/KeyboardAware';
import {session} from '../storage/kv';
import {checkServer, getApiUrl, setApiUrl} from '../db/dataAccess';

const DEMO = [
  {role: 'Admin', email: 'admin@hulog.ph', pass: 'admin123'},
  {role: 'Seller', email: 'seller@hulog.ph', pass: 'seller123'},
  {role: 'Buyer', email: 'buyer@hulog.ph', pass: 'buyer123'},
];

type ServerStatus = 'checking' | 'online' | 'offline';

export function LoginScreen() {
  const {login} = useAppStore();
  const {colors, mode, toggle} = useTheme();
  const styles = useThemedStyles(createStyles);
  const [email, setEmail] = useState(session.getLastEmail());
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [apiUrl, setApiUrlState] = useState(getApiUrl());
  const [serverStatus, setServerStatus] = useState<ServerStatus>('checking');
  const passwordRef = useRef<TextInput>(null);

  const refreshStatus = useCallback(async () => {
    setServerStatus('checking');
    const ok = await checkServer();
    setServerStatus(ok ? 'online' : 'offline');
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Keep checking quietly while the server is down, so the card recovers on
  // its own when the connection comes back.
  useEffect(() => {
    if (serverStatus !== 'offline') {
      return;
    }
    const id = setInterval(() => {
      void refreshStatus();
    }, 15000);
    return () => clearInterval(id);
  }, [serverStatus, refreshStatus]);

  const submit = async () => {
    if (busy) {
      return;
    }
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await login(email, password);
    setBusy(false);
    if (!res.ok) {
      setError(res.reason);
    }
  };

  if (showRegister) {
    return <RegisterScreen onBack={() => setShowRegister(false)} />;
  }

  const statusColor =
    serverStatus === 'online'
      ? colors.success
      : serverStatus === 'offline'
        ? colors.danger
        : colors.warn;
  const statusText =
    serverStatus === 'online'
      ? 'Online'
      : serverStatus === 'offline'
        ? 'Offline'
        : 'Checking…';

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAwareScreen contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <GradientCardLight stops={colors.cardGradientBrand} style={styles.brandCard}>
            <View style={styles.brand}>
              <View style={styles.logo}>
                <BrandLogo size={56} />
              </View>
              <Text style={styles.title}>HulogTrack</Text>
              <Text style={styles.tagline}>
                Installment plans you can trust — sellers manage, buyers stay in the loop.
              </Text>
            </View>
          </GradientCardLight>

          <View style={styles.form}>
            <GlassBlur style={StyleSheet.absoluteFill} intensity={34} />
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@hulog.ph"
              autoCapitalize="none"
              keyboardType="email-address"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            <Field
              ref={passwordRef}
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="Your password"
              secureTextEntry
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label="Sign in" onPress={submit} loading={busy} />
            <Pressable onPress={() => setShowRegister(true)} style={styles.linkWrap}>
              <Text style={styles.link}>
                New here? <Text style={styles.linkStrong}>Create an account</Text>
              </Text>
            </Pressable>

            {/* The server is always on. This card only reports whether the
                app can reach it and lets you fix the address if needed. */}
            <View style={styles.modeCard}>
              <View style={styles.modeRow}>
                <View style={styles.modeText}>
                  <Text style={styles.modeTitle}>Server</Text>
                  <Text style={styles.modeHint}>
                    {serverStatus === 'online'
                      ? 'Connected — your data is stored on the hosted API.'
                      : serverStatus === 'offline'
                        ? 'Not reachable right now. Sign-in will fail until it reconnects.'
                        : 'Checking the connection…'}
                  </Text>
                </View>
                <View style={styles.statusWrap}>
                  <View style={[styles.statusDot, {backgroundColor: statusColor}]} />
                  <Text style={[styles.statusText, {color: statusColor}]}>{statusText}</Text>
                </View>
              </View>
              <Field
                label="Server address"
                value={apiUrl}
                onChangeText={setApiUrlState}
                onBlur={() => {
                  setApiUrl(apiUrl);
                  void refreshStatus();
                }}
                placeholder="https://your-api.onrender.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="done"
                hint="The app reconnects automatically every 15 seconds while this is unreachable."
              />
              {serverStatus === 'offline' ? (
                <Button
                  label="Retry connection"
                  icon="schedule"
                  variant="secondary"
                  small
                  onPress={() => {
                    setApiUrl(apiUrl);
                    void refreshStatus();
                  }}
                />
              ) : null}
            </View>

            {/* Appearance */}
            <Pressable onPress={toggle} style={styles.appearanceRow}>
              <View style={styles.appearanceText}>
                <Text style={styles.modeTitle}>Appearance</Text>
                <Text style={styles.modeHint}>
                  {mode === 'dark'
                    ? 'Dark mode (tap to switch to light)'
                    : 'Light mode (tap to switch to dark)'}
                </Text>
              </View>
              <AssetIcon name="theme" size={22} rounded={8} />
            </Pressable>
          </View>

          <View style={styles.demo}>
            <Text style={styles.demoTitle}>Demo accounts — tap to fill</Text>
            {DEMO.map(d => (
              <Pressable
                key={d.role}
                style={styles.demoRow}
                onPress={() => {
                  setEmail(d.email);
                  setPassword(d.pass);
                  setError(null);
                }}
              >
                <Text style={styles.demoRole}>{d.role}</Text>
                <Text style={styles.demoCred} numberOfLines={1}>
                  {d.email} · {d.pass}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </KeyboardAwareScreen>
    </SafeAreaView>
  );
}

function RegisterScreen({onBack}: {onBack: () => void}) {
  const {register} = useAppStore();
  const styles = useThemedStyles(createStyles);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'buyer' | 'seller'>('buyer');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const submit = async () => {
    if (busy) {
      return;
    }
    if (!name.trim() || !email.trim() || password.length < 6) {
      setError('Fill all fields — password needs at least 6 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    const res = await register({name, email, password, phone, role});
    setBusy(false);
    if (!res.ok) {
      // Signing up always comes back with the "waiting for verification"
      // message instead of logging the user in.
      setMsg(res.reason);
      setError(null);
      return;
    }
    setMsg('Account created!');
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAwareScreen contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <View style={styles.form}>
            <Pressable onPress={onBack} hitSlop={10}>
              <Text style={styles.back}>‹ Back to sign in</Text>
            </Pressable>
            <Text style={styles.title}>Create account</Text>
            <Text style={styles.tagline}>
              New accounts are verified by an admin before you can sign in.
            </Text>

            <Field
              label="Full name"
              value={name}
              onChangeText={setName}
              placeholder="Juan Dela Cruz"
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
              textContentType="emailAddress"
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
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
            <Field
              ref={passwordRef}
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="At least 6 characters"
              secureTextEntry
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
            />

            <View style={styles.roleRow}>
              {(['buyer', 'seller'] as const).map(r => (
                <Pressable
                  key={r}
                  onPress={() => setRole(r)}
                  style={[styles.roleChip, role === r && styles.roleChipActive]}
                >
                  <Text style={[styles.roleText, role === r && styles.roleTextActive]}>
                    {r === 'buyer' ? "I'm a buyer" : "I'm a seller"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {msg ? <Text style={styles.success}>{msg}</Text> : null}
            <Button label="Create account" onPress={submit} loading={busy} />
          </View>
        </View>
      </KeyboardAwareScreen>
    </SafeAreaView>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    root: {flex: 1, backgroundColor: 'transparent'},
    flex: {flex: 1},
    scroll: {flexGrow: 1},
    content: {flexGrow: 1, width: '100%', maxWidth: 560, alignSelf: 'center', paddingBottom: spacing.xl},
    brandCard: {marginTop: spacing.xxl * 2, marginHorizontal: spacing.xl},
    brand: {alignItems: 'center', paddingVertical: spacing.xl, paddingHorizontal: spacing.xs},
    logo: {
      width: 76,
      height: 76,
      borderRadius: 24,
      backgroundColor: c.glassStrong,
      borderWidth: 1,
      borderColor: c.primaryBorder,
      borderTopColor: c.shine,
      shadowColor: c.shadow,
      shadowOpacity: 0.25,
      shadowRadius: 18,
      shadowOffset: {width: 0, height: 8},
      elevation: 6,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.lg,
      overflow: 'hidden',
    },
    title: {...typography.title, color: c.text},
    tagline: {
      ...typography.body,
      color: c.textMuted,
      textAlign: 'center',
      marginTop: spacing.sm,
      paddingHorizontal: spacing.lg,
    },
    form: {
      padding: spacing.xl,
      gap: spacing.xs,
      marginTop: spacing.xl,
      borderRadius: radius.xxl,
      borderWidth: 1,
      overflow: 'hidden',
      borderColor: c.border,
      borderTopColor: c.shine,
      shadowColor: c.shadow,
      shadowOpacity: 0.2,
      shadowRadius: 24,
      shadowOffset: {width: 0, height: 12},
      elevation: 6,
    },
    error: {
      ...typography.label,
      color: c.danger,
      backgroundColor: c.dangerSoft,
      padding: spacing.md,
      borderRadius: radius.md,
      marginBottom: spacing.sm,
    },
    success: {
      ...typography.label,
      color: c.success,
      backgroundColor: c.successSoft,
      padding: spacing.md,
      borderRadius: radius.md,
      marginBottom: spacing.sm,
    },
    linkWrap: {alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.xs},
    link: {...typography.label, color: c.textMuted},
    linkStrong: {color: c.primary, fontWeight: '700'},
    back: {...typography.label, color: c.primary, marginBottom: spacing.sm},
    modeCard: {
      marginTop: spacing.xl,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderTopColor: c.shine,
      borderRadius: radius.lg,
      padding: spacing.md,
    },
    modeRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'},
    modeText: {flex: 1, paddingRight: spacing.md},
    modeTitle: {...typography.label, color: c.text},
    modeHint: {...typography.caption, color: c.textMuted, marginTop: 2},
    statusWrap: {flexDirection: 'row', alignItems: 'center', gap: spacing.xs},
    statusDot: {width: 8, height: 8, borderRadius: 4},
    statusText: {...typography.caption, fontWeight: '700'},
    appearanceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.md,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderTopColor: c.shine,
      borderRadius: radius.lg,
      padding: spacing.md,
    },
    appearanceText: {flex: 1, paddingRight: spacing.md},
    demo: {
      marginTop: 'auto',
      padding: spacing.lg,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    demoTitle: {
      ...typography.caption,
      color: c.textFaint,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: spacing.sm,
    },
    demoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      marginBottom: spacing.sm,
    },
    demoRole: {
      ...typography.label,
      color: c.violet,
      backgroundColor: c.primarySoft,
      paddingHorizontal: spacing.sm,
      paddingVertical: 2,
      borderRadius: radius.sm,
      minWidth: 52,
      textAlign: 'center',
    },
    demoCred: {...typography.caption, color: c.textMuted, flex: 1},
    roleRow: {flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg},
    roleChip: {
      flex: 1,
      paddingVertical: spacing.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      borderTopColor: c.shine,
      backgroundColor: c.surfaceAlt,
      alignItems: 'center',
    },
    roleChipActive: {backgroundColor: c.primarySoft, borderColor: c.primaryBorder},
    roleText: {...typography.label, color: c.textMuted},
    roleTextActive: {color: c.violet, fontWeight: '700'},
  });
