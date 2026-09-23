/**
 * Builds src/js/27a-picross-data.js from the designs below.
 *
 *   node tools/make-picross.mjs          check and write
 *   node tools/make-picross.mjs --check  check only, write nothing
 *
 * **Why a tool rather than a hand-written data file.** A nonogram is only a
 * puzzle if its clues have exactly one answer *and* that answer can be reached
 * by reasoning one line at a time. A picture that looks fine can be neither:
 * two different fillings can share the same clues, or the only route through
 * can be a guess. Both are invisible to the eye and fatal to the player, so
 * every design here is run through a solver before it is allowed into the bank.
 *
 * The solver is the one a person uses: take a line, work out every way its
 * clues could sit in it given what is already known, and fill in the cells that
 * are the same in all of them. Repeat until nothing changes. If that finishes
 * the grid, the puzzle is solvable by logic alone and its answer is unique — if
 * two answers existed, no cell could ever be forced. If it stalls, the design is
 * rejected and named, and it gets redrawn.
 *
 * **The designs are ours.** They are drawn here rather than taken from a
 * puzzle site: the shapes are the ordinary vocabulary of small pixel pictures —
 * a heart, a key, a cat — but the grids are written in this file, so there is
 * nothing in the app that belongs to somebody else. Names are for this file
 * only and are never shipped: the picture is the answer, and naming it in the
 * app would be printing the solution above the puzzle.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EASY, MEDIUM, HARD } from './picross-designs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'src', 'js', '27a-picross-data.js');
const CHECK_ONLY = process.argv.includes('--check');

/* ---------------- the grid ---------------- */

/** A design's rows of "#" and anything-else into rows of 1 and 0. */
export function bits(rows) {
  return rows.map((r) => r.split('').map((c) => (c === '#' || c === '1' ? 1 : 0)));
}

/** The clue for one line: the lengths of its runs, or [0] for an empty line. */
export function clue(line) {
  const out = [];
  let run = 0;
  for (const v of line) {
    if (v === 1) run++;
    else if (run) { out.push(run); run = 0; }
  }
  if (run) out.push(run);
  return out.length ? out : [0];
}

export function clues(grid) {
  const n = grid.length;
  const rows = grid.map(clue);
  const cols = [];
  for (let x = 0; x < n; x++) cols.push(clue(grid.map((r) => r[x])));
  return { rows, cols };
}

/* ---------------- the solver ----------------
   Cells are 1 filled, -1 empty, 0 not yet known. */

/**
 * Every arrangement of `nums` in a line of `len`, narrowed by what is known.
 * Returns two masks: cells filled in every arrangement, and cells empty in
 * every arrangement. Returns null when the line cannot be satisfied at all.
 */
export function lineForced(nums, known) {
  const len = known.length;
  const all = nums.length === 1 && nums[0] === 0 ? [] : nums;
  const filledEverywhere = new Array(len).fill(true);
  const emptyEverywhere = new Array(len).fill(true);
  let any = false;

  const place = (i, at, acc) => {
    if (i === all.length) {
      for (let x = at; x < len; x++) {
        if (known[x] === 1) return;
        acc[x] = -1;
      }
      any = true;
      for (let x = 0; x < len; x++) {
        if (acc[x] === 1) emptyEverywhere[x] = false;
        else filledEverywhere[x] = false;
      }
      return;
    }
    const need = all.slice(i).reduce((a, b) => a + b, 0) + (all.length - i - 1);
    for (let start = at; start + need <= len; start++) {
      // the gap before this run must be empty
      let ok = true;
      for (let x = at; x < start; x++) {
        if (known[x] === 1) { ok = false; break; }
      }
      if (!ok) break;
      // the run itself must not sit on a known-empty cell
      let fits = true;
      for (let x = start; x < start + all[i]; x++) {
        if (known[x] === -1) { fits = false; break; }
      }
      const after = start + all[i];
      if (fits && after < len && known[after] === 1) fits = false;
      if (fits) {
        const next = acc.slice();
        for (let x = at; x < start; x++) next[x] = -1;
        for (let x = start; x < after; x++) next[x] = 1;
        if (after < len) next[after] = -1;
        place(i + 1, Math.min(len, after + 1), next);
      }
    }
  };

  place(0, 0, new Array(len).fill(0));
  if (!any) return null;
  return { fill: filledEverywhere, empty: emptyEverywhere };
}

