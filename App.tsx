/**
 * HulogTrack — root component.
 *
 * Flow:
 *   ThemeProvider → AppStoreProvider → boots SQLite (schema + seed) in the store
 *   ├─ not ready → splash (branded with pulsing animation)
 *   ├─ boot error → error screen with message
 *   ├─ no session → LoginScreen
 *   └─ session    → AppShell (tabs + stack)
 */
import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, Text, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AppStoreProvider, useAppStore} from './src/store/AppStore';
import {AuroraBackground, ToastHost} from './src/components/ui';
import {LoginScreen} from './src/screens/LoginScreen';
import {AppShell} from './src/navigation/AppShell';
import {ThemeProvider, typography, useThemedStyles, type Palette} from './src/theme';
import {AssetIcon} from './src/components/AssetIcon';

/** Branded splash shown while SQLite boots — pulsing logo + fade-in text. */
function Splash() {
  const styles = useThemedStyles(createStyles);
  const pulse = useRef(new Animated.Value(1)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Gentle pulse on the logo.
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.06,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    ).start();

    // Fade in the text after a short delay.
    Animated.timing(fadeIn, {
      toValue: 1,
      duration: 500,
      delay: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [pulse, fadeIn]);

  return (
    <View style={styles.splashRoot}>
      <Animated.View style={{transform: [{scale: pulse}]}}>
        <View style={styles.splashLogo}>
          <AssetIcon name="logo" size={52} rounded={18} />
        </View>
      </Animated.View>
      <Animated.View style={[styles.splashTextWrap, {opacity: fadeIn}]}>
        <Text style={styles.splashTitle}>HulogTrack</Text>
        <Text style={styles.splashSub}>Loading your data…</Text>
      </Animated.View>
    </View>
  );
}

function Root() {
  const {ready, bootError, user} = useAppStore();
  const styles = useThemedStyles(createStyles);

  if (!ready) {
    return <Splash />;
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
    splashRoot: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
      gap: 20,
    },
    splashLogo: {
      width: 80,
      height: 80,
      borderRadius: 24,
      backgroundColor: c.glassStrong,
      borderWidth: 1,
      borderColor: c.primaryBorder,
      borderTopColor: c.shine,
      shadowColor: c.shadow,
      shadowOpacity: 0.3,
      shadowRadius: 24,
      shadowOffset: {width: 0, height: 10},
      elevation: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    splashTextWrap: {alignItems: 'center', gap: 6},
    splashTitle: {...typography.title, color: c.text},
    splashSub: {...typography.label, color: c.textMuted},
    errorTitle: {...typography.title, color: c.danger},
    errorBody: {...typography.body, color: c.textMuted, textAlign: 'center'},
    errorHint: {...typography.caption, color: c.textFaint, textAlign: 'center'},
  });
