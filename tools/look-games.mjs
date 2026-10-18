/**
 * Every game in the arcade, in every mode it offers, photographed in the
 * window the desktop app actually ships.
 *
 *   npx electron tools/look-games.mjs
 *
 * Writes look/games/<game>-<mode>.png, one per state, at 460x900 — the size
 * `electron/main.cjs` opens. The point is to look at the real thing: real
 * markup, real CSS, the real build in dist/index.html, driven through the
 * arcade the way a person reaches it. Nothing here is a mock-up and nothing
 * is measured; `tools/look-screens.mjs` is the one that measures.
 *
 * Like `look/_shot.mjs`, this uses Electron's own Chromium rather than
 * Playwright, which is not installed in this checkout and is a 150 MB
 * download to add. Electron is already a devDependency and *is* a Chromium.
 *
 * Six of the games need another person. On your own they show the screen that
 * says so, and that screen is what gets photographed — a live board for those
 * needs two clients and a room between them, which is the gate's job, not a
 * contact sheet's.
 */
import { app, BrowserWindow } from 'electron';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'look', 'games');
const PORT = 4413;
/* The desktop window, from electron/main.cjs. Shot at the size it opens at,
   because "how does it look" means how it looks when you start it. */
const W = 460, H = 900;

mkdirSync(outDir, { recursive: true });

/* The build is one file with everything in it, so the server has one job. It
   exists at all because localStorage on file:// is a different story in every
   Chromium version and this needs an origin that keeps it. */
const page = readFileSync(join(root, 'dist', 'index.html'));
createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  r.end(page);
}).listen(PORT, '127.0.0.1');

/* game, mode-as-written-on-the-button, what the file is called, and -- for
   the menus below -- a line of JS to run once the game is open and the mode
   is chosen. `null` for a game that has no modes, and for the shelf itself.

   A menu is not a separate screen in this app: it is the board with
   something over it or something switched on. So each of these opens the
   real game and then does the thing, rather than posing a panel. */
