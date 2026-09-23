/**
 * Cut a tilesheet of pixel art into picross puzzles.
 *
 *   node tools/picross-sheet.mjs <sheet.png> --tile 16 --gap 1 --size 15
 *   --ink alpha|dark|light   what counts as the drawing (default alpha)
 *   node tools/picross-sheet.mjs <sheet.png> --tile 16 --gap 1 --size 15 --take 12,40,77
 *
 * Small pixel art is already the right kind of drawing for a nonogram: one bit
 * a pixel, a few squares across, a shape somebody chose. What it is not is a
 * *puzzle* — most sprites cannot be solved by line logic, and a good few are
 * too empty or too solid to be worth the clues. This slices a sheet, tries
 * every tile, and reports the ones that survive.
 *
 * **Pixels are kept, not resampled.** A tile whose drawn part already fits the
 * target is placed on the grid exactly as the artist left it, centred; nothing
 * is averaged or thinned. Only a tile that is genuinely too big is reduced, and
 * those usually fail the solver anyway.
 *
 * **Licence is yours to check before you run it.** Whatever comes out of here
 * can end up in a published app: use a set that permits redistribution. The
 * pack this was written against is Kenney's 1-Bit Pack, which is CC0.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clues, solve } from './make-picross.mjs';
import { readPng, squares, toGrid } from './picross-import.mjs';
import { rasterSvg } from './svg-raster.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const opt = (n, d) => {
  const at = args.indexOf('--' + n);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : d;
};
const TILE = +opt('tile', 16);
const GAP = +opt('gap', 0);
const SIZE = +opt('size', 15);
const TAKE = opt('take', '').split(',').filter(Boolean).map(Number);
const SHOW = args.includes('--show') || TAKE.length > 0;
const SCALE = args.includes('--scale');
/* --one keeps only pictures that are a single connected shape; --holes N asks
   for at least N pockets of space inside it. Together they are the difference
   between a subject and a scattering of marks. */
const ONE = args.includes('--one');
const HOLES = +opt('holes', 0);

if (!file) { console.log('give me a sheet: node tools/picross-sheet.mjs <sheet.png> --tile 16'); process.exit(1); }

/* What counts as the drawing. A sprite sheet on transparency is 'alpha': the
   art may be white, black or anything else, and the only thing that separates
   it from the background is being there at all. */
const INK = opt('ink', 'alpha');

/* A sheet of tiles, or a folder of separate pictures. Icon packs come as one
   file per icon and are usually drawn far larger than a puzzle, so a folder is
   read at whatever size each file happens to be and reduced below. */
const FOLDER = statSync(file).isDirectory();
const files = FOLDER
  ? readdirSync(file).filter((f) => /\.(png|svg)$/i.test(f)).sort()
  : [];
let img = null, cols = 0, rows = 0;
const step = TILE + GAP;
if (FOLDER) {
  console.log(`${files.length} pictures in ${file}`);
} else {
  img = readPng(readFileSync(file), INK);
  cols = Math.floor((img.w + GAP) / step);
  rows = Math.floor((img.h + GAP) / step);
  console.log(`${img.w}×${img.h}, ${cols}×${rows} tiles of ${TILE}`);
}
const count = FOLDER ? files.length : cols * rows;

/** One picture's pixels, as 1 and 0, at whatever size it was drawn. */
function tileAt(i) {
  if (FOLDER) {
    /* **An SVG is drawn, not sampled.** It has no pixels of its own, so it is
       rendered a few times larger than the grid and reduced by the same path a
       big PNG takes — which keeps thin arms and gaps that rendering straight to
       twenty squares would lose. */
    if (/\.svg$/i.test(files[i])) {
      return rasterSvg(readFileSync(join(file, files[i]), 'utf8'), SIZE * 3) || [[0]];
    }
    const one = readPng(readFileSync(join(file, files[i])), INK);
    const g = [];
    for (let y = 0; y < one.h; y++) {
      const row = [];
      for (let x = 0; x < one.w; x++) row.push(one.ink[y * one.w + x] >= 0.5 ? 1 : 0);
      g.push(row);
    }
    return g;
  }
  const tx = (i % cols) * step, ty = Math.floor(i / cols) * step;
  const g = [];
  for (let y = 0; y < TILE; y++) {
    const row = [];
    for (let x = 0; x < TILE; x++) row.push(img.ink[(ty + y) * img.w + (tx + x)] >= 0.5 ? 1 : 0);
    g.push(row);
  }
  return g;
}

