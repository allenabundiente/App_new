/**
 * HulogTrack Design System
 *
 * Two palettes (dark + light) behind a tiny ThemeProvider. Any component can
 * pull the active palette with useTheme() or build its StyleSheet per theme
 * with useThemedStyles(factory). The chosen mode is persisted in MMKV.
 *
 * To theme a component:
 *   const createStyles = (c: Palette) => StyleSheet.create({...uses c...});
 *   // inside the component:
 *   const styles = useThemedStyles(createStyles);
 *   const {colors} = useTheme();            // for inline color props
 *
 * Static tokens (spacing/radius/typography) are theme-independent.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import {kv} from '../storage/kv';

export type ThemeMode = 'dark' | 'light';

export interface Palette {
  // Brand
  primary: string;
  primaryDark: string;
  primarySoft: string;
  primaryBorder: string;

  // Surfaces
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderStrong: string;

  // Text
  text: string;
  textMuted: string;
  textFaint: string;

  // Status
  success: string;
  successSoft: string;
  warn: string;
  warnSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  violet: string;

  white: string;
  black: string;
  overlay: string;
}

/* ------------------------------ palettes ------------------------------ */

export const darkColors: Palette = {
  primary: '#7c6cf6',
  primaryDark: '#5b4de0',
  primarySoft: 'rgba(124, 108, 246, 0.16)',
  primaryBorder: 'rgba(124, 108, 246, 0.45)',

  background: '#0b1020',
  surface: '#151d36',
  surfaceAlt: '#1d2748',
  border: 'rgba(148, 163, 184, 0.14)',
  borderStrong: 'rgba(148, 163, 184, 0.28)',

  text: '#eef1fa',
  textMuted: '#9aa7c2',
  textFaint: '#66738f',

  success: '#34d399',
  successSoft: 'rgba(52, 211, 153, 0.14)',
  warn: '#fbbf24',
  warnSoft: 'rgba(251, 191, 36, 0.14)',
  danger: '#fb7185',
  dangerSoft: 'rgba(251, 113, 133, 0.13)',
  info: '#38bdf8',
  infoSoft: 'rgba(56, 189, 248, 0.13)',
  violet: '#c4b5fd',

  white: '#ffffff',
  black: '#000000',
  overlay: 'rgba(3, 6, 15, 0.66)',
};

export const lightColors: Palette = {
  primary: '#5f51e8',
  primaryDark: '#4a3fd0',
  primarySoft: 'rgba(95, 81, 232, 0.12)',
  primaryBorder: 'rgba(95, 81, 232, 0.4)',

  background: '#f4f5fb',
  surface: '#ffffff',
  surfaceAlt: '#eef0f8',
  border: 'rgba(15, 23, 42, 0.1)',
  borderStrong: 'rgba(15, 23, 42, 0.22)',

  text: '#111a33',
  textMuted: '#5b6680',
  textFaint: '#8d97ad',

  success: '#159451',
  successSoft: 'rgba(21, 148, 81, 0.12)',
  warn: '#c2740a',
  warnSoft: 'rgba(194, 116, 10, 0.13)',
  danger: '#dc2644',
  dangerSoft: 'rgba(220, 38, 68, 0.1)',
  info: '#0284c7',
  infoSoft: 'rgba(2, 132, 199, 0.1)',
  violet: '#5f51e8',

  white: '#ffffff',
  black: '#000000',
  overlay: 'rgba(15, 23, 42, 0.5)',
};

export const palettes: Record<ThemeMode, Palette> = {
  dark: darkColors,
  light: lightColors,
};

/* ----------------------------- persistence ---------------------------- */

const KEY_MODE = 'theme.mode';

function getInitialMode(): ThemeMode {
  return kv.getString(KEY_MODE) === 'light' ? 'light' : 'dark';
}

/* ------------------------------ context ------------------------------- */

interface ThemeValue {
  mode: ThemeMode;
  colors: Palette;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({children}: {children: React.ReactNode}) {
  const [mode, setModeState] = useState<ThemeMode>(getInitialMode);

  const setMode = useCallback((next: ThemeMode) => {
    kv.set(KEY_MODE, next);
    setModeState(next);
  }, []);

  const toggle = useCallback(() => {
    setModeState(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      kv.set(KEY_MODE, next);
      return next;
    });
  }, []);

  const colors = palettes[mode];
  const value = useMemo<ThemeValue>(
    () => ({mode, colors, setMode, toggle}),
    [mode, colors, setMode, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside <ThemeProvider>');
  }
  return ctx;
}

/**
 * Build a StyleSheet against the ACTIVE palette, memoized per theme.
 * Pass a module-level factory: `const createStyles = (c: Palette) => StyleSheet.create({...})`.
 */
export function useThemedStyles<T>(factory: (c: Palette) => T): T {
  const {colors} = useTheme();
  return useMemo(() => factory(colors), [colors, factory]);
}

/* ---------------------------- static tokens ---------------------------- */

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
export function roleColor(role: string, colors: Palette): string {
  switch (role) {
    case 'admin':
      return colors.primary;
    case 'seller':
      return colors.info;
    case 'buyer':
      return colors.success;
    default:
      return colors.textMuted;
  }
}
