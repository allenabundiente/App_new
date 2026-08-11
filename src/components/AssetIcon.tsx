/**
 * AssetIcon — semantic icon slot with built-in SVG glyphs and a fallback.
 *
 * Every icon in the app goes through this component using a semantic KEY
 * (e.g. <AssetIcon name="tab.home" />). Resolution order:
 *   1. A real image asset registered in src/assets/manifest.ts (Image).
 *   2. A built-in SVG glyph below (distinct icon per key, tinted).
 *   3. A placeholder tile: the label's first letter, or a generic glyph.
 *
 * Glyphs are simple 24x24 stroke icons drawn with react-native-svg, so the
 * app ships with a coherent icon set without any image files.
 */
import React from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import Svg, {Circle, Path, Rect} from 'react-native-svg';
import {useTheme} from '../theme';
import {assetFor} from '../assets/manifest';

const TINTS = ['violet', 'info', 'success', 'warn', 'danger'] as const;

function tintFor(name: string, colors: ReturnType<typeof useTheme>['colors']): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const key = TINTS[hash % TINTS.length];
  return key === 'violet'
    ? colors.violet
    : key === 'info'
      ? colors.info
      : key === 'success'
        ? colors.success
        : key === 'warn'
          ? colors.warn
          : colors.danger;
}

/* --------------------------- built-in glyphs --------------------------- */

type Glyph = (color: string, subtle: boolean) => React.ReactNode;

/** Shared stroke props for the 24x24 line icons. */
const line = (color: string, subtle: boolean) => ({
  stroke: color,
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none',
  opacity: subtle ? 0.72 : 1,
});

