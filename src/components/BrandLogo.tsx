/**
 * The app's main logo.
 *
 * The file lives at `assets/hulog.png`. Until you drop your own artwork in,
 * that path holds a copy of the previous icon, so the app still builds and
 * shows the old mark instead of crashing. Replacing that one file is the
 * only change needed — every BrandLogo picks it up after a Metro reload.
 *
 * The image is always drawn with `resizeMode="contain"` so the artwork keeps
 * its aspect ratio on the login card, the splash screen and any header.
 */
import React, {useState} from 'react';
import {Image, type ImageStyle, type StyleProp} from 'react-native';

const HULOG = require('../../assets/hulog.png');
// The previous mark is kept in the repo so a corrupt/missing hulog.png still
// renders something instead of an empty box.
const FALLBACK = require('../../assets/branding/logo/app-icon-master.png');

export function BrandLogo({
  size = 48,
  style,
}: {
  size?: number;
  style?: StyleProp<ImageStyle>;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <Image
      source={failed ? FALLBACK : HULOG}
      onError={() => setFailed(true)}
      style={[{width: size, height: size, borderRadius: size * 0.22}, style]}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel="HulogTrack logo"
    />
  );
}
