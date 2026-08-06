/**
 * HulogTrack — root component.
 *
 * Flow:
 *   AppStoreProvider → boots SQLite (schema + seed) in the store
 *   ├─ not ready → splash
 *   ├─ boot error → error screen with message
 *   ├─ no session → LoginScreen
 *   └─ session    → AppShell (tabs + stack)
 */
import React from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AppStoreProvider, useAppStore} from './src/store/AppStore';
import {ToastHost} from './src/components/ui';
import {LoginScreen} from './src/screens/LoginScreen';
import {AppShell} from './src/navigation/AppShell';
import {colors, typography} from './src/theme';

function Root() {
  const {ready, bootError, user} = useAppStore();

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
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

export default function App() {
  return (
    <SafeAreaProvider>
      <AppStoreProvider>
        <View style={styles.flex}>
          <Root />
          <ToastHost />
        </View>
      </AppStoreProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  flex: {flex: 1, backgroundColor: colors.background},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, gap: 12, padding: 32},
  bootText: {...typography.label, color: colors.textMuted},
  errorTitle: {...typography.title, color: colors.danger},
  errorBody: {...typography.body, color: colors.textMuted, textAlign: 'center'},
  errorHint: {...typography.caption, color: colors.textFaint, textAlign: 'center'},
});