const SHOTS = [
  ['picker',     null,     'arcade'],
  ['sudoku',     'Easy',   'sudoku-easy'],
  ['sudoku',     'Med',    'sudoku-med'],
  ['sudoku',     'Hard',   'sudoku-hard'],
  ['crossword',  '5×5',    'crossword-5'],
  ['crossword',  '7×7',    'crossword-7'],
  ['crossword',  '9×9',    'crossword-9'],
  ['crossword',  '15×15',  'crossword-15'],
  ['picross',    '15×15',  'picross-15'],
  ['picross',    '20×20',  'picross-20'],
  ['picross',    '30×30',  'picross-30'],
  ['wordle',     null,     'wordguess'],
  ['g2048',      null,     '2048'],
  ['tetris',     null,     'tetris'],
  ['hangman',    null,     'hangman'],
  ['scrabble',   null,     'scrabble'],
  ['chess',      null,     'chess'],
  ['pictionary', null,     'pictionary'],
  ['mrwhite',    null,     'mrwhite'],
  ['spymaster',  null,     'spymaster'],

  /* ---- and the menus ---- */
  /* **The calendar every dated game shares.** One button in the header, the
     same panel behind it, four games that can open it -- so it is shot once
     per game, because what is in it differs: the sizes, the streak, and what
     you finished on which day. */
  ['sudoku',    'Easy',   'menu-sudoku-calendar',   "cal"],
  ['crossword', '7×7',    'menu-crossword-calendar', "cal"],
  ['picross',   '20×20',  'menu-picross-calendar',  "cal"],
  ['wordle',    null,     'menu-wordguess-calendar', "cal"],

  /* The menu that reaches the rest of the app without leaving the board. */
  ['picross',   '15×15',  'menu-drawer',            "drawer"],

  /* **What each board's own controls do.** Notes on a sudoku, a crossword
     checked, picross zoomed in and picross with a square armed to be given
     away -- the four states you get to by pressing something on the board
     rather than by opening a panel. */
  ['sudoku',    'Med',    'menu-sudoku-notes',      "press|Notes"],
  ['crossword', '7×7',    'menu-crossword-checked', "press|Check"],
  ['picross',   '20×20',  'menu-picross-zoomed',    "zoom"],
  ['picross',   '20×20',  'menu-picross-hint',      "press|Fix a square"],
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Past the gate and the setup screen, with an hour on the clock so the
    arcade has something to show. Written once; the origin keeps it. */
const SEED = `(() => {
  const v = (document.documentElement.outerHTML.match(/const TERMS_VERSION = '([^']+)'/) || [])[1];
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  const day = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  localStorage.setItem('focus_terms', JSON.stringify({ v: v, at: 1 }));
  localStorage.setItem('focus_setup', '1');
  localStorage.setItem('focus_log', JSON.stringify([{ id: 'x1', day: day, ts: Date.now(), secs: 7200 }]));
  localStorage.setItem('focus_embers', JSON.stringify({ have: 9999, earned: 9999, own: [] }));
  return v || 'no terms version';
})()`;

/** Open the arcade, and the game, and the mode.

    The size and difficulty rows are both `.diffs` or `.pix-sizes` inside
    whichever game is not hidden, so the button is found by what it says
    rather than by an id per game. Picross writes its sizes on two lines
    ("15×15" over "Small"), hence the loose compare. */
/** What to do once the board is up. Deliberately tiny -- four words, each
    one a thing a person does -- because a screenshot tool that can express
    anything is a second copy of the app. */
const after = (what) => {
  if (!what) return '';
  if (what === 'cal') return `{
    const b = document.getElementById('ov-cal');
    if (!b || b.classList.contains('hide')) return 'no calendar button';
    b.click();
    await sleep(900);
  }`;
  if (what === 'drawer') return `{
    const b = document.getElementById('ov-menu');
    if (!b) return 'no menu button';
    b.click();
    await sleep(800);
  }`;
  if (what === 'zoom') return `{
    const plus = [...document.querySelectorAll('.pix-zoom button')]
      .find((x) => /\\+/.test(x.textContent));
    if (!plus) return 'no zoom';
    plus.click(); await sleep(350);
    plus.click(); await sleep(350);
    plus.click(); await sleep(700);
  }`;
  if (what.indexOf('press|') === 0) {
    const label = what.slice(6);
    return `{
      const live = document.querySelector('#overlay .game:not(.hide)');
      const b = [...live.querySelectorAll('button')]
        .find((x) => x.textContent.trim() === ${JSON.stringify(label)});
      if (!b) return 'nothing says ${label}';
      b.click();
      await sleep(900);
    }`;
  }
  return '';
};

const drive = (game, mode, what) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const open = document.getElementById('arcade-open');
  open.classList.remove('hide');
  open.click();
  await sleep(500);
  if (${JSON.stringify(game)} === 'picker') return 'the shelf';
  const card = document.querySelector('#picker .pcard[data-game=' + JSON.stringify(${JSON.stringify(game)}) + ']');
  if (!card) return 'no card for ${game}';
  card.click();
  await sleep(1700);
  ${mode ? `{
    const flat = (s) => s.replace(/\\s+/g, '');
    const want = flat(${JSON.stringify(mode)});
    const live = document.querySelector('#overlay .game:not(.hide)');
    const btn = [...live.querySelectorAll('.diffs button, .pix-sizes button')]
      .find((b) => flat(b.textContent).indexOf(want) === 0);
    if (!btn) return 'no button saying ${mode}';
    btn.click();
    await sleep(1700);
  }` : ''}
  ${after(what)}
  const live = document.querySelector('#overlay .game:not(.hide)');
  return live ? live.id : 'nothing open';
})()`;

async function load(win, url) {
  for (let go = 0; go < 3; go++) {
    try { await win.loadURL(url); return true; } catch (e) { await wait(600); }
  }
  return false;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W, height: H, show: true, frame: false,
    backgroundColor: '#0b1220',
    webPreferences: { backgroundThrottling: false },
  });
  win.setContentSize(W, H);

  await load(win, `http://127.0.0.1:${PORT}/?seed`);
  console.log('terms version: ' + await win.webContents.executeJavaScript(SEED));

  for (let i = 0; i < SHOTS.length; i++) {
    const [game, mode, name, what] = SHOTS[i];
    /* Reloaded for every shot. A game left open leaks into the next one --
       the arcade reopens on what you were last playing -- and a board that
       has been clicked about on is not the board a new day gets. */
    if (!await load(win, `http://127.0.0.1:${PORT}/?r=${i}_${Date.now()}`)) {
      console.log('! could not load for ' + name); continue;
    }
    await wait(700);
    let said = '';
    try { said = await win.webContents.executeJavaScript(drive(game, mode, what)); }
    catch (e) { said = 'threw: ' + e.message; }
    await wait(900);             // the fades, and anything drawn on a frame
    const img = await win.webContents.capturePage();
    const file = join(outDir, name + '.png');
    writeFileSync(file, img.toPNG());
    console.log(`${name.padEnd(16)} ${String(said).padEnd(18)} ${img.getSize().width}×${img.getSize().height}`);
  }
  win.destroy();
  app.quit();
});
