/* Structural walk over the shipped crossword bank.

   The build and the Scrabble rules test both pass a grid whose bar maps have
   gone missing — the first only concatenates files and the second never opens
   the crossword. This walks every grid through the real crossParse() and
   asserts the five things a solver would notice:

     1. no entry under three letters
     2. no answer without a clue
     3. no clue containing its own answer
     4. every white square is in both an Across and a Down entry
     5. no answer appears twice in one puzzle

   Run after --patch and before shipping. Exits non-zero on the first failure
   so it can gate a build. */

import fs from 'node:fs';
import vm from 'node:vm';

const file = process.argv[2] || 'src/js/26-crossword-data.js';
const src = fs.readFileSync(file, 'utf8');

// The data file is a bare block of declarations meant to be concatenated into
// the bundle, so evaluate it in a context and lift out what we need.
const ctx = vm.createContext({});
vm.runInContext(src + '\n;globalThis.__out = {CROSS_GRIDS, CROSS_CLUES, crossParse, crossClue};',
                ctx, {filename: file});
const {CROSS_GRIDS, CROSS_CLUES, crossParse, crossClue} = ctx.__out;

let fails = 0;
const fail = (msg) => { console.error('FAIL ' + msg); fails++; };

let entryTotal = 0;
const sizes = {};

CROSS_GRIDS.forEach((g, idx) => {
  const puz = crossParse(g);
  const n = puz.n;
  sizes[n] = (sizes[n] || 0) + 1;
  const where = `#${idx + 1} (${n}x${n})`;

  const inA = new Set(), inD = new Set();
  const seen = new Set();

  for (const e of puz.entries) {
    entryTotal++;

    // 1. no entry under three letters
    if (e.answer.length < 3) fail(`${where} ${e.num}${e.dir} "${e.answer}" is under three letters`);

    // 2. no answer without a clue
    const clue = crossClue(e.answer, idx);
    if (!clue || clue === e.answer) fail(`${where} ${e.num}${e.dir} "${e.answer}" has no clue`);

    // 3. no clue containing its own answer, as a substring anywhere
    else if (clue.toLowerCase().replace(/[^a-z]/g, '').includes(e.answer.toLowerCase()))
      fail(`${where} ${e.num}${e.dir} "${e.answer}" hides in its clue "${clue}"`);

    // 5. no answer twice in one puzzle
    if (seen.has(e.answer)) fail(`${where} "${e.answer}" appears twice in the same puzzle`);
    seen.add(e.answer);

    for (const [r, c] of e.cells) (e.dir === 'A' ? inA : inD).add(r + ',' + c);
  }

  // 4. every white square is in both an Across and a Down
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (puz.rows[r][c] === '#') continue;
    const k = r + ',' + c;
    if (!inA.has(k)) fail(`${where} square ${r},${c} is in no Across entry`);
    if (!inD.has(k)) fail(`${where} square ${r},${c} is in no Down entry`);
  }
});

const shape = Object.keys(sizes).sort((a, b) => a - b).map(n => `${sizes[n]}x ${n}x${n}`).join(', ');
console.log(`${CROSS_GRIDS.length} puzzles walked (${shape}), ${entryTotal} entries`);
console.log(fails ? `${fails} structural problems` : 'all five structural checks passed');
process.exit(fails ? 1 : 0);
