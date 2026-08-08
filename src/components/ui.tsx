/**
 * HulogTrack UI Kit — small, dependency-free building blocks.
 * Themed via useThemedStyles; icons are semantic AssetIcon placeholders
 * (see src/components/AssetIcon.tsx and src/assets/manifest.ts).
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
import {radius, spacing, typography, useTheme, useThemedStyles, type Palette} from '../theme';
import {AssetIcon} from './AssetIcon';

/* ------------------------------- Screen ------------------------------- */

const createStyles = (c: Palette) =>
  StyleSheet.create({
    screen: {flex: 1, backgroundColor: c.background},
    scrollContent: {padding: spacing.lg, paddingBottom: spacing.xxxl},

    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
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
    btnInner: {flexDirection: 'row', alignItems: 'center', gap: spacing.sm},
    btnLabel: {...typography.label, fontSize: 15, fontWeight: '700'},
    btnLabelSmall: {fontSize: 13},

    fieldWrap: {marginBottom: spacing.md},
    fieldLabel: {
      ...typography.label,
      color: c.textMuted,
      marginBottom: spacing.xs,
    },
    fieldInput: {
      backgroundColor: c.surfaceAlt,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.borderStrong,
      paddingHorizontal: spacing.md,
      paddingVertical: Platform.OS === 'ios' ? spacing.md : spacing.sm,
      color: c.text,
      fontSize: 15,
    },
    fieldHint: {...typography.caption, color: c.textFaint, marginTop: spacing.xs},

    chipWrap: {marginBottom: spacing.md},
    chipRow: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
    chip: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.borderStrong,
      backgroundColor: c.surfaceAlt,
    },
    chipActive: {backgroundColor: c.primarySoft, borderColor: c.primaryBorder},
    chipText: {...typography.label, color: c.textMuted},
    chipTextActive: {color: c.violet, fontWeight: '700'},

    stat: {flex: 1, minWidth: 140, gap: spacing.xxs},
    statLabel: {...typography.caption, color: c.textMuted},
    statValue: {...typography.priceLarge},
    statSub: {...typography.caption, color: c.textFaint},

    avatar: {alignItems: 'center', justifyContent: 'center'},
    avatarText: {color: '#ffffff', fontWeight: '800'},

    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      padding: spacing.md,
      gap: spacing.md,
      marginBottom: spacing.sm,
    },
    rowPressed: {opacity: 0.85},
    rowBody: {flex: 1, gap: 2},
    rowTitle: {...typography.heading, color: c.text},
    rowSubtitle: {...typography.caption, color: c.textMuted, lineHeight: 17},
    rowRight: {alignItems: 'flex-end', gap: spacing.xs},

    progressTrack: {
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: c.surfaceAlt,
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
    sectionTitle: {...typography.heading, color: c.text},
    sectionAction: {...typography.label, color: c.primary},

    empty: {alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.sm},
    emptyTitle: {...typography.heading, color: c.text},
    emptySub: {...typography.body, color: c.textMuted, textAlign: 'center'},
    emptyAction: {marginTop: spacing.xs},

    modalRoot: {flex: 1, justifyContent: 'flex-end'},
    modalBackdrop: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: c.overlay,
    },
    sheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      borderWidth: 1,
      borderColor: c.borderStrong,
      maxHeight: '88%',
    },
    sheetHandle: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: radius.pill,
      backgroundColor: c.borderStrong,
      marginTop: spacing.sm,
    },
    sheetHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: spacing.xl,
      paddingVertical: spacing.md,
    },
    sheetTitle: {...typography.heading, color: c.text},
    sheetClose: {color: c.textMuted, fontSize: 18, fontWeight: '700'},
    sheetBody: {paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl},

    toast: {
      position: 'absolute',
      top: 60,
      alignSelf: 'center',
      backgroundColor: c.surfaceAlt,
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
    toastText: {...typography.label, color: c.text},
  });

export function Screen({
  children,
  scroll,
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
}) {
  const styles = useThemedStyles(createStyles);
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
  const styles = useThemedStyles(createStyles);
  const Wrapper = onPress ? Pressable : View;
  return (
    <Wrapper
      onPress={onPress}
      style={({pressed}) => [styles.card, style, onPress && pressed && styles.cardPressed]}
    >
      {children}
    </Wrapper>
  );
}

/* -------------------------------- Badge ------------------------------- */

