/**
 * The shop and the wardrobe, photographed.
 *
 * Both are lists of small squares that have to stay readable while they say
 * three things at once — what it is, whether it is yours, and what it costs.
 * That is not something to reason about in a DOM test.
 *
 *   node tools/look-shop.mjs [out.png]
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
const out = process.argv[2] ? join(root, process.argv[2]) : join(root, 'look', 'shop.png');
mkdirSync(dirname(out), { recursive: true });

const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
  .replace(/const ACC_URL = '[^']*'/, "const ACC_URL = ''")
  .replace('})();', `
  window.__shop = (tab, own) => {
    Embers.own = ['seaglass'].concat(own || []);
    Embers.have = 260; Embers.earned = 400;
    Embers.tab = tab;
    document.getElementById('shop-overlay').classList.remove('hide');
    Embers.render();
  };
  window.__wardrobe = (own) => {
    Embers.own = ['seaglass'].concat(own || []);
    document.getElementById('shop-overlay').classList.add('hide');
    S.buddy = {b:5, c:2, e:9, r:2, rc:0, h:11, hc:0, a:6, o:12};
    AcctPage.open();
  };
})();`);

const tmp = join(root, 'look', '_shop.html');
writeFileSync(tmp, html);

const OWN = ['bud-h8', 'bud-h5', 'bud-e9', 'bud-r2', 'bud-a5', 'bud-o12', 'bud-an3', 'bud-an4'];
const browser = await chromium.launch(chromeOpts());
const page = await browser.newPage({ viewport: { width: 400, height: 860 }, deviceScaleFactor: 2 });
await page.goto('file://' + tmp);
await page.waitForTimeout(800);

const shots = [];
const shoot = async (label, sel) => {
  const el = await page.$(sel);
  shots.push({ label, png: (await el.screenshot()).toString('base64') });
};

await page.evaluate((own) => window.__shop('buddy', own), OWN);
await page.waitForTimeout(400);
await shoot('shop · buddy', '#shop-overlay');
// trying one on
await page.evaluate(() => {
  const t = document.querySelector('[data-shop="h"][data-i="12"]');
  if (t) t.click();
});
await page.waitForTimeout(300);
await shoot('shop · trying the bubble', '#shop-overlay');

await page.evaluate((own) => window.__shop('antics', own), OWN);
await page.waitForTimeout(300);
await shoot('shop · antics', '#shop-overlay');

await page.evaluate((own) => window.__wardrobe(own), OWN);
await page.waitForTimeout(500);
await shoot('wardrobe', '#acct-overlay');
// the eye drawer, and the buddy still on screen after a scroll
await page.evaluate(() => {
  const b = document.querySelector('#bud-box [data-eyes="1"]');
  if (b) b.click();
});
await page.waitForTimeout(250);
await page.evaluate(() => {
  const body = document.querySelector('#acct-overlay .ov-body');
  if (body) body.scrollTop = 260;
});
await page.waitForTimeout(250);
await shoot('wardrobe · eyes, scrolled', '#acct-overlay');
await page.evaluate(() => {
  const b = document.querySelector('#bud-box [data-dye="o"]');
  if (b) b.click();
});
await page.waitForTimeout(250);
await shoot('wardrobe · coat colour', '#acct-overlay');

const sheet = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0d0f14;
  font:12px/1.4 system-ui,sans-serif;color:#cfd6e4;padding:16px;display:flex;gap:16px;align-items:flex-start">
  ${shots.map((s) => `<figure style="margin:0;text-align:center">
    <img src="data:image/png;base64,${s.png}" style="width:400px;border-radius:12px">
    <figcaption style="margin-top:6px;opacity:.8">${s.label}</figcaption></figure>`).join('')}
</body>`;
const sheetFile = join(root, 'look', '_shop-sheet.html');
writeFileSync(sheetFile, sheet);
await page.setViewportSize({ width: 1740, height: 1000 });
await page.goto('file://' + sheetFile);
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote ' + out);
