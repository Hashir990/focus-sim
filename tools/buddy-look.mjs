/**
 * Look at the buddy.
 *
 * Every visual change to him before this was made by reasoning about
 * coordinates — "the head is centred on 27 with radius 16, so an ear is about
 * 31" — and that is how the headphones ended up clamped to his jaw twice in a
 * row, each time with a confident comment explaining why they were right.
 *
 * This renders the *real* `budSvg()` output from the *built* file to PNG, so it
 * can be looked at instead of imagined. `convert` is ImageMagick; it is enough
 * for flat shapes and solid fills, which is all he is made of.
 *
 *   node tools/buddy-look.mjs [outdir]
 *
 * Writes one PNG per part and per pose. Nothing in the app depends on this —
 * it is a pair of eyes, not a test.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, 'look');
mkdirSync(out, { recursive: true });

/* An account server would lock the editor, and the editor is where the parts
   are drawn. Point it nowhere so he is unlocked. */
const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
  .replace(/const ACC_URL = '[^']*'/, "const ACC_URL = ''");

const w = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  virtualConsole: new VirtualConsole(), url: 'http://localhost/',
}).window;
await new Promise((r) => setTimeout(r, 900));
const d = w.document;
d.getElementById('d-account').click();
await new Promise((r) => setTimeout(r, 250));

/* A dark card behind him, because he is drawn for a dark app and a shape on
   white lies about its own contrast. */
const png = (name, svg, w2 = 300) => {
  /* **`currentColor` has to be resolved here.** ImageMagick does not — it
     silently drops the stroke, so anything drawn with it renders as nothing.
     That cost half an hour of hunting for a bug in the zs that was never in the
     app: they were fine, the picture of them was empty. The stylesheet sets
     this from `var(--text)`, so a light ink is what a dark look would show. */
  const body = svg
    .replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"')
    .replace(/currentColor/g, '#e6f6f2')
    /* **Height from the viewBox, not from the width.** The swinging pose is
       drawn in a box 64 wide and 124 tall so the web can leave the top; forcing
       it square stretched him flat and made the pose look wrong when it was
       fine. Read the aspect out of the drawing and keep it. */
    .replace(/width="\d+"/, `width="${w2}"`)
    .replace(/height="\d+"/, () => {
      const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1] || '0 0 64 64';
      const [, , vw, vh] = vb.trim().split(/\s+/).map(Number);
      return `height="${Math.round(w2 * (vh / vw))}"`;
    });
  const file = join(out, name);
  writeFileSync(file + '.svg', body);
  try {
    execFileSync('convert', ['-background', '#101418', '-flatten', file + '.svg', file + '.png']);
  } catch (e) {
    console.log('  ! could not rasterise ' + name + ' — is ImageMagick installed?');
  }
};

/* The whole figure wearing one thing at a time, which is the only way to see
   whether a part sits where a part should sit. */
/* Re-queried every time, never cached: `Buddy.render()` rewrites the whole of
   `#bud-box`, so a reference taken before a click points at a detached node and
   you photograph the buddy as he was. */
const stage = () => d.getElementById('bud-box').querySelector('.bud-stage');
const rows = { e: 'eyes', h: 'hat', f: 'face', a: 'worn' };
let n = 0;
const opts = (key) => [...d.querySelectorAll(`[data-bud="${key}"]`)];
for (const key in rows) {
  const count = opts(key).length;
  for (let i = 0; i < count; i++) {
    // fresh each time, for the same reason as `stage()` above
    opts(key)[i].click();
    await new Promise((r) => setTimeout(r, 40));
    png(`${rows[key]}-${i}`, stage().innerHTML.trim());
    n++;
  }
  opts(key)[0].click();
  await new Promise((r) => setTimeout(r, 40));
}

/* And the poses, which change the drawing as well as the animation. */
d.getElementById('acct-close').click();
await new Promise((r) => setTimeout(r, 60));
d.getElementById('begin').click();
await new Promise((r) => setTimeout(r, 250));
d.getElementById('d-account').click();
await new Promise((r) => setTimeout(r, 150));
for (const [i, slot, name] of [[0, 'bud-live', 'pose-swing'], [1, 'bud-pause', 'pose-nap'], [2, 'bud-live', 'pose-swim']]) {
  d.querySelectorAll('[data-anim]')[i].click();
  await new Promise((r) => setTimeout(r, 120));
  const el = d.getElementById(slot);
  if (el && el.innerHTML.trim()) { png(name, el.innerHTML.trim(), 340); n++; }
}

console.log(`wrote ${n} views to ${out}`);
process.exit(0);
