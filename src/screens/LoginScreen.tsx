import React, {useState} from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
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
import {Button, Field} from '../components/ui';
import {AssetIcon} from '../components/AssetIcon';
import {session} from '../storage/kv';
import {getApiUrl, setApiUrl} from '../api/client';

const DEMO = [
  {role: 'Admin', email: 'admin@hulog.ph', pass: 'admin123'},
  {role: 'Seller', email: 'seller@hulog.ph', pass: 'seller123'},
  {role: 'Buyer', email: 'buyer@hulog.ph', pass: 'buyer123'},
];

export function LoginScreen() {
  const {login, backendMode, setBackendMode} = useAppStore();
  const {mode, toggle} = useTheme();
  const styles = useThemedStyles(createStyles);
  const [email, setEmail] = useState(session.getLastEmail());
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [apiUrl, setApiUrlState] = useState(getApiUrl());

  const submit = async () => {
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

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.content}>
        <View style={styles.brand}>
          <View style={styles.logo}>
            <AssetIcon name="logo" size={52} rounded={18} />
          </View>
          <Text style={styles.title}>HulogTrack</Text>
          <Text style={styles.tagline}>
            Installment plans you can trust — sellers manage, buyers stay in the loop.
          </Text>
        </View>

        <View style={styles.form}>
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
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="Your password"
            secureTextEntry
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button label="Sign in" onPress={submit} loading={busy} />
          <Pressable onPress={() => setShowRegister(true)} style={styles.linkWrap}>
            <Text style={styles.link}>
              New here? <Text style={styles.linkStrong}>Create an account</Text>
            </Text>
          </Pressable>

          {/* Backend mode: local offline SQLite, or the free-tier cloud API */}
          <View style={styles.modeCard}>
            <View style={styles.modeRow}>
              <View style={styles.modeText}>
                <Text style={styles.modeTitle}>Cloud server {backendMode === 'cloud' ? 'ON' : 'OFF'}</Text>
                <Text style={styles.modeHint}>
                  {backendMode === 'cloud'
                    ? 'Data lives on the hosted API (see server/).'
                    : 'Data lives on this device (offline SQLite).'}
                </Text>
              </View>
              <Switch
                value={backendMode === 'cloud'}
                onValueChange={on => {
                  setBackendMode(on ? 'cloud' : 'local');
                  setError(null);
                }}
                trackColor={{false: styles.modeSwitchTrack.color, true: styles.modeSwitchOn.color}}
                thumbColor="#ffffff"
              />
            </View>
            {backendMode === 'cloud' ? (
              <Field
                label="API base URL"
                value={apiUrl}
                onChangeText={text => {
                  setApiUrlState(text);
                  setApiUrl(text);
                }}
                placeholder="https://your-api.onrender.com"
                autoCapitalize="none"
                autoCorrect={false}
                hint="For a physical phone, use your computer's LAN IP (http://192.168.x.x:4000) or the deployed URL."
              />
            ) : null}
          </View>

          {/* Appearance */}
          <Pressable onPress={toggle} style={styles.appearanceRow}>
            <View style={styles.appearanceText}>
              <Text style={styles.modeTitle}>Appearance</Text>
              <Text style={styles.modeHint}>
                {mode === 'dark' ? 'Dark mode (tap to switch to light)' : 'Light mode (tap to switch to dark)'}
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
      </KeyboardAvoidingView>
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

  const submit = async () => {
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
      // Registration always "fails" with the pending-verification notice.
      setMsg(res.reason);
      setError(null);
      return;
    }
    setMsg('Account created!');
  };

  return (
    <View style={styles.flex}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.content}>
        <View style={styles.form}>
          <Pressable onPress={onBack} hitSlop={10}>
            <Text style={styles.back}>‹ Back to sign in</Text>
          </Pressable>
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.tagline}>
            New accounts are verified by an admin before you can sign in.
          </Text>

          <Field label="Full name" value={name} onChangeText={setName} placeholder="Juan Dela Cruz" />
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@hulog.ph"
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="+63 912 345 6789" keyboardType="phone-pad" />
          <Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 6 characters" secureTextEntry />

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
      </KeyboardAvoidingView>
    </View>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    root: {flex: 1, backgroundColor: 'transparent'},
    flex: {flex: 1},
    content: {flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center'},
    brand: {alignItems: 'center', paddingTop: spacing.xxl * 2, paddingHorizontal: spacing.xl},
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
      backgroundColor: c.glassStrong,
      borderRadius: radius.xxl,
      borderWidth: 1,
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
    modeSwitchTrack: {color: c.surfaceAlt},
    modeSwitchOn: {color: c.primary},
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