/** Solve by line logic alone. Returns 'solved', 'stuck' or 'broken'. */
export function solve(rowClues, colClues) {
  const n = rowClues.length;
  const w = colClues.length;
  const cell = Array.from({ length: n }, () => new Array(w).fill(0));
  let moved = true;
  while (moved) {
    moved = false;
    for (let y = 0; y < n; y++) {
      const got = lineForced(rowClues[y], cell[y]);
      if (!got) return 'broken';
      for (let x = 0; x < w; x++) {
        if (cell[y][x] === 0 && got.fill[x]) { cell[y][x] = 1; moved = true; }
        else if (cell[y][x] === 0 && got.empty[x]) { cell[y][x] = -1; moved = true; }
      }
    }
    for (let x = 0; x < w; x++) {
      const col = cell.map((r) => r[x]);
      const got = lineForced(colClues[x], col);
      if (!got) return 'broken';
      for (let y = 0; y < n; y++) {
        if (cell[y][x] === 0 && got.fill[y]) { cell[y][x] = 1; moved = true; }
        else if (cell[y][x] === 0 && got.empty[y]) { cell[y][x] = -1; moved = true; }
      }
    }
  }
  return cell.every((r) => r.every((v) => v !== 0)) ? 'solved' : 'stuck';
}

/* ---------------- how much work it takes ----------------
   The same loop as `solve`, counting instead of only finishing. Difficulty is
   not size: a 30×30 of one fat shape can fall out in a single pass, and a
   player told that tier is "Big" will read that as a mistake. Two numbers carry
   it — how many passes before nothing more can be forced, and how much of the
   grid the *first* pass gives away. A puzzle that opens at 100% is a dictation
   exercise: every line was stated outright by its clue. */
export function effort(grid) {
  const n = grid.length;
  const { rows: rowClues, cols: colClues } = clues(grid);
  const cell = Array.from({ length: n }, () => new Array(n).fill(0));
  let rounds = 0, opening = 0, moved = true;
  while (moved) {
    moved = false;
    rounds++;
    for (let y = 0; y < n; y++) {
      const got = lineForced(rowClues[y], cell[y]);
      if (!got) return null;
      for (let x = 0; x < n; x++) {
        if (cell[y][x] === 0 && got.fill[x]) { cell[y][x] = 1; moved = true; }
        else if (cell[y][x] === 0 && got.empty[x]) { cell[y][x] = -1; moved = true; }
      }
    }
    for (let x = 0; x < n; x++) {
      const col = cell.map((r) => r[x]);
      const got = lineForced(colClues[x], col);
      if (!got) return null;
      for (let y = 0; y < n; y++) {
        if (cell[y][x] === 0 && got.fill[y]) { cell[y][x] = 1; moved = true; }
        else if (cell[y][x] === 0 && got.empty[y]) { cell[y][x] = -1; moved = true; }
      }
    }
    if (rounds === 1) opening = cell.flat().filter((v) => v !== 0).length / (n * n);
  }
  const runs = [...rowClues, ...colClues]
    .reduce((a, c) => a + (c.length === 1 && c[0] === 0 ? 0 : c.length), 0) / (n * 2);
  return { rounds, opening, runs, score: (1 - opening) * 100 + (rounds - 1) * 12 + runs * 6 };
}

/* ---------------- checking a set ---------------- */

