/**
 * HulogTrack brand asset generator.
 *
 * Produces the full icon/logo set with ZERO dependencies (pure Node):
 *   • logo.svg            — vector master (edit this, re-run to rebuild PNGs)
 *   • app-icon-1024.png   — Apple App Store / Google Play primary icon
 *   • app-icon-512.png    — web + Android "play store" icon
 *   • app-icon-192.png    — PWA manifest icon
 *   • app-icon-48.png     — favicon / small web icon
 *   • notification-icon.png — Android notification icon (white on transparent)
 *   • favicon.ico         — 32×32 PNG wrapped in an ICO container
 *   • logo-preview.html   — visual proof page (open it in any browser)
 *
 * Run:  node tools/generate-branding.mjs
 */
import {deflateSync} from 'node:zlib';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'assets', 'branding');

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

/** Encode an RGBA PNG of `size`×`size`; getPixel(x, y) → [r, g, b, a]. */
function encodePng(size, getPixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = getPixel(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const idat = deflateSync(raw);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------ brand geometry ---------------------------- */

const GLYPHS = {
  H: [
    'XX    XX',
    'XX    XX',
    'XX    XX',
    'XXXXXXXX',
    'XXXXXXXX',
    'XX    XX',
    'XX    XX',
    'XX    XX',
  ],
  T: [
    'XXXXXXXX',
    'XXXXXXXX',
    '   XX   ',
    '   XX   ',
    '   XX   ',
    '   XX   ',
    '   XX   ',
    '   XX   ',
  ],
};

const C_TOP = [109, 94, 242]; // #6d5ef2
const C_BOTTOM = [43, 31, 140]; // #2b1f8c
const C_WHITE = [255, 255, 255];

function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function inRoundedRect(x, y, size, r) {
  const x0 = r;
  const x1 = size - r;
  const y0 = r;
  const y1 = size - r;
  if (x < x0 || x >= x1 || y < y0 || y >= y1) {
    const cx = x < x0 ? x0 : x >= x1 ? x1 - 1 : x;
    const cy = y < y0 ? y0 : y >= y1 ? y1 - 1 : y;
    const dx = x - cx;
    const dy = y - cy;
    return dx * dx + dy * dy <= r * r;
  }
  return true;
}

/** Render the rounded-square "HT" mark at any size (anti-aliased-ish). */
function drawMark(size) {
  const r = size * 0.22;
  // The monogram is two 8×8 glyphs (16 cells) + 1 cell gap; size it to ~62%
  // of the canvas and center it.
  const cell = (size * 0.62) / 17;
  const glyphX = (size - 17 * cell) / 2;
  const glyphY = (size - 8 * cell) / 2;

  const glyphAt = (x, y) => {
    // Soft edges: supersample 2×2 in CELL units.
    let hits = 0;
    for (const [dx, dy] of [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]]) {
      const col = Math.floor((x - glyphX) / cell + dx);
      const row = Math.floor((y - glyphY) / cell + dy);
      let glyph = null;
      let c = col;
      if (row >= 0 && row < 8) {
        if (col >= 0 && col < 8) {
          glyph = GLYPHS.H;
        } else if (col >= 9 && col < 17) {
          glyph = GLYPHS.T;
          c = col - 9;
        }
      }
      if (glyph && glyph[row][c] === 'X') {
        hits++;
      }
    }
    return hits / 4;
  };

  return (x, y) => {
    if (!inRoundedRect(x, y, size, r)) {
      return [0, 0, 0, 0];
    }
    const t = y / size;
    let [r0, g0, b0] = lerp(C_TOP, C_BOTTOM, t);
    // Soft top highlight.
    if (y < size * 0.35) {
      const h = 1 - y / (size * 0.35);
      [r0, g0, b0] = lerp([r0, g0, b0], [170, 155, 255], h * 0.35);
    }
    // Subtle border ring.
    const edge = size * 0.028;
    if (y < edge && x > edge && x < size - edge) {
      [r0, g0, b0] = lerp([r0, g0, b0], [255, 255, 255], 0.12);
    }
    const alpha = glyphAt(x, y);
    if (alpha > 0) {
      const [wr, wg, wb] = C_WHITE;
      return [
        Math.round(wr * alpha + r0 * (1 - alpha)),
        Math.round(wg * alpha + g0 * (1 - alpha)),
        Math.round(wb * alpha + b0 * (1 - alpha)),
        255,
      ];
    }
    return [Math.round(r0), Math.round(g0), Math.round(b0), 255];
  };
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

/* --------------------------------- SVG ------------------------------------ */

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#6d5ef2"/>
      <stop offset="1" stop-color="#2b1f8c"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bg)"/>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="none" stroke="#b9afff" stroke-opacity="0.45" stroke-width="10"/>
  <rect x="112" y="112" width="64" height="288" rx="10" fill="#ffffff"/>
  <rect x="112" y="208" width="176" height="64" rx="10" fill="#ffffff"/>
  <rect x="224" y="112" width="64" height="288" rx="10" fill="#ffffff"/>
  <path d="M336 112 h112 v56 h-48 v232 h-64 v-288 z" fill="#ffffff"/>
  <circle cx="368" cy="368" r="40" fill="#22c55e" opacity="0.9"/>
</svg>
`;

/* -------------------------------- write all -------------------------------- */

function write(name, buf) {
  writeFileSync(join(OUT, name), buf);
  console.log(`  ✓ ${name}  (${(buf.length / 1024).toFixed(1)} KB)`);
}

mkdirSync(join(OUT, 'logo'), {recursive: true});
mkdirSync(join(OUT, 'icons'), {recursive: true});
mkdirSync(join(OUT, 'screenshots'), {recursive: true});

console.log('Generating HulogTrack branding → assets/branding/');

// Vector master.
write(join('logo', 'logo.svg'), Buffer.from(SVG, 'utf8'));

// PNG rasters.
const sizes = [1024, 512, 192, 96, 48];
for (const s of sizes) {
  write(`icons/app-icon-${s}.png`, encodePng(s, drawMark(s)));
}
write(join('icons', 'app-icon.png'), readFileSync(join(OUT, 'icons', 'app-icon-1024.png')));

// Notification icon: white monogram on transparent (Android expects this —
// the launcher tints it, so it must be a white silhouette).
write('icons/notification-icon.png', encodePng(96, (x, y) => {
  const [r, g, b, a] = drawMark(96)(x, y);
  if (a > 0 && r > 225 && g > 225 && b > 225) {
    return [255, 255, 255, 255]; // keep only the near-white glyph pixels
  }
  return [0, 0, 0, 0];
}));

// Favicon (32×32 PNG inside an ICO container — works in every browser).
write('icons/favicon.ico', wrapIco(encodePng(32, drawMark(32))));

// Screenshots placeholder note.
write(join('screenshots', 'README.txt'),
  'Drop store listing screenshots here (portrait, 6.7" display).\nSee assets/ASSETS.md for exact specs.\n');

// Preview page: inline SVG + base64 PNGs so it renders offline.
const b64 = n => readFileSync(join(OUT, 'icons', `app-icon-${n}.png`)).toString('base64');
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
  .cell img, .cell svg { border-radius: 18px; box-shadow: 0 12px 40px rgba(0,0,0,.45); display:block; }
  .cell span { display:block; margin-top:10px; font-size:12px; color:#93a0b8; }
  .note { background:#111830; border:1px solid rgba(148,163,184,.14); border-radius:14px; padding:18px; margin-top:28px; max-width:720px; }
</style>
</head>
<body>
<h1>🛒 HulogTrack — brand assets</h1>
<p>Generated by <code>tools/generate-branding.mjs</code>. The SVG is the master; PNGs are rasterized copies.</p>
<div class="grid">
  <div class="cell"><img src="data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}" width="140" height="140" alt="logo svg"/><span>logo.svg</span></div>
  <div class="cell"><img src="data:image/png;base64,${b64(1024)}" width="120" height="120" alt="1024"/><span>app-icon-1024.png</span></div>
  <div class="cell"><img src="data:image/png;base64,${b64(512)}" width="112" height="112" alt="512"/><span>app-icon-512.png</span></div>
  <div class="cell"><img src="data:image/png;base64,${b64(192)}" width="92" height="92" alt="192"/><span>app-icon-192.png</span></div>
  <div class="cell"><img src="data:image/png;base64,${b64(96)}" width="64" height="64" alt="96"/><span>app-icon-96.png</span></div>
  <div class="cell"><img src="data:image/png;base64,${b64(48)}" width="44" height="44" alt="48"/><span>app-icon-48.png</span></div>
</div>
<div class="note">
  <strong>Want a different design?</strong> Edit the SVG master (or the GLYPHS/C_* constants in
  <code>tools/generate-branding.mjs</code>), then re-run <code>node tools/generate-branding.mjs</code>
  to rebuild every PNG at every size.
</div>
</body>
</html>`;
write('logo-preview.html', Buffer.from(preview, 'utf8'));

console.log('\nDone. Open assets/branding/logo-preview.html to review, and read assets/ASSETS.md for the full checklist.');