function badgeColors(c: Palette): Record<string, {bg: string; fg: string}> {
  return {
    active: {bg: c.successSoft, fg: c.success},
    overdue: {bg: c.dangerSoft, fg: c.danger},
    defaulted: {bg: c.dangerSoft, fg: c.danger},
    completed: {bg: c.infoSoft, fg: c.info},
    cancelled: {bg: c.warnSoft, fg: c.warn},
    pending: {bg: c.warnSoft, fg: c.warn},
    approved: {bg: c.successSoft, fg: c.success},
    rejected: {bg: c.dangerSoft, fg: c.danger},
    suspended: {bg: c.dangerSoft, fg: c.danger},
    paid: {bg: c.successSoft, fg: c.success},
    seller: {bg: c.infoSoft, fg: c.info},
    buyer: {bg: c.successSoft, fg: c.success},
    admin: {bg: c.primarySoft, fg: c.violet},
  };
}

export function Badge({label, tone = 'active'}: {label: string; tone?: string}) {
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);
  const c = badgeColors(colors)[tone] ?? {bg: colors.surfaceAlt, fg: colors.textMuted};
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
  /** Semantic AssetIcon key (e.g. 'plus'). Rendered only when a real asset exists. */
  icon?: string;
  style?: ViewStyle;
}) {
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);
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
    success: '#04120a', // dark text keeps contrast on the light success green
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
        <View style={styles.btnInner}>
          {icon ? <AssetIcon name={icon} size={small ? 16 : 18} subtle={variant === 'ghost'} /> : null}
          <Text style={[styles.btnLabel, small && styles.btnLabelSmall, {color: fg[variant]}]}>
            {label}
          </Text>
        </View>
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
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput placeholderTextColor={colors.textFaint} style={styles.fieldInput} {...props} />
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
  const styles = useThemedStyles(createStyles);
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
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{o.label}</Text>
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
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);
  const valColor =
    tone === 'good'
      ? colors.success
      : tone === 'bad'
        ? colors.danger
        : tone === 'brand'
          ? colors.violet
          : colors.text;
  return (
    <Card style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, {color: valColor}]}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </Card>
  );
}

/* ------------------------------- Avatar ------------------------------- */

export function Avatar({name, size = 40}: {name: string; size?: number}) {
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);
  const palette = [colors.primary, colors.info, colors.success, colors.warn, colors.danger, colors.violet];
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() ?? '')
    .join('');
  const hash = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const bg = palette[hash % palette.length];
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
  icon,
  label,
  title,
  subtitle,
  right,
  onPress,
  tone,
}: {
  /** Semantic AssetIcon key — omit to render no icon. */
  icon?: string;
  /** Short text for the placeholder tile (e.g. a product's name). */
  label?: string;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  tone?: string;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <Pressable
      onPress={onPress}
      style={({pressed}) => [styles.row, pressed && onPress && styles.rowPressed]}
    >
      {icon ? <AssetIcon name={icon} label={label} size={44} /> : null}
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
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);
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
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={styles.sectionAction}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ----------------------------- EmptyState ----------------------------- */

export function EmptyState({
  icon,
  label,
  title,
  subtitle,
  action,
  onAction,
}: {
  /** Semantic AssetIcon key (e.g. 'product'). */
  icon: string;
  /** Short text for the placeholder tile. */
  label?: string;
  title: string;
  subtitle?: string;
  /** Optional call-to-action button for newbie-friendly empty states. */
  action?: string;
  onAction?: () => void;
}) {
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.empty}>
      <AssetIcon name={icon} label={label} size={64} rounded={18} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {subtitle ? <Text style={styles.emptySub}>{subtitle}</Text> : null}
      {action && onAction ? (
        <View style={styles.emptyAction}>
          <Button label={action} small onPress={onAction} />
        </View>
      ) : null}
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
  const styles = useThemedStyles(createStyles);
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

/** Fire-and-forget toast — call from anywhere, e.g. toast('Payment saved'). */
export function toast(msg: string, kind: ToastKind = 'success') {
  toastListener?.(msg, kind);
}

export function ToastHost() {
  const {colors} = useTheme();
  const styles = useThemedStyles(createStyles);
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
        Animated.timing(opacity, {toValue: 0, duration: 260, useNativeDriver: true}).start(() =>
          setMsg(null),
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
