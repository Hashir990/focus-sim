/**
 * The hair row over a drawn skull, with the lines it has to respect.
 *
 *   node tools/look-hair.mjs [out.png]
 *
 * The skull is a circle at (32,27) r=16 (see 46-buddy.js). Three guides:
 * the crown at y=11, the widest point at y=27, and the brow at y=23.5, which
 * nothing may cross in the middle. A style whose own crown sits below the
 * red line is leaving scalp showing on top.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const P = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const opts = () => (existsSync(P) ? { executablePath: P, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ? join(root, process.argv[2]) : join(root, 'look', 'hair.png');
mkdirSync(dirname(out), { recursive: true });

const src = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
const at = src.lastIndexOf('})();');
const html = src.slice(0, at) + `
  window.__hair = () => BUD_HAIR.map((h, i) => ({i, n:h.n, s:h.s || '', b:h.b || ''}));
` + src.slice(at);
const tmp = join(root, 'look', '_hair.html');
writeFileSync(tmp, html);

const browser = await chromium.launch(opts());
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto('file://' + tmp);
await page.waitForTimeout(700);
const hairs = await page.evaluate(() => window.__hair());

const guides = `
  <circle cx="32" cy="27" r="16" fill="#f0c9a4"/>
  <circle cx="32" cy="27" r="16" fill="none" stroke="#3ad" stroke-width=".4"/>
  <line x1="0" y1="11" x2="64" y2="11" stroke="#e33" stroke-width=".35"/>
  <line x1="0" y1="23.5" x2="64" y2="23.5" stroke="#fa0" stroke-width=".35" stroke-dasharray="1.5 1.5"/>
  <line x1="0" y1="27" x2="64" y2="27" stroke="#3ad" stroke-width=".35" stroke-dasharray="1.5 1.5"/>`;
const cards = hairs.map((h) => `<figure style="margin:0;text-align:center">
  <svg viewBox="0 0 64 64" width="190" height="190" style="background:#151922;border-radius:10px">
    ${h.b}${guides}${h.s}
  </svg>
  <figcaption style="margin-top:4px;font:11px system-ui;color:#9fb">${h.i} · ${h.n}</figcaption></figure>`).join('');
const sheet = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0d0f14;padding:16px;
  display:flex;flex-wrap:wrap;gap:12px">${cards}</body>`;
const sf = join(root, 'look', '_hair-sheet.html');
writeFileSync(sf, sheet);
await page.goto('file://' + sf);
await page.waitForTimeout(250);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote ' + out);
