/**
 * HulogTrack — root component.
 *
 * Flow:
 *   ThemeProvider → AppStoreProvider → boots SQLite (schema + seed) in the store
 *   ├─ not ready → splash
 *   ├─ boot error → error screen with message
 *   ├─ no session → LoginScreen
 *   └─ session    → AppShell (tabs + stack)
 */
import React from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AppStoreProvider, useAppStore} from './src/store/AppStore';
import {AuroraBackground, ToastHost} from './src/components/ui';
import {LoginScreen} from './src/screens/LoginScreen';
import {AppShell} from './src/navigation/AppShell';
import {ThemeProvider, typography, useThemedStyles, type Palette} from './src/theme';

function Root() {
  const {ready, bootError, user} = useAppStore();
  const styles = useThemedStyles(createStyles);

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={styles.bootSpinner.color} />
        <Text style={styles.bootText}>Opening HulogTrack…</Text>
      </View>
    );
  }

  if (bootError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Database error</Text>
        <Text style={styles.errorBody}>{bootError}</Text>
        <Text style={styles.errorHint}>
          Try restarting the app. On a fresh install the database is created
          automatically.
        </Text>
      </View>
    );
  }

  return user ? <AppShell /> : <LoginScreen />;
}

/** Rendered INSIDE <ThemeProvider> so the themed wrapper style is legal. */
function AppInner() {
  const styles = useThemedStyles(createStyles);
  return (
    <AppStoreProvider>
      <View style={styles.flex}>
        <AuroraBackground />
        <View style={styles.flex}>
          <Root />
          <ToastHost />
        </View>
      </View>
    </AppStoreProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppInner />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const createStyles = (c: Palette) =>
  StyleSheet.create({
    flex: {flex: 1, backgroundColor: 'transparent'},
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
      gap: 12,
      padding: 32,
    },
    bootSpinner: {color: c.primary},
    bootText: {...typography.label, color: c.textMuted},
    errorTitle: {...typography.title, color: c.danger},
    errorBody: {...typography.body, color: c.textMuted, textAlign: 'center'},
    errorHint: {...typography.caption, color: c.textFaint, textAlign: 'center'},
  });
