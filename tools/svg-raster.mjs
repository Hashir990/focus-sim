/**
 * Turn an SVG icon into a grid of filled squares.
 *
 *   node tools/svg-raster.mjs icon.svg --size 20        look at one
 *
 * **Why this exists.** Every large library of named, drawn objects is SVG —
 * game-icons.net, Tabler, Lucide, thousands of things with real internal
 * structure. A nonogram wants exactly that and could not read any of it,
 * because this repo has no renderer and one dependency for one tool is a poor
 * trade. So: a small one. It does the part that matters for a picture made of
 * squares and nothing else.
 *
 * What it handles: `path` (every command including arcs), `rect`, `circle`,
 * `ellipse`, `polygon`, `polyline`, and the `viewBox`. What it ignores:
 * strokes, gradients, transforms on groups, text, masks, and clip paths. An
 * icon drawn as an unfilled outline comes out empty, which is visible
 * immediately and is why the CLI prints the result.
 *
 * **Ink is the drawing, not the page.** The convention in these sets is a
 * black square behind a white drawing, so a shape painted white is ink and the
 * full-canvas background is not. Where nothing says otherwise, every filled
 * shape is ink.
 */
import { readFileSync } from 'node:fs';

/* ---------------- path data into polygons ---------------- */

/** Split "M10 10 L20 20" into [{cmd:'M', args:[10,10]}, ...]. */
function commands(d) {
  const out = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  let m;
  while ((m = re.exec(d))) {
    const args = (m[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
    out.push({ cmd: m[1], args });
  }
  return out;
}

const CURVE_STEPS = 18;      // enough at any size a puzzle grid can show

function cubic(p0, p1, p2, p3, push) {
  for (let i = 1; i <= CURVE_STEPS; i++) {
    const t = i / CURVE_STEPS, u = 1 - t;
    push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
}

function quad(p0, p1, p2, push) {
  for (let i = 1; i <= CURVE_STEPS; i++) {
    const t = i / CURVE_STEPS, u = 1 - t;
    push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ]);
  }
}

/* An elliptical arc, from the endpoint form SVG uses to the centre form a
   renderer needs. Straight out of the SVG implementation notes; the fiddly
   parts are the two flags and the radius correction when the given radii are
   too small to reach. */
function arc(p0, rx, ry, rot, large, sweep, p1, push) {
  if (!rx || !ry) { push(p1); return; }
  const rad = (rot * Math.PI) / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  rx = Math.abs(rx); ry = Math.abs(ry);
  const check = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (check > 1) { const s = Math.sqrt(check); rx *= s; ry *= s; }
  const denom = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let factor = (rx * rx * ry * ry - denom) / denom;
  factor = Math.sqrt(Math.max(0, factor)) * (large === sweep ? -1 : 1);
  const cx1 = (factor * rx * y1) / ry, cy1 = (-factor * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt(ux * ux + uy * uy) * Math.sqrt(vx * vx + vy * vy);
    let a = Math.acos(Math.min(1, Math.max(-1, dot / (len || 1))));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const start = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let sweepAngle = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI;
  if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI;
  const steps = Math.max(6, Math.ceil(Math.abs(sweepAngle) / (Math.PI / 12)));
  for (let i = 1; i <= steps; i++) {
    const a = start + (sweepAngle * i) / steps;
    const px = Math.cos(a) * rx, py = Math.sin(a) * ry;
    push([cos * px - sin * py + cx, sin * px + cos * py + cy]);
  }
}

/** A path's `d` into closed rings of points. */
export function pathRings(d) {
  const rings = [];
  let ring = [], at = [0, 0], start = [0, 0], prevCtrl = null, prevCmd = '';
  const push = (p) => { ring.push(p); at = p; };
  const close = () => { if (ring.length > 2) rings.push(ring); ring = []; };
  for (const { cmd, args } of commands(d)) {
    const rel = cmd === cmd.toLowerCase();
    const k = cmd.toUpperCase();
    const pair = (i) => (rel ? [at[0] + args[i], at[1] + args[i + 1]] : [args[i], args[i + 1]]);
    if (k === 'M') {
      close();
      at = pair(0); start = at; ring = [at];
      for (let i = 2; i + 1 < args.length; i += 2) push(pair(i));
    } else if (k === 'L') {
      for (let i = 0; i + 1 < args.length; i += 2) push(pair(i));
    } else if (k === 'H') {
      for (const v of args) push([rel ? at[0] + v : v, at[1]]);
    } else if (k === 'V') {
      for (const v of args) push([at[0], rel ? at[1] + v : v]);
    } else if (k === 'C' || k === 'S') {
      const step = k === 'C' ? 6 : 4;
      for (let i = 0; i + step - 1 < args.length; i += step) {
        const p0 = at;
        let c1, c2, end;
        if (k === 'C') { c1 = pair(i); c2 = pair(i + 2); end = pair(i + 4); }
        else {
          c1 = (prevCmd === 'C' || prevCmd === 'S') && prevCtrl
            ? [2 * p0[0] - prevCtrl[0], 2 * p0[1] - prevCtrl[1]] : p0;
          c2 = pair(i); end = pair(i + 2);
        }
        cubic(p0, c1, c2, end, push);
        prevCtrl = c2;
      }
    } else if (k === 'Q' || k === 'T') {
      const step = k === 'Q' ? 4 : 2;
      for (let i = 0; i + step - 1 < args.length; i += step) {
        const p0 = at;
        let c1, end;
        if (k === 'Q') { c1 = pair(i); end = pair(i + 2); }
        else {
          c1 = (prevCmd === 'Q' || prevCmd === 'T') && prevCtrl
            ? [2 * p0[0] - prevCtrl[0], 2 * p0[1] - prevCtrl[1]] : p0;
          end = pair(i);
        }
        quad(p0, c1, end, push);
        prevCtrl = c1;
      }
    } else if (k === 'A') {
      for (let i = 0; i + 6 < args.length; i += 7) {
        const end = rel ? [at[0] + args[i + 5], at[1] + args[i + 6]] : [args[i + 5], args[i + 6]];
        arc(at, args[i], args[i + 1], args[i + 2], args[i + 3], args[i + 4], end, push);
      }
    } else if (k === 'Z') {
      if (ring.length) { ring.push(start); close(); at = start; }
    }
    if (k !== 'C' && k !== 'S' && k !== 'Q' && k !== 'T') prevCtrl = null;
    prevCmd = k;
  }
  close();
  return rings;
}

/* ---------------- the other shapes ---------------- */

const attr = (tag, name) => {
  const m = tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"'));
  return m ? m[1] : null;
};
const num = (tag, name, fallback = 0) => {
  const v = attr(tag, name);
  return v == null ? fallback : parseFloat(v);
};

function shapeRings(tag) {
  const kind = (tag.match(/^<\s*([a-zA-Z]+)/) || [, ''])[1];
  if (kind === 'path') return pathRings(attr(tag, 'd') || '');
  if (kind === 'rect') {
    const x = num(tag, 'x'), y = num(tag, 'y'), w = num(tag, 'width'), h = num(tag, 'height');
    return [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]];
  }
  if (kind === 'circle' || kind === 'ellipse') {
    const cx = num(tag, 'cx'), cy = num(tag, 'cy');
    const rx = kind === 'circle' ? num(tag, 'r') : num(tag, 'rx');
    const ry = kind === 'circle' ? num(tag, 'r') : num(tag, 'ry');
    const ring = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      ring.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    return [ring];
  }
  if (kind === 'polygon' || kind === 'polyline') {
    const pts = (attr(tag, 'points') || '').match(/-?\d*\.?\d+/g) || [];
    const ring = [];
    for (let i = 0; i + 1 < pts.length; i += 2) ring.push([+pts[i], +pts[i + 1]]);
    if (ring.length > 2) { ring.push(ring[0]); return [ring]; }
  }
  return [];
}

/* ---------------- filling ---------------- */

/**
 * Rings into an n×n grid of 0/1.
 * Scanlines with the nonzero winding rule, several per row of squares, and
 * horizontal coverage measured exactly rather than sampled — a one-unit line
 * in a 512-unit drawing is thinner than a sample step, and sampling drops it.
 */
export function fillGrid(rings, box, n, { samples = 5, level = 0.5 } = {}) {
  const [bx, by, bw, bh] = box;
  const scale = Math.min(n / bw, n / bh);
  const offX = (n - bw * scale) / 2, offY = (n - bh * scale) / 2;
  const pts = rings.map((r) => r.map(([x, y]) => [
    (x - bx) * scale + offX,
    (y - by) * scale + offY,
  ]));
  const cover = Array.from({ length: n }, () => new Float64Array(n));
  for (let row = 0; row < n; row++) {
    for (let s = 0; s < samples; s++) {
      const y = row + (s + 0.5) / samples;
      const hits = [];
      for (const ring of pts) {
        for (let i = 0; i + 1 < ring.length; i++) {
          const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
          if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
            hits.push({ x: x1 + ((y - y1) / (y2 - y1)) * (x2 - x1), dir: y2 > y1 ? 1 : -1 });
          }
        }
      }
      if (!hits.length) continue;
      hits.sort((a, b) => a.x - b.x);
      let wind = 0;
      for (let i = 0; i < hits.length - 1; i++) {
        wind += hits[i].dir;
        if (wind === 0) continue;
        const from = Math.max(0, hits[i].x), to = Math.min(n, hits[i + 1].x);
        if (to <= from) continue;
        for (let c = Math.floor(from); c < Math.min(n, Math.ceil(to)); c++) {
          const part = Math.min(to, c + 1) - Math.max(from, c);
          if (part > 0) cover[row][c] += part / samples;
        }
      }
    }
  }
  return cover.map((r) => [...r].map((v) => (v >= level ? 1 : 0)));
}

