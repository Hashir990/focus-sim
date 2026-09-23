/**
 * Look at the picross bank — every puzzle in it, and what one looks like to
 * play.
 *
 * Unlike the other look tools this one needs no browser: the pictures are the
 * only thing being photographed, and they are squares. It reads the *shipped*
 * bank rather than the designs, so what lands in the sheet is what the app
 * hands out; the designs are read only to put a name under each one and to say
 * out loud if the two have drifted apart.
 *
 *   node tools/look-picross.mjs [out.html]
 *
 * The names are for us. They are not in the app and must not be — the picture
 * is the answer, so a name above it is the answer printed above the question.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EASY, MEDIUM, HARD } from './picross-designs.mjs';
import { effort } from './make-picross.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ? join(root, process.argv[2]) : join(root, 'look', 'picross-bank.html');
mkdirSync(dirname(out), { recursive: true });

/* The bank is a fragment of the one big IIFE, so it cannot be imported. Taking
   it from `const PIC_BANK` to the end and asking for the value back is enough,
   and it means the sheet can never disagree with the file. */
const bankSrc = readFileSync(join(root, 'src', 'js', '27a-picross-data.js'), 'utf8');
const PIC_BANK = new Function(bankSrc.slice(bankSrc.indexOf('const PIC_BANK'))
  + '\nreturn PIC_BANK;')();

const gameSrc = readFileSync(join(root, 'src', 'js', '27b-picross.js'), 'utf8');
const EPOCH = (gameSrc.match(/const PIC_EPOCH = '([\d-]+)'/) || [, '?'])[1];

/* Which size each tier is, read from the game rather than repeated here — they
   have changed once already, and a sheet that keeps its own copy draws the bank
   it remembers instead of the bank that shipped. */
const sizeOf = (diff) => {
  const m = gameSrc.match(/const PIC_SIZE = \{([^}]*)\}/);
  const at = (m ? m[1] : '').match(new RegExp(diff + '\\s*:\\s*(\\d+)'));
  return at ? +at[1] : 0;
};
const SIZES = [
  { diff: 'easy', designs: EASY },
  { diff: 'medium', designs: MEDIUM },
  { diff: 'hard', designs: HARD },
].map((s) => {
  const n = sizeOf(s.diff);
  return { ...s, n, label: n + '×' + n };
});

const grid = (flat, n) => {
  const rows = [];
  for (let y = 0; y < n; y++) rows.push([...flat.slice(y * n, y * n + n)].map(Number));
  return rows;
};
const clue = (line) => {
  const o = []; let run = 0;
  for (const v of line) { if (v) run++; else if (run) { o.push(run); run = 0; } }
  if (run) o.push(run);
  return o.length ? o : [0];
};
const col = (rows, x) => rows.map((r) => r[x]);

const DAY = 86400000;
const when = (i) => {
  const d = new Date(EPOCH + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + i);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
};

/* --- the picture on its own, for the contact sheet --- */
function thumb(rows, px) {
  const n = rows.length, w = n * px;
  const parts = [];
  /* One rect per run rather than per square: a 15×15 is 225 squares and there
     are ninety of them on the page. */
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (!rows[y][x]) { x++; continue; }
      let e = x; while (e < n && rows[y][e]) e++;
      parts.push(`<rect x="${x * px}" y="${y * px}" width="${(e - x) * px}" height="${px}"/>`);
      x = e;
    }
  }
  const lines = [];
  for (let i = 0; i <= n; i++) {
    const heavy = i % 5 === 0;
    lines.push(`<line x1="${i * px}" y1="0" x2="${i * px}" y2="${w}" class="${heavy ? 'h' : 'l'}"/>`);
    lines.push(`<line x1="0" y1="${i * px}" x2="${w}" y2="${i * px}" class="${heavy ? 'h' : 'l'}"/>`);
  }
  return `<svg class="pic" viewBox="-.5 -.5 ${w + 1} ${w + 1}" width="${w}" height="${w}">
    <g class="fill">${parts.join('')}</g><g class="rule">${lines.join('')}</g></svg>`;
}

/* --- the same puzzle as it is actually met: numbers, and nothing filled in --- */
function board(rows, px, { solved = false } = {}) {
  const n = rows.length;
  const rc = rows.map(clue);
  const cc = Array.from({ length: n }, (_, x) => clue(col(rows, x)));
  const fs = Math.round(px * 0.62);
  const gutL = Math.max(...rc.map((c) => c.length)) * (fs * 0.78) + 6;
  const gutT = Math.max(...cc.map((c) => c.length)) * (fs * 1.05) + 6;
  const w = gutL + n * px, h = gutT + n * px;
  const p = [];

  for (let y = 0; y < n; y++) {
    p.push(`<text x="${gutL - 5}" y="${gutT + y * px + px / 2}" class="clue" text-anchor="end"
      dominant-baseline="central">${rc[y].join(' ')}</text>`);
  }
  for (let x = 0; x < n; x++) {
    const c = cc[x];
    c.forEach((v, k) => {
      const y = gutT - (c.length - 1 - k) * (fs * 1.05) - 5;
      p.push(`<text x="${gutL + x * px + px / 2}" y="${y}" class="clue" text-anchor="middle">${v}</text>`);
    });
  }
  if (solved) {
    for (let y = 0; y < n; y++) {
      let x = 0;
      while (x < n) {
        if (!rows[y][x]) { x++; continue; }
        let e = x; while (e < n && rows[y][e]) e++;
        p.push(`<rect x="${gutL + x * px}" y="${gutT + y * px}" width="${(e - x) * px}"
          height="${px}" class="on"/>`);
        x = e;
      }
    }
  }
  for (let i = 0; i <= n; i++) {
    const heavy = i % 5 === 0;
    p.push(`<line x1="${gutL + i * px}" y1="${gutT}" x2="${gutL + i * px}" y2="${h}" class="${heavy ? 'h' : 'l'}"/>`);
    p.push(`<line x1="${gutL}" y1="${gutT + i * px}" x2="${w}" y2="${gutT + i * px}" class="${heavy ? 'h' : 'l'}"/>`);
  }
  return `<svg class="board" viewBox="-.5 -.5 ${w + 1} ${h + 1}" width="${w}" height="${h}"
    font-size="${fs}">${p.join('')}</svg>`;
}

