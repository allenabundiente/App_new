/**
 * App.tsx - the root component.
 * Loads the theme, then the store (which restores the session and loads the
 * API data), then shows the splash, the login screen or the main shell.
 */
import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, Text, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AppStoreProvider, useAppStore} from './src/store/AppStore';
import {AuroraBackground, ToastHost} from './src/components/ui';
import {LoginScreen} from './src/screens/LoginScreen';
import {AppShell} from './src/navigation/AppShell';
import {ThemeProvider, typography, useThemedStyles, type Palette} from './src/theme';
import {BrandLogo} from './src/components/BrandLogo';

/** Loading screen shown while the saved session and API data load. */
function Splash() {
  const styles = useThemedStyles(createStyles);
  const pulse = useRef(new Animated.Value(1)).current;
  const fadeIn = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Make the logo pulse slowly.
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

    // Fade the text in after a short wait.
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
          <BrandLogo size={52} />
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
  const {ready, user} = useAppStore();

  if (!ready) {
    return <Splash />;
  }

  return user ? <AppShell /> : <LoginScreen />;
}

/** Has to sit inside ThemeProvider so useThemedStyles works. */
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
      overflow: 'hidden',
    },
    splashTextWrap: {alignItems: 'center', gap: 6},
    splashTitle: {...typography.title, color: c.text},
    splashSub: {...typography.label, color: c.textMuted},
  });