/** An SVG's text into an n×n grid. */
export function rasterSvg(text, n, opts = {}) {
  const head = text.match(/<svg[^>]*>/i);
  const vb = head ? attr(head[0], 'viewBox') : null;
  const nums = vb ? vb.split(/[\s,]+/).map(Number) : null;
  const box = nums && nums.length === 4 && nums[2] > 0 && nums[3] > 0
    ? nums
    : [0, 0, num(head ? head[0] : '', 'width', 512), num(head ? head[0] : '', 'height', 512)];

  const tags = text.match(/<(path|rect|circle|ellipse|polygon|polyline)\b[^>]*>/gi) || [];
  /* **The page is not the picture.** These sets draw a black square and put a
     white shape on it, so where anything is painted white that is the drawing
     and everything else is the background it sits on. Where nothing says so,
     every filled shape counts. */
  const white = (t) => /fill\s*=\s*"(#fff|#ffffff|white)"/i.test(t);
  const inked = tags.some(white) ? tags.filter(white) : tags.filter((t) => !/fill\s*=\s*"none"/i.test(t));
  const rings = [];
  for (const t of inked) rings.push(...shapeRings(t));
  if (!rings.length) return null;
  return fillGrid(rings, box, n, opts);
}

/* ---------------- looking at one ---------------- */

const RUN = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (RUN && process.argv[2]) {
  const file = process.argv[2];
  const at = process.argv.indexOf('--size');
  const n = at > 0 ? +process.argv[at + 1] : 20;
  const grid = rasterSvg(readFileSync(file, 'utf8'), n);
  if (!grid) { console.log('nothing filled — an outline-only icon?'); process.exit(1); }
  for (const row of grid) console.log('  ' + row.map((v) => (v ? '█' : '·')).join(''));
  const filled = grid.flat().filter(Boolean).length;
  console.log(`  ${filled} of ${n * n} squares filled`);
}
