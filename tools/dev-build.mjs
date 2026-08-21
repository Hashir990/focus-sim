/**
 * Builds dist/dev-unlocked.html — the app with everything already bought.
 *
 * Nothing about the app changes. This is dist/index.html with two things
 * injected: a save written into localStorage *before* the app boots, and a bar
 * along the bottom for flipping through every light and every sound without
 * earning them first. Delete the file and nothing is lost; run the build again
 * and it comes back.
 *
 * The tables it flips through are read out of src/js/37-embers.js at build time
 * rather than copied, so a light added there appears here and cannot drift.
 *
 *   node tools/dev-build.mjs        (tools/build.mjs runs this for you)
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Lift the catalogues straight out of the source, so this cannot drift. */
function catalogues() {
  const src = readFileSync(join(root, 'src', 'js', '37-embers.js'), 'utf8');
  // the clock faces live in their own file
  const faceSrc = readFileSync(join(root, 'src', 'js', '43-faces.js'), 'utf8');
  const grab = (text, name) => {
    const i = text.indexOf('const ' + name + ' = [');
    const j = text.indexOf('\n  ];', i);
    if (i < 0 || j < 0) throw new Error('cannot find ' + name);
    return text.slice(text.indexOf('[', i), j + 4);
  };
  return new Function('return {lights:' + grab(src, 'EMB_LIGHTS')
    + ', sounds:' + grab(src, 'EMB_SOUNDS')
    + ', faces:' + grab(faceSrc, 'FACES') + '};')();
}

/** A few weeks of finished sessions, so the calendar and stats aren't empty. */
function fakeLog() {
  const out = [];
  const day = 86400000;
  const now = Date.now();
  for (let d = 20; d >= 0; d--) {
    if (d % 7 === 3) continue;                       // a day off, for the streak
    const n = 1 + ((d * 7) % 4);
    for (let i = 0; i < n; i++) {
      const ts = now - d * day + (9 + i * 2) * 3600000;
      out.push({
        id: 's' + ts + '_' + i, ts, day: new Date(ts).toISOString().slice(0, 10),
        secs: [1500, 1500, 2700, 3000][(d + i) % 4], note: '',
      });
    }
  }
  return out;
}

