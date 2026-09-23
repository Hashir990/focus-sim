/**
 * Choose the bank from harvested candidates.
 *
 *   node tools/picross-sheet.mjs <pack> --size 15 --one --holes 1 --from town --out look/harvest/town-15.json
 *   node tools/picross-pick.mjs --want 200
 *
 * tools/picross-sheet.mjs says which pictures *could* be puzzles. This says
 * which ones are, and writes tools/picross-designs.mjs from them.
 *
 * **What it is looking for is one thing you can name.** The sheet tool already
 * insisted on a single connected shape with a pocket of space inside it. What
 * is left is a matter of degree, and three things decide it:
 *
 *   - ink and space in balance, so the clues are neither a wall nor a dusting
 *   - the drawing using most of its grid rather than sitting in the middle
 *   - few single squares, which are noise in a picture and tedium in a clue
 *
 * **And no two of the same thing.** Identical grids go, obviously. So do near
 * duplicates: a pack has nine barrels and eleven variations on a wall, and a
 * bank of those is worse than a smaller bank. Each picture is reduced to a
 * coarse signature and only a couple may share one.
 *
 * Everything it writes carries where it came from — pack and tile number — so
 * any picture can be traced back. The sources are CC0; see the file it writes.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { effort } from './make-picross.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => {
  const at = args.indexOf('--' + n);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith('--') ? args[at + 1] : d;
};
const WANT = +opt('want', 200);
const DIR = join(root, opt('dir', 'look/harvest'));
const SIZES = [15, 20, 30];
const SAME_SIG = +opt('alike', 2);          // how many near-twins are tolerated
const SEED = +opt('seed', 20260921);
/* **A thing appears once in the whole bank, not once per size.** Meeting the
   same key at 15 and again at 30 is meeting the same puzzle twice, and the
   second time you already know the answer. So the names are claimed globally,
   and the sizes are filled scarcest first — the 30s have the smallest pool, so
   they choose their subjects before the 15s take them. */
const claimed = new Set();
/* Dates are positions in these lists, so the order *is* the schedule. Shuffled
   with a fixed seed: random to a player, identical on every rebuild, which is
   what keeps a regenerated bank from reshuffling what has already gone out. */
function shuffled(list, seed) {
  let x = seed >>> 0;
  const next = () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x / 4294967296;
  };
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

if (!existsSync(DIR)) {
  console.log('no harvest in ' + DIR + ' — run tools/picross-sheet.mjs with --out first');
  process.exit(1);
}

const grid = (t) => t.rows.map((r) => [...r].map((c) => (c === '#' ? 1 : 0)));

function measure(t, n) {
  const g = grid(t);
  const filled = g.flat().filter(Boolean).length;
  const part = filled / (n * n);
  const rowsUsed = g.filter((r) => r.some(Boolean)).length;
  const colsUsed = [...Array(n).keys()].filter((x) => g.some((r) => r[x])).length;
  /* Edge against mass: see BLOB below. */
  let interiorCells = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!g[y][x]) continue;
    const up = y > 0 && g[y - 1][x], dn = y < n - 1 && g[y + 1][x];
    const lf = x > 0 && g[y][x - 1], rt = x < n - 1 && g[y][x + 1];
    if (up && dn && lf && rt) interiorCells++;
  }
  const interior = filled ? interiorCells / filled : 1;
  /* The pockets of space the outside cannot reach — an eye, a window, a gap
     between a handle and a cup. Counted here rather than trusted from the
     harvest file, so an older file without the number still works. */
  const seenHole = g.map((r) => r.map(() => false));
  const flood = (y, x) => {
    const st = [[y, x]]; seenHole[y][x] = true;
    while (st.length) {
      const [cy, cx] = st.pop();
      for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ny = cy + dy, nx = cx + dx;
        if (ny < 0 || nx < 0 || ny >= n || nx >= n) continue;
        if (!g[ny][nx] && !seenHole[ny][nx]) { seenHole[ny][nx] = true; st.push([ny, nx]); }
      }
    }
  };
  for (let i = 0; i < n; i++) {
    if (!g[0][i] && !seenHole[0][i]) flood(0, i);
    if (!g[n - 1][i] && !seenHole[n - 1][i]) flood(n - 1, i);
    if (!g[i][0] && !seenHole[i][0]) flood(i, 0);
    if (!g[i][n - 1] && !seenHole[i][n - 1]) flood(i, n - 1);
  }
  let holeCount = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (!g[y][x] && !seenHole[y][x]) { flood(y, x); holeCount++; }
  }

  const runs = (line) => {
    const out = []; let run = 0;
    for (const v of line) { if (v) run++; else if (run) { out.push(run); run = 0; } }
    if (run) out.push(run);
    return out;
  };
  let ones = 0, clueCount = 0;
  for (let y = 0; y < n; y++) { const r = runs(g[y]); ones += r.filter((v) => v === 1).length; clueCount += r.length; }
  for (let x = 0; x < n; x++) { const r = runs(g.map((row) => row[x])); ones += r.filter((v) => v === 1).length; clueCount += r.length; }
  /* A coarse print of the picture: enough to tell a key from a fish and not
     enough to tell one barrel from another. **The coarseness has to follow the
     grid** — four cells across a 10×10 lumps two and a half squares into each,
     and at that blur half the small pictures look alike and get thrown out as
     twins. Five across below fifteen, four above. */
  let sig = '';
  const cells = n <= 10 ? 5 : 4;
  const step = n / cells;
  for (let sy = 0; sy < cells; sy++) for (let sx = 0; sx < cells; sx++) {
    let on = 0, all = 0;
    for (let y = Math.floor(sy * step); y < Math.floor((sy + 1) * step); y++) {
      for (let x = Math.floor(sx * step); x < Math.floor((sx + 1) * step); x++) { all++; on += g[y][x]; }
    }
    sig += on * 2 >= all ? '1' : '0';
  }
  /* Low is good: noise and a cramped drawing both count against. */
  const score = ones * 3
    + Math.abs(part - 0.38) * 60
    + (n - rowsUsed) * 2 + (n - colsUsed) * 2
    - Math.min(clueCount, n * 3) * 0.15;      // a few more clues is more to solve
  return { part, rowsUsed, colsUsed, ones, sig, score, interior, holes: holeCount };
}

