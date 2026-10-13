/**
 * GlassBlur - the frosted glass background behind the headers and bars.
 *
 * It uses @react-native-community/blur when the native module is available.
 * If it isn't linked yet (fresh clone before pod install / gradle sync) it
 * quietly falls back to a plain translucent surface so the app still looks
 * right. The require is wrapped in a try/catch because the native component
 * only exists after a rebuild.
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
  /** Position and size - usually StyleSheet.absoluteFill inside a container. */
  style?: StyleProp<ViewStyle>;
  /** How strong the blur is. Lower means subtler. */
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
