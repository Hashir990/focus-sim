/**
 * How hard is each puzzle in the bank, really?
 *
 *   node tools/picross-grade.mjs            the distribution, per size
 *   node tools/picross-grade.mjs --list     every puzzle, hardest first
 *
 * **Size is not difficulty.** A 30×30 of one fat shape can fall out in two
 * passes; a 15×15 of thin legs and gaps can take eight. The tiers are named
 * Small, Middling and Big, and a player reasonably reads those as easy, harder,
 * hardest — so the bank has to actually be ordered that way, and the only
 * honest way to know is to solve every puzzle and count the work.
 *
 * The measure is the solver's own effort, which is the same effort a person
 * spends:
 *
 *   rounds   how many full passes over rows and columns before nothing more
 *            could be forced. One pass is a giveaway; six is a sit-down.
 *   opening  the share of the grid decided by the first pass. A puzzle that
 *            hands you two thirds up front feels easy whatever its size.
 *   runs     average number of clue numbers in a line — how much bookkeeping
 *            each line asks for.
 *
 * These are combined into one number only for sorting; the parts are printed
 * because they mean different things to a player and a single score hides that.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { effort } from './make-picross.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIST = process.argv.includes('--list');

const src = readFileSync(join(root, 'src', 'js', '27a-picross-data.js'), 'utf8');
const PIC_BANK = new Function(src.slice(src.indexOf('const PIC_BANK')) + '\nreturn PIC_BANK;')();
/* The names live beside the designs, not in the shipped bank. */
const { EASY, MEDIUM, HARD } = await import('./picross-designs.mjs');
const byTier = { EASY, MEDIUM, HARD };

const tiers = [['EASY', 'Small'], ['MEDIUM', 'Middling'], ['HARD', 'Big']];
const sizes = Object.keys(PIC_BANK).map(Number).sort((a, b) => a - b);
const graded = {};

sizes.forEach((n, i) => {
  const [tier, label] = tiers[i];
  const names = byTier[tier].map((d) => d.name);
  graded[n] = PIC_BANK[n].map((flat, k) => {
    const g = [];
    for (let y = 0; y < n; y++) g.push([...flat.slice(y * n, y * n + n)].map(Number));
    return { n, label, name: names[k] || '?', ...effort(g) };
  });
});

const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const pct = (v) => Math.round(v * 100) + '%';

console.log('size  tier        puzzles  rounds (median, worst)  opening (median)  runs/line');
for (const n of sizes) {
  const g = graded[n];
  const rounds = g.map((x) => x.rounds);
  console.log(
    String(n + '×' + n).padEnd(6)
    + g[0].label.padEnd(12)
    + String(g.length).padEnd(9)
    + (median(rounds) + ', ' + Math.max(...rounds)).padEnd(24)
    + pct(median(g.map((x) => x.opening))).padEnd(18)
    + median(g.map((x) => x.runs)).toFixed(1),
  );
}

/* The claim the tiers make, tested: each size should be harder than the one
   below it, by the middle of its range rather than by its extremes. */
const mids = sizes.map((n) => median(graded[n].map((x) => x.score)));
const ordered = mids.every((v, i) => i === 0 || v >= mids[i - 1]);
console.log('\nmedian difficulty: ' + mids.map((v, i) => sizes[i] + '×' + sizes[i] + ' ' + v.toFixed(0)).join('  →  '));
console.log(ordered
  ? 'the tiers are in order: each size is harder than the one below ✓'
  : 'THE TIERS ARE OUT OF ORDER — a later size is easier than an earlier one ✗');

/* Within a size, the outliers are what a player notices: a Big that falls out
   in two passes reads as a mistake, and a Small that takes eight reads as one
   too. */
for (const n of sizes) {
  const g = graded[n].slice().sort((a, b) => a.score - b.score);
  console.log(`\n${n}×${n} easiest: ` + g.slice(0, 3).map((x) => `${x.name.split(' · ')[0]} (${x.rounds} rounds, ${pct(x.opening)} opening)`).join(', '));
  console.log(`${n}×${n} hardest: ` + g.slice(-3).reverse().map((x) => `${x.name.split(' · ')[0]} (${x.rounds} rounds, ${pct(x.opening)} opening)`).join(', '));
}

if (LIST) {
  console.log('\nevery puzzle, hardest first');
  for (const n of sizes) {
    console.log(`\n--- ${n}×${n} ---`);
    for (const x of graded[n].slice().sort((a, b) => b.score - a.score)) {
      console.log('  ' + x.score.toFixed(0).padStart(4) + '  ' + String(x.rounds).padStart(2) + ' rounds  '
        + pct(x.opening).padStart(4) + ' opening  ' + x.name);
    }
  }
}