/* **A name is the test of whether a picture is a thing.**
   An icon pack is half objects and half furniture: dice outlines, token stacks,
   card backs, D-pads, numbered variants of one controller button. They pass
   every geometric test — one shape, space inside, solvable — and finishing one
   tells you nothing, which is exactly the complaint the filters above cannot
   hear. The name can. Anything whose name is a shape, a piece of interface, or
   the same thing with a number after it is not a picture of something. */
const BORING = new RegExp('(^|[ _-])('
  + 'd\\d+|outline|token|tokens|card|cards|tile|tiles|dpad|fightjoy|leaderboards?'
  + '|devicetilt|userrobot|contrast|tag|prohibited|no ?entry|warning|badge|hollow'
  + '|shape|shapes|button|buttons|cursor|icon|pointer|arrow|frame|border|circle'
  + '|square|triangle|hexagon|pattern|grid|blank|slider|checkbox|radio|toggle'
  + '|panel|bar|bars|dot|dots|line|lines|corner|divider|separator|placeholder'
  + '|resource|structure|generic|misc|symbol|glyph|mark|sign'
  + '|plus|minus|multiply|divide|equals|zoom|joystick|fist|crosshair|reticle'
  + '|exploding|empty|full|half|quarter|left|right|up|down|top|bottom'
  + '|device|tilt|upload|download|suit|select|menu|save|load|settings|volume'
  /* **Named, and still not a thing.** A big icon library carries rank
     insignia, gender symbols and abstract nouns — "private first class",
     "female", "falling". They pass every test here because they are named and
     drawn, and finishing one shows you a chevron. */
  + '|private|corporal|sergeant|lieutenant|captain|major|colonel|general'
  + '|insignia|chevron|rank|stripes|male|female|gender|abstract|falling|rising'
  + '|level|tier|slot|stack|swap|cycle|rotate|target|aim'
  /* And a few whose names have no place on a puzzle in a focus app, whatever
     the drawing turns out to be. */
  + '|suicide|corpse|gore|vomit|vile|entrails|carrion|maim|torture|hanging'
  + ')([ _-]|$)', 'i');
/* **Logos are not puzzles.** A general icon set carries company marks —
   a file licence covers the drawing, it does not give anyone the right to a
   trademark, and a brand's logo as a puzzle answer is both a legal problem and
   a dull picture. Rejected by name, because that is how they arrive. */
const BRAND = new RegExp('(^|[ _-])('
  + 'apple|android|amazon|bootstrap|discord|dropbox|facebook|github|gitlab|google'
  + '|instagram|linkedin|medium|microsoft|paypal|pinterest|reddit|skype|slack'
  + '|snapchat|spotify|stack|steam|strava|telegram|tiktok|trello|twitch|twitter'
  + '|vimeo|whatsapp|windows|wordpress|youtube|meta|nvidia|intel|ubuntu|unity'
  + '|vk|wechat|weibo|yelp|zoom|firefox|chrome|safari|edge|opera|linux|tux'
  + '|playstation|xbox|nintendo|switch|steamdeck|kickstarter|patreon|mastodon'
  + '|signal|threads|bluesky|dribbble|behance|figma|sketch|adobe|oracle|ibm'
  + ')([ _-]|$)', 'i');
