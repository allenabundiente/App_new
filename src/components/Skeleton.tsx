/**
 * Skeleton — shimmer-animated loading placeholders.
 *
 * Drop these in while data is in-flight so the user sees where content will
 * appear instead of a blank screen. Uses React Native's Animated API (no
 * extra deps) for the shimmer sweep.
 */
import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, View, type ViewStyle} from 'react-native';
import {radius, spacing, useTheme} from '../theme';

/* ----------------------- shimmer hook ----------------------- */

function useShimmer(): Animated.Value {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(v, {
        toValue: 1,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [v]);
  return v;
}

/* ----------------------- base bone ----------------------- */

function Bone({
  width,
  height = 14,
  borderRadius,
  style,
}: {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}) {
  const {colors} = useTheme();
  const shimmer = useShimmer();
  const br = borderRadius ?? radius.sm;
  return (
    <View
      style={[
        {width: width ?? '100%', height, borderRadius: br, overflow: 'hidden'},
        style,
      ]}>
      {/* Solid base */}
      <View
        style={[
          StyleSheet.absoluteFill,
          {backgroundColor: colors.surfaceAlt},
        ]}
      />
      {/* Moving highlight */}
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: colors.border,
            opacity: shimmer.interpolate({
              inputRange: [0, 0.5, 1],
              outputRange: [0.3, 0.7, 0.3],
            }),
            transform: [
              {
                translateX: shimmer.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-120, 200],
                }),
              },
            ],
          },
        ]}
      />
    </View>
  );
}

/* ----------------------- composite skeletons ----------------------- */

/** A single list row placeholder — matches ListRow geometry. */
export function SkeletonRow({style}: {style?: ViewStyle}) {
  return (
    <View style={[skeletonStyles.row, style]}>
      <Bone width={44} height={44} borderRadius={radius.md} />
      <View style={skeletonStyles.rowBody}>
        <Bone width="72%" height={14} />
        <Bone width="48%" height={10} style={{marginTop: 6}} />
      </View>
      <Bone width={56} height={20} borderRadius={radius.pill} />
    </View>
  );
}

/** A stat card placeholder — matches the Stat component geometry. */
export function SkeletonStat({style}: {style?: ViewStyle}) {
  return (
    <View style={[skeletonStyles.card, skeletonStyles.statCard, style]}>
      <Bone width="55%" height={10} />
      <Bone width="40%" height={22} style={{marginTop: 8}} />
      <Bone width="70%" height={10} style={{marginTop: 6}} />
    </View>
  );
}

/** A hero card placeholder — matches the GradientCard hero sections. */
export function SkeletonHero({style}: {style?: ViewStyle}) {
  const {colors} = useTheme();
  return (
    <View style={[skeletonStyles.heroCard, {borderColor: colors.borderStrong}, style]}>
      <View style={skeletonStyles.heroTop}>
        <View style={{flex: 1, gap: 8}}>
          <Bone width="65%" height={18} />
          <Bone width="85%" height={12} />
        </View>
        <Bone width={84} height={84} borderRadius={42} />
      </View>
      <View style={skeletonStyles.heroActions}>
        <Bone width={100} height={36} borderRadius={radius.md} />
        <Bone width={100} height={36} borderRadius={radius.md} />
      </View>
    </View>
  );
}

/** Full home-screen skeleton — hero + stats + rows. */
export function SkeletonHome({rows = 4}: {rows?: number}) {
  return (
    <View style={skeletonStyles.screen}>
      <SkeletonHero />
      <View style={skeletonStyles.statRow}>
        <SkeletonStat />
        <SkeletonStat />
      </View>
      <View style={skeletonStyles.statRow}>
        <SkeletonStat />
        <SkeletonStat />
      </View>
      {Array.from({length: rows}).map((_, i) => (
        <SkeletonRow key={i} style={{marginBottom: spacing.sm}} />
      ))}
    </View>
  );
}

/** List-only skeleton (for screens that are just a list). */
export function SkeletonList({count = 5, style}: {count?: number; style?: ViewStyle}) {
  return (
    <View style={[skeletonStyles.screen, style]}>
      {Array.from({length: count}).map((_, i) => (
        <SkeletonRow key={i} style={{marginBottom: spacing.sm}} />
      ))}
    </View>
  );
}

const skeletonStyles = StyleSheet.create({
  screen: {
    padding: spacing.lg,
    paddingTop: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: spacing.md,
    gap: spacing.md,
  },
  rowBody: {flex: 1, gap: 2},
  card: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: spacing.lg,
  },
  statCard: {flex: 1, minWidth: 140},
  heroCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  heroTop: {flexDirection: 'row', alignItems: 'center', gap: spacing.lg},
  heroActions: {flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg},
  statRow: {flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg},
});