/* The designs are only here for the labels, so a bank that has drifted from
   them would put the wrong name under a picture. Say so rather than guess. */
let drift = 0;
const sheets = SIZES.map(({ n, label, designs }) => {
  const list = PIC_BANK[n] || [];
  const hard = [];
  const cells = list.map((flat, i) => {
    const d = designs[i];
    const same = d && d.rows.join('').split('#').join('1').split('.').join('0') === flat;
    if (!same) drift++;
    /* **How hard it is, under every picture.** A tier called Big that is full of
       puzzles solved by their own first pass is a claim the bank does not keep,
       and the only way to see that is to solve all of them and print it. */
    const e = effort(grid(flat, n));
    hard.push(e.score);
    return `<figure><div class="box">${thumb(grid(flat, n), n <= 5 ? 20 : n <= 10 ? 12 : n <= 15 ? 9 : n <= 20 ? 7 : 5)}</div>
      <figcaption><b>${when(i)}</b><span>${same ? d.name : '— not the design we drew —'}</span>
      </figcaption><p class="hard">${e.rounds} passes · ${Math.round(e.opening * 100)}% given away</p>
      </figure>`;
  }).join('');
  const mid = hard.slice().sort((a, b) => a - b)[Math.floor(hard.length / 2)];
  return `<section><h2>${label}<em>${list.length} puzzles, one a day from ${when(0)}
    — difficulty ${mid.toFixed(0)} in the middle, ${Math.min(...hard).toFixed(0)} to
    ${Math.max(...hard).toFixed(0)}</em></h2>
    <div class="sheet s${n}">${cells}</div></section>`;
}).join('');

const plays = SIZES.map(({ n, label, designs }) => {
  const rows = grid(PIC_BANK[n][0], n);
  const px = n <= 5 ? 34 : n <= 10 ? 26 : 20;
  return `<figure class="play"><figcaption>${label} — what you are given</figcaption>
    <div class="box">${board(rows, px)}</div></figure>
    <figure class="play"><figcaption>and what it turns out to be (${designs[0].name})</figcaption>
    <div class="box">${board(rows, px, { solved: true })}</div></figure>`;
}).join('');

const page = `<!doctype html><meta charset="utf-8"><title>Picross bank</title>
<style>
  :root{ --bg:#0b1220; --bg2:#111a2c; --accent:#8aa2f0; --text:#e7ecf6; --muted:#8695b4;
         --card:rgba(255,255,255,.045); --line:rgba(255,255,255,.14) }
  body{ margin:0; padding:26px 22px 60px; background:var(--bg);
        font:14px/1.5 system-ui,Segoe UI,sans-serif; color:var(--text) }
  h1{ font-size:20px; margin:0 0 4px }
  .lede{ color:var(--muted); margin:0 0 26px; max-width:70ch }
  h2{ font-size:15px; margin:30px 0 12px; display:flex; align-items:baseline; gap:10px;
      border-bottom:1px solid var(--line); padding-bottom:7px }
  h2 em{ font-style:normal; font-size:12px; color:var(--muted); font-weight:400 }
  .box{ background:var(--bg2); border:1px solid var(--line); border-radius:10px; padding:8px;
        display:grid; place-items:center }
  .sheet{ display:grid; gap:12px }
  .s5{ grid-template-columns:repeat(auto-fill, minmax(112px,1fr)) }
  .s10{ grid-template-columns:repeat(auto-fill, minmax(136px,1fr)) }
  .s15{ grid-template-columns:repeat(auto-fill, minmax(150px,1fr)) }
  figure{ margin:0 }
  .hard{ margin:2px 0 0; font-size:10px; color:color-mix(in srgb, var(--muted) 70%, transparent) }
  figcaption{ margin-top:5px; font-size:11px; color:var(--muted); display:flex; gap:6px;
              justify-content:space-between; align-items:baseline }
  figcaption b{ color:var(--text); font-weight:600 }
  .plays{ display:flex; flex-wrap:wrap; gap:14px; align-items:flex-start }
  .play figcaption{ display:block; margin:0 0 5px }
  svg .fill rect, svg rect.on{ fill:var(--accent) }
  svg .l{ stroke:var(--line); stroke-width:1 }
  svg .h{ stroke:rgba(255,255,255,.34); stroke-width:1 }
  svg .clue{ fill:var(--muted) }
  svg{ display:block }
</style>
<h1>The picross bank</h1>
<p class="lede">Every puzzle in the app, drawn from <code>src/js/27a-picross-data.js</code> —
  ninety of them, one of each size a day from ${when(0)}. Each was solved by line logic alone
  before it was allowed in, which is what makes its answer the only one.
  The names are ours and stay in the tools: in the app the picture is the answer.</p>

<h2>What a puzzle looks like<em>the first of each size</em></h2>
<div class="plays">${plays}</div>
${sheets}
`;

writeFileSync(out, page);
console.log('wrote ' + out);
console.log(drift === 0
  ? 'every shipped puzzle is the design it came from ✓'
  : drift + ' shipped puzzle(s) no longer match the design ✗');
