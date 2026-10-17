/**
 * The walk cycle, drawn out so it can be looked at.
 *
 *   node tools/look-spiders.mjs   ->  look/spiders.html
 *
 * Built from the real source, not from a copy of it: `src/js/39a-spiders.js`
 * is evaluated as-is and asked for its own markup, and the rules come out of
 * `src/css/04-timer.css`. Its top level is nothing but constants and function
 * declarations, so it can be run on its own without the rest of the app --
 * the drawing never touches the page.
 *
 * Three things on the page:
 *   - the eight frames of the cycle, laid out and numbered
 *   - the cycle playing over a marked floor, so a planted foot can be seen
 *     to stay on its mark while the body goes over it
 *   - a few at the size they actually turn up
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src', 'js', '39a-spiders.js'), 'utf8');
const css = readFileSync(join(root, 'src', 'css', '04-timer.css'), 'utf8');

const sp = new Function(src + `
  return {spiderSvg, SPIDER_SHAPES, SPIDER_FRAMES, SPIDER_STRIDE,
          SPIDER_CYCLE, SPIDER_SPEED, SPIDER_INKS};`)();

/* The rules that dress them, straight out of the stylesheet. */
const block = css.slice(css.indexOf('/* ---- the spiders ----'),
                        css.indexOf('/* ---- the corner webs ----'));
const keep = ['.spider{', '.sp-body{', '.sp-fill{', '.sp-leg{', '@keyframes sp-cycle'];
const rules = block.split(/\n(?=[.@#])/)
  .filter((b) => keep.some((k) => b.startsWith(k)))
  .join('\n')
  .replace(/display:none/g, 'display:block');

const [ink, brown] = sp.SPIDER_INKS;
const F = sp.SPIDER_FRAMES;
const big = 112;
const scale = big / 30;

/* One frame on its own, by shifting the strip under its window. */
const frame = (shape, i, colour) => sp.spiderSvg(colour, shape, scale)
  .replace('<g class="sp-strip">', `<g class="sp-strip" transform="translate(${-60 * i} 0)">`);

const strip = (shape, colour) => Array.from({ length: F + 1 }, (_, i) =>
  `<figure><div class="cell">${frame(shape, i, colour)}</div>`
  + `<figcaption>${i < F ? i + 1 : 'still'}</figcaption></figure>`).join('');

const strideBig = sp.SPIDER_STRIDE * 0.5 * scale;   // a unit is half a pixel
const speedBig = sp.SPIDER_SPEED * scale;
const crossMs = (1500 / speedBig).toFixed(2);

const out = `<!doctype html>
<meta charset="utf-8">
<title>Spider walk cycle</title>
<style>
  :root{ color-scheme:dark }
  body{ margin:0; padding:30px; background:#0b1020; color:#cdd3e4;
        font:14px/1.6 'Segoe UI',system-ui,sans-serif }
  h1{ font-size:20px; margin:0 0 6px }
  h2{ font-size:12px; letter-spacing:.15em; text-transform:uppercase;
      color:#7c87a8; margin:32px 0 10px; font-weight:600 }
  p{ max-width:74ch; color:#99a3bf; margin:0 0 8px }
  code{ color:#c9b3ff }
  .row{ display:flex; gap:7px; flex-wrap:wrap }
  figure{ margin:0; text-align:center }
  .cell{ width:116px; height:98px; display:grid; place-items:center;
         background:#141b31; border-radius:9px; overflow:hidden }
  figcaption{ font-size:11px; color:#6b7696; margin-top:5px }
  .stage{ position:relative; height:168px; margin-top:10px; overflow:hidden;
          background:#141b31; border-radius:11px }
  .ground{ position:absolute; left:0; right:0; bottom:40px; height:1px;
           background:rgba(255,255,255,.22) }
  .ticks{ position:absolute; left:0; right:0; bottom:33px; height:8px;
          background:repeating-linear-gradient(to right,
            rgba(255,255,255,.26) 0 1px, transparent 1px ${strideBig.toFixed(2)}px) }
  .walker{ position:absolute; bottom:40px; left:0;
           animation:march ${crossMs}s linear infinite }
  @keyframes march{ from{ transform:translateX(-130px) }
                    to  { transform:translateX(1500px) } }
  .small{ display:flex; gap:30px; align-items:flex-end; padding:16px 0 0 }
${rules}
  /* the page drives the cycle itself, at the speed the app uses */
  .sp-strip{ animation:sp-cycle ${sp.SPIDER_CYCLE}s steps(${F}) infinite }
  .cell .sp-strip{ animation:none }
</style>

<h1>The walk, ${F} frames to a cycle</h1>
<p>Everything below is the real thing: the markup is what
<code>spiderSvg()</code> returns and the rules are lifted out of
<code>04-timer.css</code>. Each frame is a pose with its feet already placed,
and <code>steps(${F})</code> cuts between them &mdash; nothing is tweened, so
nothing can drift during the frame it is held for.</p>

<h2>The cycle, frame by frame &mdash; and the pose it stops on</h2>
<p>A stride is ${sp.SPIDER_STRIDE} units and stance lasts four frames, so a
foot that is down moves ${(sp.SPIDER_STRIDE / 4).toFixed(1)} units back per
frame &mdash; exactly what the body moves forward, which is what makes it
planted. The two diagonal sets are half a cycle apart: while one pushes, the
other is in the air. The last one, marked <em>still</em>, is not part of the
cycle: there is no frame of a walk where a spider is standing, because four
legs are always up, so stopping parks it on a ninth pose with every foot at
home.</p>
<div class="row">${strip('top', ink)}</div>

<h2>The longer-legged build</h2>
<div class="row">${strip('long', brown)}</div>

<h2>Hanging, seen from behind</h2>
<p>Not a plan view. Eight legs of equal length at equal angles is an
asterisk at this size, which is what a hanging one looked like. Here the
front pairs reach up towards the thread and the back pairs hang below them,
over an abdomen that is the biggest thing in the drawing because you are
looking straight at it. It never walks, so only the last pose is ever shown.</p>
<div class="row">${strip('hang', brown)}</div>

<h2>The wall walk, side on</h2>
<p>A spider on a wall is seen from the side, not from below. The surface is
the left edge of each frame, every foot is on it, and the four far legs go
behind the body. Going the other way it is <em>mirrored</em> rather than
turned &mdash; turning it would swing the feet off the wall and into the
room.</p>
<div class="row">${strip('side', ink)}</div>

<h2>Playing, over a marked floor</h2>
<p>The marks are one stride apart. Follow a single foot: it lands on a mark,
holds it while the body travels over it, then lifts and reaches for the next
one. That is the part three attempts at tweening the legs never managed
&mdash; measured, those slid by a factor of nine.</p>
<div class="stage">
  <div class="ground"></div><div class="ticks"></div>
  <div class="walker">${sp.spiderSvg(ink, 'top', scale)}</div>
</div>

<h2>At the size they actually turn up</h2>
<div class="small">
  ${sp.spiderSvg(ink, 'top', 0.75)}
  ${sp.spiderSvg(brown, 'long', 1)}
  ${sp.spiderSvg(ink, 'long', 1.25)}
  ${sp.spiderSvg(brown, 'top', 1.1)}
</div>
`;

mkdirSync(join(root, 'look'), { recursive: true });
const dest = join(root, 'look', 'spiders.html');
writeFileSync(dest, out);
console.log('wrote', dest);
console.log(`${F} frames | stride ${sp.SPIDER_STRIDE} units `
  + `| ${sp.SPIDER_SPEED.toFixed(1)} px/s at full size`);
