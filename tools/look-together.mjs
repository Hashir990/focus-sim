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

const DOOR = 'window.__r = {SYNC, Arcade, MrWhite, Spymaster, Chat,'
  + ' Pictionary, PIC_TIERS};';

/** Runs before the app does: a storage of this panel's own, a seed in it, and
    the shared stand-in for PeerJS taken from the page that owns the panels. */
/* One outfit per seat, so the people in a room are telling apart. Indices
   are into the wardrobe tables in 46-buddy.js; 0 is Bare. */
/* What each seat does while the clock runs: indices into BUD_ANIMS in
   46-buddy.js. 5 is the balloon, 2 is the swim, 4 is the jetpack, 0 is the
   web-swing.

   The quiet ones -- Nap, Reading, Pace -- were the obvious choice and the
   wrong one: all three park along the bottom edge, which is the point of
   them while you are working and photographs as three buddies in a row
   with their feet cut off. These three use the height of the window, so a
   still frame catches them at three different places in it. */
const ANTICS = [5, 2, 4, 0];

const OUTFITS = [
  /* **Four people who have each spent their embers differently**, rather
     than four bare figures in four body colours. `b` is the body out of
     BUD_BODY, `c` the skin out of BUD_SKIN, and h / o / a / f / r are the
     hat, coat, worn thing, face and hair, each with a dye out of BUD_TINT
     in which 0 means "as it was drawn". See 46-buddy.js.

     One costume each, because a room is people who chose different
     things: a spacesuit, somebody dressed for the cold, somebody in a lab
     coat and glasses, somebody in a flower crown. */
  // the one on the wardrobe screen: helmet, red cape, smitten eyes
  { b: 7, c: 9, e: 11, h: 12, a: 0, f: 7, o: 4, r: 1,
    ec: 4, es: 6, ey: 6, ex: 6, rc: 5, hc: 0, ac: 0, fc: 0, oc: 1 },
  // out in the cold: beanie, puffer, scarf
  { b: 6, c: 0, e: 2, h: 2, a: 3, f: 0, o: 3, r: 5,
    ec: 7, es: 1, ey: 2, ex: 2, rc: 1, hc: 7, ac: 12, fc: 0, oc: 8 },
  // the lab: headphones, coat, round glasses
  { b: 3, c: 4, e: 0, h: 7, a: 0, f: 3, o: 5, r: 2,
    ec: 0, es: 1, ey: 2, ex: 2, rc: 2, hc: 13, ac: 0, fc: 0, oc: 12 },
  // flower crown, cardigan, pendant
  { b: 9, c: 1, e: 3, h: 9, a: 5, f: 7, o: 7, r: 3,
    ec: 5, es: 1, ey: 2, ex: 2, rc: 3, hc: 10, ac: 3, fc: 0, oc: 10 },
];

/* The light every panel of the current shot is under. Set per shot, read
   when a panel's page is built. A shot can give each seat its own instead,
   which is what a room actually looks like: everybody on their own device
   wearing whatever they bought. */
let LOOK = 'peony';
let LOOKS = null;
const lookOf = (n) => (LOOKS && LOOKS[n]) || LOOK;

/* **What a costume costs.** `budStrip` takes off anything that is not
   owned and saves the result, so the wardrobe a seat is dressed in has to
   be on its shopping list too. The ids are the ones `budItemId` builds:
   the row's letter and the index. Index 0 is bare and always available. */
const wardrobe = (o) => ['e', 'h', 'a', 'f', 'o', 'r']
  .filter((k) => o && o[k]).map((k) => 'bud-' + k + o[k]);

