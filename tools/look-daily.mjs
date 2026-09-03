/**
 * The puzzle calendar, photographed, and the schedule, checked.
 *
 * A calendar is a grid of small marks that has to say two things at once —
 * which difficulty and how far you got — and whether that reads is not
 * something to reason about in a DOM test.
 *
 *   node tools/look-daily.mjs [out.png]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const SANDBOX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const chromeOpts = () => {
  const p = process.env.CHROME_PATH || (existsSync(SANDBOX_CHROME) ? SANDBOX_CHROME : '');
  return p ? { executablePath: p, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] };
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ? join(root, process.argv[2]) : join(root, 'look', 'daily.png');
mkdirSync(dirname(out), { recursive: true });

const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
  .replace(/const ACC_URL = '[^']*'/, "const ACC_URL = ''")
  .replace('})();', `
  window.__seed = (rec) => { DAILY = rec; };
  window.__pick = (d) => { DCal.sel = d; DCal.render(); };
  window.__shelf = () => Cross.openPicker();
  window.__cal = (id) => {
    document.getElementById('overlay').classList.remove('hide');
    dailyCalOpen(id);
  };
  window.__game = async (id) => {
    document.getElementById('overlay').classList.remove('hide');
    Arcade.open = true;
    await Arcade.pick(id);
  };
  window.__probe = () => ({
    today: pktNow(),
    // the same three strings must give the same grid every time
    sudokuTwice: (() => {
      const a = sMake('hard', dailyGen('sudoku', 'hard', '2026-08-27')).puz.join('');
      const b = sMake('hard', dailyGen('sudoku', 'hard', '2026-08-27')).puz.join('');
      const c = sMake('hard', dailyGen('sudoku', 'hard', '2026-08-28')).puz.join('');
      return { same: a === b, moved: a !== c };
    })(),
    schedule: ['2026-08-17','2026-08-18','2026-08-19','2026-08-20','2026-08-21','2026-08-22','2026-08-23']
      .map(d => ({ d, dow: pktDow(d), out: [5,7,9,15].filter(n => crossReleases(n, d)) })),
    fives: [0,1,2,3].map(n => crossReleaseDay(5, n)),
    nines: [0,1,2,3].map(n => crossReleaseDay(9, n)),
    fifteens: [0,1,2].map(n => crossReleaseDay(15, n)),
  });
})();`);

const tmp = join(root, 'look', '_daily.html');
writeFileSync(tmp, html);

const browser = await chromium.launch(chromeOpts());
const page = await browser.newPage({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 2 });
await page.goto('file://' + tmp);
await page.waitForTimeout(900);

console.log(JSON.stringify(await page.evaluate(() => window.__probe()), null, 1));

/* A month with something of everything in it, so all three dot states and all
   four hues are on screen at once. */
await page.evaluate(() => window.__seed({
  'sudoku:easy':   { '2026-08-19': {s:2,t:372}, '2026-08-21': {s:2,t:294}, '2026-08-24': {s:1,t:88}, '2026-08-26': {s:2,t:410} },
  'sudoku:medium': { '2026-08-19': {s:2,t:781}, '2026-08-22': {s:1,t:203}, '2026-08-25': {s:2,t:642} },
  'sudoku:hard':   { '2026-08-20': {s:1,t:455}, '2026-08-26': {s:2,t:1508} },
  'crossword:5':   { '2026-08-18': {s:2,t:214,n:12,h:0}, '2026-08-19': {s:2,t:188,n:12,h:2}, '2026-08-24': {s:1,t:63,c:4,n:12,h:1} },
  'crossword:7':   { '2026-08-18': {s:2,t:602,n:26,h:1}, '2026-08-25': {s:1,t:150,c:9,n:26,h:0} },
  'crossword:9':   { '2026-08-19': {s:2,t:1440,n:41,h:3} },
  'crossword:15':  { '2026-08-23': {s:1,t:900,c:18,n:78,h:4} },
  'wordle:':       { '2026-08-19': {s:2,g:4,w:1,d:1,p:'xxyxx'+'xygxx'+'gyxgx'+'ggggg'},
                     '2026-08-20': {s:2,g:6,w:0,d:1,p:'xxxxx'+'xxyxx'+'yxxgx'+'xgxgx'+'gxggx'+'ggxgg'},
                     '2026-08-24': {s:2,g:3,w:1,d:1,p:'xxxgx'+'xyxgx'+'ggggg'},
                     '2026-08-26': {s:1} },
}));

const shots = [];
const shoot = async (label, sel) => {
  const el = await page.$(sel);
  shots.push({ label, png: (await el.screenshot()).toString('base64') });
};

await page.evaluate(() => window.__cal('sudoku'));
await page.waitForTimeout(350);
await shoot('calendar · sudoku', '#dcal-overlay');

await page.evaluate(() => window.__pick('2026-08-19'));
await page.waitForTimeout(250);
await shoot('sudoku · a day picked', '#dcal-overlay');

await page.evaluate(() => window.__cal('wordle'));
await page.waitForTimeout(300);
await page.evaluate(() => window.__pick('2026-08-24'));
await page.waitForTimeout(200);
await shoot('word guess \u00b7 found in three', '#dcal-overlay');
await page.evaluate(() => window.__pick('2026-08-20'));
await page.waitForTimeout(200);
await shoot('word guess \u00b7 all six, missed', '#dcal-overlay');

await page.evaluate(() => window.__cal('crossword'));
await page.waitForTimeout(300);
await shoot('calendar \u00b7 crossword', '#dcal-overlay');

await page.evaluate(() => window.__pick('2026-08-23'));
await page.waitForTimeout(250);
await shoot('crossword · a Sunday', '#dcal-overlay');

await page.evaluate(() => { document.getElementById('dcal-overlay').classList.add('hide'); });
await page.evaluate(() => window.__game('crossword'));
await page.waitForTimeout(500);
await page.evaluate(() => window.__shelf());
await page.waitForTimeout(300);
await shoot('the crossword shelf, dated', '#overlay');

const sheet = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0d0f14;
  font:12px/1.4 system-ui,sans-serif;color:#cfd6e4;padding:16px;display:flex;gap:16px;align-items:flex-start">
  ${shots.map((s) => `<figure style="margin:0;text-align:center">
    <img src="data:image/png;base64,${s.png}" style="width:400px;border-radius:12px">
    <figcaption style="margin-top:6px;opacity:.8">${s.label}</figcaption></figure>`).join('')}
</body>`;
const sheetFile = join(root, 'look', '_daily-sheet.html');
writeFileSync(sheetFile, sheet);
await page.setViewportSize({ width: 2140, height: 1000 });
await page.goto('file://' + sheetFile);
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote ' + out);
