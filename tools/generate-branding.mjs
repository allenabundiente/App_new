/**
 * HulogTrack brand asset generator.
 *
 * Starts from the raw artwork at assets/branding/logo/app-icon-source.png,
 * crops it to the part that is actually drawn, scales that up to a square
 * 1024x1024 master and then rebuilds every other icon from that master.
 * No libraries at all, just node:zlib. The icon only has to be swapped in
 * one place and everything else follows.
 *
 * What it writes:
 *   assets/branding/logo/app-icon-master.png  the square 1024x1024 master
 *   assets/branding/icons/app-icon-1024.png   App Store / Play Store
 *   assets/branding/icons/app-icon-512.png    web + Play Store
 *   assets/branding/icons/app-icon-192.png    PWA manifest
 *   assets/branding/icons/app-icon-96.png     small web icon
 *   assets/branding/icons/app-icon-48.png     tiny web icon
 *   assets/branding/icons/app-icon.png        same as the 1024 one
 *   assets/branding/icons/notification-icon.png  white silhouette (Android)
 *   assets/branding/icons/favicon.ico         32x32 wrapped in an ICO
 *   assets/branding/logo/logo.svg             the artwork for web/docs
 *   android mipmap-<density>/ic_launcher.png launcher icons
 *   ios/.../AppIcon.appiconset/               iOS icons
 *
 * Run:  node tools/generate-branding.mjs
 */
import {deflateSync, inflateSync} from 'node:zlib';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'branding');
const SOURCE = join(OUT, 'logo', 'app-icon-source.png');
const MASTER_SIZE = 1024;

/* ------------------------------ PNG encoding ------------------------------ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** Encode a square RGBA pixel buffer as a PNG of the same size. */
function encodePng(size, px) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    px.copy(raw, o, y * size * 4, (y + 1) * size * 4);
    o += size * 4;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, {level: 9})),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------ PNG decoding ------------------------------ */

