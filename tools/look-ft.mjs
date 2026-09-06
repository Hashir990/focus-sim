/**
 * Focus together and a profile, photographed.
 *
 *   node tools/look-ft.mjs [out.png]
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
const out = process.argv[2] ? join(root, process.argv[2]) : join(root, 'look', 'ft.png');
mkdirSync(dirname(out), { recursive: true });

/* **Splice at the *last* `})();`, never the first.** There is a nested one
   two-thirds up the bundle inside 28-ambience.js, and a door put there names
   `const`s that are still in temporal dead zone — the whole IIFE throws on load
   and the page comes up blank with nothing to explain it. Same trap as
   `withDoor` in the smoke test; see §6 of HANDOFF.md. */
const splice = (src, code) => {
  const at = src.lastIndexOf('})();');
  if (at < 0) throw new Error('no IIFE close found in dist/index.html');
  return src.slice(0, at) + code + src.slice(at);
};

const html = splice(
  readFileSync(join(root, 'dist', 'index.html'), 'utf8')
    .replace(/const ACC_URL = '[^']*'/, "const ACC_URL = ''"), `
  window.__ft = () => {
    Account.token = 'x'; Account.username = 'hashir';
    SYNC.name = 'Hashir';
    DAILY = {
      'sudoku:easy':{'2026-08-25':{s:2,t:300,d:1},'2026-08-26':{s:2,t:280,d:1},'2026-08-27':{s:2,t:260,d:1}},
      'sudoku:hard':{'2026-08-26':{s:2,t:1400,d:1}},
      'wordle:':{'2026-08-25':{s:2,g:4,w:1,d:1},'2026-08-26':{s:2,g:3,w:1,d:1}},
      'crossword:7':{'2026-08-26':{s:2,t:500,n:26,h:0,d:1}},
    };
    LOG.length = 0;
    for(let i=0;i<24;i++) LOG.push({id:'s'+i, secs:1500, ts:1, at:1, day:'2026-08-2'+(i%9)});
    const other = {u:'sam', n:'Sam', hrs:41.5, sess:63,
      g:{sud:22, run:9, wrd:31, avg:3.8, cw:14}, buddy:{b:3,c:1,e:9,r:2,h:6,a:5,o:4}, anim:2, at:Date.now()-3*3600*1000};
    SYNC.friends = [
      {code:'MKQJ4T', u:'sam', name:'sam', ok:1, card:other, at:Date.now()},
      {code:'PW7ZLB', u:'noor', name:'noor', asked:Date.now()},
      {code:'HD3RXC', name:'HD3RXC'},
    ];
    /* A room with three in it, each on something different, so the marks can be
       seen beside the names. */
    SYNC.mode = 'hosting'; SYNC.selfId = 'me'; SYNC.leaderId = 'me'; SYNC.code = 'MKQJ4T';
    SYNC.conns = {p1:{}, p2:{}};
    SYNC.roster = {p1:'Sam', p2:'Noor'};
    SYNC.codes = {p1:'MKQJ4T', p2:'PW7ZLB'};
    SYNC.games = {p1:'chess', p2:'crossword'};
    SYNC.buddies = {p1:{b:3,c:1,e:9,r:2,h:6,a:5,o:4}, p2:{b:1,c:2,e:4,r:7}};
    SYNC.anims = {p1:2, p2:0};
    SYNC.online = {MKQJ4T:true, PW7ZLB:false};
    SYNC.inRoom = {MKQJ4T:true};
    SYNC.asks = {QQ2BVN:{code:'QQ2BVN', u:'ayaan', card:null, at:Date.now()}};
    document.getElementById('sync-overlay').classList.remove('hide');
    syncRender();
  };
  window.__prof = (c) => profOpen(c);
  window.__typing = (name) => {
    const box = document.getElementById('ft-user');
    box.value = name;
    friendCodeHint(name);
  };
`);
const tmp = join(root, 'look', '_ft.html');
writeFileSync(tmp, html);

const browser = await chromium.launch(chromeOpts());
const page = await browser.newPage({ viewport: { width: 400, height: 980 }, deviceScaleFactor: 2 });
await page.goto('file://' + tmp);
await page.waitForTimeout(900);
const shots = [];
const shoot = async (label, sel) => {
  const el = await page.$(sel);
  shots.push({ label, png: (await el.screenshot()).toString('base64') });
};
await page.evaluate(() => window.__ft());
await page.waitForTimeout(400);
await shoot('focus together', '#sync-overlay');
await page.evaluate(() => window.__typing('noor'));
await page.waitForTimeout(250);
await shoot('the code a name makes', '#sync-overlay');
await page.evaluate(() => window.__typing(''));
await page.waitForTimeout(120);
await page.evaluate(() => window.__prof('MKQJ4T'));
await page.waitForTimeout(300);
await shoot('a friend’s profile', '#prof-overlay');
await page.evaluate(() => window.__prof('PW7ZLB'));
await page.waitForTimeout(300);
await shoot('one who has not answered', '#prof-overlay');

const sheet = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0d0f14;
  font:12px/1.4 system-ui,sans-serif;color:#cfd6e4;padding:16px;display:flex;gap:16px;align-items:flex-start">
  ${shots.map((s) => `<figure style="margin:0;text-align:center">
    <img src="data:image/png;base64,${s.png}" style="width:400px;border-radius:12px">
    <figcaption style="margin-top:6px;opacity:.8">${s.label}</figcaption></figure>`).join('')}
</body>`;
const sheetFile = join(root, 'look', '_ft-sheet.html');
writeFileSync(sheetFile, sheet);
await page.setViewportSize({ width: 1320, height: 1060 });
await page.goto('file://' + sheetFile);
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote ' + out);
