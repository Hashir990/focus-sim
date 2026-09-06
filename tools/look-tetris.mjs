/**
 * Tetris, played by a script and photographed.
 *
 *   node tools/look-tetris.mjs [out.png]
 *
 * It also *checks* the two things a made-up implementation gets wrong: that a
 * seven-bag really deals one of each before repeating, and that rotation kicks
 * a piece off a wall instead of refusing. Printed, not just drawn.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const SANDBOX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const opts = () => {
  const p = process.env.CHROME_PATH || (existsSync(SANDBOX_CHROME) ? SANDBOX_CHROME : '');
  return p ? { executablePath: p, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] };
};
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ? join(root, process.argv[2]) : join(root, 'look', 'tetris.png');
mkdirSync(dirname(out), { recursive: true });

/* Splice at the LAST close — see HANDOFF §6. */
const src = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
  .replace(/const ACC_URL = '[^']*'/, "const ACC_URL = ''");
const at = src.lastIndexOf('})();');
const html = src.slice(0, at) + `
  window.__t = () => Tetris;
  window.__open = async () => {
    document.getElementById('overlay').classList.remove('hide');
    Arcade.open = true; await Arcade.pick('tetris');
  };
` + src.slice(at);
const tmp = join(root, 'look', '_tetris.html');
writeFileSync(tmp, html);

const browser = await chromium.launch(opts());
const page = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
await page.goto('file://' + tmp);
await page.waitForTimeout(900);
await page.evaluate(() => window.__open());
await page.waitForTimeout(400);

const shots = [];
const shoot = async (label) => {
  const el = await page.$('#game-tetris');
  shots.push({ label, png: (await el.screenshot()).toString('base64') });
};

/* --- the bag --- */
const bag = await page.evaluate(() => {
  const T = window.__t();
  T.newGame(); T.pause(true);
  const seen = [];
  for (let i = 0; i < 30; i++) { seen.push(T.piece.k); T._spawn(); }
  return seen;
});
const whole = (a) => new Set(a).size === 7;
for (const i of [0, 10, 20]) {
  const b = bag.slice(i, i + 10);
  console.log('bag ' + (i / 10 + 1) + ':', b.join(''),
    whole(b) ? 'all seven ✓' : 'MISSING ONE ✗');
}

/* --- kicks ---
   A piece whose turned shape lands in something solid must be *nudged* and
   tried again, not refused. One square is placed exactly where the T's turned
   shape wants to go, so the naive rotation fails and the standard table's next
   offer — one to the left — succeeds. An implementation with no kick table
   refuses here, and that is the failure this catches. */
const kick = await page.evaluate(() => {
  const T = window.__t();
  T.newGame(); T.pause(true);
  const W = 10;
  T.grid[12 * W + 5] = 'L';                       // the one square in the way
  T.piece = { k: 'T', r: 0, x: 4, y: 10 };
  T.paused = false;                               // a paused board ignores input, quite rightly
  const open = T._fits(T.piece);
  const naive = T._fits({ k: 'T', r: 1, x: 4, y: 10 });
  const ok = T.rotate(1);
  return { open, naive, ok, after: JSON.stringify(T.piece), fits: T._fits(T.piece),
           moved: T.piece.x !== 4 || T.piece.y !== 10 };
});
console.log('the piece starts somewhere legal:', kick.open ? '\u2713' : '\u2717');
console.log('turning on the spot is blocked:', kick.naive ? 'NOT BLOCKED \u2717' : '\u2713');
console.log('so it kicks aside and turns:',
  kick.ok && kick.fits && kick.moved ? '\u2713' : '\u2717', kick.after);

/* --- a real game: drop a few pieces and clear a line --- */
await page.evaluate(() => {
  const T = window.__t();
  T.newGame(); T.pause(true);
  // a floor with one gap, so the next piece can clear it
  const W = 10, ROWS = T.grid.length / W;
  for (let x = 0; x < W - 1; x++) T.grid[(ROWS - 1) * W + x] = 'J';
  T.piece = { k: 'I', r: 1, x: W - 3, y: 2 };
  T.render();
});
await page.waitForTimeout(200);
await shoot('a line about to go');

const cleared = await page.evaluate(() => {
  const T = window.__t();
  const before = T.lines;
  T.paused = false;
  T.hardDrop();
  T.render();
  return { before, after: T.lines, score: T.score };
});
console.log('line cleared by a hard drop:', cleared.before, '->', cleared.after,
  cleared.after > cleared.before ? '✓' : '✗');
await page.waitForTimeout(200);
await shoot('after the clear');

/* --- the tetris, four rows at once, caught mid-flash --- */
await page.evaluate(() => {
  const T = window.__t();
  T.newGame(); T.pause(true);
  const W = 10, ROWS = T.grid.length / W;
  for (let y = ROWS - 4; y < ROWS; y++)
    for (let x = 0; x < W - 1; x++) T.grid[y * W + x] = 'J';
  T.piece = { k: 'I', r: 1, x: 7, y: 4 };
  T.paused = false;
  T.render();
});
await page.waitForTimeout(150);
await shoot('a tetris lined up');
const four = await page.evaluate(() => {
  const T = window.__t();
  T.hardDrop(); T.render();
  return { lines: T.lines, score: T.score, level: T.level() };
});
await page.waitForTimeout(220);          // mid-animation, on purpose
await shoot('four rows going');
console.log('four rows at once:', four.lines === 4 ? '\u2713' : '\u2717',
  `${four.lines} lines, ${four.score} points, level ${four.level}`);

/* --- the speed follows the score --- */
const levels = await page.evaluate(() => {
  const T = window.__t();
  const at = (s) => { T.score = s; return T.level(); };
  return { z: at(0), a: at(799), b: at(800), c: at(2400), d: at(4800), e: at(200000) };
});
console.log('level by score:', JSON.stringify(levels),
  levels.z === 1 && levels.a === 1 && levels.b === 2 && levels.c === 3 && levels.d === 4
    ? '\u2713' : '\u2717');

await page.evaluate(() => {
  const T = window.__t();
  T.newGame();
  T.pause(true);
  T.hold = 'T';
  T.queue = ['I', 'O', 'S'];
  T.score = 4820; T.lines = 23;
  const W = 10, ROWS = T.grid.length / W;
  const shape = ['J', 'L', 'S', 'Z', 'T', 'O', 'I'];
  for (let y = ROWS - 6; y < ROWS; y++)
    for (let x = 0; x < W; x++)
      if ((x * 7 + y * 3) % 5 < 3) T.grid[y * W + x] = shape[(x + y) % 7];
  T.piece = { k: 'T', r: 0, x: 4, y: 4 };
  T.paused = false;
  T.render();
});
await page.waitForTimeout(250);
await shoot('mid-game');

const sheet = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0d0f14;
  font:12px/1.4 system-ui,sans-serif;color:#cfd6e4;padding:16px;display:flex;gap:16px;align-items:flex-start">
  ${shots.map((s) => `<figure style="margin:0;text-align:center">
    <img src="data:image/png;base64,${s.png}" style="width:420px;border-radius:12px">
    <figcaption style="margin-top:6px;opacity:.8">${s.label}</figcaption></figure>`).join('')}
</body>`;
const sf = join(root, 'look', '_tetris-sheet.html');
writeFileSync(sf, sheet);
await page.setViewportSize({ width: 1400, height: 900 });
await page.goto('file://' + sf);
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote ' + out);