/** Read an 8-bit RGBA PNG (non-interlaced) back into a Buffer of pixels. */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) {
    throw new Error('not a PNG file');
  }
  let pos = 8;
  let w = 0;
  let h = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) {
        throw new Error('interlaced PNGs are not supported');
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported PNG (depth ${bitDepth}, colour type ${colorType})`);
  }
  const bpp = colorType === 6 ? 4 : 3;
  const stride = w * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(w * h * 4);
  let p = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    if (filter === 1) {
      for (let i = bpp; i < stride; i++) line[i] = (line[i] + line[i - bpp]) & 255;
    } else if (filter === 2) {
      for (let i = 0; i < stride; i++) line[i] = (line[i] + prev[i]) & 255;
    } else if (filter === 3) {
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255;
      }
    } else if (filter === 4) {
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    } else if (filter !== 0) {
      throw new Error(`unknown PNG filter ${filter}`);
    }
    // Expand to RGBA.
    for (let x = 0; x < w; x++) {
      const s = x * bpp;
      const d = (y * w + x) * 4;
      out[d] = line[s];
      out[d + 1] = line[s + 1];
      out[d + 2] = line[s + 2];
      out[d + 3] = bpp === 4 ? line[s + 3] : 255;
    }
    prev = line;
  }
  return {width: w, height: h, data: out};
}

/* ------------------------------- resizing --------------------------------- */

/**
 * Scale a pixel buffer to a new size with area averaging. Alpha is
 * premultiplied while resampling so the edges stay clean.
 */
function resize(src, sw, sh, dw, dh) {
  const out = Buffer.alloc(dw * dh * 4);

  const xWeights = () => {
    const ratio = sw / dw;
    const table = [];
    for (let x = 0; x < dw; x++) {
      const left = x * ratio;
      const right = (x + 1) * ratio;
      const x0 = Math.floor(left);
      const x1 = Math.min(Math.ceil(right), sw);
      const spans = [];
      for (let i = x0; i < x1; i++) {
        spans.push({i, w: Math.min(right, i + 1) - Math.max(left, i)});
      }
      table.push(spans);
    }
    return table;
  };

  const yWeights = () => {
    const ratio = sh / dh;
    const table = [];
    for (let y = 0; y < dh; y++) {
      const top = y * ratio;
      const bottom = (y + 1) * ratio;
      const y0 = Math.floor(top);
      const y1 = Math.min(Math.ceil(bottom), sh);
      const spans = [];
      for (let i = y0; i < y1; i++) {
        spans.push({i, w: Math.min(bottom, i + 1) - Math.max(top, i)});
      }
      table.push(spans);
    }
    return table;
  };

  const cols = xWeights();
  const rows = yWeights();

  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let total = 0;
      for (const ys of rows[y]) {
        for (const xs of cols[x]) {
          const wgt = ys.w * xs.w;
          const s = (ys.i * sw + xs.i) * 4;
          const alpha = src[s + 3] / 255;
          r += src[s] * alpha * wgt;
          g += src[s + 1] * alpha * wgt;
          b += src[s + 2] * alpha * wgt;
          a += alpha * wgt;
          total += wgt;
        }
      }
      const d = (y * dw + x) * 4;
      if (a <= 0.0001) {
        out[d] = 0;
        out[d + 1] = 0;
        out[d + 2] = 0;
        out[d + 3] = 0;
      } else {
        out[d] = Math.min(255, Math.round(r / a));
        out[d + 1] = Math.min(255, Math.round(g / a));
        out[d + 2] = Math.min(255, Math.round(b / a));
        out[d + 3] = Math.round((a / total) * 255);
      }
    }
  }
  return out;
}

/** Square RGBA buffer of `size`, filled with the artwork. */
function renderSquare(master, size) {
  return resize(master.data, master.width, master.height, size, size);
}

/**
 * Cut the source artwork down to the pixels that are actually drawn, then
 * scale that region up so it fills a square. Anything left over is cropped
 * off evenly on both sides.
 */
function cropToArtwork(src) {
  const {width: sw, height: sh, data} = src;
  let x0 = sw;
  let y0 = sh;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      if (data[(y * sw + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) {
    throw new Error('the source artwork is fully transparent');
  }
  const cw = x1 - x0 + 1;
  const ch = y1 - y0 + 1;

  // Scale so the artwork covers the whole square, then centre it.
  const scale = MASTER_SIZE / Math.min(cw, ch);
  const dw = Math.round(cw * scale);
  const dh = Math.round(ch * scale);
  const ox = Math.floor((MASTER_SIZE - dw) / 2);
  const oy = Math.floor((MASTER_SIZE - dh) / 2);

  const cropped = Buffer.alloc(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    data.copy(cropped, y * cw * 4, ((y + y0) * sw + x0) * 4, ((y + y0) * sw + x0 + cw) * 4);
  }
  const scaled = resize(cropped, cw, ch, dw, dh);

  const out = Buffer.alloc(MASTER_SIZE * MASTER_SIZE * 4);
  for (let y = 0; y < dh; y++) {
    const ty = y + oy;
    if (ty < 0 || ty >= MASTER_SIZE) {
      continue;
    }
    for (let x = 0; x < dw; x++) {
      const tx = x + ox;
      if (tx < 0 || tx >= MASTER_SIZE) {
        continue;
      }
      scaled.copy(out, (ty * MASTER_SIZE + tx) * 4, (y * dw + x) * 4, (y * dw + x + 1) * 4);
    }
  }
  return {width: MASTER_SIZE, height: MASTER_SIZE, data: out};
}

/* --------------------------- extra icon treatments ------------------------ */

/** White silhouette on transparent, for the Android status-bar icon. */
function toWhiteSilhouette(px) {
  const out = Buffer.from(px);
  for (let i = 0; i < out.length; i += 4) {
    const lum = (out[i] * 0.3 + out[i + 1] * 0.59 + out[i + 2] * 0.11) / 255;
    const cover = out[i + 3] / 255;
    // Keep the pale shapes of the mark and drop the dark background.
    const white = Math.max(0, Math.min(1, (lum - 0.55) / 0.35));
    const a = Math.round(255 * cover * white);
    out[i] = 255;
    out[i + 1] = 255;
    out[i + 2] = 255;
    out[i + 3] = a;
  }
  return out;
}

/** Round icon for the adaptive/legacy Android launcher. */
function toCircle(px, size) {
  const out = Buffer.from(px);
  const r = size / 2;
  const cx = r - 0.5;
  const cy = r - 0.5;
  const rad = r - 0.5;
  const edge = 1.25;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      let cover = (rad - dist + edge) / (2 * edge);
      cover = Math.max(0, Math.min(1, cover));
      const i = (y * size + x) * 4;
      out[i + 3] = Math.round(out[i + 3] * cover);
    }
  }
  return out;
}

/** Flatten onto white and drop the alpha channel (App Store requirement). */
function toOpaque(px) {
  const out = Buffer.alloc((px.length / 4) * 3);
  for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
    const a = px[i + 3] / 255;
    out[j] = Math.round(px[i] * a + 255 * (1 - a));
    out[j + 1] = Math.round(px[i + 1] * a + 255 * (1 - a));
    out[j + 2] = Math.round(px[i + 2] * a + 255 * (1 - a));
  }
  return out;
}

/** Encode an opaque 24-bit RGB PNG (colour type 2). */
function encodeOpaquePng(size, rgb) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0;
    rgb.copy(raw, o, y * size * 3, (y + 1) * size * 3);
    o += size * 3;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, {level: 9})),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------- ICO wrapper ------------------------------ */

function wrapIco(png32) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = 32; // width
  entry[1] = 32; // height
  entry[2] = 0; // palette
  entry[3] = 0; // reserved
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(png32.length, 8); // size
  entry.writeUInt32LE(22, 12); // offset (6 + 16)
  return Buffer.concat([header, entry, png32]);
}

/* -------------------------------- write all -------------------------------- */

function write(relPath, buf) {
  const full = join(ROOT, relPath);
  mkdirSync(dirname(full), {recursive: true});
  writeFileSync(full, buf);
  console.log(`  ${relPath}  (${(buf.length / 1024).toFixed(1)} KB)`);
}

console.log('Rebuilding HulogTrack branding from the source artwork');

const source = decodePng(readFileSync(SOURCE));
console.log(`source: ${source.width}x${source.height}`);

const master = cropToArtwork(source);
write('assets/branding/logo/app-icon-master.png', encodePng(MASTER_SIZE, master.data));
console.log(`master: ${master.width}x${master.height} (cropped and scaled to fill)`);

// The web / store icon set.
const sizes = [1024, 512, 192, 96, 48];
for (const s of sizes) {
  write(`assets/branding/icons/app-icon-${s}.png`, encodePng(s, renderSquare(master, s)));
}

write(
  'assets/branding/icons/app-icon.png',
  readFileSync(join(ROOT, 'assets/branding/icons/app-icon-1024.png')),
);

// Android notification icon: white shapes only, the OS does the tinting.
write(
  'assets/branding/icons/notification-icon.png',
  encodePng(96, toWhiteSilhouette(renderSquare(master, 96))),
);

// Browser favicon.
write('assets/branding/icons/favicon.ico', wrapIco(encodePng(32, renderSquare(master, 32))));

// logo.svg carries the artwork for the web, docs and the preview page.
const svgBytes = encodePng(512, renderSquare(master, 512)).toString('base64');
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <image width="512" height="512" href="data:image/png;base64,${svgBytes}"/>
</svg>
`;
write('assets/branding/logo/logo.svg', Buffer.from(SVG, 'utf8'));

// Android launcher icons. mdpi is 48px and each density multiplies by 1.5.
const ANDROID_DENSITIES = {mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192};
for (const [density, size] of Object.entries(ANDROID_DENSITIES)) {
  const px = renderSquare(master, size);
  const base = `android/app/src/main/res/mipmap-${density}`;
  write(`${base}/ic_launcher.png`, encodePng(size, px));
  write(`${base}/ic_launcher_round.png`, encodePng(size, toCircle(px, size)));
}

// iOS icons. Modern Xcode wants one 1024 entry plus the classic slots.
const IOS_ICONS = [
  ['Icon-App-20x20@2x.png', 40],
  ['Icon-App-20x20@3x.png', 60],
  ['Icon-App-29x29@2x.png', 58],
  ['Icon-App-29x29@3x.png', 87],
  ['Icon-App-40x40@2x.png', 80],
  ['Icon-App-40x40@3x.png', 120],
  ['Icon-App-60x60@2x.png', 120],
  ['Icon-App-60x60@3x.png', 180],
  ['Icon-App-1024x1024.png', 1024],
];
const IOS_DIR = 'ios/HulogTrack/Images.xcassets/AppIcon.appiconset';
for (const [name, size] of IOS_ICONS) {
  if (size === 1024) {
    // The App Store icon must be fully opaque.
    write(`${IOS_DIR}/${name}`, encodeOpaquePng(size, toOpaque(renderSquare(master, size))));
  } else {
    write(`${IOS_DIR}/${name}`, encodePng(size, renderSquare(master, size)));
  }
}

write(
  join('assets', 'branding', 'screenshots', 'README.txt'),
  'Drop store listing screenshots here (portrait, 6.7" display).\nSee assets/ASSETS.md for exact specs.\n',
);

// Preview page: everything inline so it renders straight off disk.
const b64 = n =>
  readFileSync(join(ROOT, 'assets/branding/icons', `app-icon-${n}.png`)).toString('base64');
const preview = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>HulogTrack brand assets</title>
<style>
  body { background:#0a0e1a; color:#e9edf7; font-family: system-ui, sans-serif; margin:0; padding:40px; }
  h1 { font-size: 22px; } p { color:#93a0b8; }
  .grid { display:flex; gap:28px; flex-wrap:wrap; align-items:flex-end; }
  .cell { text-align:center; }
  .cell img { border-radius: 18px; box-shadow: 0 12px 40px rgba(0,0,0,.45); display:block; }
  .cell span { display:block; margin-top:10px; font-size:12px; color:#93a0b8; }
  .note { background:#111830; border:1px solid rgba(148,163,184,.14); border-radius:14px; padding:18px; margin-top:28px; max-width:720px; }
</style>
</head>
<body>
<h1>HulogTrack brand assets</h1>
<p>Rebuilt by <code>tools/generate-branding.mjs</code> from <code>assets/branding/logo/app-icon-source.png</code>. The 1024px version is too big to inline here, open <code>assets/branding/icons/app-icon-1024.png</code> to see it.</p>
<div class="grid">
  <div class="cell"><img src="data:image/png;base64,${b64(512)}" width="112" height="112" alt="512"/><span>app-icon-512.png</span></div>
  <div class="cell"><img src="data:image/png;base64,${b64(192)}" width="92" height="92" alt="192"/><span>app-icon-192.png</span></div>
  <div class="cell"><img src="data:image/png;base64,${b64(96)}" width="64" height="64" alt="96"/><span>app-icon-96.png</span></div>
  <div class="cell"><img src="data:image/png;base64,${b64(48)}" width="44" height="44" alt="48"/><span>app-icon-48.png</span></div>
</div>
<div class="note">
  <strong>Want a new design?</strong> Swap in new artwork at
  <code>assets/branding/logo/app-icon-source.png</code>, then run
  <code>node tools/generate-branding.mjs</code> to rebuild every icon, including the
  Android and iOS ones.
</div>
</body>
</html>`;
write('assets/branding/logo-preview.html', Buffer.from(preview, 'utf8'));

console.log('Done. Open assets/branding/logo-preview.html to review.');
