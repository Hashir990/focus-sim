/**
 * Turn a picture into a picross puzzle.
 *
 *   node tools/picross-import.mjs cat.png --size 15
 *   node tools/picross-import.mjs cat.png --size 15 --append "cat"
 *   node tools/picross-import.mjs sketch.txt --size 10 --append "boat"
 *
 * The point of this tool is that the *drawing* stops being mine. Point it at
 * anything you have the right to use — something you drew, a sprite from a set
 * you own, openly licensed pixel art — and it does the part a person should not
 * have to: reduce it to squares, and then prove the result is a real puzzle.
 *
 * **Proving it is the whole job.** A nonogram is only a puzzle if its clues
 * have exactly one answer and that answer can be reached one line at a time.
 * Both are invisible to the eye. This runs the same solver the hand-drawn
 * designs go through — imported from tools/make-picross.mjs, not copied, so the
 * two can never drift apart — and refuses anything that would need a guess.
 *
 * **Rights are yours to check.** Anything appended here ends up in a published
 * app, so import art you are allowed to distribute: your own, public domain, or
 * a licence that permits it. The tool cannot tell, and does not pretend to.
 *
 * Input: a PNG (8-bit, not interlaced — what every editor writes by default),
 * or a text file of rows using # and . if you would rather type a picture out.
 *
 * Options:
 *   --size N       5, 10 or 15. Default 15.
 *   --append NAME  add it to tools/picross-designs.mjs under that name
 *   --invert       treat light pixels as filled instead of dark
 *   --level N      0..1, where the line between filled and empty falls (0.5)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { clues, solve } from './make-picross.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/** The sizes the app publishes, and the only ones a bank may hold. */
export const SIZES = [15, 20, 30];

/* ---------------- reading a PNG ----------------
   Written out rather than pulled in: this repo has no image library and one
   dependency for one tool is a poor trade. Only what an image editor actually
   writes is handled — eight bits a channel, not interlaced — and anything else
   says so plainly instead of producing a wrong picture. */
/* `mode` is what counts as ink: 'dark' for a drawing in dark pixels on a pale
   page, 'light' for the reverse, 'alpha' for a sprite on transparency where the
   colour is irrelevant and being *there* is the whole signal. A sheet of white
   art on nothing reads as blank under 'dark', which is the first thing that
   went wrong when this met a real pack. */
