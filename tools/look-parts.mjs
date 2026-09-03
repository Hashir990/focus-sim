/**
 * Every part he can wear, drawn by a real browser, at icon size and worn.
 *
 * The picker draws each part on its own and the buddy draws them stacked, and
 * the two go wrong in different ways: an icon can be cropped to nothing by its
 * own `box`, and a part that looks right alone can sit under his chin, past his
 * hem or on top of his eyes. So this renders both — a contact sheet of every
 * icon, then a row of whole buddies wearing the new things together.
 *
 *   node tools/look-parts.mjs [out.png] [--rows e,r,h,f,a,o] [--tint 4]
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
const out = process.argv[2] && !process.argv[2].startsWith('--')
  ? join(root, process.argv[2]) : join(root, 'look', 'parts.png');
const arg = (name, dflt) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : dflt;
};
const rows = arg('rows', 'e,r,h,f,a,o').split(',');
const tint = +arg('tint', 0);
mkdirSync(dirname(out), { recursive: true });

const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
  .replace(/const ACC_URL = '[^']*'/, "const ACC_URL = ''")
  .replace('})();', `
  window.__parts = (want, tint) => BUD_ROWS.filter(r => want.indexOf(r.k) >= 0).map(r => ({
    name: r.name,
    items: r.list().map((p, i) => ({
      i, cost: budCost(r.id, i),
      icon: budIcon(p, r.ink ? 0 : tint, r.ink ? BUD_INK[tint] : ''),
    })),
  }));
  window.__wear = (v) => budSvg(v, 112);
})();`);

const tmp = join(root, 'look', '_parts.html');
writeFileSync(tmp, html);

const browser = await chromium.launch(chromeOpts());
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
await page.goto('file://' + tmp);
await page.waitForTimeout(700);

const data = await page.evaluate(([r, t]) => window.__parts(r, t), [rows, tint]);

/* A few whole buddies, to see the stack: hair under a hat, a coat under a
   scarf, a mask over eyes, and the long hair behind his shoulders. */
const WORN = [
  { label: 'hair 1 · no hat', v: { b: 0, c: 0, e: 1, r: 1 } },
  { label: 'hair 2', v: { b: 0, c: 2, e: 1, r: 2 } },
  { label: 'hair 3', v: { b: 0, c: 4, e: 1, r: 3 } },
  { label: 'hair 4', v: { b: 0, c: 1, e: 1, r: 4 } },
  { label: 'hair 5', v: { b: 0, c: 3, e: 1, r: 5 } },
  { label: 'hair 2 dyed 7', v: { b: 0, c: 0, e: 1, r: 2, rc: 7 } },
  { label: 'worn: pendant', v: { b: 0, c: 0, e: 1, a: 5 } },
  { label: 'worn: sash', v: { b: 0, c: 0, e: 1, a: 8 } },
  { label: 'coat: dungarees', v: { b: 0, c: 0, e: 1, o: 10 } },
  { label: 'coat: apron', v: { b: 0, c: 0, e: 1, o: 14 } },
  { label: 'wizard · curls', v: { b: 8, c: 2, e: 9, r: 2, h: 8, o: 12 } },
  { label: 'flowers · long hair', v: { b: 4, c: 0, e: 11, r: 5, h: 9, a: 6, o: 14 } },
  { label: 'bandana · ponytail', v: { b: 2, c: 3, e: 12, r: 3, h: 10, a: 5, o: 10 } },
  { label: 'party · bun', v: { b: 9, c: 1, e: 8, r: 4, h: 11, a: 7, o: 13 } },
  { label: 'bubble · snorkel', v: { b: 0, c: 4, e: 10, r: 1, h: 12, f: 9, o: 11 } },
  { label: 'dyed: hat 6 · coat 4', v: { b: 5, c: 2, e: 2, r: 2, rc: 5, h: 6, hc: 1, o: 4, oc: 7, a: 3, ac: 6 } },
];
const worn = [];
for (const w of WORN) worn.push({ label: w.label, svg: await page.evaluate((v) => window.__wear(v), w.v) });

const sheet = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#12141a;
  font:12px/1.4 system-ui,sans-serif;color:#cfd6e4;padding:18px">
  <div style="display:flex;gap:18px;flex-wrap:wrap;margin-bottom:22px">
    ${worn.map((w) => `<figure style="margin:0;text-align:center;background:#1b1f28;
      border-radius:14px;padding:10px 12px"><div style="color:#e9edf5">${w.svg}</div>
      <figcaption style="margin-top:4px;opacity:.75">${w.label}</figcaption></figure>`).join('')}
  </div>
  ${data.map((row) => `<p style="margin:14px 0 6px;font-weight:600;letter-spacing:.08em;
      text-transform:uppercase;opacity:.7">${row.name}</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      ${row.items.map((it) => `<figure style="margin:0;width:64px;text-align:center;
        background:#1b1f28;border-radius:10px;padding:8px 4px;color:#e9edf5">
        <div style="display:flex;justify-content:center">${it.icon}</div>
        <figcaption style="margin-top:4px;opacity:.7;font-size:11px">${it.i}${it.cost ? ` · ${it.cost}` : ''}</figcaption>
      </figure>`).join('')}
    </div>`).join('')}
</body>`;
const sheetFile = join(root, 'look', '_parts-sheet.html');
writeFileSync(sheetFile, sheet);
await page.goto('file://' + sheetFile);
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote ' + out);
