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

/* --------------- detail screen skeletons --------------- */

/** Plan detail skeleton — hero card + due card + action bar + schedule rows. */
export function SkeletonPlanDetail({scheduleCount = 6}: {scheduleCount?: number}) {
  return (
    <View style={skeletonStyles.screen}>
      {/* Hero card */}
      <View style={skeletonStyles.card}>
        <View style={skeletonStyles.planHeroTop}>
          <Bone width={48} height={48} borderRadius={14} />
          <View style={{flex: 1, gap: 6}}>
            <Bone width="60%" height={16} />
            <Bone width="80%" height={10} />
          </View>
          <Bone width={60} height={22} borderRadius={radius.pill} />
        </View>
        <View style={skeletonStyles.planStats}>
          <View style={{flex: 1, gap: 4}}>
            <Bone width="70%" height={16} />
            <Bone width="50%" height={10} />
          </View>
          <View style={{flex: 1, gap: 4}}>
            <Bone width="70%" height={16} />
            <Bone width="50%" height={10} />
          </View>
          <View style={{flex: 1, gap: 4}}>
            <Bone width="70%" height={16} />
            <Bone width="50%" height={10} />
          </View>
        </View>
        <Bone height={6} borderRadius={3} style={{marginTop: spacing.sm}} />
        <Bone width="90%" height={10} style={{marginTop: spacing.md}} />
      </View>

      {/* Due card */}
      <View style={[skeletonStyles.card, {marginTop: spacing.md}]}>
        <Bone width="60%" height={12} />
        <Bone width="40%" height={24} style={{marginTop: 6}} />
        <Bone width="75%" height={10} style={{marginTop: 6}} />
      </View>

      {/* Action buttons */}
      <View style={skeletonStyles.planActions}>
        <Bone height={44} borderRadius={radius.md} style={{flex: 1}} />
        <Bone height={44} borderRadius={radius.md} style={{flex: 1}} />
      </View>

      {/* Schedule section header */}
      <Bone width="50%" height={14} style={{marginTop: spacing.xl, marginBottom: spacing.sm}} />

      {/* Schedule rows */}
      {Array.from({length: scheduleCount}).map((_, i) => (
        <View key={i} style={[skeletonStyles.row, {marginBottom: spacing.sm}]}>
          <Bone width={28} height={28} borderRadius={14} />
          <View style={skeletonStyles.rowBody}>
            <Bone width="55%" height={12} />
            <Bone width="80%" height={10} style={{marginTop: 4}} />
          </View>
          <Bone width={60} height={14} borderRadius={radius.sm} />
        </View>
      ))}
    </View>
  );
}

/** Receipt skeleton — a centered receipt card. */
export function SkeletonReceipt() {
  return (
    <View style={skeletonStyles.receiptScreen}>
      <View style={skeletonStyles.receiptCard}>
        <Bone width="40%" height={14} />
        <Bone width="65%" height={10} style={{marginTop: 4}} />
        <Bone width="55%" height={10} style={{marginTop: 2}} />
        <View style={skeletonStyles.receiptDivider} />
        <Bone width="45%" height={10} style={{marginTop: 4}} />
        <Bone width="35%" height={20} style={{marginTop: 6}} />
        <Bone width="30%" height={10} style={{marginTop: 4}} />
        <View style={skeletonStyles.receiptDivider} />
        {Array.from({length: 4}).map((_, i) => (
          <View key={i} style={skeletonStyles.receiptRow}>
            <Bone width="30%" height={12} />
            <Bone width="25%" height={12} />
          </View>
        ))}
        <View style={skeletonStyles.receiptDivider} />
        <View style={skeletonStyles.receiptRow}>
          <Bone width="25%" height={16} />
          <Bone width="30%" height={16} />
        </View>
        <View style={skeletonStyles.receiptDivider} />
        <Bone width="60%" height={12} style={{marginTop: 8}} />
        <Bone width="45%" height={10} style={{marginTop: 6}} />
      </View>
    </View>
  );
}

/** Profile skeleton — identity card + form fields. */
export function SkeletonProfile() {
  return (
    <View style={skeletonStyles.screen}>
      {/* Identity card */}
      <View style={skeletonStyles.profileIdentity}>
        <Bone width={64} height={64} borderRadius={32} />
        <View style={{flex: 1, gap: 6}}>
          <Bone width="50%" height={18} />
          <Bone width="30%" height={10} />
          <Bone width="25%" height={10} />
        </View>
      </View>

      {/* Section header */}
      <Bone width="25%" height={14} style={{marginTop: spacing.xl, marginBottom: spacing.sm}} />

      {/* Form card */}
      <View style={skeletonStyles.card}>
        {Array.from({length: 4}).map((_, i) => (
          <View key={i} style={{marginBottom: spacing.md}}>
            <Bone width="28%" height={10} />
            <Bone height={40} borderRadius={radius.md} style={{marginTop: spacing.xs}} />
          </View>
        ))}
        <Bone height={44} borderRadius={radius.md} />
      </View>

      {/* Password section */}
      <Bone width="22%" height={14} style={{marginTop: spacing.xl, marginBottom: spacing.sm}} />
      <View style={skeletonStyles.card}>
        {Array.from({length: 3}).map((_, i) => (
          <View key={i} style={{marginBottom: spacing.md}}>
            <Bone width="32%" height={10} />
            <Bone height={40} borderRadius={radius.md} style={{marginTop: spacing.xs}} />
          </View>
        ))}
        <Bone height={44} borderRadius={radius.md} />
      </View>
    </View>
  );
}

