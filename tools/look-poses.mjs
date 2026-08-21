/** Contact sheet of the pose *drawings* — limbs and props, held still.
 *  `look-antics.mjs` shows the engines running; this shows what they move.  */
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
const outFile = process.argv[2] || join(root, 'look', 'poses.png');
mkdirSync(dirname(outFile), { recursive: true });
const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
  .replace(/const ACC_URL = '[^']*'/, "const ACC_URL = ''");
const w = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
  virtualConsole: new VirtualConsole(), url: 'http://localhost/' }).window;
await new Promise((r) => setTimeout(r, 900));
const d = w.document;
d.getElementById('begin').click(); await new Promise((r) => setTimeout(r, 250));
d.getElementById('d-account').click(); await new Promise((r) => setTimeout(r, 200));
const n = d.querySelectorAll('[data-anim]').length;
const cells = [];
for (let i = 0; i < n; i++) {
  d.querySelectorAll('[data-anim]')[i].click();
  await new Promise((r) => setTimeout(r, 140));
  const name = d.querySelector('.bud-anim-name b').textContent;
  for (const id of ['bud-live', 'bud-pause']) {
    const el = d.getElementById(id);
    if (el && !el.classList.contains('hide') && el.innerHTML.trim()) {
      cells.push({ name, cls: el.className, html: el.innerHTML }); break;
    }
  }
}
const css = [...d.querySelectorAll('style')].map((x) => x.textContent).join('\n');
const page = `<!doctype html><meta charset="utf-8"><style>${css}
 body{background:#101418;color:#e6f6f2;font:12px/1.3 system-ui,sans-serif;margin:0;padding:14px;
      display:flex;flex-wrap:wrap;gap:12px;width:1180px;box-sizing:border-box}
 figure{margin:0;width:172px;height:200px;background:#171d24;border:1px solid #26303a;
        border-radius:10px;position:relative;overflow:hidden}
 figcaption{position:absolute;left:0;right:0;bottom:5px;text-align:center;opacity:.8}
 /* held still, and placed in the middle of its own box rather than wherever
    its engine would have put it on a real screen */
 .bud-slot, .bud-slot *{ animation:none !important }
 figure .bud-slot{ position:absolute; left:50%; top:46%; right:auto; bottom:auto;
                   margin:0; transform:translate(-50%,-50%) !important; rotate:0deg !important }
 figure .bud-rope{ display:none }
 figure .bud-swing .bud{ position:static }
 figure .bud-slot svg{ width:104px !important; height:104px !important }
</style>` + cells.map((c) =>
  `<figure><div class="${c.cls.replace(' hide', '')}">${c.html}</div>
   <figcaption>${c.name}</figcaption></figure>`).join('');
writeFileSync(join(dirname(outFile), 'poses.html'), page);
const b = await chromium.launch(chromeOpts());
const p = await b.newPage({ viewport: { width: 1180, height: 500 }, deviceScaleFactor: 2 });
await p.setContent(page);
await p.screenshot({ path: outFile, fullPage: true });
await b.close();
console.log('wrote ' + cells.length + ' poses');
process.exit(0);
