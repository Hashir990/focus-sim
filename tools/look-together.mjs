/**
 * The six games that need other people, with other people in them.
 *
 *   npx electron tools/look-together.mjs
 *
 * Writes look/games/together-<game>.png — every panel in one picture, so what
 * you are looking at is the room rather than one side of it.
 *
 * **How there are other people.** Focus together is PeerJS, and the gate has
 * run two and three windows against each other for a long time by handing
 * them a stand-in for it: instances register in one table and find each other
 * there, so no network is involved and the app's own protocol still runs end
 * to end. The same stand-in is used here, shared by iframes of one page
 * instead of by jsdom windows. Nothing about the games is faked — they host,
 * they join, they deal, and every intent travels the way it does on a phone.
 *
 * Two things have to be arranged for that to work in a browser:
 *
 *   - **Each panel needs its own storage.** Same-origin iframes share one
 *     `localStorage`, and a room full of people who are all the same device
 *     is not a room. Each gets an in-memory one of its own.
 *   - **Each panel needs a door.** The pairing shortcut — putting people on
 *     each other's friends list so nobody is held at the door for a
 *     screenshot — reaches inside the IIFE, so a line is spliced in before it
 *     closes, exactly as `withDoor` does in tools/smoke-test.mjs.
 */
import { app, BrowserWindow } from 'electron';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'look', 'games');
const PORT = 4414;
const W = 460, H = 900;              // one panel: the window electron/main.cjs opens
mkdirSync(outDir, { recursive: true });

const NAMES = ['Hashir', 'Noor', 'Sam', 'Ada'];

/* ---- the page each panel loads ------------------------------------------ */

const raw = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
const termsV = (raw.match(/const TERMS_VERSION = '([^']+)'/) || [])[1] || '';

/** A line spliced in before the IIFE closes, which is the only way to reach
    what is inside it. Same trick, same reason, as `withDoor` in the gate. */
function withDoor(src, code) {
  const at = src.lastIndexOf('})();');
  if (at < 0) throw new Error('no closing IIFE to splice a door into');
  return src.slice(0, at) + '\n' + code + '\n' + src.slice(at);
}

const DOOR = 'window.__r = {SYNC, Arcade, MrWhite, Spymaster, Chat};';

/** Runs before the app does: a storage of this panel's own, a seed in it, and
    the shared stand-in for PeerJS taken from the page that owns the panels. */
const shim = (n) => `<script>(function(){
  /* Same-origin iframes share one localStorage, so a room would be four
     copies of one device. Each panel gets its own, in memory. */
  var mem = {};
  var store = {
    getItem: function(k){ return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem: function(k, v){ mem[k] = String(v); },
    removeItem: function(k){ delete mem[k]; },
    clear: function(){ mem = {}; },
    key: function(i){ return Object.keys(mem)[i] === undefined ? null : Object.keys(mem)[i]; },
    get length(){ return Object.keys(mem).length; }
  };
  try { Object.defineProperty(window, 'localStorage', { configurable: true, value: store }); } catch (e) {}
  var d = new Date(), p = function(x){ return String(x).padStart(2, '0'); };
  var day = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  store.setItem('focus_terms', JSON.stringify({ v: ${JSON.stringify(termsV)}, at: 1 }));
  store.setItem('focus_setup', '1');
  store.setItem('focus_log', JSON.stringify([{ id: 'x1', day: day, ts: Date.now(), secs: 7200 }]));
  store.setItem('focus_embers', JSON.stringify({ have: 9999, earned: 9999, own: [] }));
  window.__panel = ${n};
  window.Peer = parent.__mkPeer(window);
})();</script>`;

const appPage = (n) => withDoor(raw, DOOR).replace('<script>', shim(n) + '\n<script>');

/* ---- the page that holds them ------------------------------------------- */