export function readPng(buf, mode = 'dark') {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let at = 8, w = 0, h = 0, depth = 0, kind = 0, interlace = 0;
  const idat = [];
  let palette = null, trns = null;
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const tag = buf.toString('ascii', at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (tag === 'IHDR') {
      w = body.readUInt32BE(0); h = body.readUInt32BE(4);
      depth = body[8]; kind = body[9]; interlace = body[12];
    } else if (tag === 'PLTE') palette = body;
    else if (tag === 'tRNS') trns = body;
    else if (tag === 'IDAT') idat.push(body);
    else if (tag === 'IEND') break;
    at += 12 + len;
  }
  if (interlace) throw new Error('this reads non-interlaced PNGs; save it again without interlacing');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[kind];
  if (!channels) throw new Error('unsupported PNG colour type ' + kind);
  /* **One bit a pixel is the format this most wants.** Monochrome pixel art is
     usually saved as a 1-bit palette image, so packing under eight bits is
     handled rather than refused: the scanline is unfiltered at byte level as
     always, then unpacked into one byte per pixel before anything looks at it. */
  if (![1, 2, 4, 8].includes(depth)) throw new Error('PNG bit depth ' + depth + ' is not handled');
  if (depth !== 8 && kind !== 0 && kind !== 3) {
    throw new Error('under 8 bits, only greyscale and palette PNGs are handled');
  }

  const raw = inflateSync(Buffer.concat(idat));
  const packed = depth < 8;
  const stride = packed ? Math.ceil(w * depth / 8) : w * channels;
  const out = Buffer.alloc(h * stride);
  /* Each scanline is filtered against the one above it; undoing that is the
     whole of PNG decoding once the bytes are inflated. */
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? out[y * stride + i - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + i] : 0;
      const c = (i >= channels && y > 0) ? out[(y - 1) * stride + i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      out[y * stride + i] = v & 255;
    }
  }
  /* Unpack sub-byte pixels into one byte each, so everything below can read a
     pixel without caring how it was stored. A 1-bit palette index becomes 0 or
     1; a 1-bit greyscale becomes 0 or 255. */
  let pix = out;
  if (packed) {
    pix = Buffer.alloc(w * h);
    const max = (1 << depth) - 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const bit = x * depth;
        const byte = out[y * stride + (bit >> 3)];
        const shift = 8 - depth - (bit & 7);
        const v = (byte >> shift) & max;
        pix[y * w + x] = kind === 3 ? v : Math.round(v * 255 / max);
      }
    }
  }

  /* Ink, not colour: how dark a pixel is, and whether it is there at all. */
  const ink = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    let r, g, b, alpha = 255;
    if (kind === 0) { r = g = b = pix[i]; }
    else if (kind === 4) { r = g = b = pix[i * 2]; alpha = pix[i * 2 + 1]; }
    else if (kind === 2) { r = pix[i * 3]; g = pix[i * 3 + 1]; b = pix[i * 3 + 2]; }
    else if (kind === 6) { r = pix[i * 4]; g = pix[i * 4 + 1]; b = pix[i * 4 + 2]; alpha = pix[i * 4 + 3]; }
    else {
      const p = pix[i] * 3;
      r = palette[p]; g = palette[p + 1]; b = palette[p + 2];
      if (trns && trns[pix[i]] != null) alpha = trns[pix[i]];
    }
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    /* A transparent pixel is background whatever colour it claims to be, which
       is what makes a sprite on nothing import as a shape rather than a box. */
    const seen = alpha / 255;
    ink[i] = mode === 'alpha' ? seen : seen * (mode === 'light' ? lum : 1 - lum);
  }
  return { w, h, ink };
}

/* ---------------- reducing it to squares ----------------
   Box average, not nearest neighbour: a one-pixel line hit between samples
   disappears under nearest neighbour, which is how an importer turns a drawing
   into a picture with a leg missing. Averaging keeps it as a grey the
   threshold can then decide about. */
export function squares(img, n) {
  const out = [];
  for (let y = 0; y < n; y++) {
    const row = [];
    for (let x = 0; x < n; x++) {
      const x0 = Math.floor(x * img.w / n), x1 = Math.max(x0 + 1, Math.floor((x + 1) * img.w / n));
      const y0 = Math.floor(y * img.h / n), y1 = Math.max(y0 + 1, Math.floor((y + 1) * img.h / n));
      let sum = 0, count = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { sum += img.ink[yy * img.w + xx]; count++; }
      row.push(count ? sum / count : 0);
    }
    out.push(row);
  }
  return out;
}

export function toGrid(grey, level, invert) {
  return grey.map((row) => row.map((v) => ((invert ? 1 - v : v) >= level ? 1 : 0)));
}

/* Run only when this file is the command. Imported — by tools/picross-sheet.mjs,
   which slices a tilesheet and reads every tile the same way — it defines and
   exports, and touches nothing. */