export function buildDev() {
  const index = join(root, 'dist', 'index.html');
  if (!existsSync(index)) return false;
  const html = readFileSync(index, 'utf8');
  const { lights, sounds, faces } = catalogues();

  const save = {
    have: 999, earned: 999,
    // everything on every shelf: lights bare, sounds under `snd-`, faces `face-`
    own: lights.map((l) => l.id)
      .concat(sounds.map((s) => 'snd-' + s.id))
      .concat(faces.filter((f) => f.cost > 0).map((f) => 'face-' + f.id)),
    light: 'seaglass',
  };

  const seed = `<script>
/* ---- dev save ----
   Written before the app reads anything, so it boots with the lot. Change the
   numbers here, or in the console at runtime:

     localStorage.focus_embers = JSON.stringify({have:500, earned:500,
       own:["seaglass","hearth","dusk"], light:"dusk"});
     location.reload();

   The keys the app uses:
     focus_embers  {have, earned, own[], light}   embers and what they bought
     focus_log     [{id, ts, day, secs, note}]    finished sessions — stats, calendar, streaks
     focus_sim     settings (lengths, repeats, toggles)
     focus_amb     {id, vol}                      the ambience track and its volume
     focus_tasks / focus_quotes / focus_sync / focus_dm / focus_chess
*/
try{
  // written once; the Lock all button in the bar owns it after that
  if(!localStorage.getItem('focus_embers'))
    localStorage.setItem('focus_embers', ${JSON.stringify(JSON.stringify(save))});
  if(!localStorage.getItem('focus_log')) localStorage.setItem('focus_log', ${JSON.stringify(JSON.stringify(fakeLog()))});
}catch(e){}
</script>
`;

  const bar = `<style>
  .devbar{
    position:fixed; left:0; right:0; bottom:0; z-index:200;
    display:flex; flex-wrap:wrap; gap:6px; align-items:center;
    padding:8px 10px calc(8px + env(safe-area-inset-bottom));
    background:rgba(6,10,18,.92); border-top:1px solid rgba(255,255,255,.14);
    font:12px/1.2 ui-monospace, Menlo, Consolas, monospace; color:#dfe6f2;
  }
  .devbar b{ font-weight:600; letter-spacing:.08em; text-transform:uppercase; opacity:.6; font-size:10px }
  .devbar button{
    font:inherit; cursor:pointer; padding:5px 9px; border-radius:8px;
    border:1px solid rgba(255,255,255,.18); background:rgba(255,255,255,.06); color:inherit;
  }
  .devbar button.on{ background:#e7ecf6; color:#0b1220; border-color:#e7ecf6 }
  .devbar .sp{ flex-basis:100%; height:0 }
  .devbar .note{ opacity:.55; font-size:10.5px }
  .devbar .grow{ flex:1 }
  /* Retracted: everything folds away behind one small tab, so the app can be
     looked at without a control panel across the bottom of it. */
  .devbar.shut{ padding:0; border:0; background:transparent }
  .devbar.shut > *{ display:none }
  .devbar.shut .devtab{ display:block }
  .devtab{
    position:fixed; left:10px; bottom:calc(10px + env(safe-area-inset-bottom));
    padding:5px 10px; border-radius:8px; cursor:pointer;
    border:1px solid rgba(255,255,255,.18); background:rgba(6,10,18,.92); color:#dfe6f2;
    font:inherit;
  }
  .devbar:not(.shut) .devtab{ display:none }
</style>
<div class="devbar" id="devbar"></div>
<script>
(function(){
  var LIGHTS = ${JSON.stringify(lights)};
  var SOUNDS = ${JSON.stringify(sounds)};
  var bar = document.getElementById('devbar');
  var $ = function(id){ return document.getElementById(id); };
  var UNLOCKED = ${JSON.stringify(JSON.stringify(save))};
  var LOCKED = ${JSON.stringify(JSON.stringify({ have: 0, earned: 0, own: ['seaglass'], light: 'seaglass' }))};
  function embers(){
    try{ return JSON.parse(localStorage.getItem('focus_embers') || '{}').have | 0; }
    catch(e){ return 0; }
  }
  /* Straight into the save and reload, rather than reaching into the app: the
     balance is read once at boot, so anything else would only be true until the
     next thing that wrote it. */
  function setEmbers(n){
    try{
      var d = JSON.parse(localStorage.getItem('focus_embers') || '{}');
      d.have = Math.max(0, n | 0);
      if((d.earned | 0) < d.have) d.earned = d.have;
      localStorage.setItem('focus_embers', JSON.stringify(d));
    }catch(e){}
    location.reload();
  }
  function locked(){
    try{ return (JSON.parse(localStorage.getItem('focus_embers') || '{}').own || []).length < 2; }
    catch(e){ return false; }
  }

  /* The bar drives the app's own controls rather than reaching past them: with
     everything already owned, clicking an entry on the real shelf is exactly
     what a user's tap does, so what you see here is what they get. The shelf is
     only built when Your focus has been opened, so that happens once up front. */
  /* Grant, then select. Clicking a light you don't own goes through the app's
     real buy flow, which opens a confirmation — so with the save locked, every
     button on this bar looked like it did nothing. A dev bar is for looking at
     things, not for paying for them: it adds the id to what you own first, then
     clicks the same shelf entry a user would. */
  function shelf(attr, id){
    try{
      var d = JSON.parse(localStorage.getItem('focus_embers') || '{}');
      d.own = d.own || ['seaglass'];
      var key = attr === 'data-sound' ? 'snd-' + id : id;
      if(d.own.indexOf(key) < 0){
        d.own.push(key);
        localStorage.setItem('focus_embers', JSON.stringify(d));
        // the app read the list at boot, so tell it as well as the save
        if(typeof Embers === 'object') Embers.own = d.own;
      }
    }catch(e){}
    var el = document.querySelector('#emb-box [' + attr + '="' + id + '"]');
    if(el) el.click();
    setTimeout(draw, 80);
  }
  function running(){
    var s = document.getElementById('setup');
    return s && s.classList.contains('hide');
  }
  function ensureRunning(then){
    if(running()){ then(); return; }
    var b = $('begin'); if(b) b.click();
    setTimeout(then, 140);
  }

  function draw(){
    var light = document.body.getAttribute('data-light') || 'seaglass';
    var amb = document.body.getAttribute('data-amb') || '';
    var html = '<b>light</b>';
    LIGHTS.forEach(function(l, i){
      html += '<button data-l="' + i + '"' + (l.id === light && !amb ? ' class="on"' : '') + '>' + l.name + '</button>';
    });
    html += '<span class="sp"></span><b>sound</b>';
    html += '<button data-s="-1"' + (!amb ? ' class="on"' : '') + '>Off</button>';
    SOUNDS.forEach(function(s, i){
      html += '<button data-s="' + i + '"' + (s.id === amb ? ' class="on"' : '') + '>' + s.name + '</button>';
    });
    html += '<span class="sp"></span><b>go</b>'
      + '<button data-go="begin">Begin</button>'
      + '<button data-go="skip">Skip</button>'
      + '<button data-go="stats">Shelf</button>'
      + '<button data-go="fill">Fill board</button>'
      + '<button data-go="lock">' + (locked() ? 'Unlock all' : 'Lock all') + '</button>'
      + '<span class="sp"></span><b>embers</b>'
      + '<button data-emb="-100">−100</button>'
      + '<button data-emb="-10">−10</button>'
      + '<button data-emb="10">+10</button>'
      + '<button data-emb="100">+100</button>'
      + '<button data-emb="set">Set…</button>'
      + '<span class="note">' + embers() + ' unspent</span>'
      + '<span class="note">' + (locked() ? 'locked' : 'everything owned') + ' · '
      + embers() + ' embers · a light or sound button here grants it first</span>'
      + '<span class="grow"></span>'
      + '<button data-go="shut">Hide ▾</button>'
      + '<button class="devtab" data-go="open">dev ▴</button>';
    bar.innerHTML = html;
  }

  bar.addEventListener('click', function(e){
    var b = e.target.closest('button');
    if(!b) return;
    if(b.dataset.l != null){
      var l = LIGHTS[+b.dataset.l];
      ensureRunning(function(){ shelf('data-light', l.id); });
    }
    else if(b.dataset.s != null){
      var i = +b.dataset.s;
      ensureRunning(function(){
        if(i < 0){ var off = document.querySelector('#amb-grid [data-a="off"]'); if(off) off.click(); setTimeout(draw, 80); }
        else shelf('data-sound', SOUNDS[i].id);
      });
    }
    else if(b.dataset.go === 'begin'){ var el = $('begin'); if(el) el.click(); setTimeout(draw, 60); }
    else if(b.dataset.go === 'skip'){ var s = $('skip'); if(s) s.click(); setTimeout(draw, 60); }
    else if(b.dataset.go === 'stats'){ var d = $('d-stats'); if(d) d.click(); }
    else if(b.dataset.go === 'fill'){
      /* Finish whichever board is open — see devFill() in src/js/42-dev.js.
         The bar cannot do this itself: the games live inside the app's closure,
         and clicking eighty-one squares from out here would be a second
         implementation of sudoku with its own bugs. */
      var say = typeof window.devFill === 'function'
        ? window.devFill()
        : 'devFill is missing — rebuild dist/index.html first';
      var n = document.querySelector('.devbar .note');
      if(n) n.textContent = say;
      setTimeout(draw, 1500);
    }
    else if(b.dataset.go === 'fill'){
      /* Finish whichever board is open — see devFill() in src/js/42-dev.js.
         The bar cannot do this itself: the games live inside the app's closure,
         and clicking eighty-one squares from out here would be a second
         implementation of sudoku with its own bugs. */
      var say = typeof window.devFill === 'function'
        ? window.devFill()
        : 'devFill is missing — rebuild with tools/dev-build.mjs';
      var n = document.querySelector('.devbar .note');
      if(n) n.textContent = say;
      setTimeout(draw, 1200);
    }
    else if(b.dataset.emb != null){
      if(b.dataset.emb === 'set'){
        var v = prompt('Embers:', String(embers()));
        if(v !== null && v.trim() !== '') setEmbers(parseInt(v, 10) || 0);
      }else setEmbers(embers() + parseInt(b.dataset.emb, 10));
    }
    else if(b.dataset.go === 'shut'){ bar.classList.add('shut'); }
    else if(b.dataset.go === 'open'){ bar.classList.remove('shut'); }
    /* Lock all: the same page with nothing bought and nothing to buy it with,
       which is the only way to see the shelf as somebody starting out sees it —
       the prices, the dashed borders, the "12 more for late sun". */
    else if(b.dataset.go === 'lock'){
      try{
        localStorage.setItem('focus_embers', locked() ? UNLOCKED : LOCKED);
        localStorage.removeItem('focus_amb');
      }catch(e){}
      location.reload();
    }
  });

  document.body.classList.add('devbar-on');
  // build the shelf once, so the buttons above have something to click
  var st = $('d-stats');
  if(st){ st.click(); setTimeout(function(){ var c = $('stats-close'); if(c) c.click(); draw(); }, 120); }
  draw();
})();
</script>
`;

  /* The one thing that tells the app this is the developer copy. `42-dev.js`
     publishes `window.devFill` only when it sees this, so the shipped
     index.html has no such function and nothing on the page can reach in. */
  let out = html.replace(/<html([^>]*)>/, '<html$1 data-dev="1">');
  const at = out.indexOf('<script>');
  out = at >= 0 ? out.slice(0, at) + seed + out.slice(at) : seed + out;
  out = out.replace('</body>', bar + '</body>');
  if (out === html) out += bar;

  const dest = join(root, 'dist', 'dev-unlocked.html');
  writeFileSync(dest, out);
  return dest;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const at = buildDev();
  console.log(at ? 'wrote ' + at : 'dist/index.html not built yet');
}