const GLYPHS: Record<string, Glyph> = {
  logo: (c, s) => (
    <>
      <Rect x="3.5" y="3.5" width="17" height="17" rx="5" {...line(c, s)} />
      <Path d="M8.5 12.3l2.4 2.4 4.6-5" {...line(c, s)} />
    </>
  ),

  // Bottom tab bar / side rail
  'tab.home': (c, s) => (
    <>
      <Path d="M3.5 11 12 3.8 20.5 11" {...line(c, s)} />
      <Path d="M6 10v9a1 1 0 0 0 1 1h3.2v-4.6h3.6V20H17a1 1 0 0 0 1-1v-9" {...line(c, s)} />
    </>
  ),
  'tab.plans': (c, s) => (
    <>
      <Rect x="5" y="4.5" width="14" height="16" rx="2" {...line(c, s)} />
      <Path d="M9 4.5V3h6v1.5M8.5 10.5h7M8.5 14.5h7M8.5 18h4" {...line(c, s)} />
    </>
  ),
  'tab.products': (c, s) => (
    <>
      <Path d="M12 3.5 20.5 8v8L12 20.5 3.5 16V8z" {...line(c, s)} />
      <Path d="M3.7 8.2 12 13l8.3-4.8M12 13v7.5" {...line(c, s)} />
    </>
  ),
  'tab.customers': (c, s) => (
    <>
      <Circle cx="12" cy="8" r="3.4" {...line(c, s)} />
      <Path d="M5 20c.9-3.4 3.7-5.3 7-5.3s6.1 1.9 7 5.3" {...line(c, s)} />
    </>
  ),
  'tab.requests': (c, s) => (
    <>
      <Path d="M5 5.5h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" {...line(c, s)} />
      <Path d="M4 13.5h4.2l1.6 2.6h4.4l1.6-2.6H20" {...line(c, s)} />
    </>
  ),
  'tab.receipts': (c, s) => (
    <>
      <Path d="M7 3.5h7.5L19 8v12.5H7z" {...line(c, s)} />
      <Path d="M14.5 3.5V8H19M10 12.5h5M10 16h5" {...line(c, s)} />
    </>
  ),
  'tab.users': (c, s) => (
    <>
      <Circle cx="9" cy="8.5" r="3" {...line(c, s)} />
      <Path d="M3.5 20c.6-2.9 2.7-4.5 5.5-4.5s4.9 1.6 5.5 4.5" {...line(c, s)} />
      <Circle cx="16.5" cy="9.5" r="2.4" {...line(c, s)} />
      <Path d="M16.2 15.5c2.6.2 4.3 1.7 4.9 4.5" {...line(c, s)} />
    </>
  ),
  'tab.reports': (c, s) => (
    <>
      <Path d="M4.5 20.5h15" {...line(c, s)} />
      <Rect x="7" y="12.5" width="3" height="8" rx="1" {...line(c, s)} />
      <Rect x="12" y="8" width="3" height="12.5" rx="1" {...line(c, s)} />
      <Rect x="17" y="10.5" width="3" height="10" rx="1" {...line(c, s)} />
    </>
  ),

  // Header actions
  bell: (c, s) => (
    <>
      <Path d="M18 9.5a6 6 0 0 0-12 0c0 6.5-2.3 7.8-2.3 7.8h16.6S18 16 18 9.5z" {...line(c, s)} />
      <Path d="M10.6 20.2a1.8 1.8 0 0 0 2.8 0" {...line(c, s)} />
    </>
  ),
  theme: (c, s) => (
    <Path d="M20.3 13.4A8.2 8.2 0 0 1 10.6 3.7 8.2 8.2 0 1 0 20.3 13.4z" {...line(c, s)} />
  ),
  logout: (c, s) => (
    <>
      <Path d="M14 4.5H7.5A1.5 1.5 0 0 0 6 6v12a1.5 1.5 0 0 0 1.5 1.5H14" {...line(c, s)} />
      <Path d="M10.5 12H20M16 8l4 4-4 4" {...line(c, s)} />
    </>
  ),
  back: (c, s) => (
    <>
      <Path d="M19.5 12h-15" {...line(c, s)} />
      <Path d="M9.5 6.5 4 12l5.5 5.5" {...line(c, s)} />
    </>
  ),

  // Common actions
  plus: (c, s) => <Path d="M12 5v14M5 12h14" {...line(c, s)} />,
  check: (c, s) => <Path d="M5 12.5l4.5 4.5L19 7.5" {...line(c, s)} />,
  edit: (c, s) => (
    <>
      <Path d="M4 20l1.2-4.3L16.7 4.2a2.1 2.1 0 0 1 3 3L8.3 18.8 4 20z" {...line(c, s)} />
      <Path d="M14.8 6.1l3 3" {...line(c, s)} />
    </>
  ),
  trash: (c, s) => (
    <>
      <Path d="M4.5 7h15M9.5 7V5h5v2" {...line(c, s)} />
      <Path d="M7 7l1 12.5h8L17 7M10.2 11v5.5M13.8 11v5.5" {...line(c, s)} />
    </>
  ),
  chat: (c, s) => (
    <Path
      d="M12 4c4.4 0 8 3.4 8 7.6 0 4.2-3.6 7.6-8 7.6-1.1 0-2.2-.2-3.1-.6L4.5 20l1-3.1A7.3 7.3 0 0 1 4 11.6C4 7.4 7.6 4 12 4z"
      {...line(c, s)}
    />
  ),
  money: (c, s) => (
    <>
      <Rect x="2.5" y="6.5" width="19" height="11" rx="2" {...line(c, s)} />
      <Circle cx="12" cy="12" r="2.8" {...line(c, s)} />
      <Path d="M6 9.5h.01M18 14.5h.01" {...line(c, s)} />
    </>
  ),
  flag: (c, s) => (
    <>
      <Path d="M6.5 21V4" {...line(c, s)} />
      <Path d="M6.5 5h11l-2.5 3 2.5 3h-11" {...line(c, s)} />
    </>
  ),
  calendar: (c, s) => (
    <>
      <Rect x="4" y="5" width="16" height="15" rx="2" {...line(c, s)} />
      <Path d="M4 9.5h16M8.5 3v4M15.5 3v4" {...line(c, s)} />
    </>
  ),
  schedule: (c, s) => (
    <>
      <Circle cx="12" cy="12" r="8.5" {...line(c, s)} />
      <Path d="M12 7.5V12l3 2" {...line(c, s)} />
    </>
  ),
  card: (c, s) => (
    <>
      <Rect x="2.5" y="6" width="19" height="12.5" rx="2" {...line(c, s)} />
      <Path d="M2.5 10.5h19M6.5 15h4.5" {...line(c, s)} />
    </>
  ),
  product: (c, s) => (
    <>
      <Path d="M12 3.5 20.5 8v8L12 20.5 3.5 16V8z" {...line(c, s)} />
      <Path d="M3.7 8.2 12 13l8.3-4.8M12 13v7.5" {...line(c, s)} />
    </>
  ),

  // Extra utility icons
  eye: (c, s) => (
    <>
      <Path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z" {...line(c, s)} />
      <Circle cx="12" cy="12" r="3" {...line(c, s)} />
    </>
  ),
  search: (c, s) => (
    <>
      <Circle cx="11" cy="11" r="6.5" {...line(c, s)} />
      <Path d="M16 16l4.5 4.5" {...line(c, s)} />
    </>
  ),
  'chevron-down': (c, s) => <Path d="M6.5 9.5 12 15l5.5-5.5" {...line(c, s)} />,
  'chevron-up': (c, s) => <Path d="M6.5 14.5 12 9l5.5 5.5" {...line(c, s)} />,
  'chevron-left': (c, s) => <Path d="M14.5 6.5 9 12l5.5 5.5" {...line(c, s)} />,
  'chevron-right': (c, s) => <Path d="M9.5 6.5 15 12l-5.5 5.5" {...line(c, s)} />,
  mail: (c, s) => (
    <>
      <Rect x="3" y="5.5" width="18" height="13" rx="2" {...line(c, s)} />
      <Path d="M3.5 7.5l8.5 5.8 8.5-5.8" {...line(c, s)} />
    </>
  ),
  lock: (c, s) => (
    <>
      <Rect x="5" y="10.5" width="14" height="9.5" rx="2" {...line(c, s)} />
      <Path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" {...line(c, s)} />
    </>
  ),
};

