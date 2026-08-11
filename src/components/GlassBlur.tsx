/**
 * GlassBlur — real iOS liquid-glass backdrop blur.
 *
 * Uses `@react-native-community/blur` when its native module is linked and
 * silently falls back to the plain translucent `glassStrong` surface
 * otherwise (fresh clone before `pod install` / gradle sync, or an
 * environment without the native side). That keeps the app usable in every
 * state: blur is a progressive enhancement, never a hard dependency.
 *
 * The require is guarded because the native component only registers after a
 * native rebuild; the error boundary catches the rare case where the module
 * loads but rendering fails (e.g. disabled/unsupported platform).
 */
import React from 'react';
import {StyleProp, StyleSheet, View, ViewStyle} from 'react-native';
import {useTheme} from '../theme';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let BlurView: React.ComponentType<any> | null = null;
try {
  BlurView = require('@react-native-community/blur').BlurView ?? null;
} catch {
  BlurView = null;
}

class BlurBoundary extends React.Component<
  {fallback: React.ReactNode; children: React.ReactNode},
  {failed: boolean}
> {
  state = {failed: false};
  static getDerivedStateFromError() {
    return {failed: true};
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function GlassBlur({
  style,
  intensity = 28,
  children,
}: {
  /** Position/size — usually `StyleSheet.absoluteFill` inside a container. */
  style?: StyleProp<ViewStyle>;
  /** Blur strength (blurAmount). Lower = subtler, cheaper. */
  intensity?: number;
  children?: React.ReactNode;
}) {
  const {mode, colors} = useTheme();
  const fallback = (
    <View style={[style, {backgroundColor: colors.glassStrong}]}>{children}</View>
  );
  if (!BlurView) {
    return fallback;
  }
  return (
    <BlurBoundary fallback={fallback}>
      <BlurView
        style={style}
        blurType={mode === 'dark' ? 'dark' : 'xlight'}
        blurAmount={intensity}
        reducedTransparencyFallbackColor={colors.glassStrong}
      >
        {children}
      </BlurView>
    </BlurBoundary>
  );
}