const harness = (n) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Focus together</title>
<style>
  html,body{margin:0;padding:0;background:#05080f;overflow:hidden}
  #row{display:grid;gap:2px;background:#05080f;
       grid-template-columns:repeat(${n > 2 ? 2 : n}, ${W}px)}
  iframe{width:${W}px;height:${H}px;border:0;display:block;background:#0b1220}
</style></head><body>
<div id="row">${Array.from({ length: n }, (_, i) =>
  `<iframe src="/app?p=${i}" title="panel ${i}"></iframe>`).join('')}</div>
<script>
/* The stand-in for PeerJS, lifted from tools/smoke-test.mjs. Instances
   register in FAKE_NET and find each other there; the app's own protocol runs
   over it unchanged. */
var FAKE_NET = {};
window.__mkPeer = function (win) {
  return function FakePeer(id) {
    var self = this, handlers = {};
    self.id = id || 'anon-' + Math.random().toString(36).slice(2, 9);
    self._win = win;
    self.destroyed = false;
    self.on = function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return self; };
    self._emit = function (ev) {
      var a = [].slice.call(arguments, 1);
      (handlers[ev] || []).forEach(function (f) { f.apply(null, a); });
    };
    self.destroy = function () { self.destroyed = true; delete FAKE_NET[self.id]; };
    self._mkConn = function (to) { return mkConn(self.id, to); };
    self.connect = function (target, opts) {
      var conn = mkConn(self.id, target);
      conn.metadata = (opts && opts.metadata) || null;
      var remote = FAKE_NET[target];
      setTimeout(function () {
        if (!remote) { conn._emit('error', new Error('peer-unavailable')); return; }
        var back = remote._mkConn(self.id);
        back.metadata = conn.metadata;
        conn._peerConn = back; back._peerConn = conn;
        remote._emit('connection', back);
        setTimeout(function () { back._emit('open'); conn._emit('open'); }, 0);
      }, 0);
      return conn;
    };
    if (FAKE_NET[self.id]) {
      setTimeout(function () {
        var e = new Error('taken'); e.type = 'unavailable-id'; self._emit('error', e);
      }, 0);
    } else {
      FAKE_NET[self.id] = self;
      setTimeout(function () { self._emit('open', self.id); }, 0);
    }
    function mkConn(from, to) {
      var h = {}, c = {
        peer: to, open: true, _win: win,
        on: function (ev, fn) { (h[ev] = h[ev] || []).push(fn); return c; },
        _emit: function (ev) {
          var a = [].slice.call(arguments, 1);
          (h[ev] || []).forEach(function (f) { f.apply(null, a); });
        },
        send: function (data) {
          var other = c._peerConn;
          if (!other || !other._win || !other._win.document) return;
          setTimeout(function () { other._emit('data', JSON.parse(JSON.stringify(data))); }, 0);
        },
        close: function () { c.open = false; c._emit('close'); }
      };
      return c;
    }
  };
};

/* ---- what the driver calls --------------------------------------------- */
var P = function (i) { return window.frames[i]; };
var D = function (i) { return P(i).document; };
var $ = function (i, id) { return D(i).getElementById(id); };
var N = ${n};
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var all = function () { var a = []; for (var i = 0; i < N; i++) a.push(i); return a; };
var until = async function (fn, ms) {
  for (var t = 0; t < (ms || 80); t++) { try { if (fn()) return true; } catch (e) {} await sleep(100); }
  return false;
};
var shown = function (i, id) {
  var el = $(i, id);
  return !!el && P(i).getComputedStyle(el).display !== 'none';
};
window.__h = { P: P, D: D, $: $, N: N, sleep: sleep, all: all, until: until, shown: shown };

window.__ready = function () {
  return all().every(function (i) { return P(i).__r && P(i).__r.SYNC; });
};

/** Everybody in one room: panel 0 opens it, the rest join by its code.
    They are put on each other's friends list first, because a stranger is
    held at the door on purpose and a screenshot should not have to knock. */
window.__pair = async function () {
  for (var i = 0; i < N; i++) {
    var name = ${JSON.stringify(NAMES)}[i];
    $(i, 'sync-name').value = name;
    $(i, 'sync-name').dispatchEvent(new (P(i).Event)('input'));
    $(i, 'd-sync').click();
    await sleep(60);
  }
  // mutual friends, so nobody is held at the door
  for (var a = 0; a < N; a++) for (var b = 0; b < N; b++) {
    if (a === b) continue;
    var code = $(b, 'sync-mycode').textContent;
    var list = P(a).__r.SYNC.friends;
    if (code && code.length >= 4 && !list.some(function (f) { return f.code === code; })) {
      list.push({ code: code, u: 'them', name: ${JSON.stringify(NAMES)}[b], ok: 1, at: Date.now() });
    }
  }
  $(0, 'sync-host').click();
  await sleep(250);
  var host = $(0, 'sync-mycode').textContent;
  for (var j = 1; j < N; j++) {
    $(j, 'sync-code').value = host;
    $(j, 'sync-join').click();
    await sleep(350);
  }
  await until(function () {
    return $(0, 'sync-people').querySelectorAll('.sync-person').length >= N - 1;
  });
  for (var k = 0; k < N; k++) $(k, 'sync-close').click();
  await sleep(200);
  return $(0, 'sync-people').textContent.replace(/\\s+/g, ' ').slice(0, 90);
};

