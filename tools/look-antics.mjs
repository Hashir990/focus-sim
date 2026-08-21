/**
 * Look at the antics — the poses, and the crowd, moving.
 *
 * `buddy-look.mjs` photographs the parts; this photographs the *engines*. It
 * drives the built file in jsdom to collect the real markup each antic produces
 * (limbs, props, rig and all), lays every one of them into a real `.bud-layer`
 * with the app's own stylesheet, and lets Chromium run them — so what lands in
 * the PNG is the animation, at a stated moment, and not a guess about it.
 *
 * Needs jsdom and playwright:  npm i -D jsdom playwright
 *
 *   node tools/look-antics.mjs [outdir] [--at=0.4,3,9]
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
const out = process.argv[2] || join(root, 'look');
const at = (process.argv.find((a) => a.startsWith('--at=')) || '--at=0.4,3.2,9').slice(5)
  .split(',').map(Number);
mkdirSync(out, { recursive: true });

const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
  .replace(/const ACC_URL = '[^']*'/, "const ACC_URL = ''");

const w = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  virtualConsole: new VirtualConsole(), url: 'http://localhost/',
}).window;
await new Promise((r) => setTimeout(r, 900));
const d = w.document;

/* The antics only exist on the clock screens, so the clock has to be running. */
d.getElementById('begin').click();
await new Promise((r) => setTimeout(r, 250));
d.getElementById('d-account').click();
await new Promise((r) => setTimeout(r, 200));

const css = [...d.querySelectorAll('style')].map((n) => n.textContent).join('\n');
const buttons = [...d.querySelectorAll('[data-anim]')];
const slots = [];
for (let i = 0; i < buttons.length; i++) {
  d.querySelectorAll('[data-anim]')[i].click();
  await new Promise((r) => setTimeout(r, 140));
  for (const id of ['bud-live', 'bud-pause']) {
    const el = d.getElementById(id);
    if (el && !el.classList.contains('hide') && el.innerHTML.trim()) {
      slots.push({ i, cls: el.className, style: el.getAttribute('style') || '', html: el.innerHTML });
      break;
    }
  }
}
console.log('collected ' + slots.length + ' poses');

/* One peer per pose, each with the seed values `Buddy.crowd()` would write, so
   the sheet shows the desynchronisation and not just the drawings. */
const peers = slots.map((s, n) => {
  const t = -(n * 3.7 + 1.3).toFixed(2);
  return `<div class="${s.cls.replace('bud-slot', 'bud-slot bud-peer')}"
     style="${s.style};--t:${t}s;--x:${n * 46}px;--y:${(n * 3) % 13}vh">${s.html}</div>`;
});

const page = `<!doctype html><meta charset="utf-8"><style>${css}
 html,body{margin:0;height:100%;background:#0d1117}
 .bud-layer{position:fixed;inset:0;overflow:hidden}
</style><div class="bud-layer">${peers.join('')}</div>`;
writeFileSync(join(out, 'antics.html'), page);

const b = await chromium.launch(chromeOpts());
const p = await b.newPage({ viewport: { width: 1180, height: 700 }, deviceScaleFactor: 1.6 });
await p.setContent(page);
let last = 0;
for (const t of at) {
  await p.waitForTimeout(Math.max(0, (t - last) * 1000));
  last = t;
  await p.screenshot({ path: join(out, `antics-${String(t).replace('.', '_')}s.png`) });
}
await b.close();
console.log('wrote ' + at.length + ' frames to ' + out);
process.exit(0);
