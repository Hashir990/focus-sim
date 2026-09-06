/**
 * The Beach look, photographed — timer, and an overlay over it.
 *
 *   node tools/look-beach.mjs [out.png]
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
const out = process.argv[2] ? join(root, process.argv[2]) : join(root, 'look', 'beach.png');
mkdirSync(dirname(out), { recursive: true });

/* Splice at the LAST close — see HANDOFF §6. */
const src = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
  .replace(/const ACC_URL = '[^']*'/, "const ACC_URL = ''");
const at = src.lastIndexOf('})();');
const html = src.slice(0, at) + `
  window.__beach = () => window.__look('beach');
  /* Any look on the shelf, so a weather change can be seen rather than argued
     about. Embers.paint is what puts the palette and the effect on the page.
     No backticks in here: this whole door is a template literal. */
  window.__look = (id) => {
    Embers.own = Embers.own.concat([id]);
    Embers.light = id;
    /* vfxApply hands the pane an empty kind while the timer is on its setup
       screen, so a look photographed straight off a fresh load has no weather
       in it at all. Pretend a session is running. */
    try{ S.mode = 'focus'; }catch(e){}
    Embers.paint();
  };
  window.__cal = () => { document.getElementById('cal-overlay').classList.remove('hide'); Cal.render(); };
  window.__shop = () => { document.getElementById('shop-overlay').classList.remove('hide'); Embers.render(); };
` + src.slice(at);
const tmp = join(root, 'look', '_beach.html');
writeFileSync(tmp, html);

const browser = await chromium.launch(opts());
const page = await browser.newPage({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 });
await page.goto('file://' + tmp);
await page.waitForTimeout(900);
await page.evaluate(() => window.__beach());
await page.waitForTimeout(600);

const shots = [];
const shoot = async (label, sel) => {
  const el = sel ? await page.$(sel) : null;
  shots.push({ label, png: (el ? await el.screenshot() : await page.screenshot()).toString('base64') });
};
await shoot('the timer');
await page.evaluate(() => window.__cal());
await page.waitForTimeout(350);
await shoot('a calendar over it');
await page.evaluate(() => { document.getElementById('cal-overlay').classList.add('hide'); });
await page.evaluate(() => window.__shop());
await page.waitForTimeout(350);
await shoot('the shelf');
await page.evaluate(() => { document.getElementById('shop-overlay').classList.add('hide'); });
for (const [id, label] of [['magma', 'magma'], ['frost', 'frost']]) {
  await page.evaluate((x) => window.__look(x), id);
  await page.waitForTimeout(1400);
  await shoot(label);
}

const sheet = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0d0f14;
  font:12px/1.4 system-ui,sans-serif;color:#cfd6e4;padding:16px;display:flex;gap:16px;align-items:flex-start">
  ${shots.map((s) => `<figure style="margin:0;text-align:center">
    <img src="data:image/png;base64,${s.png}" style="width:400px;border-radius:12px">
    <figcaption style="margin-top:6px;opacity:.8">${s.label}</figcaption></figure>`).join('')}
</body>`;
const sf = join(root, 'look', '_beach-sheet.html');
writeFileSync(sf, sheet);
await page.setViewportSize({ width: 2160, height: 960 });
await page.goto('file://' + sf);
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote ' + out);