const shim = (n) => `<script>(function(){
  var NAME = ${JSON.stringify(NAMES)}[${n}] || 'Someone';
  var BUDDY = ${JSON.stringify(OUTFITS)}[${n}] || ${JSON.stringify(OUTFITS[0])};
  var ANTIC = ${JSON.stringify(ANTICS)}[${n}];
  if (ANTIC == null) ANTIC = 1;
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
  /* The antic is a thing you buy, like a hat, and budOwns says no to one
     that is not on the list -- so it has to be owned or he stays off the
     clock screen however the setting reads. */
  store.setItem('focus_embers', JSON.stringify({
    have: 9999, earned: 9999, light: ${JSON.stringify(lookOf(n))},
    own: [${JSON.stringify(lookOf(n))}, 'bud-an' + ANTIC]
      .concat(${JSON.stringify(wardrobe(OUTFITS[n] || OUTFITS[0]))}) }));
  /* **Signed in, or the picture is of a sign-in prompt.** Rooms hang off an
     account; without one, reaching the room screen puts a dialog over the
     board and leaves it there. The pairing below goes at the sync internals
     and works either way, which is why every capture came out with
     "Sign in to focus together" across it and nothing looked wrong here.

     fetch goes with it: ACC_URL in a built page is the live account
     worker, and a made-up token would send real failing requests to it from
     a screenshot tool. */
  store.setItem('focus_account', JSON.stringify({
    token: 'promo-shot-not-a-real-token', username: NAME, rev: 1 }));
  window.fetch = function(){
    return Promise.resolve({ ok: true, status: 200,
      json: function(){ return Promise.resolve({ ok: true, rev: 1, snapshot: null }); },
      text: function(){ return Promise.resolve('{"ok":true}'); } });
  };
  /* Everybody in the room is dressed differently, because a room of
     identical blank buddies does not look like a room of people. */
  store.setItem('focus_sim', JSON.stringify({
    buddy: BUDDY, budAnim: ANTIC, budShow: true }));
  window.__panel = ${n};
  window.Peer = parent.__mkPeer(window);
})();</script>`;

const appPage = (n) => withDoor(raw, DOOR).replace('<script>', shim(n) + '\n<script>');

/* ---- the page that holds them ------------------------------------------- */

const harness = (n, cols) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Focus together</title>
<style>
  html,body{margin:0;padding:0;background:#05080f;overflow:hidden}
  #row{display:grid;gap:2px;background:#05080f;
       grid-template-columns:repeat(${cols || (n > 2 ? 2 : n)}, ${W}px)}
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
    : harness(Number(u.searchParams.get('n') || 2),
                Number(u.searchParams.get('c') || 0));
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  r.end(html);
}).on('error', (e) => {
  /* **Not a warning.** An unheard EADDRINUSE leaves the window
     loading from the previous run's server, which answers every
     request with the last room it reached -- so every file comes
     out correctly named and containing the wrong picture. */
  console.log('port ' + PORT + ' is already in use (' + e.code + ').'
    + ' Another run of this tool is still alive; its pictures would be'
    + ' served in place of these. Stop it and try again.');
  process.exit(1);
}).listen(PORT, '127.0.0.1');

/* ---- what to photograph -------------------------------------------------
   `live` runs in the harness page with __h in scope, and brings the game to
   the state worth looking at: a word set and some letters guessed, a few
   tiles down, a clue given. A lobby is a screenshot of a waiting room. */

