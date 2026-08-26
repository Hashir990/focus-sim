/**
 * Photograph the hourglass face, focus and rest, at several points on the clock.
 *
 * The report was "in rest the sand collects at the top". Both halves of that
 * face are worked out in two places - `facePaint` swaps which bulb is filling
 * (43-faces.js) and the stylesheet turns the whole thing over (33-faces.css) -
 * so reasoning about it on paper is exactly how you convince yourself it is
 * fine. This drives the built file in a real browser and photographs it.
 *
 *   node tools/look-glass.mjs [outfile.png]
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
const outFile = process.argv[2] || join(root, 'look', 'glass.png');
mkdirSync(dirname(outFile), { recursive: true });

/* One door into the closure, opened only for this tool - the same trick
   `dev-build.mjs` plays, and for the same reason: the app is one IIFE and a
   script on the page can otherwise only click buttons. */
const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
  .replace(/const ACC_URL = '[^']*'/, "const ACC_URL = ''")
  .replace('})();', `
  window.__glass = (mode, frac) => {
    try{ if(Embers.own.indexOf('face-glass') < 0) Embers.own.push('face-glass'); }catch(e){}
    S.face = 'glass'; S.mode = mode;
    S.total = 600; S.remaining = Math.round(600 * frac); S.running = true;
    faceApply(); swapView(); render();
    return document.getElementById('app').getAttribute('data-phase');
  };
})();`);

const tmp = join(root, 'look', '_glass.html');
writeFileSync(tmp, html);

const browser = await chromium.launch(chromeOpts());
const page = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 });
await page.goto('file://' + tmp);
await page.waitForTimeout(900);

const shots = [];
for (const mode of ['focus', 'rest']) {
  for (const frac of [1, 0.75, 0.5, 0.25, 0]) {
    const phase = await page.evaluate(([m, f]) => window.__glass(m, f), [mode, frac]);
    await page.waitForTimeout(700);          // the turn is a .6s transition
    const el = await page.$('.dial-wrap') || await page.$('#face-glass');
    const buf = await el.screenshot({ timeout: 4000 });
    shots.push({ label: `${mode} · ${Math.round(frac * 100)}% left · data-phase=${phase}`,
                 png: buf.toString('base64') });
  }
}

const sheet = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#12141a;
  font:12px/1.5 system-ui,sans-serif;color:#cfd6e4;display:grid;
  grid-template-columns:repeat(5,1fr);gap:14px;padding:16px">
  ${shots.map(s => `<figure style="margin:0;text-align:center">
    <img src="data:image/png;base64,${s.png}" style="max-width:100%">
    <figcaption style="margin-top:6px">${s.label}</figcaption></figure>`).join('')}
</body>`;
const sheetFile = join(root, 'look', '_sheet.html');
writeFileSync(sheetFile, sheet);
await page.setViewportSize({ width: 1100, height: 700 });
await page.goto('file://' + sheetFile);
await page.waitForTimeout(300);
await page.screenshot({ path: outFile, fullPage: true });
await browser.close();
console.log('wrote ' + outFile);
