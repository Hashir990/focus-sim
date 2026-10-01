/**
 * The app icon, drawn from the same geometry as assets/logo.svg.
 *
 *     node tools/make-icon.mjs
 *
 * Writes build/icon.png (1024), which is where electron-builder looks for it
 * without being told — `directories.buildResources` defaults to `build/`, and
 * it makes the Windows .ico from a PNG of 512 or more itself. Also writes a few
 * smaller ones into assets/ for anywhere that wants a fixed size.
 *
 * **Why this exists rather than a library.** tools/svg-raster.mjs is a path
 * rasteriser written for the picross sources: filled outlines, no strokes. This
 * mark is a stroked arc with round caps and a dash gap, which that cannot do,
 * and the alternative was a browser the repo does not otherwise need. But the
 * shape is two circles and a rotated rounded square — every one of them a
 * closed-form distance test — so it is cheaper to evaluate the geometry per
 * pixel than to parse a description of it. Supersampled 4x4 for the edges.
 *
 * **Change the mark in assets/logo.svg and change it here too.** They are the
 * same numbers written twice, which is a thing worth avoiding and is avoided
 * where it can be — but an SVG is not a format this can read back. The numbers
 * are in one block below, named the same as the attributes they mirror.
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---- the mark, in a 96-unit square: mirrors assets/logo.svg ---- */
const M = {
  cx: 48, cy: 48,
  r: 34, stroke: 9,             // the ring: centre-line radius and its width
  bright: 5 / 8,                // how much of it has gone
  start: -90,                   // twelve o'clock, degrees, y down
  ember: 7.7, emberR: 1.54,     // the rotated square in the middle
  tileR: 21,                    // the rounded tile behind it
};
const C = {
  accent: [0x4f, 0xe0, 0xc8],
  track:  [0x1f, 0x54, 0x50],
  tile:   [0x0e, 0x17, 0x29],
};

const rad = (d) => d * Math.PI / 180;

/** Is this point inside the ring band, and is that part of it bright? */
function ring(x, y) {
  const dx = x - M.cx, dy = y - M.cy;
  const d = Math.hypot(dx, dy);
  const half = M.stroke / 2;
  const inBand = d >= M.r - half && d <= M.r + half;
  /* The round caps at each end of the bright arc: a disc of the stroke's own
     radius, sitting on the centre line. Checked whether or not the point is in
     the band, because a cap reaches a little past both edges of it. */
  const sweep = 360 * M.bright;
  const capAt = (deg) => {
    const a = rad(deg);
    return Math.hypot(x - (M.cx + M.r * Math.cos(a)), y - (M.cy + M.r * Math.sin(a))) <= half;
  };
  if (capAt(M.start) || capAt(M.start + sweep)) return 'bright';
  if (!inBand) return null;
  // degrees clockwise from the start of the bright arc, 0..360
  let a = (Math.atan2(dy, dx) * 180 / Math.PI - M.start) % 360;
  if (a < 0) a += 360;
  return a <= sweep ? 'bright' : 'track';
}

/** The ember: a rounded square turned 45 degrees about the same centre. */
function ember(x, y) {
  const a = rad(-45);
  const px = (x - M.cx) * Math.cos(a) - (y - M.cy) * Math.sin(a);
  const py = (x - M.cx) * Math.sin(a) + (y - M.cy) * Math.cos(a);
  const h = M.ember / 2 - M.emberR;
  const qx = Math.abs(px) - h, qy = Math.abs(py) - h;
  if (qx <= 0 || qy <= 0) return Math.max(qx, qy) <= M.emberR;
  return Math.hypot(qx, qy) <= M.emberR;
}

/** The tile behind it, for the sizes that get one. */
function tile(x, y, n) {
  const r = M.tileR, h = 48 - r;
  const qx = Math.abs(x - 48) - h, qy = Math.abs(y - 48) - h;
  if (qx <= 0 || qy <= 0) return Math.max(qx, qy) <= r;
  return Math.hypot(qx, qy) <= r;
}

/** One icon, `n` pixels square, supersampled. */
function draw(n, withTile) {
  const px = Buffer.alloc(n * n * 4);
  const S = 4, step = 96 / n / S;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const ux = (x + (sx + 0.5) / S) * 96 / n;
          const uy = (y + (sy + 0.5) / S) * 96 / n;
          let col = null;
          if (ember(ux, uy)) col = C.accent;
          else { const k = ring(ux, uy); if (k) col = k === 'bright' ? C.accent : C.track; }
          if (!col && withTile && tile(ux, uy)) col = C.tile;
          if (col) { r += col[0]; g += col[1]; b += col[2]; a += 255; }
        }
      }
      const m = S * S, i = (y * n + x) * 4;
      /* Straight alpha, and the colour averaged over the samples that landed on
         something rather than over all of them — otherwise every edge pixel is
         mixed with black and the mark gets a dark rim on a light background. */
      const hit = a / 255;
      px[i] = hit ? Math.round(r / hit) : 0;
      px[i + 1] = hit ? Math.round(g / hit) : 0;
      px[i + 2] = hit ? Math.round(b / hit) : 0;
      px[i + 3] = Math.round(a / m);
    }
  }
  return px;
}

