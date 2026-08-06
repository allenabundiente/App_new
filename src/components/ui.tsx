/**
 * HulogTrack UI Kit — small, dependency-free building blocks.
 * Dark navy theme from ../theme. Every component is a plain RN component.
 */
import React, {useEffect, useRef, useState} from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import {colors, radius, spacing, typography} from '../theme';

/* ------------------------------- Screen ------------------------------- */

export function Screen({
  children,
  scroll,
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
}) {
  if (scroll) {
    return (
      <ScrollView
        style={[styles.screen, style]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
    );
  }
  return <View style={[styles.screen, style]}>{children}</View>;
}

/* -------------------------------- Card -------------------------------- */

export function Card({
  children,
  style,
  onPress,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  onPress?: () => void;
}) {
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper
      onPress={onPress}
      style={({pressed}) => [
        styles.card,
        style,
        onPress && pressed && styles.cardPressed,
      ]}
    >
      {children}
    </Wrapper>
  );
}

/* -------------------------------- Badge ------------------------------- */

const BADGE_COLORS: Record<string, {bg: string; fg: string}> = {
  active: {bg: colors.successSoft, fg: colors.success},
  overdue: {bg: colors.dangerSoft, fg: colors.danger},
  defaulted: {bg: colors.dangerSoft, fg: colors.danger},
  completed: {bg: colors.infoSoft, fg: colors.info},
  cancelled: {bg: colors.warnSoft, fg: colors.warn},
  pending: {bg: colors.warnSoft, fg: colors.warn},
  approved: {bg: colors.successSoft, fg: colors.success},
  rejected: {bg: colors.dangerSoft, fg: colors.danger},
  suspended: {bg: colors.dangerSoft, fg: colors.danger},
  paid: {bg: colors.successSoft, fg: colors.success},
  seller: {bg: colors.infoSoft, fg: colors.info},
  buyer: {bg: colors.successSoft, fg: colors.success},
  admin: {bg: colors.primarySoft, fg: colors.violet},
};

export function Badge({
  label,
  tone = 'active',
}: {
  label: string;
  tone?: string;
}) {
  const c = BADGE_COLORS[tone] ?? {bg: colors.surfaceAlt, fg: colors.textMuted};
  return (
    <View style={[styles.badge, {backgroundColor: c.bg}]}>
      <Text style={[styles.badgeText, {color: c.fg}]}>{label}</Text>
    </View>
  );
}

/* ------------------------------- Button ------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  small,
  icon,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  icon?: string;
  style?: ViewStyle;
}) {
  const bg: Record<ButtonVariant, string> = {
    primary: colors.primary,
    secondary: colors.surfaceAlt,
    danger: colors.danger,
    ghost: 'transparent',
    success: colors.success,
  };
  const fg: Record<ButtonVariant, string> = {
    primary: '#ffffff',
    secondary: colors.text,
    danger: '#ffffff',
    ghost: colors.primary,
    success: '#04120a',
  };
  const border: Record<ButtonVariant, string> = {
    primary: 'transparent',
    secondary: colors.borderStrong,
    danger: 'transparent',
    ghost: colors.primaryBorder,
    success: 'transparent',
  };
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({pressed}) => [
        styles.btn,
        small && styles.btnSmall,
        {backgroundColor: bg[variant], borderColor: border[variant]},
        (disabled || loading) && styles.btnDisabled,
        pressed && !disabled && styles.btnPressed,
        style,
      ]}
    >
      {loading ? (
        <Text style={[styles.btnLabel, small && styles.btnLabelSmall, {color: fg[variant]}]}>
          …loading
        </Text>
      ) : (
        <Text style={[styles.btnLabel, small && styles.btnLabelSmall, {color: fg[variant]}]}>
          {icon ? `${icon}  ` : ''}
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/* -------------------------------- Field ------------------------------- */

export function Field({
  label,
  hint,
  ...props
}: TextInputProps & {label: string; hint?: string}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textFaint}
        style={styles.fieldInput}
        {...props}
      />
      {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

/* ------------------------------ ChipSelect ---------------------------- */

export function ChipSelect({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{value: string; label: string}>;
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <View style={styles.chipWrap}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <View style={styles.chipRow}>
        {options.map(o => {
          const active = o.value === value;
          return (
            <Pressable
              key={o.value}
              onPress={() => onChange(o.value)}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* -------------------------------- Stat -------------------------------- */

export function Stat({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'good' | 'bad' | 'brand';
}) {
  const valColor =
    tone === 'good' ? colors.success : tone === 'bad' ? colors.danger : tone === 'brand' ? colors.violet : colors.text;
  return (
    <Card style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, {color: valColor}]}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </Card>
  );
}

/* ------------------------------- Avatar ------------------------------- */

const AVATAR_COLORS = ['#6d5ef2', '#38bdf8', '#22c55e', '#f59e0b', '#f43f5e', '#a78bfa'];

export function Avatar({name, size = 40}: {name: string; size?: number}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '')
    .join('');
  const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const bg = AVATAR_COLORS[hash % AVATAR_COLORS.length];
  return (
    <View
      style={[
        styles.avatar,
        {width: size, height: size, borderRadius: size / 2, backgroundColor: bg},
      ]}
    >
      <Text style={[styles.avatarText, {fontSize: size * 0.36}]}>{initials}</Text>
    </View>
  );
}

/* ------------------------------ ListRow ------------------------------- */

export function ListRow({
  emoji,
  title,
  subtitle,
  right,
  onPress,
  tone,
}: {
  emoji?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  tone?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({pressed}) => [styles.row, pressed && onPress && styles.rowPressed]}
    >
      {emoji ? (
        <View style={styles.rowEmoji}>
          <Text style={styles.rowEmojiText}>{emoji}</Text>
        </View>
      ) : null}
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.rowRight}>
        {tone ? <Badge label={tone} /> : null}
        {right}
      </View>
    </Pressable>
  );
}

/* ----------------------------- ProgressBar ---------------------------- */

export function ProgressBar({ratio, color}: {ratio: number; color?: string}) {
  const pct = Math.max(0, Math.min(1, ratio));
  return (
    <View style={styles.progressTrack}>
      <View
        style={[
          styles.progressFill,
          {width: `${pct * 100}%`, backgroundColor: color ?? colors.primary},
        ]}
      />
    </View>
  );
}

/* ------------------------------ Section ------------------------------- */

export function Section({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ----------------------------- EmptyState ----------------------------- */

export function EmptyState({emoji, title, subtitle}: {emoji: string; title: string; subtitle?: string}) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyEmoji}>{emoji}</Text>
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySub}>{subtitle}</Text> : null}
    </View>
  );
}

