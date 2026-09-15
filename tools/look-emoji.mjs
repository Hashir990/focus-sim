/**
 * The six drawn faces as a filmstrip: at rest, chosen, and frozen frames of each
 * one's own motion — then the same six under a light palette, and at the size
 * a calendar square draws them.
 *
 * The motions are the thing to look at. Each face is meant to move like what it
 * means (17c-emoji.js), and whether a wink reads as a wink or a shudder as a
 * shudder is not something any check can tell you. The frames are frozen
 * through the Web Animations API, so every column is an exact moment rather
 * than whatever the screenshot happened to catch.
 *
 * The light row is there because the faces are drawn in the theme's own ink:
 * if a colour ever gets written into them by hand, this is where it shows —
 * a teal face on cream.
 *
 *   node tools/look-emoji.mjs [out.png]
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
const out = process.argv[2] ? join(root, process.argv[2]) : join(root, 'look', 'emoji.png');
mkdirSync(dirname(out), { recursive: true });

/* The real stylesheet and the real drawing function, not a copy of either. The
   drawing file is evaluated on its own with a stand-in for `esc`, which is the
   one thing it borrows from the rest of the bundle. */
const css = readFileSync(join(root, 'src', 'css', '37-emoji.css'), 'utf8');
const js = readFileSync(join(root, 'src', 'js', '17c-emoji.js'), 'utf8');

const T = [0, 100, 250, 400, 550, 700, 850, 1050];
const html = `<!doctype html><meta charset="utf-8">
<style>
${css}
body{ margin:0; font:12px system-ui, sans-serif }
.sheet{ padding:18px 22px 22px }
/* The focus phase's tokens, and a Beach-like light — see 00-tokens-base.css and
   30-embers.css. Only the five the faces read: `--bg` is in there because the
   features are cut into the face in the ground colour. */
.dark{ background:#05121a; color:#e6f6f2; --bg:#05121a; --accent:#4fe0c8; --muted:#6f96a0; --text:#e6f6f2 }
.light{ background:#f4ecdc; color:#2d2419; --bg:#f4ecdc; --accent:#d2693a; --muted:#8a7a66; --text:#2d2419 }
h3{ font-size:10.5px; letter-spacing:.16em; text-transform:uppercase; opacity:.6; margin:16px 0 8px; font-weight:600 }
.row{ display:flex; align-items:center; gap:14px; margin:6px 0 }
.lab{ width:74px; opacity:.7 }
.cell{ width:74px; height:74px; display:flex; align-items:center; justify-content:center }
.cap{ display:flex; gap:14px; margin-left:88px; opacity:.5; font-size:10.5px }
.cap span{ width:74px; text-align:center }
.big{ --emo-size:52px }
.rest{ color:var(--muted) }
.chosen{ color:var(--accent) }
.small{ display:flex; gap:18px; align-items:center }
.sq{ position:relative; display:inline-block; width:44px; height:44px; border-radius:10px; background:rgba(127,127,127,.12) }
.sq .mood{ position:absolute; right:2px; bottom:1px }
</style>
<body>
<div class="sheet dark" id="dark"></div>
<div class="sheet light" id="light"></div>
<script>
const esc = (s) => String(s);
${js}
const FACES = Object.keys(EMO_NAME);
const T = ${JSON.stringify(T)};
function build(root, film){
  let h = '<h3>' + (film ? 'each face, and its own motion — ms into the tap' : 'a light palette: the same drawing in the theme\\'s ink') + '</h3>';
  if(film) h += '<div class="cap"><span>rest</span><span>chosen</span>'
    + T.slice(1).map((t) => '<span>' + t + '</span>').join('') + '</div>';
  for(const ch of FACES){
    h += '<div class="row"><span class="lab">' + EMO_NAME[ch] + '</span>'
      + '<span class="cell big rest">' + emoFace(ch) + '</span>'
      + '<span class="cell big chosen">' + emoFace(ch) + '</span>';
    if(film) for(const t of T.slice(1)){
      h += '<span class="cell big chosen" data-t="' + t + '">' + emoFace(ch, 'pop') + '</span>';
    }
    h += '</div>';
  }
  h += '<h3>a calendar square</h3><div class="small">'
    + FACES.map((ch) => '<span class="cal-cell sq"><span class="mood">' + emoFace(ch) + '</span></span>').join('')
    + '</div>';
  root.innerHTML = h;
}
build(document.getElementById('dark'), true);
build(document.getElementById('light'), false);
requestAnimationFrame(() => {
  document.querySelectorAll('[data-t]').forEach((box) => {
    const t = Number(box.dataset.t);
    box.querySelector('.emo').getAnimations({ subtree: true })
      .forEach((a) => { a.pause(); a.currentTime = t; });
  });
  document.body.dataset.ready = '1';
});
</script>`;
const tmp = join(root, 'look', '_emoji.html');
writeFileSync(tmp, html);

const browser = await chromium.launch(opts());
const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, deviceScaleFactor: 2 });
await page.goto('file://' + tmp);
await page.waitForSelector('body[data-ready="1"]');
await page.waitForTimeout(150);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
console.log('wrote ' + out);