/* ---- PNG, by hand: header, one deflated image chunk, end ---- */
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(n, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA
  // each row is prefixed with its filter byte; 0 is "none", which deflate handles
  const raw = Buffer.alloc((n * 4 + 1) * n);
  for (let y = 0; y < n; y++) {
    raw[y * (n * 4 + 1)] = 0;
    px.copy(raw, y * (n * 4 + 1) + 1, y * n * 4, (y + 1) * n * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(join(root, 'build'), { recursive: true });
mkdirSync(join(root, 'assets'), { recursive: true });

/* electron-builder reads build/icon.png without being configured to, and makes
   the .ico from it. 1024 so every size it derives is a downscale. */
const main = join(root, 'build', 'icon.png');
writeFileSync(main, png(1024, draw(1024, true)));
console.log('build/icon.png  1024 (tile)');

for (const n of [512, 256, 128, 64, 32]) {
  writeFileSync(join(root, 'assets', 'icon-' + n + '.png'), png(n, draw(n, true)));
  console.log('assets/icon-' + n + '.png');
}
// and one without the tile, for anywhere that puts it on its own background
writeFileSync(join(root, 'assets', 'mark-512.png'), png(512, draw(512, false)));
console.log('assets/mark-512.png  (no tile)');

/* ---- and the phone ----

   The Android project came out of Capacitor with Capacitor's own icon in it,
   so the app on a phone has been wearing somebody else's mark for as long as
   there has been a phone build. These are the same geometry at the five
   densities Android asks for.

   **Three files per density, and the third is the one that matters.** Modern
   Android does not use ic_launcher at all: it composes an *adaptive* icon from
   a foreground layer and a background, and crops the pair to whatever shape the
   launcher feels like — a circle, a squircle, a rounded square. Only the middle
   two thirds of the foreground is guaranteed to survive that crop, which is why
   it is drawn at `inset` below: the mark sits in the safe zone with room round
   it, and the tile is dropped because the background layer is the tile.

   ic_launcher and ic_launcher_round are still written for Android 7 and older
   and for launchers that ask for them by name. They keep the tile, because
   there is no background layer underneath them to supply one. */
const DENSITY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
/* The foreground is a bigger canvas than the icon it ends up as: 108dp against
   48dp of visible icon, and the mark has to sit inside the middle 72dp of it. */
const FG = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };

/** The mark on a transparent square, shrunk into the middle so a round crop
    cannot take a bite out of it. */
function foreground(n) {
  /* A Buffer, not a Uint8Array: png() below hands it to zlib through
     .copy(), which only one of the two has. */
  const px = Buffer.alloc(n * n * 4);
  const inner = Math.round(n * 0.62);          // comfortably inside the safe zone
  const off = Math.round((n - inner) / 2);
  const src = draw(inner, false);
  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) {
      const a = (y * inner + x) * 4, b = ((y + off) * n + (x + off)) * 4;
      px[b] = src[a]; px[b + 1] = src[a + 1]; px[b + 2] = src[a + 2]; px[b + 3] = src[a + 3];
    }
  }
  return px;
}

const andRes = join(root, 'android', 'app', 'src', 'main', 'res');
let wrote = 0;
for (const d of Object.keys(DENSITY)) {
  const dir = join(andRes, 'mipmap-' + d);
  if (!existsSync(dir)) continue;              // no Android project here
  const n = DENSITY[d];
  writeFileSync(join(dir, 'ic_launcher.png'), png(n, draw(n, true)));
  writeFileSync(join(dir, 'ic_launcher_round.png'), png(n, draw(n, true)));
  writeFileSync(join(dir, 'ic_launcher_foreground.png'), png(FG[d], foreground(FG[d])));
  wrote += 3;
}
if (wrote) {
  /* The background layer, which is the tile's colour and nothing else. It was
     white, which put the mark's own dark tile inside a white circle inside
     whatever shape the launcher wanted — two tiles, one inside the other. */
  const bg = join(andRes, 'values', 'ic_launcher_background.xml');
  if (existsSync(bg)) {
    const hex = '#' + C.tile.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
    writeFileSync(bg, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
      + '    <color name="ic_launcher_background">' + hex + '</color>\n</resources>\n');
  }
  console.log('android: ' + wrote + ' launcher icons across five densities');
}