window.__open = async function (game) {
  for (var i = 0; i < N; i++) {
    $(i, 'arcade-open').classList.remove('hide');
    $(i, 'arcade-open').click();
    await sleep(120);
    var card = D(i).querySelector('.pcard[data-game="' + game + '"]');
    if (!card) return 'no card for ' + game;
    card.click();
    await sleep(500);
  }
  await sleep(900);
  return 'opened';
};
</script></body></html>`;

/* ---- the server --------------------------------------------------------- */

createServer((q, r) => {
  const u = new URL(q.url, 'http://x');
  const html = u.pathname === '/app'
    ? appPage(Number(u.searchParams.get('p') || 0))
    : harness(Number(u.searchParams.get('n') || 2));
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  r.end(html);
}).listen(PORT, '127.0.0.1');

/* ---- what to photograph -------------------------------------------------
   `live` runs in the harness page with __h in scope, and brings the game to
   the state worth looking at: a word set and some letters guessed, a few
   tiles down, a clue given. A lobby is a screenshot of a waiting room. */

const SHOTS = [
  {
    name: 'hangman', game: 'hangman', seats: 2,
    live: `async () => {
      const {$, until, shown, sleep} = __h;
      $(1, 'hm-take').click();
      await until(() => shown(1, 'hm-set'));
      $(1, 'hm-word-in').value = 'puzzle';
      $(1, 'hm-hint-in').value = 'what this is';
      $(1, 'hm-go').click();
      await sleep(400);
      for (const L of ['P', 'E', 'Z', 'R']) {
        const k = [...__h.D(0).querySelectorAll('#hm-keys button')]
          .find((b) => b.textContent.trim().toUpperCase() === L);
        if (k) { k.click(); await sleep(220); }
      }
      return $(0, 'hm-word').textContent.replace(/\\s+/g, ' ').trim();
    }`,
  },
  {
    name: 'scrabble', game: 'scrabble', seats: 2,
    live: `async () => {
      const {sleep, D} = __h;
      await sleep(900);
      return D(0).querySelectorAll('#sc-board [data-r]').length + ' squares';
    }`,
  },
  {
    name: 'chess', game: 'chess', seats: 2,
    live: `async () => {
      const {sleep, D, until, shown} = __h;
      /* **Chess is not one game for the whole room.** Opening it on both
         panels leaves two people looking at a list with each other on it;
         somebody has to ask and somebody has to say yes. */
      await sleep(500);
      const pick = D(0).querySelector('#ch-people .ch-pick');
      if (!pick) return 'nobody to play';
      pick.click();
      await until(() => [...D(1).querySelectorAll('#ch-people button')]
        .some((b) => b.dataset.code && b.dataset.act !== 'decline'), 40);
      const yes = [...D(1).querySelectorAll('#ch-people button')]
        .find((b) => b.dataset.code && b.dataset.act !== 'decline');
      if (!yes) return 'the invitation never arrived';
      yes.click();
      await until(() => shown(0, 'ch-live') && shown(1, 'ch-live'), 40);
      await sleep(500);
      /* Three moves, played rather than scripted: pick a square of your own
         and take whatever the board then offers. A written-out opening
         depends on which end of it each panel is sitting at, which is not
         something a screenshot should have to know. */
      for (const w of [0, 1, 0]) {
        const mine = [...D(w).querySelectorAll('#ch-board .ch-sq')]
          .filter((b) => b.querySelector('.ch-p'));
        let moved = false;
        for (const from of mine) {
          from.click();
          await sleep(140);
          const to = D(w).querySelector('#ch-board .ch-sq.go, #ch-board .ch-sq.take');
          if (to) { to.click(); await sleep(450); moved = true; break; }
        }
        if (!moved) break;
      }
      await sleep(400);
      return D(0).querySelectorAll('#ch-board .ch-p').length + ' pieces, '
        + D(0).querySelectorAll('#ch-board .ch-sq.last').length + ' just moved';
    }`,
  },
  {
    name: 'pictionary', game: 'pictionary', seats: 2,
    live: `async () => {
      const {$, sleep, D, until, shown} = __h;
      const take = $(0, 'pic-take');
      if (take && shown(0, 'pic-take')) { take.click(); await until(() => shown(0, 'pic-draw-tools'), 20); }
      await sleep(600);
      return (D(0).querySelector('#pic-role') || {}).textContent || 'open';
    }`,
  },
  {
    name: 'mrwhite', game: 'mrwhite', seats: 3,
    live: `async () => {
      const {$, D, sleep, until, all} = __h;
      for (const i of all()) {
        const v = D(i).querySelector('#mw-sets [data-v="animals"]');
        if (v) { v.click(); await sleep(150); }
      }
      await sleep(300);
      $(0, 'mw-start').click();
      await until(() => __h.shown(0, 'mw-card'), 40);
      await sleep(600);
      return ($(0, 'mw-card') || {}).textContent || 'started';
    }`,
  },
  {
    name: 'spymaster', game: 'spymaster', seats: 4,
    live: `async () => {
      const {$, D, sleep, until, all} = __h;
      /* The lobby draws its seats from JS, so the buttons are found by what
         they say rather than by an id that does not exist until then. */
      /* **Named, not counted.** The seats are data-seat="red:spy" and
         friends, and a seat's button disappears the moment somebody takes
         it -- so clicking "the n-th button" is clicking whatever has shifted
         into that place. One spymaster and one guesser a side. */
      const SEATS = ['red:spy', 'red:op', 'blue:spy', 'blue:op'];
      for (let i = 0; i < 4; i++) {
        const b = D(i).querySelector('[data-seat="' + SEATS[i] + '"]');
        if (b) { b.click(); await sleep(350); }
      }
      await sleep(400);
      $(0, 'sm-start').click();
      await until(() => __h.shown(0, 'sm-play'), 40);
      await sleep(700);
      return D(0).querySelectorAll('#sm-grid > *').length + ' cards';
    }`,
  },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function load(win, url) {
  for (let go = 0; go < 3; go++) {
    try { await win.loadURL(url); return true; } catch (e) { await wait(700); }
  }
  return false;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W * 2, height: H, show: true, frame: false,
    backgroundColor: '#05080f',
    webPreferences: { backgroundThrottling: false },
  });

  for (const shot of SHOTS) {
    const cols = Math.min(2, shot.seats), rows = Math.ceil(shot.seats / 2);
    win.setContentSize(cols * W + (cols - 1) * 2, rows * H + (rows - 1) * 2);
    await wait(300);
    if (!await load(win, `http://127.0.0.1:${PORT}/?n=${shot.seats}&r=${Date.now()}`)) {
      console.log('! could not load for ' + shot.name); continue;
    }
    const run = (js) => win.webContents.executeJavaScript(js).catch((e) => 'threw: ' + e.message);
    const booted = await run(
      `(async () => { for (let t = 0; t < 120; t++) { if (window.__ready()) return true; `
      + `await new Promise(r => setTimeout(r, 150)); } return false; })()`);
    if (booted !== true) { console.log(`${shot.name.padEnd(11)} panels never booted`); continue; }

    const room = await run('window.__pair()');
    const open = await run(`window.__open(${JSON.stringify(shot.game)})`);
    const said = await run(`(${shot.live})()`);
    await wait(900);

    const img = await win.webContents.capturePage();
    const file = join(outDir, 'together-' + shot.name + '.png');
    writeFileSync(file, img.toPNG());
    console.log(`${shot.name.padEnd(11)} ${shot.seats} seats  room[${String(room).slice(0, 34)}]  `
      + `${open}  ${String(said).slice(0, 40)}  ${img.getSize().width}×${img.getSize().height}`);
  }
  win.destroy();
  app.quit();
});
