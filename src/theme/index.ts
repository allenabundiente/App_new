/**
 * HulogTrack Design System
 * Deep-navy dark-first palette with violet/emerald accents — mirrors the
 * brand of the web version.
 */

export const colors = {
  // Brand
  primary: '#6d5ef2',
  primaryDark: '#5b4de0',
  primarySoft: 'rgba(109, 94, 242, 0.16)',
  primaryBorder: 'rgba(109, 94, 242, 0.45)',

  // Neutrals (dark navy)
  background: '#0a0e1a',
  surface: '#111830',
  surfaceAlt: '#16203c',
  border: 'rgba(148, 163, 184, 0.14)',
  borderStrong: 'rgba(148, 163, 184, 0.28)',
  text: '#e9edf7',
  textMuted: '#93a0b8',
  textFaint: '#5d6b85',

  // Status
  success: '#22c55e',
  successSoft: 'rgba(34, 197, 94, 0.14)',
  warn: '#f59e0b',
  warnSoft: 'rgba(245, 158, 11, 0.14)',
  danger: '#f43f5e',
  dangerSoft: 'rgba(244, 63, 94, 0.13)',
  info: '#38bdf8',
  infoSoft: 'rgba(56, 189, 248, 0.13)',
  violet: '#a78bfa',

  white: '#ffffff',
  black: '#000000',
  overlay: 'rgba(4, 7, 16, 0.66)',
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
};

export const typography = {
  display: {fontSize: 32, fontWeight: '800' as const, lineHeight: 38},
  title: {fontSize: 22, fontWeight: '800' as const, lineHeight: 28},
  heading: {fontSize: 17, fontWeight: '700' as const, lineHeight: 23},
  body: {fontSize: 15, fontWeight: '500' as const, lineHeight: 21},
  label: {fontSize: 13, fontWeight: '600' as const, lineHeight: 18},
  caption: {fontSize: 11, fontWeight: '500' as const, lineHeight: 15},
  price: {fontSize: 18, fontWeight: '800' as const, lineHeight: 24},
  priceLarge: {fontSize: 26, fontWeight: '800' as const, lineHeight: 32},
};

export const touch = {
  min: 44,
};

export const TABLET_BREAKPOINT = 760;

/** Role-based accent for avatars/tags. */
export const roleColor: Record<string, string> = {
  admin: colors.primary,
  seller: colors.info,
  buyer: colors.success,
};