const RUN = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (RUN) {
  /* ---------------- the work ----------------
     Arguments are read in here and not at the top of the file. They were at the
     top, and importing this module from tools/picross-sheet.mjs then read *its*
     command line: a --size the importer did not allow printed the importer's
     complaint and exited a tool that had asked it for nothing. A module has to
     be silent when imported. */
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const opt = (name, fallback) => {
    const at = args.indexOf('--' + name);
    return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : fallback;
  };
  const SIZE = +opt('size', 15);
  const NAME = opt('append', '');
  const INVERT = args.includes('--invert');
  const LEVEL = +opt('level', 0.5);

  if (!file) {
    console.log('Give me a picture: node tools/picross-import.mjs <file.png|file.txt> --size 15');
    process.exit(1);
  }
  if (!SIZES.includes(SIZE)) {
    console.log('--size has to be ' + SIZES.join(', ') + '; those are the ones the app publishes.');
    process.exit(1);
  }

  const path = file.includes(':') || file.startsWith('/') ? file : join(process.cwd(), file);
  let grid;
  if (extname(path).toLowerCase() === '.txt') {
    const rows = readFileSync(path, 'utf8').split('\n').map((r) => r.replace(/\s+$/, '')).filter(Boolean);
    if (rows.length !== SIZE || rows.some((r) => r.length !== SIZE)) {
      console.log(`that text is ${rows.length} rows of ${rows[0] ? rows[0].length : 0}; --size says ${SIZE}`);
      process.exit(1);
    }
    grid = rows.map((r) => [...r].map((c) => (c === '#' || c === '1' ? 1 : 0)));
  } else {
    let img;
    try { img = readPng(readFileSync(path)); }
    catch (e) { console.log('could not read it: ' + e.message); process.exit(1); }
    const grey = squares(img, SIZE);
    grid = toGrid(grey, LEVEL, INVERT);
    /* A picture that came out nearly blank or nearly solid is almost always the
       wrong way round — light art on a dark page, or the other way. Say so with
       the flag that fixes it rather than leaving a grid of one colour. */
    const filled = grid.flat().filter(Boolean).length;
    const part = filled / (SIZE * SIZE);
    if (part < 0.12 || part > 0.88) {
      console.log(`only ${Math.round(part * 100)}% of the squares came out filled — try `
        + (INVERT ? 'without --invert' : '--invert') + ', or a different --level.');
    }
  }

  const rowsText = grid.map((r) => r.map((v) => (v ? '#' : '.')).join(''));
  console.log(rowsText.map((r) => '  ' + r.split('#').join('█').split('.').join('·')).join('\n'));
  console.log('');

  const { rows: rc, cols: cc } = clues(grid);
  const how = solve(rc, cc);
  const filled = grid.flat().filter(Boolean).length;
  if (filled < SIZE || filled > SIZE * SIZE - SIZE) {
    console.log(`✗ ${filled} filled squares is too ${filled < SIZE ? 'few' : 'many'} for a ${SIZE}×${SIZE}.`);
    process.exit(1);
  }
  if (how !== 'solved') {
    console.log(how === 'broken'
      ? '✗ those clues contradict each other, which should not happen — please report it.'
      : '✗ this one needs a guess somewhere, so it is not a fair puzzle.\n'
        + '  Usually a detail too fine for the grid: try a simpler picture, a bigger'
        + ' --size, or a --level that thickens the shape.');
    process.exit(1);
  }
  console.log('✓ solvable by logic alone, so its answer is the only one');

  if (!NAME) {
    console.log('\nAdd --append "a name" to put it in tools/picross-designs.mjs.');
    process.exit(0);
  }

  /* Appended to the end of its list, never inserted: a puzzle's date is its
     position counted from the epoch, so inserting would move every date after it
     and orphan the boards people have already saved. */
  const designs = join(root, 'tools', 'picross-designs.mjs');
  const marker = { 5: 'export const EASY', 10: 'export const MEDIUM', 15: 'export const HARD' }[SIZE];
  let src = readFileSync(designs, 'utf8');
  const listAt = src.indexOf(marker);
  const endAt = SIZE === 15 ? src.lastIndexOf('];') : src.lastIndexOf('];', src.indexOf('export const', listAt + 10));
  const entry = `\n  { name: '${NAME.replace(/'/g, "\\'")}', rows: [\n`
    + rowsText.map((r) => `    '${r}'`).join(',\n') + '] },\n';
  src = src.slice(0, endAt) + entry + src.slice(endAt);
  writeFileSync(designs, src, 'utf8');
  console.log(`\nappended to ${marker.split(' ').pop()} as "${NAME}".`);
  console.log('The three sizes have to stay level with each other, so add one at each'
    + ' size before running: node tools/make-picross.mjs');

}
