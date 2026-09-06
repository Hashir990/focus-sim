/**
 * The day's mood: the ask, and the calendar wearing it.
 *
 *   node tools/look-mood.mjs [out.png]
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
const out = process.argv[2] ? join(root, process.argv[2]) : join(root, 'look', 'mood.png');
mkdirSync(dirname(out), { recursive: true });

/* Splice at the LAST close — see HANDOFF §6. */
const src = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
  .replace(/const ACC_URL = '[^']*'/, "const ACC_URL = ''");
const at = src.lastIndexOf('})();');
const html = src.slice(0, at) + `
  window.__ask = () => {
    /* The prompt lives on the timer view, which is hidden while the app is on
       setup — so put the app where the prompt actually appears. */
    document.getElementById('setup').classList.add('hide');
    document.getElementById('timer').classList.remove('hide');
    MOOD = {}; MOOD_ASKED = {}; moodAsk();
  };
  window.__seed = () => {
    const now = new Date();
    const faces = ['\\u{1F601}','\\u{1F642}','\\u{1F610}','\\u{1F629}','\\u{1F622}','\\u{1F634}'];
    MOOD = {};
    LOG.length = 0;
    for(let d = 1; d <= 26; d++){
      const k = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0')
              + '-' + String(d).padStart(2,'0');
      if(d % 7 !== 3) MOOD[k] = faces[(d * 3) % 6];
      if(d % 3) LOG.push({id:'s'+d, secs: 900 + (d % 5) * 900, ts: new Date(now.getFullYear(), now.getMonth(), d, 10).getTime(), at:1, day:k});
    }
    // a day carrying every small mark at once, to see them share a corner
    const busy = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-12';
    PLAN.length = 0;
    PLAN.push({id:'p1', kind:'event', text:'Dentist', day:busy});
    PLAN.push({id:'p2', kind:'task', text:'Read a chapter', day:busy});
    const rec = LOG.find(r => r.day === busy);
    if(rec) rec.notes = 'went fine';
    Cal.open();
  };
` + src.slice(at);
const tmp = join(root, 'look', '_mood.html');
writeFileSync(tmp, html);

const browser = await chromium.launch(opts());
const page = await browser.newPage({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 2 });
await page.goto('file://' + tmp);
await page.waitForTimeout(900);

const shots = [];
const shoot = async (label, sel) => {
  const el = await page.$(sel);
  shots.push({ label, png: (await el.screenshot()).toString('base64') });
};
await page.evaluate(() => window.__ask());
await page.waitForTimeout(300);
await shoot('asked once, on the way past', '#app');
await page.evaluate(() => window.__seed());
await page.waitForTimeout(400);
await shoot('a month of them', '#cal-overlay');

const sheet = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0d0f14;
  font:12px/1.4 system-ui,sans-serif;color:#cfd6e4;padding:16px;display:flex;gap:16px;align-items:flex-start">
  ${shots.map((s) => `<figure style="margin:0;text-align:center">
    <img src="data:image/png;base64,${s.png}" style="width:400px;border-radius:12px">
    <figcaption style="margin-top:6px;opacity:.8">${s.label}</figcaption></figure>`).join('')}
</body>`;
const sf = join(root, 'look', '_mood-sheet.html');
writeFileSync(sf, sheet);
await page.setViewportSize({ width: 900, height: 1000 });
await page.goto('file://' + sf);
await page.waitForTimeout(300);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote ' + out);
