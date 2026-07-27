/**
 * One-shot splitter. Carves the original single-file app into src/ parts.
 *
 * This copies LINE RANGES verbatim — no reformatting, no rewriting. The ranges
 * below were read off the section comments that were already in the file.
 * Ranges are contiguous and cover the original exactly, which is what lets
 * `npm run verify` prove the rebuild is byte-identical.
 *
 * You should never need to run this again. It is kept for provenance.
 *   node tools/split.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'tools', 'original.reference.html');

const lines = readFileSync(SRC, 'utf8').split('\n');
const slice = (from, to) => lines.slice(from - 1, to).join('\n') + '\n';

/** [outputPath, firstLine, lastLine] — inclusive, 1-indexed. */
const PARTS = [
  // ---- document head (meta, icons, inline PWA manifest) ----
  ['src/head.html', 1, 16],

  // ---- styles, one file per visual area ----
  ['src/css/00-tokens-base.css', 18, 62],
  ['src/css/01-topbar.css', 63, 72],
  ['src/css/02-views.css', 73, 77],
  ['src/css/03-setup.css', 78, 125],
  ['src/css/04-timer.css', 126, 193],
  ['src/css/05-arcade.css', 194, 239],
  ['src/css/06-picker.css', 240, 271],
  ['src/css/07-sudoku.css', 272, 303],
  ['src/css/08-wordle.css', 304, 331],
  ['src/css/09-banner-toast.css', 332, 346],
  ['src/css/10-misc.css', 347, 378],
  ['src/css/11-quotes.css', 379, 394],
  ['src/css/12-calendar.css', 395, 428],
  ['src/css/13-drawer.css', 429, 460],

  // ---- markup, one file per screen ----
  ['src/body/01-shell-drawer.html', 464, 486],
  ['src/body/02-topbar.html', 487, 498],
  ['src/body/03-setup.html', 499, 533],
  ['src/body/04-timer.html', 534, 573],
  ['src/body/05-shell-close.html', 574, 576],
  ['src/body/06-arcade-picker.html', 577, 603],
  ['src/body/07-arcade-sudoku.html', 604, 615],
  ['src/body/08-arcade-wordle.html', 616, 627],
  ['src/body/09-arcade-close.html', 628, 631],
  ['src/body/10-quotes-overlay.html', 632, 652],
  ['src/body/11-calendar-overlay.html', 653, 676],

  // ---- behaviour, one file per concern ----
  ['src/js/00-prelude.js', 679, 696],
  ['src/js/01-storage.js', 697, 707],
  ['src/js/02-persistence.js', 708, 736],
  ['src/js/03-audio.js', 737, 757],
  ['src/js/04-wakelock.js', 758, 764],
  ['src/js/05-timer-engine.js', 765, 844],
  ['src/js/06-render.js', 845, 907],
  ['src/js/07-presets.js', 908, 926],
  ['src/js/08-events.js', 927, 943],
  ['src/js/09-arcade-core.js', 944, 1007],
  ['src/js/10-sudoku.js', 1008, 1148],
  ['src/js/11-wordle-data.js', 1149, 1155],
  ['src/js/12-wordle.js', 1156, 1244],
  ['src/js/13-arcade-wiring.js', 1245, 1252],
  ['src/js/14-util.js', 1253, 1259],
  ['src/js/15-quotes-data.js', 1260, 1305],
  ['src/js/16-quotes-ui.js', 1306, 1326],
  ['src/js/17-session-log.js', 1327, 1346],
  ['src/js/18-calendar.js', 1347, 1404],
  ['src/js/19-wiring.js', 1405, 1426],
  ['src/js/21-init.js', 1427, 1429],
  ['src/js/99-outro.js', 1430, 1430],
];

// Contiguity check per group — a gap here means silently dropped code.
const groups = { head: [], css: [], body: [], js: [] };
for (const [p, a, b] of PARTS) {
  const key = p.startsWith('src/css') ? 'css'
    : p.startsWith('src/body') ? 'body'
    : p.startsWith('src/js') ? 'js' : 'head';
  groups[key].push([p, a, b]);
}
for (const [name, list] of Object.entries(groups)) {
  for (let i = 1; i < list.length; i++) {
    const prevEnd = list[i - 1][2];
    const start = list[i][1];
    if (start !== prevEnd + 1) {
      throw new Error(`Gap/overlap in ${name}: ${list[i - 1][0]} ends ${prevEnd}, ${list[i][0]} starts ${start}`);
    }
  }
}

for (const [rel, from, to] of PARTS) {
  const out = join(root, rel);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, slice(from, to), 'utf8');
  console.log(`${rel.padEnd(36)} lines ${from}-${to}`);
}
console.log(`\n${PARTS.length} files written.`);