/* ------------------------------- component ----------------------------- */

export function AssetIcon({
  name,
  label,
  size = 44,
  rounded = 14,
  subtle = false,
  tint,
  plain = false,
}: {
  /** Semantic key, e.g. 'tab.home' — see src/assets/manifest.ts. */
  name: string;
  /** Short text shown in the placeholder tile (e.g. a product's first letter). */
  label?: string;
  size?: number;
  rounded?: number;
  /** Use a lighter tint (secondary / inactive contexts). */
  subtle?: boolean;
  /** Override the icon color (e.g. white on a filled button). */
  tint?: string;
  /** Render the bare glyph without the tile background (for icon buttons/FABs). */
  plain?: boolean;
}) {
  const {colors} = useTheme();
  const source = assetFor(name);

  if (source != null) {
    return <Image source={source} style={{width: size, height: size}} />;
  }

  const color = tint ?? tintFor(name, colors);
  const glyph = GLYPHS[name];

  if (plain) {
    if (glyph) {
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          {glyph(color, subtle)}
        </Svg>
      );
    }
    // No glyph: fall back to a minimal tile (same visual language as below).
  }

  const letter = (label ?? '').trim().charAt(0).toUpperCase();

  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: rounded,
          backgroundColor: subtle ? colors.surfaceAlt : colors.primarySoft,
          borderColor: subtle ? colors.border : colors.primaryBorder,
        },
      ]}
    >
      {glyph ? (
        <Svg width={size * 0.58} height={size * 0.58} viewBox="0 0 24 24">
          {glyph(color, subtle)}
        </Svg>
      ) : letter ? (
        <Text
          style={[styles.letter, {color: tintFor(name, colors), fontSize: size * 0.42}]}
          allowFontScaling={false}
        >
          {letter}
        </Text>
      ) : (
        // Classic "image goes here" glyph.
        <Svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24">
          <Rect
            x="3"
            y="3"
            width="18"
            height="18"
            rx="3"
            fill="none"
            stroke={subtle ? colors.textFaint : tintFor(name, colors)}
            strokeWidth="1.6"
            opacity={subtle ? 0.7 : 0.9}
          />
          <Circle
            cx="9"
            cy="9"
            r="2.2"
            fill="none"
            stroke={subtle ? colors.textFaint : tintFor(name, colors)}
            strokeWidth="1.6"
            opacity={subtle ? 0.7 : 0.9}
          />
          <Rect
            x="3"
            y="14"
            width="18"
            height="7"
            rx="3"
            fill="none"
            stroke={subtle ? colors.textFaint : tintFor(name, colors)}
            strokeWidth="1.6"
            opacity={subtle ? 0.7 : 0.9}
          />
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
  letter: {fontWeight: '800'},
});
