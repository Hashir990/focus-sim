/**
 * Is the man still on his own rope?
 *
 * Every antic is two clocks that have to agree: one on the slot, carrying him
 * across the window (`bud-go` 7.8s for the swing, `bud-skate-lap` 48s for the
 * board), and more inside it doing the swinging, the turning and the mirroring.
 * All of them are written as exact fractions of the lap, so once they start
 * together they stay locked for ever - and nothing in CSS re-locks them if one
 * is restarted on its own.
 *
 * The invariant is simply that they all *started* together: `startTime` is the
 * moment an animation began on the document timeline, and unlike `currentTime`
 * it is not shifted by the deliberate negative delays some parts carry. So one
 * shared `startTime` across the slot and everything in it, for every antic.
 *
 * jsdom has no animation engine, so this is the only place the question can be
 * asked at all - which is how "the skateboard turns too early, but not always"
 * survived a green test suite.
 *
 *   node tools/look-swing.mjs [--shot look/swing.png]
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
const shotArg = process.argv.indexOf('--shot');
const shot = shotArg > 0 ? process.argv[shotArg + 1] : '';
mkdirSync(join(root, 'look'), { recursive: true });

/* One door into the closure, for this tool only - the app is a single IIFE and
   a script on the page can otherwise only click buttons. */
const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
  .replace(/const ACC_URL = '[^']*'/, "const ACC_URL = ''")
  .replace('})();', `
  window.__bud = {
    names(){ return BUD_ANIMS.map(a => a.n); },
    run(anim){
      S.mode = 'focus'; S.running = true; S.budShow = true;
      S.budAnim = anim | 0; S.total = 1500; S.remaining = 1400;
      swapView(); render(); Buddy.render(); Buddy.stage();
    },
    /* What happens when anything about him changes while he is mid-lap:
       saving a colour, an account arriving, switching him off and on. */
    rerender(){ Buddy.clearSlots(); Buddy.stage(); },
  };
})();`);

const tmp = join(root, 'look', '_swing.html');
writeFileSync(tmp, html);

const browser = await chromium.launch(chromeOpts());
const page = await browser.newPage({ viewport: { width: 420, height: 780 } });
await page.goto('file://' + tmp);
await page.waitForTimeout(700);

/** The spread of start times across whichever slot he is in, and everything
    drawn inside it. One number: 0 is locked, anything else is drift. */
const spread = () => page.evaluate(() => {
  const slots = ['bud-live', 'bud-pause'].map((id) => document.getElementById(id))
    .filter((el) => el && !el.classList.contains('hide'));
  const starts = [];
  for (const slot of slots) {
    const grab = (el) => el.getAnimations().forEach((a) => {
      if (a.startTime != null) starts.push(Math.round(Number(a.startTime)));
    });
    grab(slot);
    slot.querySelectorAll('*').forEach(grab);
  }
  if (!starts.length) return { n: 0, drift: 0 };
  return { n: starts.length, drift: Math.max(...starts) - Math.min(...starts) };
});

const names = await page.evaluate(() => window.__bud.names());
let worst = 0;
const lines = [];
for (let i = 0; i < names.length; i++) {
  await page.evaluate((n) => window.__bud.run(n), i);
  await page.waitForTimeout(700);
  const fresh = await spread();
  await page.evaluate(() => window.__bud.rerender());   // as if you had just saved him
  await page.waitForTimeout(500);
  const again = await spread();
  worst = Math.max(worst, fresh.drift, again.drift);
  lines.push(`${String(names[i]).padEnd(10)} ${String(again.n).padStart(2)} animations · `
    + `fresh ${fresh.drift}ms · re-rendered ${again.drift}ms`);
}
lines.forEach((l) => console.log(l));

if (shot) {
  await page.screenshot({ path: join(root, shot) });
  console.log('wrote ' + shot);
}
await browser.close();

const ok = worst <= 20;
console.log(ok ? '\nevery antic keeps one clock'
                : `\nOUT OF PHASE — worst drift ${worst}ms`);
process.exit(ok ? 0 : 1);
