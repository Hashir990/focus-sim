/**
 * The Skyline look, as a picture.
 *
 *   npx electron tools/look-skyline.mjs            # both, to look/
 *   npx electron tools/look-skyline.mjs --tall     # a phone-shaped one too
 *
 * Electron rather than playwright, which is not installed here, and a whole
 * window rather than a rect: `capturePage` takes its rectangle in
 * device-independent pixels while the page reports CSS ones, and on a scaled
 * display the two disagree by exactly enough to crop the wrong thing.
 *
 * Two shots, because they answer different questions. `skyline-pane.png` has
 * the app's own furniture hidden so the city can be looked at on its own;
 * `skyline.png` is what somebody actually sees, which is the city behind a
 * timer and mostly at the edges.
 */
import { app, BrowserWindow } from 'electron';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'look');
mkdirSync(outDir, { recursive: true });

const raw = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
const termsV = (raw.match(/const TERMS_VERSION = '([^']+)'/) || [])[1] || '';

const shim = `<script>(function(){
  var mem = {focus_terms: JSON.stringify({v:${JSON.stringify(termsV)}, at:1}), focus_setup:'1'};
  try { Object.defineProperty(window, 'localStorage', {configurable:true, value:{
    getItem:function(k){ return mem[k] === undefined ? null : mem[k]; },
    setItem:function(k,v){ mem[k] = String(v); }, removeItem:function(k){ delete mem[k]; },
    clear:function(){ mem = {}; }, key:function(i){ return Object.keys(mem)[i] || null; },
    get length(){ return Object.keys(mem).length; }}}); } catch(e){}
})();</script>`;

/* Spliced at the LAST close -- see HANDOFF section 6. */
const at = raw.lastIndexOf('})();');
const page = (raw.slice(0, at) + '\nwindow.__look = {Embers, vfxSet};\n' + raw.slice(at))
  .replace('<script>', shim + '\n<script>');

const PORT = 4471;
createServer((q, r) => {
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  r.end(page);
}).listen(PORT, '127.0.0.1');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* **capturePage rejects, and not rarely.** "Current display surface not
   available for capture" comes back whenever the window has not been
   composited yet, which on a second window is most of the time. It is a
   rejection rather than an empty image, so an unhandled one takes the whole
   run down after the first shot has already been written -- which reads as
   "it worked, then stopped". Ask again. */
async function grab(win, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try { return await win.webContents.capturePage(); }
    catch (e) { await wait(400); }
  }
  return null;
}

/* The city is drawn once per pane and then only drifts, so there is nothing
   to wait for beyond the first paint and the look being applied. */
const SETUP = `(async () => {
  const s = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 100 && !window.__look; i++) await s(100);
  __look.Embers.light = 'skyline';
  __look.Embers.paint();
  await s(400);
  __look.vfxSet('towers', '#04060e', null, 1);
  await s(900);
  const p = document.querySelector('.vfx');
  return p.getAttribute('data-fx') + ' / ' + p.children.length + ' pieces';
})()`;

const HIDE = `(() => {
  const st = document.createElement('style');
  st.id = 'iso';
  st.textContent = '#app > *:not(.vfx){visibility:hidden !important}'
    + '.drawer,.drawer-backdrop{display:none !important}.vfx{opacity:1 !important}';
  document.head.appendChild(st);
  return 'hidden';
})()`;

const STATE = `(() => JSON.stringify({
  light: document.body.dataset.light || '(none)',
  fx: (document.querySelector('.vfx') || {}).dataset && document.querySelector('.vfx').dataset.fx,
  hidden: !!document.getElementById('iso'),
  accent: getComputedStyle(document.getElementById('app')).getPropertyValue('--accent').trim(),
}))()`;

const SHOW = `(() => { const s = document.getElementById('iso'); if (s) s.remove(); return 'shown'; })()`;

const shots = [
  { name: 'skyline', w: 1100, h: 760 },
  { name: 'skyline-phone', w: 430, h: 880 },
];

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  /* **One window, resized between shots.** A second `BrowserWindow` loading
     the same local URL comes back ERR_FAILED every time, after the first
     window has already written its file -- so the run looked like it had
     half worked. Resizing one window and rebuilding the field is the same
     picture and does not go near whatever that is. */
  /* **Shown, not hidden.** A window that is never composited hands
     `capturePage` whatever frame it last had -- which is the app before the
     look was applied and before the furniture was hidden, so every shot came
     back as the default teal with the timer in the middle of it. Shown
     without taking focus is enough to make it paint what it actually is. */
  const win = new BrowserWindow({
    width: shots[0].w, height: shots[0].h, show: false,
    webPreferences: { backgroundThrottling: false },
  });
  win.showInactive();
  await win.loadURL(`http://127.0.0.1:${PORT}/?t=` + Date.now());

  for (const shot of shots) {
    win.setSize(shot.w, shot.h);
    await wait(300);
    /* The city is laid out once when it is built, so a resize needs it built
       again -- otherwise the phone shot is the desktop one, cropped. */
    const said = await win.webContents.executeJavaScript(SETUP).catch((e) => 'threw: ' + e.message);
    console.log(`${shot.name} (${shot.w}x${shot.h}): ${said}`);

    await win.webContents.executeJavaScript(HIDE);
    await wait(600);
    console.log('  about to shoot the pane: ' + await win.webContents.executeJavaScript(STATE));
    let img = await grab(win);
    if (img) writeFileSync(join(outDir, shot.name + '-pane.png'), img.toPNG());
    else console.log('  ' + shot.name + '-pane: the window would not compose');

    await win.webContents.executeJavaScript(SHOW);
    await wait(600);
    console.log('  about to shoot the app:  ' + await win.webContents.executeJavaScript(STATE));
    img = await grab(win);
    if (img) writeFileSync(join(outDir, shot.name + '.png'), img.toPNG());
    else console.log('  ' + shot.name + ': the window would not compose');
  }
  win.destroy();
  console.log('wrote look/skyline{,-pane}.png and look/skyline-phone{,-pane}.png');
  app.quit();
});
