/**
 * Contact sheet of the buddy's parts, rendered through a real browser.
 *
 * `buddy-look.mjs` shells out to ImageMagick, which needs an SVG delegate that
 * is not always there and cannot resolve `currentColor`. This drives the built
 * file in jsdom exactly the same way to *collect* the drawings, then lays them
 * out on one dark page and photographs it with Chromium — so what lands in the
 * PNG is what a browser paints, labels and all.
 *
 * Needs jsdom and playwright:  npm i -D jsdom playwright
 *
 *   node tools/look2.mjs [outfile.png] [--rows e,h,f,a,o]
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { chromium } from 'playwright';

/* Playwright finds its own Chromium normally. In a sandbox that ships one at a
   fixed path and no downloader, it does not — so an explicit path is offered
   only when it is actually there, rather than hard-coded and wrong everywhere
   else. Set CHROME_PATH to override. */
const SANDBOX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const chromeOpts = () => {
  const p = process.env.CHROME_PATH
    || (existsSync(SANDBOX_CHROME) ? SANDBOX_CHROME : '');
  return p ? { executablePath: p, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] };
};

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = process.argv[2] || join(root, 'look', 'sheet.png');
const want = (process.argv.find(a => a.startsWith('--rows=')) || '--rows=e,h,f,a,o').slice(7).split(',');
mkdirSync(dirname(outFile), { recursive: true });

const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
  .replace(/const ACC_URL = '[^']*'/, "const ACC_URL = ''");

const w = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  virtualConsole: new VirtualConsole(), url: 'http://localhost/',
}).window;
await new Promise(r => setTimeout(r, 900));
const d = w.document;
d.getElementById('d-account').click();
await new Promise(r => setTimeout(r, 250));

const stage = () => d.getElementById('bud-box').querySelector('.bud-stage').innerHTML.trim();
const opts = key => [...d.querySelectorAll(`[data-bud="${key}"]`)];
const cells = [];
const rows = { e: 'eyes', h: 'hat', f: 'face', a: 'worn', o: 'outer' };
for (const key of want) {
  if (!rows[key] || !opts(key).length) continue;
  const n = opts(key).length;
  for (let i = 0; i < n; i++) {
    opts(key)[i].click();
    await new Promise(r => setTimeout(r, 40));
    cells.push({ label: `${rows[key]} ${i}`, svg: stage() });
  }
  opts(key)[0].click();
  await new Promise(r => setTimeout(r, 40));
}

const page = `<!doctype html><meta charset="utf-8"><style>
 body{background:#101418;color:#e6f6f2;font:12px/1.3 system-ui,sans-serif;margin:0;padding:14px;
      display:flex;flex-wrap:wrap;gap:10px;width:1180px;box-sizing:border-box}
 figure{margin:0;width:132px;background:#171d24;border:1px solid #26303a;border-radius:10px;
        padding:6px;text-align:center}
 figcaption{margin-top:4px;opacity:.75;font-size:11px}
 svg{display:block;margin:0 auto;width:116px;height:116px;overflow:visible}
</style>` + cells.map(c =>
  `<figure>${c.svg}<figcaption>${c.label}</figcaption></figure>`).join('');

writeFileSync(join(dirname(outFile), 'sheet.html'), page);
const b = await chromium.launch(chromeOpts());
const p = await b.newPage({ viewport: { width: 1180, height: 800 }, deviceScaleFactor: 2 });
await p.setContent(page);
await p.screenshot({ path: outFile, fullPage: true });
await b.close();
console.log(`wrote ${cells.length} cells to ${outFile}`);
process.exit(0);