/* -------------------------------- Modal ------------------------------- */

export function Sheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.modalRoot}
      >
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={styles.sheetClose}>✕</Text>
            </Pressable>
          </View>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.sheetBody}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/* -------------------------------- Toast ------------------------------- */

type ToastKind = 'success' | 'error' | 'info';
let toastListener: ((msg: string, kind: ToastKind) => void) | null = null;

/** Fire-and-forget toast — call from anywhere, e.g. toast('Payment saved ✅'). */
export function toast(msg: string, kind: ToastKind = 'success') {
  toastListener?.(msg, kind);
}

export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  const [kind, setKind] = useState<ToastKind>('success');
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    toastListener = (m, k) => {
      setMsg(m);
      setKind(k);
      opacity.setValue(0);
      Animated.timing(opacity, {toValue: 1, duration: 180, useNativeDriver: true}).start();
      if (timer.current) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => {
        Animated.timing(opacity, {toValue: 0, duration: 260, useNativeDriver: true}).start(
          () => setMsg(null),
        );
      }, 2400);
    };
    return () => {
      toastListener = null;
      if (timer.current) {
        clearTimeout(timer.current);
      }
    };
  }, [opacity]);

  if (!msg) {
    return null;
  }
  const bg = kind === 'success' ? colors.success : kind === 'error' ? colors.danger : colors.info;
  return (
    <Animated.View pointerEvents="none" style={[styles.toast, {opacity, borderColor: bg}]}>
      <Text style={styles.toastText}>{msg}</Text>
    </Animated.View>
  );
}

/* ------------------------------- styles ------------------------------- */

const styles = StyleSheet.create({
  screen: {flex: 1, backgroundColor: colors.background},
  scrollContent: {padding: spacing.lg, paddingBottom: spacing.xxxl},

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  cardPressed: {opacity: 0.82, transform: [{scale: 0.99}]},

  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xxs + 1,
    borderRadius: radius.pill,
  },
  badgeText: {...typography.caption, fontWeight: '700'},

  btn: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  btnSmall: {minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.sm},
  btnDisabled: {opacity: 0.45},
  btnPressed: {opacity: 0.85, transform: [{scale: 0.99}]},
  btnLabel: {...typography.label, fontSize: 15, fontWeight: '700'},
  btnLabelSmall: {fontSize: 13},

  fieldWrap: {marginBottom: spacing.md},
  fieldLabel: {
    ...typography.label,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  fieldInput: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.md : spacing.sm,
    color: colors.text,
    fontSize: 15,
  },
  fieldHint: {...typography.caption, color: colors.textFaint, marginTop: spacing.xs},

  chipWrap: {marginBottom: spacing.md},
  chipRow: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceAlt,
  },
  chipActive: {backgroundColor: colors.primarySoft, borderColor: colors.primaryBorder},
  chipText: {...typography.label, color: colors.textMuted},
  chipTextActive: {color: colors.violet, fontWeight: '700'},

  stat: {flex: 1, minWidth: 140, gap: spacing.xxs},
  statLabel: {...typography.caption, color: colors.textMuted},
  statValue: {...typography.priceLarge},
  statSub: {...typography.caption, color: colors.textFaint},

  avatar: {alignItems: 'center', justifyContent: 'center'},
  avatarText: {color: '#ffffff', fontWeight: '800'},

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  rowPressed: {opacity: 0.85},
  rowEmoji: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowEmojiText: {fontSize: 22},
  rowBody: {flex: 1, gap: 2},
  rowTitle: {...typography.heading, color: colors.text},
  rowSubtitle: {...typography.caption, color: colors.textMuted, lineHeight: 17},
  rowRight: {alignItems: 'flex-end', gap: spacing.xs},

  progressTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  progressFill: {height: 6, borderRadius: radius.pill},

  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionTitle: {...typography.heading, color: colors.text},
  sectionAction: {...typography.label, color: colors.primary},

  empty: {alignItems: 'center', paddingVertical: spacing.xxxl, gap: spacing.sm},
  emptyEmoji: {fontSize: 44},
  emptyTitle: {...typography.heading, color: colors.text},
  emptySub: {...typography.body, color: colors.textMuted, textAlign: 'center'},

  modalRoot: {flex: 1, justifyContent: 'flex-end'},
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.overlay,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    maxHeight: '88%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    marginTop: spacing.sm,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  sheetTitle: {...typography.heading, color: colors.text},
  sheetClose: {color: colors.textMuted, fontSize: 18, fontWeight: '700'},
  sheetBody: {paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl},

  toast: {
    position: 'absolute',
    top: 60,
    alignSelf: 'center',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    maxWidth: '86%',
    zIndex: 999,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: {width: 0, height: 4},
    elevation: 8,
  },
  toastText: {...typography.label, color: colors.text},
});