const SHOTS = [
  {
    /* **The clock, shared.** Everyone in the room counts the same block
       down together, each with the name and the buddy they chose. */
    name: 'focus', game: null, seats: 3, cols: 3,
    /* Blossom, stars and lava: three seats, three devices, three shelves
       spent differently. The timer-holder keeps peony because that is the
       card the listing puts in front. */
    looks: ['peony', 'space', 'magma'],
    live: `async () => {
      const {$, sleep, all, until, D} = __h;
      /* The one holding the timer starts it; the others follow because the
         room carries the clock, which is the whole point of the picture. */
      const go = $(0, 'begin');
      if (go) go.click();
      await until(() => all().every((i) => {
        const c = $(i, 'clock');
        return c && /\\d/.test(c.textContent) && !/25:00/.test(c.textContent);
      }), 60);
      await sleep(1800);
      /* Out of the way: it is a real part of the app and it covers the top
         third of every panel, which is the room chip and the dial. */
      const tidy = () => all().forEach((i) =>
        ['.mood-ask', '.toast', '.ach-pop', '#emb-gain'].forEach((sel) => {
          const el = D(i).querySelector(sel); if (el) el.style.display = 'none';
        }));
      tidy();
      /* **And settled afterwards, not before.** The room re-syncs in the
         second between this returning and the shutter, and a panel caught
         mid-redraw photographs as an empty screen -- which happened to two
         of the three on about one run in three. */
      await until(() => all().every((i) => {
        const t = (($(i, 'clock') || {}).textContent || '').trim();
        return t.indexOf(':') > 0 && t !== '25:00';
      }), 60);
      tidy();
      await sleep(600);
      return all().map((i) => ($(i, 'clock') || {}).textContent || '?').join(' ');
    }`,
  },
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
    name: 'scrabble', game: 'scrabble', look: 'hearth', seats: 2,
    live: `async () => {
      const {$, D, P, sleep} = __h;
      await sleep(900);

      /* A tap, the way a finger makes one: the board listens for pointers,
         not for clicks. */
      const tap = async (i, el) => {
        if (!el) return;
        const r = { clientX: 10, clientY: 10, bubbles: true, cancelable: true,
                    pointerId: 1, pointerType: 'touch', isPrimary: true };
        el.dispatchEvent(new (P(i).PointerEvent)('pointerdown', r));
        el.dispatchEvent(new (P(i).PointerEvent)('pointerup', r));
        await sleep(45);
      };
      const cells = (i) => D(i).querySelectorAll('#sc-board .sc-sq');
      const sq = (i, r, c) => cells(i)[r * 15 + c];
      const rack = (i) => [...D(i).querySelectorAll('#sc-rack .sc-t')]
        .filter((t) => /^[a-z]$/i.test(((t.textContent || '').trim()[0] || '')));
      const ready = (i) => { const b = $(i, 'sc-play'); return b && !b.disabled; };
      const recall = async (i) => { const b = $(i, 'sc-recall'); if (b) b.click(); await sleep(70); };
      /* Only the player on turn can act, which is how the harness knows
         whose turn it is without being told. */
      const onTurn = () => {
        const a = $(0, 'sc-recall');
        return (a && !a.disabled) ? 0 : 1;
      };

      /* **Tiles are found again every time, never held.** Putting one
         down redraws the rack, so a node picked up before the loop is
         detached by the second tap of the first attempt and every tap
         after it lands on nothing. The data-i attribute is the tile's
         own id and it survives the redraw. */
      const ids = (i) => rack(i).map((t) => t.dataset.i);
      const tile = (i, id) => D(i).querySelector('#sc-rack .sc-t[data-i="' + id + '"]');

      /* The opening word has to cross the star in the middle. */
      const opening = async (i) => {
        const r = ids(i);
        for (const a of r) for (const b of r) {
          if (a === b) continue;
          await tap(i, tile(i, a)); await tap(i, sq(i, 7, 7));
          await tap(i, tile(i, b)); await tap(i, sq(i, 7, 8));
          if (ready(i)) { $(i, 'sc-play').click(); await sleep(450); return true; }
          await recall(i);
        }
        return false;
      };

      /* After that, one tile hung on what is already down. Every empty
         square touching a tile is tried with every tile in the rack. */
      const beside = (i) => {
        const cs = cells(i), out = [], seen = {};
        const at = (r, c) => (r >= 0 && r < 15 && c >= 0 && c < 15) ? cs[r * 15 + c] : null;
        for (let k = 0; k < cs.length; k++) {
          if (!cs[k].classList.contains('tile')) continue;
          const r = Math.floor(k / 15), c = k % 15;
          for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const e = at(r + dr, c + dc);
            if (!e || e.classList.contains('tile')) continue;
            const key = (r + dr) + ',' + (c + dc);
            if (!seen[key]) { seen[key] = 1; out.push([r + dr, c + dc]); }
          }
        }
        return out;
      };
      const hangOne = async (i) => {
        const spots = beside(i);
        for (const id of ids(i)) for (const [r, c] of spots) {
          await tap(i, tile(i, id)); await tap(i, sq(i, r, c));
          if (ready(i)) { $(i, 'sc-play').click(); await sleep(450); return true; }
          await recall(i);
        }
        return false;
      };

      let moves = 0;
      if (await opening(onTurn())) moves++;
      for (let n = 0; n < 3 && moves; n++) { if (await hangOne(onTurn())) moves++; else break; }
      /* **Back to the whole board.** Two taps near each other inside the
         double-tap window is the board's own zoom gesture, and placing a
         tile is two taps -- so by the end of a few words the thing is
         zoomed in and scrolled somewhere. Zooming out to the floor is
         the Fit the label reports. */
      for (const i of [0, 1]) {
        const out = $(i, 'sc-zout');
        for (let n = 0; n < 8 && out; n++) { out.click(); await sleep(60); }
        const wrap = $(i, 'sc-boardwrap');
        if (wrap) { wrap.scrollTop = 0; wrap.scrollLeft = 0; }
      }
      await sleep(600);
      const down = [...cells(0)].filter((c) => c.classList.contains('tile')).length;
      const zoom = (($(0, 'sc-zlabel') || {}).textContent || '').trim();
      return moves + ' words played, ' + down + ' tiles on the board, ' + zoom;
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
    /* Under a different light from the rest: a drawing board wants
       somewhere dark behind it, and nine pink rooms sell one theme. */
    name: 'pictionary', game: 'pictionary', seats: 2, look: 'skyline',
    live: `async () => {
      const {$, sleep, D, P, until, shown} = __h;

      /* Shapes this can draw, as fractions of the board. */
      const SHAPES = {
        house: [[[.28,.70],[.28,.42],[.72,.42],[.72,.70],[.28,.70]],
                [[.22,.43],[.50,.22],[.78,.43]],
                [[.44,.70],[.44,.55],[.56,.55],[.56,.70]],
                [[.32,.50],[.40,.50],[.40,.58],[.32,.58],[.32,.50]]],
        arrow: [[[.18,.50],[.82,.50]], [[.60,.30],[.82,.50],[.60,.70]]],
        tree:  [[[.50,.16],[.30,.46],[.70,.46],[.50,.16]],
                [[.50,.34],[.24,.68],[.76,.68],[.50,.34]],
                [[.45,.68],[.45,.84],[.55,.84],[.55,.68]]],
        boat:  [[[.22,.66],[.78,.66],[.68,.80],[.32,.80],[.22,.66]],
                [[.50,.66],[.50,.22]], [[.52,.26],[.74,.60],[.52,.60]]],
        cup:   [[[.34,.34],[.38,.70],[.62,.70],[.66,.34],[.34,.34]],
                [[.66,.42],[.76,.46],[.72,.58],[.64,.58]]],
        apple: [[[.50,.30],[.34,.36],[.30,.56],[.42,.74],[.50,.70],[.58,.74],
                 [.70,.56],[.66,.36],[.50,.30]], [[.50,.30],[.52,.20]]],
        balloon: [[[.50,.18],[.34,.30],[.34,.48],[.50,.62],[.66,.48],[.66,.30],[.50,.18]],
                  [[.50,.62],[.52,.82]]],
        bell:  [[[.50,.22],[.36,.36],[.34,.62],[.28,.70],[.72,.70],[.66,.62],
                 [.64,.36],[.50,.22]], [[.46,.74],[.54,.74]]],
        book:  [[[.24,.34],[.50,.42],[.76,.34],[.76,.70],[.50,.78],[.24,.70],[.24,.34]],
                [[.50,.42],[.50,.78]]],
        candle:[[[.42,.76],[.42,.36],[.58,.36],[.58,.76],[.42,.76]],
                [[.50,.34],[.54,.24],[.50,.16],[.46,.24],[.50,.34]]],
        drum:  [[[.30,.40],[.70,.40],[.74,.68],[.26,.68],[.30,.40]],
                [[.30,.42],[.50,.52],[.70,.42]], [[.30,.52],[.70,.52]]],
        flag:  [[[.32,.82],[.32,.20]], [[.32,.22],[.72,.30],[.32,.46]]],
        hat:   [[[.36,.56],[.40,.28],[.60,.28],[.64,.56]], [[.24,.58],[.76,.58]]],
        kite:  [[[.50,.20],[.30,.44],[.50,.70],[.70,.44],[.50,.20]],
                [[.50,.70],[.52,.84]]],
        ladder:[[[.36,.20],[.36,.82]], [[.64,.20],[.64,.82]],
                [[.36,.34],[.64,.34]], [[.36,.50],[.64,.50]], [[.36,.66],[.64,.66]]],
        pencil:[[[.26,.74],[.30,.62],[.70,.26],[.76,.34],[.36,.70],[.26,.74]],
                [[.30,.62],[.36,.70]]],
        umbrella:[[[.18,.48],[.50,.24],[.82,.48]],
                  [[.18,.48],[.34,.56],[.50,.48],[.66,.56],[.82,.48]],
                  [[.50,.48],[.50,.76],[.60,.80]]],
        glasses:[[[.22,.48],[.44,.48],[.44,.62],[.22,.62],[.22,.48]],
                 [[.56,.48],[.78,.48],[.78,.62],[.56,.62],[.56,.48]],
                 [[.44,.54],[.56,.54]]],
        envelope:[[[.22,.36],[.78,.36],[.78,.68],[.22,.68],[.22,.36]],
                  [[.22,.36],[.50,.54],[.78,.36]]],
      };

      /* **The word is chosen by the game, from what it is left.**
         \`_offer\` takes a word from the tier's list that is not in
         \`state.recent\`. Marking every easy word this cannot draw as
         recently seen leaves it picking from the ones it can, by its own
         rule -- rather than writing a word onto the screen that the game
         never chose. Only one of the three offers is from the easy list,
         which is why luck was not going to do it: thirty shapes against
         three hundred words matched about one round in ten.

         The pool is narrower than the table because drawing *something* is
         not the same as drawing the thing the word says: a bridge came out
         an umbrella, with BRIDGE printed over it. These four read. */
      const WANT = ['envelope', 'house', 'umbrella', 'ladder'];
      let seeded = -1;
      try {
        const P0 = P(0).__r.Pictionary, T = P(0).__r.PIC_TIERS;
        if (P0 && P0.state && T && T[0]) {
          P0.state.recent = T[0].words.filter(function (x) { return WANT.indexOf(x) < 0; });
          seeded = T[0].words.length - P0.state.recent.length;
        }
      } catch (e) {}

      const take = $(0, 'pic-take');
      if (take && shown(0, 'pic-take')) { take.click(); await sleep(800); }

      const offers = [...D(0).querySelectorAll('#pic-offers button')];
      const wordOf = (b) => ((b.querySelector('b') || b).textContent || '').trim().toLowerCase();
      let chose = offers.find((b) => SHAPES[wordOf(b)]) || offers[0];
      const onOffer = offers.map(wordOf).join('/');
      if (chose) { chose.click(); await sleep(900); }

      /* The word box leads with a <small> saying "Draw this · 60s", so the
         word itself is the text node after it. */
      const wb = D(0).querySelector('#pic-word');
      const picked = wb && wb.lastChild ? (wb.lastChild.textContent || '').trim().toLowerCase() : '';
      const shape = SHAPES[picked];

      /* **Drawn with a finger, not written into the model.** The point of
         the picture is that a stroke made here appears over there, so it
         goes through the canvas's own pointer handling and out over the
         room. */
      const cv = D(0).querySelector('#pic-board');
      if (!cv) return 'no canvas';
      const r = cv.getBoundingClientRect();
      const Ev = P(0).PointerEvent || P(0).MouseEvent;
      const at = (x, y) => ({ clientX: r.left + r.width * x, clientY: r.top + r.height * y,
                              bubbles: true, cancelable: true, pointerId: 1,
                              pointerType: 'mouse', button: 0, buttons: 1 });
      /* **Walked, not jumped -- and it drifts rather than shakes.**
         Independent noise on every sample is a zigzag; the first pass at
         this came out as a seismograph. A finger wanders off the line it
         is aiming at and meets the corner anyway, so the offset is a slow
         wave across the segment, perpendicular to it, multiplied by a
         half-sine so it is zero at both ends. Its size is a fraction of
         the segment's own length: a long roof line wanders, a short
         window frame does not. */
      const stroke = async (pts, part) => {
        const steps = [];
        for (let i = 1; i < pts.length; i++) {
          const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
          const dx = x1 - x0, dy = y1 - y0;
          const len = Math.hypot(dx, dy) || 1e-6;
          const nx = -dy / len, ny = dx / len;
          const n = Math.max(8, Math.round(len * 160));
          const amp = Math.min(0.012, len * 0.05);
          const freq = 1 + Math.random() * 1.4, phase = Math.random() * 6.283;
          for (let k = 1; k <= n; k++) {
            const t = k / n;
            const off = Math.sin(t * Math.PI * freq + phase) * Math.sin(t * Math.PI) * amp
                      + (Math.random() - 0.5) * 0.0013;
            steps.push([x0 + dx * t + nx * off, y0 + dy * t + ny * off]);
          }
        }
        const take = part === undefined ? steps.length
                                        : Math.max(2, Math.round(steps.length * part));
        cv.dispatchEvent(new Ev('pointerdown', at(pts[0][0], pts[0][1])));
        for (let i = 0; i < take; i++) {
          cv.dispatchEvent(new Ev('pointermove', at(steps[i][0], steps[i][1])));
          /* Not a metronome either: a hand slows at corners and hurries
             along a straight. */
          if (i % 7 === 0) await sleep(4 + Math.random() * 8);
        }
        const end = steps[take - 1];
        cv.dispatchEvent(new Ev('pointerup', at(end[0], end[1])));
        await sleep(90 + Math.random() * 120);
      };

      /* **Left unfinished, because a round of this never is** -- but only
         just, because a picture nobody can read sells nothing. Sixty
         seconds, and what you see is somebody near the end of it: a shape
         with four parts or more gives up its last detail, and whatever is
         drawn last stops a little short of where it was going. */
      const paths = (shape || SHAPES.house);
      const upto = paths.length >= 4 ? paths.length - 1 : paths.length;
      for (let i = 0; i < upto; i++) {
        await stroke(paths[i], i === upto - 1 ? 0.76 + Math.random() * 0.13 : undefined);
      }

      /* And somebody guessing, because an empty guess list is half a game. */
      const gi = $(1, 'pic-input');
      if (gi) {
        gi.value = picked === 'house' ? 'barn' : 'house';
        gi.dispatchEvent(new (P(1).Event)('input'));
        const send = $(1, 'pic-send');
        if (send) { send.click(); await sleep(700); }
      }
      await sleep(800);
      return (shape ? 'drew ' : 'MISMATCH, drew house for ') + picked
        + ' (' + upto + ' of ' + paths.length + ' strokes)'
        + '  (offered ' + onOffer + ', pool ' + seeded + ')';
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
    name: 'spymaster', game: 'spymaster', look: 'frost', seats: 4,
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

      /* **Whoever goes first.** It is not always red, and driving the
         wrong side's seats is four clicks that do nothing. */
      const turn = (D(0).querySelector('#sm-status') || {}).textContent || '';
      const red = !/blue/i.test(turn);
      const spy = red ? 0 : 2, op = red ? 1 : 3;
      const mine = red ? 'c-red' : 'c-blue';

      /* The clue, typed and given. */
      const box = $(spy, 'sm-word');
      if (box) {
        box.value = 'HARBOUR';
        box.dispatchEvent(new (P(spy).Event)('input', {bubbles: true}));
      }
      const two = D(spy).querySelector('#sm-nums [data-n="2"]');
      if (two) { two.click(); await sleep(200); }
      const give = $(spy, 'sm-send');
      if (give) { give.click(); await sleep(700); }

      /* **Two of ours, then a neutral**, which is how a turn ends. The
         colours come off the spymaster's board, which is the one screen
         in the room that is allowed to know them; the taps are the
         operative's own and the app decides what each one does. */
      const key = [...D(spy).querySelectorAll('#sm-grid .sm-card')];
      const pickOf = (cls) => key
        .map((c, i) => [c, i])
        .filter(([c]) => c.classList.contains(cls) && !c.classList.contains('shown'))
        .map(([, i]) => i);
      const wanted = pickOf(mine).slice(0, 2).concat(pickOf('c-none').slice(0, 1));
      let turned = 0;
      for (const i of wanted) {
        const card = D(op).querySelector('#sm-grid .sm-card[data-i="' + i + '"]');
        if (!card || card.disabled) continue;
        card.click(); await sleep(260);
        const again = D(op).querySelector('#sm-grid .sm-card[data-i="' + i + '"]');
        if (again) { again.click(); await sleep(520); }
        turned++;
      }
      await sleep(600);
      const over = D(0).querySelectorAll('#sm-grid .sm-card.shown').length;
      const widths = (i) => {
        const w = [...D(i).querySelectorAll('#sm-grid .sm-card')]
          .slice(0, 5).map((c) => Math.round(c.getBoundingClientRect().width));
        return w.join('/');
      };
      return D(0).querySelectorAll('#sm-grid > *').length + ' cards, '
        + over + ' turned over (' + (red ? 'red' : 'blue') + ' led)'
        + ' | spy row ' + widths(spy) + ' | op row ' + widths(op)
        + ' | gridw ' + Math.round(D(spy).querySelector('#sm-grid')
            .getBoundingClientRect().width);
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

  /* Named on the command line, or all of them. */
  const only = process.argv.slice(2).filter((x) => !x.startsWith('-'));
  for (const shot of SHOTS) {
    if (only.length && !only.includes(shot.name)) continue;
    LOOK = shot.look || 'peony';
    LOOKS = shot.looks || null;
    const cols = shot.cols || Math.min(2, shot.seats);
    const rows = Math.ceil(shot.seats / cols);
    win.setContentSize(cols * W + (cols - 1) * 2, rows * H + (rows - 1) * 2);
    await wait(300);
    if (!await load(win, `http://127.0.0.1:${PORT}/?n=${shot.seats}&c=${cols}&r=${Date.now()}`)) {
      console.log('! could not load for ' + shot.name); continue;
    }
    const run = (js) => win.webContents.executeJavaScript(js).catch((e) => 'threw: ' + e.message);
    const booted = await run(
      `(async () => { for (let t = 0; t < 120; t++) { if (window.__ready()) return true; `
      + `await new Promise(r => setTimeout(r, 150)); } return false; })()`);
    if (booted !== true) { console.log(`${shot.name.padEnd(11)} panels never booted`); continue; }

    const room = await run('window.__pair()');
    /* A shot with no game stays on the timer, which is the other thing a
       room is for and the one a single window cannot show. */
    const open = shot.game
      ? await run(`window.__open(${JSON.stringify(shot.game)})`)
      : 'no game, the timer itself';
    let said = await run(`(${shot.live})()`);
    /* **Taken again if the drawing is not of the word.** Three words out
       of three hundred are offered a round, so the shape table does not
       always have one. A fresh room draws fresh words; a few goes makes a
       mismatched picture unlikely rather than merely rarer, and if every
       go misses, the line printed below says so rather than the picture
       being quietly wrong. */
    for (let go = 0; go < 6 && /^MISMATCH/.test(String(said)); go++) {
      if (!await load(win, `http://127.0.0.1:${PORT}/?n=${shot.seats}&c=${cols}&r=${Date.now()}`)) break;
      const ready = await run('(async () => { for (let t = 0; t < 120; t++) {'
        + ' if (window.__ready()) return true;'
        + ' await new Promise(r => setTimeout(r, 150)); } return false; })()');
      if (ready !== true) break;
      await run('window.__pair()');
      await run(`window.__open(${JSON.stringify(shot.game)})`);
      said = await run(`(${shot.live})()`);
    }
    await wait(900);

    /* The panels, without the window around them. See the note above on
       what Windows does to setContentSize, and why this crops the bitmap
       rather than asking capturePage for a rectangle. */
    /* **With the rejection caught.** `capturePage()` rejects with "Current
       display surface not available for capture" when the window is not
       composited at the moment it is asked, which it sometimes is not.
       Unhandled, that stops the run where it stands and prints nothing --
       see the same guard in tools/look-promo.mjs. */
    let raw = null;
    for (let go = 0; go < 8 && !raw; go++) {
      raw = await win.webContents.capturePage().catch(() => null);
      if (!raw) await wait(500);
    }
    if (!raw) { console.log(shot.name.padEnd(11) + 'no surface to capture'); continue; }
    const vw = Number(await run('window.innerWidth')) || raw.getSize().width;
    const k = raw.getSize().width / vw;
    const img = raw.crop({ x: 0, y: 0,
      width: Math.round((cols * W + (cols - 1) * 2) * k),
      height: Math.round((rows * H + (rows - 1) * 2) * k) });
    const file = join(outDir, 'together-' + shot.name + '.png');
    writeFileSync(file, img.toPNG());
    console.log(`${shot.name.padEnd(11)} ${shot.seats} seats  room[${String(room).slice(0, 34)}]  `
      + `${open}  ${String(said).slice(0, 150)}  ${img.getSize().width}×${img.getSize().height}`);
  }
  win.destroy();
  app.quit();
});