export function check(list, size, label) {
  const good = [];
  const bad = [];
  const seen = new Map();
  for (const d of list) {
    const rows = d.rows;
    if (rows.length !== size || rows.some((r) => r.length !== size)) {
      bad.push([d.name, `is not ${size}x${size} (${rows.length} rows)`]);
      continue;
    }
    const grid = bits(rows);
    const filled = grid.flat().filter(Boolean).length;
    if (filled < size || filled > size * size - size) {
      bad.push([d.name, `has ${filled} filled cells, which is too ${filled < size ? 'few' : 'many'}`]);
      continue;
    }
    const flat = grid.flat().join('');
    if (seen.has(flat)) { bad.push([d.name, 'is the same picture as ' + seen.get(flat)]); continue; }
    seen.set(flat, d.name);
    const { rows: rc, cols: cc } = clues(grid);
    const how = solve(rc, cc);
    if (how !== 'solved') {
      bad.push([d.name, how === 'broken' ? 'has impossible clues' : 'cannot be solved without guessing']);
      continue;
    }
    good.push({ name: d.name, flat });
  }
  console.log(`${label}: ${good.length} good, ${bad.length} rejected`);
  for (const [name, why] of bad) console.log(`   x  ${name} ${why}`);
  return { good, bad };
}

/* ---------------- writing it out ---------------- */

/* Run only when this file is the command. Imported — by tools/picross-import.mjs,
   which needs the same solver to prove an imported picture — it defines and
   exports, and writes nothing. */
const RUN = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (RUN) {
  const sets = [
    { size: 15, list: EASY, label: 'easy (15x15)' },
    { size: 20, list: MEDIUM, label: 'medium (20x20)' },
    { size: 30, list: HARD, label: 'hard (30x30)' },
  ];

  let failed = 0;
  const banks = {};
  for (const s of sets) {
    const { good, bad } = check(s.list, s.size, s.label);
    failed += bad.length;
    banks[s.size] = good;
  }

  if (failed) {
    console.log('\nNothing written: every design has to be solvable by logic alone.');
    process.exit(1);
  }
  if (CHECK_ONLY) {
    console.log('\nAll good.');
    process.exit(0);
  }

  const body = Object.keys(banks).map((size) => {
    const rows = banks[size].map((g) => `      '${g.flat}',`).join('\n');
    return `    ${size}: [\n${rows}\n    ],`;
  }).join('\n');

  /* **The names ship now, for the finish screen only.** They were kept out of
     the bank on the grounds that a name above a puzzle is the answer printed
     above the question — which is true right up until the last square goes in,
     and after that "there it is" is a poor substitute for being told what it
     was. Only the thing is kept: the pack and tile it came from stay behind in
     tools/picross-designs.mjs. */
  const titles = Object.keys(banks).map((size) => {
    const list = banks[size]
      .map((g) => "      '" + String(g.name || '')
        .split(' · ')[0]
        .replace(/\.svg$/i, '')
        .replace(/'/g, "\\'") + "',")
      .join('\n');
    return `    ${size}: [\n${list}\n    ],`;
  }).join('\n');

  const file = `  /* ---------------- THE PICROSS BANK ----------------

       One string a puzzle: the picture read left to right, top to bottom, '1' for
       a filled square. The size says how to fold it, and the clues are worked out
       from it at run time — storing them as well would be storing the same fact
       twice and leaving room for the two to disagree.

       **Written by tools/make-picross.mjs, which is where the designs live.**
       Nothing reaches this file until the solver in that tool has finished it by
       line logic alone, which is also what proves the answer is the only one: if
       two pictures fitted the clues, no square could ever be forced.

       **The pictures are Kenney's, released CC0** — public domain, and credited
       on the About page because that is decent rather than because it is owed.
       Which pack each size comes from is in tools/picross-designs.mjs.

       **No names.** The designs carry them in the tool, so a picture can be
       traced back to its tile. Here they would be the answer printed above the
       question.

       Append only, like the crossword bank: a day's puzzle is its position in
       this list counted from the epoch, so inserting one in the middle moves
       every date after it and orphans the boards people have saved.
       ${sets.map((s) => banks[s.size].length + ' at ' + s.size + '×' + s.size).join(', ')}. */
    const PIC_BANK = {
  ${body}
    };

    /* What each picture is, in the same order. Shown on the finish screen and
       nowhere else — see \`picTitle\` in 27b-picross.js. */
    const PIC_TITLES = {
  ${titles}
    };
  `;

  writeFileSync(OUT, file, 'utf8');
  console.log(`\nwrote ${OUT.replace(root, '.')}`);

}
