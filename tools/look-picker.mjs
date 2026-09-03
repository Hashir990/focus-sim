/** The picker and the four rooms-required screens, photographed. */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const SANDBOX_CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const opts = () => {
  const p = process.env.CHROME_PATH || (existsSync(SANDBOX_CHROME) ? SANDBOX_CHROME : '');
  return p ? { executablePath: p, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] };
};
const root = '/work';
const out = join(root, 'look', 'picker.png');
mkdirSync(dirname(out), { recursive: true });

/* Splice at the LAST close — see HANDOFF §6. */
const src = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
  .replace(/const ACC_URL = '[^']*'/, "const ACC_URL = ''");
const at = src.lastIndexOf('})();');
const html = src.slice(0, at) + `
  window.__pick = () => { document.getElementById('overlay').classList.remove('hide'); };
  window.__game = async (id) => {
    document.getElementById('overlay').classList.remove('hide');
    Arcade.open = true; await Arcade.pick(id);
  };
` + src.slice(at);
const tmp = join(root, 'look', '_picker.html');
writeFileSync(tmp, html);

const browser = await chromium.launch(opts());
const page = await browser.newPage({ viewport: { width: 400, height: 1150 }, deviceScaleFactor: 2 });
await page.goto('file://' + tmp);
await page.waitForTimeout(900);
const shots = [];
const shoot = async (label, sel) => {
  const el = await page.$(sel);
  shots.push({ label, png: (await el.screenshot()).toString('base64') });
};
await page.evaluate(() => window.__pick());
await page.waitForTimeout(300);
await shoot('the picker', '#picker');
for (const [id, el] of [['hangman','game-hangman'],['scrabble','game-scrabble'],
                        ['pictionary','game-pictionary'],['chess','game-chess']]) {
  await page.evaluate((g) => window.__game(g), id);
  await page.waitForTimeout(350);
  await shoot(id, '#' + el);
}
const sheet = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0d0f14;
  font:12px/1.4 system-ui,sans-serif;color:#cfd6e4;padding:16px;display:flex;gap:16px;align-items:flex-start">
  ${shots.map((s) => `<figure style="margin:0;text-align:center">
    <img src="data:image/png;base64,${s.png}" style="width:400px;border-radius:12px">
    <figcaption style="margin-top:6px;opacity:.8">${s.label}</figcaption></figure>`).join('')}
</body>`;
const sf = join(root, 'look', '_picker-sheet.html');
writeFileSync(sf, sheet);
await page.setViewportSize({ width: 2160, height: 1250 });
await page.goto('file://' + sf);
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote ' + out);
