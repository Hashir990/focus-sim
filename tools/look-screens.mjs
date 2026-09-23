/**
 * Photograph this round's screens — picross at each size, and the developer
 * page — by driving the built app and keeping what it drew.
 *
 * The other look tools hand the markup to Chromium. This one stops a step
 * earlier and writes the markup out with the app's own stylesheet around it, so
 * it needs nothing but jsdom: open the result in any browser and what you are
 * looking at is the app's real HTML under the app's real CSS, not a mock-up.
 *
 *   node tools/look-screens.mjs [out.html]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ? join(root, process.argv[2]) : join(root, 'look', 'screens.html');
mkdirSync(dirname(out), { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* The developer page needs a stamp *and* a key, and the build on this machine
   already carries the real ones — including the account it belongs to. Those
   come off and the sheet stamps a key of its own, so what is photographed is
   the page rather than whichever lock happens to be set here. */
const KEY = 'a-key-for-the-sheet';
const src = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
  .replace(/const ACC_URL = '[^']*'/, "const ACC_URL = ''")
  .replace(/<html([^>]*)>/, (m, a) => '<html' + a.replace(/\s*data-dev(-[a-z]+)?="[^"]*"/g, '') + '>')
  .replace('<html', '<html data-dev="1" data-dev-key="'
    + createHash('sha256').update(KEY, 'utf8').digest('hex') + '"');
const at = src.lastIndexOf('})();');
const html = src.slice(0, at)
  + '\nwindow.__s = {Arcade, Picross, picOnDay, pktNow, devTry};\n'
  + src.slice(at);

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'http://localhost/', virtualConsole: new VirtualConsole(),
});
const w = dom.window, d = w.document;
await wait(900);

const css = [...d.querySelectorAll('style')].map((n) => n.textContent).join('\n');
const shots = [];
/* The overlay and not the game alone: half the look of a screen is the frame
   it sits in, and its classes are what the CSS is written against. */
const grab = (label, sel, tall) => shots.push({ label, html: d.querySelector(sel).outerHTML, tall });

d.getElementById('arcade-open').click();
await wait(150);
await w.__s.Arcade.pick('picross');
await wait(250);

const P = w.__s.Picross;
const pick = async (diff) => {
  d.querySelector(`#pix-sizes [data-size="${diff}"]`).click();
  await wait(220);
};

/* 5×5 untouched, 10×10 half done, 15×15 finished — the three states anybody
   actually sees, rather than three empty grids. */
await pick('easy');
grab('5×5, as you meet it', '#overlay');

await pick('medium');
{
  const n = P.size;
  let put = 0;
  for (let y = 0; y < n && put < 26; y++) {
    for (let x = 0; x < n; x++) {
      if (P.sol[y][x] === 1 && put < 26) { P._put(y * n + x, 1); put++; }
    }
  }
  P._put(9 * n + 0, 2);                 // and a square pencilled out
  await wait(150);
}
grab('10×10, part way in — finished lines dim their own clues', '#overlay');

await pick('hard');
{
  const n = P.size;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (P.sol[y][x] === 1) P._put(y * n + x, 1);
  P._check();
  await wait(200);
}
grab('15×15, finished', '#overlay');

/* --- the developer page --- */
d.getElementById('game-close')?.click();
await wait(150);
d.getElementById('d-dev').click();
await wait(250);
grab('the developer page, as anybody else finds it', '#dev-overlay');
w.__s.devTry(KEY);                      // the key, typed once on this device
d.getElementById('d-dev').click();
await wait(250);
grab('and once the key is in', '#dev-overlay', true);
/* And the one tool that cannot be had by waiting: move what today is. */
d.querySelector('#dev-body [data-day="1"]')?.click();
await wait(200);
grab('with the day moved on one', '#dev-overlay', true);

const frames = shots.map((s) => `<figure>
  <figcaption>${s.label}</figcaption>
  <div class="phone${s.tall ? ' tall' : ''}">${s.html}</div></figure>`).join('');

const page = `<!doctype html><meta charset="utf-8"><title>Picross and the developer page</title>
<style>${css}</style>
<style>
  body{ margin:0; padding:22px; background:#070c16; font:14px/1.5 system-ui,Segoe UI,sans-serif;
        color:#e7ecf6 }
  h1{ font-size:19px; margin:0 0 16px }
  .row{ display:flex; gap:18px; flex-wrap:wrap; align-items:flex-start }
  figure{ margin:0 }
  figcaption{ font-size:12px; color:#8695b4; margin:0 0 6px }
  .measured{ font-size:12px; color:#8695b4; margin:0 0 16px; font-variant-numeric:tabular-nums }
  /* A phone-shaped window, with the app's own overlay left exactly as it is
     inside it — position:fixed becomes position:absolute against this box. */
  .phone{ width:380px; height:720px; overflow:hidden; position:relative;
          border:1px solid rgba(255,255,255,.16); border-radius:20px; background:var(--bg,#0b1220) }
  /* The developer page is longer than a phone and scrolls in the app; here it
     is shown whole rather than cut off at the bottom of the glass. */
  .phone.tall{ height:980px }
  .phone .overlay{ position:absolute }
</style>
<h1>Picross, and the developer page</h1>
<p id="measured" class="measured">measuring…</p>
<div class="row">${frames}</div>
<script>
/* **The sheet measures itself.** jsdom has no layout, so the two things that
   went wrong here — squares that came out a different size at every board
   size, and a cross-off mark that resolved to 0px and drew nothing — were
   invisible to the test suite and to this tool until a browser had the page.
   Now opening it says so. */
(() => {
  const out = [];
  document.querySelectorAll('figure').forEach((f) => {
    const c = f.querySelector('.pix-cell');
    if (!c) return;
    const r = c.getBoundingClientRect();
    const box = c.parentElement.getBoundingClientRect();
    const wrap = c.parentElement.parentElement;
    const n = +getComputedStyle(wrap).getPropertyValue('--pix-n');
    /* The column the grid was given, against what the squares actually take:
       the first version left the difference empty. */
    const track = parseFloat(getComputedStyle(wrap).gridTemplateColumns.split(' ')[1]);
    out.push(n + '×' + n + ': ' + r.width.toFixed(1) + '×' + r.height.toFixed(1) + 'px'
      + (Math.abs(r.width - r.height) > 0.6 ? ' NOT SQUARE' : '')
      + ', ' + (Math.abs(track - box.width) < 1.5 ? 'filling its column'
        : 'SHORT OF ITS COLUMN by ' + (track - box.width).toFixed(0) + 'px'));
  });
  const off = document.querySelector('.pix-cell.off');
  if (off) {
    const a = getComputedStyle(off, '::after');
    const drawn = a.backgroundImage !== 'none' || parseFloat(a.fontSize) > 4;
    out.push('a crossed-off square ' + (drawn ? 'shows its mark' : 'DRAWS NOTHING'));
  }
  document.getElementById('measured').textContent = out.join('  ·  ');
})();
</script>`;

writeFileSync(out, page);
console.log('wrote ' + out + ' — ' + shots.length + ' screens');
process.exit(0);