/** The drawn part, with the empty border cut away. */
function trim(g) {
  let top = 0, bottom = g.length - 1, left = 0, right = g[0].length - 1;
  const rowEmpty = (y) => g[y].every((v) => !v);
  const colEmpty = (x) => g.every((r) => !r[x]);
  while (top < bottom && rowEmpty(top)) top++;
  while (bottom > top && rowEmpty(bottom)) bottom--;
  while (left < right && colEmpty(left)) left++;
  while (right > left && colEmpty(right)) right--;
  return g.slice(top, bottom + 1).map((r) => r.slice(left, right + 1));
}

/* **Scaling up, when the art is smaller than the grid.** A 16-pixel drawing
   centred in a 20-square frame leaves an empty border all the way round and
   spends a quarter of the hardest size on nothing. `--scale` stretches the
   drawing to fill instead, by nearest neighbour: a pixel becomes one or two
   squares, so the shape and its holes survive and only the proportions shift
   slightly. Off by default — at a size the art already fits, untouched pixels
   are better. */
function stretch(g, to) {
  const h = g.length, w = g[0].length;
  const out = [];
  for (let y = 0; y < to; y++) {
    const row = [];
    for (let x = 0; x < to; x++) row.push(g[Math.floor(y * h / to)][Math.floor(x * w / to)]);
    out.push(row);
  }
  return out;
}

/** Put a drawing on a SIZE grid: centred and untouched if it fits, else reduced. */
function fit(g) {
  const h = g.length, w = g[0].length;
  if (SCALE && (h < SIZE || w < SIZE)) return { grid: stretch(g, SIZE), exact: false };
  if (h <= SIZE && w <= SIZE) {
    const out = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
    const oy = Math.floor((SIZE - h) / 2), ox = Math.floor((SIZE - w) / 2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[oy + y][ox + x] = g[y][x];
    return { grid: out, exact: true };
  }
  const ink = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) ink[y * w + x] = g[y][x];
  return { grid: toGrid(squares({ w, h, ink }, SIZE), 0.5, false), exact: false };
}

/* ---------------- is it one thing? ----------------
   A picture worth solving is a *subject*: one shape you can name, with some
   space inside it. Scattered marks — three tiles of a wall, a row of pips, the
   corner of a border — pass the solver perfectly well and are nothing to look
   at when finished. Two cheap measures catch almost all of it: the filled
   squares form a single connected piece, and the empty squares include at
   least one pocket the outside cannot reach, which is what an eye, a window or
   a handle is. */
function pieces(g) {
  const n = g.length;
  const seen = g.map((r) => r.map(() => false));
  let count = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!g[y][x] || seen[y][x]) continue;
    count++;
    const stack = [[y, x]];
    seen[y][x] = true;
    while (stack.length) {
      const [cy, cx] = stack.pop();
      for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ny = cy + dy, nx = cx + dx;
        if (ny < 0 || nx < 0 || ny >= n || nx >= n) continue;
        if (g[ny][nx] && !seen[ny][nx]) { seen[ny][nx] = true; stack.push([ny, nx]); }
      }
    }
  }
  return count;
}

