/**
 * AssetIcon — semantic icon slot with a built-in placeholder.
 *
 * Instead of hard-coding emoji or a single icon font, every icon in the app
 * goes through this component using a semantic KEY (e.g. <AssetIcon
 * name="tab.home" />). Keys resolve to real image files through the manifest
 * in src/assets/manifest.ts.
 *
 * While a key has no asset yet, AssetIcon renders a placeholder tile so the
 * layout already looks finished — drop the real PNG into assets/icons/ and
 * it swaps in automatically (see assets/icons/README.md).
 */
import React from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import Svg, {Circle, Rect} from 'react-native-svg';
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

export function AssetIcon({
  name,
  label,
  size = 44,
  rounded = 14,
  subtle = false,
}: {
  /** Semantic key, e.g. 'tab.home' — see src/assets/manifest.ts. */
  name: string;
  /** Short text shown in the placeholder tile (e.g. a product's first letter). */
  label?: string;
  size?: number;
  rounded?: number;
  /** Use a lighter tint (secondary / inactive contexts). */
  subtle?: boolean;
}) {
  const {colors} = useTheme();
  const source = assetFor(name);

  if (source != null) {
    return <Image source={source} style={{width: size, height: size}} />;
  }

  const letter = (label ?? '').trim().charAt(0).toUpperCase();
  const tint = tintFor(name, colors);

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
      {letter ? (
        <Text
          style={[styles.letter, {color: tint, fontSize: size * 0.42}]}
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
            stroke={subtle ? colors.textFaint : tint}
            strokeWidth="1.6"
            opacity={subtle ? 0.7 : 0.9}
          />
          <Circle
            cx="9"
            cy="9"
            r="2.2"
            fill="none"
            stroke={subtle ? colors.textFaint : tint}
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
            stroke={subtle ? colors.textFaint : tint}
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