/** New plan form skeleton — chips + fields + preview. */
export function SkeletonNewPlan() {
  return (
    <View style={skeletonStyles.screen}>
      {/* Chip selects */}
      <Bone width="20%" height={10} style={{marginBottom: spacing.sm}} />
      <View style={skeletonStyles.chipRow}>
        <Bone width={80} height={32} borderRadius={radius.pill} />
        <Bone width={70} height={32} borderRadius={radius.pill} />
        <Bone width={90} height={32} borderRadius={radius.pill} />
      </View>

      <Bone width="18%" height={10} style={{marginTop: spacing.md, marginBottom: spacing.sm}} />
      <View style={skeletonStyles.chipRow}>
        <Bone width={75} height={32} borderRadius={radius.pill} />
        <Bone width={85} height={32} borderRadius={radius.pill} />
        <Bone width={65} height={32} borderRadius={radius.pill} />
      </View>

      {/* Price + down payment fields */}
      <View style={skeletonStyles.fieldRow}>
        <View style={{flex: 1}}>
          <Bone width="35%" height={10} />
          <Bone height={40} borderRadius={radius.md} style={{marginTop: spacing.xs}} />
        </View>
        <View style={{flex: 1}}>
          <Bone width="40%" height={10} />
          <Bone height={40} borderRadius={radius.md} style={{marginTop: spacing.xs}} />
        </View>
      </View>

      {/* APR + Term chips */}
      <View style={skeletonStyles.fieldRow}>
        <View style={{flex: 1}}>
          <Bone width="15%" height={10} style={{marginBottom: spacing.sm}} />
          <View style={skeletonStyles.chipRow}>
            <Bone width={40} height={28} borderRadius={radius.pill} />
            <Bone width={45} height={28} borderRadius={radius.pill} />
            <Bone width={40} height={28} borderRadius={radius.pill} />
          </View>
        </View>
        <View style={{flex: 1}}>
          <Bone width="15%" height={10} style={{marginBottom: spacing.sm}} />
          <View style={skeletonStyles.chipRow}>
            <Bone width={45} height={28} borderRadius={radius.pill} />
            <Bone width={35} height={28} borderRadius={radius.pill} />
            <Bone width={40} height={28} borderRadius={radius.pill} />
          </View>
        </View>
      </View>

      {/* Preview card */}
      <View style={[skeletonStyles.card, {marginTop: spacing.lg}]}>
        <Bone width="25%" height={14} />
        {Array.from({length: 4}).map((_, i) => (
          <View key={i} style={skeletonStyles.receiptRow}>
            <Bone width="35%" height={12} />
            <Bone width="25%" height={12} />
          </View>
        ))}
      </View>

      <Bone height={44} borderRadius={radius.md} style={{marginTop: spacing.lg}} />
    </View>
  );
}

/** Chat bubble skeleton — alternating left/right bubbles. */
export function SkeletonChatBubbles() {
  const {colors} = useTheme();
  return (
    <View style={skeletonStyles.chatWrap}>
      <View style={[skeletonStyles.chatBubble, {alignSelf: 'flex-start', backgroundColor: colors.surfaceAlt}]}> 
        <Bone width={140} height={14} borderRadius={8} />
        <Bone width={90} height={14} borderRadius={8} style={{marginTop: 6}} />
      </View>
      <View style={[skeletonStyles.chatBubble, {alignSelf: 'flex-end', backgroundColor: colors.primarySoft}]}> 
        <Bone width={110} height={14} borderRadius={8} />
      </View>
      <View style={[skeletonStyles.chatBubble, {alignSelf: 'flex-start', backgroundColor: colors.surfaceAlt}]}> 
        <Bone width={170} height={14} borderRadius={8} />
        <Bone width={130} height={14} borderRadius={8} style={{marginTop: 6}} />
        <Bone width={80} height={14} borderRadius={8} style={{marginTop: 6}} />
      </View>
      <View style={[skeletonStyles.chatBubble, {alignSelf: 'flex-end', backgroundColor: colors.primarySoft}]}> 
        <Bone width={100} height={14} borderRadius={8} />
        <Bone width={140} height={14} borderRadius={8} style={{marginTop: 6}} />
      </View>
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
  // Plan detail
  planHeroTop: {flexDirection: 'row', alignItems: 'center', gap: spacing.md},
  planStats: {flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.md},
  planActions: {flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md},
  // Receipt
  receiptScreen: {flex: 1, padding: spacing.lg, alignItems: 'center', paddingTop: spacing.lg},
  receiptCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.xs,
  },
  receiptDivider: {
    width: '100%',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    marginVertical: spacing.sm,
    borderStyle: 'dashed',
  },
  receiptRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  // Profile
  profileIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: spacing.lg,
  },
  // New plan
  fieldRow: {flexDirection: 'row', gap: spacing.md, marginTop: spacing.md},
  chipRow: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  // Chat
  chatWrap: {gap: spacing.sm, marginBottom: spacing.md},
  chatBubble: {
    maxWidth: '80%',
    borderRadius: radius.lg,
    padding: spacing.md,
  },
});