/* `medal2`, `crown a`, `fightJoy 26`: one drawing in a numbered family. */
const VARIANT = /([a-z]\d+|\s[a-z]|\s\d+|\d)$/i;
/* **Names arrive in two spellings.** A pack writes `joystickUp.png`, an emoji
   set writes `telephone receiver`. Without splitting the run-together kind, the
   word list never sees the word it is looking for and `arrowDown` sails past a
   filter that rejects `arrow`. */
const words = (name) => String(name || '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[_-]+/g, ' ')
  .toLowerCase()
  .trim();
const isThing = (name) => {
  const w = words(name);
  return !!w && !BORING.test(w) && !BRAND.test(w) && !VARIANT.test(w);
};

/* **What each tier is allowed to feel like.**
   The sizes are named Small, Middling and Big, and a player reads that as easy,
   harder, hardest — so the bank has to be ordered that way in fact. Size alone
   does not do it: a 30×30 of one fat shape is solved by its first pass, which
   is dictation rather than a puzzle, and a fiddly 15×15 can be harder than any
   of them. `opening` is the share of the grid the first pass gives away and
   `rounds` the passes needed to finish; the bands below keep each tier inside
   its own claim. Measured by the solver in make-picross.mjs — the same effort a
   person spends. */
const BANDS = {
  0: { rounds: 3, opening: 0.85, score: [0, 105] },     // Small
  1: { rounds: 3, opening: 0.80, score: [70, 130] },    // Middling
  2: { rounds: 4, opening: 0.72, score: [88, Infinity] }, // Big
};
/* **The floor does not move.** Everything else here relaxes when a size cannot
   fill — twins, source caps, the tier's own band — because a half-empty tier is
   worse than a slightly uneven one. This does not. A puzzle whose first pass
   decides almost the whole grid is dictation: you read the clues out and write
   them down, and there is no moment of working anything out. Letting those back
   in through the relaxed rounds is exactly what happened before this existed,
   and it put a 100%-opening "mountain" in two tiers at once. */
const GIVEAWAY = (eff) => !eff || eff.opening >= 0.86 || eff.rounds <= 2;
/* **A blob is not a hard puzzle, it is an unreadable one.** A big solid mass
   scores as *difficult* by every measure above — few cells forced early, many
   passes — because a long run in a long line is ambiguous. But there is nothing
   to work out and nothing to see at the end: an egg, a coconut, a drop of
   blood. What separates a drawing from a mass is edge. `interior` is the share
   of filled squares whose four neighbours are all filled too; a picture with
   arms, legs, handles and gaps sits low, a lump sits high. Paired with
   requiring at least one pocket of space inside, it is the difference between
   a thing and a shadow of one. Never relaxed. */
const BLOB = (t) => t.holes < 1 || t.interior > +opt('blob', 0.62);
const inBand = (eff, i, slack) => {
  const b = BANDS[i];
  if (GIVEAWAY(eff)) return false;
  return eff.rounds >= b.rounds - slack
    && eff.opening <= b.opening + slack * 0.08
    && eff.score >= b.score[0] - slack * 12
    && eff.score <= b.score[1] + slack * 12;
};

const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const family = (tag) => String(tag).split('-')[0];

/* Every size's candidates, measured once. */
const pools = {};
for (const n of SIZES) {
  const pool = [];
  for (const f of files.filter((f) => f.endsWith('-' + n + '.json'))) {
    const from = f.slice(0, f.lastIndexOf('-'));
    /* The silhouette harvests are where the lumps come from: a coloured emoji
       flattened to its outline is a solid mass with no inside. */
    if (/solid/.test(from) && !/fa-solid/.test(from)) continue;
    for (const t of JSON.parse(readFileSync(join(DIR, f), 'utf8'))) {
      pool.push({ ...t, from: t.from || from, ...measure(t, n), eff: effort(grid(t)) });
    }
  }
  pool.sort((a, b) => a.score - b.score);
  pools[n] = { all: pool, named: pool.filter((t) => isThing(t.name)) };
}

/* **Taking turns, not queueing.** With one subject allowed in the whole bank,
   filling one size at a time means whoever goes last gets the leftovers — the
   15s ended two hundred short while the 30s were full, purely because the 30s
   chose first. Round-robin instead: each size takes one picture at a time, so
   the shortfall, when there is one, is shared rather than dumped on the tier
   that happened to be last in the loop. */
const state = {};
for (const n of SIZES) {
  state[n] = { seen: new Set(), sigs: new Map(), fromCount: new Map(), names: new Set(), picked: [] };
}

const takeOne = (n, round) => {
  const st = state[n];
  const tier = SIZES.indexOf(n);
  const twins = SAME_SIG + round;
  const room = Math.ceil(WANT * (+opt('cap', 0.45) + round * 0.1));
  const CAP = Math.ceil(WANT * (+opt('cap', 0.45)));
  for (const t of pools[n].named) {
    const flat = t.rows.join('');
    if (st.seen.has(flat)) continue;
    const alike = st.sigs.get(t.sig) || 0;
    if (alike >= twins) continue;
    /* **One thing, once in the bank.** Not once per size: meeting the same key
       at 15 and again at 30 is meeting the same puzzle twice, and the second
       time the answer is already known. */
    if (claimed.has(words(t.name))) continue;
    /* The difficulty band widens as the rounds relax, like everything else here
       except the name and the blob rules. */
    if (!inBand(t.eff, tier, round)) continue;
    if (BLOB(t)) continue;
    if ((st.fromCount.get(family(t.from)) || 0) >= Math.max(CAP, room)) continue;
    st.seen.add(flat);
    st.sigs.set(t.sig, alike + 1);
    st.names.add(words(t.name));
    claimed.add(words(t.name));
    st.fromCount.set(family(t.from), (st.fromCount.get(family(t.from)) || 0) + 1);
    st.picked.push(t);
    return true;
  }
  return false;
};

for (let round = 0; round < 6; round++) {
  let moved = true;
  while (moved) {
    moved = false;
    for (const n of SIZES) {
      if (state[n].picked.length >= WANT) continue;
      if (takeOne(n, round)) moved = true;
    }
  }
  if (SIZES.every((n) => state[n].picked.length >= WANT)) break;
}

/* A size is only as useful as the others: a day serves one of each, so the bank
   is levelled to whichever tier could fill the least. */
const level = Math.min(...SIZES.map((n) => state[n].picked.length));
const out = {};
for (const n of SIZES) {
  out[n] = shuffled(state[n].picked.slice(0, level), SEED + n);
  console.log(`${n}×${n}: ${pools[n].all.length} candidates, ${pools[n].named.length} named things`
    + ` → ${state[n].picked.length} chosen, levelled to ${level}`);
}

/* The picture's own name where the source gave one, and where it came from
   either way. The name is not decoration: it is the only evidence that the bank
   is made of things rather than shapes. A source that numbers its files can
   only ever be checked by eye. */
const label = (d) => (d.name ? d.name.replace(/'/g, "\\'") + ' · ' + d.from
  : d.from + ' #' + d.tile);
const block = (list) => list.map((d) => `  { name: '${label(d)}', rows: [\n`
  + d.rows.map((r) => `    '${r}'`).join(',\n') + '] },').join('\n\n');

const file = `/**
 * The picross designs — one entry a puzzle, chosen by tools/picross-pick.mjs.
 *
 * **Where the pictures come from, and what that requires.**
 *
 *   Twemoji, by Twitter and contributors — CC BY 4.0. Attribution is a
 *   condition of the licence, not a courtesy: the About page carries it, and it
 *   has to stay there for as long as these pictures ship.
 *
 *   Kenney's icon packs (kenney.nl) — CC0. Nothing is required; credited anyway.
 *
 * Nothing is traced from a puzzle site. Those grids are the work of whoever
 * submitted them; these sets were given away on purpose, which is the whole
 * difference.
 *
 * Nothing here is traced from a puzzle site. Those grids are the work of the
 * people who submitted them; a CC0 pack is given away on purpose, which is the
 * whole difference.
 *
 * **Each one is a single connected shape with space inside it** — a thing you
 * can name when the last square goes in, rather than a scattering of marks that
 * happens to satisfy its clues. tools/picross-sheet.mjs enforces that;
 * tools/picross-pick.mjs then keeps the best of them and refuses near-twins.
 *
 * Names are provenance: pack and tile number, so any picture can be found
 * again. They are never shipped — in the app the picture is the answer.
 *
 * Generated. To change the bank, harvest and pick again rather than editing:
 *   node tools/picross-sheet.mjs <pack> --size 15 --one --holes 1 --from town --out look/harvest/town-15.json
 *   node tools/picross-pick.mjs --want ${WANT}
 *   node tools/make-picross.mjs
 */

export const EASY = [
${block(out[SIZES[0]])}
];

export const MEDIUM = [
${block(out[SIZES[1]])}
];

export const HARD = [
${block(out[SIZES[2]])}
];
`;
writeFileSync(join(root, 'tools', 'picross-designs.mjs'), file);
console.log('wrote tools/picross-designs.mjs');