/** Empty pockets the border cannot reach — the holes in the drawing. */
function holes(g) {
  const n = g.length;
  const seen = g.map((r) => r.map(() => false));
  const flood = (y, x) => {
    const stack = [[y, x]];
    seen[y][x] = true;
    let size = 0;
    while (stack.length) {
      const [cy, cx] = stack.pop();
      size++;
      for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ny = cy + dy, nx = cx + dx;
        if (ny < 0 || nx < 0 || ny >= n || nx >= n) continue;
        if (!g[ny][nx] && !seen[ny][nx]) { seen[ny][nx] = true; stack.push([ny, nx]); }
      }
    }
    return size;
  };
  for (let i = 0; i < n; i++) {
    if (!g[0][i] && !seen[0][i]) flood(0, i);
    if (!g[n - 1][i] && !seen[n - 1][i]) flood(n - 1, i);
    if (!g[i][0] && !seen[i][0]) flood(i, 0);
    if (!g[i][n - 1] && !seen[i][n - 1]) flood(i, n - 1);
  }
  let found = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!g[y][x] && !seen[y][x]) { flood(y, x); found++; }
  }
  return found;
}

const show = (g) => g.map((r) => '  ' + r.map((v) => (v ? '█' : '·')).join('')).join('\n');

const good = [];
const why = { empty: 0, crowded: 0, stuck: 0, broken: 0, same: 0, scattered: 0, solid: 0 };
const seen = new Set();
for (let i = 0; i < count; i++) {
  const drawn = trim(tileAt(i));
  if (!drawn.length || drawn.every((r) => r.every((v) => !v))) { why.empty++; continue; }
  const { grid, exact } = fit(drawn);
  const filled = grid.flat().filter(Boolean).length;
  if (filled < SIZE) { why.empty++; continue; }
  if (filled > SIZE * SIZE - SIZE) { why.crowded++; continue; }
  const flat = grid.flat().join('');
  if (seen.has(flat)) { why.same++; continue; }
  seen.add(flat);
  if (ONE && pieces(grid) !== 1) { why.scattered++; continue; }
  const inside = holes(grid);
  if (inside < HOLES) { why.solid++; continue; }
  const { rows: rc, cols: cc } = clues(grid);
  const how = solve(rc, cc);
  if (how !== 'solved') { why[how]++; continue; }
  /* A source that names its files is worth far more than one that numbers
      them: 'anchor.png' says what the finished picture is, and a bank of things
      you can name is the difference between a puzzle and a pattern. */
  good.push({ i, grid, exact, filled, holes: inside,
    name: FOLDER ? files[i].replace(/\.(png|svg)$/i, '').replace(/[_-]+/g, ' ') : '' });
}

console.log(`${good.length} tiles make a fair ${SIZE}×${SIZE} puzzle`);
console.log(`  skipped: ${why.empty} too empty, ${why.crowded} too solid, `
  + `${why.stuck} need a guess, ${why.broken} impossible, ${why.same} repeats, `
  + `${why.scattered} more than one piece, ${why.solid} no space inside`);
console.log(`  tile numbers: ${good.map((g) => g.i).join(' ')}`);

if (SHOW) {
  const list = TAKE.length ? good.filter((g) => TAKE.includes(g.i)) : good;
  for (const g of list) {
    console.log(`\n--- tile ${g.i}${g.exact ? '' : ' (reduced)'} ---`);
    console.log(show(g.grid));
  }
}

/* Written out as rows, ready to be pasted into tools/picross-designs.mjs or
   read by whatever picks the final set. Nothing is appended automatically:
   which pictures belong in the app is a decision, not a filter. */
if (opt('out', '')) {
  const out = (TAKE.length ? good.filter((g) => TAKE.includes(g.i)) : good)
    .map((g) => ({ tile: g.i, holes: g.holes, from: opt('from', ''), name: g.name,
      rows: g.grid.map((r) => r.map((v) => (v ? '#' : '.')).join('')) }));
  writeFileSync(join(root, opt('out', '')), JSON.stringify(out, null, 1));
  console.log(`\nwrote ${out.length} to ${opt('out', '')}`);
}
