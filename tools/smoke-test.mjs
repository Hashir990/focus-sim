/**
 * Headless smoke test. Loads dist/index.html in a real DOM and drives the app
 * the way a user would. Fails loudly on any uncaught error.
 *
 *   npm test
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Optional argument lets you point the test at any built file:
//   node tools/smoke-test.mjs some/other/index.html
const htmlPath = process.argv[2] ? resolve(process.argv[2]) : join(root, 'dist', 'index.html');
/* **Read with the account server taken out, whatever `.env.release` says.**

   This file tests the app as it ships and as it works offline: no sign-in, no
   server, everything reachable. Once accounts were switched on locally the same
   file started booting a *configured* build with nobody signed in, which is a
   different app — the buddy is locked, Focus together asks you to sign in
   first, and six mailbox checks failed for a reason that had nothing to do with
   the mailbox.

   A test may not depend on a local config file. The configured half is
   `tools/account-client-test.mjs`, which points a copy at a real Worker; this
   half pins the other end so both are always covered no matter how the machine
   it runs on happens to be set up. */
const html = readFileSync(htmlPath, 'utf8').replace(/const ACC_URL = '[^']*'/, "const ACC_URL = ''");

// jsdom can't navigate (blob download, location.reload) or paint to a canvas.
// All three are fine in a real browser, so they are not real failures.
const IGNORE = /Not implemented: (navigation|HTMLCanvasElement|HTMLMediaElement)/;

// Shared address book for the fake peer network, so windows can reach each other.
const FAKE_NET = {};

/* A stand-in for server/mailbox.js, shared by every window the way one real
   deployment would be. It is deliberately the *behaviour* rather than the code:
   the Worker's own logic is covered by server/mailbox-test.mjs, and what matters
   here is that the client posts, fetches, acknowledges, and prefers peers. */
const FAKE_MAIL = { owners:{}, mail:[], sends:0, fetches:0, reset(){
  this.owners = {}; this.mail = []; this.sends = 0; this.fetches = 0;
} };

function fakeMailbox(path, body){
  const M = FAKE_MAIL;
  if (path === '/health') return { ok: true };
  if (path === '/send') {
    M.sends++;
    if (!M.mail.some((m) => m.id === body.id)) {
      M.mail.push({ id: body.id, to: body.to, fromCode: body.from, name: body.name,
                    text: body.text, at: body.at });
    }
    return { ok: true };
  }
  const owned = (code, token) => {
    if (!M.owners[code]) { M.owners[code] = token; return true; }
    return M.owners[code] === token;
  };
  if (path === '/inbox') {
    M.fetches++;
    if (!owned(body.code, body.token)) return { ok: false, error: 'that code belongs to another device' };
    return { ok: true, items: M.mail.filter((m) => m.to === body.code) };
  }
  if (path === '/ack') {
    if (!owned(body.code, body.token)) return { ok: false, error: 'that code belongs to another device' };
    M.mail = M.mail.filter((m) => !(m.to === body.code && (body.ids || []).includes(m.id)));
    return { ok: true };
  }
  return { ok: false, error: 'no such route' };
}

const log = (s) => process.stderr.write(s + '\n');
const checks = [];
const check = (label, ok, detail = '') => {
  checks.push({ label, ok, detail });
  log(`${ok ? '✓' : '✗'} ${label}${detail && !ok ? ' — ' + detail : ''}`);
};
/* **Every pause in here was measured on one machine.**

   Nearly every check that talks to a second window sleeps for a hand-picked
   number of milliseconds and then asserts. Those numbers were picked on a fast
   idle container; on a laptop on battery, or one busy building the bundle at
   the same time, the message has not arrived yet and a perfectly good feature
   reports as broken. Seven checks failed that way on a release run and not one
   of them was a regression — which is worse than useless, because a suite that
   cries wolf gets its failures explained away.

   So the machine is measured once and every pause is scaled to it. A short
   CPU-bound loop against the number the same loop takes on the machine these
   pauses were tuned on; clamped, because the answer to a truly pathological
   machine is not a suite that runs for an hour. `FOCUS_TEST_SLOW=2` forces it,
   for reproducing somebody else's flake. */
const SLOW = (() => {
  const forced = Number(process.env.FOCUS_TEST_SLOW || 0);
  if (forced > 0) return Math.min(8, forced);
  const REF = 13;                       // ms for the loop below, where these numbers were picked
  let best = Infinity;
  for (let r = 0; r < 3; r++) {
    const t0 = Date.now();
    let x = 0;
    for (let i = 0; i < 6e6; i++) x += i % 7;
    best = Math.min(best, Date.now() - t0);
  }
  return Math.min(4, Math.max(1, (best || REF) / REF));
})();
const wait = (ms) => new Promise((r) => setTimeout(r, Math.round(ms * SLOW)));
/** **Wait for the thing, not for a number.**

    Every check that talks to a second window used to sleep for a hand-picked
    number of milliseconds and then assert. That number was picked on one
    machine: on a slower one — a laptop on battery, a machine also building the
    bundle — the message has not arrived yet and a perfectly good feature
    reports as broken. Seven checks failed that way on a release run and not one
    of them was a regression.

    So: poll until it is true, up to a generous ceiling, and carry on the moment
    it is. A passing run gets *faster*, because it stops sleeping through time
    it does not need, and a real failure still fails — it just takes the ceiling
    to do it. Returns whether it came true, so a caller can say so. */
const until = async (fn, ms = 6000, step = 25) => {
  ms = Math.round(ms * SLOW);
  const end = Date.now() + ms;
  for (;;) {
    let ok = false;
    try { ok = !!fn(); } catch (e) { ok = false; }
    if (ok) return true;
    if (Date.now() >= end) return false;
    await wait(step);
  }
};

/* `seed` is written into localStorage before the app's own script runs, the
   same trick tools/dev-build.mjs uses. Some things — a balance of embers, a
   history — take real hours to arrive at honestly, and a test that fakes them
   through the UI is testing the fake. */
/* Every window ever booted, so the verdict can shut them down before exiting.
   `pretendToBeVisual` gives each one a requestAnimationFrame loop that never
   stops on its own, and calling process.exit() while those are live makes libuv
   abort on Windows — "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),
   file src\\win\\async.c". It is not a test failure and nothing prints before
   it, which makes it read like the suite passed and then the machine broke.
   Linux tears the process down without complaining, so the sandbox never sees
   this. */
const BOOTED = [];

function boot(pageHtml, seed) {
  /* **The terms are already agreed to, unless a test says otherwise.** A fresh
     start shows them over everything and holds back the mood question until
     "I agree", which is right for a person and wrong for every check below
     that is about something else. Seeded from the version the page carries,
     so bumping it does not quietly turn the gate back on for the whole suite;
     pass `focus_terms: null` to see the first start as a new user does. */
  const termsV = (pageHtml.match(/const TERMS_VERSION = '([^']+)'/) || [])[1];
  seed = Object.assign(termsV ? { focus_terms: JSON.stringify({ v: termsV, at: 1 }) } : {}, seed || {});
  if (seed.focus_terms === null) delete seed.focus_terms;
  if (Object.keys(seed).length) {
    const js = Object.keys(seed)
      .map((k) => `localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(seed[k])});`)
      .join('');
    pageHtml = pageHtml.replace('<script>', `<script>try{${js}}catch(e){}</script>\n<script>`);
  }
  const errors = [];
  const vc = new VirtualConsole();
  const record = (msg) => { if (!IGNORE.test(msg)) errors.push(msg); };
  vc.on('jsdomError', (e) => record('jsdomError: ' + (e.detail?.stack || e.message)));
  vc.on('error', (...a) => record('console.error: ' + a.join(' ')));

  const dom = new JSDOM(pageHtml, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
    virtualConsole: vc,
  });
  const { window } = dom;
  BOOTED.push(window);

  // A recording stand-in for Web Audio. jsdom has none, and the ambience engine
  // builds a real node graph, so this is what proves the graph is wired without
  // errors and that stopping actually tears everything down.
  const audioLog = { contexts: [], sources: 0, oscillators: 0, limiters: 0, live: () => audioLog.nodes.filter((n) => n.playing).length, nodes: [] };
  const mkParam = (v) => ({
    value: v,
    setValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    setTargetAtTime() { return this; },
    cancelScheduledValues() { return this; },
  });
  const mkNode = (kind) => {
    const n = { kind, connect(d) { n.out = d; return d; }, disconnect() { n.gone = true; } };
    return n;
  };
  const mkPlayable = (kind) => {
    const n = mkNode(kind);
    audioLog.nodes.push(n);
    n.start = () => { n.playing = true; };
    n.stop = () => { n.playing = false; };
    return n;
  };
  window.AudioContext = class {
    constructor() {
      this.sampleRate = 44100; this.currentTime = 0; this.state = 'running';
      this.destination = mkNode('destination');
      audioLog.contexts.push(this);
    }
    resume() {}
    createBuffer(_ch, len) { return { length: len, getChannelData: () => new Float32Array(len) }; }
    createBufferSource() { audioLog.sources++; const n = mkPlayable('source'); n.loop = false; n.buffer = null; return n; }
    createBiquadFilter() { const n = mkNode('filter'); n.type = ''; n.frequency = mkParam(0); n.Q = mkParam(0); return n; }
    createGain() { const n = mkNode('gain'); n.gain = mkParam(0); return n; }
    createOscillator() { audioLog.oscillators++; const n = mkPlayable('osc'); n.type = ''; n.frequency = mkParam(0); return n; }
    createDynamicsCompressor() {
      audioLog.limiters++;
      const n = mkNode('compressor');
      n.threshold = mkParam(-24); n.knee = mkParam(30); n.ratio = mkParam(12);
      n.attack = mkParam(0.003); n.release = mkParam(0.25);
      return n;
    }
  };
  window.__audioLog = audioLog;

  // jsdom has no media playback, so record the calls instead. This is what lets
  // us check the right file gets loaded and that stopping actually pauses.
  const media = { plays: [], pauses: 0, loads: 0 };
  // `paused` is getter-only in jsdom, so back it with our own field
  Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get() { return this.__paused !== false; },
  });
  window.HTMLMediaElement.prototype.play = function () { media.plays.push(this.src); this.__paused = false; return Promise.resolve(); };
  window.HTMLMediaElement.prototype.pause = function () { media.pauses++; this.__paused = true; };
  window.HTMLMediaElement.prototype.load = function () { media.loads++; };
  window.__media = media;

  // A fake PeerJS. Instances registered here can find each other, so two windows
  // can genuinely talk — no network, but the real protocol runs end to end.
  window.Peer = function FakePeer(id, _opts) {
    const self = this;
    const handlers = {};
    self.id = id || 'anon-' + Math.random().toString(36).slice(2, 9);
    self._win = window;                 // which window this peer lives in; see `gone`
    self.destroyed = false;
    self.on = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); return self; };
    self._emit = (ev, ...a) => (handlers[ev] || []).forEach((f) => f(...a));
    self.destroy = () => { self.destroyed = true; delete FAKE_NET[self.id]; };
    self._conns = [];
    self._mkConn = (to) => mkConn(self.id, to);

    self.connect = (target, opts) => {
      const conn = mkConn(self.id, target);
      conn.metadata = (opts && opts.metadata) || null;
      const remote = FAKE_NET[target];
      setTimeout(() => {
        if (!remote || (remote._win && remote._win.closed)) {
          conn._emit('error', new Error('peer-unavailable'));
          return;
        }
        // The remote's end has to be built by the remote, not by us: each
        // connection object closes over the window that owns it, and a test
        // that silences one device must not silence the other.
        const back = remote._mkConn(self.id);
        // real PeerJS hands the initiator's metadata to the receiving side, which
        // is how an online check — or a mail delivery — identifies itself
        back.metadata = conn.metadata;
        conn._peerConn = back; back._peerConn = conn;
        remote._emit('connection', back);
        setTimeout(() => { back._emit('open'); conn._emit('open'); }, 0);
      }, 0);
      return conn;
    };

    if (FAKE_NET[self.id]) {
      setTimeout(() => self._emit('error', Object.assign(new Error('taken'), { type: 'unavailable-id' })), 0);
    } else {
      FAKE_NET[self.id] = self;
      setTimeout(() => self._emit('open', self.id), 0);
    }

    /* A window a test has closed keeps nothing running of its own, but the
       sockets pointed at it still hold timers. Delivering to one is not a
       failure worth reporting — it is a message to somebody who has left. */
    const gone = (conn) => !conn || (conn._win && conn._win.closed);

    function mkConn(from, to) {
      const h = {};
      const c = {
        /* **Which window this end belongs to.** A test can close a window and
           leave its sockets holding deferred timers; delivering into one of
           those runs the app's own code against a `document` that is gone,
           which throws on a Node timer and takes the whole run down rather
           than failing a check. See `gone` below. */
        peer: to, open: true, _owner: from, _win: window,
        on: (ev, fn) => { (h[ev] = h[ev] || []).push(fn); return c; },
        _emit: (ev, ...a) => (h[ev] || []).forEach((f) => f(...a)),
        // `__peerSilent` is how the test simulates a window that vanishes without
        // closing anything — a slept laptop, a killed tab, wifi walking away.
        send: (msg) => {
          if (window.__peerSilent) return;
          setTimeout(() => {
            if (gone(c._peerConn)) return;
            c._peerConn._emit('data', JSON.parse(JSON.stringify(msg)));
          }, 0);
        },
        /* **The local end closes synchronously, the far end on a tick.**

           Both were deferred, and that hid a real bug for a release: `syncLeave`
           closed every connection and only afterwards set `mode = 'off'`, so a
           `close` handler that ran *during* the loop still saw a live room,
           decided the host had vanished, and dialled straight back in. Pressing
           Leave did nothing you could see. PeerJS fires the local `close`
           there and then; a stub that always defers is a stub that cannot
           express the ordering the app has to survive.

           The far end stays deferred, because that one really does arrive over
           a network. */
        close: () => {
          c.open = false;
          c._emit('close');
          setTimeout(() => { if (!gone(c._peerConn)) c._peerConn._emit('close'); }, 0);
        },
      };
      /* Kept so a test can reach a specific socket rather than only the app's
         idea of one. The reconnection case needs to close *the old* connection
         after a new one has replaced it, which is not something the app's own
         state can be asked for — by then it only knows about the new one. */
      self._conns.push(c);
      return c;
    }
  };

  // jsdom has no PointerEvent, and the games are built entirely on pointer
  // events now (a captured touch never reliably produces a click). MouseEvent
  // carries the coordinates and bubbling we need; the pointer fields are added.
  if (!window.PointerEvent) {
    window.PointerEvent = class PointerEvent extends window.MouseEvent {
      constructor(type, init = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'mouse';
        this.isPrimary = init.isPrimary ?? true;
      }
    };
  }
  window.Element.prototype.setPointerCapture = function () {};
  window.Element.prototype.releasePointerCapture = function () {};

  /* The app talks to the mailbox with `fetch`. Point it at the shared fake so
     both windows see one server, and count the calls — "did it prefer the peer
     path" is only answerable by looking at whether the server was used at all. */
  window.__fetched = [];
  window.fetch = async (url, opts = {}) => {
    window.__fetched.push(String(url));
    /* The update check is a GET of a static file, so it gets answered here
       rather than by the mailbox stub. `UPDATE_REPLY` is what the file says
       today; null means the request fails, which is the offline case. */
    if (/latest\.json/.test(String(url))) {
      if (!UPDATE_REPLY) throw new Error('offline');
      return { ok: true, status: 200, async json() { return UPDATE_REPLY; } };
    }
    const path = new URL(String(url), 'https://mail.test').pathname;
    let body = {};
    try { body = JSON.parse(opts.body || '{}'); } catch {}
    const out = fakeMailbox(path, body);
    return { ok: true, status: 200, async json() { return out; } };
  };

  window.navigator.vibrate = () => true;
  window.URL.createObjectURL = () => 'blob:stub';
  window.URL.revokeObjectURL = () => {};

  return { window, errors };
}

/** What a configured update host is saying, for the block near the end. */
let UPDATE_REPLY = null;

/* Tiles are picked up with pointer events now, not clicks — a captured touch
   sequence does not reliably produce a click, which is why tapping worked with a
   mouse and did nothing on a phone. The test drives the same path a finger does. */
const tapEl = async (w, el) => {
  const r = { clientX: 10, clientY: 10, bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true };
  el.dispatchEvent(new w.PointerEvent('pointerdown', r));
  el.dispatchEvent(new w.PointerEvent('pointerup', r));
  await wait(10);
};

const openGame = async (w, $w, id) => {
  $w('arcade-open').click();
  await wait(60);
  [...w.document.querySelectorAll('.pcard')].find((c) => c.dataset.game === id).click();
  await wait(120);
};

// `hide` is not a global rule in this app — every component declares its own
// `.thing.hide{display:none}`. Checking the class alone would have missed the
// chooser sitting over Scrabble, so these check what is actually painted.
const shown = (w, id) => w.getComputedStyle(w.document.getElementById(id)).display !== 'none';

/* Leaving a room asks first now (see #sync-leave in 13-sync-overlay.html).
   Tests that only want to be out of the room go through here; the block that
   is actually testing the confirmation does it by hand. */
const leaveRoom = async ($w, how) => {
  $w('sync-leave').click();
  await wait(40);
  // A host with company is offered a menu rather than a yes/no: hand it on, or
  // close it. Tests that just want out take the closing option.
  const menu = $w('hmenu');
  if (menu && !menu.classList.contains('hide')) {
    const items = [...$w('hmenu-card').querySelectorAll('[data-i]')];
    (how === 'hand' ? items[0] : items[items.length - 1]).click();
    await wait(40);
  }
  const c = $w('confirm');
  if (c && !c.classList.contains('hide')) $w('confirm-yes').click();
  await wait(80);
};

/* Moved up out of the stats block so both halves of a split solo pass can
   seed a history: `tools/slice-test.mjs` boots the second half straight
   from this rather than replaying the first half's session to get one.
   Depends on nothing but Date, which is why it can live up here. */
const DAY = 86400000;
const pad2 = (n) => String(n).padStart(2, '0');
const key = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
// Anchored to midday so the two sessions per day can't spill into the day before
// when the suite happens to run near midnight — that made the streak flaky.
const seedLog = [0, 1, 2, 5].flatMap((back, i) =>
  [0, 1].map((n) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - back);
    const ts = d.getTime() + n * 3600000;
    // some entries carry notes, so the calendar's note markers have something to find
    return { id: 's' + ts + '_' + i + n, ts, day: key(ts), secs: 1500, note: n === 0 ? `worked on thing ${i}` : '' };
  }),
);

// ===========================================================================
// Pass 1 — a fresh install, no history
// ===========================================================================
/* A modest balance to start with, because embers are paid by the minute now and
   a test cannot sit through ten of them. Nothing is owned. */
/* **A purse that can reach the top shelf.** The lights, the tracks and the
   clock faces were priced when they were the only things in the shop; against
   a wardrobe where a coat is eighty they were the change in the bottom of the
   bag, and they roughly doubled. Nobody already holding one paid the
   difference — see EMB_WAS and `grand` in 37-embers.js, and the check for it
   further down — but a test that wants to press Buy has to be able to. */
/* **A door into the closure, spliced at the *last* `})();` in the file.**

   The app is one IIFE, so a test cannot reach `Chat` or `Sudoku` or the friend
   machinery from outside. Putting a handful of names on `window` just before
   the closing line is the same trick the `look-*` tools use and costs the
   shipped build nothing — but it has to be the *last* one. `String.replace`
   with a string pattern takes the first match, and the first `})();` in the
   bundle is inside the ambience wiring, two thirds of the way up: a door
   spliced there names `const`s that are still in their temporal dead zone, the
   IIFE throws, and every check after it fails for a reason that looks nothing
   like the cause. */
function withDoor(src, code){
  const at = src.lastIndexOf('})();');
  if (at < 0) throw new Error('no closing IIFE to splice a door into');
  return src.slice(0, at) + '\n' + code + '\n' + src.slice(at);
}

const { window, errors } = boot(withDoor(html, 'window.__m = {Cross, DCal, DAILY, pktNow, dailyGet, Tetris, Sudoku,'
  + ' crossOnDay, crossAtSize, crossRows, CROSS_GRIDS, crossReleases, crossLatestDay, smLineup,'
  + ' shelfTotal: () => EMB_LIGHTS.reduce((n, l) => n + l.cost, 0)'
  + '   + EMB_SOUNDS.reduce((n, x) => n + x.cost, 0) + FACES.reduce((n, f) => n + f.cost, 0)'
  + '   + Object.keys(BUD_COST).reduce((n, k) => n + BUD_COST[k].reduce((m, c) => m + c, 0), 0),'
  + ' arcade: {writeGame, readGame}, kv: KV,'
  + ' gamesAdopt, gamesSnapshot, reportSend,'
  + ' dialogs: {askConfirm, closeConfirm}, arcadeReset: arcadeResetItems,'
  + ' wordleArt: (r) => dailyDef("wordle").art(r),'
  + ' shelfPrices: () => ({looks: embByPrice(EMB_LIGHTS), sounds: embByPrice(EMB_SOUNDS),'
  + '   faces: embByPrice(FACES)}),'
  + ' wardrobePrices: () => Object.fromEntries(BUD_ROWS.map(r => [r.name,'
  + '   [...Array(r.list().length).keys()].slice(1)'
  + '     .sort((a, b) => (budCost(r.id, a) - budCost(r.id, b)) || (a - b))'
  + '     .map(i => budCost(r.id, i))])),'
  + ' budRows: () => BUD_ROWS.map(r => { const L = r.list(), c = BUD_COST[r.id] || [];'
  + '   return {name: r.name, parts: L.length, costs: c.length,'
  + '     zeros: L.map((p, i) => i && !c[i] ? (p.n || i) : 0).filter(Boolean)}; }),'
  + ' budDyed: () => BUD_OUTER.filter(p => p.dye).map(p => p.n),'
  + ' startTimer: start, pauseTimer: pause, Cal, moodOf, moodAsk,'
  + ' today: () => dayKey(Date.now())};'), {
  focus_embers: JSON.stringify({ have: 600, earned: 600, own: ['seaglass'], light: 'seaglass' }),
});
const $ = (id) => window.document.getElementById(id);
const click = (id) => { const el = $(id); if (!el) throw new Error(`#${id} missing`); el.click(); };

/* ---- asking the built stylesheet what a rule says ----
   jsdom has no layout, no animation engine, and resolves neither `var()` nor
   `color-mix()` — so "is it round", "is it glowing" and "did it move" are all
   unanswerable. What it does have is the parsed CSSOM, so the question becomes
   what the rule *declares*, which is the thing an edit breaks anyway.

   Two traps in the walk, both of which silently return nothing rather than
   failing: a `CSSRuleList` is array-like and **not iterable**, so `for...of`
   throws; and a plain style rule carries an empty but **truthy** `cssRules`,
   so testing that branch first walks past every rule in the sheet. */
const CSS_RULES = (() => {
  const out = [];
  const walk = (list) => {
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.selectorText) out.push(r);
      else if (r.cssRules) walk(r.cssRules);
    }
  };
  for (const sheet of window.document.styleSheets) {
    try { walk(sheet.cssRules); } catch (e) { /* not ours to read */ }
  }
  return out;
})();
/** Every declaration block written against exactly this selector, in order. */
const cssOf = (sel) => CSS_RULES.filter((r) => r.selectorText === sel).map((r) => r.style);
/** The stops of a named @keyframes, as `{key, style}`. */
const keyframesOf = (name) => {
  for (const sheet of window.document.styleSheets) {
    let list = [];
    try { list = sheet.cssRules; } catch (e) { continue; }
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (r.name !== name || !r.cssRules) continue;
      const out = [];
      for (let k = 0; k < r.cssRules.length; k++) out.push({ key: r.cssRules[k].keyText, style: r.cssRules[k].style });
      return out;
    }
  }
  return [];
};

await wait(400);

for (const id of ['setup', 'timer', 'overlay', 'quotes-overlay', 'cal-overlay', 'stats-overlay', 'drawer']) {
  check(`#${id} present`, !!$(id));
}
check('presets rendered', $('f-presets').children.length > 0);

/* **No comment has leaked into the page.** One `<!--` lost its opening two
   characters during an edit and the whole note under it — several paragraphs
   about Spider-Man's corner webs — rendered as body text on every screen. The
   giveaway is the closing `-->`, which is only ever text when no comment was
   open to be closed by it, so that is what is checked; the count of openers
   against closers catches the same thing in the file itself. */
{
  const shown = window.document.body.textContent || '';
  check('no comment has leaked into the page', shown.indexOf('-->') < 0,
    shown.slice(Math.max(0, shown.indexOf('-->') - 60), shown.indexOf('-->') + 4));
  const opens = (html.match(/<!--/g) || []).length;
  const closes = (html.match(/-->/g) || []).length;
  check('and every comment in the build is opened and closed', opens === closes,
    `${opens} opened, ${closes} closed`);
}

/* The top bar carries the date now, not a tally of sessions. */
{
  const want = new Date().toLocaleDateString(undefined, {weekday:'short', day:'numeric', month:'short'});
  check('the top bar shows today\'s date', $('today-date').textContent === want,
    `${$('today-date').textContent} vs ${want}`);
  check('and no session count', !$('today-count'));
  /* Whether there is a sign-in button depends on `.env.release`, which is a
     local file and not something a test may assume the shape of — asserting the
     shipped state here meant the suite went red the day accounts were actually
     turned on, which is the one day it needed to be trusted.

     So the expectation is read from the build, and what is checked is the rule
     rather than the state: the button exists exactly when there is somewhere to
     sign in to, and the corner holds one thing either way. */
  const configured = /ACC_URL = 'https?:/.test(html);
  check(configured
    ? 'there is a sign-in button, because this build has a server'
    : 'no sign-in button without a server to sign in to',
  $('acc-chip').classList.contains('hide') === !configured);
  check('and the corner holds exactly one of the button and the date',
    $('acc-chip').classList.contains('hide') !== $('today-wrap').classList.contains('hide'));
}
/* **Two `@keyframes` with one name is silent and lethal.** The later block wins
   for every element using that name, so an animation elsewhere quietly does a
   different job. `bud-lift` was both the main menu's hand raise and the swing's
   vertical rise; because both drive `transform`, the perch's version overrode
   the swing's travel on the same element and the buddy swung on the spot for
   several rounds of "why is he not moving". Nothing warns you — the CSS parses,
   both rules exist, and one simply shadows the other. */
check('no two @keyframes share a name', (() => {
  const css = [...window.document.querySelectorAll('style')].map((n) => n.textContent).join('\n');
  const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  const seen = new Set(), dupes = new Set();
  for (const n of names) { if (seen.has(n)) dupes.add(n); seen.add(n); }
  return dupes.size === 0 ? true : [...dupes].join(', ');
})() === true, (() => {
  const css = [...window.document.querySelectorAll('style')].map((n) => n.textContent).join('\n');
  const names = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
  const seen = new Set(), dupes = new Set();
  for (const n of names) { if (seen.has(n)) dupes.add(n); seen.add(n); }
  return [...dupes].join(', ');
})());

/* ---- switching size, and coming back --------------------------------------

   "Open on today" was right for arriving at the shelf and wrong for the
   difficulty buttons: those went to today's edition too, so half a Tuesday
   hard, a look at easy and back, and hard was today's empty grid with the clock
   at zero. The board was never deleted — it sat on its own shelf under its own
   day — but nothing could reach it again, which from a chair is the same thing.
   Both games remember where you were per size or difficulty now. */
{
  const C = window.__m.Cross, now = window.__m.pktNow();
  const back = () => [C.size, C.day, C.user.filter(Boolean).length, C.elapsed].join('/');
  const older = window.__m.crossOnDay(7, '2026-09-03');
  C._chose = true;
  C.load(older.i, '2026-09-03');
  C.select(0); ['A', 'B', 'C'].forEach((ch) => C.type(ch));
  C.elapsed = 321; C.persist();
  const was = back();
  C.setSize(15);
  /* The newest fifteen, which is the most recent Sunday and only *is* today one
     day in seven — asserting `=== today` made this pass on the day it was
     written and fail every other. What matters is that it moved off the 7x7 and
     brought nothing with it. */
  check('switching size leaves the older grid alone',
    C.size === 15 && C.day !== '2026-09-03' && C.user.filter(Boolean).length === 0, back());
  C.setSize(7);
  check('and switching back hands it over with its letters and its clock',
    back() === was, back() + ' vs ' + was);
  C.enter();
  check('coming in from the shelf does not undo that choice',
    back() === was, back() + ' vs ' + was);
  /* Put it back on today's 7x7: the checks further down expect a fresh board,
     and this block has deliberately left it somewhere else. */
  C._chose = false; C.seen = {};
  C.load(window.__m.crossOnDay(7, now).i, now);
}
{
  /* A `done` flag carried onto a grid the record did not come from opens the
     board full of letters, under the win banner, refusing every key — read as
     the game being broken, not as a stale save. Two thirds of letters agreeing
     is the right test for keeping the work and much too weak for the flag. */
  const C = window.__m.Cross;
  const g = window.__m.CROSS_GRIDS[window.__m.crossAtSize(15)[0]];
  const sol = window.__m.crossRows(g).join('').toUpperCase();
  const near = sol.replace(/#/g, '.').split('');
  for (let i = 0, n = 0; i < near.length && n < 3; i++) {
    if (near[i] !== '.') { near[i] = near[i] === 'A' ? 'B' : 'A'; n++; }
  }
  const p = {}; p[String(window.__m.crossAtSize(15)[0])] = { u: near.join(''), secs: 800, done: true };
  const out = C._migrate(p);
  const rec = out[Object.keys(out)[0]];
  check('a migrated record that is not actually solved loses the flag',
    !!rec && !rec.done, JSON.stringify(rec && { done: rec.done, secs: rec.secs }));
  check('but keeps the work it carried',
    !!rec && rec.secs === 800 && rec.u.length === near.length);
  const exact = {}; exact[String(window.__m.crossAtSize(15)[0])] = { u: sol.replace(/#/g, '.'), secs: 800, done: true };
  const kept = C._migrate(exact);
  check('and one that really is solved keeps it',
    !!kept[Object.keys(kept)[0]].done);
}
{
  const S = window.__m.Sudoku;
  S.build();                       // render() needs the cells it makes
  S.newGame('hard', true, '2026-09-02');
  S.sel = S.given.indexOf(false); S.input(5); S.elapsed = 200; S.persist();
  const was = [S.diff, S.day, S.elapsed, S.grid.filter(Boolean).length].join('/');
  S.newGame('easy');
  check('a difficulty button does not drag the other grid to today',
    S.diff === 'easy' && S.day === window.__m.pktNow(), S.diff + '/' + S.day);
  S.newGame('hard');
  check('and going back to a difficulty returns the grid and the clock',
    [S.diff, S.day, S.elapsed, S.grid.filter(Boolean).length].join('/') === was,
    [S.diff, S.day, S.elapsed].join('/') + ' vs ' + was);
  S._chose = false; S.seen = {};
  S.newGame('medium', true, window.__m.pktNow());
}

/* ---- a board that is not a puzzle, and a button that does nothing ---------

   Two silent failures, reported as "why is this happening" and "it keeps
   stopping working". A shelf entry is handed straight to the player, so one bad
   write is a grid with no clues in it and no way back; and `load` returned
   quietly when its index was not in the bank, so a size button could leave the
   old puzzle on screen and say nothing. Both now refuse rather than hand over.
   Seventeen clues is the real floor for a sudoku — no grid with fewer has one
   answer — so anything under it is a corrupt save, not a hard one. */
{
  const S = window.__m.Sudoku, now = window.__m.pktNow();
  S.newGame('easy', true, now);
  const slot = now + '|easy';
  const good = S.boards[slot];
  check('a real board is kept', !!good && S._sane(good),
    good ? String(good.given.filter(Boolean).length) + ' clues' : 'nothing on the shelf');
  S.boards[slot] = { grid: new Array(81).fill(0), sol: good.sol.slice(),
    given: new Array(81).fill(false), notes: [], elapsed: 0, done: false };
  S.day = ''; S.diff = '';
  check('a board with no clues is refused', S._take(now, 'easy') === false);
  check('and dropped, so it is not found again', !S.boards[slot],
    Object.keys(S.boards).join(', '));
  S.newGame('easy', true, now);
  check('and the day comes back as a real puzzle',
    S.given.filter(Boolean).length >= 17, String(S.given.filter(Boolean).length));
}
{
  const C = window.__m.Cross;
  check('loading a puzzle that is not in the bank says so',
    C.load(999999, '') === false);
  const before = [C.size, C.idx].join('/');
  C.setSize(C.size === 5 ? 7 : 5);
  check('and a size button always lands somewhere',
    [C.size, C.idx].join('/') !== before && !!C.puz, [C.size, C.idx].join('/'));
  C.seen = {}; C._chose = false;
}
{
  /* The button people actually press is New, not the reset buried in the hold
     menu, so New is the one that stops the board and asks. */
  const T = window.__m.Tetris;
  T.newGame(); T.paused = false; T.score = 120;
  window.document.getElementById('tet-new').click();   // the button, not the method
  check('New stops the board before asking', T.paused === true, String(T.paused));
  check('and it does ask',
    !window.document.getElementById('confirm').classList.contains('hide'));
  window.__m.dialogs.closeConfirm();
  T.newGame(); T.paused = false; T.score = 0; T.lines = 0;
  T.grid = T.grid.map(() => '');
  window.document.getElementById('tet-new').click();
  check('but an untouched board is not worth a question',
    window.document.getElementById('confirm').classList.contains('hide'));
}

/* ---- the dialog's third button, and the shelf's order ---------------------

   There is no global `.hide{display:none}` in this app on purpose; the price is
   that a component which hides its own things has to *have* the rule. This one
   did not, so `askConfirm` toggled `hide` on `#confirm-alt` and nothing
   listened: every two-answer dialog carried a blank pill beside Cancel. An
   empty button reads as a control whose label failed to load, and people press
   it to find out what it does. */
{
  const D = window.__m.dialogs;
  D.askConfirm('Buy the thing?', 'Two answers, not three.', 'Spend 52', () => {});
  const alt = window.document.getElementById('confirm-alt');
  check('a two-answer dialog shows two buttons',
    window.getComputedStyle(alt).display === 'none',
    window.getComputedStyle(alt).display);
  D.askConfirm('Three ways out?', '', 'Save', () => {},
    { alt: { label: 'Discard', run: () => {} } });
  check('and a three-answer one shows the third, with a label on it',
    window.getComputedStyle(alt).display !== 'none' && alt.textContent === 'Discard',
    window.getComputedStyle(alt).display + ' "' + alt.textContent + '"');
  D.closeConfirm();
}
{
  /* Cheapest first on every shelf. List order is the order the drawings were
     written in, which is no order at all to the person paying. */
  const shelves = window.__m.shelfPrices();
  for (const [name, list] of Object.entries(shelves)) {
    const costs = list.map((x) => x.cost || 0);
    check(`the ${name} shelf runs cheapest first`,
      list.length > 1 && costs.every((c, i) => i === 0 || costs[i - 1] <= c),
      costs.join(', '));
    check(`and nothing fell off the ${name} shelf on the way`,
      list.length === shelves[name].length && new Set(list.map((x) => x.id)).size === list.length);
  }
  const rows = window.__m.wardrobePrices();
  for (const [name, costs] of Object.entries(rows)) {
    check(`the ${name.toLowerCase()} row runs cheapest first`,
      costs.every((c, i) => i === 0 || costs[i - 1] <= c), costs.join(', '));
  }
}
{
  /* Six rows whatever happened. Stopping where the word was found made a lucky
     first guess draw one row and a six-guess grind draw six, and on a calendar
     the eye compares heights before it reads anything. */
  const art = window.__m.wordleArt;
  const rows = (p) => (art({ s: 2, p }).match(/wdl-art-row/g) || []).length;
  check('a word found in one still draws six rows', rows('ggggg') === 6, String(rows('ggggg')));
  check('and the spare ones are marked as spare',
    (art({ s: 2, p: 'ggggg' }).match(/spare/g) || []).length === 5,
    art({ s: 2, p: 'ggggg' }));
  check('a six-guess game draws six and no more',
    rows('xxxxx'.repeat(5) + 'ggggg') === 6, String(rows('xxxxx'.repeat(5) + 'ggggg')));
}
{
  /* A confirm over a running game asks you to decide while the thing you are
     deciding about carries on happening. */
  const T = window.__m.Tetris;
  T.newGame(); T.paused = false;
  window.__m.arcadeReset('tetris').forEach((it) => it.run());
  check('asking to reset Tetris stops the board first', T.paused === true, String(T.paused));
  window.__m.dialogs.closeConfirm();
}

/* ---- everything on the shelf has a price --------------------------------

   `BUD_COST` is one row per part list, in the same order, and the two are kept
   apart on purpose so an art change never touches the economy. The cost of that
   is exactly this: five hairstyles shipped with the list eleven long and the
   price row six, so the last five showed a bare `0` in the shop — an option
   that reads as broken rather than as free. Index 0 is "none" and is free in
   every row; everything after it has to cost something. */
{
  const rows = window.__m.budRows();
  for (const r of rows) {
    check(`every ${r.name.toLowerCase()} has a price`,
      r.costs === r.parts && r.zeros.length === 0,
      `${r.parts} parts, ${r.costs} prices, unpriced: ${r.zeros.join(', ') || 'none'}`);
  }
}

/* A coat whose colour is half of what it is does not get a colour dial: a lab
   coat in magenta and denim in lime are not that coat any more. The wardrobe
   reads `dye` off the part, so this is the whole of the rule. */
{
  const dyed = window.__m.budDyed();
  const fixed = ['Denim jacket', 'Lab coat', 'Blazer', 'Dungarees', 'Hi-vis vest'];
  check('the coats that are a uniform take no colour',
    fixed.every((n) => dyed.indexOf(n) < 0), dyed.join(', '));
  check('and the ones that are just a shape still do',
    ['Cape', 'Puffer', 'Cardigan', 'Poncho'].every((n) => dyed.indexOf(n) >= 0),
    dyed.join(', '));
}

/* ---- a puzzle put down, and picked up again -------------------------------

   Two rules that both look like nothing and both went wrong once. A red cross
   belongs to one square: clearing the whole of `wrong` on any keypress wiped
   every other mark the moment you touched anything. And the shelf opens on
   today: waiting for a board to be *finished* before moving on meant one
   abandoned in April was still the front door in September. */
{
  const S = window.__m.Sudoku, now = window.__m.pktNow();
  S.grid = new Array(81).fill(0);
  S.sol = new Array(81).fill(0).map((v, i) => (i % 9) + 1);
  S.given = new Array(81).fill(false);
  S.notes = new Array(81).fill(0).map(() => []);
  S.shown = []; S.done = false; S.day = now; S.diff = 'medium';
  S.build();                       // render() needs the cells it makes
  S.wrong = [0, 1, 2];
  S.sel = 1; S.input(9);
  check('answering a square clears its own red cross',
    S.wrong && S.wrong.join(',') === '0,2', JSON.stringify(S.wrong));
  S.sel = 0; S.erase();
  check('and erasing one clears that square\u2019s',
    S.wrong && S.wrong.join(',') === '2', JSON.stringify(S.wrong));
  S.sel = 2; S.reveal();
  check('Reveal fills the square in from the solution',
    S.grid[2] === S.sol[2], S.grid[2] + ' vs ' + S.sol[2]);
  check('marks it as given rather than typed',
    S.shown.indexOf(2) >= 0 && S.wrong === null, JSON.stringify([S.shown, S.wrong]));
  const before = S.grid[2];
  S.sel = 2; S.input(4); S.erase();
  check('and a revealed square cannot be typed over',
    S.grid[2] === before, S.grid[2] + ' vs ' + before);
}
{
  /* An old day left open, nobody having chosen it: coming back is today. The
     grid has to be a real one — the shelf refuses anything that is not a
     puzzle now, and a hand-made board of eighty-one blanks is not one. */
  const S = window.__m.Sudoku, now = window.__m.pktNow();
  S.boards = {}; S._chose = true;
  S.newGame('medium', true, '2026-01-02');
  S.done = false; S._chose = false;
  S.enter();
  check('the shelf opens on today, not on an abandoned grid',
    S.day === now, S.day + ' vs ' + now);
  check('and the abandoned one is kept, not thrown away',
    !!S.boards['2026-01-02|' + S.diff], Object.keys(S.boards).join(', '));
  S.day = '2026-01-02'; S._chose = true;
  S.enter();
  check('but a day chosen by hand stays put for the run',
    S.day === '2026-01-02', S.day);
}

/* ---- the tide tiles exactly ----------------------------------------------

   Each wave layer is one tiled SVG travelling exactly one tile per cycle, so
   the last frame of the animation is the first and the field never jumps. The
   distance lives in a `@keyframes` and the tile height lives in a
   `background-size`, several dozen lines apart, and nothing connects them: edit
   one and the sea twitches once every cycle, which is easy to see and very hard
   to attribute. Three layers, and a middle one that has gone missing before. */
{
  const css = [...window.document.querySelectorAll('style')].map((n) => n.textContent).join('\n');
  const tileOf = (cls) => {
    const m = css.match(new RegExp('\\.beach-wave-' + cls + '\\{[^}]*background-size:[^;]*?\\s([\\d.]+)px'));
    return m ? Number(m[1]) : null;
  };
  const travelOf = (cls) => {
    const m = css.match(new RegExp('@keyframes beach-tide-' + cls + '\\{[^}]*translateY\\(-([\\d.]+)px\\)'));
    return m ? Number(m[1]) : null;
  };
  for (const cls of ['near', 'mid', 'far']) {
    const tile = tileOf(cls), travel = travelOf(cls);
    check(`the ${cls} wave travels exactly one tile`,
      tile !== null && tile === travel, `tile ${tile}, travel ${travel}`);
  }
  check('and all three layers are actually in the page',
    ['far', 'mid', 'near'].every((c) => !!window.document.querySelector('.beach-wave-' + c)),
    [...window.document.querySelectorAll('.beach-wave')].map((n) => n.className).join(' | '));
}

/* ---- the swing, as three invariants --------------------------------------

   These are geometry, not appearance, and every one of them has been wrong at
   least once in a way that looked like something else entirely. */
{
  const css = [...window.document.querySelectorAll('style')].map((n) => n.textContent).join('\n');
  /* Walk the braces. Slicing to the first `}` stops at the end of the *first*
     step, which reads as a block with one keyframe in it — and a one-keyframe
     block passes a "these all agree" check vacuously. */
  const frames = (name) => {
    const at = css.indexOf('@keyframes ' + name + '{');
    if (at < 0) return null;
    let i = css.indexOf('{', at), depth = 0, end = i;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) { end = i; break; }
    }
    const out = {};
    for (const m of css.slice(at, end).matchAll(/([\d.]+)%[^{]*\{[^}]*?(-?[\d.]+)deg/g)) {
      out[m[1]] = Number(m[2]);
    }
    return out;
  };
  const arc = frames('bud-arc'), aim = frames('bud-web-aim');

  /* **The thrown web must not turn with him.** It hangs off the rig, so the rig
     turns it; `bud-web-aim` cancels that during the throw by being the arc's
     angle negated. The leftover is the forward lean, and it has to be the
     *same* leftover at both ends of the throw — if it varies, the web sweeps
     round like a searchlight instead of standing still in the sky while he
     passes under it.

     The ropes run on two swings and the rig on one, so the throw's 76% and 88%
     land on the arc's 52% and 76%. That mapping is the thing to re-derive if
     either duration changes. */
  check('the thrown web cancels the rig exactly', (() => {
    if (!arc || !aim) return 'a keyframe block is missing';
    for (const [ropeAt, arcAt] of [['76.01', '52'], ['88', '76']]) {
      if (!(arcAt in arc)) return 'bud-arc has no ' + arcAt + '% step';
      if (!(ropeAt in aim)) return 'bud-web-aim has no ' + ropeAt + '% step';
    }
    const lean = [['76.01', '52'], ['88', '76']].map(([r, a]) => aim[r] + arc[a]);
    return lean[0] === lean[1] ? true : 'lean differs: ' + lean.join(' vs ');
  })() === true, 'see bud-web-aim');

  /* **He lets go at the front, not the back.** The rig pivots at its top and
     rotation is clockwise-positive, so a negative angle is *ahead* of the
     anchor. 76% of a swing is where he releases; the arc has to be at its
     forward extreme there. It was positive — swinging backwards under his own
     web — for every build the user ever saw. */
  check('the swing reaches the front exactly where he lets go',
    !!arc && arc['76'] < 0 && arc['0'] > 0, arc ? `0%:${arc['0']} 76%:${arc['76']}` : 'no bud-arc');

  /* **The web he throws must be the web he lands on.** The two ropes are one
     animation offset by a swing; if they ever stop being identical, one of them
     is doing half the job again and you get the version he complained about —
     a second web fired and then ignored. The delay is the only difference
     allowed, and it must be negative, or the second rope waits a whole swing
     before starting rather than being already underway. */
  check('the two webs are one animation, a swing apart', (() => {
    if (!/\.bud-rope\{[^}]*animation:bud-web /.test(css)) return 'the shared rule is gone';
    const b = css.match(/\.bud-rope-b\{([^}]*)\}/);
    if (!b) return 'no .bud-rope-b rule';
    if (/animation:/.test(b[1])) return 'b has its own animation, not a delay';
    return /animation-delay:\s*-/.test(b[1]) ? true : 'delay is not negative: ' + b[1].trim();
  })() === true, 'see .bud-rope / .bud-rope-b');

  /* **The lap has to end where it started.** It used to run off to one side and
     `bud-round` faded him out to cover the jump back — so he vanished at the end
     of every lap. Out and back means the last keyframe is the first one and
     nothing needs hiding. Nothing may fade him again. */
  check('the lap closes on itself instead of fading him out', (() => {
    const go = css.match(/@keyframes bud-go\{([\s\S]*?)\n\}/);
    if (!go) return 'no bud-go';
    const first = go[1].match(/0%[^{]*\{\s*transform:translate\(([^,]+),/);
    const last = go[1].match(/\n\s*100%[^{]*\{\s*transform:translate\(([^,]+),/);
    if (!first || !last) return 'could not read the ends';
    if (first[1].trim() !== last[1].trim()) return `0% is ${first[1]} but 100% is ${last[1]}`;
    /* The *declaration*, not the word — the note above `bud-go` explains why
       the fade was removed and names it, and matching prose made this fail on
       its own documentation. */
    return /@keyframes\s+bud-round|animation:[^;]*bud-round/.test(css)
      ? 'bud-round is back' : true;
  })() === true, 'see bud-go');

  /* **The step across must out-run the pendulum, or he stutters backwards.**

     Two things move him and they fight during every flight. `bud-go` carries
     him forward; the rig, swinging from the front of one arc to the back of the
     next, carries him backwards by `2·sin(A)·rope`. If the forward step is not
     comfortably larger he crawls, and if `bud-go` is eased — near-zero velocity
     at both ends of each segment — the rig wins outright at the head and tail
     of every flight and he visibly slides back before being yanked on. That was
     the "jitters while switching webs", twice a flight, six flights a lap.

     Compared in bare numbers on purpose: in a portrait window `vmin` is the
     width, so `1vw` and `1vmin` are the same length and the two units are
     directly comparable. That is the worst case and the one to hold. */
  check('the step across out-runs the pendulum on every window shape', (() => {
    const rope = Number((css.match(/--rope:\s*([\d.]+)vmin/) || [])[1]);
    const go = css.match(/@keyframes bud-go\{([\s\S]*?)\n\}/);
    if (!rope || !go || !arc) return 'could not read --rope, bud-go or bud-arc';
    if (!/animation:bud-go [\d.]+s linear/.test(css)) return 'bud-go is not linear';
    const holds = [...go[1].matchAll(/%\s*\{\s*transform:translate\((-?[\d.]+)vw,\s*0\)/g)]
      .map((m) => Number(m[1]));
    if (holds.length < 4) return 'only ' + holds.length + ' resting positions';
    const step = Math.min(...holds.slice(1).map((v, i) => Math.abs(v - holds[i])));
    const amp = Math.max(...Object.values(arc).map(Math.abs));
    const sweep = 2 * Math.sin((amp * Math.PI) / 180) * rope;
    return step > sweep * 1.3
      ? true : `step ${step.toFixed(1)}vw vs sweep ${sweep.toFixed(1)}vmin`;
  })() === true, 'see bud-go');

  /* **Everything has to divide the lap.** The arc runs once a swing, a rope
     once every two, the lap is six — so 1.3, 2.6 and 7.8. If any of them stops
     dividing evenly the parts drift out of phase a little more each lap and the
     throw slowly stops arriving in his hand. */
  /* ---- everybody else in the room moves to their own clock ----

     Five people who all picked the swing on one 7.8s animation is one buddy
     drawn five times, and the repetition is the thing you notice. `--t` is a
     negative delay on each peer's slot; custom properties inherit, so one value
     shifts every animation inside that slot by the same amount.

     **Shifting all of them by the same amount is the whole trick**, and it only
     works if nothing inside escapes it. Two ways to escape: being more specific
     than the rule that applies it, or carrying a delay of your own. */
  check('a peer\u2019s whole figure is shifted by one number', (() => {
    if (!/\.bud-peer\.bud-peer[^{]*\{[^}]*animation-delay:\s*var\(--t/.test(css))
      return 'no .bud-peer desync rule';
    /* **The class is doubled on purpose and the order matters.** `.bud-peer *`
       is one class; `.bud-swim .bud-hand-r` is two, and its `animation`
       shorthand sets the delay back to zero. The doubled class ties on
       specificity, and a tie is won by whichever comes last — so every rule it
       has to beat must be above it. The poses are read out of `BUD_ANIMS`
       rather than listed, so a pose added tomorrow is covered today. */
    const rule = css.indexOf('.bud-peer.bud-peer');
    const poses = [...html.matchAll(/\{k:'([\w-]+)'/g)].map((m) => '.bud-' + m[1]);
    const late = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1], body = m[2];
      if (sel.includes('.bud-peer') || /!important/.test(body)) continue;
      if (!/animation[^;]*:/.test(body)) continue;
      if (poses.some((c) => sel.includes(c + ' ') || sel.includes(c + '{')) && m.index > rule) late.push(sel.trim());
    }
    return late.length === 0 ? true : 'below the peer rule, so it wins: ' + late.join(' | ');
  })() === true, 'see the peer block');
  /* **Anything with a delay of its own needs that delay *added* to, not
     replaced.** The second web is one swing behind the first, the second arm
     half a stroke behind the first: those are relationships, and blanking them
     turns the pair into one thing happening twice. This finds every such
     element mechanically rather than trusting a list, because the list is
     exactly what a future antic will forget to update. */
  check('and the ones with a rhythm of their own keep it', (() => {
    const bud = css.slice(css.indexOf('your buddy ----'), css.indexOf('---- account ----'));
    if (!bud) return 'could not find the buddy stylesheet';
    const flat = bud.replace(/@keyframes[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
    const missed = [];
    for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim(), body = m[2];
      if (sel.includes('.bud-peer') || sel.startsWith('@')) continue;
      if (!/animation(-delay)?:[^;]*\s-[.\d]+s/.test(body)) continue;
      const tail = sel.split(/\s+/).pop();
      if (!new RegExp('\\.bud-peer[^{]*' + tail.replace(/[.()]/g, '\\$&')).test(bud)) missed.push(sel);
    }
    return missed.length === 0 ? true : 'no peer rule for: ' + missed.join(' | ');
  })() === true, 'see the peer block');

  check('the swing, the ropes and the lap stay in phase', (() => {
    const dur = (re) => Number((css.match(re) || [])[1]);
    const lap = dur(/animation:bud-go ([\d.]+)s/);
    const swing = dur(/animation:bud-arc ([\d.]+)s/);
    const rope = dur(/animation:bud-web ([\d.]+)s/);
    if (!lap || !swing || !rope) return 'could not read all three durations';
    const divides = (a, b) => Math.abs((a / b) - Math.round(a / b)) < 1e-9;
    if (!divides(lap, swing)) return `lap ${lap}s is not a whole number of ${swing}s swings`;
    if (!divides(lap, rope)) return `lap ${lap}s is not a whole number of ${rope}s rope cycles`;
    return divides(rope, swing) ? true : `rope ${rope}s is not a whole number of swings`;
  })() === true, 'see the animation durations');
}

/* ---- not paying for what nobody is looking at ----

   A focus timer is the app you leave running for half an hour while you use
   something else, so "hidden" is the normal case rather than the edge one. The
   buddy and the effects layer between them keep about fifty infinite animations
   alive, and Chromium throttles timers and rAF on its own but *not* compositor
   animations — those keep going behind other windows and while minimised.

   None of this is visible by definition, which is exactly why it needs a test:
   if the wiring quietly comes undone nobody will ever notice, they will just
   have a slightly hotter laptop. */
{
  const css = [...window.document.querySelectorAll('style')].map((n) => n.textContent).join('\n');
  check('there is a rule that stills everything while the window is hidden',
    /html\.at-rest[^{]*\{[^}]*animation-play-state:\s*paused/.test(css.replace(/\s+/g, ' ')),
    'no html.at-rest rule');
  check('and the two decorative layers are dropped, not merely stilled',
    /\.bud-layer\.at-rest-off\{[^}]*display:none/.test(css.replace(/\s+/g, ' ')));

  const doc = window.document.documentElement;
  const vfx = $('vfx');
  check('the window starts out awake', !doc.classList.contains('at-rest'));

  /* jsdom reports `visibilityState` from a getter, so it has to be replaced
     rather than assigned — and put back afterwards, or every check after this
     one runs in a hidden document. */
  const real = Object.getOwnPropertyDescriptor(window.Document.prototype, 'visibilityState');
  Object.defineProperty(window.document, 'visibilityState', { value: 'hidden', configurable: true });
  window.document.dispatchEvent(new window.Event('visibilitychange'));
  await wait(40);
  check('going away stills the app and takes the effects layer out',
    doc.classList.contains('at-rest') && (!vfx || vfx.style.display === 'none'),
    doc.className + ' / ' + (vfx ? vfx.style.display : 'no vfx'));

  Object.defineProperty(window.document, 'visibilityState', { value: 'visible', configurable: true });
  window.document.dispatchEvent(new window.Event('visibilitychange'));
  await wait(40);
  check('and coming back puts it all on again',
    !doc.classList.contains('at-rest') && (!vfx || vfx.style.display !== 'none'),
    doc.className + ' / ' + (vfx ? vfx.style.display : 'no vfx'));
  if (real) Object.defineProperty(window.document, 'visibilityState', real);

  /* Somebody who has asked for less movement is asking about the decoration,
     not about the controls — so the two purely decorative layers go and
     everything else is only shortened. Blanking every animation would take the
     feedback on the buttons with it. */
  check('asking for reduced motion removes the decoration, not the feedback',
    /@media \(prefers-reduced-motion: reduce\)\{[^@]*\.bud-layer, ?#vfx\{[^}]*display:none/
      .test(css.replace(/\s+/g, ' ')),
    'no reduced-motion rule for the decorative layers');
}

/* ---- a paused clock must not keep time -------------------------------------

   The engine works off `S.endAt` minus the wall clock rather than by counting
   ticks, which is what makes a block survive a frozen web view. The cost of
   that choice is that `S.endAt` is *meaningless while paused* — it is the end
   of a block that is no longer going anywhere, and it slides further into the
   past every second you leave the timer sitting there.

   45-notify.js calls `tick()` on the way back from the background to catch up a
   block that ran while the page was asleep. It did not ask whether the block
   was running. Pause, switch away, come back: the clock had counted down the
   whole time you were gone, the minutes were written into the log and the ember
   count, and if you had been away longer than the block it ran `complete()` —
   chime, session banked, straight into the break. All of it invisible, because
   by definition nobody was looking.

   Only a real jump in the wall clock can catch this, so this stands `Date.now`
   on a jump table and moves it. */
{
  const { window, errors: pauseErr } = boot(html);
  await wait(300);
  const $p = (id) => window.document.getElementById(id);
  const realNow = window.Date.now;
  let jump = 0;
  window.Date.now = () => realNow.call(window.Date) + jump;

  $p('begin').click();
  await wait(320);
  check('a block is running', $p('toggle-run').textContent.trim() === 'Pause', $p('toggle-run').textContent);
  $p('toggle-run').click();                       // pause it
  await wait(120);
  const paused = $p('clock').textContent.trim();
  /* The label is 'Resume' only once a second has actually gone, so "is it
     stopped" is asked as "does it no longer offer to pause". */
  check('and pausing stops it', $p('toggle-run').textContent.trim() !== 'Pause', $p('toggle-run').textContent);

  const pausedLabel = $p('toggle-run').textContent.trim();

  /* **Away for longer than the block is the case that matters**, and it is also
     the one that hides itself. With the bug, `tick()` ran the clock past zero,
     `complete()` banked the session and moved to the break — and the break's
     clock is a different number on a screen that still looks like a timer.

     Go *hidden* properly rather than only firing the event: `visibilityState`
     is a getter in jsdom, so it has to be replaced. That exercises the going-
     away half as well, which writes the block's progress down.

     And exactly one round trip. An earlier version of this test dispatched
     twice, which let a broken build complete the focus block *and then* the
     break, landing back on a fresh 25:00 focus screen — the same numbers as
     never having moved at all. It passed against the bug. Assert the phase as
     well as the digits, and go there and back once. */
  const vis = Object.getOwnPropertyDescriptor(window.Document.prototype, 'visibilityState');
  Object.defineProperty(window.document, 'visibilityState', { value: 'hidden', configurable: true });
  window.document.dispatchEvent(new window.Event('visibilitychange'));
  await wait(80);
  jump = 30 * 60 * 1000;
  Object.defineProperty(window.document, 'visibilityState', { value: 'visible', configurable: true });
  window.document.dispatchEvent(new window.Event('visibilitychange'));
  await wait(250);
  if (vis) Object.defineProperty(window.document, 'visibilityState', vis);

  check('half an hour in the background does not move a paused clock',
    $p('clock').textContent.trim() === paused, `${paused} -> ${$p('clock').textContent.trim()}`);
  /* The label carries the phase — "Begin rest" is the tell that the block was
     finished for you while you were away. */
  check('and does not end the block behind your back',
    $p('toggle-run').textContent.trim() === pausedLabel && !/rest/i.test($p('toggle-run').textContent),
    `${pausedLabel} -> ${$p('toggle-run').textContent.trim()}`);
  /* And the other half of it still works: a block that really is running does
     catch up on the way back, because that is what the call was there for. */
  $p('toggle-run').click();                       // start again
  await wait(200);
  const ran = $p('clock').textContent.trim();
  jump += 65 * 1000;
  window.document.dispatchEvent(new window.Event('visibilitychange'));
  await wait(200);
  check('a running clock still catches up on the way back',
    $p('clock').textContent.trim() !== ran, `${ran} -> ${$p('clock').textContent.trim()}`);
  $p('stop').click();
  await wait(120);
  window.Date.now = realNow;
  check('no errors from the background round trip', pauseErr.length === 0, pauseErr.join(' | '));
}

/* ---- the update banner, and which route it offers ----

   There are two ways this app updates and they must never both be visible. The
   desktop shell downloads in the background and installs on quit; the page
   reads `latest.json` and can link to the release. Show both and everybody
   takes the manual one, because it is the one with a button on it.

   The rule is: offer the link only when we have *heard* that the shell is not
   handling it. Silence is not consent — `idle` is what `watch()` writes the
   moment it subscribes, before the shell has said anything, and treating that
   as "handled" is how the banner ended up offering neither route. */
{
  /* From the flag to the end of the banner it controls. **Search for the end
     *from* the start**, not from the top of the file: `upd-safe` is a CSS class
     too, and the stylesheet comes first, so a bare `indexOf` returns a position
     before the start and the slice comes out empty — which fails every check
     inside it while the code is perfectly correct. */
  const at = html.indexOf('const shellAuto');
  /* End on a string that only exists in the *fallthrough* branch — the one that
     draws the link. `upd-safe` appears in the native branch first and stops the
     slice short of the very code being checked. */
  const upd = at < 0 ? '' : html.slice(at, html.indexOf('Export a backup first', at));
  check('an unanswered shell is treated as no shell, not as a working one',
    /state\s*!==\s*'manual'\s*&&\s*n\.state\s*!==\s*'idle'/.test(upd)
    || /state\s*!==\s*'idle'\s*&&\s*n\.state\s*!==\s*'manual'/.test(upd),
    'shellAuto still counts idle');
  /* And the link is conditional on that answer, not printed unconditionally. */
  check('the manual link is only offered when nothing else will do it',
    /!shellAuto/.test(upd), 'the GitHub link is not gated');
}

/* The renderer announces itself the moment it subscribes, and the shell replays
   its last state in reply. Registering that handler after the page is told to
   load is a race the page can win, and when it does, no state ever arrives. */
check('the desktop shell listens before it loads the page', (() => {
  /* Anchored to the build under test, not to this file: a slice runs from a
     copy somewhere else, and `root` then points at that copy's parent. */
  let main;
  try {
    main = readFileSync(join(dirname(htmlPath), '..', 'electron', 'main.cjs'), 'utf8');
  } catch (e) { return true; }   // no shell beside this build; nothing to check
  const setup = main.indexOf('updater.setup(');
  const load = main.indexOf('win.loadFile(');
  if (setup < 0 || load < 0) return 'could not find both calls';
  return setup < load ? true : 'setup() runs after loadFile() — the replay can be missed';
})() === true, 'see electron/main.cjs');

/* **1.0.10 is newer than 1.0.9, and a string comparison says otherwise.**

   Two dotted versions have to be compared field by field as numbers. Sorted as
   text, "1.0.10" < "1.0.9" because '1' < '9' at the fourth character, so the
   banner would go quiet the moment the patch number reached double figures and
   stay quiet for every release after it. Nothing would look broken; there would
   simply never be another update.

   Checked against the real function out of the built file, not a copy. */
check('a double-digit patch version counts as newer', (() => {
  const at = html.indexOf('function updNewer');
  if (at < 0) return 'updNewer is gone';
  const fn = html.slice(at, html.indexOf('const Update =', at));
  let cmp;
  try { cmp = new Function(fn + '; return updNewer;')(); } catch (e) { return 'would not compile'; }
  for (const [a, b, want] of [
    ['1.0.10', '1.0.9', true], ['1.0.9', '1.0.10', false],
    ['1.0.10', '1.0.10', false], ['1.1.0', '1.0.99', true], ['2.0.0', '1.0.10', true],
  ]) {
    if (cmp(a, b) !== want) return `${a} > ${b} said ${cmp(a, b)}`;
  }
  return true;
})() === true, 'see updNewer in 41-update.js');

/* ---- the app does not talk like an assistant ----

   Everything the app says should sound like it was written by the person who
   built it, because it was. The tells are specific and mechanical, so they can
   be checked: an app has no first person and nothing to apologise for, it does
   not narrate its own intentions, and it does not pad with the courtesy
   formulas that generated text falls into.

   Scanned over the quoted strings in the built file rather than the source, so
   a phrase added anywhere is caught wherever it came from. Deliberately narrow
   — this is a tripwire for a voice slipping, not a style grader. */
{
  const tells = [
    /* Case-SENSITIVE, and the apostrophe is required. Lower-cased and loose,
       this matched the word "ill" inside an achievement name. */
    [/\bI(?:'|’)(?:ll|ve|m|d)\b|\bI (?:will|can|have|think|would|am)\b/, 'first person'],
    [/\bLet me\b|\bI(?:'|’)?d be happy\b|\bHappy to\b/i, 'narrating intent'],
    [/\bAs an AI\b|\blanguage model\b|\bI(?:'|’)?m an? (?:assistant|AI)\b/i, 'assistant disclosure'],
    [/\bSorry,? (?:but|I|about)\b|\bI apologi[sz]e\b|\bMy apologies\b/i, 'apologising'],
    [/\bPlease note that\b|\bIt(?:'|’)?s worth noting\b|\bKeep in mind that\b/i, 'padding'],
    [/\bCertainly[,!]|\bOf course[,!]|\bGreat question\b|\bAbsolutely[,!]/i, 'courtesy formula'],
    [/\bfeel free to\b|\bdon(?:'|’)?t hesitate\b/i, 'invitation formula'],
    [/\bDelve\b|\btapestry of\b|\bIt(?:'|’)?s important to (?:note|remember)\b/i, 'generated prose'],
  ];
  /* Single-quoted string literals from the concatenated app source. Good enough
     to catch prose; it is not trying to parse JavaScript. */
  const strings = [...html.matchAll(/'((?:[^'\\\n]|\\.){12,240})'/g)].map((m) => m[1]);
  const caught = [];
  for (const str of strings) {
    for (const [re, why] of tells) {
      if (re.test(str)) { caught.push(why + ': ' + str.slice(0, 70)); break; }
    }
  }
  check('nothing in the app sounds like an assistant wrote it',
    caught.length === 0, caught.slice(0, 3).join(' | '));
}

check('repeat chips rendered', $('rep-chips').children.length > 0);

/* The messages button is there on a fresh install, with no room and nobody
   saved. It used to hide itself until you had somebody to write to, which read
   as the button coming and going at random. */
check('the messages button is there from the start', !$('chat-btn').classList.contains('hide'));
/* The dot is positioned out of the flow. While this rule was missing it was an
   ordinary inline span inside a 32px button, which shoved the icon off centre —
   which is what "the message button is misaligned" was. */
check('the unread dot cannot push the icon about',
  window.getComputedStyle($('chat-dot')).position === 'absolute',
  window.getComputedStyle($('chat-dot')).position);
check('and the pop-out sits above the arcade overlay',
  Number(window.getComputedStyle($('chat-pop')).zIndex) > 50,
  window.getComputedStyle($('chat-pop')).zIndex);
check('but below the sheet you would be reading in',
  Number(window.getComputedStyle($('chat-pop')).zIndex)
  < Number(window.getComputedStyle($('chat')).zIndex),
  `${window.getComputedStyle($('chat-pop')).zIndex} / ${window.getComputedStyle($('chat')).zIndex}`);
check('a hidden pop-out is actually hidden',
  window.getComputedStyle($('chat-pop')).display === 'none',
  window.getComputedStyle($('chat-pop')).display);
check('and no dot on it', $('chat-dot').classList.contains('hide'));
$('chat-btn').click();
await wait(60);
check('it opens with nobody saved', !$('chat').classList.contains('hide'));
check('and says how to get somebody to write to', /Focus together/.test($('chat-log').textContent),
  $('chat-log').textContent.slice(0, 80));
$('chat-close').click();
await wait(40);

/* The dial's glow is clipped by whichever box scrolls, and no amount of padding
   inside that box helps — the padding moves the clip along with it. So the
   scroller is the stage, one level further out, and the timer clips nothing. */
{
  /* The glow is out of the layout altogether now — a fixed element positioned
     onto the dial. Every previous fix was "give the scrolling box more padding",
     and that can never work: a scroll box clips at its padding box, so the
     padding moves the clip along with the content. */
  check('the glow is not inside anything that scrolls',
    window.getComputedStyle($('dial-glow')).position === 'fixed',
    window.getComputedStyle($('dial-glow')).position);
  check('it sits behind the app, not over it',
    Number(window.getComputedStyle($('dial-glow')).zIndex) === 0
    && Number(window.getComputedStyle(window.document.querySelector('.stage')).zIndex) > 0);
  check('it is off on the setup screen', !$('dial-glow').classList.contains('on'));
}
check('the leave-the-room menu item is gone', !$('d-leave'));

/* ---- updates ----
   A build with nowhere to check says nothing about updates at all: no menu item,
   no request, no mention. See 41-update.js.

   Tested against a copy with the host stripped back out rather than against
   this one, because whether the *shipped* build has a host depends on whether
   whoever built it has run `npm run setup:updates` — and both answers are
   correct. What must hold either way is that no host means no noise. */
check('the version is stamped into the build', /v\d+\.\d+\.\d+/.test($('drawer').textContent),
  $('drawer').textContent.slice(-40));
{
  const bare = html.replace(
    /const UPD_URL = '[^']*'/,
    "const UPD_URL = 'https://raw.githubusercontent.com/OWNER/REPO/main/latest.json'",
  );
  const { window: wq } = boot(bare);
  await wait(400);
  const $q = (id) => wq.document.getElementById(id);
  check('a build with nowhere to check keeps quiet about updates',
    $q('upd-box').classList.contains('hide') && !$q('upd-box').textContent.trim(),
    $q('upd-box').textContent.slice(0, 40));
  check('and asks the network for nothing',
    !wq.__fetched.some((u) => /latest\.json/.test(u)), wq.__fetched.join(' '));
}

/* ---- achievements ----
   Tick boxes that pay once, not bars that creep. The first block ticks the
   first mark, which is the only cheap one on the list. */
$('d-ach').click();
await wait(120);
check('the achievements page is a list of marks',
  $('ach-body').querySelectorAll('.ach').length >= 20,
  `${$('ach-body').querySelectorAll('.ach').length}`);
check('sorted into groups rather than one long run',
  $('ach-body').querySelectorAll('.ach-group').length === 4,
  `${$('ach-body').querySelectorAll('.ach-group').length}`);
check('each one says what it pays',
  [...$('ach-body').querySelectorAll('.ach-pays')].every((p) => +p.textContent > 0));
check('none of them is a progress bar', !$('ach-body').querySelector('.ach-bar'));
/* The arcade half of the list is the bigger half now, and most of it is made
   of moments the boards themselves don't remember — see Embers.feats. */
/* **A run on one size, not a run on the crossword.** The streak the game
   screen shows counts a day as kept when every grid published that day is
   filled in, which makes a month of 5×5s read the same as a month of 9×9s.
   These three count each size's own editions, so the nine is three weeks of
   Mondays, Wednesdays and Fridays and cannot be had on the small one. And the
   two games that had no marks at all now have some. */
check('the crossword pays for a run on each size',
  ['Five fives', 'Seven sevens', 'Nine nines'].every((w) => $('ach-body').textContent.includes(w)),
  $('ach-body').textContent.slice(0, 80));
check('and the word game and Tetris are on the board at all',
  /Guess the word of the day/.test($('ach-body').textContent)
  && /Tetris/.test($('ach-body').textContent),
  $('ach-body').textContent.slice(0, 80));
check('the arcade has marks for the moments, not only the totals',
  ['Promote a pawn', 'sudoku', 'seven', 'ten-point', 'hangman', '2048 tile']
    .every((w) => $('ach-body').textContent.includes(w)),
  $('ach-body').textContent.slice(0, 60));
/* **Counted, not remembered.** This was `pays < 280`, with "the shelf, end to
   end" beside it — true when the shelf was eleven lights, and false from the
   day the wardrobe arrived and took the shelf past thirteen thousand. A
   hand-kept number that drifts by two orders of magnitude is not a rule; it is
   a number that happens to be bigger than the other number. The rule worth
   keeping is the one written in 40-achievements.js: the marks are a bonus on
   top of the hours and never a way around them. */
{
  const pays = [...$('ach-body').querySelectorAll('.ach-pays')].map((el) => +el.textContent);
  const all = pays.reduce((n, x) => n + x, 0);
  const shelf = window.__m.shelfTotal();
  check('the whole board pays a fraction of what the shelf costs',
    all > 0 && shelf > 0 && all < shelf / 10, `${all} of ${shelf}`);
  check('and no single mark pays more than a morning of focus',
    pays.length > 0 && Math.max(...pays) <= 40, `${Math.max(...pays)}`);
}
$('ach-close').click();
await wait(60);

/* ---- nothing readable behind an open menu ----
   The overlay pane is frosted rather than opaque, so the shell underneath is
   blurred at the source as well; without it the setup screen's big number was
   still legible through the shelf. */
/* **The accent is the horizon on this look, and the button lands on it.**
   Everything `.arcade-btn` is made of comes from `--accent`, which under the
   beach is the hot orange of the sky's bright band — and a rest is exactly when
   the button appears, in the middle of the screen, which is where that band is.
   The override has to exist and has to not be built from the accent again. */
{
  const beach = (html.match(/body\[data-light="beach"\] \.arcade-btn\{([^}]*)\}/) || [])[1] || '';
  check('the beach gives the way into the arcade its own colour',
    /background\s*:/.test(beach) && /border-color\s*:/.test(beach)
    && !/var\(--accent\)/.test(beach), beach.replace(/\s+/g, ' ').trim() || 'no rule');
}
check('the app is not veiled with nothing open', !window.document.body.classList.contains('veiled'));
$('d-stats').click();
await wait(80);
check('opening an overlay veils what is behind it', window.document.body.classList.contains('veiled'));
/* Faded, not blurred. A filter on the shell is a full-screen Gaussian sitting
   underneath the overlay's own backdrop filter — three passes at once, which is
   what made the app stutter. Opacity says the same thing for nothing. */
check('and the shell is taken out of the picture cheaply', (() => {
  const css = [...window.document.querySelectorAll('style')].map((n) => n.textContent).join('\n')
    .replace(/\s+/g, ' ');
  return /body\.veiled \.stage\{[^}]*opacity:\.0?6/.test(css)
    && !/body\.veiled \.stage\{[^}]*filter:blur/.test(css);
})());
check('and nothing on the page asks for a blur wider than twenty pixels', (() => {
  const css = [...window.document.querySelectorAll('style')].map((n) => n.textContent).join('\n');
  const wide = [...css.matchAll(/backdrop-filter:blur\((\d+)px\)/g)]
    .map((m) => +m[1]).filter((n) => n > 20);
  return wide.length === 0;
})(), 'radii over 20px still present');
$('stats-close').click();
await wait(80);
check('and it lifts when the overlay closes', !window.document.body.classList.contains('veiled'));

/* ---- your buddy ----------------------------------------------------------
   Five numbers, and the numbers are the whole contract: they travel in the
   `hello` that opens a peer connection and are drawn by the *other* person's
   copy of these tables. Reordering one list silently redresses everybody. */
{
  $('d-account').click();
  await wait(120);
  const opts = (key) => [...$('bud-box').querySelectorAll(`[data-bud="${key}"]`)];
  check('the buddy lives on the account page', $('acct-overlay').contains($('bud-box')));
  /* **No buddy without an account.** He is what other people see next to your
     name, he rides on the account, and he comes back on a new device because
     the account carries him — so offering him to somebody with nowhere to keep
     him is offering something that vanishes. This build has an account server
     and nobody signed in, so the editor is the invitation, not the tool.
     The picker itself is exercised signed-in, in account-client-test.mjs. */
  const configuredHere = /ACC_URL = 'https?:/.test(html);
  if (configuredHere) {
    check('and there is none of him without an account',
      opts('e').length === 0 && /sign in/i.test($('bud-box').textContent),
      $('bud-box').textContent.slice(0, 60));
    check('and he is not on the timer screens either',
      $('bud-perch').classList.contains('hide') && !$('bud-perch').innerHTML.trim());
  } else {
    check('every face and clothing option is a picture of itself, not a number',
      ['e', 'h', 'a', 'o'].every((k) => opts(k).length > 0
        && opts(k).every((b) => b.querySelector('svg') && !/\d/.test(b.textContent))));
    /* **The wardrobe is what you own, and a new buddy owns nothing.**

       Every row used to list every part there is. Now the parts are bought, so
       a row is your things — and on a device that has bought nothing that is
       exactly one tile per row, the "none" that every row starts with. The
       point of checking the *empty* case is that it is the one a new person
       sees, and a wardrobe of locked tiles they cannot use is the thing this
       replaced. Eyes are the exception: index 0 is a real pair rather than an
       absence, because a buddy with no eyes is not a buddy. */
    check('a wardrobe holds what you own, which to begin with is nothing',
      ['h', 'a', 'o', 'f', 'r'].every((k) => opts(k).length === 1),
      ['h', 'a', 'o', 'f', 'r'].map((k) => k + ':' + opts(k).length).join(' '));
    check('and the way to get more is one button, not a wall of locked tiles',
      !!$('bud-shop') && /\d+ more to try on/.test($('bud-shop').textContent),
      $('bud-shop') ? $('bud-shop').textContent : 'no shop button');
    /* Colours are free, all of them, from the first minute — a colour is not an
       item and charging for one would make the shop a tollbooth. */
    check('every skin and every colour is there from the start, and free',
      opts('c').length >= 10 && opts('b').length >= 10,
      `${opts('c').length} skins, ${opts('b').length} colours`);
    check('colours stay as swatches, being pictures of themselves already',
      [...$('bud-box').querySelectorAll('[data-bud="c"],[data-bud="b"]')]
        .every((b) => b.classList.contains('sw')));
    /* Putting one on has to change the drawing. It is the cheapest possible
       check and it is the one that catches a part wired to nothing. */
    {
      const stage = () => $('bud-box').querySelector('.bud-stage').innerHTML;
      const bare = stage();
      opts('c')[3].click();
      check('and choosing one actually changes him', stage() !== bare);
      opts('c')[0].click();
    }
  }

  const budJs = html.slice(html.indexOf('your buddy ---'), html.indexOf('function budDefault'));
  for (const [what, mark] of [
    ['a crown', 'crown'], ['a hair bow', 'hair bow'], ['headphones', 'headphones'],
    ['a tie', 'tie'], ['a beard', 'beard'], ['a moustache', 'moustache'],
    ['glasses', 'glasses'], ['a spider mask', 'spider mask'],
  ]) {
    check(`there is ${what}`, budJs.includes(mark), mark);
  }
  /* **Nothing may be invisible.** One accessory was a path with `fill:none` and
     no stroke colour, so it drew nothing at all — an option that did nothing
     and looked like the app was broken. Every part must put ink on the page. */
  /* Only hats and extras: the eyes are drawn inside a `<g fill stroke>` in
     budSvg and are *supposed* to inherit their ink from it. Hats and extras are
     appended outside that group, so they have to carry their own colour — and
     the accessory that shipped broken was one that did not. */
  const budParts = budJs.slice(budJs.indexOf('const BUD_HATS'));
  check('no head or extra draws nothing at all', (() => {
    const bad = [];
    for (const m of budParts.matchAll(/\{s:'((?:[^'\\]|\\.)*)'/g)) {
      const s = m[1];
      if (!s) continue;                       // the deliberate "none" entries
      /* The one that shipped: `fill="none"`, `stroke-width` set, and no stroke
         *colour* anywhere. SVG's initial stroke is `none`, so it drew nothing
         — an option that did nothing and read as the app being broken. */
      const inked = /fill="#/.test(s) || /stroke="#/.test(s) || /fill="currentColor"/.test(s);
      const inheritsInk = !/fill="none"/.test(s) && !/stroke="/.test(s);
      if (!inked && !inheritsInk) bad.push(s.slice(0, 40));
    }
    return bad.length === 0;
  })(), 'a part with no colour on it');
  /* **From here, add to the end only.** These lists were rebuilt once — the
     numbers travel in `hello` and are drawn against the other person's copy, so
     an index that moves is somebody else's buddy changing clothes unasked. */
  check('the parts are still in a fixed, documented order',
    budJs.indexOf('// cap') < budJs.indexOf('// beanie')
    && budJs.indexOf('// beanie') < budJs.indexOf('// top hat')
    && budJs.indexOf('// tie') < budJs.indexOf('// bow tie')
    && budJs.indexOf('// bow tie') < budJs.indexOf('// moustache'));
  check('and the rule against reordering is written down where they are',
    /add to the end, never insert, never remove/i.test(budJs));

  /* **Outerwear is a sixth number, and the sixth number has to be optional.**
     Every buddy in the world was made before this list existed, and so is every
     `hello` arriving from a copy of the app that has not been updated — none of
     them carries `o`. `budClean` has to read that absence as 0, which is "no
     coat", which is what they are actually wearing. Get this wrong and the
     symptom is everybody in the room silently putting on a hoodie. */
  check('a coat is optional and its absence means no coat', (() => {
    if (!/const BUD_OUTER = \[/.test(budJs)) return 'no BUD_OUTER';
    if (!/o: ?n\(v\.o, BUD_OUTER\.length\)/.test(html)) return 'budClean does not clean o';
    if (!/function budDefault\(\)\{\s*return \{[^}]*\bo: ?0/.test(html)) return 'budDefault has no o';
    return /BUD_KEYS = \['b', ?'c', ?'e', ?'h', ?'a', ?'f', ?'o'/.test(html)
      ? true : 'budSame does not compare o';
  })() === true, 'see budClean / budDefault / budSame');
  /* Same fixed order rule as the hats and the extras, and the same reason. */
  check('the coats are in a fixed, documented order too',
    budJs.indexOf('// hoodie') < budJs.indexOf('// denim jacket')
    && budJs.indexOf('// denim jacket') < budJs.indexOf('// puffer')
    && budJs.indexOf('// cape') < budJs.indexOf('// lab coat'));

  /* **An antic with no stylesheet behind it is a buddy that never moves.**
     `BUD_ANIMS` is a list of names; `.bud-<name>` is where the travel actually
     lives. Adding one and forgetting the other gives a picker entry that reads
     perfectly, sets happily, saves, syncs — and then stands still, which looks
     like the app ignoring you rather than like a missing rule. */
  {
    const styles = [...window.document.querySelectorAll('style')].map((n) => n.textContent).join('\n');
    /* **From the antic table itself, not from anywhere a `k:` appears.**
       `budJs` starts at a CSS comment and runs through every game's file to
       reach the buddy, and `registerDaily` describes its difficulties as
       `{k:'easy', n:'Easy'}` — the same shape. Slicing to `BUD_ANIMS` is what
       keeps this checking antics rather than whatever else is passing. */
    const anims = budJs.slice(budJs.indexOf('const BUD_ANIMS'));
    const keys = [...anims.slice(0, anims.indexOf('\n  ];')).matchAll(/\{k:'([\w-]+)'/g)].map((m) => m[1]);
    check('every antic has an engine in the stylesheet',
      keys.length > 3 && keys.every((k) => styles.includes('.bud-' + k + '{')),
      keys.filter((k) => !styles.includes('.bud-' + k + '{')).join(', ') || `${keys.length} antics`);
    /* And nothing is holding a prop for a pose that no longer exists — an
       orphan entry in `BUD_PROPS` is dead weight that reads as live code. */
    const props = [...budJs.matchAll(/^\s{4}(\w+):\{(?:back|front):/gm)].map((m) => m[1]);
    check('and no prop belongs to a pose that is not offered',
      props.every((k) => keys.includes(k)),
      props.filter((k) => !keys.includes(k)).join(', ') || `${props.length} props`);
  }

  /* **The antic has to survive a reload.** `S.budAnim` was set by the picker
     and read by `stage()`, and written down nowhere — so choosing the nap and
     coming back tomorrow gave you the swing again, and it read as the picker
     ignoring you. `budShow` had the same hole. Both are checked against the
     *persistence* file rather than against `S`, because being in memory was
     never the problem. */
  check('the chosen antic is written to storage, not just to memory',
    /budAnim:\s*S\.budAnim/.test(html) && /budShow:\s*S\.budShow/.test(html)
    && /budAnim:\(d\.budAnim == null/.test(html),
    'see 02-persistence.js');

  /* **An account is a profile or it is only a backup.** Everything a person
     sets up has to ride on it — not just the hours. Each of these was missing
     once and the symptom was the same: sign in on a new machine, get your
     history, and have to build everything else again. */
  {
    const snap = html.slice(html.indexOf('snapshot(){'), html.indexOf('adopt(snap)'));
    for (const [what, key] of [
      ['the calendar', 'plan'], ['the checklist', 'tasks'],
      ['what has been deleted', 'gone'], ['which light is on', 'light'],
      ['what the buddy looks like', 'buddy'], ['which antic he does', 'budAnim'],
      ['the clock face', 'face'], ['the ambience', 'amb'],
    ]) {
      check(`the account carries ${what}`, new RegExp('\\b' + key + ':').test(snap), key);
    }
  }
  /* **The pose class may live on exactly one element: the slot.**

     `.bud-swing` and `.bud-swim` are not descriptions, they are engines — they
     carry `bud-go`/`bud-round` and `bud-lap`/`bud-depth`, the animations that
     move him across the window. `stage()` puts the class on the slot, which is
     the box that spans the screen; `budSvg()` also put it on the `<svg>`, so
     the drawing ran the entire journey a second time inside a parent already
     running it. He came out somewhere that was not the end of his rope, and
     the web read as detached — which is precisely what it was, from him.

     Same shape of bug as the duplicate `@keyframes` above: two things claiming
     one name, no warning, and the symptom nowhere near the cause. */
  /* Read from `html`, not `budJs`: that slice stops at `budDefault` and
     `budSvg` is defined below it. Asserting against a window the code is not
     in passes for the wrong reason, which is worse than failing. */
  check('the drawing never carries a pose class — only the slot travels',
    /return '<svg class="bud"'/.test(html)
    && !/<svg class="bud'\s*\+\s*\(\s*pose/.test(html),
    (html.match(/return '<svg class="bud[^\n]{0,30}/) || ['budSvg not found'])[0]);
  $('acct-close').click();
  await wait(60);
}

/* ---- the shop ----
   The shelf was the bottom half of Your focus, and the menu row that pointed at
   it had to scroll the page to its own middle to land anywhere useful. A page
   that needs a shortcut to halfway down itself is two pages. */
{
  check('Your focus no longer carries the shelf',
    !$('stats-overlay').contains($('emb-box')) && $('shop-overlay').contains($('emb-box')));
  $('emb-spend-row').click();
  await wait(120);
  check('the menu row opens the shop', !$('shop-overlay').classList.contains('hide'));
  check('and the shelf is on it, filled in',
    $('emb-box').textContent.trim().length > 0 && !!$('emb-box').querySelector('.emb-light'));
  check('and Your focus stayed shut', $('stats-overlay').classList.contains('hide'));
  $('shop-close').click();
  await wait(60);
  check('and it closes', $('shop-overlay').classList.contains('hide'));
  /* The counter in the top bar is the other thing the shelf answers — tapping
     the number should land on the thing the number is for. */
  $('emb-chip').click();
  await wait(120);
  check('tapping the ember count opens it too', !$('shop-overlay').classList.contains('hide'));
  $('shop-close').click();
  await wait(60);
}

/* The menu opens with a swipe in from the left edge, from anywhere — the menu
   button only exists on two of the screens. */
{
  const swipe = (fromX, toX, y = 300) => {
    const mk = (type, x) => new window.PointerEvent(type, {
      clientX: x, clientY: y, bubbles: true, cancelable: true,
      pointerId: 3, pointerType: 'touch', isPrimary: true,
    });
    window.document.body.dispatchEvent(mk('pointerdown', fromX));
    window.document.body.dispatchEvent(mk('pointermove', toX));
    window.document.body.dispatchEvent(mk('pointerup', toX));
  };
  swipe(6, 120);
  await wait(60);
  check('swiping in from the edge opens the menu', $('drawer').classList.contains('open'));
  swipe(200, 40);
  await wait(60);
  check('and swiping back closes it', !$('drawer').classList.contains('open'));

  // a swipe that starts in the middle of the screen is somebody using the app
  swipe(160, 300);
  await wait(60);
  check('a swipe from the middle is left alone', !$('drawer').classList.contains('open'));
  /* And one that sets off down the screen is a scroll. Direction is judged as
     the gesture starts, the way a finger actually moves, not from where it
     finally ended up — so this is dispatched in steps. */
  const mk = (type, x, y) => new window.PointerEvent(type, {
    clientX: x, clientY: y, bubbles: true, cancelable: true,
    pointerId: 4, pointerType: 'touch', isPrimary: true,
  });
  window.document.body.dispatchEvent(mk('pointerdown', 5, 300));
  for (const [x, y] of [[9, 316], [14, 342], [40, 390], [120, 430]]) {
    window.document.body.dispatchEvent(mk('pointermove', x, y));
  }
  window.document.body.dispatchEvent(mk('pointerup', 120, 430));
  await wait(60);
  check('a swipe that turns into a scroll is left alone', !$('drawer').classList.contains('open'));

  /* The real gesture runs on touch events, not pointer events. A browser fires
     `pointercancel` the moment it decides a touch is a scroll — and nearly
     every screen here is inside something scrollable — which is why this only
     worked sometimes. The finger is still on the glass; the swipe must survive. */
  const touch = (type, x, y) => {
    const e = new window.Event(type, { bubbles: true, cancelable: true });
    const pt = [{ clientX: x, clientY: y, identifier: 5 }];
    e.touches = pt; e.changedTouches = pt;
    window.document.body.dispatchEvent(e);
  };
  touch('touchstart', 8, 300);
  touch('touchmove', 30, 304);
  window.document.body.dispatchEvent(new window.PointerEvent('pointercancel', {
    bubbles: true, pointerId: 9, pointerType: 'touch', clientX: 30, clientY: 304,
  }));
  touch('touchmove', 110, 308);
  await wait(60);
  check('a touch swipe survives the browser cancelling the pointer',
    $('drawer').classList.contains('open'));
  touch('touchend', 110, 308);
  $('drawer-close').click();
  await wait(320);
  check('and the menu closes again', !$('drawer').classList.contains('open'));

  /* Two boards drag with a finger, and a swipe across them means something
     already. Everywhere else — including the boards that only ever get tapped —
     the gesture works, which is the point of having it during a game at all. */
  const on = (el, type, x, y) => {
    const e = new window.Event(type, { bubbles: true, cancelable: true });
    const pt = [{ clientX: x, clientY: y, identifier: 7 }];
    e.touches = pt; e.changedTouches = pt;
    el.dispatchEvent(e);
  };
  on($('sc-boardwrap'), 'touchstart', 10, 300);
  on($('sc-boardwrap'), 'touchmove', 130, 306);
  await wait(40);
  check('a drag off the Scrabble board is a tile, not the menu',
    !$('drawer').classList.contains('open'));
  on($('sc-boardwrap'), 'touchend', 130, 306);

  on($('ch-board'), 'touchstart', 10, 300);
  on($('ch-board'), 'touchmove', 130, 306);
  await wait(40);
  check('but one across the chess board opens it', $('drawer').classList.contains('open'));
  on($('ch-board'), 'touchend', 130, 306);
  $('drawer-close').click();
  await wait(320);
}

// and a button, for anyone who doesn't know the gesture is there
click('arcade-open');
await wait(60);
$('ov-menu').click();
await wait(60);
check('the menu opens from inside the arcade without backing out of it',
  $('drawer').classList.contains('open') && !$('overlay').classList.contains('hide'));
$('drawer-close').click();
$('ov-back').click();
await wait(320);

/* The crossword header is four things wide and a phone is not. It had no gap
   and no permission to wrap, so they ran into each other. */
check('a game header may wrap rather than collide',
  window.getComputedStyle($('game-crossword').querySelector('.game-top')).flexWrap === 'wrap',
  window.getComputedStyle($('game-crossword').querySelector('.game-top')).flexWrap);
{
  const css = [...window.document.querySelectorAll('style')].map((n) => n.textContent).join('\n')
    .replace(/\s+/g, ' ');
  check('and on a phone it is laid out in two rows',
    /@media \(max-width: ?460px\)[\s\S]{0,400}grid-template-areas:"name meta" "dir list"/.test(css));
  check('with the clues in one column', /@media \(max-width: ?460px\)[\s\S]{0,900}\.cw-clues\{ ?grid-template-columns:1fr/.test(css));
}

// --- session tasks (added before starting) ---------------------------------
check('setup uses dropdowns', $('drop-rest').tagName === 'DETAILS' && $('drop-tasks').tagName === 'DETAILS');
check('rest summary filled in', /\d+ min · (×\d+|endless)/.test($('rest-summary').textContent), $('rest-summary').textContent);
check('task summary starts empty', $('task-summary').textContent === 'None yet', $('task-summary').textContent);
check('task empty state shown', $('task-list-setup').textContent.includes('Optional'));
const addTask = (text) => { $('task-input').value = text; click('task-add'); };
addTask('write the report');
addTask('reply to emails');
check('two tasks added', $('task-list-setup').querySelectorAll('.task-row').length === 2, `${$('task-list-setup').querySelectorAll('.task-row').length}`);
check('task text escaped and shown', $('task-list-setup').textContent.includes('write the report'));
$('task-list-setup').querySelectorAll('.task-x')[1].click();
check('task can be removed', $('task-list-setup').querySelectorAll('.task-row').length === 1);
addTask('reply to emails');
check('task re-added', $('task-list-setup').querySelectorAll('.task-row').length === 2);
check('task summary counts', $('task-summary').textContent === '0/2 done', $('task-summary').textContent);

// --- timer -----------------------------------------------------------------
click('f-plus');
check('focus stepper responds', $('f-num').textContent !== '');
click('begin');
await wait(60);
check('begin switches to timer view', !$('timer').classList.contains('hide'));
check('clock is populated', /^\d{2}:\d{2}$/.test($('clock').textContent.trim()), $('clock').textContent);
click('toggle-run');
check('pause label is valid', /^(Pause|Resume|Begin (focus|rest))$/.test($('toggle-run').textContent.trim()), $('toggle-run').textContent);
click('toggle-run');
check('resumes', $('toggle-run').textContent.trim() === 'Pause', $('toggle-run').textContent);

/* Focus is recorded while it happens, not only when a block ends. A block that
   never gets an ending — a room that closes, an app that is quit, a phone that
   sleeps — used to leave no trace at all, which is what made stats in somebody
   else's room look like they had stopped working. The open record is the fix,
   and it is on disk from the first tick so that dying mid-block still counts. */
{
  const log = () => JSON.parse(window.localStorage.getItem('focus_log') || '[]');
  check('the block is written down while it is still running',
    log().some((r) => r && r.open), window.localStorage.getItem('focus_log'));
  check('and it is not counted as a finished one yet',
    log().every((r) => !r || !r.open || r.full === false),
    JSON.stringify(log().filter((r) => r && r.open)));

  /* **Going away writes down where we got to.** On a phone, Home does not stop
     the block — it stops the page being given any time, and Android throttles
     `setInterval` to nothing within a minute or two. The countdown survives
     that on its own (wall-clock arithmetic, not tick-counting), but the running
     record would come back holding whichever second the phone last felt like
     giving us. So the record is flushed on the way out, ignoring the thirty
     second throttle, because the next thing that happens may be the OS
     reclaiming the app. See 45-notify.js. */
  const openRec = () => log().find((r) => r && r.open);
  const beforeHide = openRec() ? openRec().secs : -1;
  Object.defineProperty(window.document, 'visibilityState', { value: 'hidden', configurable: true });
  window.document.dispatchEvent(new window.Event('visibilitychange'));
  await wait(120);
  check('going to the home screen writes the block down as it stands',
    !!openRec() && openRec().secs >= beforeHide,
    `${beforeHide}s → ${openRec() ? openRec().secs : 'gone'}s`);
  Object.defineProperty(window.document, 'visibilityState', { value: 'visible', configurable: true });
  window.document.dispatchEvent(new window.Event('visibilitychange'));
  await wait(120);
  check('and coming back does not disturb it', !!openRec(),
    JSON.stringify(log().filter((r) => r && r.open)));
}

// --- ticking tasks during the focus block ----------------------------------
check('live checklist visible while focusing', !$('task-live').classList.contains('hide'));
const liveRows = () => [...$('task-list-live').querySelectorAll('.task-row')];
check('live checklist has both tasks', liveRows().length === 2, `${liveRows().length}`);
liveRows()[0].click();
await wait(20);
check('task ticks', liveRows()[0].classList.contains('done'));
liveRows()[0].click();
await wait(20);
check('task un-ticks', !liveRows()[0].classList.contains('done'));
liveRows()[0].click();
liveRows()[1].click();
await wait(20);
check('both tasks ticked', liveRows().every((r) => r.classList.contains('done')));

/* Adding one without leaving the block. The thing you remember mid-session is
   the thing you lose by the end of it, and ending the session to write it down
   was the only way to keep it. Shut until asked for, so the focus screen does
   not open with a text field under the clock. */
check('the focus screen offers to take a new task', !!$('live-task-plus'));
check('and the field is out of the way until it is wanted',
  $('live-task-add').classList.contains('hide'));
$('live-task-plus').click();
await wait(40);
check('the field opens on the plus', !$('live-task-add').classList.contains('hide'));
{
  const before = liveRows().length;
  $('live-task-input').value = 'Ring the dentist';
  $('live-task-go').click();
  await wait(60);
  check('a task added mid-block joins the list',
    liveRows().length === before + 1, `${liveRows().length} was ${before}`);
  check('and it is on the same list everything else is on',
    JSON.parse(window.localStorage.getItem('focus_tasks') || '[]')
      .some((t) => t.text === 'Ring the dentist'));
  check('added un-ticked, because it has not been done',
    !liveRows()[liveRows().length - 1].classList.contains('done'));
}

// --- arcade ----------------------------------------------------------------
click('skip');
await wait(60);

/* Skipping is an ending, so the block closes — and it still keeps its row. Ten
   seconds you skipped out of are still ten seconds you sat there, and only
   stopping outright inside the first half minute records nothing (logDrop). */
{
  const log = JSON.parse(window.localStorage.getItem('focus_log') || '[]');
  check('the block is closed once it ends', !log.some((r) => r && r.open),
    JSON.stringify(log.filter((r) => r && r.open)));
  check('and a skipped block is still in the history',
    log.length > 0 && log.every((r) => r && r.full === false), `${log.length} records`);
}

/* ---- embers ----
   Paid by the minute of finished focus, banked rather than rounded — which is
   what stops "start a block, skip it, repeat" being the fastest way to earn.
   The block that just ended lasted about a second, so it is worth about a
   second, and the counter has not moved. */
$('d-stats').click();
await wait(120);
check('a one-second block is not worth an ember', +$('emb-box').dataset.have === 600,
  $('emb-box').dataset.have);
check('the leftover seconds are kept rather than thrown away',
  $('emb-box').dataset.bank !== undefined && +$('emb-box').dataset.bank < 600,
  $('emb-box').dataset.bank);
check('and they are written down with everything else',
  'bank' in JSON.parse(window.localStorage.getItem('focus_embers') || '{}'),
  window.localStorage.getItem('focus_embers'));
/* The count is where you can see it, rather than only on a page two taps away. */
check('the top bar keeps the count', $('emb-chip-n').textContent === $('emb-box').dataset.have,
  `${$('emb-chip-n').textContent} / ${$('emb-box').dataset.have}`);
check('and what has been earned is kept as well as what is left',
  +$('emb-box').dataset.earned === +$('emb-box').dataset.have, $('emb-box').dataset.earned);
check('written down, so they survive the app closing',
  /"earned"/.test(window.localStorage.getItem('focus_embers') || ''),
  window.localStorage.getItem('focus_embers'));
{
  /* **The shop is five shelves now, not one page.** The lights, the sounds and
     the faces were already three sections and the wardrobe would have made it
     five times longer than a thumb wants to travel, so each is its own tab and
     only the open one is in the DOM. Which means a test that wants the sounds
     has to open the sounds, exactly as a person does. */
  const shopTab = async (id) => {
    const t = $('emb-box').querySelector(`[data-tab="${id}"]`);
    if (t) t.click();
    await wait(60);
    return !!t;
  };
  check('the shop is a shelf per kind of thing',
    [...$('emb-box').querySelectorAll('[data-tab]')].map((b) => b.dataset.tab).join(',')
      === 'looks,sounds,faces,buddy,antics',
    [...$('emb-box').querySelectorAll('[data-tab]')].map((b) => b.dataset.tab).join(','));
  const shelf = () => [...$('emb-box').querySelectorAll('[data-light]')];
  /* Counted from the catalogue in the build, not written down here. It said 8,
     and adding three lights made it say 8 about a shelf of 11 — a number that
     has to be edited every time the shelf grows is a number that will one day
     be edited without anybody looking at what it is for. What actually matters
     is that every light there is has a tile, so that is the second check. */
  const lm = html.match(/const EMB_LIGHTS = \[([\s\S]*?)\n {2}\];/);
  const lightIds = [...lm[1].matchAll(/\{id:'([a-z]+)'/g)].map((m) => m[1]);
  check('there is a shelf of lights to spend them on',
    shelf().length === lightIds.length && lightIds.length >= 8,
    `${shelf().length} tiles for ${lightIds.length} lights`);
  check('and every light in the catalogue has a tile on it',
    lightIds.every((id) => shelf().some((el) => el.dataset.light === id)),
    lightIds.filter((id) => !shelf().some((el) => el.dataset.light === id)).join(' '));
  /* The ambience tracks re-colour the app too, so they are on the same shelf.
     Two are free — an app with no sound at all until you have earned some is a
     worse app — and each brings its own weather. */
  await shopTab('sounds');
  const sounds = () => [...$('emb-box').querySelectorAll('[data-sound]')];
  check('and the sounds are on their own shelf', sounds().length === 5, `${sounds().length}`);
  check('every sound has a price on it now',
    sounds().filter((b) => /free/.test(b.textContent)).length === 0,
    sounds().map((b) => b.textContent).join(' | '));
  check('and all of them start locked',
    [...$('amb-grid').querySelectorAll('.amb-btn.locked')].length === 5,
    [...$('amb-grid').querySelectorAll('.amb-btn')].map((b) => b.dataset.a + (b.classList.contains('locked') ? '*' : '')).join(' '));
  check('and say what they cost there',
    /embers/.test($('amb-grid').querySelector('.amb-btn.locked').dataset.cost),
    $('amb-grid').querySelector('.amb-btn.locked').dataset.cost);

  // a locked one is offered rather than taken, and No leaves it locked
  sounds().find((b) => b.dataset.sound === 'campfire').click();
  await wait(80);
  check('a locked sound asks before it spends anything',
    !$('confirm').classList.contains('hide'), $('confirm-title').textContent);
  $('confirm-no').click();
  await wait(80);
  check('and saying no leaves it locked',
    !window.document.body.dataset.amb && $('emb-box').dataset.own.indexOf('campfire') < 0,
    `${window.document.body.dataset.amb} / ${$('emb-box').dataset.own}`);
  check('the light is still what is burning', window.document.body.dataset.light === 'seaglass',
    window.document.body.dataset.light);
  /* **Nothing on a shelf is dimmed as a whole.** An item you do not own was
     `opacity:.62` on the tile and an item you cannot afford `.45` on the
     wardrobe's, which faded the one line you actually need — the price — and,
     because opacity applies to everything in the box with no way to opt out,
     took the ember mark's glow down with it. What sits back is the swatch and
     the name. Asked of the built CSS: jsdom resolves none of these values. */
  {
    /* Fixed patterns rather than one built from a string: the selectors are
       known, and `$&` in a replacement is a backreference, which is how the
       builder quietly spliced the next two lines of this file into its own
       regex. */
    const ruleOf = (re) => ((html.match(re) || [])[1] || '').replace(/\s+/g, ' ').trim();
    const rules = {
      '.emb-light.far': ruleOf(/\.emb-light\.far\{([^}]*)\}/),
      '.bud-tile': ruleOf(/\.bud-tile\{([^}]*)\}/),
      '.bud-tile.far': ruleOf(/\.bud-tile\.far\{([^}]*)\}/),
      '.bud-tile.mine': ruleOf(/\.bud-tile\.mine\{([^}]*)\}/),
    };
    const flat = Object.keys(rules).filter((k) => /(^|;|\s)opacity\s*:/.test(rules[k]));
    check('a shelf dims the picture, never the whole tile',
      flat.length === 0, flat.map((k) => k + ' {' + rules[k] + '}').join(' · ') || 'none');
    /* And the mark carries a glow that does not depend on the look being
       generous with `--glow` — some are almost transparent, and on a
       seven-pixel diamond that is no glow at all. */
    const mark = ruleOf(/\.emb-mark\{([^}]*)\}/);
    check('the ember mark is always lit',
      /box-shadow\s*:[^;]*var\(--glow\)[^;]*,[^;]*var\(--accent\)/.test(mark), mark);
  }
  /* **And nothing crops the glow.** The wardrobe's tile label is
     `overflow:hidden` so a long name can end in an ellipsis, and it held every
     price too — so the mark's glow was sliced flat along the top and bottom of
     the line on all sixty-five prices on the shelf. A price is its own label
     now and does not clip. Asked of the markup and of the built CSS both: the
     class is what lets the rule reach it, and the rule is what un-clips it. */
  await shopTab('buddy');
  {
    const ems = [...$('emb-box').querySelectorAll('.bud-tile em')].filter((em) => em.querySelector('.emb-mark'));
    const loose = ems.filter((em) => !em.classList.contains('bud-price'));
    const rule = ((html.match(/\.bud-tile em\.bud-price\{([^}]*)\}/) || [])[1] || '');
    check('no price on the wardrobe sits inside a label that clips it',
      ems.length > 0 && loose.length === 0 && /overflow\s*:\s*visible/.test(rule),
      ems.length + ' prices, ' + loose.length + ' unclassed; rule: ' + (rule.trim() || 'none'));
  }
  await shopTab('looks');
  check('the first is free and already burning',
    shelf()[0].classList.contains('mine') && shelf()[0].classList.contains('on'), shelf()[0].className);
  check('the rest are not yours yet', shelf().slice(1).every((b) => !b.classList.contains('mine')));
  /* A price is the mark and the number — see `embPrice` in 37-embers.js. The
     word went because the mark says it, and this checks the mark is really
     there rather than the shelf quietly showing bare numbers. */
  check('and say what they cost, with the ember mark on it', (() => {
    const em = shelf()[1].querySelector('em');
    return !!em && !!em.querySelector('.emb-mark') && /\d/.test(em.textContent);
  })(), shelf()[1].textContent.slice(0, 60));
  /* **And the mark is a mark.** The check above asks whether the element is
     there, which it always was: `.emb-light i` was written for the tile's own
     colour swatch and, being a *descendant* selector on a bare tag, caught the
     mark inside every price as well. At one class and one tag it outranks
     `.emb-mark`, so every price on every shelf became a second twenty-pixel
     circle dropped into the tile's own grid — the ember was nowhere in a shop
     that deals in embers, and the shelves were full of circles instead.

     Asked as "what reaches this element", not "is it round": jsdom has no
     layout and resolves neither `var()` nor `color-mix()`, but it does match
     selectors, and a mark only its own rule can reach cannot be dressed up as
     something else by a tile it happens to sit inside. */
  {
    const mark = shelf()[1].querySelector('em .emb-mark');
    const hits = [];
    /* By index: jsdom's CSSRuleList is array-like and not iterable, and a
       for..of over it throws where a browser would walk it. */
    const walk = (rules) => {
      for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        /* Selector first: a plain style rule in jsdom carries an empty but very
           truthy `cssRules`, so testing that first walks past every rule in
           the sheet and finds nothing. */
        if (r.selectorText) {
          /* A selector nwsapi will not parse is not one about a bare tag. */
          try { if (mark.matches(r.selectorText)) hits.push(r.selectorText); } catch (e) { /* skip */ }
        } else if (r.cssRules) walk(r.cssRules);
      }
    };
    for (const sheet of window.document.styleSheets) {
      try { walk(sheet.cssRules); } catch (e) { /* skip */ }
    }
    /* The page reset reaches everything on purpose and is not what this is
       about; anything else that lands on the mark is a rule about some box the
       mark is merely inside. */
    const wide = (sel) => sel.split(',').every((one) => /^\s*\*(::[a-z-]+)?\s*$/.test(one));
    const dressed = hits.filter((sel) => !/emb-mark/.test(sel) && !wide(sel));
    check("and nothing but the mark's own rules reach it",
      !!mark && hits.length > 0 && dressed.length === 0,
      dressed.join(' | ') || (mark ? 'no rules' : 'no mark'));
  }
  /* **A shelf selling something that is not a colour draws the thing.** The dot
     is the item where the item *is* a colour — a look, a sound. A clock face
     and an antic are neither, and both shelves drew the same accent dot on
     every tile: eight identical circles under eight different names, which is
     a decoration standing where a picture belongs. Distinctness is the point
     of the check — one drawing repeated is the same bug in a different hat. */
  const drawn = (tiles) => {
    if (!tiles.length) return 'no tiles';
    const art = tiles.map((t) => t.querySelector('svg.emb-ic'));
    if (art.some((a) => !a || a.innerHTML.trim().length < 20)) return 'not drawn';
    if (tiles.some((t) => t.querySelector('.emb-dot'))) return 'still a dot';
    const seen = new Set(art.map((a) => a.innerHTML));
    return seen.size === tiles.length ? '' : seen.size + ' drawings for ' + tiles.length + ' tiles';
  };
  await shopTab('faces');
  check('every clock face is drawn on its own tile, each one different',
    drawn([...$('emb-box').querySelectorAll('[data-face-pick]')]) === '',
    drawn([...$('emb-box').querySelectorAll('[data-face-pick]')]));
  await shopTab('antics');
  check('and so is every antic',
    drawn([...$('emb-box').querySelectorAll('[data-antic]')]) === '',
    drawn([...$('emb-box').querySelectorAll('[data-antic]')]));
  /* Both catalogues, at the source: one added without a drawing renders an
     empty square rather than failing, which is the kind of thing that ships. */
  for (const [name, re] of [['clock face', /const FACES = \[([\s\S]*?)\n {2}\];/],
                            ['antic', /const BUD_ANIMS = \[([\s\S]*?)\n {2}\];/]]) {
    const body = (html.match(re) || ['', ''])[1];
    const items = (body.match(/^ {4}\{(?:id|k):'/gm) || []).length;
    const arts = (body.match(/\n\s*ic:'/g) || []).length;
    check('every ' + name + ' in the catalogue carries a drawing',
      items > 0 && items === arts, arts + ' drawings for ' + items + ' ' + name + 's');
  }
  await shopTab('looks');
  // "12 more for x" while it is out of reach, "you can afford x" once it isn't
  check('with the next one either priced or offered',
    /more for late sun|afford late sun/.test($('emb-box').textContent),
    $('emb-box').textContent.slice(-90));
  // spamming short blocks must not move it
  const wasHave = +$('emb-box').dataset.have;
  $('stats-close').click();
  await wait(40);
  for (let i = 0; i < 16; i++) { click('skip'); await wait(24); }
  if (!$('setup').classList.contains('hide')) { click('begin'); await wait(80); }
  await wait(60);
  $('d-stats').click();
  await wait(120);
  check('and eight started-and-skipped blocks earn nothing',
    +$('emb-box').dataset.have === wasHave,
    `${$('emb-box').dataset.have} was ${wasHave}`);
  check('with the leftovers still under an ember',
    +$('emb-box').dataset.bank < 600, $('emb-box').dataset.bank);
  /* Real particles, each with its own everything. The first version tiled a
     gradient, which repeats — so it read as a marching grid rather than as
     weather. Nothing here may be identical to its neighbour. */
  check('the weather is made of particles, not a repeating tile',
    $('vfx').children.length > 12, `${$('vfx').children.length}`);
  check('and no two of them are alike', (() => {
    const specks = [...$('vfx').children];
    return new Set(specks.map((b) => b.getAttribute('style'))).size === specks.length;
  })(), `${new Set([...$('vfx').children].map((b) => b.getAttribute('style'))).size} distinct`);
  check('they are already in mid-flight, not all setting off at once',
    [...$('vfx').children].every((b) => parseFloat(b.style.getPropertyValue('--d')) <= 0),
    $('vfx').children[0].getAttribute('style'));
  check('and they fall away sharply from the middle of the screen', (() => {
    const css = [...window.document.querySelectorAll('style')].map((n) => n.textContent).join('\n')
      .replace(/\s+/g, ' ');
    /* The haze used to be a full-screen backdrop-filter, recomputed every frame
       over thirty moving specks. It is a painted gradient now — same falloff,
       no per-frame cost. */
    return /\.vfx\{[^}]*mask-image:radial-gradient/.test(css)
      && /\.vfx::after\{[^}]*background:radial-gradient/.test(css)
      && !/\.vfx::after\{[^}]*backdrop-filter/.test(css);
  })());
check('and the field is dropped entirely when nobody is looking', (() => {
    const css = [...window.document.querySelectorAll('style')].map((n) => n.textContent).join('\n')
      .replace(/\s+/g, ' ');
    return /\.vfx\.idle\{ ?display:none ?\}/.test(css);
  })());
check('no speck asks to be a compositing layer for the life of the page', (() => {
    const css = [...window.document.querySelectorAll('style')].map((n) => n.textContent).join('\n')
      .replace(/\s+/g, ' ');
    return !/\.vfx b\{[^}]*will-change/.test(css);
  })());
  // the dearest one on the shelf: tapping it must never spend anything by itself
  shelf()[shelf().length - 1].click();
  await wait(60);
  check('the dearest light asks before it spends anything',
    !$('confirm').classList.contains('hide'), $('confirm-title').textContent);
  $('confirm-no').click();
  await wait(60);
  check('and backing out leaves it locked, with the embers still there',
    $('emb-box').dataset.own === 'seaglass' && +$('emb-box').dataset.have === 600,
    `${$('emb-box').dataset.own} / ${$('emb-box').dataset.have}`);
}
$('stats-close').click();
await wait(60);

// Open it the way a user does — Arcade.show() sets Arcade.open, which the
// keyboard handlers guard on. Poking the class directly would skip that.
click('arcade-open');
await wait(80);
/* **The offer counts the shelf.** The button said "eight games" for as long as
   there were eight and then went on saying it — the same fault as the card
   count this file used to carry. Written from `GAMES` now, so the two cannot
   disagree. */
{
  const em = $('arcade-open').querySelector('.arcade-txt em');
  const cards = window.document.querySelectorAll('.pcard').length;
  const words = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
                 'eight', 'nine', 'ten', 'eleven', 'twelve'];
  check('the way in offers as many games as the shelf holds',
    !!em && em.textContent.indexOf(words[cards] + ' games') === 0,
    (em && em.textContent) + ' for ' + cards + ' cards');
}
check('arcade opens from the rest screen', !$('overlay').classList.contains('hide'));
check('and the way in sits above the transport, not under the note',
  (() => {
    const kids = [...$('timer').children];
    return kids.indexOf($('arcade-open')) < kids.indexOf($('timer').querySelector('.controls'))
      && kids.indexOf($('arcade-open')) < kids.indexOf($('rest-extra'));
  })());
const pcards = [...window.document.querySelectorAll('.pcard')];
/* Not a count. "Nine games" had to be re-typed the day a tenth shipped, and
   a number kept in step by hand is a number that eventually gets kept in step
   without anyone reading it. What actually matters is that the shelf is games:
   every card names one, and no game is on it twice. */
check('every card on the arcade shelf is a game, and each one only once',
  pcards.length >= 9 && pcards.every((c) => c.dataset.game)
  && new Set(pcards.map((c) => c.dataset.game)).size === pcards.length,
  pcards.map((c) => c.dataset.game || '?').join(','));
const byGame = Object.fromEntries(pcards.map((c) => [c.dataset.game, c]));
check('enabled games in picker', ['sudoku', 'wordle', 'g2048', 'tetris', 'crossword', 'hangman', 'scrabble', 'pictionary', 'chess', 'spymaster'].every((g) => byGame[g]), Object.keys(byGame).join(','));
/* **Spymaster is four to play, and the card and the start agree.** It used to
   start with one side staffed and the board playing the other, and its card
   said 2+ — true of that game. A 4+ card over a start that still let two
   people in would be wrong the other way round, so this asks both: what the
   shelf says, and what the lineup rule the start obeys will accept. */
{
  const tag = (byGame.spymaster && byGame.spymaster.querySelector('.tag') || {}).textContent;
  check('the Spymaster card says four to play', tag === '4+', tag);
  const L = window.__m.smLineup;
  const seat = (team, role) => ({ team, role });
  const two = L({ a: seat('red', 'spy'), b: seat('red', 'op') });
  const three = L({ a: seat('red', 'spy'), b: seat('red', 'op'), c: seat('blue', 'spy') });
  const four = L({ a: seat('red', 'spy'), b: seat('red', 'op'), c: seat('blue', 'spy'), d: seat('blue', 'op') });
  check('and one staffed side is not a game any more',
    two.mode === '' && three.mode === '', two.mode + ' / ' + three.mode);
  check('two staffed sides are',
    four.mode === 'duel', four.mode + ' ' + four.needs.join(' '));
  check('and a short side says what it is missing',
    three.needs.join(' ') === 'Blue needs somebody to guess.', three.needs.join(' '));
}
/* **One place on a card for icons.** Every card has a side column holding the
   icon slot above the status. The faces of whoever is on a game used to be
   pinned to the card's corner and covered the status; a card built without
   the slot is a card where the next icon has nowhere to go but on top of
   something. */
{
  const missing = pcards.filter((c) => {
    const side = c.querySelector(':scope > .pcard-side');
    const kids = side ? [...side.children].map((k) => k.className) : [];
    return !(kids[0] === 'pcard-icons' && /\bprog\b/.test(kids[1] || ''));
  }).map((c) => c.dataset.game);
  check('every card has an icon slot, above its status, in one side column',
    pcards.length > 0 && missing.length === 0, missing.join(', '));
}
/* **A message is readable over whatever it arrives on.** The pop-out's
   background was a glow fading into `--card`, which is a few percent of white,
   so a message over the arcade was printed on top of the game's own text. Asked
   of the stylesheet: jsdom resolves neither gradients nor custom properties. */
{
  let bg = '';
  for (const sheet of window.document.styleSheets) {
    let rules = [];
    try { rules = [...sheet.cssRules]; } catch (e) { continue; }
    for (const r of rules) if (r.selectorText === '.chat-pop' && r.style.background) bg = r.style.background;
  }
  check('the message pop-out sits on a solid ground, not on glass',
    /,\s*var\(--bg\)\s*$/.test(bg) && !/var\(--card\)/.test(bg), bg);
}
check('memory is disconnected', !byGame.memory);

/* ---- the setup screen ----
   One serif line, one number that matters, and no explanatory paragraph. */
check('the setup screen has no second typeface on it at all', (() => {
  const serif = [...window.document.querySelectorAll('#setup *')]
    .filter((el) => /Fraunces/.test(window.getComputedStyle(el).fontFamily));
  return serif.length === 0;
})(), [...window.document.querySelectorAll('#setup *')]
  .filter((el) => /Fraunces/.test(window.getComputedStyle(el).fontFamily))
  .map((el) => el.tagName).join(','));
check('and no heading at all — the number is the point',
  !window.document.querySelector('#setup .lede'));
check('the decorative tag is gone', !window.document.querySelector('#setup .field .tag'));
check('the minutes are the biggest thing on it',
  window.document.querySelector('#setup .field').classList.contains('hero'));

/* ---- and it scrolls ----
   The two dropdowns were scroll containers with overscroll-behavior:contain, so
   a drag inside either of them stopped dead instead of moving the page. */
{
  const css = [...window.document.querySelectorAll('style')].map((n) => n.textContent).join('\n')
    .replace(/\s+/g, ' ');
  check('the setup dropdowns are not scroll boxes of their own',
    !/\.drop-body\{[^}]*overflow-y/.test(css) && !/,\s*\.drop-body\{[^}]*overflow-y:auto/.test(css));
  check('and have no height cap to scroll within', !/\.drop-body\{[^}]*max-height/.test(css));
  /* And the setup screen is not one either. `.app` is the only scroll box on
     the timer side — see the note in 13-drawer.css. A second one nested inside
     it, with overscroll-behavior:contain, is what "the main menu won't scroll"
     turned out to be: the drag scrolled the inner box to its end and stopped,
     because contain is the rule that says don't pass this on. */
  check('and the screen they sit on is not a scroll box either',
    window.getComputedStyle($('setup')).overflowY === 'visible',
    window.getComputedStyle($('setup')).overflowY);
  check('the shell is the one thing that scrolls',
    window.getComputedStyle($('app')).overflowY === 'auto',
    window.getComputedStyle($('app')).overflowY);
}

// Solo and shared games are separated, and the shared ones are marked, so it's
// clear before you tap which ones need somebody else.
const groups = [...window.document.querySelectorAll('.pick-group')];
check('the picker is split into groups', groups.length === 2, `${groups.length}`);
check('and says which is which', /On your own/.test(groups[0].textContent) && /Together/.test(groups[1].textContent),
  groups.map((g) => g.textContent).join(' / '));
check('every shared game is marked as needing a room',
  ['hangman', 'scrabble', 'pictionary', 'chess'].every((g) => byGame[g].classList.contains('needs-room') && byGame[g].querySelector('.tag')));
check('chess says it takes two', byGame.chess.querySelector('.tag').textContent === '2',
  byGame.chess.querySelector('.tag').textContent);
check('and no solo game is', ['sudoku', 'wordle', 'g2048', 'tetris', 'crossword'].every((g) => !byGame[g].classList.contains('needs-room')));

/* **Said once, not three times in the same corner.** The group heading above
   these four says "needs a room", the card's own chip says how many people, and
   the status used to say "ROOM / NEEDS A ROOM" as well — all stacked on top of
   each other, because the chip is pinned top-right and so is the status. The
   chip moved into the title line and the status says nothing at all. */
check('the heading is where "needs a room" is said', /needs a room/i.test(groups[1].textContent),
  groups[1].textContent);
for (const g of ['hangman', 'scrabble', 'pictionary', 'chess']) {
  check(`${g} card does not repeat it`, $('prog-' + g).textContent.trim() === '',
    $('prog-' + g).textContent);
}
check('and the room-size chip sits in the title, clear of the status',
  ['hangman', 'scrabble', 'pictionary', 'chess'].every((g) => {
    const tag = byGame[g].querySelector('.tag');
    return tag && tag.parentElement.tagName === 'H3'
      && window.getComputedStyle(tag).position === 'static';
  }),
  byGame.chess.querySelector('.tag').parentElement.tagName);
byGame.hangman.click();
await wait(60);
check('hangman offers the way into a room', !$('hm-need').classList.contains('hide') && $('hm-live').classList.contains('hide'));
click('ov-back');
await wait(40);
byGame.scrabble.click();
await wait(60);
check('scrabble offers the way into a room', !$('sc-need').classList.contains('hide') && $('sc-live').classList.contains('hide'));
click('ov-back');
await wait(40);

// sudoku
byGame.sudoku.click();
await wait(250);
check('sudoku grid built', $('sdk-grid').children.length === 81, `${$('sdk-grid').children.length} cells`);
const givens = [...$('sdk-grid').children].filter((c) => c.textContent.trim() !== '').length;
check('sudoku has givens', givens > 15 && givens < 70, `${givens}`);
const emptyCell = [...$('sdk-grid').children].find((c) => !c.classList.contains('given'));
if (emptyCell) { emptyCell.click(); $('sdk-pad').children[0].click(); }
check('sudoku accepts input', true);

// wordle
byGame.wordle.click();
await wait(250);
check('wordle board built', $('wdl-board').children.length >= 5, `${$('wdl-board').children.length} rows`);
for (const ch of 'crane') window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: ch }));
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
await wait(150);
check('wordle registered the typed guess', /^[1-6]\/6$|Solved|Missed/.test($('wdl-meta').textContent.trim()), $('wdl-meta').textContent);

/* ---- tetris ----

   Two things separate this from something merely shaped like Tetris, and both
   are invisible in a screenshot:

     * **the seven-bag.** Pieces are not random. Each bag holds one of every
       shape, shuffled, and is emptied before the next is made — so an I can
       never be twenty pieces away and planning is a skill rather than a hope.
     * **the kicks.** A rotation that would overlap something is nudged and
       retried in the standard order, which is what lets a piece turn in a
       notch. Without a kick table it simply refuses, and the game feels stiff
       in a way nobody can quite name.

   Both are checked here because both would go quietly wrong. */
byGame.tetris.click();
await wait(300);
{
  const T = window.__m.Tetris;
  check('tetris board built', $('tet-grid').children.length === 200,
    `${$('tet-grid').children.length} cells`);
  T.newGame();
  await wait(80);
  check('and it starts with a piece on it and more coming',
    !!T.piece && T.queue.length >= 3, `${T.piece && T.piece.k} / ${T.queue.length}`);
  /* **Visible from the first frame.** It used to spawn in the two hidden rows,
     so for the first two drops the only thing on screen was a ghost with
     nothing casting it. */
  const drawn = () => [...$('tet-grid').children].filter((c) => /\bon\b/.test(c.className)).length;
  check('the piece can be seen as soon as it appears', drawn() === 4, `${drawn()} squares`);

  /* The bag is ten: one of every shape, plus three of them again, shuffled.
     The seven are the guarantee — every shape turns up in every bag, so no
     drought can run long — and the three spares are what stop the tail of a
     bag being deducible, which a plain seven-bag gives away entirely. */
  const seen = [];
  for (let i = 0; i < 60; i++) { seen.push(T.piece.k); T._spawn(); }
  const whole = (a) => new Set(a).size === 7;
  check('every shape turns up in every bag of ten',
    [0, 10, 20, 30, 40, 50].every((i) => whole(seen.slice(i, i + 10))),
    seen.join(''));
  /* **What that buys is a bounded drought.** Every shape appears in every bag
     of ten, so the furthest two sightings can be is first-of-one-bag to
     last-of-the-next: nineteen apart, eighteen other pieces in between. That
     is the promise a player actually feels; the bag is only how it is kept. */
  const gaps = {};
  let worst = 0;
  seen.forEach((k, i) => {
    if (gaps[k] !== undefined) worst = Math.max(worst, i - gaps[k]);
    gaps[k] = i;
  });
  check('so no shape is ever more than eighteen pieces away', worst <= 19, `${worst}`);
  /* And it is not a fixed cycle: three of the ten are drawn again, so the same
     bag position is not the same shape every time. */
  const firsts = [0, 10, 20, 30, 40, 50].map((i) => seen[i]);
  check('and the bags are not all the same bag', new Set(firsts).size > 1,
    firsts.join(''));

  /* The kick. One square placed exactly where the turned T wants to go, so
     turning on the spot fails and the table's next offer — one to the left —
     is what succeeds. */
  T.newGame();
  T.grid[12 * 10 + 5] = 'L';
  T.piece = { k: 'T', r: 0, x: 4, y: 10 };
  check('a piece can be turned where there is room', T._fits(T.piece));
  check('and turning on the spot into something solid is refused',
    !T._fits({ k: 'T', r: 1, x: 4, y: 10 }));
  const turned = T.rotate(1);
  check('so it steps aside and turns anyway',
    turned && T.piece.r === 1 && T.piece.x === 3 && T._fits(T.piece),
    JSON.stringify(T.piece));

  /* A full row goes, the rows above come down, and it is worth something. */
  T.newGame();
  for (let x = 0; x < 9; x++) T.grid[21 * 10 + x] = 'J';
  T.grid[20 * 10 + 3] = 'S';                       // a square that must fall a row
  T.piece = { k: 'I', r: 1, x: 7, y: 2 };
  const score0 = T.score;
  T.hardDrop();
  await wait(60);
  check('a full row is taken away', T.lines === 1, `${T.lines} lines`);
  check('and what was above it comes down one', T.grid[21 * 10 + 3] === 'S',
    `${T.grid[21 * 10 + 3]} / ${T.grid[20 * 10 + 3]}`);
  check('and it is worth points', T.score > score0, `${score0} -> ${T.score}`);

  /* **A new piece hangs before gravity takes it.**

     By level eight a row takes 130ms and by twelve it is 80 — less time than it
     takes to decide where a piece goes, let alone move it there. Without this
     the game stops being about placing pieces at all. The beat is fixed rather
     than scaled by level, because the whole point is that there is always
     enough time to *start* the move. */
  {
    T.newGame();
    await wait(60);
    /* A named piece, not whatever the bag deals: the O does not turn at all
       (quite correctly), so a random draw makes the rotation check a coin
       toss rather than a check. */
    T._spawn('T');
    const y0 = T.piece.y;
    T.score = 200000;                              // top speed: a row every 50ms
    T.last = Date.now() - 150;                     // 150ms of it, spent hanging
    T._step();
    check('a new piece does not fall while it hangs', T.piece.y === y0,
      `${y0} -> ${T.piece.y}`);
    /* And the hang is *for* moving, not a wait to sit through. */
    const x0 = T.piece.x;
    check('but it can still be moved during it', T._move(-1, 0) && T.piece.x === x0 - 1,
      `${x0} -> ${T.piece.x}`);
    check('and turned', T.rotate(1) && T.piece.r === 1, `${T.piece.r}`);
    T.last = Date.now() - 400;                     // past the beat now
    T._step();
    check('and once the beat is over it falls again', T.piece.y > y0,
      `${y0} -> ${T.piece.y}`);
    /* A hard drop is a decision already made, so it cuts straight through. */
    T.newGame();
    await wait(60);
    T.hardDrop();
    check('a hard drop goes through the hang rather than waiting it out',
      !!T.piece && T.lines === 0 && T.grid.some((c) => c), 'nothing landed');
    T.score = 0;
  }

  /* **The speed follows the score, not the line count.** Forty singles used to
     take you to the same speed as ten tetrises for a quarter of the points,
     which made the two ways of playing feel identical. Level n starts at
     400·n·(n+1). */
  {
    const at = (v) => { T.score = v; return T.level(); };
    check('a fresh board is level one', at(0) === 1 && at(799) === 1, `${at(0)}/${at(799)}`);
    check('one tetris is worth a level', at(800) === 2, `${at(800)}`);
    check('and the rungs stretch out after that',
      at(2400) === 3 && at(4800) === 4 && at(8000) === 5,
      `${at(2400)}/${at(4800)}/${at(8000)}`);
    check('and it stops where the drop table does', at(1e9) === 17, `${at(1e9)}`);
    T.score = 0;
  }

  /* **Which rows were full is not the same as where they were removed.**
     Taking a row out drops everything above it, so a single pass that splices
     as it goes reports the same index once per row cleared — four rows came
     back as [21,21,21,21], and the tetris flashed as one row. This is that
     bug, pinned. */
  {
    T.newGame();
    for (const y of [18, 19, 20, 21]) for (let x = 0; x < 10; x++) T.grid[y * 10 + x] = 'J';
    const n = T._clear();
    check('four full rows are four rows', n === 4, `${n}`);
    check('and each is named once, at where it actually was',
      JSON.stringify(T.went) === '[18,19,20,21]', JSON.stringify(T.went));
    check('and the board is empty afterwards',
      T.grid.every((c) => !c), T.grid.filter((c) => c).length + ' left');

    /* Rows with a gap between them clear too, and keep their own places. */
    T.newGame();
    for (const y of [17, 21]) for (let x = 0; x < 10; x++) T.grid[y * 10 + x] = 'L';
    T.grid[19 * 10 + 4] = 'S';                    // a lone square between them
    T._clear();
    check('rows that are not touching each other keep their own places',
      JSON.stringify(T.went) === '[17,21]', JSON.stringify(T.went));
    check('and what was between them survives, one row lower',
      T.grid[20 * 10 + 4] === 'S', `${T.grid[20 * 10 + 4]}`);
  }

  /* **Nowhere to put the next piece is how it ends** — not a height rule. */
  T.newGame();
  for (let i = 0; i < T.grid.length; i++) T.grid[i] = 'L';
  T._spawn();
  await wait(60);
  check('a stack with no room left ends the game', T.done === true && !T.piece,
    `${T.done} / ${!!T.piece}`);
  check('and it says so', !$('tet-banner').classList.contains('hide'),
    $('tet-banner').className);

  /* **Pausing stops it; resuming counts you in first.**

     Unpausing used to drop you straight into a piece you had stopped thinking
     about, which at level ten is a piece already halfway down. So a resume gets
     three seconds and a pause gets none: one is a decision you just made, the
     other is a thing about to happen to you. Nothing moves during the count,
     or the grace would be a free go at rearranging the board. */
  T.newGame();
  T.pause(true);
  check('pausing stops the clock', !T.running() && T.paused === true,
    `${T.running()} / ${T.paused}`);
  T.pause(false);
  check('resuming does not start it straight away',
    !T.running() && T.count === 3, `${T.running()} / ${T.count}`);
  check('it counts you in, on the board', !!$('tet-count')
    && /3/.test($('tet-count').textContent), $('tet-count') ? $('tet-count').textContent : 'no count');
  const frozen = T.piece && { x: T.piece.x, r: T.piece.r };
  T._move(-1, 0); T.rotate(1); T.hardDrop();
  check('and nothing moves while the numbers are up',
    !!T.piece && T.piece.x === frozen.x && T.piece.r === frozen.r,
    JSON.stringify(T.piece));
  await wait(3300);
  check('then it starts', T.running() && T.count === 0 && !$('tet-count'),
    `${T.running()} / ${T.count}`);

  /* A focus block starting takes the board away, because the arcade is for
     breaks and a piece falling behind a block is a stack you did not build. */
  T.pause(false);
  window.__m.startTimer();
  await wait(60);
  check('starting a focus block pauses the game', T.paused === true && !T.running(),
    `${T.paused} / ${T.running()}`);
  window.__m.pauseTimer();
  await wait(40);

  /* **Opening the board does not un-pause it.** `enter()` used to set
     `paused = false`, which threw away every reason the game had been stopped:
     a focus block paused it, and reopening the arcade mid-block — to look
     something up — had it running behind the timer again. The rule is the
     timer's: stopped during a block, counted back in at any other time. */
  window.__m.startTimer();
  await wait(60);
  T.leave();
  await T.enter();
  await wait(80);
  check('reopening it during a focus block leaves it stopped',
    T.paused === true && !T.running(), `${T.paused} / ${T.running()}`);
  /* **And a paused board is put away.** Half the game is working out where the
     next piece goes; a stopped board is that puzzle with the clock off. */
  check('and the board is put away rather than left up',
    $('tet-grid').classList.contains('away'), $('tet-grid').className);

  window.__m.pauseTimer();
  await wait(60);

  /* **Going back to the shelf puts it down.** Leaving only stopped the clock,
     so the board came back exactly as it was with no sign that time had passed
     — and returning to a piece mid-fall you last saw ten minutes ago is the
     same surprise as never having paused. */
  T.pause(false);
  await wait(3300);
  check('a running board really is running', T.running() && !T.paused,
    `${T.running()} / ${T.paused}`);
  T.leave();
  check('and going back to the shelf pauses it', T.paused === true && !T.running(),
    `${T.paused} / ${T.running()}`);

  await T.enter();
  await wait(80);
  check('but out of a block it counts you back in on its own',
    T.count === 3 && T.paused === false, `${T.count} / ${T.paused}`);
  check('and the board comes back for the count-in',
    !$('tet-grid').classList.contains('away'), $('tet-grid').className);
  await wait(3300);
  check('and then simply runs', T.running() && T.count === 0,
    `${T.running()} / ${T.count}`);

  T.pause(true);
  T.pause(false);
  T.leave();
  check('and leaving the arcade stops the count-in too',
    !T.running() && T.count === 0 && !$('tet-count'), `${T.running()} / ${T.count}`);
}

// 2048
byGame.g2048.click();
await wait(250);
/* Two layers: sixteen slots that never move, and a tile per number over them.
   The tiles are what animate, so they are elements in their own right rather
   than the text of a cell — see the note at the top of 22-2048.js. */
const slots = [...window.document.querySelectorAll('.g2048-slots .slot')];
const liveTiles = () => [...$('g2048-tiles').children];
check('2048 grid built', slots.length === 16, `${slots.length} slots`);
check('2048 starts with two tiles', liveTiles().length === 2, `${liveTiles().length}`);
check('and each one is placed on a square rather than laid out by the grid',
  liveTiles().every((t) => t.style.getPropertyValue('--c') !== '' && t.style.getPropertyValue('--r') !== ''),
  liveTiles()[0] && liveTiles()[0].getAttribute('style'));
const spot = (t) => t.dataset.v + '@' + t.style.getPropertyValue('--c') + ',' + t.style.getPropertyValue('--r');
const beforeMove = liveTiles().map(spot).sort().join(' ');
for (const key of ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp']) {
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key }));
  await wait(180);           // longer than the slide, so each move has landed
}
const afterMove = liveTiles().map(spot).sort().join(' ');
check('2048 board responds to arrow keys', afterMove !== beforeMove, afterMove);
check('a tile keeps its element across a move, which is what lets it animate',
  (() => {
    const css = [...window.document.querySelectorAll('style')].map((n) => n.textContent).join('\n')
      .replace(/\s+/g, ' ');
    return /\.g2048 \.t\{[^}]*transition:transform/.test(css);
  })());
check('and the tiles still say what the board says',
  (() => {
    const board = JSON.parse(window.localStorage.getItem('arcade_2048') || '{}').board || [];
    return liveTiles().length === board.filter((v) => v).length;
  })(),
  `${liveTiles().length} tiles`);
check('2048 score shown', /Score \d+ · Best \d+/.test($('g2048-meta').textContent), $('g2048-meta').textContent);

// --- crossword ---------------------------------------------------------------
// Puzzles now come from a fixed bank rather than a runtime generator, so what
// there is to check has changed: the *shape* is a given, and what matters is
// that the app reads it correctly, keeps progress per puzzle, and that a
// revealed letter behaves differently from one you worked out.
byGame.crossword.click();
await wait(300);

const cwState = () => JSON.parse(window.localStorage.getItem('arcade_cross') || 'null');
/* Progress is filed under a hash of the puzzle, never its position in the bank
   — see crossKey(). Adding a puzzle inside its size group shifts every index
   after it, and back when this was keyed on the index that silently loaded one
   puzzle's letters into another. `key` is the current puzzle's name. */
const cwRec = () => (cwState().p || {})[cwState().key] || {};
const cwCell = (i) => [...$('cw-grid').children][i];
const cwN = () => Math.round(Math.sqrt($('cw-grid').children.length));

check('a puzzle from the bank is on screen', $('cw-grid').querySelectorAll('.cw-cell').length > 8,
  `${$('cw-grid').querySelectorAll('.cw-cell').length} squares`);
check('the grid is square', cwN() * cwN() === $('cw-grid').children.length, `${$('cw-grid').children.length}`);
check('it has walls', $('cw-grid').querySelectorAll('.cw-block').length >= 0);
check('progress is kept per puzzle, not as one board', !!cwState() && typeof cwState().p === 'object'
  && typeof cwState().idx === 'number', JSON.stringify(cwState()).slice(0, 80));
/* **A puzzle is a date, not "#11 of 11".** The position in the bank is what
   decides that date and is still what the code works in; it just says nothing
   worth reading, now that every puzzle has a day. */
check('the meta line names the size and the day', /^\d+×\d+ · (Today|\w{3} \d+) · \d{2}:\d{2}$/.test($('cw-meta').textContent),
  $('cw-meta').textContent);
check('and not its place in the bank', !/#\d+ of \d+/.test($('cw-meta').textContent),
  $('cw-meta').textContent);
check('difficulty is gone', !window.document.getElementById('cw-ctrl'));
check('and the puzzle it is on is named by content, not by position',
  typeof cwState().key === 'string' && /^\d+-/.test(cwState().key), String(cwState().key));

// Every white square must be reachable both ways — that is what the generator
// promises, and the app has to agree with it.
{
  const n = cwN();
  const white = [...$('cw-grid').children].map((el, i) => ({ el, i }))
    .filter((x) => x.el.classList.contains('cw-cell'));
  let bothWays = 0;
  for (const { i } of white) {
    const row = Math.floor(i / n), col = i % n;
    const across = [...$('cw-clues').querySelectorAll('[data-dir="A"]')].length;
    if (across) bothWays++;
    void row; void col;
  }
  check('every square is a real cell or a wall',
    white.length + $('cw-grid').querySelectorAll('.cw-block').length === n * n);
  check('there are clues in both directions',
    $('cw-clues').querySelectorAll('[data-dir="A"]').length > 0
    && $('cw-clues').querySelectorAll('[data-dir="D"]').length > 0,
    `${$('cw-clues').querySelectorAll('[data-dir="A"]').length}A / ${$('cw-clues').querySelectorAll('[data-dir="D"]').length}D`);
  check('clue lists show letter counts',
    [...$('cw-clues').querySelectorAll('.cw-clue-item i')].every((x) => /^\(\d+\)$/.test(x.textContent)),
    `${$('cw-clues').querySelectorAll('.cw-clue-item i').length} items`);
  check('every clue is a real clue, not the answer echoed back',
    [...$('cw-clues').querySelectorAll('.cw-clue-item span')].every((x) => x.textContent.trim().length > 4));
}

/* --- the bank itself, read straight out of the build ---------------------
   The nines are the barred puzzles, and they are the ones a bad word list
   shows up in: every letter is checked twice there, so an obscure answer is
   two unfair clues rather than one. Walking them here rather than through the
   UI means all ten are checked, not whichever one the session opened on. */
{
  /* A clue is either a string or a list of alternatives — an answer that turns
     up in more than one puzzle gets a different clue each time rather than the
     same one twice. Both shapes are read here, and every alternative is held to
     the same standards as a lone clue. */
  const clues = {};
  const cm = html.match(/const CROSS_CLUES = \{([\s\S]*?)\n {2}\};/);
  for (const m of cm[1].matchAll(/^ {4}(\w+):'((?:[^'\\]|\\.)*)'/gm)) clues[m[1]] = [m[2]];
  for (const m of cm[1].matchAll(/^ {4}(\w+):\[([^\]]*)\]/gm)) {
    clues[m[1]] = [...m[2].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1]);
  }

  /* The object shape means *barred*, which is not the same thing as nine-by-nine
     — and reading it as though it were cost an afternoon. Two sevens shipped
     without their v/h bar maps and parsed as nonsense; repairing them meant
     giving them those maps, which turned them from a plain row array into this
     shape. Matching on the shape alone then swept both of them in here and
     gap-checked seven-letter answers against the nines, which reported three
     repeats in a bank that had none. Filter on the row count instead — that is
     what the app itself does in crossAtSize(), and the test should bucket a
     puzzle the same way the picker does. */
  const barred = [...html.matchAll(/\{r:\[([^\]]*)\],\s*v:\[([^\]]*)\],\s*h:\[([^\]]*)\]\}/g)]
    .map((m) => m.slice(1, 4).map((s) => s.split(',').map((x) => x.replace(/'/g, ''))))
    .map(([r, v, h]) => ({ r, v, h }));
  const nines = barred.filter((g) => g.r.length === 9);
  /* At least ten, and however many more the bank has grown to — the counts are
     not a design decision, they are however many closed. What is fixed is that
     nothing ships with fewer than ten of a size. */
  check('at least ten barred nine-by-nines in the bank', nines.length >= 10, `${nines.length}`);

  const answers = (g) => {
    const n = g.r.length;
    const wall = (r, c) => r < 0 || c < 0 || r >= n || c >= n || g.r[r][c] === '#';
    const cutL = (r, c) => c <= 0 || wall(r, c - 1) || g.v[r][c] === '1';
    const cutT = (r, c) => r <= 0 || wall(r - 1, c) || g.h[r][c] === '1';
    const out = [];
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (wall(r, c)) continue;
        if (cutL(r, c)) {
          let w = '';
          for (let k = c; k < n && !wall(r, k) && (k === c || !cutL(r, k)); k++) w += g.r[r][k];
          if (w.length >= 3) out.push(w);
        }
        if (cutT(r, c)) {
          let w = '';
          for (let k = r; k < n && !wall(k, c) && (k === r || !cutT(k, c)); k++) w += g.r[k][c];
          if (w.length >= 3) out.push(w);
        }
      }
    }
    return out;
  };

  const all = nines.map(answers);
  check('every nine is a full grid of entries', all.every((a) => a.length >= 18),
    all.map((a) => a.length).join(','));
  check('and no puzzle repeats an answer inside itself',
    all.every((a) => new Set(a).size === a.length));
  const flat = [...new Set(all.flat())];
  check('every answer in them has a clue',
    flat.every((w) => clues[w] && clues[w].length), flat.filter((w) => !clues[w]).slice(0, 6).join(' '));
  check('no clue is the answer wearing a hat',
    flat.every((w) => (clues[w] || []).every((c) => c.toLowerCase().indexOf(w) < 0)),
    flat.filter((w) => (clues[w] || []).some((c) => c.toLowerCase().indexOf(w) >= 0)).slice(0, 4).join(' '));
  check('and every clue is short enough to read at a glance',
    flat.every((w) => (clues[w] || []).every((c) => c.length <= 58)),
    flat.filter((w) => (clues[w] || []).some((c) => c.length > 58)).slice(0, 3).join(' '));
  /* The words themselves. Anything the bank reached for when it was allowed to
     fill from the far end of the dictionary — if one of these is back, the
     word list has slipped. */
  const CROSSWORDESE = ['anoa', 'aba', 'ane', 'benne', 'ganef', 'imaret', 'teredo', 'ctenoid',
    'egger', 'enate', 'ariose', 'stele', 'affine', 'etui', 'erne', 'olio', 'alee', 'agar',
    'taro', 'ascot', 'seta', 'baas', 'apogee', 'ocher', 'cilium', 'elute'];
  check('and none of the old crosswordese is back',
    !flat.some((w) => CROSSWORDESE.includes(w)),
    flat.filter((w) => CROSSWORDESE.includes(w)).join(' '));
  check('nothing longer than the grid or shorter than three',
    flat.every((w) => w.length >= 3 && w.length <= 9));

  /* Nothing comes back in the puzzle immediately before it, at its size.

     Retiring a word after so many uses spreads it out across thirty puzzles and
     does nothing about two in a row, which is the repetition you actually
     notice — so the rule is about neighbours, not about a quota.

     **The number is `GAP` in `tools/build-crosswords.py`, and it is 2.** This
     said 4, which the bank was built to once and has not been for a while: "the
     list does not run out: GAP is 2, so only the immediately preceding puzzle's
     answers are blocked at a size. Words recycle by design." A check asserting a
     retired rule is worse than no check — it fails on data that is exactly
     right, which is a release blocked by a test that is wrong, and after the
     second time nobody reads the failure. Against today's bank: 0 breaches at
     2, 27 at 3, 36 at 4. If that number moves in the generator, move it here. */
  const GAP = 2;
  /* Walk CROSS_GRIDS once, in document order, taking both shapes as they come —
     because that is the order crossAtSize() hands puzzles to a session, and
     "inside four puzzles" means four as the solver meets them. The earlier
     version kept the shapes apart and started from `{9: nines}`, which quietly
     asserted that every barred grid is a nine. A barred seven belongs with the
     sevens; what decides that is the row count, never the shape. */
  const gm = html.match(/const CROSS_GRIDS = \[([\s\S]*?)\n {2}\];/);
  const zeros = (rows) => rows.map(() => '0'.repeat(rows.length));
  const cells = (s) => s.split(',').map((x) => x.replace(/'/g, '').trim());
  const entry = /\{r:\[([^\]]*)\],\s*v:\[([^\]]*)\],\s*h:\[([^\]]*)\]\}|\n {4}\[('[a-z#]{3,}'(?:,'[a-z#]{3,}')*)\],/g;
  const bySize = {};
  const shapes = [];   // exactly as stored, so crossKey() sees what the app sees
  for (const m of gm[1].matchAll(entry)) {
    let g;
    if (m[1] !== undefined) g = { r: cells(m[1]), v: cells(m[2]), h: cells(m[3]) };
    else { const r = cells(m[4]); g = { r, v: zeros(r), h: zeros(r) }; }
    shapes.push(m[1] !== undefined ? g : cells(m[4]));
    (bySize[g.r.length] = bySize[g.r.length] || []).push(answers(g));
  }

  /* Saved progress is filed under crossKey(), so two puzzles sharing a name
     would load one's letters into the other — the exact failure that keying on
     the array index used to cause. Run the real function over the real bank
     rather than trusting the hash: this is cheap and the bug it guards against
     is invisible until somebody's grid fills up with the wrong answers. */
  {
    const km = html.match(/function crossKey\(g\)\{[\s\S]*?\n {2}\}/);
    check('crossKey survives in the build', !!km);
    // Pulled out of the build and run for real rather than reimplemented here:
    // a copy in the test could agree with itself while disagreeing with the app.
    const crossKey = km
      ? new Function('crossRows', `${km[0]}\nreturn crossKey;`)((g) => (Array.isArray(g) ? g : g.r))
      : () => Math.random();
    const seen = new Map();
    const clashes = [];
    shapes.forEach((g, i) => {
      const k = crossKey(g);
      if (seen.has(k)) clashes.push(`#${seen.get(k)} and #${i} both ${k}`);
      else seen.set(k, i);
    });
    check('every puzzle in the bank has its own name', clashes.length === 0,
      clashes.slice(0, 3).join(' | '));
    check('and the name carries the size, so sizes can never share one',
      shapes.every((g) => crossKey(g).split('-')[0] === String((Array.isArray(g) ? g : g.r).length)));
    /* The point of the whole change: a puzzle's name must not move when the
       bank grows. Inserting at the front shifts every index by one and must
       leave all the names alone. */
    const before = shapes.map(crossKey);
    const after = [shapes[shapes.length - 1]].concat(shapes).map(crossKey).slice(1);
    check('and inserting a puzzle does not rename the rest',
      before.join() === after.join());

    /* `_migrate()` is what repairs a save written under the old index-keyed
       scheme, so it has to be held to both halves of its job: rescue the
       records that are still good, bin the ones that now point at the wrong
       puzzle. Pulled out of the build and run for real, same as crossKey. */
    const mm = html.match(/_migrate\(p\)\{[\s\S]*?\n {4}\}/);
    check('_migrate survives in the build', !!mm);
    if (mm) {
      const rowsOf = (g) => (Array.isArray(g) ? g : g.r);
      const migrate = new Function('CROSS_GRIDS', 'crossRows', 'crossKey',
        `return function ${mm[0]};`)(shapes, rowsOf, crossKey);
      const solOf = (i) => rowsOf(shapes[i]).join('').toUpperCase();
      const nine = shapes.findIndex((g) => rowsOf(g).length === 9);
      const five = shapes.findIndex((g) => rowsOf(g).length === 5);
      const five2 = shapes.findIndex((g, i) => rowsOf(g).length === 5 && i > five);

      // solved, and still the puzzle it was solved on: kept, under its new name
      const solved = migrate({ [five]: { u: solOf(five), secs: 90, done: true } });
      check('_migrate keeps a record that still matches its puzzle',
        Object.keys(solved).length === 1 && solved[crossKey(shapes[five])]
        && solved[crossKey(shapes[five])].done === true, Object.keys(solved).join(','));

      // the reported bug: an index that now points at a puzzle of another size
      check('_migrate drops a record whose size no longer fits',
        Object.keys(migrate({ [five]: { u: solOf(nine), secs: 10 } })).length === 0);

      // right size, but the letters belong to a different puzzle
      const foreign = solOf(five2);
      check('_migrate drops right-sized letters from another puzzle',
        Object.keys(migrate({ [five]: { u: foreign, secs: 10 } })).length === 0
        || foreign === solOf(five));

      // a few wrong guesses is somebody solving, not corruption
      const partial = solOf(five).split('');
      for (let i = 0; i < partial.length; i += 7) if (partial[i] !== '#') partial[i] = 'Z';
      check('_migrate keeps a part-solved grid with some wrong guesses',
        Object.keys(migrate({ [five]: { u: partial.join(''), secs: 30 } })).length === 1,
        partial.join(''));

      // a revealed square came *from* the answer, so one disagreeing is proof
      const bad = solOf(five).replace(/[A-Z]/, 'Z');
      const at = bad.split('').findIndex((ch, i) => ch !== solOf(five)[i]);
      check('_migrate drops a record whose revealed square disagrees',
        Object.keys(migrate({ [five]: { u: bad, g: [at], secs: 5 } })).length === 0);

      // already converted: left exactly as it is, not re-examined
      const fp = crossKey(shapes[five]);
      const done = migrate({ [fp]: { u: '.....', secs: 1 } });
      check('_migrate leaves an already-named record alone',
        done[fp] && done[fp].secs === 1 && Object.keys(done).length === 1);
    }
  }
  /* **Every puzzle is at a size somebody can choose**, which is the invariant
     that direction round. This read `=== '5,7,9'`, and the bank grew fifteens —
     so a check meant to catch a stranded puzzle started failing because of a
     new feature working, and it can never pass again as written. The picker
     builds its own row of sizes and disables the ones the bank has nothing at,
     so a size with no puzzles is already handled; what nothing else would catch
     is a puzzle at a size the picker never offers, which no one could ever
     open. Read the row rather than naming the sizes twice. */
  {
    const offered = [...$('cw-size').children].map((b) => +b.dataset.s);
    const stranded = Object.keys(bySize).map(Number).filter((n) => !offered.includes(n));
    check('every puzzle in the bank is at a size the picker offers',
      offered.length > 0 && stranded.length === 0,
      stranded.length ? `${stranded.join(',')} vs ${offered.join(',')}` : 'no size row');
  }
  check('and at least ten of every size',
    bySize[5].length >= 10 && bySize[7].length >= 10 && bySize[9].length >= 10,
    `${bySize[5].length}/${bySize[7].length}/${bySize[9].length}`);
  const breaches = [];
  for (const size of Object.keys(bySize)) {
    const list = bySize[size];
    for (let i = 0; i < list.length; i++) {
      for (let j = Math.max(0, i - GAP + 1); j < i; j++) {
        for (const w of list[i]) if (list[j].includes(w)) breaches.push(`${size}: ${w} in #${j + 1} and #${i + 1}`);
      }
    }
  }
  check('no answer comes back inside four puzzles at its size',
    breaches.length === 0, breaches.slice(0, 5).join(' | '));
  const everyAnswer = [...new Set(Object.values(bySize).flat(2))];
  check('and every answer anywhere in the bank has a clue',
    everyAnswer.every((w) => clues[w] && clues[w].length),
    everyAnswer.filter((w) => !clues[w]).slice(0, 8).join(' '));
}

// direction: typing goes the way the button says
{
  const first = $('cw-grid').querySelector('.cw-cell');
  first.click();
  await wait(30);
  const dirLabel = () => $('cw-dir').textContent.trim();
  check('direction is shown on screen', /^(Across →|Down ↓)$/.test(dirLabel()), dirLabel());
  const before = dirLabel();
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ' }));
  await wait(40);
  check('space flips direction', dirLabel() !== before || $('cw-dir').disabled, `${before} -> ${dirLabel()}`);
  if (dirLabel() !== 'Across →') { $('cw-dir').click(); await wait(30); }

  // Pick an across entry from the clue list — that both selects its first cell
  // and sets the direction, so there is no guessing about which way we're facing.
  $('cw-clues').querySelector('[data-dir="A"]').click();
  await wait(40);
  check('choosing an across clue faces across', $('cw-dir').textContent.trim() === 'Across →',
    $('cw-dir').textContent);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'q' }));
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z' }));
  await wait(60);
  const typed = [...$('cw-grid').children]
    .map((el, i) => (el.querySelector('.cw-let') && el.querySelector('.cw-let').textContent ? i : -1))
    .filter((i) => i >= 0);
  check('typing Across moves sideways', typed.length === 2 && typed[1] === typed[0] + 1,
    typed.join(','));
  check('and it is saved', /Q/.test(cwRec().u), (cwRec().u || '').slice(0, 20));

  // Check flags the wrong one
  $('cw-check').click();
  await wait(40);
  check('the checker flags a wrong letter', !!window.document.querySelector('.cw-cell.wrong'));
}

// hints: one letter, counted, locked, and visibly different
{
  const hintsBefore = $('cw-grid').querySelectorAll('.cw-cell.given').length;
  $('cw-hint').click();
  await wait(60);
  check('a hint reveals a letter', $('cw-grid').querySelectorAll('.cw-cell.given').length === hintsBefore + 1,
    `${$('cw-grid').querySelectorAll('.cw-cell.given').length}`);
  check('and it is counted on screen', /1 revealed/.test($('cw-hints').textContent), $('cw-hints').textContent);
  check('and counted in storage', (cwRec().g || []).length === 1, JSON.stringify(cwRec().g));

  // a revealed letter cannot be typed over
  const given = $('cw-grid').querySelector('.cw-cell.given');
  const was = given.querySelector('.cw-let').textContent;
  given.click();
  await wait(20);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'x' }));
  await wait(40);
  check('a revealed letter is locked', given.querySelector('.cw-let').textContent === was,
    `${was} -> ${given.querySelector('.cw-let').textContent}`);
  check('and backspace leaves it alone', (() => {
    given.click();
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Backspace' }));
    return given.querySelector('.cw-let').textContent === was;
  })());
}

/* **The list is the calendar now.** There were two lists of the same puzzles —
   a panel inside the game and a month grid outside it — and only one of them
   knew about the other three sizes, what you scored on each and which days are
   still open. The button in the game's own bar opens that one.

   And nothing here can be started over. Every puzzle is published on a day and
   its time, its clues and the letters it gave away are kept; a Reset would
   make that record worth nothing. */

/* **Which sizes come out today is a different answer on different days.** The
   5s run Tuesday, Thursday and Saturday and the 9s Monday, Wednesday and
   Friday, so everything below that needs "a puzzle published today" has to ask
   the schedule rather than reach for the 5×5 — which would be a suite that
   passes three days a week and fails the other four for no reason anybody
   could act on. `cwSmall` is the smallest size out today; the 7 comes out
   every day, so there is always one. */
const cwToday = [5, 7, 9, 15].filter((n) => window.__m.crossReleases(n, window.__m.pktNow()));
const cwSmall = cwToday[0];
const cwSmallRe = new RegExp(cwSmall + '\u00d7' + cwSmall);
check('something comes out every day, whatever day the suite is run on',
  cwToday.length >= 1 && cwToday.indexOf(7) >= 0, cwToday.join(','));
{
  check('the crossword no longer carries a list of its own',
    !$('cw-picker') && !$('cw-list-body'), 'the old picker panel is still in the markup');
  $('cw-list').click();
  await wait(120);
  check('its button opens the calendar instead', !$('dcal-overlay').classList.contains('hide'),
    $('dcal-overlay').className);
  check('which is the crossword’s', /Crossword/.test($('dcal-title').textContent),
    $('dcal-title').textContent);

  /* Every size for the chosen day, with today's at the top of the grid. */
  const rows = [...$('dcal-day').querySelectorAll('.dcal-row')];
  check('and offers the day’s puzzles, one per size published',
    rows.length === cwToday.length && cwSmallRe.test(rows[0].textContent),
    rows.map((r) => r.textContent).join(' | ') + '  for ' + cwToday.join(','));
  $('dcal-close').click();
  await wait(80);

  // holding a card no longer offers to wipe the record
  const cwCard = [...window.document.querySelectorAll('.pcard')].find((c) => c.dataset.game === 'crossword');
  cwCard.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 120 }));
  await wait(60);
  check('and the crossword card offers no reset',
    $('hmenu').classList.contains('hide') || !/Reset/i.test($('hmenu-card').textContent),
    $('hmenu-card').textContent);
  $('hmenu').click();
  await wait(40);
  [...window.document.querySelectorAll('.pcard')].find((c) => c.dataset.game === 'crossword').click();
  await wait(250);
}

// solve one outright — the small grids are the quickest way to prove the whole
// path, including the banner and the crossing-off in the picker
{
  const sizeBtn = (s) => [...$('cw-size').children].find((b) => +b.dataset.s === s);
  sizeBtn(cwSmall).click();
  await wait(200);
  check('sizes are offered, and only the ones the bank has',
    [...$('cw-size').children].filter((b) => !b.disabled).length >= 2,
    [...$('cw-size').children].map((b) => b.dataset.s + (b.disabled ? '!' : '')).join(','));
  check('switching size loads a puzzle of that size', cwN() === cwSmall, `${cwN()}`);

  /* **The calendar counts clues, not squares.** "in progress" told you nothing
     about which day was nearly done, so a started puzzle says how many of its
     clues are completely right. A clue counts only when every one of its
     letters is, which is why this reveals a whole entry rather than a few
     letters and expects the count to move exactly once. */
  {
    /* One hint per letter of this entry — its own stated length, because the
       first across entry is four letters on one day and seven on another. */
    const clue = $('cw-clues').querySelector('[data-dir="A"]');
    const len = +(clue.querySelector('i').textContent.match(/\d+/) || [0])[0];
    clue.click();
    await wait(30);
    for (let k = 0; k < len; k++) { $('cw-hint').click(); await wait(20); }
    $('cw-list').click();
    await wait(120);
    const row = [...$('dcal-day').querySelectorAll('.dcal-row')]
      .find((r) => cwSmallRe.test(r.querySelector('b').textContent));
    const note = row && row.querySelector('span');
    check('a started puzzle says how many of its clues are right',
      !!note && /^1 of \d+ clues · \d+ revealed$/.test(note.textContent), note && note.textContent);
    $('dcal-close').click();
    await wait(60);
  }

  /* **A wrong letter is a square a hint will fix.** It used to look for an
     *empty* one, so the moment a hint is most wanted — sitting on a square you
     have filled in wrongly and stuck — was the moment the button skipped off
     and revealed something else, and a grid that was full and wrong could not
     be finished by hints at all because nothing in it was empty. Done here
     while the puzzle is still open: once it is finished the button is disabled,
     which is right. */
  {
    const C = window.__m.Cross;
    const at = C.user.findIndex((v, i) => C._solAt(i) && !C.given[i]);
    const right = C._solAt(at);
    C.user[at] = right === 'X' ? 'Q' : 'X';
    C.sel = at;
    C.render();
    $('cw-hint').click();
    await wait(60);
    check('and a hint puts right the square you are on, not some other one',
      C.user[at] === right, C.user[at] + ' should be ' + right);
  }

  /* Fill it by asking for a hint on every square. The guard comes from the grid
     in front of us: forty was enough for the twenty-five squares of a 5×5 and
     not for the forty-odd white squares of a 7×7, so the suite quietly stopped
     being able to finish a puzzle on the four days a week no 5×5 is published. */
  const whiteSquares = $('cw-grid').querySelectorAll('.cw-cell').length;
  for (let guard = 0; guard < whiteSquares + 10; guard++) {
    if (!$('cw-banner').classList.contains('hide')) break;
    $('cw-hint').click();
    await wait(20);
  }
  check('a filled grid is recognised as finished', !$('cw-banner').classList.contains('hide'));
  check('the summary counts the revealed letters',
    /\d+ clues in \d{2}:\d{2} · \d+ letters revealed/.test($('cw-win-sub').textContent),
    $('cw-win-sub').textContent);
  check('it is recorded as done', !!cwRec().done);

  /* And it goes onto the calendar with its numbers, which is the whole reason
     for keeping one: how long it took, how many clues, how much was given away. */
  $('cw-list').click();
  await wait(120);
  {
    const row = [...$('dcal-day').querySelectorAll('.dcal-row')]
      .find((r) => cwSmallRe.test(r.querySelector('b').textContent));
    check('a finished puzzle is on the calendar with its numbers',
      !!row && /^\d+ clues in \d{2}:\d{2} · \d+ revealed$/.test(row.querySelector('span').textContent),
      row && row.querySelector('span').textContent);
    check('and the game’s totals are above the month',
      !$('dcal-sum').classList.contains('hide')
      && /filled in/.test($('dcal-sum').textContent), $('dcal-sum').textContent);
  }
  $('dcal-close').click();
  await wait(60);

  $('cw-again').click();
  await wait(200);
  check('Next moves to one that is still open', !cwRec().done);
}

// celebration — actually solve the Sudoku, clicking cells and numpad keys the way
// a player would. The answer comes from the game's own saved state, not from
// reaching into the closure, so this exercises the real input path end to end.
byGame.sudoku.click();
await wait(250);
/* **One board per day and difficulty, on a shelf.** There used to be a single
   board in the save, so opening Tuesday's easy threw away Monday's unfinished
   hard — which, with an archive to browse, is a thing you do on the way to
   somewhere else. `sdkBoard()` is the one on screen. */
const sdkSave = () => JSON.parse(window.localStorage.getItem('arcade_sudoku') || 'null');
const sdkBoard = () => { const d = sdkSave(); return (d && d.boards && d.boards[d.day + '|' + d.diff]) || null; };
const saved = sdkBoard();
check('sudoku persisted its board', !!(saved && saved.sol && saved.sol.length === 81));
check('and files it under the day and difficulty it belongs to',
  !!sdkSave() && /^\d{4}-\d{2}-\d{2}$/.test(sdkSave().day || ''), JSON.stringify(sdkSave() && sdkSave().day));

// the Check button: put one deliberately wrong digit in and confirm it's flagged
const firstFree = saved.given.findIndex((g, i) => !g && saved.sol[i] !== saved.grid[i]);
const wrongDigit = saved.sol[firstFree] === 9 ? 8 : 9;
[...$('sdk-grid').children][firstFree].click();
[...$('sdk-pad').children].find((b) => b.dataset.n === String(wrongDigit))?.click();
$('sdk-check').click();
await wait(20);
check('checker flags a wrong cell', [...$('sdk-grid').children][firstFree].classList.contains('wrong'));
[...$('sdk-pad').children].find((b) => b.dataset.n === String(wrongDigit))?.click();
check('checker clears on new input', !window.document.querySelector('.sdk .cell.wrong'));

const sdkCells = [...$('sdk-grid').children];
const padKeys = [...$('sdk-pad').children];
const digitKey = (n) => padKeys.find((b) => b.dataset.n === String(n));

for (let i = 0; i < 81; i++) {
  if (saved.given[i]) continue;
  if (saved.sol[i] === saved.grid[i]) continue;
  sdkCells[i].click();
  const key = digitKey(saved.sol[i]);
  if (key) key.click();
}
await wait(120);
check('sudoku solved by clicking', !$('sdk-banner').classList.contains('hide'));
check('sudoku win text written', /^\d{2}:\d{2} · (easy|medium|hard)$/.test($('sdk-win-sub').textContent), $('sdk-win-sub').textContent);
check('celebration fired', !!window.document.querySelector('canvas.confetti'));
check('banner pop applied', $('sdk-banner').classList.contains('pop'));

// --- ambience --------------------------------------------------------------
check('ambience picker built', $('amb-grid').children.length === 6, `${$('amb-grid').children.length} options`);
const ambBtn = (a) => [...$('amb-grid').children].find((b) => b.dataset.a === a);
check('volume hidden while off', $('amb-vol-row').classList.contains('hide'));

/* Three of the five are bought with embers now, and there is nothing to spend
   yet — so the two free ones are what can be checked here, and the locked ones
   are checked for staying locked. The buying is exercised further down, once
   some blocks have been finished. */
const ambProblems = [];
/* Every track is bought now, so this buys one the way a user does — which is
   also the only way anybody ever hears one. */
$('d-stats').click();
await wait(120);
{ const t = $('emb-box').querySelector('[data-tab="sounds"]'); if (t) t.click(); }
await wait(60);
$('emb-box').querySelector('[data-sound="cafe"]').click();
await wait(60);
check('a track is bought the same way a light is', !$('confirm').classList.contains('hide'),
  $('confirm-title').textContent);
$('confirm-yes').click();
await wait(150);
check('and starts playing once it is yours', window.document.body.dataset.amb === 'cafe',
  window.document.body.dataset.amb);
$('stats-close').click();
await wait(60);
for (const id of ['cafe']) {
  ambBtn(id).click();
  await wait(120);
  if (window.document.body.getAttribute('data-amb') !== id) ambProblems.push(`${id}: theme not applied`);
  if ($('app').getAttribute('data-amb') !== id) ambProblems.push(`${id}: app theme not applied`);
  if (!ambBtn(id).classList.contains('on')) ambProblems.push(`${id}: button not marked active`);
  const el = window.document.querySelector('audio');
  if (!el) ambProblems.push(`${id}: no audio element`);
  else if (el.src.indexOf(`audio/${id}.mp3`) === -1) ambProblems.push(`${id}: src is ${el.src}`);
  if (!window.__media.plays.some((s) => s.indexOf(`audio/${id}.mp3`) !== -1)) ambProblems.push(`${id}: never played`);
}
check('an owned ambience loads and plays its track', ambProblems.length === 0, ambProblems.slice(0, 3).join(' | '));
for (const id of ['rain', 'forest', 'office', 'campfire']) {
  ambBtn(id).click();
  await wait(40);
}
check('a locked track does not play itself', window.document.body.getAttribute('data-amb') === 'cafe',
  window.document.body.getAttribute('data-amb'));
check('and is marked as locked in the picker',
  ['rain', 'forest', 'office', 'campfire'].every((id) => ambBtn(id).classList.contains('locked')));
/* Every effect a look or a track can ask for needs a rule to draw it. Office's
   `keys` had a spec in 38-vfx.js — sized, placed on a grid, timed — and no CSS
   at all, so it laid out two dozen invisible boxes and the keyboard never
   appeared. Nothing caught it because nothing was checking that the two lists
   agree, so here they are, compared. */
check('every effect a look can choose has a rule to draw it', (() => {
  const css = [...window.document.querySelectorAll('style')].map((n) => n.textContent).join('\n');
  const kinds = [...html.matchAll(/\bfx:'([a-z]+)'/g)].map((m) => m[1]);
  const missing = [...new Set(kinds)]
    .filter((k) => !css.includes(`.vfx[data-fx="${k}"] b{`));
  return missing.length === 0 ? true : missing.join(' ');
})() === true, (() => {
  const css = [...window.document.querySelectorAll('style')].map((n) => n.textContent).join('\n');
  return [...new Set([...html.matchAll(/\bfx:'([a-z]+)'/g)].map((m) => m[1]))]
    .filter((k) => !css.includes(`.vfx[data-fx="${k}"] b{`)).join(' ') || 'all present';
})());
// the one look that lights the whole room rather than only the sky
check('campfire asks for the flicker and the others do not', (() => {
  const css = [...window.document.querySelectorAll('style')].map((n) => n.textContent).join('');
  return /\[data-flick="1"\]::before/.test(css);
})());
check('one shared audio element, not five', window.document.querySelectorAll('audio').length === 1, `${window.document.querySelectorAll('audio').length}`);
check('audio is not preloaded before it is chosen', window.document.querySelector('audio').preload === 'none', window.document.querySelector('audio').preload);
check('app handles the repeat, not the element', window.document.querySelector('audio').loop === false);
check('volume shown once an ambience is on', !$('amb-vol-row').classList.contains('hide'));
check('ambience persisted', JSON.parse(window.localStorage.getItem('focus_amb')).id === 'cafe', window.localStorage.getItem('focus_amb'));

$('amb-vol').value = '20';
$('amb-vol').dispatchEvent(new window.Event('input'));
await wait(20);
check('volume persisted', Math.abs(JSON.parse(window.localStorage.getItem('focus_amb')).vol - 0.2) < 0.01, window.localStorage.getItem('focus_amb'));

// switching off must silence everything and stop the schedulers
const pausesBefore = window.__media.pauses;
ambBtn('off').click();
await wait(400);
check('off clears the theme', window.document.body.getAttribute('data-amb') === '');
check('off pauses playback', window.__media.pauses > pausesBefore, `${window.__media.pauses - pausesBefore} pauses`);
check('off fades out rather than cutting', window.document.querySelector('audio').volume < 0.05, `volume ${window.document.querySelector('audio').volume}`);

// reaching the end must restart the track, not stop
ambBtn('cafe').click();
await wait(60);
const playsBefore = window.__media.plays.length;
const audioEl = window.document.querySelector('audio');
audioEl.dispatchEvent(new window.Event('ended'));
await wait(40);
check('track restarts when it ends', window.__media.plays.length > playsBefore, `${window.__media.plays.length - playsBefore} replays`);
ambBtn('off').click();
await wait(300);

/* **A follower's ambience is started by somebody else's finger.**

   Autoplay is only allowed on an element that has already played from a user
   gesture. In a shared room the follower's clock starts because a `state`
   message arrived - not a gesture on their machine - so `el.play()` rejected,
   `ambStart` swallowed it, and everybody who was not holding the timer sat in
   silence with nothing saying why. The fix is to play and pause the element
   once while a real gesture is on the stack, so the browser marks it
   user-initiated and every later `play()` is allowed.

   jsdom has no autoplay policy to reproduce, so what is checked is that the
   priming happens at all: a fresh window, one tap anywhere, an element that has
   been played and then left paused and silent. */
{
  const { window: pw } = boot(html);
  await wait(400);
  check('nothing is played before anything is touched', pw.__media.plays.length === 0,
    pw.__media.plays.join(','));
  pw.document.dispatchEvent(new pw.Event('pointerdown', { bubbles: true }));
  await wait(80);
  const el = pw.document.querySelector('audio');
  check('the first tap anywhere primes the ambience element',
    pw.__media.plays.length === 1 && !!el, `${pw.__media.plays.length} plays`);
  check('and leaves it paused and silent, with nothing to hear',
    !!el && el.paused && el.volume === 0, el && `paused ${el.paused} · volume ${el.volume}`);
  pw.document.dispatchEvent(new pw.Event('pointerdown', { bubbles: true }));
  await wait(40);
  check('and it only happens once, however much is tapped',
    pw.__media.plays.length === 1, `${pw.__media.plays.length} plays`);
}

// --- overlays --------------------------------------------------------------
$('note-input').value = 'smoke test note';
$('note-input').dispatchEvent(new window.Event('input'));
check('note box accepts text', $('note-input').value === 'smoke test note');

click('d-quotes'); await wait(80);
check('quote bank opens', !$('quotes-overlay').classList.contains('hide'));
check('quote list populated', $('q-list').children.length > 0);
click('q-back');

click('d-history'); await wait(80);
check('calendar opens', !$('cal-overlay').classList.contains('hide'));
check('calendar grid built', $('cal-grid').children.length > 0);

/* ---- how the day went ----------------------------------------------------

   One emoji a day. A number out of five is a judgement and invites you to argue
   with it; a face is a shrug you can give on the way past, and the point is
   that in three months the calendar shows a shape rather than that anything is
   measured. */
{
  const today = window.__m.today();
  const row = $('cal-detail').querySelector('.mood-row');
  check('the day panel offers a face for the day', !!row,
    $('cal-detail').textContent.slice(0, 80));
  const faces = [...row.querySelectorAll('[data-mood]')];
  check('with a few to choose from, not a scale', faces.length === 6,
    `${faces.length}`);
  const picked = faces[1].dataset.mood;
  faces[1].click();
  await wait(80);
  check('picking one records it against that day',
    window.__m.moodOf(today) === picked,
    `${window.__m.moodOf(today)}`);

  /* **Bottom right, and alone.** Everything else a day carries is a small mark
     to be counted; this is the one thing on the square you read. */
  const cell = [...$('cal-grid').querySelectorAll('.cal-cell')]
    .find((c) => c.classList.contains('today'));
  /* The face is drawn rather than typed, so there is no text on the square to
     compare against. The emotion is in the class the drawing carries, and the
     question is the same one: the square wears the face that was tapped. */
  const faceOf = (el) => {
    const e = el && el.querySelector('.emo');
    return e ? (String(e.className).match(/emo-[a-z]+/) || [''])[0] : '';
  };
  const chosen = [...$('cal-detail').querySelectorAll('[data-mood]')]
    .find((b) => b.dataset.mood === picked);
  check('and the day wears it on the calendar',
    !!cell && !!cell.querySelector('.mood') && faceOf(cell.querySelector('.mood')) !== ''
    && faceOf(cell.querySelector('.mood')) === faceOf(chosen),
    cell ? faceOf(cell.querySelector('.mood')) + ' vs ' + faceOf(chosen) : 'no today');

  /* **A sad face is not a face that is crying.** The drop used to hang under
     the eye whenever the face was drawn, so the row of six on the prompt was
     five faces and one person mid-cry, held there forever — and the calendar
     wore it on every bad day it remembered. The tear belongs to the moment you
     say the day was bad, so it is drawn by the motion and by nothing else: at
     rest there is none, tapping wells one up, it falls, and it is gone.

     Asked of the stylesheet, because jsdom runs no animation: the resting rule
     has to hide it, and the keyframes have to both raise it and put it back
     down — a version that ends opaque leaves a tear hanging when the motion
     stops, which is the bug wearing a delay. */
  {
    const rest = cssOf('.emo-bad .emo-t');
    const fall = keyframesOf('emo-bad-t');
    const at = (k) => (fall.find((f) => f.key === k) || { style: {} }).style.opacity;
    check('a sad face has no tear until it is tapped',
      rest.length > 0 && rest.every((d) => d.opacity === '0'),
      rest.map((d) => d.opacity).join(',') || 'no resting rule');
    check('and tapping it wells one up',
      fall.length > 0 && Math.max(...fall.map((f) => +f.style.opacity || 0)) === 1,
      fall.map((f) => f.key + ':' + f.style.opacity).join(' '));
    check('and the motion leaves the face dry',
      at('100%') === '0' && /translateY\(\s*2?\d+px/.test(
        (fall.find((f) => f.key === '100%') || { style: {} }).style.transform || ''),
      fall.map((f) => f.key + ':' + f.style.opacity).join(' '));
  }
  /* The prompt is the first thing under the top bar and used to be welded to
     it — no top margin at all, so on a narrow window, where the date wraps to
     two lines, the question read as part of the bar. */
  /* Read out of the built CSS rather than out of the CSSOM. jsdom does not
     expand a `margin:` shorthand (the same trap as `animation:`, HANDOFF §6),
     and it drops a declaration whose value it cannot parse — `clamp()` is one —
     so the rule is there and every property on it reads as empty. */
  check('the prompt is spaced off the top bar', (() => {
    const rule = (html.match(/\.mood-ask\{([^}]*)\}/) || [])[1] || '';
    const mar = (rule.match(/margin\s*:\s*([^;]+)/) || [])[1] || '';
    const top = mar.trim().split(/\s+(?![^(]*\))/)[0] || '';
    return !!top && top !== '0' && top !== '0px';
  })(), ((html.match(/\.mood-ask\{([^}]*)\}/) || [])[1] || 'no rule').replace(/\s+/g, ' ').trim());

  /* Choosing the one already there clears it: there is no other way back to an
     empty square, and being stuck with yesterday's face is worse than none. */
  /* Re-queried, because picking one re-renders the panel and the nodes above
     are no longer in the document. An attribute selector would do it, except
     the value is an emoji and that is a needless fight with the parser. */
  const again = [...$('cal-detail').querySelectorAll('[data-mood]')]
    .find((b) => b.dataset.mood === picked);
  check('the row comes back with the chosen one marked',
    !!again && again.classList.contains('on'), again ? again.className : 'not found');
  again.click();
  await wait(80);
  check('choosing it again takes it off', window.__m.moodOf(today) === '',
    JSON.stringify(window.__m.moodOf(today)));

  /* A mood is a report, not a plan, so a day that has not happened is not
     asked about. */
  window.__m.Cal.sel = '2099-01-01';
  window.__m.Cal.render();
  await wait(60);
  check('a day in the future is not asked about',
    !$('cal-detail').querySelector('.mood-row'), $('cal-detail').textContent.slice(0, 60));
  window.__m.Cal.sel = today;
  window.__m.Cal.render();
  await wait(60);
}
click('cal-close');

click('d-stats'); await wait(80);
check('stats overlay opens', !$('stats-overlay').classList.contains('hide'));
// A session was logged by the skip above, so this renders cards, not the empty state.
check('stats renders after one session', $('stats-body').querySelectorAll('.stat-card').length === 4, `${$('stats-body').querySelectorAll('.stat-card').length} cards`);
click('stats-close');
check('stats overlay closes', $('stats-overlay').classList.contains('hide'));

/* Export and Import are gone — the account moves data between devices now, and
   two buttons plus a file format for a solved problem is worse than neither.
   In their place, the two things every shipped app has to be able to show. */
click('d-privacy'); await wait(120);
check('Privacy opens', !$('about-overlay').classList.contains('hide'));
check('and it is the privacy text', $('about-title').textContent === 'Privacy'
  && /never collected/i.test($('about-body').textContent),
  $('about-body').textContent.slice(0, 60));
/* **A policy must not ship with the name still a placeholder.** The build
   stamps it; unstamped, the screen shows a red gap, and this is what stops that
   gap reaching a store listing without somebody noticing. */
/* Blank in this repo on purpose, exactly like the account URL — so this checks
   the mechanism rather than the value. Stamped, there must be no gap; unstamped,
   there must be a visible one. A build that shows neither is the bad case: a
   policy that reads as finished while saying "the developer" where a name goes. */
{
  const gaps = [...$('about-body').querySelectorAll('.about-todo')];
  const stamped = !/the contact address for this build/.test($('about-body').textContent);
  check(stamped ? 'and the policy names who runs it'
                : 'and an unstamped policy shows the gap rather than hiding it',
    stamped ? gaps.length === 0 : gaps.length >= 1,
    gaps.map((n) => n.textContent).join(' | '));
}
click('about-back'); await wait(60);
click('d-credits'); await wait(120);
check('Credits opens', !$('about-overlay').classList.contains('hide')
  && $('about-title').textContent === 'Credits', $('about-title').textContent);
check('and credits the typefaces and the libraries',
  /Space Grotesk/.test($('about-body').textContent)
  && /PeerJS/.test($('about-body').textContent));
click('about-back'); await wait(60);
/* ---- reporting something ----
   A category before the sentence, because "it does not work" is what people
   write when there is nothing to pick from. And it must refuse to send an empty
   one: a report with no category and no words costs somebody a reply to find
   out there is nothing in it. */
click('d-report'); await wait(120);
check('Report opens', !$('about-overlay').classList.contains('hide')
  && $('about-title').textContent === 'Report a problem', $('about-title').textContent);
check('and offers a category before anything is typed',
  $('about-body').querySelectorAll('.rep-kind').length === 8,
  `${$('about-body').querySelectorAll('.rep-kind').length}`);
check('with nothing picked to start with',
  $('about-body').querySelectorAll('.rep-kind.on').length === 0);
check('and it says where it goes',
  /spiderman\.hashir@gmail\.com/.test($('about-body').textContent));
/* The facts that settle most reports, shown rather than attached silently. */
check('the version travels with it',
  /Version: v\d/.test($('rep-facts').value), $('rep-facts').value.slice(0, 40));
check('and whether this device is saving at all',
  /Saving:/.test($('rep-facts').value), $('rep-facts').value.slice(0, 120));
/* Both halves are needed, and each is checked on its own — a report with words
   and no category is as unanswerable as one with a category and no words, and a
   single "empty is refused" test would pass while either guard was missing. */
$('rep-text').value = 'the board went blank';
check('words with no category are refused', window.__m.reportSend() === '');
$('rep-text').value = '';
$('about-body').querySelector('[data-kind="game"]').click();
await wait(40);
check('picking one marks it, and only it',
  $('about-body').querySelectorAll('.rep-kind.on').length === 1
  && $('about-body').querySelector('.rep-kind.on').dataset.kind === 'game',
  `${$('about-body').querySelectorAll('.rep-kind.on').length}`);
$('about-body').querySelector('[data-kind="room"]').click();
await wait(40);
check('and picking another moves the mark rather than adding one',
  $('about-body').querySelectorAll('.rep-kind.on').length === 1
  && $('about-body').querySelector('.rep-kind.on').dataset.kind === 'room');
check('and a category with no words is refused too', window.__m.reportSend() === '');
$('rep-text').value = 'It stopped taking letters after the first one.';
{
  const url = window.__m.reportSend();
  check('a report with both goes to the right address',
    url.indexOf('mailto:spiderman.hashir@gmail.com') === 0, url.slice(0, 46));
  check('and carries the category, the words and the version', (() => {
    const body = decodeURIComponent((url.split('&body=')[1] || ''));
    return /Focus together/.test(body) && /stopped taking letters/.test(body)
      && /Version: v\d/.test(body);
  })(), decodeURIComponent((url.split('&body=')[1] || '')).slice(0, 70));
}
click('about-back'); await wait(60);
check('and it closes again', $('about-overlay').classList.contains('hide'));
check('the backup buttons are gone with it',
  !$('d-export') && !$('d-import') && !$('import-file'));

// ===========================================================================
// Pass 2 — seeded history, so the stats dashboard has real numbers to render
// ===========================================================================

const seeded = html.replace(
  '<script>',
  `<script>localStorage.setItem('focus_log', ${JSON.stringify(JSON.stringify(seedLog))});</script>\n<script>`,
);

const { window: w2, errors: errors2 } = boot(seeded);
await wait(400);
const $2 = (id) => w2.document.getElementById(id);
$2('d-stats').click();
await wait(120);

const statsText = $2('stats-body').textContent;
check('stats renders with history', !statsText.includes('No finished sessions'), statsText.slice(0, 50));
check('stats shows session count', statsText.includes('8'), statsText.slice(0, 80));
check('stats cards rendered', $2('stats-body').querySelectorAll('.stat-card').length === 4, `${$2('stats-body').querySelectorAll('.stat-card').length}`);
check('stats bar chart has 14 days', $2('stats-body').querySelectorAll('.sbar').length === 14, `${$2('stats-body').querySelectorAll('.sbar').length}`);
check('streak counted (3 consecutive days)', /3 days/.test(statsText), statsText.match(/\d+ days?/g)?.join(' / ') || '');
/* An average day, not a best hour. "Your best hour is 2 PM" is a fact about
   the clock rather than about you, and it never moved once it had settled. */
check('the daily average is shown', $2('stats-body').textContent.includes('Average day'));
check('and the best hour is gone', !$2('stats-body').textContent.includes('Best hour'));
check('every bar can be asked what it is',
  [...$2('stats-body').querySelectorAll('.sbar')].every((b) => b.dataset.when && b.dataset.much),
  $2('stats-body').querySelector('.sbar')?.dataset.when);
{
  const bar = $2('stats-body').querySelectorAll('.sbar')[13];
  bar.click();
  check('and tapping one says the day and the time on it',
    $2('sbar-read').textContent.includes(bar.dataset.much),
    $2('sbar-read').textContent);
  bar.click();
  check('tapping it again puts the line back', !$2('sbar-read').classList.contains('on'));
}

// --- buying a light --------------------------------------------------------
/* Last thing in this pass, because it leaves a pile of one-second sessions
   behind it — none of which are worth anything, which is the point. */
for (let i = 0; i < 62; i++) { click('skip'); await wait(24); }
await wait(80);
$('d-stats').click();
await wait(120);
{
  /* Whichever shelf the last block left open, this one is about lights. */
  { const t = $('emb-box').querySelector('[data-tab="looks"]'); if (t) t.click(); }
  await wait(60);
  const shelf = () => [...$('emb-box').querySelectorAll('[data-light]')];
  check('there is enough to buy something', +$('emb-box').dataset.have >= 5,
    $('emb-box').dataset.have);
  check('and one you can afford now says so', !shelf()[1].classList.contains('far'),
    shelf()[1].className);
  const before = +$('emb-box').dataset.have;
  shelf()[1].click();
  await wait(60);
  check('buying a light asks first', !$('confirm').classList.contains('hide'), $('confirm-title').textContent);
  check('and says what it costs', /36/.test($('confirm-yes').textContent), $('confirm-yes').textContent);
  $('confirm-no').click();
  await wait(40);
  check('changing your mind costs nothing', +$('emb-box').dataset.have === before);
  shelf()[1].click();
  await wait(40);
  $('confirm-yes').click();
  await wait(80);
  check('it is paid for', +$('emb-box').dataset.have === before - 36, $('emb-box').dataset.have);
  check('it is yours', /latesun/.test($('emb-box').dataset.own), $('emb-box').dataset.own);
  check('and it is what is burning now', window.document.body.dataset.light === 'latesun',
    window.document.body.dataset.light);
  /* Weather belongs to the timer, not to the setup screen — and all those
     skips have run the session out and landed back on it. Start one. */
  if (!$('setup').classList.contains('hide')) { $('stats-close').click(); await wait(40); click('begin'); await wait(120); $('d-stats').click(); await wait(120); }
  check('a light brings its own weather with it', $('vfx').dataset.fx === 'sun',
    $('vfx').dataset.fx);
  /* Both of its colours are on screen. Late sun takes them in turn rather than
     blending — with four huge washes a blend would give you four of the same
     in-between colour — and sets opposite sides of the ring opposite colours. */
  check('in both of its colours', (() => {
    const cs = [...$('vfx').children].map((b) => b.style.getPropertyValue('--c'));
    return cs.some((c) => /#ffe07a/.test(c)) && cs.some((c) => /#ff9a3c/.test(c));
  })(), [...$('vfx').children].map((b) => b.style.getPropertyValue('--c')).join(' | '));
  check('and they are set down opposite each other', (() => {
    const xs = [...$('vfx').children].map((b) => parseFloat(b.style.getPropertyValue('--x')));
    return Math.max(...xs) - Math.min(...xs) > 50;
  })(), [...$('vfx').children].map((b) => b.style.getPropertyValue('--x')).join(' '));
  /* And the room with it. Checked on the clock rather than on <body>, because
     the palette was landing on body for a while and being shadowed by #app's
     own phase colours — which looks correct in the DOM and changes nothing at
     all on screen. Assert on something you can actually see. */
  check('and the room takes the same colour',
    window.getComputedStyle($('clock')).getPropertyValue('--accent').trim() === '#f7bd52',
    window.getComputedStyle($('clock')).getPropertyValue('--accent'));
  check('every screen, not just the timer', ['dial', 'toggle-run', 'app'].every(
    (id) => window.getComputedStyle($(id)).getPropertyValue('--accent').trim() === '#f7bd52'),
    ['dial', 'toggle-run', 'app'].map((id) => id + ':' + window.getComputedStyle($(id)).getPropertyValue('--accent')).join(' '));
  /* A look owns every colour on screen, not just the timer's — including the
     rest arcade, which used to go back to amber a minute later. */
  check('a light colours the whole app, arcade and menu included',
    window.getComputedStyle($('overlay')).getPropertyValue('--accent').trim() === '#f7bd52'
    && window.getComputedStyle($('drawer')).getPropertyValue('--accent').trim() === '#f7bd52',
    `${window.getComputedStyle($('overlay')).getPropertyValue('--accent')} / ${window.getComputedStyle($('drawer')).getPropertyValue('--accent')}`);
  shelf()[0].click();
  await wait(60);
  check('you can go back to the one you started with',
    window.document.body.dataset.light === 'seaglass', window.document.body.dataset.light);
  check('and the weather goes back with it', $('vfx').dataset.fx === 'sparks',
    $('vfx').dataset.fx);
  check('and none of it shows on the setup screen', (() => {
    const was = window.document.body.getAttribute('data-phase');
    return !was || $('vfx').classList.contains('on');
  })());
  check('and both lights are still yours',
    $('emb-box').dataset.own.split(' ').filter((k) => k.indexOf('snd-') < 0).length === 2,
    $('emb-box').dataset.own);

  // a locked sound, once there is something to spend — on the sounds shelf
  { const t = $('emb-box').querySelector('[data-tab="sounds"]'); if (t) t.click(); }
  await wait(60);
  const sounds2 = () => [...$('emb-box').querySelectorAll('[data-sound]')];
  const had = +$('emb-box').dataset.have;
  sounds2().find((b) => b.dataset.sound === 'rain').click();
  await wait(80);
  check('a locked sound offers itself once you can afford it',
    !$('confirm').classList.contains('hide'), $('confirm-title').textContent);
  $('confirm-yes').click();
  await wait(150);
  check('buying it spends the embers', +$('emb-box').dataset.have === had - 136,
    `${$('emb-box').dataset.have} was ${had}`);
  check('and starts it playing', window.document.body.dataset.amb === 'rain',
    window.document.body.dataset.amb);
  check('with its own weather', $('vfx').dataset.fx === 'rain', $('vfx').dataset.fx);
  /* One pane, one look: a light and a track both want the palette and both want
     the weather, so they are alternatives rather than layers. */
  check('and the light is out while it plays',
    window.document.body.dataset.light === 'none', window.document.body.dataset.light);
  { const t = $('emb-box').querySelector('[data-tab="looks"]'); if (t) t.click(); }
  await wait(60);
  const shelf3 = [...$('emb-box').querySelectorAll('[data-light]')];
  check('no light is marked as burning', !shelf3.some((b) => b.classList.contains('on')),
    shelf3.map((b) => b.className).join(' | '));
  shelf3[1].click();
  await wait(150);
  check('choosing a light stops the track', window.document.body.dataset.amb === '',
    window.document.body.dataset.amb);
  check('and takes the pane back', $('vfx').dataset.fx === 'sun', $('vfx').dataset.fx);
  check('and it is no longer locked in the menu',
    !$('amb-grid').querySelector('[data-a="rain"]').classList.contains('locked'));

  // and Reset progress takes them with it, as it says it will
  $('d-reset').click();
  await wait(60);
  check('resetting progress asks first, in full',
    !$('confirm').classList.contains('hide') && /embers/.test($('confirm-body').textContent),
    $('confirm-body').textContent.slice(0, 80));
  $('confirm-yes').click();
  await wait(200);
  check('it takes the embers', +$('emb-box').dataset.have === 0, $('emb-box').dataset.have);
  check('and the lights they bought', $('emb-box').dataset.own === 'seaglass', $('emb-box').dataset.own);
  check('and the sessions', !JSON.parse(window.localStorage.getItem('focus_log') || '[]').length,
    window.localStorage.getItem('focus_log'));
  check('a sound you no longer own stops playing',
    !window.document.body.dataset.amb, window.document.body.dataset.amb);
  check('but not your settings', !!window.localStorage.getItem('focus_sim'));
}
$('stats-close').click();
await wait(60);

// --- a day, as its own page ------------------------------------------------
$2('stats-close').click();
$2('d-history').click();
await wait(120);
check('calendar marks days that have notes', $2('cal-grid').querySelectorAll('.note-dot').length > 0, `${$2('cal-grid').querySelectorAll('.note-dot').length} dots`);
check('the calendar opens on the month, with no day in front of it',
  $2('day-overlay').classList.contains('hide'), $2('day-overlay').className);

// today was seeded with 2 sessions, so selecting it stays roomy
const cells = [...$2('cal-grid').querySelectorAll('.cal-cell.has')];
cells[cells.length - 1].click();
await wait(60);
/* **A day opens in front of the month rather than under it.** The records,
   the notes and the mood row used to unfold below the grid, which left the
   month squeezed into whatever was left — hence the two density modes this
   block used to check. The page in front is what replaced them. */
check('and tapping a day opens it as a page of its own',
  !$2('day-overlay').classList.contains('hide')
  && $2('day-overlay').contains($2('cal-detail')),
  $2('day-overlay').className);
check('and the month underneath is left at its own size',
  !$2('cal-overlay').dataset.dense, $2('cal-overlay').dataset.dense);
check('records rendered for the day', $2('cal-detail').querySelectorAll('.cal-rec').length === 2, `${$2('cal-detail').querySelectorAll('.cal-rec').length}`);
check('note textareas auto-sized', [...$2('cal-detail').querySelectorAll('textarea')].every((t) => t.style.height), 'no height set');

// A day with eight sessions, built from scratch rather than derived from the
// previous window, so the fixture can't drift.
$2('cal-close').click();
const heavyDay = new Date();
heavyDay.setHours(12, 0, 0, 0);
const heavy = [];
for (let i = 0; i < 8; i++) {
  const ts = heavyDay.getTime() + i * 60000;
  heavy.push({ id: 'h' + i, ts, day: key(ts), secs: 900, note: 'note ' + i });
}
const heavySeeded = html.replace(
  '<script>',
  `<script>localStorage.setItem('focus_log', ${JSON.stringify(JSON.stringify(heavy))});</script>\n<script>`,
);
const { window: w3 } = boot(heavySeeded);
await wait(400);
const $3 = (id) => w3.document.getElementById(id);
$3('d-history').click();
await wait(120);
const heavyCells = [...$3('cal-grid').querySelectorAll('.cal-cell.has')];
heavyCells[heavyCells.length - 1].click();
await wait(60);
/* Eight sessions was the case that forced the compact layout. Now it is just
   a longer page, and the month behind it does not change at all. */
check('a heavy day opens the same way, and still does not squeeze the month',
  !$3('day-overlay').classList.contains('hide') && !$3('cal-overlay').dataset.dense,
  $3('day-overlay').className + ' / ' + $3('cal-overlay').dataset.dense);
check('all eight records shown', $3('cal-detail').querySelectorAll('.cal-rec').length === 8, `${$3('cal-detail').querySelectorAll('.cal-rec').length}`);

// --- switching days --------------------------------------------------------
// The whole grid must stay live once a day is open, including days with nothing
// on them — otherwise you get stranded on whichever day you picked first.
const allCells = () => [...$3('cal-grid').querySelectorAll('.cal-cell:not(.blank)')];
check('every day is clickable, not just days with sessions', allCells().every((c) => typeof c.onclick === 'function'), `${allCells().filter((c) => typeof c.onclick === 'function').length}/${allCells().length}`);
check('a day is currently selected', $3('cal-grid').querySelectorAll('.cal-cell.sel').length === 1);

// move to an empty day while another is open
const emptyDay = allCells().find((c) => !c.classList.contains('has') && !c.classList.contains('sel'));
const emptyLabel = emptyDay.textContent.trim();
emptyDay.click();
await wait(60);
// render() rebuilds the grid, so the old node is detached — look it up again
const nowSelected = $3('cal-grid').querySelector('.cal-cell.sel');
check('can switch to an empty day', !!nowSelected && nowSelected.textContent.trim() === emptyLabel, `selected ${nowSelected?.textContent.trim()} wanted ${emptyLabel}`);
check('empty day explains itself', $3('cal-detail').textContent.includes('No sessions'), $3('cal-detail').textContent.slice(0, 40));

// and back to the busy one
const busyDay = allCells().find((c) => c.classList.contains('has'));
busyDay.click();
await wait(60);
check('can switch back to a day with sessions', $3('cal-detail').querySelectorAll('.cal-rec').length === 8, `${$3('cal-detail').querySelectorAll('.cal-rec').length}`);
check('no leftover padding from the old zoom', !$3('cal-detail').style.paddingBottom, $3('cal-detail').style.paddingBottom);
check('zoom wrapper is gone', !$3('cal-zoom') && !$3('cal-zoom-in'));

// --- planning ahead --------------------------------------------------------
// A day carries what is going to happen as well as what did. Driven entirely
// through the panel, because the rule and the row are the same feature.
const plan3 = () => $3('cal-detail').querySelector('.cal-plan');
check('every day has a plan panel', !!plan3(), $3('cal-detail').innerHTML.slice(0, 60));
check('and says so when there is nothing on it',
  plan3().textContent.includes('Nothing planned'), plan3().textContent.slice(0, 50));

// pick a day later this month, so nothing about it can be in the log
const future = allCells().find((c) => Number(c.textContent.trim()) === Number(new Date().getDate()) + 2)
  || allCells()[allCells().length - 1];
const futureNum = future.textContent.trim();
future.click();
await wait(60);
$3('cal-detail').querySelector('.cal-plan-add').click();
await wait(60);
check('the add form opens', !!$3('cal-detail').querySelector('.plan-form'));
check('and offers both kinds', $3('cal-detail').querySelectorAll('.plan-kind').length === 2);

const typeInto = (sel, value) => {
  const el = $3('cal-detail').querySelector(sel);
  el.value = value;
  el.dispatchEvent(new w3.Event('input'));
  el.dispatchEvent(new w3.Event('change'));
};
typeInto('.plan-text', 'Return the library books');
typeInto('.plan-time', '09:30');
$3('cal-detail').querySelector('.plan-save').click();
await wait(80);
check('a task can be planned for a day that has not happened',
  $3('cal-detail').querySelectorAll('.plan-row.task').length === 1,
  $3('cal-detail').querySelector('.cal-plan').textContent.slice(0, 60));
check('it remembers the time it was given',
  $3('cal-detail').querySelector('.plan-row').textContent.includes('09:30'),
  $3('cal-detail').querySelector('.plan-row').textContent);
check('and it is written down, not just drawn',
  JSON.parse(w3.localStorage.getItem('focus_plan') || '[]').length === 1,
  w3.localStorage.getItem('focus_plan'));
check('the day is marked on the month as owing something',
  !!$3('cal-grid').querySelector('.cal-cell.todo .todo-dot'),
  `${$3('cal-grid').querySelectorAll('.todo-dot').length} marks`);
check('and not marked as an event, which is a different thing',
  !$3('cal-grid').querySelector('.ev-dot'));

// an event on the same day, which is the case the two colours exist for
$3('cal-detail').querySelector('.cal-plan-add').click();
await wait(60);
$3('cal-detail').querySelectorAll('.plan-kind')[1].click();
await wait(60);
typeInto('.plan-text', 'Dentist');
typeInto('.plan-time', '14:00');
$3('cal-detail').querySelector('.plan-save').click();
await wait(80);
check('an event can share the day with a task',
  $3('cal-detail').querySelectorAll('.plan-row.event').length === 1
  && $3('cal-detail').querySelectorAll('.plan-row.task').length === 1,
  $3('cal-detail').querySelector('.cal-plan').textContent.slice(0, 80));
check('the event is listed above the task',
  $3('cal-detail').querySelector('.plan-row').classList.contains('event'),
  $3('cal-detail').querySelector('.plan-row').className);
check('the day now carries both marks, in their own colours',
  !!$3('cal-grid').querySelector('.cal-cell.todo.ev')
  && !!$3('cal-grid').querySelector('.ev-dot') && !!$3('cal-grid').querySelector('.todo-dot'));
check('an event is never ticked off — it is not yours to do',
  !$3('cal-detail').querySelector('.plan-row.event .plan-tick'));

// ticking one day of it
$3('cal-detail').querySelector('.plan-row.task .plan-tick').click();
await wait(60);
check('a planned task can be ticked off from the calendar',
  $3('cal-detail').querySelector('.plan-row.task').classList.contains('done'));
check('the day stops asking for it once it is done',
  !$3('cal-grid').querySelector('.todo-dot'),
  `${$3('cal-grid').querySelectorAll('.todo-dot').length} left`);

// --- repeats ---------------------------------------------------------------
$3('cal-detail').querySelector('.cal-plan-add').click();
await wait(60);
typeInto('.plan-text', 'Water the plants');
$3('cal-detail').querySelectorAll('.plan-rep')[1].click();   // Daily
await wait(60);
check('choosing a repeat asks how often', !!$3('cal-detail').querySelector('.plan-every'));
check('and when it should stop', $3('cal-detail').querySelectorAll('.plan-end').length === 3);
$3('cal-detail').querySelector('.plan-save').click();
await wait(80);
const repeated = JSON.parse(w3.localStorage.getItem('focus_plan')).find((p) => p.text === 'Water the plants');
check('a repeat is stored as one rule, not as many rows',
  !!repeated && repeated.rep && repeated.rep.every === 'day', JSON.stringify(repeated && repeated.rep));
check('the row says what the rule is',
  $3('cal-detail').textContent.includes('Every day'), $3('cal-detail').textContent.slice(0, 120));
// it lands on the next day as well, which is the whole point
const nextDay = allCells().find((c) => c.textContent.trim() === String(Number(futureNum) + 1));
if (nextDay) {
  nextDay.click();
  await wait(60);
  check('a daily repeat lands on the day after too',
    $3('cal-detail').textContent.includes('Water the plants'),
    $3('cal-detail').querySelector('.cal-plan').textContent.slice(0, 60));
  check('but the one-off task did not follow it there',
    !$3('cal-detail').textContent.includes('library books'));
}

// ===========================================================================
// Pass 3 — two devices sharing a timer over the fake peer network
// ===========================================================================
/* ---- clock faces ----
   Four ways of drawing the same countdown, one on screen at a time. What is
   worth checking is not that each one looks right — a test cannot see that —
   but the things that would silently break one: that exactly one is visible at
   a time, and that each is actually *written to* while it is the one on show. A
   face left out of `facePaint`'s switch would sit frozen at its markup default
   and nothing else would complain.

   **In a window of its own.** Buying a face spends embers, and run inside the
   main window that moved numbers the light and sound checks assert — and left a
   confirm dialog open for the next block to trip over. A fresh boot with its own
   purse costs one more jsdom and keeps both sides honest. */
{
  const { window: fw, errors: faceErr } = boot(html, {
    /* Enough for all three at the new prices — 70 + 40 + 100. */
    focus_embers: JSON.stringify({ have: 2400, earned: 2400, own: ['seaglass'], light: 'seaglass' }),
  });
  await wait(400);
  const $ = (id) => fw.document.getElementById(id);
  const window = fw;                       // shadowed on purpose: the helpers below
  fw.document.getElementById('begin').click();
  await wait(120);
  const pickBtn = (id) => $('face-pick').querySelector(`[data-face-pick="${id}"]`);
  const faces = [...$('face-pick').querySelectorAll('[data-face-pick]')].map((b) => b.dataset.facePick);
  check('the menu offers a choice of clock face', faces.length >= 4, faces.join(','));
  check('and all but the plain one have a price on them',
    [...$('face-pick').querySelectorAll('.locked')].length === faces.length - 1,
    [...$('face-pick').querySelectorAll('.locked')].map((b) => b.dataset.facePick).join(','));

  /* Bought through the real dialog. There is no back door worth having — the
     ember record in localStorage is a copy, so writing to it grants nothing —
     and the buying is the behaviour under test anyway. */
  const before = +$('emb-box').dataset.have;
  pickBtn('analog').click();
  await wait(60);
  check('choosing one you do not own asks before spending',
    !$('confirm').classList.contains('hide'), $('confirm-title').textContent);
  $('confirm-yes').click();
  await wait(80);
  check('and it comes out of the embers', +$('emb-box').dataset.have < before,
    `${before} → ${$('emb-box').dataset.have}`);
  check('and that face is the one now showing', $('app').dataset.face === 'analog',
    $('app').dataset.face);

  for (const id of faces.filter((f) => f !== 'digital')) {
    if (!pickBtn(id).classList.contains('locked')) continue;
    pickBtn(id).click();
    await wait(50);
    if (!$('confirm').classList.contains('hide')) $('confirm-yes').click();
    await wait(70);
  }
  check('buying the rest leaves them all owned',
    $('face-pick').querySelectorAll('.locked').length === 0,
    [...$('face-pick').querySelectorAll('.locked')].map((b) => b.dataset.facePick).join(','));

  const boxes = ['clock', 'face-analog', 'face-flip', 'face-glass'];
  const visible = () => boxes.filter((id) => window.getComputedStyle($(id)).display !== 'none');
  for (const id of faces) {
    pickBtn(id).click();
    await wait(40);
    check(`choosing ${id} shows one face and no other`, visible().length === 1,
      `${visible().join(',') || 'nothing'}`);
  }

  /* The ring rule is `.dial > svg` and has to stay that way. As `.dial svg` it
     also took the faces — stretching an analog dial over the whole dial and
     turning it a quarter, which is what "super small and broken" was. */
  pickBtn('analog').click();
  await wait(60);
  {
    const face = window.getComputedStyle($('face-analog'));
    const ring = window.getComputedStyle(window.document.querySelector('.dial > svg'));
    check('the progress ring is still turned a quarter', /matrix|rotate/.test(ring.transform),
      ring.transform);
    /* The face *is* absolutely placed, on purpose — centred over the readout so
       the phase name and the session line end up inside the circle. What must
       not happen is the ring's own rotation and `inset:0` reaching it. */
    check('but the clock face is not turned or stretched with it',
      !/rotate|matrix\(0/.test(face.transform) && face.inset !== '0px',
      `${face.transform} / inset ${face.inset}`);
  }
  check('the analog face has its ticks', $('fa-ticks').children.length === 12,
    `${$('fa-ticks').children.length}`);
  check('and its hands are set from the clock',
    /rotate/.test($('fa-min').style.transform) && /rotate/.test($('fa-sec').style.transform),
    `${$('fa-min').style.transform} / ${$('fa-sec').style.transform}`);

  /* Flip: one card per digit, and the cards together read the same as the
     clock. Four separate cards is the point — comparing whole numbers turned
     both halves whenever either changed. */
  pickBtn('flip').click();
  await wait(60);
  {
    const cards = [...window.document.querySelectorAll('#face-flip .ff-card')];
    check('the flip face has a card for every digit', cards.length === 4, `${cards.length}`);
    check('and the cards read the same time as the clock',
      cards.map((c) => c.textContent).join('') === $('clock').textContent.replace(':', ''),
      `${cards.map((c) => c.textContent).join('')} vs ${$('clock').textContent}`);
  }

  /* Hourglass: anchoring, not a depth — the upper sand hangs from the neck and
     the lower stands on the base, which stays true at any size the glass is
     drawn at. Plus the grains, which are the illusion. */
  pickBtn('glass').click();
  await wait(60);
  {
    /* The sand is one path per bulb now — a curved surface, then straight down
       to the neck or the base — so the anchoring is read off the end of `d`
       rather than off `y`/`height`. Still the same claim: the upper sand hangs
       from the neck, the lower stands on the base, whatever the glass is drawn
       at. The surface height is the first coordinate. */
    const td = $('hg-sand-top').getAttribute('d') || '';
    const bd = $('hg-sand-bot').getAttribute('d') || '';
    const surface = (d) => parseFloat((d.match(/^M18 ([\d.]+)/) || [])[1]);
    check('the hourglass sand hangs from the neck and stands on the base',
      td.endsWith('L82 66L18 66Z') && bd.endsWith('L82 118L18 118Z'),
      `${td.slice(-16)} · ${bd.slice(-18)}`);
    const topFill = 66 - surface(td), botFill = 118 - surface(bd);
    check('and it is all still up top a second in', topFill > botFill,
      `${topFill.toFixed(1)} vs ${botFill.toFixed(1)}`);
    /* One material, one fill. The surface used to be a second shape laid over
       the sand — the dished one in `--bg`, which could never match what was
       behind it and read as a grey lens sitting on top. */
    check('and the surface is part of the sand, not a shape laid over it',
      !window.document.getElementById('hg-dip') && !window.document.getElementById('hg-mound'),
      'a separate dip or mound is back');
    check('there are real grains falling', $('hg-grains').children.length >= 8,
      `${$('hg-grains').children.length}`);
    check('and no two of them are on the same clock',
      new Set([...$('hg-grains').children].map((g) => g.style.animationDelay)).size >= 8,
      new Set([...$('hg-grains').children].map((g) => g.style.animationDelay)).size + ' distinct');
    /* **A break turns the glass over, and sand does not hang from a ceiling.**

       Swapping which bulb fills was only half of the flip. Both fills stayed
       anchored to the same edges - the upper one to the neck, the lower one to
       the base - so with the face rotated 180 degrees those became the *high*
       edges and the sand clung to the cap of one bulb and dangled off the neck
       of the other. Read in screen terms the rule does not change: whichever
       way up the glass is, each fill's flat edge is the one nearest the floor,
       and turned over that is the cap and the neck. */
    $('skip').click();
    await wait(240);
    check('a break turns the glass over', $('app').dataset.phase === 'rest', $('app').dataset.phase);
    const rt = $('hg-sand-top').getAttribute('d') || '';
    const rb = $('hg-sand-bot').getAttribute('d') || '';
    check('and it is the glass itself that turns',
      /matrix\(-1|rotate\(180/.test(window.getComputedStyle($('face-glass')).transform),
      window.getComputedStyle($('face-glass')).transform);
    check('and the sand lies on what is now the low edge of each bulb',
      rt.endsWith('L82 12L18 12Z') && rb.endsWith('L82 66L18 66Z'),
      `${rt.slice(-14)} · ${rb.slice(-14)}`);
    const depth = (d, edge) => Math.abs(parseFloat((d.match(/^M18 ([\d.]+)/) || [])[1]) - edge);
    check('with a break that has only just started still to run through',
      depth(rb, 66) > depth(rt, 12),
      `${depth(rb, 66).toFixed(1)} above vs ${depth(rt, 12).toFixed(1)} below`);
    $('skip').click();                     // back to focusing for the rest of this block
    await wait(240);

    /* The phase name is the one thing a glass with sand at the top already
       says, so it goes; "1 of 4" is what it cannot say and stays. */
    check('the phase name is not repeated over the hourglass',
      window.getComputedStyle($('phase-name')).display === 'none',
      window.getComputedStyle($('phase-name')).display);
    check('but the session line still is', $('subline').textContent.trim().length > 0,
      $('subline').textContent);
  }

  /* The faces are on the shelf as well as in the menu. A thing you can buy that
     is not where the buying happens is a thing nobody finds. */
  fw.document.getElementById('d-stats').click();
  await wait(160);
  { const t = fw.document.querySelector('#emb-box [data-tab="faces"]'); if (t) t.click(); }
  await wait(60);
  check('the clock faces are on their own shelf in the shop',
    fw.document.querySelectorAll('#emb-box [data-face-pick]').length >= 4,
    `${fw.document.querySelectorAll('#emb-box [data-face-pick]').length}`);
  check('and the menu picker uses the same chip the ambience picker does',
    $('face-pick').querySelectorAll('.amb-btn').length >= 4,
    `${$('face-pick').querySelectorAll('.amb-btn').length} chips`);

  /* **Back closes what is open, it does not leave.** The app parks a spare
     history entry whenever a layer is up, so Back lands on `popstate` instead
     of on the way out of the app. Checked from the top of the stack down. */
  {
    const isOpen = (id) => { const e = fw.document.getElementById(id); return e && !e.classList.contains('hide'); };
    /* The entry is parked by a watcher on a timer rather than by the thing that
       opened the page — see the note in 44-back.js about why it is not hooked
       into every `open()`. So this waits for it instead of assuming it, which
       is also the honest thing to assert: what matters is that it arrives. */
    for (let i = 0; i < 12 && fw.history.length < 2; i++) await wait(100);
    check('opening a page parks a history entry to catch Back', fw.history.length > 1,
      `${fw.history.length}`);
    fw.history.back();
    await wait(220);
    check('and Back closes the page rather than the app', !isOpen('stats-overlay'),
      'stats page still open');
  }

  check('the chosen face is written down with the other settings',
    JSON.parse(window.localStorage.getItem('focus_sim') || '{}').face === 'glass',
    window.localStorage.getItem('focus_sim'));
  pickBtn('digital').click();
  await wait(40);
  check('and nothing threw while all that happened', faceErr.length === 0,
    faceErr.slice(0, 2).join(' | '));
}

/* ---- a price went up, and nobody paid it twice -----------------------------

   **This is the one that broke.** The balance is derived and never stored:
   `have = earned - SUM(price(id) for id in own)`. Put a price up in the shop
   and that sum is silently recomputed over everything people already own, at
   the new number — so eleven lights, five tracks and three clock faces going
   up at once took hundreds of embers off everybody who had them, in a single
   update, and several people watched their balance land on zero.

   The fix is that the shelf price and the price you paid are two different
   things: `EMB_WAS` in 37-embers.js freezes the old list, and `grand` — the
   ids a device owned the first time it met the rise — decides which of the
   two applies. So this boots a device with an *old* ember record: one that
   holds pre-rise purchases and has never heard of `grand`.

   Old prices: 5 + 10 + 15 + 15 + 60 = 105. A balance of 1695 out of 1800 is the
   fix; anything lower means the rise was charged retrospectively. The absolute
   numbers move whenever the shelf is repriced — what is being tested is the
   subtraction, so they are written as the arithmetic rather than as a total. */
{
  const OLD_OWN = ['seaglass', 'latesun', 'dusk', 'frost', 'snd-rain', 'face-glass'];
  const { window: pw, errors: pErr } = boot(html, {
    // no `grand` key: this record was written by a build that had no such idea
    focus_embers: JSON.stringify({ have: 1800, earned: 1800, own: OLD_OWN, light: 'latesun' }),
  });
  await wait(400);
  const $p = (id) => pw.document.getElementById(id);
  const OLD_PAID = 105;                       // 5 + 10 + 15 + 15 + 60, as bought
  check('an old record keeps every ember it had when the prices went up',
    +$p('emb-box').dataset.have === 1800 - OLD_PAID,
    `${$p('emb-box').dataset.have}, wanted ${1800 - OLD_PAID}`);
  /* Written down, so the next boot does not have to work it out again — and so
     it can travel to the other devices on the account. */
  const rec = JSON.parse(pw.localStorage.getItem('focus_embers') || '{}');
  check('and what it was holding at the time is written down',
    Array.isArray(rec.grand) && OLD_OWN.every((id) => rec.grand.indexOf(id) >= 0),
    JSON.stringify(rec.grand));
  /* The other half: the rise is real for anything bought *after* it. This device
     never owned Hearth, so it pays whatever Hearth costs today. */
  $p('emb-spend-row').click();
  await wait(150);
  { const t = $p('emb-box').querySelector('[data-tab="looks"]'); if (t) t.click(); }
  await wait(80);
  const before = +$p('emb-box').dataset.have;
  const hearth = $p('emb-box').querySelector('[data-light="hearth"]');
  hearth.click();
  await wait(80);
  $p('confirm-yes').click();
  await wait(150);
  check('but anything bought after the rise pays the new price',
    +$p('emb-box').dataset.have === before - 168,
    `${$p('emb-box').dataset.have} was ${before}`);
  /* And it does not sneak into the grandfathered list on the way — that list
     is written once, at the moment the rise lands, and never grows. */
  const rec2 = JSON.parse(pw.localStorage.getItem('focus_embers') || '{}');
  check('and does not join the list of things that kept the old price',
    (rec2.grand || []).indexOf('hearth') < 0, JSON.stringify(rec2.grand));
  check('and nothing threw while all that happened', pErr.length === 0,
    pErr.slice(0, 2).join(' | '));
}

/* ---- the wardrobe went up too, and was forgotten ---------------------------

   The same release raised every buddy price two to five times, and `grand` was
   only ever filled with lights, sounds and faces — so a device that had met the
   first rise already, holding coats and antics bought at the old prices, was
   re-charged for all of them at the new ones and sat at zero for good.

   This boots exactly that device: `grand` present (it met the lights' rise),
   no wardrobe marker, three buddy things in `own`. Old prices 80 + 100 + 44;
   new ones 400 + 500 + 220, which is more than the whole balance. Then the
   same record comes back with one thing added after the migration, which must
   pay today's price — the migration happens once. */
{
  const BUD = ['bud-o4', 'bud-an0', 'bud-h12'];
  const OLD = 80 + 100 + 44;
  const { window: bw, errors: bErr } = boot(html, {
    focus_embers: JSON.stringify({ adjust: 1000, have: 0, earned: 1000, own: ['seaglass'].concat(BUD),
      grand: ['seaglass'], light: 'seaglass' }),
  });
  await wait(400);
  const $b = (id) => bw.document.getElementById(id);
  check('buddy things bought before the rise keep the price they were bought at',
    +$b('emb-box').dataset.have === 1000 - OLD, `${$b('emb-box').dataset.have}, wanted ${1000 - OLD}`);
  const rec = JSON.parse(bw.localStorage.getItem('focus_embers') || '{}');
  check('and they are written into the grandfathered list, with the marker that it happened',
    BUD.every((id) => (rec.grand || []).indexOf(id) >= 0) && (rec.grand || []).indexOf('@bud-rise') >= 0,
    JSON.stringify(rec.grand));
  check('and that booted without an error', bErr.length === 0, bErr.slice(0, 2).join(' | '));

  /* Next start, holding one more coat that was bought after it. */
  rec.own = rec.own.concat('bud-o6');
  const { window: bw2 } = boot(html, { focus_embers: JSON.stringify(rec) });
  await wait(400);
  const have2 = +bw2.document.getElementById('emb-box').dataset.have;
  check('but something bought after it pays what the shelf says, and the migration does not run twice',
    have2 === 1000 - OLD - 300, `${have2}, wanted ${1000 - OLD - 300}`);
}

/* ---- an achievement is still worth something tomorrow ---------------------

   `payout()` looked in `ACH`, which has never existed — the list is
   `ACH_LIST`. The ReferenceError was caught and read as zero, so every claimed
   achievement was worth nothing to the derived balance: "+6" flashed through
   `credit()` and the next reconcile quietly took it back. Three claimed ones
   worth 1 + 2 + 6 have to arrive in `earned` from a cold start. */
{
  const { window: aw } = boot(html, {
    focus_embers: JSON.stringify({ adjust: 50, have: 0, earned: 0, own: ['seaglass'],
      claimed: ['first', 'ten', 'week'], light: 'seaglass' }),
  });
  await wait(400);
  const got = +aw.document.getElementById('emb-box').dataset.earned;
  check('claimed achievements count towards the balance after a restart', got >= 50 + 9,
    `earned ${got}, wanted at least ${50 + 9}`);
}

/* ---- one puzzle a day, and the same one for everybody ----------------------

   Three separate claims, and each of them fails differently:

     * **The same for everybody.** The generators used `Math.random()`, so two
       people comparing a sudoku were comparing two different grids. They take
       a seeded stream now, keyed on the game, the difficulty and the date —
       which means the check is that the *same* three strings give the same
       grid twice and a *different* date gives a different one. If either half
       of that fails, the feature is a lie.
     * **One a day.** Today's edition is offered once. The archive is not
       rationed, which is what makes the rule bearable rather than mean.
     * **A day is Pakistani.** UTC+5, no daylight saving, so the boundary is a
       fixed offset — and 18:59 UTC and 19:01 UTC on the same evening are two
       different days, which is the only thing worth asserting about it.

   In a window of its own: this seeds a played-calendar, and the arcade blocks
   above assert on a fresh one. */
{
  /* **A door into the closure, opened for this one window.** Everything in
     the app lives inside a single IIFE — which is the point of it — so a test
     that wants to ask "would two people get the same grid" cannot reach the
     generator from outside. The same trick the `look-*` tools use: the last
     line of the bundle is `})();`, and putting a handful of names on `window`
     just before it costs the shipped build nothing. */
  const dailyHtml = withDoor(html, `window.__d = {pktNow, pktDay, pktNum, pktAt, pktDow,
    pktLabel, pktUntilRoll, dailyGen, dailyState, sMake, WORDS, crossReleases,
    crossReleaseDay, crossOnDay, crossLatestDay, DAILY_EPOCH, Sudoku, DCal, Wordle, dailyStreak,
    dailyMark, dailyAdopt, dailyGet, dailyDayCount, DAILY_DONE};`);
  const { window: dw, errors: dErr } = boot(dailyHtml, { focus_daily: JSON.stringify({}) });
  await wait(500);
  const $d = (id) => dw.document.getElementById(id);
  const probe = (fn) => fn(dw.__d);

  /* --- the clock --- */
  const days = probe((d) => ({
    today: d.pktNow(),
    // 18:59 and 19:01 UTC are either side of Pakistani midnight
    before: d.pktDay(Date.UTC(2026, 7, 26, 18, 59)),
    after: d.pktDay(Date.UTC(2026, 7, 26, 19, 1)),
    dow: d.pktDow('2026-08-23'),
    roll: d.pktUntilRoll(Date.UTC(2026, 7, 26, 18, 0)),
  }));
  check('midnight in Pakistan is where one day becomes the next',
    days.before === '2026-08-26' && days.after === '2026-08-27',
    `${days.before} / ${days.after}`);
  check('and the countdown to it is an hour at seven in the evening UTC',
    days.roll === 3600000, `${days.roll}`);
  check('a day knows what day of the week it is', days.dow === 0, `${days.dow}`);

  /* --- the same puzzle, everywhere --- */
  const same = probe((d) => {
    const g = (k) => d.sMake('hard', d.dailyGen('sudoku', 'hard', k)).puz.join('');
    const w = (k) => d.WORDS[d.dailyGen('wordle', '', k)() * d.WORDS.length | 0];
    return {
      twice: g('2026-08-20') === g('2026-08-20'),
      moved: g('2026-08-20') !== g('2026-08-21'),
      byDiff: g('2026-08-20') !== d.sMake('easy', d.dailyGen('sudoku', 'easy', '2026-08-20')).puz.join(''),
      wordTwice: w('2026-08-20') === w('2026-08-20'),
      wordMoved: w('2026-08-20') !== w('2026-08-21'),
    };
  });
  check('the same day makes the same grid, every time it is asked', same.twice);
  check('and the next day makes a different one', same.moved);
  check('and so does the same day at another difficulty', same.byDiff);
  check('the word of the day is the same word twice', same.wordTwice);
  check('and a different word tomorrow', same.wordMoved);

  /* --- the crossword's release schedule ---
     The epoch, 2026-08-17, is a Monday. The 7 comes out every day so no day is
     empty; the 5 and the 9 take alternate days — 5s on Tuesday, Thursday and
     Saturday, 9s on Monday, Wednesday and Friday — and Sunday is the 15 with
     the 7. Three a week each, rather than the 5 and the 7 every day and the 9
     twice. */
  const sched = probe((d) => ({
    mon: [5,7,9,15].filter(n => d.crossReleases(n, '2026-08-17')),
    tue: [5,7,9,15].filter(n => d.crossReleases(n, '2026-08-18')),
    wed: [5,7,9,15].filter(n => d.crossReleases(n, '2026-08-19')),
    fri: [5,7,9,15].filter(n => d.crossReleases(n, '2026-08-21')),
    sat: [5,7,9,15].filter(n => d.crossReleases(n, '2026-08-22')),
    sun: [5,7,9,15].filter(n => d.crossReleases(n, '2026-08-23')),
    // nothing at all before the day the schedule starts
    before: [5,7,9,15].filter(n => d.crossReleases(n, '2026-08-16')),
    // every day of the week has something on it
    week: [0,1,2,3,4,5,6].map(i => [5,7,9,15]
      .filter(n => d.crossReleases(n, d.pktAt(d.pktNum('2026-08-17') + i))).length),
    fives: [0,1,2,3].map(n => d.crossReleaseDay(5, n)),
    nines: [0,1,2].map(n => d.crossReleaseDay(9, n)),
    fifteens: [0,1].map(n => d.crossReleaseDay(15, n)),
    // two days that both publish a five are two different fives
    onTue: d.crossOnDay(5, '2026-08-18').i,
    onThu: d.crossOnDay(5, '2026-08-20').i,
    // and a size on a day it does not run still has a last edition
    latest5OnMon: d.crossLatestDay(5, '2026-08-24'),
    latest9OnSun: d.crossLatestDay(9, '2026-08-23'),
  }));
  check('the seven comes out every day, so no day is empty',
    sched.week.length === 7 && sched.week.every(n => n >= 1), sched.week.join(','));
  check('the nine on Monday, Wednesday and Friday',
    sched.mon.join(',') === '7,9' && sched.wed.join(',') === '7,9' && sched.fri.join(',') === '7,9',
    `${sched.mon} / ${sched.wed} / ${sched.fri}`);
  check('the five on Tuesday, Thursday and Saturday',
    sched.tue.join(',') === '5,7' && sched.sat.join(',') === '5,7',
    `${sched.tue} / ${sched.sat}`);
  check('and never both of them on one day',
    ![sched.mon, sched.tue, sched.wed, sched.fri, sched.sat, sched.sun]
      .some(day => day.indexOf(5) >= 0 && day.indexOf(9) >= 0),
    [sched.mon, sched.tue, sched.wed, sched.fri, sched.sat, sched.sun].join(' | '));
  check('the fifteen on Sunday', sched.sun.join(',') === '7,15', sched.sun.join(','));
  check('and nothing before the day the schedule starts', sched.before.length === 0, sched.before.join(','));
  check('the fives land on Tuesdays, Thursdays and Saturdays',
    sched.fives.join(' ') === '2026-08-18 2026-08-20 2026-08-22 2026-08-25', sched.fives.join(' '));
  check('the nines on Mondays, Wednesdays and Fridays',
    sched.nines.join(' ') === '2026-08-17 2026-08-19 2026-08-21', sched.nines.join(' '));
  /* A size you are looking at on a day it does not run still has a board to
     show: its most recent one. Without this the shelf is empty four days a week
     for the 5s and the 9s and six for the 15. */
  check('and a size out of season falls back to its last edition',
    sched.latest5OnMon === '2026-08-22' && sched.latest9OnSun === '2026-08-21',
    `${sched.latest5OnMon} / ${sched.latest9OnSun}`);
  check('and the fifteens a week apart, on Sundays',
    sched.fifteens.join(' ') === '2026-08-23 2026-08-30', sched.fifteens.join(' '));
  /* **The bank is append-only, and this is what says so.** A puzzle's date is
     its position in its size's list; insert one in the middle and every date
     after it moves, which rewrites history and orphans saved boards. If this
     check ever fails, something was inserted rather than appended. */
  check('and two different days are two different puzzles',
    sched.onTue >= 0 && sched.onThu >= 0 && sched.onTue !== sched.onThu,
    `${sched.onTue} / ${sched.onThu}`);

  /* --- one a day --- */
  dw.document.getElementById('arcade-open').click();
  await wait(120);
  [...dw.document.querySelectorAll('.pcard')].find((c) => c.dataset.game === 'sudoku').click();
  await wait(400);
  check('the calendar button is on a game that has editions',
    !$d('ov-cal').classList.contains('hide'), $d('ov-cal').className);

  /* Finish today's easy the short way — filling in eighty-one cells through
     the DOM would be testing the keypad, which has its own checks. */
  probe((d) => { d.Sudoku.newGame('easy', true); d.Sudoku.grid = d.Sudoku.sol.slice(); d.Sudoku.checkDone(); });
  await wait(150);
  check('finishing today’s puzzle marks the day',
    probe((d) => d.dailyState('sudoku', 'easy', d.pktNow())) === 2,
    `${probe((d) => d.dailyState('sudoku', 'easy', d.pktNow()))}`);

  const solved = probe((d) => d.Sudoku.grid.join(''));
  probe((d) => d.Sudoku.newGame('easy'));
  await wait(150);
  check('and pressing that difficulty again does not hand out another one',
    probe((d) => d.Sudoku.grid.join('')) === solved, 'the board changed');
  check('it opens the calendar instead, which is where the rest are',
    !$d('dcal-overlay').classList.contains('hide'), $d('dcal-overlay').className);

  /* --- the archive is open --- */
  check('the calendar is that game’s, and says so',
    /Sudoku/.test($d('dcal-title').textContent), $d('dcal-title').textContent);
  check('with a key saying which colour is which difficulty',
    /Easy/.test($d('dcal-keys').textContent) && /Hard/.test($d('dcal-keys').textContent)
    && /finished/.test($d('dcal-keys').textContent),
    $d('dcal-keys').textContent);
  const cells = [...$d('dcal-grid').querySelectorAll('.dcal-cell[data-d]')];
  check('a month of days, each with a dot per difficulty',
    cells.length > 20 && cells.every((c) => c.querySelectorAll('.dcal-dot').length === 3
      || c.classList.contains('future')),
    `${cells.length} cells`);
  const todayCell = cells.find((c) => c.classList.contains('today'));
  check('today is marked, and its finished puzzle is filled in',
    !!todayCell && todayCell.querySelectorAll('.dcal-dot.done').length === 1,
    todayCell ? todayCell.innerHTML : 'no today');
  /* Nothing before the day the arcade started having days: sudoku can make a
     puzzle for any date there has ever been, which is not a reason to offer
     one for a Tuesday in 1997. */
  check('and days from before any of this existed offer nothing',
    cells.filter((c) => c.dataset.d < '2026-08-17')
      .every((c) => c.classList.contains('future') && !c.querySelector('.dcal-dot')),
    'a day before the epoch had a puzzle on it');

  /* Playing an older one from the calendar. Yesterday's easy has never been
     touched, so it is a fresh grid rather than the one just solved. */
  const yday = probe((d) => d.pktAt(d.pktNum(d.pktNow()) - 1));
  probe((d) => { d.DCal.sel = yday; d.DCal.render(); });
  await wait(120);
  const play = [...$d('dcal-day').querySelectorAll('[data-play]')][0];
  check('an older day offers its puzzles to play', !!play, $d('dcal-day').textContent.slice(0, 80));
  play.click();
  await wait(250);
  check('and opening one leaves the calendar for the board',
    $d('dcal-overlay').classList.contains('hide'));
  check('which is that day’s puzzle, not today’s',
    probe((d) => d.Sudoku.day) === yday && probe((d) => d.Sudoku.grid.join('')) !== solved,
    `${probe((d) => d.Sudoku.day)} vs ${yday}`);
  check('and the board says which day it is showing',
    new RegExp(probe((d) => d.pktLabel(yday))).test($d('sdk-meta').textContent),
    $d('sdk-meta').textContent);

  /* **The banner's button has to say the true next thing.** It appears only on
     a puzzle you just finished, so on the day's own edition "New puzzle" is a
     promise the rule will not keep. */
  probe((d) => { d.Sudoku.newGame('medium', true); d.Sudoku.grid = d.Sudoku.sol.slice(); d.Sudoku.checkDone(); });
  await wait(150);
  check('and the banner offers the archive once the day is spent',
    /History/.test($d('sdk-again').textContent), $d('sdk-again').textContent);
  $d('sdk-again').click();
  await wait(150);
  check('which is where it goes',
    !$d('dcal-overlay').classList.contains('hide'), $d('dcal-overlay').className);
  $d('dcal-close').click();
  await wait(60);

  /* --- a streak day is the whole day -------------------------------------

     Easy and medium are done at this point and hard is not, which is exactly
     the case the rule exists for: two puzzles solved is not a day cleared.
     It used to be the best of three separate streaks, so a long run of easies
     read as a long run of sudoku and the number meant nothing. */
  {
    const streak = () => probe((d) => d.dailyStreak('sudoku', ['easy', 'medium', 'hard']));
    check('two of the three difficulties is not a streak day', streak() === 0, `${streak()}`);
    probe((d) => { d.Sudoku.newGame('hard', true); d.Sudoku.grid = d.Sudoku.sol.slice(); d.Sudoku.checkDone(); });
    await wait(150);
    check('and finishing the third makes it one', streak() === 1, `${streak()}`);
    /* And it says so on the board, which is the only place you see it while
       actually playing. Hidden at zero, so it is never a scoreboard for not
       having played. */
    probe((d) => d.Sudoku.render());
    await wait(80);
    const chip = $d('sdk-streak');
    check('the board wears the streak', !chip.classList.contains('hide')
      && /\u{1F525}\s*1/u.test(chip.textContent), chip.textContent + ' / ' + chip.className);
    /* **The schedule decides what "every" means.** Each day publishes two sizes
       and they are not the same two — a Tuesday is the 5 and the 7, a Wednesday
       the 7 and the 9, a Sunday the 7 and the 15 — so keeping a streak means
       finishing whatever came out that day, and a size that did not come out is
       skipped rather than counted as a miss. This is the part a
       single-difficulty game cannot exercise. */
    const cw = probe((d) => {
      const on = (day, k) => d.crossReleases(+k, day);
      const all = ['5', '7', '9', '15'];
      return {
        tueNeeds: d.dailyDayCount('crossword', all, on, '2026-08-18')[1],
        wedNeeds: d.dailyDayCount('crossword', all, on, '2026-08-19')[1],
        sunNeeds: d.dailyDayCount('crossword', all, on, '2026-08-23')[1],
        tueSizes: [5, 7, 9, 15].filter(n => d.crossReleases(n, '2026-08-18')).join(','),
        wedSizes: [5, 7, 9, 15].filter(n => d.crossReleases(n, '2026-08-19')).join(','),
      };
    });
    check('every day asks for exactly the sizes published on it',
      cw.tueNeeds === 2 && cw.wedNeeds === 2 && cw.sunNeeds === 2, JSON.stringify(cw));
    check('and a Tuesday and a Wednesday are not the same two',
      cw.tueSizes === '5,7' && cw.wedSizes === '7,9', cw.tueSizes + ' / ' + cw.wedSizes);

    /* **Opening lands on the newest board, finished or not.**

       Moving to today used to also require that today's be *unplayed*, which
       made doing today's puzzle the one thing that reliably left you behind:
       solve Tuesday's, come back on Wednesday, and Tuesday's solved grid was
       what was waiting. Nothing is lost by moving — the board is stashed and
       the calendar hands it straight back — and a grid you have already
       finished is not what anybody opens the app to look at.

       Driven on the state rather than through the screen: what is under test is
       the one condition in `enter`, and clicking a week of calendar cells to
       reach it would be testing the calendar. */
    {
      const set = probe((d) => {
        const today = d.pktNow();
        const old = d.pktAt(d.pktNum(today) - 3);
        d.dailyMark('sudoku', d.Sudoku.diff, today, d.DAILY_DONE);
        d.Sudoku._chose = false;
        d.Sudoku.day = old;
        return { today, old, on: d.Sudoku.day };
      });
      await probe((d) => d.Sudoku.enter());
      await wait(200);
      const moved = probe((d) => d.Sudoku.day);
      check('a day already finished is no reason to open on an old board',
        set.on === set.old && moved === set.today, set.old + ' -> ' + moved);

      /* And the exception holds: a day you opened yourself is still yours until
         the app is closed, or browsing the archive would be impossible. */
      probe((d) => { d.Sudoku._chose = true; d.Sudoku.day = set.old; });
      await probe((d) => d.Sudoku.enter());
      await wait(200);
      const kept = probe((d) => d.Sudoku.day);
      check('but a day you chose yourself is left where it is',
        kept === set.old, set.old + ' -> ' + kept);
      probe((d) => { d.Sudoku._chose = false; d.Sudoku.day = set.today; });

      /* The word game had the same two conditions and loses them both. */
      const w = probe((d) => {
        const today = d.pktNow();
        const old = d.pktAt(d.pktNum(today) - 2);
        /* Left unfinished on purpose: the old condition also required
           `this.done`, so an unsolved old word is exactly the case it refused
           to move on from. Today's record is deliberately not touched — a done
           mark without a pattern is one the calendar cannot draw, and the grid
           checks further down read it. */
        d.Wordle._chose = false;
        d.Wordle.answer = 'crane';
        d.Wordle.done = false;
        d.Wordle.day = old;
        return { today, old };
      });
      await probe((d) => d.Wordle.enter());
      await wait(200);
      const wOn = probe((d) => d.Wordle.day);
      check('and the word of the day is today’s word',
        wOn === w.today, w.old + ' -> ' + wOn);
    }
  }

  /* --- the word grid, and the streak ------------------------------------

     Two things that only exist once a word has actually been guessed.

     The grid is the thing people screenshot. It has to be drawn from what was
     saved rather than from the live game, because the whole point is that it
     is still there tomorrow — so the record carries one string, five
     characters a guess, and the calendar reads it back. It must say how close
     each try was and never which word it was.

     The streak counts days finished *on the day*, which is why yesterday's
     puzzle played today does not move it. Playing the archive is welcome; it
     is just not a streak. */
  {
    /* Guess it in three: two wrong words to put some colour in the grid, then
       the answer. `submit` is the path the Enter key takes, so this is the real
       one rather than a hand-written record. */
    await probe((d) => d.Wordle.enter());
    await wait(150);
    const answer = probe((d) => d.Wordle.answer);
    // two real words off the list, so `submit` accepts them
    const misses = probe((d) => d.WORDS.filter((w) => w !== d.Wordle.answer).slice(0, 2));
    const play = (word) => probe((d) => { d.Wordle.cur = word; d.Wordle.submit(); });
    play(misses[0]); await wait(60);
    play(misses[1]); await wait(60);
    play(answer); await wait(200);
    check('the word is guessed', probe((d) => d.Wordle.won === true && d.Wordle.done === true),
      probe((d) => `${d.Wordle.won}/${d.Wordle.done}`));

    /* One row of five per guess, six rows in all — the tries that were not
       needed are drawn empty and marked `spare`, so a word found in one does
       not read as a worse day than one found in six. The last *played* row is
       all hits, because the last guess was the answer. */
    probe((d) => d.DCal.open('wordle'));
    await wait(150);
    const row = [...$d('dcal-day').querySelectorAll('.dcal-row')][0];
    const art = $d('dcal-day').querySelector('.wdl-art');
    const played = art ? [...art.querySelectorAll('.wdl-art-row:not(.spare)')] : [];
    check('and the calendar draws the grid it made',
      !!art && played.length === 3
      && art.querySelectorAll('.wdl-art-row').length === 6,
      art ? `${played.length} played of ${art.querySelectorAll('.wdl-art-row').length}` : 'no grid');
    check('five squares to a row', !!art
      && [...art.querySelectorAll('.wdl-art-row')].every((r) => r.children.length === 5),
      art ? [...art.querySelectorAll('.wdl-art-row')].map((r) => r.children.length).join(',') : '-');
    const last = played[played.length - 1];
    check('and the row that got it is all green',
      !!last && [...last.children].every((i) => i.className === 'hit'),
      last ? [...last.children].map((i) => i.className || '·').join(' ') : '-');
    /* **The picture must not be the answer.** A grid that leaked letters would
       be the one thing this feature must never do. */
    check('with no letters anywhere in it',
      !!art && !/[a-z]/i.test(art.textContent), art ? art.textContent : '-');
    check('and the line above it says how it went',
      !!row && /Found in 3\/6/.test(row.textContent), row ? row.textContent : '-');

    /* --- streaks are for the day of release --- */
    check('finishing today’s puzzle starts a streak',
      probe((d) => d.dailyStreak('wordle', '')) === 1,
      `${probe((d) => d.dailyStreak('wordle', ''))}`);
    check('which the summary tiles lead with',
      /streak/i.test($d('dcal-sum').textContent), $d('dcal-sum').textContent.slice(0, 60));
    /* Two days of archive, filed the way playing an old one files it — no `d`
       flag, because they were not finished on their day. The streak does not
       move, and that is the rule. */
    probe((d) => {
      const y1 = d.pktAt(d.pktNum(d.pktNow()) - 1);
      const y2 = d.pktAt(d.pktNum(d.pktNow()) - 2);
      d.dailyMark('wordle', '', y1, d.DAILY_DONE, {g: 4, w: 1});
      d.dailyMark('wordle', '', y2, d.DAILY_DONE, {g: 4, w: 1});
    });
    await wait(80);
    check('but going back through the archive does not extend it',
      probe((d) => d.dailyStreak('wordle', '')) === 1,
      `${probe((d) => d.dailyStreak('wordle', ''))}`);
    /* **And the yesterday that *was* done on its day does count** — otherwise
       the check above would be passing on a streak that is simply broken.
       It gets the flag the only way a past day ever can: another device that
       played it on the day hands its record over, `d` and all, through the
       account merge. Which also says `mergeDaily` is carrying the flag. */
    probe((d) => {
      const y1 = d.pktAt(d.pktNum(d.pktNow()) - 1);
      const from = { 'wordle:': {} };
      from['wordle:'][y1] = { s: 2, g: 4, w: 1, d: 1 };
      d.dailyAdopt(from);
    });
    await wait(80);
    check('while a day that was done on its own day does',
      probe((d) => d.dailyStreak('wordle', '')) === 2,
      `${probe((d) => d.dailyStreak('wordle', ''))}`);
    /* --- and a second go at it changes nothing ---

       "Look again" hands the board back, and every key pressed on it used to
       overwrite the day: a word found in three, reopened and abandoned, became
       a miss, and the grid people screenshot became whatever was last typed.
       One puzzle, one score. The board is still playable; it just no longer
       counts. */
    const kept = probe((d) => JSON.stringify(d.dailyGet('wordle', '', d.pktNow())));
    /* Play it again and *finish* it, differently — straight to the answer, one
       guess, one green row. A replay that is merely started writes nothing
       either way, so beating the day a second time is the case that tells the
       rule apart from no rule at all. */
    probe((d) => { d.Wordle.newGame(d.pktNow()); });
    await wait(120);
    play(answer);
    await wait(200);
    check('the second go really did finish, differently',
      probe((d) => d.Wordle.done && d.Wordle.guesses.length === 1),
      probe((d) => `${d.Wordle.done}/${d.Wordle.guesses.length}`));
    check('playing the day again does not rewrite what happened',
      probe((d) => JSON.stringify(d.dailyGet('wordle', '', d.pktNow()))) === kept,
      probe((d) => JSON.stringify(d.dailyGet('wordle', '', d.pktNow()))));
    probe((d) => d.DCal.open('wordle'));
    await wait(150);
    const still = $d('dcal-day').querySelector('.wdl-art');
    check('and the grid on the calendar is still the one it drew',
      !!still && still.querySelectorAll('.wdl-art-row:not(.spare)').length === 3
      && still.querySelectorAll('.wdl-art-row').length === 6,
      still ? `${still.querySelectorAll('.wdl-art-row:not(.spare)').length} played` : 'no grid');
    /* **The grid stands where the edition's name would be**, rather than
       under the row as a loose graphic. */
    check('which sits inside the row, in place of its name',
      !!still && still.closest('.dcal-row') !== null
      && !$d('dcal-day').querySelector('.dcal-row b'),
      still && still.closest('.dcal-row') ? 'in the row' : 'outside it');

    $d('dcal-close').click();
    await wait(60);
  }

  check('and nothing threw while all that happened', dErr.length === 0,
    dErr.slice(0, 2).join(' | '));
}

/* ---- the wardrobe is bought, and tried on before it is ---------------------

   Everything he wears used to be free and listed. It is bought now, which
   changes three things and each of them is a way to get it wrong:

     * the wardrobe holds only what you own, so a new person's rows are one
       tile long rather than a wall of things they cannot use;
     * the shop is where the rest is, and you can put something on *before*
       paying for it — a hat you cannot see on him is a hat nobody buys;
     * and nothing he has not bought may stay on him, which is what turns the
       change into a migration nobody had to write: on this update everything
       came off, and the rule that took it off is checked continuously rather
       than run once behind a flag.

   In a window of its own, with a purse, because buying spends embers and the
   blocks above assert on the balance. */
{
  const { window: bw, errors: budErr } = boot(html, {
    focus_embers: JSON.stringify({ have: 1800, earned: 1800, own: ['seaglass'], light: 'seaglass' }),
    /* Wearing three things he has never bought — which is exactly what every
       existing buddy looked like the moment the shop arrived. */
    focus_sim: JSON.stringify({ focusMin: 25, breakMin: 5, repeat: 4, face: 'digital',
      buddy: { b: 2, c: 3, e: 4, h: 5, a: 2, f: 1, o: 3 }, budAnim: 5, budShow: true, at: 9 }),
  });
  await wait(500);
  const $b = (id) => bw.document.getElementById(id);
  const shopTab = async (id) => {
    const t = $b('emb-box').querySelector(`[data-tab="${id}"]`);
    if (t) t.click();
    await wait(70);
  };

  /* The migration, and it is not a migration — it is a rule. */
  const worn = JSON.parse(bw.localStorage.getItem('focus_sim') || '{}');
  check('anything he had not bought came off him',
    worn.buddy && worn.buddy.h === 0 && worn.buddy.a === 0 && worn.buddy.f === 0
    && worn.buddy.o === 0 && worn.buddy.e === 0,
    JSON.stringify(worn.buddy));
  /* **The antic is hidden, not forgotten — and that is the fix, not an
     oversight.** `budAnimSaved()` already answers -1 for an antic he does not
     own, so he is neither drawn doing it nor announced as doing it in a room:
     the check below is what that looks like from outside. Writing -1 into the
     record on top of that bought nothing and cost everything — an ownership
     list that had not finished loading, or an account sync landing a beat
     late, took the choice away for good. That is the "antics randomly reset"
     report. The number stays; buying it back brings him back. */
  check('but the antic he picked is kept rather than cleared',
    (worn.budAnim | 0) === 5, `${worn.budAnim}`);
  check('and with nothing to do, he is off the timer screen',
    $b('bud-live').classList.contains('hide') && $b('bud-pause').classList.contains('hide'),
    `${$b('bud-live').className} / ${$b('bud-pause').className}`);
  /* His colours are his. They were never bought and never will be, so a wipe of
     the wardrobe must not take them — losing the skin you picked because a shop
     opened would read as the update having damaged something. */
  check('but his colours are untouched, because colours are free',
    worn.buddy && worn.buddy.b === 2 && worn.buddy.c === 3, JSON.stringify(worn.buddy));

  $b('d-account').click();
  await wait(160);
  const rowOf = (k) => [...$b('bud-box').querySelectorAll(`[data-bud="${k}"]`)];
  check('the wardrobe starts with only what he owns', rowOf('h').length === 1,
    `${rowOf('h').length} hats`);

  // the way through to the shop is the button on the wardrobe
  $b('bud-shop').click();
  await wait(200);
  check('the wardrobe opens the shop on the wardrobe shelf',
    !$b('shop-overlay').classList.contains('hide')
    && !!$b('emb-box').querySelector('.bud-shop'),
    $b('emb-box').querySelector('.shop-tab.on') ? $b('emb-box').querySelector('.shop-tab.on').textContent : 'no tab');
  const tiles = (k) => [...$b('emb-box').querySelectorAll(`[data-shop="${k}"]`)];
  check('and it holds every hat there is, not only the ones he owns',
    tiles('h').length >= 12, `${tiles('h').length}`);
  check('each one saying what it costs',
    tiles('h').every((t) => /^\d+$/.test(t.querySelector('em').textContent)),
    tiles('h').map((t) => t.querySelector('em').textContent).join(' '));

  /* Trying one on. The whole point: it goes on him, on this screen, and nothing
     has been bought or saved. */
  const stage = () => $b('emb-box').querySelector('.bud-shop-stage').innerHTML;
  const bare = stage();
  /* The bandana: a plain enough hat that dyeing it is a colour rather than a
     different object, which is the line `dye:1` draws — see budPart. */
  const wizard = tiles('h').find((t) => +t.dataset.i === 10);
  wizard.click();
  await wait(120);
  check('tapping one you have not bought puts it on him anyway', stage() !== bare,
    'the preview did not change');
  check('and says what it would cost, with a way out',
    /Buy it for \d+/.test($b('emb-box').textContent) && !!$b('bud-try-off'),
    $b('emb-box').textContent.slice(0, 0) + (($b('bud-try-buy') || {}).textContent || 'no buy button'));
  check('while nothing has actually been bought',
    ($b('emb-box').dataset.own || '').indexOf('bud-h10') < 0, $b('emb-box').dataset.own);
  check('and nothing has been written down either',
    (JSON.parse(bw.localStorage.getItem('focus_sim') || '{}').buddy || {}).h === 0,
    bw.localStorage.getItem('focus_sim'));

  // taking it off again leaves him as he was
  $b('bud-try-off').click();
  await wait(100);
  check('taking it off puts him back', stage() === bare, 'he kept the hat');

  // and buying it
  wizard.click();
  await wait(120);
  const had = +$b('emb-box').dataset.have;
  $b('bud-try-buy').click();
  await wait(120);
  check('buying asks first, like everything else that spends',
    !$b('confirm').classList.contains('hide'), $b('confirm-title').textContent);
  $b('confirm-no').click();
  await wait(80);
  check('and saying no costs nothing', +$b('emb-box').dataset.have === had,
    `${$b('emb-box').dataset.have} was ${had}`);
  $b('bud-try-buy').click();
  await wait(80);
  $b('confirm-yes').click();
  await wait(160);
  check('saying yes spends the embers', +$b('emb-box').dataset.have === had - 104,
    `${$b('emb-box').dataset.have} was ${had}`);
  check('and the hat is his', ($b('emb-box').dataset.own || '').indexOf('bud-h10') >= 0,
    $b('emb-box').dataset.own);
  check('and he is wearing it', $b('emb-box').querySelector('[data-shop="h"][data-i="10"]')
    .classList.contains('on'),
    $b('emb-box').querySelector('[data-shop="h"][data-i="10"]').className);

  /* An antic, from its own shelf, at its own prices. */
  await shopTab('antics');
  const antics = [...$b('emb-box').querySelectorAll('[data-antic]')];
  check('the antics are a shelf of their own', antics.length >= 8, `${antics.length}`);
  /* **Nothing on this shelf is free.** He used to have the web-swing from the
     first minute — the flashiest thing in the shop, given away, and therefore
     the one item nobody would ever buy. Buying the first antic is what embers
     are for now, and until then he stays off the timer screen entirely. */
  check('nothing on the antic shelf is free',
    antics.every((b) => !b.classList.contains('mine')),
    antics.filter((b) => b.classList.contains('mine')).length + ' free');
  check('and it reads cheapest first, so the first one is reachable',
    antics.map((b) => +b.querySelector('em').textContent.replace(/\D+/g, ''))
      .every((n, i, a) => i === 0 || a[i - 1] <= n),
    antics.map((b) => b.querySelector('em').textContent).join(' '));
  const hadA = +$b('emb-box').dataset.have;
  antics.find((b) => +b.dataset.antic === 3).click();
  await wait(80);
  check('buying an antic asks as well', !$b('confirm').classList.contains('hide'),
    $b('confirm-title').textContent);
  $b('confirm-yes').click();
  await wait(160);
  check('it costs what the shelf said', +$b('emb-box').dataset.have === hadA - 350,
    `${$b('emb-box').dataset.have} was ${hadA}`);
  check('and it is his', ($b('emb-box').dataset.own || '').indexOf('bud-an3') >= 0,
    $b('emb-box').dataset.own);
  /* And the other half of keeping the number: buying back the one he had
     already chosen puts it straight back on him, with nothing re-picked. */
  antics.find((b) => +b.dataset.antic === 5).click();
  await wait(80);
  $b('confirm-yes').click();
  await wait(160);

  /* Back in the wardrobe, both purchases are simply there — and the antic is a
     draft until Save, the same as everything else about him. */
  $b('shop-close').click();
  await wait(120);
  $b('d-account').click();
  await wait(160);
  check('what you bought is in the wardrobe afterwards', rowOf('h').length === 2,
    `${rowOf('h').length} hats`);
  check('and the antics are there to choose, being the ones he owns',
    [...$b('bud-box').querySelectorAll('[data-anim]')].length === 2,
    `${[...$b('bud-box').querySelectorAll('[data-anim]')].length} antics`);
  check('with the one he chose before the shop existed already back on him',
    !!$b('bud-box').querySelector('[data-anim="5"].on'),
    [...$b('bud-box').querySelectorAll('[data-anim]')].map((b) => b.className).join(' | '));
  /* **The colour is behind a button now.** Every row having its palette on
     screen at all times was thirteen swatches a row and a page you scrolled
     past to reach the thing you wanted; it opens, is used, and closes. */
  check('a colour is a drawer you open, not a row that is always there',
    rowOf('hc').length === 0 && !!$b('bud-box').querySelector('[data-dye="h"]'),
    `${rowOf('hc').length} swatches on screen`);
  $b('bud-box').querySelector('[data-dye="h"]').click();
  await wait(120);
  check('and opening it offers the colours', rowOf('hc').length >= 8,
    `${rowOf('hc').length} hat colours`);
  /* Dyeing is free and instant, and index 0 is the colour it was drawn in — so
     a part that has never been dyed draws exactly as it always did. */
  const dyed = () => $b('bud-box').querySelector('.bud-stage').innerHTML;
  const asMade = dyed();
  rowOf('hc')[4].click();
  await wait(80);
  // 350 for the antic he did not have, 220 for the one he had already chosen
  check('choosing a colour recolours him and costs nothing',
    dyed() !== asMade && +$b('emb-box').dataset.have === hadA - 570,
    $b('emb-box').dataset.have);
  rowOf('hc')[0].click();
  await wait(80);
  check('and "as made" is exactly what it was before anybody touched it',
    dyed() === asMade, 'the drawing did not come back');

  /* **Leaving him unsaved is a three-answer question.** Save and go, throw the
     changes away and go, or go back to dressing him. It used to be two, with
     "Cancel" meaning *discard* — so the only way to say "I did not mean to
     press Back" was the close box, and a close box is not an answer. */
  rowOf('hc')[4].click();
  await wait(80);
  $b('acct-close').click();
  await wait(140);
  check('leaving him unsaved asks first', !$b('confirm').classList.contains('hide'),
    $b('confirm-title').textContent);
  check('and offers all three answers rather than two',
    !$b('confirm-alt').classList.contains('hide')
    && /Keep editing/.test($b('confirm-alt').textContent)
    && /Discard/.test($b('confirm-no').textContent),
    `${$b('confirm-alt').className} / ${$b('confirm-no').textContent}`);
  $b('confirm-alt').click();
  await wait(140);
  check('and keeping on editing simply closes it, leaving the page open',
    $b('confirm').classList.contains('hide')
    && !$b('acct-overlay').classList.contains('hide'),
    `${$b('confirm').className} / ${$b('acct-overlay').className}`);
  /* The card is shared with every other confirm in the app, so it has to be
     handed back the way they expect to find it — third button gone, No called
     Cancel again. A dialog that remembers the last question it was asked
     offers "Discard" over a light you are buying. */
  check('with the card handed back the way everything else expects it',
    $b('confirm-alt').classList.contains('hide')
    && $b('confirm-no').textContent === 'Cancel',
    `${$b('confirm-alt').className} / ${$b('confirm-no').textContent}`);
  $b('acct-close').click();
  await wait(140);
  $b('confirm-no').click();
  await wait(160);
  check('while discarding drops the changes and goes',
    $b('acct-overlay').classList.contains('hide'), $b('acct-overlay').className);

  check('and nothing threw while all that happened', budErr.length === 0,
    budErr.slice(0, 2).join(' | '));
}

/* **These three have bought a few antics.** Antics are things you buy now, and
   the room checks below are about *which* antic each person is doing — so each
   window needs more than the one everybody starts with. Seeded rather than
   bought through the shop: what is under test here is the room, and paying for
   a jetpack twelve hundred lines from the shop's own checks would be testing
   the shop badly instead of the room well. `bud-an4` is the jetpack and
   `bud-an7` the reader; see BUD_COST in 46-buddy.js. */
const ROOM_EMBERS = JSON.stringify({
  have: 400, earned: 400, own: ['seaglass', 'bud-an1', 'bud-an4', 'bud-an7'], light: 'seaglass',
});
const roomHtml = withDoor(html, 'window.__r = {Account, SYNC, Chat, friendTake, friendCard,'
  + ' syncNormalise, syncCodeFor, syncAdoptAccount, friendFind, syncRender, syncLeave,'
  + ' Arcade, syncInGame, Buddy,'
  + ' friendRemove};');
const { window: host, errors: hostErr } = boot(roomHtml, { focus_embers: ROOM_EMBERS });
const { window: guest, errors: guestErr } = boot(roomHtml, { focus_embers: ROOM_EMBERS });

/* **Rooms in these blocks are between people who already know each other.**

   A room code gets passed around, so somebody the host does not know is held at
   the door rather than simply appearing in the room — see `syncNeedsLetIn`. A
   friend is not held: being on the list is the introduction. Every block below
   is about what happens *in* a room, so the people in it are made mutual
   friends first; the door has its own block, where nobody is. */
const beFriends = (...wins) => {
  for (const a of wins) {
    for (const b of wins) {
      if (a === b) continue;
      const code = b.document.getElementById('sync-mycode').textContent;
      if (!code || code.length < 4) continue;
      if(!a.__r || !a.__r.SYNC) continue;
      const list = a.__r.SYNC.friends;
      if (!list.some((f) => f.code === code)) {
        list.push({ code, u: 'them', name: 'Them', ok: 1, at: Date.now() });
      }
    }
  }
};

/* Both windows get a fixed random sequence from here on. A shared game deals
   from a shuffled bag, and the Scrabble block below has to find a real word in
   whatever rack it is handed — a vowel-less draw is a perfectly fine thing for
   the game to do and a terrible thing for a test to depend on. Different seeds
   per window, because the two are supposed to disagree about most things. */
for (const [w, seed] of [[host, 20260730], [guest, 91173]]) {
  let s = seed;
  w.Math.random = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
}
await wait(400);
const $h = (id) => host.document.getElementById(id);
const $g = (id) => guest.document.getElementById(id);
const syncOnH = () => !$h('sync-state').textContent.includes('Not connected');
const syncOnG = () => !$g('sync-state').textContent.includes('Not connected');

check('a friend code is generated', /^[2-9A-HJ-NP-Z]{6}$/.test($h('sync-mycode').textContent), $h('sync-mycode').textContent);
check('the code avoids confusable characters', !/[OI01]/.test($h('sync-mycode').textContent), $h('sync-mycode').textContent);
check('two devices get different codes', $h('sync-mycode').textContent !== $g('sync-mycode').textContent);

$h('sync-name').value = 'Hashir';
$h('sync-name').dispatchEvent(new host.Event('input'));
$h('d-sync').click();
await wait(40);
check('sync screen opens', !$h('sync-overlay').classList.contains('hide'));

// host with the saved friend code
$h('sync-host').click();
await wait(120);
const hostCode = $h('sync-mycode').textContent;
check('hosting starts', $h('sync-state').textContent.includes('Hosting'), $h('sync-state').textContent);
check('leave button appears while connected', !$h('sync-leave').classList.contains('hide'));

$g('sync-name').value = 'Friend';
$g('sync-name').dispatchEvent(new guest.Event('input'));
$g('d-sync').click();
beFriends(host, guest);

// guest joins by code
$g('sync-code').value = hostCode;
$g('sync-join').click();
await until(() => /Hashir/.test($g('sync-state').textContent));
// The joiner is told whose room it is, not just its code — a code is not a person.
check('guest connects to the host', $g('sync-state').textContent.includes(hostCode), $g('sync-state').textContent);
check('and is told whose room it is', /Hashir/.test($g('sync-state').textContent), $g('sync-state').textContent);
check('host sees the guest by name', $h('sync-people').textContent.includes('Friend'), $h('sync-people').textContent.slice(0, 60));

/* **Who is playing what belongs on the game, not on the person.**

   This started as a glyph beside each name in the room list, which answers the
   question backwards: you do not read down a list of people wondering what each
   is doing, you look at the shelf wondering whether anybody is on something. So
   it is on the picker card now — their faces, on the game — and the room list
   went back to being a list of people. The wire is unchanged; only where it is
   drawn moved. */
{
  /* The *host's* window. `window` is the first one booted and has a picker of
     its own, which is not the one in this room. */
  const faces = () => [...host.document.querySelectorAll('.pcard-who i')];
  const cardOf = (id) => [...host.document.querySelectorAll('.pcard')]
    .find((c) => c.dataset.game === id);
  const picker = () => host.document.querySelector('.picker').innerHTML.slice(0, 140);

  $h('sync-close').click();
  await wait(60);
  $h('arcade-open').click();
  await wait(140);
  check('nobody in a game puts nobody on the shelf', faces().length === 0, picker());

  await openGame(guest, $g, 'hangman');
  await wait(2400);                            // a heartbeat is 2s; see SYNC_BEAT
  check('somebody in a game shows up on that game\u2019s card',
    !!cardOf('hangman').querySelector('.pcard-who i'),
    cardOf('hangman').innerHTML.slice(0, 200));
  /* On *that* card and no other, or it says nothing at all. */
  check('and on no other card', faces().length === 1, `${faces().length}`);
  /* **In the card's icon slot, above the status — not pinned over it.** jsdom
     has no layout, so this asks where the faces are and how they are placed:
     inside `.pcard-icons`, which comes before the status in its column, and in
     the flow rather than `position:absolute`, which is how they covered it. */
  {
    const who = cardOf('hangman').querySelector('.pcard-who');
    const slot = who && who.parentNode;
    const side = slot && slot.parentNode;
    check('and they sit in the card\'s icon slot, above the status',
      !!who && slot.classList.contains('pcard-icons') && side.classList.contains('pcard-side')
      && side.firstElementChild === slot && /\bprog\b/.test((slot.nextElementSibling || {}).className || ''),
      who ? (side ? side.innerHTML.slice(0, 120) : 'no side column') : 'no faces');
    check('in the flow, not pinned over the corner',
      !!who && host.getComputedStyle(who).position !== 'absolute',
      who ? host.getComputedStyle(who).position : 'no faces');
  }
  check('with their name on it', /Friend/.test(
    (cardOf('hangman').querySelector('.pcard-who') || {}).title || ''),
    (cardOf('hangman').querySelector('.pcard-who') || {}).title);
  /* The room list is a list of people again. */
  check('and nothing is added to the room list',
    $h('sync-people').querySelectorAll('.sync-game').length === 0,
    $h('sync-people').innerHTML.slice(0, 100));

  $g('ov-back').click();
  $g('ov-back').click();
  await wait(2400);
  check('and they leave the card when they leave the game',
    faces().length === 0, picker());
  $h('ov-back').click();
  await wait(60);
  $h('d-sync').click();
  await wait(60);
}

/* The buddy travels with the `hello` that opens a connection, so by the time
   somebody is in the list they are also wearing their own face. Five indexes
   into tables both ends share — about forty bytes, which is why it can ride
   along on every connection rather than being asked for separately. */
check('and the guest arrives with their buddy',
  !!$h('sync-people').querySelector('.sync-person .bud'),
  $h('sync-people').innerHTML.slice(0, 90));
/* The band on the timer screen is the only thing that knows other people are
   here, so it is the way in to seeing them. It used to be inert text. */
check('the room band is a way in, not a label',
  $h('sync-band').getAttribute('role') === 'button' && typeof $h('sync-band').onclick === 'function',
  `${$h('sync-band').getAttribute('role')}`);
$h('sync-band').click();
await wait(80);
check('and tapping it opens the room', !$h('sync-overlay').classList.contains('hide'));
$h('sync-close').click();
await wait(60);
check('guest sees who is leading', $g('sync-people').textContent.includes('holds the timer'), $g('sync-people').textContent.slice(0, 60));

// leader starts the timer; the follower should follow
$h('begin').click();
await wait(250);
check('follower left the setup screen', $g('setup').classList.contains('hide'));
check('follower clock is running', $g('toggle-run').textContent.trim() === 'Pause', $g('toggle-run').textContent);
const hostSecs = parseInt($h('clock').textContent.split(':')[0], 10) * 60 + parseInt($h('clock').textContent.split(':')[1], 10);
const guestSecs = parseInt($g('clock').textContent.split(':')[0], 10) * 60 + parseInt($g('clock').textContent.split(':')[1], 10);
check('clocks agree within a second', Math.abs(hostSecs - guestSecs) <= 1, `host ${$h('clock').textContent} guest ${$g('clock').textContent}`);

check("follower's own controls are locked", $g('toggle-run').disabled && $g('skip').disabled, `run=${$g('toggle-run').disabled} skip=${$g('skip').disabled}`);
check("leader's controls stay usable", !$h('toggle-run').disabled);
check('follower is told it is following', !$g('sync-band').classList.contains('hide') && /Following/.test($g('sync-band').textContent), $g('sync-band').textContent);
check('leader is told it leads', /You hold the timer/.test($h('sync-band').textContent), $h('sync-band').textContent);

// leader pauses
$h('toggle-run').click();
await wait(250);
check('pause propagates to the follower', $g('toggle-run').textContent.trim() !== 'Pause', $g('toggle-run').textContent);

// a follower must never broadcast, even if its buttons are poked directly
$g('toggle-run').disabled = false;
const hostBefore = $h('toggle-run').textContent;
$g('toggle-run').click();
await wait(200);
check('follower cannot drive the leader', $h('toggle-run').textContent === hostBefore, `${hostBefore} -> ${$h('toggle-run').textContent}`);

/* **Friends are people now, not codes with a nickname typed over them.**
   Keeping somebody you met in a room saves them under the username they sent
   with their `hello`, and the row is a way into their profile. See
   src/js/29a-friends.js. */
/* `beFriends` above put the host on this list so that joining did not have to
   go through the door. Take them off again: this is the check for *keeping*
   somebody, and there is nothing to keep about a friend. */
guest.__r.SYNC.friends = [];
guest.__r.syncRender();
await wait(40);
check('somebody in the room you do not know can be kept',
  !!$g('sync-people').querySelector('[data-keep]'), $g('sync-people').textContent.slice(0, 80));
$g('sync-people').querySelector('[data-keep]').click();
await wait(60);
check('keeping somebody from the room saves them',
  JSON.parse(guest.localStorage.getItem('focus_sync')).friends.length === 1,
  guest.localStorage.getItem('focus_sync'));
check('and the row is a way into their profile',
  !!$g('sync-friends').querySelector('[data-who]'), $g('sync-friends').innerHTML.slice(0, 120));
check('with a code still on it while there is no username to show',
  $g('sync-friends').textContent.includes(hostCode), $g('sync-friends').textContent.slice(0, 80));
$g('sync-friends').querySelector('[data-who]').click();
await wait(80);
check('opening it opens the profile', !$g('prof-overlay').classList.contains('hide'),
  $g('prof-overlay').className);
check('which offers the two things you would do without looking',
  !!$g('prof-join') && !!$g('prof-msg'), $g('prof-body').textContent.slice(0, 80));
$g('prof-close').click();
await wait(40);

// --- confirms, keeping people, and noticing they've gone -------------------
// Handing the clock over and removing somebody are both hard to undo in a room
// of three, so both go through a confirm now.
$h('sync-people').querySelector('[data-lead]').click();
await wait(80);
check('giving the timer away asks first', !$h('confirm').classList.contains('hide'));
check('the confirm names the person', /Friend/.test($h('confirm-title').textContent), $h('confirm-title').textContent);
$h('confirm-no').click();
await wait(150);
check('cancelling keeps the timer where it was', /You hold the timer/.test($h('sync-band').textContent), $h('sync-band').textContent);

$h('sync-people').querySelector('[data-kick]').click();
await wait(80);
check('removing somebody asks first', !$h('confirm').classList.contains('hide') && /Remove/.test($h('confirm-title').textContent), $h('confirm-title').textContent);
$h('confirm-no').click();
await wait(150);
check('cancelling leaves them in the room', $h('sync-people').querySelectorAll('.sync-person').length === 2);

/* Anyone in the room can be kept, because `hello` carries their own code —
   the peer id most of them are using is a throwaway. `beFriends` put them on
   this list so joining did not go through the door; take them off again, or
   there is nothing here to keep. */
const hostFriendsWere = host.__r.SYNC.friends.slice();
host.__r.SYNC.friends = [];
host.__r.syncRender();
await wait(40);
const keepBtn = $h('sync-people').querySelector('[data-keep]');
check('anyone in the room can be saved as a friend', !!keepBtn, $h('sync-people').textContent);
if (keepBtn) {
  const theirCode = keepBtn.dataset.keep;
  check('they are offered by their own code, not their peer id', /^[2-9A-HJ-NP-Z]{6}$/.test(theirCode), theirCode);
  check('and it really is their code', theirCode === $g('sync-mycode').textContent, `${theirCode} vs ${$g('sync-mycode').textContent}`);
  keepBtn.click();
  await wait(120);
  check('saving from the room adds a friend', JSON.parse(host.localStorage.getItem('focus_sync')).friends.some((f) => f.code === theirCode));
  check('and they are marked as kept', /friend/.test($h('sync-people').textContent), $h('sync-people').textContent);
}

/* ---- the door ----------------------------------------------------------

   A room code is six characters and it travels: read out, forwarded, put in a
   message by somebody you gave it to. That is fine for a friend and it is the
   whole problem for a stranger, who used to arrive and simply *be* there —
   named in the roster, in the chat, watching the timer.

   So somebody the host does not know is held: connected, because there is no
   other way to ask, and nothing more. The friendship was just cleared above, so
   the third window is a stranger to this host and this is the real path. */
{
  /* A window of its own: everybody else in this file has been introduced by
     now, and the whole point of the door is somebody who has not been. */
  const { window: outsider } = boot(roomHtml, { focus_embers: ROOM_EMBERS });
  await wait(320);
  const $t2 = (id) => outsider.document.getElementById(id);
  $t2('sync-name').value = 'Stranger';
  $t2('sync-name').dispatchEvent(new outsider.Event('input'));
  $t2('d-sync').click();
  $t2('sync-code').value = hostCode;
  $t2('sync-join').click();
  /* Three windows have to agree before any of this is true: the stranger's
     socket has to open, the host has to hold them, and the note has to reach
     the guest. A fixed pause is a guess at all three at once. */
  await until(() => $h('sync-door').querySelectorAll('.ft-wait').length === 1
    && /waiting to be let in/i.test($t2('sync-state').textContent)
    && guest.__r.Chat.log.some((l) => l.sys && /waiting to be let in/.test(l.text)));

  check('somebody the host does not know is held at the door',
    $h('sync-door').querySelectorAll('.ft-wait').length === 1,
    $h('sync-door').textContent.slice(0, 80));
  check('and is named there', /Stranger/.test($h('sync-door').textContent),
    $h('sync-door').textContent.slice(0, 80));
  /* **Held means held.** Not in the roster, so nothing the room sends reaches
     them: no state, no chat, no list of who is here. */
  check('they are not in the room', !/Stranger/.test($h('sync-people').textContent),
    $h('sync-people').textContent.slice(0, 90));
  check('and they know it rather than sitting on "connecting"',
    /waiting to be let in/i.test($t2('sync-state').textContent),
    $t2('sync-state').textContent);

  /* The room is told, in the room's own voice — nobody said it, so it is drawn
     as a note rather than as something a person typed. */
  check('the room chat says somebody is waiting',
    /Stranger is waiting to be let in/.test($h('chat-log').textContent)
    || host.__r.Chat.log.some((l) => l.sys && /waiting to be let in/.test(l.text)),
    JSON.stringify(host.__r.Chat.log.slice(-2)));
  /* The host posts it and the room hears about it a hop later, so this waits
     for the guest rather than assuming it has already arrived. */
  check('and it reaches everybody already in the room, not just the host',
    await until(() => guest.__r.Chat.log.some((l) => l.sys && /waiting to be let in/.test(l.text))),
    JSON.stringify(guest.__r.Chat.log.slice(-2)));

  /* **Held means nothing reaches them.** Connected is the only way they could
     have asked; it must not also mean they can watch. */
  check('the room does not appear on their screen',
    $t2('sync-people').querySelectorAll('.sync-person').length === 0,
    $t2('sync-people').textContent.slice(0, 80));
  host.__r.Chat.thread = 'room';
  host.__r.Chat.send('said while somebody is at the door');
  await until(() => guest.__r.Chat.log.some((l) => /at the door/.test(l.text)));
  check('and what is said in the room does not reach them',
    !outsider.__r.Chat.log.some((l) => /at the door/.test(l.text)),
    JSON.stringify(outsider.__r.Chat.log.map((l) => l.text)));
  check('though it does reach everybody who is in it',
    guest.__r.Chat.log.some((l) => /at the door/.test(l.text)),
    JSON.stringify(guest.__r.Chat.log.slice(-1)));

  /* Only whoever is running the room decides. */
  check('the leader is offered the decision',
    !!$h('sync-door').querySelector('[data-letin]'));
  /* **A follower is told, and not asked.** They heard it in the chat above;
     showing them a decision they cannot take would be a worse kind of nothing
     than showing them none. */
  check('and a follower is not offered a decision they cannot take',
    !$g('sync-door').querySelector('[data-letin]')
    && $g('sync-door').classList.contains('hide'),
    $g('sync-door').className + ' ' + $g('sync-door').textContent.slice(0, 60));

  /* **Wait for the button, then press it.** The knock crosses the fake network
     a hop at a time, so on a slow run this was `null.click()` — which does not
     fail a check, it kills the suite, and every check after it goes unreported. */
  await until(() => !!$h('sync-door').querySelector('[data-letin]'));
  const letIn = $h('sync-door').querySelector('[data-letin]');
  check('the host is offered a way to let them in', !!letIn,
    $h('sync-door').textContent.slice(0, 60));
  if (letIn) letIn.click();
  await until(() => /Stranger/.test($h('sync-people').textContent)
    && $t2('sync-people').querySelectorAll('.sync-person').length >= 2);
  check('letting them in puts them in the room',
    /Stranger/.test($h('sync-people').textContent),
    $h('sync-people').textContent.slice(0, 100));
  check('the door is empty again', $h('sync-door').classList.contains('hide'),
    $h('sync-door').className);
  check('and they can see the room they are in',
    $t2('sync-people').querySelectorAll('.sync-person').length >= 2,
    `${$t2('sync-people').querySelectorAll('.sync-person').length}`);
  check('and the room is told they were let in',
    host.__r.Chat.log.some((l) => l.sys && /was let in/.test(l.text)),
    JSON.stringify(host.__r.Chat.log.slice(-2)));

  /* Put it back the way the blocks below expect it. The room log especially:
     the notes this block generated, and the line sent past the door, would
     otherwise turn up in the chat block as messages nobody sent. */
  for (const w of [host, guest]) { w.__r.Chat.log = []; w.__r.Chat.unread = 0; w.__r.Chat.render(); }
  host.__r.SYNC.friends = hostFriendsWere;
  outsider.__r.syncLeave(true);
  await wait(250);
  outsider.close();
  host.__r.syncRender();
  await wait(60);
}

// Presence is a probe, not a subscription: reach for the code and see if
// anybody answers. The guest is hosting nothing, so it should not answer.
$h('sync-check').click();
await wait(600);
check('checking who is online finishes', $h('sync-check').textContent !== 'Checking…', $h('sync-check').textContent);
check('the check reports something either way', !!$h('sync-friends').querySelector('.sync-dot'),
  $h('sync-friends').innerHTML.slice(0, 120));

// --- messages ---------------------------------------------------------------
// Chat rides the same connections as the timer. It is a sheet rather than a
// screen, so it has to work from wherever you already are.
check('the message button is there in a room', !$h('chat-btn').classList.contains('hide'));
$h('chat-btn').click();
await wait(80);
check('the sheet opens', !$h('chat').classList.contains('hide'));
check('it names who is here', /Friend/.test($h('chat-who').textContent), $h('chat-who').textContent);
check('an empty room says so rather than showing nothing',
  /Nothing said yet/.test($h('chat-log').textContent)
  || host.__r.Chat.log.every((l) => l.sys),
  $h('chat-log').textContent.slice(0, 80));

$h('chat-input').value = 'shall we do another block';
$h('chat-form').dispatchEvent(new host.Event('submit', { cancelable: true, bubbles: true }));
await wait(250);
check('your own line appears at once', /shall we do another block/.test($h('chat-log').textContent));
check('and it is marked as yours', !!$h('chat-log').querySelector('.chat-line.mine'));
check('the input clears', $h('chat-input').value === '');
// The other window isn't looking, so it gets a badge rather than a render —
// the log is only drawn while the sheet is up.
// A dot on the button, and a pop-out that says who and what. Not a count — see
// the note at the top of 33-chat.js.
check('a dot appears for whoever is not looking', !$g('chat-dot').classList.contains('hide'));
check('and no number', !$g('game-pictionary') || !/chat-badge/.test($g('chat-dot').className));
check('a pop-out announces it', !$g('chat-pop').classList.contains('hide'));
check('the pop-out names the sender', /Hashir/.test($g('chat-pop-who').textContent), $g('chat-pop-who').textContent);
check('and shows what was said', /shall we do another block/.test($g('chat-pop-text').textContent),
  $g('chat-pop-text').textContent);
check('tapping the pop-out opens that thread', (() => {
  $g('chat-pop').click();
  return !$g('chat').classList.contains('hide') && $g('chat-pop').classList.contains('hide');
})());
$g('chat-close').click();
await wait(60);

$g('chat-btn').click();
await wait(120);
check('it reaches the other window', /shall we do another block/.test($g('chat-log').textContent), $g('chat-log').textContent.slice(0, 60));
check('the other window names the sender', /Hashir/.test($g('chat-log').textContent), $g('chat-log').textContent.slice(0, 60));
check('opening clears the dot', $g('chat-dot').classList.contains('hide'));

// a quick line, for when typing is the thing you're trying to avoid
$g('chat-quick').querySelector('[data-q]').click();
await wait(250);
check('a quick reply sends', $h('chat-log').querySelectorAll('.chat-line').length === 2,
  `${$h('chat-log').querySelectorAll('.chat-line').length} lines`);
check('and lands on the other side too', $g('chat-log').querySelectorAll('.chat-line').length === 2);
check('nothing is relayed back to its sender twice',
  ($g('chat-log').textContent.match(/shall we do another block/g) || []).length === 1);

// --- direct messages --------------------------------------------------------
// The room thread belongs to the room; a direct thread belongs to a person, so
// it's keyed by their friend code and kept on disk.
{
  const tabs = ($w) => [...$w('chat-tabs').querySelectorAll('[data-thread]')].map((b) => b.dataset.thread);
  check('there is a tab per conversation', tabs($h).length === 2 && tabs($h)[0] === 'room', tabs($h).join(','));
  const theirCode = tabs($h)[1];
  check('the other tab is keyed by their own code, not their peer id',
    /^[2-9A-HJ-NP-Z]{6}$/.test(theirCode) && theirCode === $g('sync-mycode').textContent, theirCode);

  $h('chat-tabs').querySelector(`[data-thread="${theirCode}"]`).click();
  await wait(60);
  /* One sentence. It used to be a paragraph explaining how offline delivery
     works, on an otherwise empty screen, which reads as an apology. */
  check('an empty direct thread says so, briefly',
    /Nothing yet/.test($h('chat-log').textContent)
    && $h('chat-log').textContent.trim().length < 60,
    $h('chat-log').textContent.slice(0, 80));

  $h('chat-input').value = 'just between us';
  $h('chat-form').dispatchEvent(new host.Event('submit', { cancelable: true, bubbles: true }));
  await wait(250);
  check('a direct message reaches them', /just between us/.test(
    JSON.stringify(JSON.parse(guest.localStorage.getItem('focus_dm') || '{}'))), guest.localStorage.getItem('focus_dm'));
  check('it does not land in the room thread', !/just between us/.test($g('chat-log').textContent)
    || $g('chat-tabs').querySelector('.chat-tab.on').dataset.thread !== 'room');
  check('direct messages are saved, unlike the room thread',
    !!host.localStorage.getItem('focus_dm') && !host.localStorage.getItem('focus_chat'));
  $h('chat-tabs').querySelector('[data-thread="room"]').click();
  await wait(40);
  check('the room thread is unaffected', !/just between us/.test($h('chat-log').textContent));

  /* **A name in the room is a way through to that person.**
     The room tells you who said a thing; without an address on the line there
     is no way to turn that into writing back to them. */
  const named = [...$h('chat-log').querySelectorAll('[data-who]')];
  check('a name in the room is a button', named.length > 0,
    $h('chat-log').innerHTML.slice(0, 160));
  check('and it carries their code, not their name',
    named.every((b) => /^[2-9A-HJ-NP-Z]{6}$/.test(b.dataset.who)),
    named.map((b) => b.dataset.who).join(','));
  /* **The address is on the line, not worked out from the roster.** Matching a
     name against who is currently in the room answers this too, right up until
     they leave — which is exactly when you want to write to them. */
  /* The room's own notes have no author, quite rightly — nobody wrote them. */
  check('the line itself remembers who wrote it',
    host.__r.Chat.log.filter((l) => !l.mine && !l.sys).every((l) => !!l.code),
    JSON.stringify(host.__r.Chat.log.filter((l) => !l.mine && !l.sys).map((l) => l.code)));
  check('so a name still opens a thread once they have left the room',
    host.__r.Chat._codeOf({ code: 'ZZ9WQ7', name: 'somebody long gone' }) === 'ZZ9WQ7',
    host.__r.Chat._codeOf({ code: 'ZZ9WQ7', name: 'somebody long gone' }));
  check('and a name with no address behind it is left as plain text',
    host.__r.Chat._codeOf({ name: 'somebody long gone' }) === '',
    JSON.stringify(host.__r.Chat._codeOf({ name: 'somebody long gone' })));
  named[0].click();
  await wait(80);
  check('tapping it opens their own thread',
    $h('chat-tabs').querySelector('.chat-tab.on').dataset.thread === theirCode,
    $h('chat-tabs').querySelector('.chat-tab.on').dataset.thread);
  /* Your own lines are not buttons: there is nobody to open. */
  check('but your own name is not one',
    [...$h('chat-log').querySelectorAll('.chat-line.mine [data-who]')].length === 0);

  /* **Whoever spoke last sits next to the room.** The order used to be whoever
     happened to be about, then the friends list — an order with no relation to
     who you are actually talking to. */
  $h('chat-tabs').querySelector('[data-thread="room"]').click();
  await wait(40);
  /* **The stale thread is the one the old order put first.** Whoever is in the
     room heads the base list, so making *them* the ancient one is what forces
     the sort to do something: pass this and the tabs are genuinely ordered by
     recency rather than happening to look it. */
  host.__r.Chat.dm.ZZ9WQ7 = [{ id: 'x1', name: 'Newer', text: 'just now', at: 9e12 }];
  host.__r.Chat.dm[theirCode] = [{ id: 'x2', name: 'Older', text: 'ages ago', at: 1000 }];
  host.__r.Chat.render();
  await wait(60);
  const order = tabs($h);
  check('the room is still first', order[0] === 'room', order.join(','));
  check('and the newest correspondent is next to it', order[1] === 'ZZ9WQ7',
    order.join(','));
  check('with the one nobody has written in for ages below it',
    order.indexOf(theirCode) > order.indexOf('ZZ9WQ7'), order.join(','));
  // put the newer message back where the checks below expect to find it
  host.__r.Chat.dm[theirCode] = [{ id: 'x2', name: 'Older', text: 'ages ago', at: 9e12 }];
  /* An unread thread outranks a read one however old it is, because it is the
     one waiting on you. */
  host.__r.Chat.dm.ZZ9WQ7 = [{ id: 'x1', name: 'Older', text: 'ages ago', at: 1000 }];
  host.__r.Chat.dmUnread.ZZ9WQ7 = 1;
  host.__r.Chat.render();
  await wait(60);
  check('unless something is unread, which goes above everything',
    tabs($h)[1] === 'ZZ9WQ7', tabs($h).join(','));
  delete host.__r.Chat.dmUnread.ZZ9WQ7;
  delete host.__r.Chat.dm.ZZ9WQ7;
  host.__r.Chat.render();
  await wait(40);
}

// it opens over whatever you were doing, rather than replacing it
$h('arcade-open').click();
await wait(60);
check('the button is still there inside the arcade', !$h('chat-btn').classList.contains('hide'));
/* Most messages arrive during a break, which is when the arcade is what's on
   screen — so the announcement has to sit over it rather than under it. There
   is nothing to announce to somebody already reading the sheet, so close it. */
$h('chat-close').click();
await wait(60);
$g('chat-tabs').querySelector('[data-thread="room"]').click();
await wait(40);
$g('chat-input').value = 'you still there?';
$g('chat-form').dispatchEvent(new guest.Event('submit', { bubbles: true, cancelable: true }));
await wait(200);
check('a message during a break announces itself', shown(host, 'chat-pop'),
  host.getComputedStyle($h('chat-pop')).display);
check('over the arcade, not under it',
  Number(host.getComputedStyle($h('chat-pop')).zIndex)
  > Number(host.getComputedStyle($h('overlay')).zIndex),
  `${host.getComputedStyle($h('chat-pop')).zIndex} / ${host.getComputedStyle($h('overlay')).zIndex}`);
check('and says what it was', /still there/.test($h('chat-pop-text').textContent),
  $h('chat-pop-text').textContent);
check('the button carries a dot until you look', shown(host, 'chat-dot'));
$h('chat-btn').click();
await wait(60);
check('the sheet opens over the arcade', !$h('chat').classList.contains('hide')
  && !$h('overlay').classList.contains('hide'));
$h('chat-close').click();
$h('ov-back').click();
await wait(60);
$g('chat-close').click();
await wait(40);

// --- around, versus having a room open ---------------------------------------
// Two different questions, so two different addresses. Before this a friend
// sitting in the app with no room looked exactly like a friend who'd gone to bed.
$h('sync-check').click();
await wait(700);
{
  const row = $h('sync-friends').querySelector('.sync-friend');
  check('a friend with the app open shows as around', !!row.querySelector('.sync-dot.on'), row.innerHTML.slice(0, 140));
  check('but not as having a room open', !/room open/.test(row.textContent), row.textContent);
  check('the room they are actually in is not confused for their own', !$g('sync-state').textContent.includes('Hosting'));
}

// --- quotes on loan ---------------------------------------------------------
// Opting in pools your bank with the room for the session. Nothing of theirs is
// saved to your device — they're on loan.
{
  $g('d-quotes').click();
  await wait(60);
  $g('q-text').value = 'Slow is smooth, smooth is fast.';
  $g('q-author').value = 'Somebody';
  $g('q-save').click();
  await wait(60);
  check('the guest has a quote of their own', /Slow is smooth/.test($g('q-list').textContent));
  check('sharing is off to begin with', $g('q-share').checked === false);
  check('nothing is on loan yet', $h('q-lent').textContent.trim() === '');

  $g('q-share').checked = true;
  $g('q-share').dispatchEvent(new guest.Event('change'));
  await wait(300);
  $h('d-quotes').click();
  await wait(60);
  check('their quote reaches the room', /Slow is smooth/.test($h('q-lent').textContent), $h('q-lent').textContent.slice(0, 60));
  check('it is attributed to them', /via Friend/.test($h('q-lent').textContent), $h('q-lent').textContent.slice(0, 80));
  check('a borrowed quote is not saved as yours',
    !/Slow is smooth/.test(host.localStorage.getItem('focus_quotes') || ''));
  check('the preference is remembered', guest.localStorage.getItem('focus_quotes_share') === '1');
  $h('q-back').click(); $g('q-back').click();
  await wait(40);
}

// A window that vanishes without closing its connection has to be noticed, or
// the room slowly fills with people who left.
{
  // Both windows now react to a drop — one notices and one retries — so a
  // single reading at the end would race them. Watch the whole window instead.
  const watch = (w, $w, id) => {
    const seen = [];
    const mo = new w.MutationObserver(() => seen.push($w(id).textContent));
    mo.observe($w(id), { childList: true, characterData: true, subtree: true });
    return seen;
  };
  const hostSaid = watch(host, $h, 'sync-status');
  const guestSaid = watch(guest, $g, 'sync-status');

  const beforeN = $h('sync-people').querySelectorAll('.sync-person').length;
  guest.__peerSilent = true;                 // stop answering, but don't close
  await wait(8600);
  check('a silent member is dropped from the room',
    hostSaid.some((t) => /dropped out/.test(t)), hostSaid.join(' | ').slice(0, 90));
  check('the room noticed who it was',
    hostSaid.some((t) => /Friend dropped out/.test(t)), hostSaid.join(' | ').slice(0, 90));

  // The one that vanished doesn't give up: a lost connection schedules a rejoin
  // rather than ending the room for whoever it happened to.
  check('the one who dropped tries to get back',
    guestSaid.some((t) => /trying again|Reconnecting/i.test(t)), guestSaid.join(' | ').slice(0, 90));

  guest.__peerSilent = false;
  // Poll rather than sleep a fixed span: the backoff has grown by now, so the
  // wait is up to the next retry, not a number we can guess.
  for (let i = 0; i < 60; i++) {
    if ($h('sync-people').querySelectorAll('.sync-person').length === beforeN) break;
    await wait(250);
  }
  check('and gets back in on its own', $g('sync-state').textContent.includes(hostCode),
    `${$g('sync-state').textContent} / ${$g('sync-status').textContent}`);
  check('the room is whole again', $h('sync-people').querySelectorAll('.sync-person').length === beforeN,
    `${$h('sync-people').querySelectorAll('.sync-person').length} of ${beforeN}`);
  check('and is told it made it back', guestSaid.some((t) => /Back in the room/.test(t)),
    guestSaid.slice(-3).join(' | '));
}

/* ---- The leader is where the room is ----------------------------------------

   A follower never runs the timer engine: the only thing that moves it between
   the main menu and the clock is the leader's state message. So both directions
   are checked, and the second one is the report - a room that follows the
   leader into a session but not back out of it leaves everybody sitting on a
   clock that nobody is running, which is worse than not following at all.

   Checked here rather than in the block above because it needs the room whole
   and the guest already reconnected, so what is being read is the ordinary
   path and not something the retry happened to fix. */
{
  $h('begin').click();
  await until(() => $g('app').dataset.phase === 'focus');
  check('the leader starting a session takes the room into it',
    !$g('timer').classList.contains('hide') && $g('app').dataset.phase === 'focus',
    `phase ${$g('app').dataset.phase}`);

  $h('stop').click();
  await until(() => !$g('setup').classList.contains('hide'));
  check('and the leader going back to the main menu brings everyone back',
    !$g('setup').classList.contains('hide') && $g('timer').classList.contains('hide'),
    `setup ${$g('setup').className} · timer ${$g('timer').className}`);
  check('with nothing still counting down on their side',
    $g('app').dataset.phase === '', `phase ${$g('app').dataset.phase}`);
}

/* ---- Leave has to mean left ------------------------------------------------

   `syncLeave` set `mode = 'off'` *after* closing every connection, and closing
   one can fire its `close` handler there and then rather than on a later tick.
   The handler read `SYNC.mode`, found 'joined', concluded the host had gone,
   and called `syncRetry` — so pressing Leave dropped you out of the room and
   dialled straight back in. From the outside the button did nothing at all.

   The guest goes first, on its own initiative, because that is the case that
   was broken: a host leaving takes the room with it and would look fine either
   way. And it is checked twice — immediately, and again after longer than one
   heartbeat and the first retry backoff, because the bug rejoined within about
   six hundred milliseconds and a check that only looked once would have passed
   against it. */
{
  await leaveRoom($g);
  await wait(300);
  check('a guest leaving actually leaves', $g('sync-state').textContent === 'Not connected',
    $g('sync-state').textContent);
  await wait(1500);
  check('and has not quietly rejoined a moment later',
    $g('sync-state').textContent === 'Not connected'
    && !/trying again/i.test($g('sync-status').textContent),
    `${$g('sync-state').textContent} / ${$g('sync-status').textContent}`);
  check('and the room stops counting them',
    !$h('sync-people').textContent.includes('Friend'),
    $h('sync-people').textContent.slice(0, 80));
}

// leaving tears the room down on both sides
await leaveRoom($h);
await wait(250);
check('host returns to disconnected', $h('sync-state').textContent === 'Not connected', $h('sync-state').textContent);
check('controls unlock after leaving', !$g('toggle-run').disabled);
check('band hidden once alone', $h('sync-band').classList.contains('hide'));

// one-off room codes are not the saved friend code
$h('sync-room').click();
await wait(150);
check('one-off room uses a different code', $h('sync-state').textContent.includes('Hosting') && !$h('sync-state').textContent.includes(hostCode), $h('sync-state').textContent);
check('one-off room does not overwrite your code', $h('sync-mycode').textContent === hostCode);
await leaveRoom($h);
await wait(100);

/* --- a friend request, both halves of it ------------------------------------

   **A code is a hash of a username**, so finding somebody is typing their name
   — there is no directory and no lookup. What the request adds is consent and
   a card: they agree to be on a list, and the exchange is what carries the
   numbers a profile shows.

   It travels as a message, down the path messages already use, and is lifted
   out before it reaches any conversation. That is why there is no new endpoint
   and nothing to deploy. See src/js/29a-friends.js. */
{
  const hostUser = 'hashir';
  const guestUser = 'noor';
  /* **Put everything back afterwards.** Signing in moves a device onto its
     account's code, and the blocks below are keyed to the codes these two had
     before — threads, the outbox, saved friends. Left changed, they fail for a
     reason that has nothing to do with them. */
  const was = [host, guest].map((w) => ({
    w, code: w.__r.SYNC.myCode, acct: w.__r.SYNC.accountCode,
    friends: w.__r.SYNC.friends.slice(),
    out: JSON.parse(JSON.stringify(w.__r.Chat.out || {})),
  }));
  /* Both signed in, so both have a username to be found by — and the code each
     device answers to becomes the account's, which is what makes a username an
     address. See `syncAdoptAccount` in 29-sync.js. */
  for (const [w, who] of [[host, hostUser], [guest, guestUser]]) {
    w.__r.Account.token = 't'; w.__r.Account.username = who;
    w.__r.syncAdoptAccount(who);
  }
  await wait(120);
  /* Neither is in a room, which is the case that matters: a request has to
     survive the other person being closed. Anything the peers cannot hand over
     waits in the outbox, exactly as a message does. */
  const clean = (w, code) => { w.__r.SYNC.friends = w.__r.SYNC.friends.filter((f) => f.code !== code); };
  clean(host, guest.__r.SYNC.myCode);
  clean(guest, host.__r.SYNC.myCode);

  // The guest asks for the host by name.
  $g('ft-user').value = hostUser;
  $g('ft-ask').click();
  await wait(150);
  const asked = JSON.parse(guest.localStorage.getItem('focus_sync')).friends
    .find((f) => f.u === hostUser);
  check('asking by username files them under that name', !!asked, guest.localStorage.getItem('focus_sync'));
  check('and at the address the name hashes to',
    !!asked && asked.code === guest.__r.syncCodeFor(hostUser),
    `${asked && asked.code} vs ${guest.__r.syncCodeFor(hostUser)}`);
  check('shown as asked until they answer',
    /asked/i.test($g('sync-friends').textContent), $g('sync-friends').textContent.slice(0, 80));

  /* The host receives it. Delivery is the mail path and needs both apps
     reachable, so this hands the item over directly — what is under test is
     what happens to it, not the transport, which has its own checks. */
  const item = (() => {
    const f = guest.__r.SYNC.friends.find((x) => x.u === hostUser);
    const q = (f && guest.__r.Chat.pending(f.code)) || [];
    return q.length ? { text: q[q.length - 1].text, fromCode: guest.__r.SYNC.myCode } : null;
  })();
  /* The marker is U+0001 — a character nobody can type, so a real message can
     never be mistaken for machinery and vanish out of a conversation. */
  check('the request is queued as machinery, not as a message',
    !!item && item.text.indexOf('\u0001fr:ask:') === 0,
    item ? JSON.stringify(item.text.slice(0, 40)) : 'nothing queued');
  host.__r.friendTake(item);
  await wait(120);
  check('it lands as a request rather than in a conversation',
    /wants to be friends/i.test($h('ft-asks').textContent)
    && !/fr:ask/.test($h('chat-log').textContent)
    && !/fr:ask/.test(JSON.stringify(host.localStorage.getItem('focus_dm'))),
    $h('ft-asks').textContent.slice(0, 60));
  check('and names who is asking', /noor/.test($h('ft-asks').textContent),
    $h('ft-asks').textContent.slice(0, 60));

  // The host accepts; the reply carries their card back.
  $h('ft-asks').querySelector('[data-yes]').click();
  await wait(150);
  check('accepting makes them a friend on this side',
    /noor/.test($h('sync-friends').textContent), $h('sync-friends').textContent.slice(0, 80));
  const back = (() => {
    const f = host.__r.SYNC.friends.find((x) => x.u === guestUser);
    const q = (f && host.__r.Chat.pending(f.code)) || [];
    return q.length ? { text: q[q.length - 1].text, fromCode: host.__r.SYNC.myCode } : null;
  })();
  check('and sends an answer back', !!back && back.text.indexOf('\u0001fr:yes:') === 0,
    back ? JSON.stringify(back.text.slice(0, 40)) : 'nothing queued');
  guest.__r.friendTake(back);
  await wait(120);
  const now = JSON.parse(guest.localStorage.getItem('focus_sync')).friends
    .find((f) => f.u === hostUser);
  check('which settles it on the asking side too', !!now && now.ok === 1, JSON.stringify(now));

  /* **The card is what a profile is.** There is no server here that knows what
     anybody did, so the numbers arrive with the answer and the page says how
     old they are rather than pretending to be live. */
  check('and brings their numbers with it',
    !!now && now.card && typeof now.card.hrs === 'number' && !!now.card.g,
    JSON.stringify(now && now.card));
  $g('sync-friends').querySelector('[data-who]').click();
  await wait(120);
  check('so the profile has something to show',
    /focused/i.test($g('prof-body').textContent) && /sudoku/i.test($g('prof-body').textContent),
    $g('prof-body').textContent.slice(0, 100));
  check('and says how fresh it is', /as of/i.test($g('prof-body').textContent),
    $g('prof-body').textContent.slice(0, 60));
  $g('prof-close').click();
  await wait(60);

  /* **A friendship is one thing, so removing it removes it for both.**

     It used to be one-sided: you took somebody off your list and stayed on
     theirs, still shown as a friend, still able to walk into your room without
     knocking. That is not a friends list, it is two lists that happen to agree
     most of the time. */
  const hostSideCode = host.__r.SYNC.myCode;
  check('both sides think they are friends to begin with',
    !!host.__r.friendFind(guest.__r.SYNC.myCode)
    && !!guest.__r.friendFind(hostSideCode),
    `${!!host.__r.friendFind(guest.__r.SYNC.myCode)} / ${!!guest.__r.friendFind(hostSideCode)}`);
  const guestSideCode = guest.__r.SYNC.myCode;
  host.__r.friendRemove(guestSideCode);
  await wait(200);
  check('removing them takes them off your list',
    !host.__r.friendFind(guestSideCode));
  /* It goes the way every friend message goes: over the peer if they are
     reachable, into the mailbox if not. Neither window is connected here, so
     it is queued — delivered by hand, exactly as the request and the answer
     above were. */
  const bye = (host.__r.Chat.pending(guestSideCode) || [])
    .find((m) => m.text.indexOf('\u0001fr:bye') === 0);
  check('and sends them word of it', !!bye,
    JSON.stringify((host.__r.Chat.pending(guestSideCode) || []).map((m) => m.text.slice(0, 12))));
  guest.__r.friendTake({ text: bye.text, fromCode: hostSideCode });
  await wait(150);
  check('which takes you off their list too', !guest.__r.friendFind(hostSideCode),
    JSON.stringify(guest.__r.SYNC.friends.map((f) => f.code)));
  /* **And it does not bounce back.** The far side removes quietly; two apps
     politely un-friending each other forever is not a conversation. */
  check('without the far side sending one back',
    !(guest.__r.Chat.pending(hostSideCode) || [])
      .some((m) => m.text.indexOf('\u0001fr:bye') === 0),
    JSON.stringify((guest.__r.Chat.pending(hostSideCode) || []).map((m) => m.text.slice(0, 12))));

  // put the two back the way the blocks below expect them
  for (const w of [host, guest]) { w.__r.Account.token = ''; w.__r.Account.username = ''; }
  for (const s0 of was) {
    s0.w.__r.SYNC.myCode = s0.code;
    s0.w.__r.SYNC.accountCode = s0.acct;
    s0.w.__r.SYNC.friends = s0.friends;
    s0.w.__r.SYNC.asks = {};
    s0.w.__r.Chat.out = s0.out;
    s0.w.__r.Chat.saveOut();
    /* **Put the page back too, not just the object.** `#sync-mycode` is written
       by syncRender, so a window whose code was restored behind the page's back
       still shows the account code — and the block below reads its address off
       the page. */
    s0.w.__r.syncRender();
  }
  await wait(80);
}

// --- messages that wait ------------------------------------------------------
// There is no server, so a message to somebody who isn't in your room goes into
// an outbox and is posted into their presence beacon the first moment both apps
// are open. Written here, delivered when they're reachable.
{
  // save each other, so both have a friend to write to
  const hostCodeNow = $h('sync-mycode').textContent;
  const guestCodeNow = $g('sync-mycode').textContent;
  $g('sync-code').value = hostCodeNow;
  $g('sync-add-legacy').click();
  await wait(80);

  // leave, so neither is in a room — this is the whole point
  await leaveRoom($h);
  await wait(300);
  check('nobody is in a room', !syncOnH() && !syncOnG(), 'still connected');

  // the guest writes to the host anyway
  $g('chat-btn').click();
  await wait(80);
  check('you can open messages with no room open', !$g('chat').classList.contains('hide'));
  const tab = $g('chat-tabs').querySelector(`[data-thread="${hostCodeNow}"]`);
  check('a saved friend has a thread even when away', !!tab, $g('chat-tabs').textContent);
  tab.click();
  await wait(60);
  check('and you can type to them', $g('chat-input').disabled === false);

  // A friend who isn't running the app at all: nothing answers, so it waits.
  $g('sync-code').value = 'ZZ9WQ7';
  $g('sync-add-legacy').click();
  await wait(80);
  $g('chat-tabs').querySelector('[data-thread="ZZ9WQ7"]').click();
  await wait(60);
  $g('chat-input').value = 'nobody is listening';
  $g('chat-form').dispatchEvent(new guest.Event('submit', { cancelable: true, bubbles: true }));
  await wait(900);
  check('a message to somebody unreachable waits', !!$g('chat-log').querySelector('.chat-line.waiting'),
    $g('chat-log').textContent.slice(0, 60));
  check('and it is queued on disk', /nobody is listening/.test(
    guest.localStorage.getItem('focus_dm_out') || ''), guest.localStorage.getItem('focus_dm_out'));

  // Now one to the host, who does have the app open — it should get through even
  // though neither of them is in a room. Re-query the tab: adding a friend
  // re-rendered the row, so the element captured earlier is detached.
  $g('chat-tabs').querySelector(`[data-thread="${hostCodeNow}"]`).click();
  await wait(60);
  $g('chat-input').value = 'read this when you wake up';
  $g('chat-form').dispatchEvent(new guest.Event('submit', { cancelable: true, bubbles: true }));
  await wait(900);
  check('it reaches a friend who is reachable but not in a room', /read this when you wake up/.test(
    host.localStorage.getItem('focus_dm') || ''), host.localStorage.getItem('focus_dm'));
  check('the outbox clears once acknowledged',
    !/read this when you wake up/.test(guest.localStorage.getItem('focus_dm_out') || ''),
    guest.localStorage.getItem('focus_dm_out'));
  check('the undeliverable one is still queued', /nobody is listening/.test(
    guest.localStorage.getItem('focus_dm_out') || ''));
  check('and the delivered one is unread for them', !$h('chat-btn').classList.contains('hide')
    && !$h('chat-dot').classList.contains('hide'));
  check('with a pop-out saying who it was from', /Friend/.test($h('chat-pop-who').textContent),
    $h('chat-pop-who').textContent);

  // nothing is delivered twice
  const before = (host.localStorage.getItem('focus_dm').match(/read this when you wake up/g) || []).length;
  $g('chat-input').value = 'second';
  $g('chat-form').dispatchEvent(new guest.Event('submit', { cancelable: true, bubbles: true }));
  await wait(900);
  check('a second message also arrives', /second/.test(host.localStorage.getItem('focus_dm')));
  check('the first is not duplicated',
    (host.localStorage.getItem('focus_dm').match(/read this when you wake up/g) || []).length === before,
    `${(host.localStorage.getItem('focus_dm').match(/read this when you wake up/g) || []).length}`);

  /* ---- and with a mailbox, even that overlap isn't needed ----
     Peer delivery covers "both open at once". The server covers the rest: the
     recipient closed, or simply unreachable. Wire one up and the message that
     could not be handed over should go through it instead. */
  FAKE_MAIL.reset();
  /* The mailbox address is a build constant, not a setting — see SYNC_MAILBOX in
     29-sync.js. This build leaves it empty, which is the shipped default, so what
     is checkable here is that the app is honest about it: a token exists ready
     for the day one is configured, and nothing is posted anywhere without one. */
  check('no server is configured by default', FAKE_MAIL.sends === 0 && FAKE_MAIL.fetches === 0,
    `${FAKE_MAIL.sends}/${FAKE_MAIL.fetches}`);
  check('and there is no setting for it to confuse anyone', !$h('sync-server'));
  check('a device token was generated', (JSON.parse(host.localStorage.getItem('focus_sync')).token || '').length >= 20,
    JSON.parse(host.localStorage.getItem('focus_sync')).token);
  check('and it is not the friend code', JSON.parse(host.localStorage.getItem('focus_sync')).token
    !== JSON.parse(host.localStorage.getItem('focus_sync')).myCode);

  // the undelivered one stays put, because there is nowhere else for it to go
  await wait(400);
  check('with no server, undelivered mail stays queued', /nobody is listening/.test(
    guest.localStorage.getItem('focus_dm_out') || ''), guest.localStorage.getItem('focus_dm_out'));
  check('and nothing was posted anywhere', FAKE_MAIL.sends === 0, `${FAKE_MAIL.sends}`);

  // Leaving is its own row on the Focus together screen now, and it asks first.

  $h('sync-close').click();
  await wait(40);
  $h('sync-host').click();
  await wait(200);
  $g('sync-code').value = $h('sync-mycode').textContent;
  $g('sync-join').click();
  await wait(400);
  $g('d-sync').click();
  await wait(80);
  check('Leave has its own row while you are in a room', !$g('sync-leave').classList.contains('hide'));
  check('and it says what leaving does', /Stop following|Stop sharing/.test($g('sync-leave-sub').textContent),
    $g('sync-leave-sub').textContent);
  $g('sync-leave').click();
  await wait(60);
  check('leaving asks first', !$g('confirm').classList.contains('hide'), $g('confirm-title').textContent);
  $g('confirm-no').click();
  await wait(120);
  check('cancelling keeps you in', syncOnG(), $g('sync-state').textContent);
  $g('sync-leave').click();
  await wait(60);
  $g('confirm-yes').click();
  await wait(300);
  check('confirming actually leaves', !syncOnG(), $g('sync-state').textContent);
  check('and the row goes with it', $g('sync-leave').classList.contains('hide'));
  check('the host sees them gone', $h('sync-people').querySelectorAll('.sync-person').length === 1,
    `${$h('sync-people').querySelectorAll('.sync-person').length}`);
  $g('sync-close').click();
  await wait(40);

  $g('chat-close').click();
  await wait(40);
  // put a room back for the blocks below
  $h('sync-close').click();
  await wait(40);
  $h('sync-host').click();
  await wait(200);
  $g('sync-code').value = $h('sync-mycode').textContent;
  $g('sync-join').click();
  await wait(400);
  check('back in a room for what follows', syncOnH() && syncOnG(),
    `${$h('sync-state').textContent} / ${$g('sync-state').textContent}`);
  void guestCodeNow;
}

/* A reconnection, and the socket it replaced closing afterwards.
   This is the ghost: wifi walks away without closing anything, the guest dials
   back in on a second connection, and some seconds later the *first* one finally
   reports itself closed. Its handler used to delete that peer's roster line,
   code and heartbeat by id — taking the live connection's entries with it — so
   the guest was connected, absent from the host's list, and skipped by every
   broadcast because SYNC.conns no longer held them.

   Closed on the host's side alone (`_peerConn._emit`), because that is what
   actually happens: the guest's new socket is fine and knows nothing about it.

   **Last in the sync pass, deliberately.** The second connection is made by the
   test, so only the host's end of it is wired and anything sent to the guest
   down it goes nowhere. Run earlier, this cost the chat checks about two runs in
   five — a pop-out that never arrived. Everything after this point builds its
   own room, so leaving this one bruised costs nothing. */
{
  const roomCode = $h('sync-mycode').textContent;      // the room as it is *now*
  const hostPeerId = 'fsim-' + roomCode.toLowerCase();
  /* Ask the host who the guest *is* rather than searching the fake network for
     somebody holding a line to it. A peer keeps every connection it ever made in
     `_conns`, including from before it was destroyed and replaced, so searching
     turned up a peer that had been dead for two blocks — and dialling from it
     put a third person in a room of two. The roster row carries the live id. */
  const guestId = ($h('sync-people').querySelector('[data-kick]') || {})
    .getAttribute ? $h('sync-people').querySelector('[data-kick]').getAttribute('data-kick') : '';
  const guestPeer = FAKE_NET[guestId];
  // the newest of that peer's lines to the room is the one in use
  const first = guestPeer
    && guestPeer._conns.filter((c) => c.peer === hostPeerId).pop();
  check('the guest is on the fake network with a line to the room', !!first);
  if (guestPeer) guestPeer.connect(hostPeerId);        // the rejoin, on a new socket
  await wait(150);
  /* Counted as rows, not by name: the rejoin carries no `hello`, so the roster
     keeps whatever name it had. The claim is that they are still there. */
  check('a rejoin does not put the same person in the room twice',
    $h('sync-people').querySelectorAll('.sync-person').length === 2,
    $h('sync-people').textContent.slice(0, 80));
  if (first && first._peerConn) first._peerConn._emit('close');
  await wait(150);
  check('and the old socket closing afterwards does not remove them',
    $h('sync-people').querySelectorAll('.sync-person').length === 2,
    $h('sync-people').textContent.slice(0, 80));
}

// --- shared games ----------------------------------------------------------
// Both games run host-authoritative over the same channel, so what's really
// under test is that intents travel in, state travels out, and neither window
// can see what it shouldn't.
for (const [w, $w, nm] of [[host, $h, 'Hashir'], [guest, $g, 'Friend']]) {
  $w('sync-name').value = nm;
  $w('sync-name').dispatchEvent(new w.Event('input'));
}
$h('sync-host').click();
await wait(150);
const gameCode = $h('sync-mycode').textContent;
$g('sync-code').value = gameCode;
$g('sync-join').click();
await wait(400);
$h('sync-close').click();
$g('sync-close').click();

// hangman ---------------------------------------------------------------
await openGame(host, $h, 'hangman');
await openGame(guest, $g, 'hangman');
check('hangman opens once there is a room', shown(host, 'hm-live') && !shown(host, 'hm-need'));
check('a fresh round is open to anyone', shown(host, 'hm-claim') && shown(guest, 'hm-claim'), `${$h('hm-role').textContent}`);
check('nobody is setting until somebody claims', !shown(host, 'hm-set') && !shown(guest, 'hm-set'));

// first claim wins; everything after it is a no-op
$g('hm-take').click();
/* The claim goes to the host and the new round comes back, so this waits for
   the answer rather than for a number of milliseconds. */
await until(() => shown(guest, 'hm-set'));
check('claiming makes you the setter', shown(guest, 'hm-set'), $g('hm-role').textContent);
check('a claim closes the round to everyone else', !shown(host, 'hm-set') && !shown(host, 'hm-claim'), $h('hm-role').textContent);
$h('hm-take').click();
await wait(200);
check('a late claim is refused by the host, not just hidden', !shown(host, 'hm-set') && shown(guest, 'hm-set'), $h('hm-role').textContent);

// from here the guest is the setter, so the roles below are the other way round
const setter = { w: guest, $: $g }, finder = { w: host, $: $h };
setter.$('hm-word-in').value = 'puzzle';
setter.$('hm-hint-in').value = 'what this is';
setter.$('hm-go').click();
await wait(250);
check('the word reaches the finder as blanks', finder.$('hm-word').querySelectorAll('.hm-let').length === 6, `${finder.$('hm-word').querySelectorAll('.hm-let').length}`);
check('the answer never leaves the setter', !/puzzle/i.test(finder.$('hm-live').textContent), finder.$('hm-live').textContent.slice(0, 80));
check('the hint does travel', /what this is/.test(finder.$('hm-hint').textContent), finder.$('hm-hint').textContent);

const hmKey = ($w, ch) => $w('hm-keys').querySelector(`[data-k="${ch}"]`);
check('the setter cannot guess', hmKey(setter.$, 'p').disabled);

hmKey(finder.$, 'p').click();
await wait(200);
check('a correct letter is revealed to everyone', finder.$('hm-word').textContent.includes('p') && setter.$('hm-word').textContent.includes('p'), setter.$('hm-word').textContent);
const hmPts = ($w) => +[...$w('hm-scores').querySelectorAll('.hm-score')]
  .find((r) => r.textContent.includes('(you)')).querySelector('b').textContent;
check('a correct letter scores', hmPts(finder.$) === 1, finder.$('hm-scores').textContent);

hmKey(finder.$, 'x').click();
await wait(200);
check('a wrong letter costs a life', /7 of 8/.test(finder.$('hm-lives').textContent), finder.$('hm-lives').textContent);
check('a wrong letter draws a limb', finder.$('hm-draw').querySelectorAll('.hm-p.on').length === 1, `${finder.$('hm-draw').querySelectorAll('.hm-p.on').length}`);
check('lives are shared, not per player', /7 of 8/.test(setter.$('hm-lives').textContent), setter.$('hm-lives').textContent);
check('a spent letter cannot be spent twice', hmKey(finder.$, 'x').disabled && hmKey(finder.$, 'p').disabled);

for (const ch of ['u', 'z', 'l', 'e']) { hmKey(finder.$, ch).click(); await wait(90); }
await wait(200);
check('finding the word ends the round', /Found it/.test(finder.$('hm-msg').textContent), finder.$('hm-msg').textContent);
check('the answer is shown once it is over', /puzzle/i.test(finder.$('hm-msg').textContent), finder.$('hm-msg').textContent);
check('both windows agree the round is over', shown(host, 'hm-next') && shown(guest, 'hm-next'));

finder.$('hm-next').click();
await wait(250);
check('the new round is round two', /Round 2/.test($h('hm-meta').textContent), $h('hm-meta').textContent);
check('the round is thrown open again', shown(finder.w, 'hm-claim'), finder.$('hm-role').textContent);
check('you cannot set two rounds running', !shown(setter.w, 'hm-claim'), setter.$('hm-role').textContent);

// and the block is enforced by the host, not just hidden in the UI
setter.$('hm-take').click();
await wait(200);
check('a blocked claim is refused, not just hidden', !shown(setter.w, 'hm-set'), setter.$('hm-role').textContent);
finder.$('hm-take').click();
await wait(200);
check('the other player can claim it', shown(finder.w, 'hm-set'), finder.$('hm-role').textContent);

// --- hangman: phrases, the cap, and losing a point ------------------------
// The setter this round is `finder`; the guesser is `setter`. Naming is by
// round, not by person, and the round just turned over.
{
  const set = finder, guess = setter;
  const pts = ($w) => +[...$w('hm-scores').querySelectorAll('.hm-score')]
    .find((r) => r.textContent.includes('(you)')).querySelector('b').textContent;

  set.$('hm-word-in').value = 'ice cream';
  set.$('hm-go').click();
  await wait(250);
  const cells = [...guess.$('hm-word').querySelectorAll('.hm-let')];
  check('a phrase keeps its space', cells.length === 9 && cells[3].classList.contains('gap'),
    `${cells.length} cells, 4th is ${cells[3] && cells[3].className}`);
  check('the space is shown, not guessed', guess.$('hm-word').textContent.trim() === '');
  check('a long answer shrinks rather than wrapping', guess.$('hm-word').dataset.len === 'mid',
    guess.$('hm-word').dataset.len);

  const before = pts(guess.$);
  guess.$('hm-keys').querySelector('[data-k="z"]').click();
  await wait(200);
  check('a wrong letter costs a point', pts(guess.$) === Math.max(0, before - 1), `${before} -> ${pts(guess.$)}`);

  // ...but a score never goes below zero. Keep guessing wrong until it would.
  for (const ch of ['q', 'j', 'x', 'v']) { guess.$('hm-keys').querySelector(`[data-k="${ch}"]`).click(); await wait(70); }
  check('a score never goes negative', pts(guess.$) === 0, `${pts(guess.$)}`);

  // start over so the next block isn't mid-round
  set.$('hm-word-in').value = '';
}

// The cap is fifteen characters, and the host enforces it rather than trusting
// the input's maxlength.
{
  check('the word box caps at fifteen', $h('hm-word-in').maxLength === 15, `${$h('hm-word-in').maxLength}`);
}

// pictionary ------------------------------------------------------------
// The word goes to one person and the ink travels outside the state; both are
// worth checking, because both are easy to get wrong in a way nothing else sees.
await openGame(host, $h, 'pictionary');
await openGame(guest, $g, 'pictionary');
{
  check('pictionary opens in a room', shown(host, 'pic-live') && !shown(host, 'pic-need'));
  check('nobody is drawing yet', shown(host, 'pic-claim') && shown(guest, 'pic-claim'));
  check('and there is no word on show', !shown(host, 'pic-word') && !shown(guest, 'pic-word'));

  $g('pic-take').click();
  const artist = { w: guest, $: $g }, watcher = { w: host, $: $h };
  await until(() => artist.$('pic-offers').querySelectorAll('[data-k]').length === 3);

  // claiming now offers three words rather than dealing one, and the clock waits
  check('claiming offers a choice of three', shown(artist.w, 'pic-choose')
    && artist.$('pic-offers').querySelectorAll('[data-k]').length === 3,
    `${artist.$('pic-offers').querySelectorAll('[data-k]').length}`);
  check('the offer is the artist\'s alone', !shown(watcher.w, 'pic-choose'));
  check('harder words advertise a bonus', /\+\d/.test(artist.$('pic-offers').textContent),
    artist.$('pic-offers').textContent);
  check('the clock has not started', artist.$('pic-clock').textContent === '',
    artist.$('pic-clock').textContent);
  check('the other player is told what is happening', /choosing/i.test(watcher.$('pic-over').textContent),
    watcher.$('pic-over').textContent);

  // take the hard one, so the bonus is in play
  artist.$('pic-offers').querySelectorAll('[data-k]')[2].click();
  await wait(250);
  check('picking a word starts the round', shown(artist.w, 'pic-word'), artist.$('pic-role').textContent);
  check('the difficulty is named to everyone', /Hard/.test(watcher.$('pic-role').textContent),
    watcher.$('pic-role').textContent);
  check('the tools appear for the artist only',
    shown(artist.w, 'pic-tools') && !shown(watcher.w, 'pic-tools'));
  check('the watcher gets a guess box instead',
    shown(watcher.w, 'pic-form') && !shown(artist.w, 'pic-form'));

  // the word sits in a text node after the <small> caption, which now carries
  // the difficulty too — so take the node, not the whole textContent
  const word = [...artist.$('pic-word').childNodes]
    .filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim().toLowerCase();
  check('the artist is given a real word', /^[a-z]+( [a-z]+)*$/.test(word), word);
  check('the word never reaches anyone else', !new RegExp(word, 'i').test(watcher.$('pic-live').textContent),
    watcher.$('pic-live').textContent.slice(0, 80));
  /* Clues can be more than one word now, so what the guessers are told is the
     shape of it — "3 words — 4 and 3 and 6 letters" — rather than one number,
     which for "hot air balloon" was both wrong and useless. */
  const parts = word.split(' ');
  check('but its shape does', parts.length > 1
    ? new RegExp(parts.length + ' words').test(watcher.$('pic-msg').textContent)
      && new RegExp(parts.map((p) => p.length).join(' and ')).test(watcher.$('pic-msg').textContent)
    : new RegExp(word.length + ' letters').test(watcher.$('pic-msg').textContent),
    `${word} → ${watcher.$('pic-msg').textContent}`);
  /* ---- the blanks ----
     The word as slots, filled in from your *own* guesses. Per guesser on
     purpose: a shared board would mean the fastest reader hands the answer to
     the room by typing, and sitting silent would be the winning move. */
  const maskOf = (p) => p.$('pic-mask').textContent.replace(/\s+/g, '');
  check('the guesser sees the word as blanks',
    shown(watcher.w, 'pic-mask') && maskOf(watcher).length === word.replace(/ /g, '').length
    && /^_+$/.test(maskOf(watcher)),
    `${word} → ${maskOf(watcher)}`);
  check('and the artist is not shown blanks for a word they chose',
    !shown(artist.w, 'pic-mask'));

  /* A wrong guess that shares letters with the answer is worth something now.
     Feed it a word made only of letters that are in the answer. */
  const inWord = [...new Set(word.replace(/ /g, '').split(''))].slice(0, 2).join('');
  watcher.$('pic-input').value = inWord;
  watcher.$('pic-form').dispatchEvent(new watcher.w.Event('submit', { bubbles: true, cancelable: true }));
  await wait(280);
  check('a wrong guess still turns up the letters it got right',
    inWord.split('').every((ch) => maskOf(watcher).indexOf(ch) >= 0),
    `${inWord} → ${maskOf(watcher)}`);
  check('and the rest of the word stays hidden',
    maskOf(watcher).indexOf('_') >= 0, maskOf(watcher));
  /* The letters must not leak sideways. The artist has the word anyway, so the
     one that matters is that the *state* carries no other player's letters —
     checked by the mask being built per view on the host, which is why a second
     guesser could never see these. Here: the artist's own panel is unchanged. */
  check('and nobody else is handed them', !shown(artist.w, 'pic-mask'));

  check('a clock is running', /^\d+s$/.test(artist.$('pic-clock').textContent), artist.$('pic-clock').textContent);
  // a scene needs setting up, so the hard word is given half again as long
  check('a hard word gets ninety seconds', +artist.$('pic-clock').textContent.replace('s', '') > 60,
    artist.$('pic-clock').textContent);

  // a wrong guess is shown to the room; a near miss says so
  watcher.$('pic-input').value = 'definitelynotit';
  watcher.$('pic-form').dispatchEvent(new watcher.w.Event('submit', { cancelable: true, bubbles: true }));
  await wait(250);
  check('a guess is shown to everyone', /definitelynotit/.test(artist.$('pic-guesses').textContent),
    artist.$('pic-guesses').textContent);
  check('a wrong guess does not end the round', artist.$('pic-clock').textContent !== '');

  const near = word.slice(0, -1) + (word.slice(-1) === 'x' ? 'y' : 'x');
  watcher.$('pic-input').value = near;
  watcher.$('pic-form').dispatchEvent(new watcher.w.Event('submit', { cancelable: true, bubbles: true }));
  await wait(250);
  check('one letter out is called close', /close/.test(watcher.$('pic-guesses').textContent),
    watcher.$('pic-guesses').textContent);

  /* Ink travels on its own, outside the state — and *while* the line is being
     drawn. Waiting for the pen to lift meant everyone else watched an empty
     canvas and then had a shape appear, which is most of what makes the game
     work thrown away. So: no pointerup here, and the other window should
     already have something. */
  const cv = artist.$('pic-board');
  /* jsdom has no layout, so every rect is 0×0 — which made every point on the
     canvas land in the same place and get skipped as a micro-movement. Give the
     canvas the size it has in a browser and the pen has somewhere to go. */
  cv.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 450, right: 600, bottom: 450 });
  const pen = (type, x, y) => cv.dispatchEvent(new artist.w.PointerEvent(type,
    { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true }));
  pen('pointerdown', 20, 20);
  for (let i = 0; i < 8; i++) pen('pointermove', 24 + i * 9, 26 + i * 6);
  await wait(250);
  check('a line is watched as it is drawn, not after it',
    +watcher.$('pic-board').dataset.points > 1, watcher.$('pic-board').dataset.points);
  const sofar = +watcher.$('pic-board').dataset.points;
  for (let i = 8; i < 18; i++) pen('pointermove', 24 + i * 9, 26 + i * 6);
  await wait(250);
  check('and it keeps arriving as the line goes on',
    +watcher.$('pic-board').dataset.points > sofar,
    `${watcher.$('pic-board').dataset.points} was ${sofar}`);
  check('as one line, not a dozen', +watcher.$('pic-board').dataset.strokes === 1,
    watcher.$('pic-board').dataset.strokes);
  pen('pointerup', 24 + 17 * 9, 26 + 17 * 6);
  await wait(200);

  // a tap is a dot — a stroke of one point, which used to draw nothing at all
  const wasStrokes = +watcher.$('pic-board').dataset.strokes;
  pen('pointerdown', 200, 120); pen('pointerup', 200, 120);
  await wait(250);
  check('a tap puts down a dot', +watcher.$('pic-board').dataset.strokes === wasStrokes + 1,
    `${watcher.$('pic-board').dataset.strokes} was ${wasStrokes}`);
  check('and the dot is one point', +artist.$('pic-board').dataset.points
    === +watcher.$('pic-board').dataset.points,
    `${artist.$('pic-board').dataset.points} / ${watcher.$('pic-board').dataset.points}`);

  /* Fill is a mode, and it rides on the same stroke machinery as a line — one
     flag on the stroke, so undo, the wire format and the far end all already
     work. What is worth checking is that the flag reaches the other side,
     because that is the part that would quietly draw the wrong picture. */
  {
    const before = +(watcher.$('pic-board').dataset.filled || 0);
    artist.$('pic-fill').click();
    check('fill latches on rather than firing once',
      artist.$('pic-fill').getAttribute('aria-pressed') === 'true');
    pen('pointerdown', 300, 60);
    for (let i = 0; i < 6; i++) pen('pointermove', 300 + i * 20, 60 + i * 14);
    pen('pointerup', 400, 150);
    await wait(260);
    check('a lasso reaches the watcher as a filled shape',
      +(watcher.$('pic-board').dataset.filled || 0) > before,
      `${before} → ${watcher.$('pic-board').dataset.filled}`);
    artist.$('pic-fill').click();
    check('and it can be turned off again',
      artist.$('pic-fill').getAttribute('aria-pressed') === 'false');
  }

  // and getting it right ends the round for everyone — spaces optional, since
  // where the gaps go is the drawer's problem, not the guesser's
  watcher.$('pic-input').value = word.replace(/ /g, '');
  watcher.$('pic-form').dispatchEvent(new watcher.w.Event('submit', { cancelable: true, bubbles: true }));
  await wait(300);
  check('the right answer ends the round', shown(host, 'pic-next') && shown(guest, 'pic-next'));
  check('and the answer is revealed', new RegExp(word, 'i').test(watcher.$('pic-over').textContent),
    watcher.$('pic-over').textContent);
  check('the guesser scored', /[1-9]/.test(watcher.$('pic-scores').textContent), watcher.$('pic-scores').textContent);
  check('so did the artist', /[1-9]/.test(artist.$('pic-scores').textContent), artist.$('pic-scores').textContent);
  check('the hard-word bonus is included', (() => {
    const mine = [...watcher.$('pic-scores').querySelectorAll('.pic-score')]
      .find((p) => p.textContent.includes('(you)'));
    return +mine.querySelector('b').textContent >= 6;   // 2 base + clock + 4 bonus
  })(), watcher.$('pic-scores').textContent);
  check('the scoring is explained on screen', /How scoring works/.test($h('game-pictionary').textContent));

  watcher.$('pic-next').click();
  await wait(250);
  check('the next round is thrown open again', shown(watcher.w, 'pic-claim'), watcher.$('pic-role').textContent);
  check('the artist cannot draw twice running', !shown(artist.w, 'pic-claim'), artist.$('pic-role').textContent);

  // the bank, and that it doesn't hand out the same words over and over
  watcher.$('pic-take').click();
  await wait(250);
  const offered = [...watcher.$('pic-offers').querySelectorAll('[data-k]')]
    .map((b) => b.querySelector('b').textContent);
  check('a fresh round offers three different words',
    new Set(offered).size === 3 && offered.every((w) => /^[a-z]+( [a-z]+)*$/.test(w)), offered.join(' | '));
  check('and none of them is the one just used', offered.indexOf(word) < 0, offered.join(' | '));
  check('the harder ones say how long you get', /90s/.test(watcher.$('pic-offers').textContent),
    watcher.$('pic-offers').textContent);
}

// scrabble --------------------------------------------------------------
await openGame(host, $h, 'scrabble');
await openGame(guest, $g, 'scrabble');
check('the board is actually on screen', shown(host, 'sc-live') && shown(host, 'sc-board'));
check('the blank chooser stays out of the way until it is wanted', !shown(host, 'sc-blank'));
check('the board is fifteen by fifteen', $h('sc-board').querySelectorAll('.sc-sq').length === 225, `${$h('sc-board').querySelectorAll('.sc-sq').length}`);
check('the centre square is marked', $h('sc-board').children[7 * 15 + 7].dataset.p === '*', $h('sc-board').children[112].dataset.p);
check('both players hold seven tiles', $h('sc-rack').querySelectorAll('.sc-t').length === 7 && $g('sc-rack').querySelectorAll('.sc-t').length === 7);
check('fourteen tiles have left the bag', /86 in the bag/.test($h('sc-meta').textContent), $h('sc-meta').textContent);
// Each window is only ever sent its own rack, so two windows holding the same
// seven tiles in the same order would mean the host had leaked one.
check('a rack stays in its own window', $g('sc-rack').textContent !== $h('sc-rack').textContent, $h('sc-rack').textContent);
check('only the player on turn can act', $h('sc-recall').disabled === false && $g('sc-recall').disabled === true);

const sq = ($w, r, c) => $w('sc-board').children[r * 15 + c];
const rackOf = ($w) => [...$w('sc-rack').querySelectorAll('.sc-t')]
  .map((b) => ({ i: +b.dataset.i, ch: b.textContent.trim()[0] }))
  .filter((t) => /^[a-z]$/.test(t.ch));

// A play that isn't legal can't even be submitted now: the Play button reports
// the verdict rather than letting you press it and be told no.
{
  const r = rackOf($h);
  await tapEl(host, $h('sc-rack').querySelector(`[data-i="${r[0].i}"]`));
  await tapEl(host, sq($h, 7, 7));
  await wait(40);
  check('a tile can be put down by tapping', sq($h, 7, 7).classList.contains('pend'));
  check('an uncommitted tile is invisible to the other player', !sq($g, 7, 7).classList.contains('tile'));
  check('one letter cannot be played', $h('sc-play').disabled === true);
  check('and the button says why', /keep going/i.test($h('sc-play-label').textContent), $h('sc-play-label').textContent);
  $h('sc-play').click();
  await wait(150);
  check('pressing it anyway does nothing', sq($h, 7, 7).classList.contains('pend') && !sq($g, 7, 7).classList.contains('tile'));
  $h('sc-recall').click();
  await wait(40);
  check('recall takes the tiles back', !sq($h, 7, 7).classList.contains('tile') && $h('sc-rack').querySelectorAll('.sc-t:not(.gap)').length === 7);
}

// Now find a real two-letter word in the host's rack by trying orderings. The
// board is untouched by a rejection, so this costs nothing but time — and it
// exercises placement, validation, scoring, the turn and the refill for real.
const VALUES = { a:1,b:3,c:3,d:2,e:1,f:4,g:2,h:4,i:1,j:8,k:5,l:1,m:3,n:1,o:1,p:3,q:10,r:1,s:1,t:1,u:1,v:4,w:4,x:8,y:4,z:10 };
let played = null;
const rack = rackOf($h);
outer:
for (const a of rack) for (const b of rack) {
  if (a.i === b.i) continue;
  await tapEl(host, $h('sc-rack').querySelector(`[data-i="${a.i}"]`));
  await tapEl(host, sq($h, 7, 7));
  await tapEl(host, $h('sc-rack').querySelector(`[data-i="${b.i}"]`));
  await tapEl(host, sq($h, 7, 8));
  await wait(20);
  if (!$h('sc-play').disabled) {
    $h('sc-play').click();
    await wait(150);
    if (sq($h, 7, 7).classList.contains('tile') && !sq($h, 7, 7).classList.contains('pend')) {
      played = a.ch + b.ch;
      break outer;
    }
  }
  $h('sc-recall').click();
  await wait(20);
}
check('a real word can be found and played', !!played, `rack ${rack.map((t) => t.ch).join('')}`);
if (played) {
  const want = 2 * (VALUES[played[0]] + VALUES[played[1]]);   // the star doubles the word
  const myScore = ($w) => +[...$w('sc-players').querySelectorAll('.sc-player')]
    .find((p) => p.textContent.includes('(you)')).querySelector('b').textContent;
  check('the played word reaches the other board', sq($g, 7, 7).classList.contains('tile') && sq($g, 7, 8).classList.contains('tile'), played);
  check('the centre star doubles the word', myScore($h) === want, `${played} wanted ${want}, got ${myScore($h)}`);
  check('the turn moves on', $h('sc-recall').disabled === true && $g('sc-recall').disabled === false);
  check('the rack is refilled from the bag', $h('sc-rack').querySelectorAll('.sc-t:not(.gap)').length === 7, `${$h('sc-rack').querySelectorAll('.sc-t:not(.gap)').length}`);
  check('the bag went down by two', /84 in the bag/.test($h('sc-meta').textContent), $h('sc-meta').textContent);
  check('both windows name the same word', $g('sc-msg').textContent.includes(played.toUpperCase()), $g('sc-msg').textContent);
}

// a follower cannot play out of turn
{
  const r = rackOf($h);
  if (r.length) {
    await tapEl(host, $h('sc-rack').querySelector(`[data-i="${r[0].i}"]`));
    await tapEl(host, sq($h, 0, 0));
    await wait(40);
    check('you cannot place a tile when it is not your turn', !sq($h, 0, 0).classList.contains('pend'));
  }
}

$g('sc-pass').click();
await wait(200);
check('passing hands the turn back', $h('sc-recall').disabled === false, $h('sc-msg').textContent);
check('a pass is announced', /passed/.test($h('sc-msg').textContent), $h('sc-msg').textContent);

// When the break ends, everyone goes back to focusing — including whoever is
// still sitting in a game. The leader's own complete() shuts its arcade; the
// followers have to be told, or the room splits in two.
$h('ov-back').click(); $h('ov-back').click();
$g('ov-back').click(); $g('ov-back').click();
$h('stop').click();
await wait(300);
$h('begin').click();
await wait(250);
$h('skip').click();                       // end the focus block, into the break
await wait(350);
check('the follower follows into the break', $g('app').dataset.phase === 'rest', $g('app').dataset.phase);

await openGame(guest, $g, 'scrabble');
check('the follower is in a game during the break', !$g('overlay').classList.contains('hide'));

$h('skip').click();                       // end the break
await wait(400);
check('the break ending pulls the follower out of the arcade', $g('overlay').classList.contains('hide'), 'still in the arcade');
check('the follower is focusing again', $g('app').dataset.phase === 'focus', $g('app').dataset.phase);

// that focus block ran with somebody else in the room, so it should say so
{
  const log = JSON.parse(guest.localStorage.getItem('focus_log') || '[]');
  const shared = log.filter((r) => r.with && r.with.length);
  check('a shared session records who you were with', shared.length > 0, `${log.length} records, none shared`);
  check('it records them by name', shared.length > 0 && shared[shared.length - 1].with.includes('Hashir'),
    JSON.stringify(shared[shared.length - 1] && shared[shared.length - 1].with));
  $g('d-stats').click();
  await wait(80);
  check('stats show who you focused alongside', /Focused alongside/.test($g('stats-body').textContent), $g('stats-body').textContent.slice(0, 60));
  check('and names them', /Hashir/.test($g('stats-body').textContent));
  $g('stats-close').click();
  await wait(40);
}

await openGame(host, $h, 'scrabble');
await openGame(guest, $g, 'scrabble');

// --- Scrabble: the board's own controls ------------------------------------
{
  const sq2 = (r, c) => $h('sc-board').children[r * 15 + c];
  check('premium squares are labelled', sq2(0, 0).dataset.label === '3W'
    && sq2(1, 1).dataset.label === '2W' && sq2(0, 3).dataset.label === '2L',
    `${sq2(0, 0).dataset.label}/${sq2(1, 1).dataset.label}/${sq2(0, 3).dataset.label}`);

  const cell = () => $h('sc-board').style.getPropertyValue('--sc-cell');
  const before = cell();
  $h('sc-zin').click();
  await wait(60);
  check('zooming in grows the squares', parseInt(cell(), 10) > parseInt(before || '0', 10), `${before} -> ${cell()}`);
  check('zoom stops at the top', ($h('sc-zin').click(), $h('sc-zin').click(), $h('sc-zin').disabled));
  $h('sc-zout').click(); $h('sc-zout').click(); $h('sc-zout').click();
  await wait(60);
  check('zooming back out returns to fit', $h('sc-zlabel').textContent === 'Fit' && $h('sc-zout').disabled,
    $h('sc-zlabel').textContent);
}

// --- resetting a shared game ------------------------------------------------
// Only the timer holder may wipe a game everyone is playing, and the host is
// what enforces it — the menu being hidden elsewhere is a convenience.
{
  const rightClick = (w, id) => w.document.getElementById(id).dispatchEvent(
    new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 200 }));

  // Holding is how you pick a tile up, so the board itself offers no menu —
  // resetting lives on the game's card in the arcade, where nothing else wants
  // the gesture.
  rightClick(host, 'game-scrabble');
  await wait(60);
  check('the board itself offers no menu', $h('hmenu').classList.contains('hide'));

  const tilesBefore = $h('sc-board').querySelectorAll('.sc-sq.tile').length;
  check('there are tiles on the board to lose', tilesBefore > 0, `${tilesBefore}`);

  // back to the picker, where the card is
  $h('ov-back').click(); $g('ov-back').click();
  await wait(80);
  const card = (w, id) => [...w.document.querySelectorAll('.pcard')].find((c) => c.dataset.game === id);

  card(guest, 'scrabble').dispatchEvent(new guest.MouseEvent('contextmenu',
    { bubbles: true, cancelable: true, clientX: 120, clientY: 200 }));
  await wait(60);
  check('a follower gets no reset menu', $g('hmenu').classList.contains('hide'));

  card(host, 'scrabble').dispatchEvent(new host.MouseEvent('contextmenu',
    { bubbles: true, cancelable: true, clientX: 120, clientY: 200 }));
  await wait(60);
  check('the timer holder gets a reset menu', !$h('hmenu').classList.contains('hide'));
  check('the menu offers a reset', /Reset/.test($h('hmenu-card').textContent), $h('hmenu-card').textContent);

  $h('hmenu-card').querySelector('button').click();
  await wait(60);
  check('resetting asks first', !$h('confirm').classList.contains('hide'));
  check('the board is untouched until you say yes', $h('sc-board').querySelectorAll('.sc-sq.tile').length === tilesBefore);

  $h('confirm-no').click();
  await wait(60);
  check('cancelling leaves the game alone', $h('confirm').classList.contains('hide')
    && $h('sc-board').querySelectorAll('.sc-sq.tile').length === tilesBefore);

  rightClick(host, 'game-scrabble');
  await wait(40);
  $h('hmenu-card').querySelector('button').click();
  await wait(40);
  $h('confirm-yes').click();
  await wait(300);
  await openGame(host, $h, 'scrabble');
  await openGame(guest, $g, 'scrabble');
  check('confirming clears the board for everyone',
    $h('sc-board').querySelectorAll('.sc-sq.tile').length === 0
    && $g('sc-board').querySelectorAll('.sc-sq.tile').length === 0,
    `host ${$h('sc-board').querySelectorAll('.sc-sq.tile').length} guest ${$g('sc-board').querySelectorAll('.sc-sq.tile').length}`);
  check('a reset deals fresh racks', $h('sc-rack').querySelectorAll('.sc-t').length === 7);
}

// --- the live read ----------------------------------------------------------
// Same rules the host will judge by, run against this window's board while the
// tiles are still being laid out.
{
  const on = $h('sc-recall').disabled ? { w: guest, $: $g } : { w: host, $: $h };
  const sq2 = (r, c) => on.$('sc-board').children[r * 15 + c];
  const rack2 = () => [...on.$('sc-rack').querySelectorAll('.sc-t')]
    .map((b) => ({ i: +b.dataset.i, ch: b.textContent.trim()[0] }))
    .filter((t) => /^[a-z]$/.test(t.ch));
  const put2 = async (t, r, c) => {
    await tapEl(on.w, on.$('sc-rack').querySelector(`[data-i="${t.i}"]`));
    await tapEl(on.w, sq2(r, c));
  };
  const preview = () => on.$('sc-preview');

  const r2 = rack2();
  await put2(r2[0], 7, 7);
  await wait(60);
  check('one tile is not yet an opinion', preview().textContent.trim() === '', preview().textContent);

  on.$('sc-recall').click(); await wait(20);
  await put2(r2[0], 7, 7); await put2(r2[1], 9, 9);
  await wait(60);
  check('scattered tiles are not yet an opinion', preview().textContent.trim() === '', preview().textContent);

  on.$('sc-recall').click(); await wait(20);
  await put2(r2[0], 7, 7); await put2(r2[1], 7, 9);
  await wait(60);
  check('a gap is not yet an opinion', preview().textContent.trim() === '', preview().textContent);

  // Lay every pair the rack allows and note the first that's a word and the
  // first that isn't. Scanning all of them rather than stopping at the first
  // hit is what makes the "and it says so when it isn't" case reliable — on a
  // friendly rack the very first pair can be a word.
  let good = null, bad = null;
  for (const a of r2) for (const b of r2) {
    if (a.i === b.i) continue;
    if (good && bad) break;
    on.$('sc-recall').click();
    await wait(12);
    await put2(a, 7, 7); await put2(b, 7, 8);
    await wait(20);
    if (!good && on.$('sc-play').classList.contains('ready')) good = a.ch + b.ch;
    else if (!bad && preview().classList.contains('bad')) bad = a.ch + b.ch;
  }
  check('a non-word is called out while you build it', !!bad, 'every pair in the rack was a word');
  check('the preview scores a real word before it is played', !!good, `rack ${r2.map((t) => t.ch).join('')}`);

  // put the good one back so the assertions below have something to read
  if (good) {
    on.$('sc-recall').click();
    await wait(15);
    const first = r2.find((t) => t.ch === good[0]);
    const second = r2.find((t) => t.ch === good[1] && t.i !== first.i) || r2.find((t) => t.ch === good[1]);
    await put2(first, 7, 7);
    await put2(second, 7, 8);
    await wait(40);
  }
  if (good) {
    check('it names the word', preview().querySelector('.w').textContent.toLowerCase() === good,
      `${preview().querySelector('.w').textContent} vs ${good}`);
    check('the Play button says what it will score', /^\+\d+$/.test(on.$('sc-play-pts').textContent), on.$('sc-play-pts').textContent);
    check('and names the word on the button', /PLAY /.test(on.$('sc-play-label').textContent.toUpperCase()), on.$('sc-play-label').textContent);
    check('Play is only enabled when the play is legal', on.$('sc-play').disabled === false);
    check('a valid word is not marked bad', !preview().classList.contains('bad'));
    check('the other player sees nothing of your half-turn',
      on.w === guest ? $h('sc-preview').textContent.trim() === '' : $g('sc-preview').textContent.trim() === '');
  }

  on.$('sc-recall').click();
  await wait(40);
  check('recalling clears the preview', preview().textContent.trim() === '');
}

// leaving the room clears the games rather than leaving a dead board up
await leaveRoom($h);
await wait(250);
check('the game goes away with the room', $g('sc-live').classList.contains('hide') && !$g('sc-need').classList.contains('hide'));
$h('ov-back').click(); $h('ov-back').click();
$g('ov-back').click(); $g('ov-back').click();
await leaveRoom($g);
await wait(150);

/* Put the two of them back in a room before chess. Chess needs a live
   connection to reach the other person: with no room the panel opens on
   `ch-need` and every check below it fails from the lobby down — the people
   list still renders, which is what makes the failure read like a chess bug
   rather than a missing room. The scrabble block above deliberately leaves the
   room to prove a game clears with it, so this has to be rebuilt rather than
   assumed.

   This only ever showed in a full run. tools/slice-test.mjs prepends its own
   room to chess.mjs, so the slices passed while `npm test` was red — which is
   how it stayed red without anyone noticing. Anything added here that leaves
   the room must put it back. */
for (const [w, $w, nm] of [[host, $h, 'Hashir'], [guest, $g, 'Friend']]) {
  $w('sync-name').value = nm;
  $w('sync-name').dispatchEvent(new w.Event('input'));
}
$h('sync-host').click();
await wait(150);
const chessCode = $h('sync-mycode').textContent;
$g('sync-code').value = chessCode;
$g('sync-join').click();
await wait(400);
$h('sync-close').click();
$g('sync-close').click();

// chess ------------------------------------------------------------------
/* Chess is the one shared game that isn't one game for the whole room, so the
   lobby is as much under test as the board: you pick a person, the two of you
   get a board, and — the point of the whole thing — it survives being walked
   away from and picked up in a different room days later. */
await openGame(host, $h, 'chess');
await openGame(guest, $g, 'chess');
check('chess opens on the list of people', shown(host, 'ch-lobby') && !shown(host, 'ch-live'));
check('and the other person is on it', /Friend/.test($h('ch-people').textContent),
  $h('ch-people').textContent);
check('with nothing between you yet', /Free/.test($h('ch-people').textContent),
  $h('ch-people').textContent);

$h('ch-people').querySelector('.ch-pick').click();
await wait(300);
check('the invitation reaches them', /Wants a game/.test($g('ch-people').textContent),
  $g('ch-people').textContent);
check('and the asker is told they asked', /waiting for them/i.test($h('ch-people').textContent),
  $h('ch-people').textContent);
check('one can be turned down', !!$g('ch-people').querySelector('[data-act="decline"]'));

$g('ch-people').querySelector('.ch-pick').click();
await wait(350);
check('both of you land on a board', shown(host, 'ch-live') && shown(guest, 'ch-live'));
check('there are sixty-four squares', $h('ch-board').querySelectorAll('[data-sq]').length === 64,
  `${$h('ch-board').querySelectorAll('[data-sq]').length}`);
check('and thirty-two pieces', $h('ch-board').querySelectorAll('.ch-p').length === 32,
  `${$h('ch-board').querySelectorAll('.ch-p').length}`);
check('whoever asked plays White', /White/.test($h('ch-vs').textContent), $h('ch-vs').textContent);
check('the other one plays Black', /Black/.test($g('ch-vs').textContent), $g('ch-vs').textContent);
check('White is told to move', /Your move/.test($h('ch-turn').textContent), $h('ch-turn').textContent);
check('Black is told who to wait for', /Hashir/.test($g('ch-turn').textContent), $g('ch-turn').textContent);
check('the board is the right way up for each of you',
  $h('ch-board').firstElementChild.dataset.sq === '0'
  && $g('ch-board').firstElementChild.dataset.sq === '63',
  `${$h('ch-board').firstElementChild.dataset.sq} / ${$g('ch-board').firstElementChild.dataset.sq}`);

const CHI = (n) => (8 - Number(n[1])) * 8 + 'abcdefgh'.indexOf(n[0]);
const sqOf = ($w, n) => $w('ch-board').querySelector(`[data-sq="${CHI(n)}"]`);
const move = async ($w, from, to) => {
  sqOf($w, from).click();
  await wait(70);
  sqOf($w, to).click();
  await wait(260);
};

sqOf($h, 'e2').click();
await wait(60);
check('picking a piece up shows where it can go',
  $h('ch-board').querySelectorAll('.go').length === 2,
  `${$h('ch-board').querySelectorAll('.go').length}`);
check('and marks the one you picked', !!$h('ch-board').querySelector('.sel'));
sqOf($h, 'e2').click();
await wait(60);
check('tapping it again puts it back down', !$h('ch-board').querySelector('.sel'));
sqOf($g, 'e7').click();
await wait(60);
check('you cannot pick anything up on their turn', !$g('ch-board').querySelector('.sel'));

// Scholar's mate, played through the real board on two real windows
await move($h, 'e2', 'e4');
check('the move lands on both boards',
  /e4/.test($h('ch-moves').textContent) && /e4/.test($g('ch-moves').textContent),
  `${$h('ch-moves').textContent} | ${$g('ch-moves').textContent}`);
check('and the turn passes', /Your move/.test($g('ch-turn').textContent), $g('ch-turn').textContent);
check('the square it came from is marked', $h('ch-board').querySelectorAll('.last').length === 2,
  `${$h('ch-board').querySelectorAll('.last').length}`);
await move($g, 'e7', 'e5');
await move($h, 'f1', 'c4');
await move($g, 'b8', 'c6');
await move($h, 'd1', 'h5');
check('a queen aiming at f7 is not yet check', !$g('ch-board').querySelector('.check'));
await move($g, 'g8', 'f6');
await move($h, 'h5', 'f7');
check('the notation reads as chess',
  /Qxf7#/.test($h('ch-moves').textContent), $h('ch-moves').textContent);
check('checkmate ends it', /checkmate/i.test($h('ch-msg').textContent), $h('ch-msg').textContent);
check('the winner is told they won', /You won/.test($h('ch-msg').textContent), $h('ch-msg').textContent);
check('and the loser who won', /Friend won|Hashir won/.test($g('ch-msg').textContent),
  $g('ch-msg').textContent);
check('the king in trouble is marked', !!$g('ch-board').querySelector('.check'));
check('there is nothing left to resign', !shown(host, 'ch-resign'));
check('and another game is offered', shown(host, 'ch-again'));
check('a taken piece is shown', $h('ch-taken-bottom').textContent.length > 0,
  $h('ch-taken-bottom').textContent);

$h('ch-again').click();
await wait(350);
check('a new game swaps the colours', /Black/.test($h('ch-vs').textContent), $h('ch-vs').textContent);
check('the board fills back up', $h('ch-board').querySelectorAll('.ch-p').length === 32);
check('with nothing played yet', /No moves yet/.test($h('ch-moves').textContent),
  $h('ch-moves').textContent);

await move($g, 'd2', 'd4');
await move($h, 'd7', 'd5');
$h('ch-leave').click();
await wait(120);
check('you can walk away from a game', shown(host, 'ch-lobby') && !shown(host, 'ch-live'));
check('and it is still there to open', /You’re playing/.test($h('ch-people').textContent),
  $h('ch-people').textContent);
check('the moves are written down on both machines',
  /d2d4/.test(host.localStorage.getItem('focus_chess') || '')
  && /d2d4/.test(guest.localStorage.getItem('focus_chess') || ''),
  String(host.localStorage.getItem('focus_chess')).slice(0, 90));

/* Now the part that matters: the room goes away, a different machine hosts,
   and the half-played game has to come back. The new host has never seen this
   game — it arrives with the invitation and is replayed before it is trusted. */
await leaveRoom($h);
await wait(300);
check('the board goes when the room does', !shown(host, 'ch-live') && !shown(guest, 'ch-live'));

$g('sync-host').click();
await wait(250);
$h('sync-code').value = $g('sync-mycode').textContent;
$h('sync-join').click();
await wait(600);
await openGame(guest, $g, 'chess');
await openGame(host, $h, 'chess');
await wait(200);
check('what you left off is offered when you meet again',
  /Pick it up|Left off at move/.test($g('ch-people').textContent), $g('ch-people').textContent);

$g('ch-people').querySelector('.ch-pick').click();
await wait(300);
check('the other side is asked to pick that game up, not to start a new one',
  /pick your game back up/i.test($h('ch-people').textContent), $h('ch-people').textContent);
$h('ch-people').querySelector('.ch-pick').click();
await wait(400);
check('the position comes back', /d4/.test($g('ch-moves').textContent), $g('ch-moves').textContent);
check('with the pieces where they were',
  $g('ch-board').querySelectorAll('.ch-p').length === 32
  && !$g('ch-board').querySelector('[data-sq="51"] .ch-p'),
  `${$g('ch-board').querySelectorAll('.ch-p').length}`);
check('the same person still has White', /White/.test($g('ch-vs').textContent), $g('ch-vs').textContent);
check('and it is their move', /Your move/.test($g('ch-turn').textContent), $g('ch-turn').textContent);

// and it is a real game, not a picture of one
await move($g, 'c2', 'c4');
check('play carries on from there', /c4/.test($h('ch-moves').textContent), $h('ch-moves').textContent);
check('the move count is right',
  $h('ch-moves').querySelectorAll('.ch-mv').length === 2,
  `${$h('ch-moves').querySelectorAll('.ch-mv').length}`);

/* ---- the two rules a hand-built board gets wrong ----
   Promotion: every move to the last rank carries a promotion piece, so asking
   the engine for "the move from here to there" found nothing and the tap put
   the pawn quietly back down. Castling: the rules call it a king move, but
   reaching for the rook is what people try first. */
$g('ch-again').click();
await wait(350);
const fast = async ($w, from, to) => {
  sqOf($w, from).click();
  await wait(40);
  sqOf($w, to).click();
  await wait(170);
};
// host is White again after the swap; five moves to a promotion
check('the swap put White back with the host', /White/.test($h('ch-vs').textContent),
  $h('ch-vs').textContent);
await fast($h, 'a2', 'a4'); await fast($g, 'b7', 'b5');
await fast($h, 'a4', 'b5'); await fast($g, 'a7', 'a6');
await fast($h, 'b5', 'a6'); await fast($g, 'g7', 'g6');
await fast($h, 'a6', 'a7'); await fast($g, 'g6', 'g5');
sqOf($h, 'a7').click();
await wait(60);
sqOf($h, 'b8').click();
await until(() => shown(host, 'ch-promo'));
check('a promoting tap asks what to make it', shown(host, 'ch-promo'));
check('and offers all four', $h('ch-promo-row').querySelectorAll('[data-p]').length === 4,
  `${$h('ch-promo-row').querySelectorAll('[data-p]').length}`);
check('the pawn has not moved while you decide',
  !!sqOf($h, 'a7').querySelector('.ch-p'));
$h('ch-promo-row').querySelector('[data-p="q"]').click();
await until(() => /axb8=Q/.test($h('ch-moves').textContent)
  && /axb8=Q/.test($g('ch-moves').textContent));
check('choosing makes the move', /axb8=Q/.test($h('ch-moves').textContent), $h('ch-moves').textContent);
check('and there is a new queen on the board',
  sqOf($h, 'b8').querySelector('.ch-p').textContent === '♕',
  sqOf($h, 'b8').textContent);
check('the other side sees it too', /axb8=Q/.test($g('ch-moves').textContent), $g('ch-moves').textContent);
check('and the chooser has gone', !shown(host, 'ch-promo'));

// castling, by reaching for the rook
$h('ch-again').click();
await wait(350);
await fast($g, 'g1', 'f3'); await fast($h, 'g8', 'f6');
await fast($g, 'g2', 'g3'); await fast($h, 'g7', 'g6');
await fast($g, 'f1', 'g2'); await fast($h, 'f8', 'g7');
sqOf($g, 'e1').click();
await wait(60);
check('the king is offered its castling square',
  !!sqOf($g, 'g1').classList.contains('go'), sqOf($g, 'g1').className);
sqOf($g, 'h1').click();
await wait(300);
check('tapping your own rook castles', /O-O/.test($g('ch-moves').textContent), $g('ch-moves').textContent);
check('the king ends up on g1', sqOf($g, 'g1').querySelector('.ch-p').textContent === '♔',
  sqOf($g, 'g1').textContent);
check('and the rook beside it', sqOf($g, 'f1').querySelector('.ch-p').textContent === '♖',
  sqOf($g, 'f1').textContent);
check('the other board agrees', /O-O/.test($h('ch-moves').textContent), $h('ch-moves').textContent);

// put the room back the way the blocks after this one expect it
await leaveRoom($g);
await wait(250);
$h('sync-host').click();
await wait(250);
$g('sync-code').value = $h('sync-mycode').textContent;
$g('sync-join').click();
await wait(600);
$h('ov-back').click();
$g('ov-back').click();
await wait(80);

// --- handing the timer over, and removing people ---------------------------
// A third window, so a handover has somewhere to go and a witness to see it.
const { window: third, errors: thirdErr } = boot(roomHtml, { focus_embers: ROOM_EMBERS });
await wait(300);
const $t = (id) => third.document.getElementById(id);

$h('sync-host').click();
await wait(150);
const roomCode = $h('sync-mycode').textContent;

for (const [w, $w, nm] of [[guest, $g, 'Friend'], [third, $t, 'Third']]) {
  $w('sync-name').value = nm;
  $w('sync-name').dispatchEvent(new w.Event('input'));
  $w('d-sync').click();
}
// all three know each other, so nobody waits at the door — see beFriends
beFriends(host, guest, third);
for (const [w, $w] of [[guest, $g], [third, $t]]) {
  $w('sync-code').value = roomCode;
  $w('sync-join').click();
}
await until(() => $h('sync-people').querySelectorAll('.sync-person').length === 3);
check('three in the room', $h('sync-people').querySelectorAll('.sync-person').length === 3, `${$h('sync-people').querySelectorAll('.sync-person').length}`);
check('host holds the timer to begin with', /You[\s\S]*holds the timer/.test($h('sync-people').innerHTML) || $h('sync-people').querySelector('.sync-person.lead')?.textContent.includes('you'), $h('sync-people').querySelector('.sync-person.lead')?.textContent);
check('only the holder sees management buttons', $h('sync-people').querySelectorAll('[data-lead]').length === 2 && $g('sync-people').querySelectorAll('[data-lead]').length === 0, `host ${$h('sync-people').querySelectorAll('[data-lead]').length} / guest ${$g('sync-people').querySelectorAll('[data-lead]').length}`);

/* Something on a board, so the handover below has something to lose. The host
   owns every game, so without the handoff a change of host wiped the lot. */
await openGame(host, $h, 'hangman');
await openGame(guest, $g, 'hangman');
$h('hm-take').click();
await wait(250);
$h('hm-word-in').value = 'carried';
$h('hm-go').click();
await wait(250);
$g('hm-keys').querySelector('[data-k="r"]').click();
await wait(200);
check('there is a round under way before the handover',
  /r/.test($g('hm-word').textContent) && $g('hm-keys').querySelector('[data-k="r"]').disabled,
  $g('hm-word').textContent);
const wasScores = $g('hm-scores').textContent;
$h('ov-back').click();
$g('ov-back').click();
await wait(80);

/* Hand the timer to the guest — through the confirm, the way a person would,
   and **to the person by name**. This used to click `[data-lead]` index 0,
   which is whoever the host happens to list first, which is whoever connected
   first. Friend and Third join together and either can win; when Third won,
   the timer went to Third and the next eight checks all reported Third where
   they wanted Friend — a whole block failing identically, looking exactly like
   a broken handover, and green again on the next run. The room does not
   promise an order, so the test must not assume one. */
const handTo = (name) => {
  const row = [...$h('sync-people').querySelectorAll('.sync-person')]
    .find((r) => ((r.querySelector('.sync-who') || {}).textContent || '').includes(name));
  return row && row.querySelector('[data-lead]');
};
check('the host can see Friend to hand the timer to', !!handTo('Friend'),
  [...$h('sync-people').querySelectorAll('.sync-who')].map((x) => x.textContent).join(' | '));
handTo('Friend').click();
await wait(60);
check('handing over asks first, even in a full room', !$h('confirm').classList.contains('hide'));
$h('confirm-yes').click();
await until(() => /Hosting/.test($g('sync-state').textContent) && !!$g('sync-mycode').textContent);
const guestCode = $g('sync-mycode').textContent;
await until(() => $h('sync-state').textContent.includes(guestCode)
  && $t('sync-state').textContent.includes(guestCode), 8000);
check('guest now holds the timer', /You hold the timer/.test($g('sync-band').textContent) || $g('sync-people').querySelector('.sync-person.lead')?.textContent.includes('(you)'), $g('sync-people').querySelector('.sync-person.lead')?.textContent);
/* The room follows the timer. It has to: a room is the host's peer, so leaving
   the two in different places meant the person who had handed the clock over
   still couldn't close their laptop without ending everyone's session. */
check('the room moves to whoever was given the timer',
  $g('sync-state').textContent.includes('Hosting') && $g('sync-state').textContent.includes(guestCode),
  $g('sync-state').textContent);
check('and everybody else moves across with it',
  $h('sync-state').textContent.includes(guestCode) && $t('sync-state').textContent.includes(guestCode),
  `${$h('sync-state').textContent} / ${$t('sync-state').textContent}`);
/* **Wait for it rather than assuming a fixed pause was long enough.**

   The room's *name* is not part of the handover message — it arrives with the
   new host's own details a moment later, and until it does the label falls back
   to the bare code (`In K6A5M9 · K6A5M9`). A single `wait(1800)` covered that on
   an idle machine and stopped covering it on a busy one, which is a test that
   reports a product bug when the only thing that changed was the load. Poll for
   the thing being asserted; the timeout is the failure. */
for (let i = 0; i < 40 && !/Friend/.test($h('sync-state').textContent); i++) await wait(100);
check('the room is named after the person holding it', /Friend/.test($h('sync-state').textContent),
  $h('sync-state').textContent);
check('host is now following', $h('toggle-run').disabled === true, `disabled=${$h('toggle-run').disabled}`);

/* The boards come with it. They are the host's to keep, so they have to be
   handed over with the room — otherwise handing the timer on quietly threw away
   everyone's half-finished game and their scores with it. */
await openGame(guest, $g, 'hangman');
await openGame(host, $h, 'hangman');
await wait(250);
check('the round survives the change of host',
  $g('hm-word').textContent.replace(/\s/g, '').includes('r'), $g('hm-word').textContent);
check('and so do the letters already spent',
  $g('hm-keys').querySelector('[data-k="r"]').disabled);
// the same people and the same numbers; the host is listed first, and the host
// is not who it was
check('and the scores', wasScores.split(/(?=[A-Z])/).sort().join('')
  === $g('hm-scores').textContent.split(/(?=[A-Z])/).sort().join(''),
  `${$g('hm-scores').textContent} vs ${wasScores}`);
check('the answer still hasn’t leaked to the guessers',
  !/carried/i.test($g('hm-live').textContent), $g('hm-live').textContent.slice(0, 60));
// the setter is still the setter, on a machine that is no longer the room
check('whoever set the word is still the one who set it',
  /guessing yours/i.test($h('hm-role').textContent), $h('hm-role').textContent);
check('and still cannot guess at it', $h('hm-keys').querySelector('[data-k="a"]').disabled);
$g('ov-back').click();
$h('ov-back').click();
await wait(80);
check('guest controls unlocked', $g('begin').disabled === false);
check('guest can now manage', $g('sync-people').querySelectorAll('[data-lead]').length === 2, `${$g('sync-people').querySelectorAll('[data-lead]').length}`);
check('host no longer manages', $h('sync-people').querySelectorAll('[data-lead]').length === 0, `${$h('sync-people').querySelectorAll('[data-lead]').length}`);

// the new leader drives everyone, relayed through the host
$g('begin').click();
await wait(400);
check('new leader starts everyone', $h('setup').classList.contains('hide') && $t('setup').classList.contains('hide'), `host ${$h('setup').classList.contains('hide')} third ${$t('setup').classList.contains('hide')}`);
check('relayed clock reaches the third device', /^\d{2}:\d{2}$/.test($t('clock').textContent.trim()), $t('clock').textContent);


/* ---- the room, on the screen you are actually looking at ------------------

   Everybody's buddy used to live only in Focus together, which is a page you
   open once and leave — so the people you were sitting with were invisible for
   the whole of the block. They get a slot each in the timer screen's layer now,
   running their own antic.

   **Their antic was arriving and being thrown away.** Both halves of a buddy
   have ridden in `hello` since it was written — what they look like *and* what
   they do — and only the first was ever kept, so `budAnimKey(undefined)` gave 0
   for everybody and a room of three was three web-swingers. The comment beside
   the room list claimed otherwise the whole time. */
{
  // two different antics, so "their antic, not yours" has something to be wrong
  // about: 4 is the jetpack and 7 is the reader, and the host picked neither
  /* **And Save, because the antic is a draft now.** Choosing one used to write
     straight through and announce itself; it goes into `Buddy.draft` with the
     rest of him and the room is told once, on Save. A test that only clicks the
     antic is testing the preview. */
  /* The row holds what you own, so the button for antic 4 is not the fifth
     button any more — it is the one whose `data-anim` says 4. */
  /* The host takes one too. Nobody without an antic is drawn on anybody's
     timer screen — there is nothing for them to be doing — so a host who has
     not bought one is a host who is not in the room's picture. */
  for (const [$w, i] of [[$h, 1], [$g, 4], [$t, 7]]) {
    $w('d-account').click();
    await wait(140);
    $w('bud-box').querySelector(`[data-anim="${i}"]`).click();
    await wait(120);
    check('choosing an antic is a draft, not a save', !$w('bud-save').disabled,
      `save ${$w('bud-save').disabled ? 'disabled' : 'offered'}`);
    $w('bud-save').click();
    await wait(140);
    $w('acct-close').click();
    await wait(80);
  }
  await wait(500);
  const peers = [...$h('bud-layer').querySelectorAll('.bud-peer')];
  check('the other two are on the host\u2019s timer screen',
    peers.length === 2 && !$h('bud-layer').classList.contains('hide'), `${peers.length} peers`);
  check('and each of them is doing their own antic, not the host\u2019s',
    peers.some((n) => n.classList.contains('bud-jetpack'))
    && peers.some((n) => n.classList.contains('bud-read')),
    peers.map((n) => n.className).join(' / '));
  /* **Same antic, same 7.8s clock, same everything — unless something tells
     them apart.** `--t` is a negative delay off a hash of who they are, so two
     people who chose the swing are at different points of it. Stable, because a
     hash that moved would jump somebody across the screen every time the
     roster was rebuilt. */
  const ts = peers.map((n) => n.style.getPropertyValue('--t'));
  check('and they are not moving in step with each other',
    ts.length === 2 && ts.every((t) => /^-[\d.]+s$/.test(t)) && ts[0] !== ts[1], ts.join(' vs '));
  /* The poses that park — the reader in his corner, the sleeper on the floor —
     have no travel for a delay to shift, so two of them would sit inside one
     another. They get a place as well as a time. */
  check('and the ones who stay put are given somewhere to stay',
    peers.every((n) => /px$/.test(n.style.getPropertyValue('--x'))
      && /vh$/.test(n.style.getPropertyValue('--y'))),
    peers.map((n) => n.style.getPropertyValue('--x') + '/' + n.style.getPropertyValue('--y')).join(' '));
  /* **When he changes, his slot is started again rather than refilled.**

     Every antic is two clocks: one on the slot carrying him across the window
     (`bud-go` for the swing, `bud-skate-lap` for the board) and more inside it
     doing the swinging, the turning and the mirroring. They are written as
     exact fractions of one lap, so once they start together they stay locked -
     and nothing in CSS re-locks them. Writing `innerHTML` builds a new rig,
     whose animations start *now*, while the slot's own carries on from wherever
     it had got to; from then on he swings backwards under his own web and the
     board turns before it reaches the corner. "Not always", because it only
     begins when something re-renders him mid-lap - saving a colour, an account
     arriving, switching him off and on again. Measured at 1450ms adrift.

     A fresh element starts everything it contains at one moment, so the slot is
     rebuilt rather than refilled, and what can be checked here is exactly that:
     the node is a new one. jsdom has no animation engine and cannot see the
     drift itself - `tools/look-swing.mjs` measures it in a real browser. */
  {
    const was = $g('bud-live');
    $g('d-account').click();
    await wait(140);
    const swatch = [...$g('bud-box').querySelectorAll('[data-bud="c"]')]
      .find((b) => !b.classList.contains('on'));
    if (swatch) swatch.click();
    await wait(100);
    $g('bud-save').click();
    await wait(200);
    $g('acct-close').click();
    await wait(160);
    check('changing him mid-antic starts his slot again rather than refilling it',
      !!$g('bud-live') && $g('bud-live') !== was,
      $g('bud-live') === was ? 'the same node was refilled' : 'no slot at all');
    check('and he is still on the screen after it',
      !!$g('bud-live') && !$g('bud-live').classList.contains('hide')
      && /<svg/.test($g('bud-live').innerHTML),
      $g('bud-live') ? $g('bud-live').className : 'gone');
  }

  /* And the switch is yours: turning buddies off empties your screen and says
     nothing to anybody else about theirs. */
  $h('d-account').click();
  await wait(140);
  $h('bud-onscreen').click();
  await wait(200);
  check('turning buddies off clears the room from your screen, not theirs',
    $h('bud-layer').querySelectorAll('.bud-peer').length === 0
    && $g('bud-layer').querySelectorAll('.bud-peer').length === 2,
    `host ${$h('bud-layer').querySelectorAll('.bud-peer').length} guest ${$g('bud-layer').querySelectorAll('.bud-peer').length}`);
  $h('bud-onscreen').click();
  await wait(200);
  $h('acct-close').click();
  await wait(80);
  check('and turning them back on brings them back',
    $h('bud-layer').querySelectorAll('.bud-peer').length === 2,
    `${$h('bud-layer').querySelectorAll('.bud-peer').length}`);
}

// new leader removes the third member
const kickBtn = [...$g('sync-people').querySelectorAll('[data-kick]')].find((b) => {
  const row = b.closest('.sync-person');
  return row && row.textContent.includes('Third');
});
kickBtn.click();
await wait(60);
check('removing asks first', !$g('confirm').classList.contains('hide'), $g('confirm-title').textContent);
$g('confirm-yes').click();
await wait(400);
check('removed member is disconnected', $t('sync-state').textContent === 'Not connected', $t('sync-state').textContent);
check('removed member is told why', /removed/i.test($t('sync-status').textContent), $t('sync-status').textContent);
check('room is down to two', $h('sync-people').querySelectorAll('.sync-person').length === 2, `${$h('sync-people').querySelectorAll('.sync-person').length}`);
check('removed member regains its controls', !$t('toggle-run').disabled);

/* Leaving, when the room is yours and somebody else is in it. This used to be
   a yes/no that closed the session for everyone — which is a bad reason to have
   to stay in a room. */
$g('sync-leave').click();
await wait(80);
check('a host with company is offered a choice, not a yes/no',
  !$g('hmenu').classList.contains('hide'));
const leaveOpts = [...$g('hmenu-card').querySelectorAll('[data-i]')].map((b) => b.textContent);
check('one option hands it on', /Hand it to Hashir/.test(leaveOpts.join(' | ')), leaveOpts.join(' | '));
check('the other closes it', /Close the room/.test(leaveOpts.join(' | ')), leaveOpts.join(' | '));
$g('hmenu-card').querySelector('[data-i="0"]').click();
await wait(80);
check('handing it on asks first', !$g('confirm').classList.contains('hide'), $g('confirm-title').textContent);
$g('confirm-yes').click();
await wait(1200);
check('the one who left is out', $g('sync-state').textContent === 'Not connected', $g('sync-state').textContent);
check('but the room is not', $h('sync-state').textContent !== 'Not connected', $h('sync-state').textContent);
check('it is on the remaining person’s code now',
  $h('sync-state').textContent.includes('Hosting') && $h('sync-state').textContent.includes(roomCode),
  $h('sync-state').textContent);
check('and they hold the timer', !$h('toggle-run').disabled, `disabled=${$h('toggle-run').disabled}`);
await leaveRoom($h);
await wait(200);

/* ---- a build that knows where to check ------------------------------------
   The shipped build has no update host, and the block in Pass 1 checks that it
   therefore says nothing at all. This is the other half: point one at a host
   and it should ask, compare, and tell — without any of that reaching the rest
   of the app. The URL is stamped in at build time, so the fixture is the real
   built file with the placeholder swapped. */
{
  const wired = html.replace(
    /const UPD_URL = '[^']*'/,
    "const UPD_URL = 'https://updates.test/latest.json'",
  );

  UPDATE_REPLY = { version: '99.9.9', notes: 'Crossword clues rewritten.', url: 'https://updates.test/get' };
  const { window: w4 } = boot(wired);
  await wait(500);
  const $4 = (id) => w4.document.getElementById(id);
  check('a build with an update host asks it', w4.__fetched.some((u) => /latest\.json/.test(u)),
    w4.__fetched.join(' ').slice(0, 60));
  check('and shows what it found', !$4('upd-box').classList.contains('hide')
    && /99\.9\.9/.test($4('upd-box').textContent), $4('upd-box').textContent.slice(0, 70));
  check('with the note that came with it',
    /Crossword clues rewritten/.test($4('upd-box').textContent));
  check('and a link to go and get it',
    !!$4('upd-box').querySelector('a[href="https://updates.test/get"]'));
  check('it says the data is safe, because that is the actual worry',
    /nothing you have done is touched/i.test($4('upd-box').textContent),
    $4('upd-box').textContent.slice(-80));
  check('and it remembers, so a restart does not need the network',
    /99\.9\.9/.test(w4.localStorage.getItem('focus_update') || ''),
    (w4.localStorage.getItem('focus_update') || '').slice(0, 60));

  /* ---- and the same thing inside a shell that updates itself ----
     This is where "Get it always sends me to GitHub" came from. The desktop
     build downloads on its own, but the page could not tell whether the shell
     underneath was going to do anything, so it kept offering the manual link —
     and the manual link is the one people could see, so it is the one they
     used. An unpacked copy is the one case where the shell really will do
     nothing (electron-updater refuses to run), and it now says so. */
  for (const [state, wantsLink, label] of [
    ['auto', false, 'a shell that updates itself stops offering GitHub'],
    ['manual', true, 'while an unpacked copy still offers it, being the only way'],
  ]) {
    UPDATE_REPLY = { version: '99.9.9', notes: 'Newer.', url: 'https://updates.test/get' };
    /* The bridge `electron/preload.cjs` exposes, injected ahead of the app the
       same way the storage seed is — it has to be there before the page runs,
       because that is when the page decides what to draw. */
    const shell = wired.replace('<script>',
      '<script>window.focusUpdate={on:function(cb){cb({state:' + JSON.stringify(state)
      + '})},restart:function(){}};</script>\n<script>');
    const { window: wS } = boot(shell);
    await wait(500);
    const box = wS.document.getElementById('upd-box');
    check(label, !!box.querySelector('a[href="https://updates.test/get"]') === wantsLink,
      `${state}: ${box.textContent.slice(0, 70)}`);
    if (!wantsLink) {
      check('and says so rather than going quiet about it',
        /on its own|nothing to do/i.test(box.textContent), box.textContent.slice(0, 70));
    }
  }

  // the same host, saying nothing newer
  UPDATE_REPLY = { version: '0.0.1', notes: 'older', url: 'https://updates.test/get' };
  const { window: w5 } = boot(wired);
  await wait(500);
  const $5 = (id) => w5.document.getElementById(id);
  check('an older version on the host is not an update',
    !!$5('upd-check') && !/0\.0\.1/.test($5('upd-box').textContent),
    $5('upd-box').textContent.slice(0, 60));
  /* **Say what the check found, not just offer to check again.**

     This asserted the button still read "Check for updates" — the same words
     whether it had just looked and found nothing or had never looked at all.
     Pressing a button and watching it turn back into itself reads as a button
     that did not work, which is why people press it four times. It now says it
     looked and when, and the button still works for looking again. */
  check('and it says it looked and found nothing',
    /up to date/i.test($5('upd-box').textContent),
    $5('upd-box').textContent.slice(0, 70));
  check('and you can still look again by hand', !!$5('upd-check'));

  // and a host that cannot be reached at all
  UPDATE_REPLY = null;
  const { window: w6, errors: e6 } = boot(wired);
  await wait(500);
  const $6 = (id) => w6.document.getElementById(id);
  check('an unreachable host is not an error the person has to see',
    !!$6('upd-check') && e6.length === 0, e6.slice(0, 1).join(''));
}

/* ---- a session's work does not depend on a disk ---------------------------

   Every layer caught and discarded storage errors, so a store that had stopped
   accepting writes was indistinguishable from one that was working — until a
   board came back empty an hour later. Three puzzle bugs were chased before
   that was the answer, and none of them was a puzzle bug. Two rules now: a read
   that storage cannot answer falls back to what this session wrote, and a write
   that fails says so. */
{
  const A = window.__m.arcade;
  A.writeGame('probe_game', { hello: 'world', n: 7 });
  const stored = window.localStorage.getItem('probe_game');
  check('a save reaches storage', !!stored && JSON.parse(stored).n === 7, String(stored));
  window.localStorage.removeItem('probe_game');
  const back = await A.readGame('probe_game');
  check('and a read storage cannot answer falls back to this session',
    !!back && back.n === 7, JSON.stringify(back));
}
{
  /* A full store is a hiccup, not the end: `KV.pinch` throws out what can be
     rebuilt from its day and the write is tried again. */
  const KV = window.__m.kv;
  const keep = window.localStorage.getItem('arcade_sudoku');
  const d = { boards: {} };
  for (let i = 1; i <= 20; i++) d.boards[`2026-01-${String(i).padStart(2, '0')}|easy`] = { grid: [] };
  window.localStorage.setItem('arcade_sudoku', JSON.stringify(d));
  const freed = KV.pinch();
  const after = JSON.parse(window.localStorage.getItem('arcade_sudoku'));
  check('a full store frees room from the oldest boards',
    freed === true && Object.keys(after.boards).length === 12,
    Object.keys(after.boards).length + ' left');
  check('and the ones it keeps are the newest',
    !after.boards['2026-01-01|easy'] && !!after.boards['2026-01-20|easy'],
    Object.keys(after.boards).slice(0, 2).join(', '));
  check('storage reports what is in it',
    KV.report().total > 0 && Array.isArray(KV.report().rows));
  /* Put the real save back: the checks after this one play sudoku. */
  if (keep === null) window.localStorage.removeItem('arcade_sudoku');
  else window.localStorage.setItem('arcade_sudoku', keep);
}

/* ---- an account arriving must not leave a hole -----------------------------

   The one that took a video to find. `gamesAdopt` empties a game's in-memory
   save and trusts the next `enter()` to read the new one back in — but `enter()`
   is not the only thing that reads. A size or difficulty button goes straight to
   `load`/`_open`, and those take the letters and the clock out of the very map
   that had just been emptied. So the grid came back blank with the clock at
   zero, and the account had lost nothing at all: this object had.

   Rare while sync only ran on a daily mark. Then sync started running every five
   minutes and on every hide, and it became: play a minute, switch size, switch
   back, zero. It got worse the day the syncing got better, which is why it read
   as "still not fixed". */
{
  const C = window.__m.Cross, now = window.__m.pktNow();
  const shape = () => [C.size, C.elapsed, C.user.filter(Boolean).length].join('/');
  /* **The clock is running while this runs.** Comparing the two readings as
     strings made the test fail whenever a second happened to turn between them
     — 47 against 46, on a loaded machine, in a check about something else
     entirely. What is under test is that the letters and the clock came *back*
     after a size switch, so the size and the letters must match exactly, the
     clock may differ by a second or two, and a clock reset to zero still fails
     — which is the bug this was written for. */
  const same = (a, b) => {
    const [as, ae, al] = a.split('/').map(Number);
    const [bs, be, bl] = b.split('/').map(Number);
    return as === bs && al === bl && ae > 0 && Math.abs(ae - be) <= 2;
  };
  const size = (n) => [...window.document.getElementById('cw-size').children]
    .find((b) => +b.dataset.s === n).click();
  size(15);
  await wait(250);
  const e0 = C.puz.entries[0];
  C.select(e0.cells[0][0] * C.size + e0.cells[0][1]);
  ['T', 'H', 'E'].forEach((ch) => C.type(ch));
  C.elapsed = 46; C.persist();
  const was = shape();
  /* A sync landing: the merged save is stamped by another device, so `gamesAdopt`
     takes it and calls every `forget`. */
  const snap = window.__m.gamesSnapshot();
  snap['arcade_cross'].at = Date.now() + 5000;
  window.__m.gamesAdopt(snap);
  check('a sync leaves the open puzzle alone', same(shape(), was), shape() + ' vs ' + was);
  size(5);
  await wait(250);
  size(15);
  await wait(250);
  check('and switching size after one still hands back the clock and the letters',
    same(shape(), was), shape() + ' vs ' + was);
}
{
  const S = window.__m.Sudoku, now = window.__m.pktNow();
  S.newGame('hard', true, now);
  S.build();
  S.sel = S.given.indexOf(false); S.input(5); S.elapsed = 88; S.persist();
  const was = [S.diff, S.elapsed, S.grid.filter(Boolean).length].join('/');
  const snap = window.__m.gamesSnapshot();
  snap['arcade_sudoku'].at = Date.now() + 5000;
  window.__m.gamesAdopt(snap);
  S.newGame('easy'); S.newGame('hard');
  check('and a sudoku shelf survives a sync too',
    [S.diff, S.elapsed, S.grid.filter(Boolean).length].join('/') === was,
    [S.diff, S.elapsed, S.grid.filter(Boolean).length].join('/') + ' vs ' + was);
}

/* The window's own caption strip is zero-height anywhere that is not the
   packaged desktop app — that is the whole of how it knows where it is, so it
   is worth pinning. A regression here is a black band across the top of the
   phone build. */
{
  const bar = window.document.querySelector('.winbar');
  check('the desktop caption strip exists', !!bar);
  check('and takes no room in a browser',
    !!bar && bar.getBoundingClientRect().height === 0,
    bar ? String(bar.getBoundingClientRect().height) : '-');
  check('and pushes nothing down either',
    window.getComputedStyle(window.document.body).paddingTop === '0px',
    window.getComputedStyle(window.document.body).paddingTop);
}

/* ---- the crossword, hammered ---------------------------------------------

   "Every single instance of crossword crashes, it should work simply and test it
   before finalizing." Fair. So: every size, in every order, many times, with the
   records deliberately poisoned in the ways a save actually goes wrong — a
   `done` flag on a grid nobody solved, a fingerprint that is not in the bank any
   more, a record of the wrong length. After each switch the DOM has to match the
   puzzle and the puzzle has to match the button. */
{
  const C = window.__m.Cross, D = window.document;
  const btn = (n) => [...D.getElementById('cw-size').children].find((b) => +b.dataset.s === n);
  const grid = () => D.getElementById('cw-grid');
  const agree = () => C.puz && grid().children.length === C.puz.n * C.puz.n
    && C.size === C.puz.n && C.user.length === C.puz.n * C.puz.n;
  let bad = [];
  const sizes = [5, 7, 9, 15];
  for (let round = 0; round < 3; round++) {
    for (const n of [15, 5, 9, 7, 15, 9, 5, 15, 7]) {
      const b = btn(n);
      if (b.disabled) { bad.push(`${n} disabled`); continue; }
      b.click();
      await wait(60);
      if (C.size !== n) bad.push(`round ${round}: asked ${n}, got ${C.size}`);
      else if (!agree()) bad.push(`round ${round}: ${n} drew ${grid().children.length} of ${C.puz.n * C.puz.n}`);
    }
  }
  check('every size opens, in any order, every time', bad.length === 0, bad.slice(0, 4).join(' | '));
  check('and nothing threw on the way', !C.lastError, C.lastError);
}
{
  /* A `done` flag on a grid nobody solved. This is the one from the video: the
     board opens full of letters, refuses every key because `type()` stops when
     `done`, and `_firstUnfinished` skips that day forever — so the size will not
     open either. One bad flag, three symptoms, none of them alike. */
  const C = window.__m.Cross;
  const btn = (n) => [...window.document.getElementById('cw-size').children]
    .find((b) => +b.dataset.s === n);
  btn(5).click();
  await wait(120);
  const fp = C._fp(C.idx);
  C.progress[fp] = { u: '.'.repeat(C.user.length), secs: 10, done: true };
  C.idx = -1;
  btn(7).click(); await wait(120);
  btn(5).click(); await wait(120);
  check('a "finished" record with an empty grid is not believed',
    C.done === false, `done=${C.done}`);
  check('and the board takes letters again',
    (() => { const before = C.user.filter(Boolean).length;
      C.select(C.puz.entries[0].cells[0][0] * C.size + C.puz.entries[0].cells[0][1]);
      C.type('A');
      return C.user.filter(Boolean).length > before; })());
  /* And the honest case still reads as finished. */
  const sol = [];
  for (let i = 0; i < C.user.length; i++) sol.push(C._solAt(i) || '.');
  C.progress[C._fp(C.idx)] = { u: sol.join(''), secs: 10, done: true };
  const i2 = C.idx, d2 = C.day;
  C.idx = -1;
  C.load(i2, d2);
  check('a record that really did solve it keeps its flag', C.done === true, `done=${C.done}`);
  C.restart();
  check('and starting it again gives the grid back empty and unfinished',
    C.done === false && C.user.filter(Boolean).length === 0,
    `${C.done} / ${C.user.filter(Boolean).length}`);
}
{
  /* A saved position pointing at a puzzle the bank no longer has — ordinary, as
     the bank grows and is regenerated under a running app. */
  const C = window.__m.Cross;
  const btn = (n) => [...window.document.getElementById('cw-size').children]
    .find((b) => +b.dataset.s === n);
  C.seen = { 5: { k: 'not-a-real-fingerprint', day: '2026-01-01' },
             15: { k: 'nor-is-this', day: '2026-01-01' } };
  btn(15).click(); await wait(120);
  check('a saved position that is not in the bank still opens something',
    C.size === 15 && !!C.puz, `${C.size}/${!!C.puz}`);
  btn(5).click(); await wait(120);
  check('and so does the next one', C.size === 5 && !!C.puz, `${C.size}/${!!C.puz}`);
  C.seen = {};
}

/* ---- a crossword can always be solved by typing --------------------------

   The plainest thing this game has to do, and the one that kept not being true.
   `done` is a flag; a flag can be wrong; and when it was, the board refused
   every key with nothing on screen to say why. So: start from the worst case — a
   record insisting the puzzle is finished when the grid is empty — and type the
   whole thing in, one letter at a time, through the same `type()` a keyboard
   calls. */
{
  const C = window.__m.Cross;
  const btn = (n) => [...window.document.getElementById('cw-size').children]
    .find((b) => +b.dataset.s === n);
  for (const size of [5, 7]) {
    btn(size).click();
    await wait(120);
    /* Poison it: finished, according to the record, with nothing in the grid. */
    C.progress[C._fp(C.idx)] = { u: '.'.repeat(C.user.length), secs: 5, done: true };
    const i = C.idx, day = C.day;
    C.idx = -1;
    C.load(i, day);
    check(`a ${size}\u00d7${size} that claims to be finished still opens unfinished`,
      C.done === false, `done=${C.done}`);
    /* Now solve it the way a person does: pick a square, type a letter. */
    let typed = 0;
    for (let k = 0; k < C.user.length; k++) {
      const sol = C._solAt(k);
      if (!sol) continue;
      C.select(k);
      C.type(sol);
      typed++;
    }
    check(`and every one of its ${typed} squares took a letter`,
      C.user.filter((v, k) => C._solAt(k) && v === C._solAt(k)).length === typed,
      `${C.user.filter((v, k) => C._solAt(k) && v === C._solAt(k)).length} of ${typed}`);
    check(`and typing the last one finishes it`, C.done === true, `done=${C.done}`);
    check('and the banner says so',
      !window.document.getElementById('cw-banner').classList.contains('hide'));
    /* Changing a letter on a finished grid un-finishes it, rather than being
       ignored — the flag follows the squares, never the other way round. */
    const first = C.user.findIndex((v, k) => C._solAt(k));
    C.select(first);
    C.type(C.user[first] === 'Z' ? 'Q' : 'Z');
    check('and editing it afterwards is allowed, and un-finishes it',
      C.done === false && C.user[first] !== C._solAt(first),
      `done=${C.done} ${C.user[first]} vs ${C._solAt(first)}`);
    C.select(first);
    C.type(C._solAt(first));
    check('and putting it back finishes it again', C.done === true, `done=${C.done}`);
    /* Backspace is half of typing: a grid you cannot correct is not solvable. */
    C.select(first);
    C.back();
    check('and a finished grid can still be rubbed out',
      C.user[first] === '' && C.done === false,
      `"${C.user[first]}" done=${C.done}`);
    C.select(first);
    C.type(C._solAt(first));
  }
}

/* ---- a sync landing mid-keystroke ----------------------------------------

   The path is one keystroke long and was not obvious: type a letter,
   `persist()` marks the day, marking the day asks the account to sync, the sync
   adopts, and the adopt used to call `forget()` — which every game implements by
   throwing the open board away. So the first letter typed blanked the grid it
   was typed into, `render()` found no puzzle, and every key after that went
   nowhere. Reported, exactly, as "nothing works on the crossword after writing
   once". This is that sequence, run for real. */
{
  const C = window.__m.Cross, S = window.__m.Sudoku;
  const btn = (n) => [...window.document.getElementById('cw-size').children]
    .find((b) => +b.dataset.s === n);
  await openGame(window, $, 'crossword');
  btn(7).click();
  await wait(150);
  const e0 = C.puz.entries[0];
  C.select(e0.cells[0][0] * C.size + e0.cells[0][1]);
  C.type('A');
  /* Exactly what the keystroke sets off, made to happen now. */
  const snap = window.__m.gamesSnapshot();
  snap['arcade_cross'].at = Date.now() + 5000;
  snap['arcade_sudoku'].at = Date.now() + 5000;
  window.__m.gamesAdopt(snap);
  check('a sync mid-keystroke leaves the grid on screen', !!C.puz && C.idx >= 0,
    `puz=${!!C.puz} idx=${C.idx}`);
  check('and the letter that caused it is still there',
    C.user.filter(Boolean).length >= 1, `${C.user.filter(Boolean).length}`);
  /* And the board keeps working: more letters, and they reach the DOM. */
  let ok = true;
  for (const k of [1, 2, 3]) {
    const cell = C._cellsOf(C.puz.entries[0])[k];
    if (cell === undefined) continue;
    C.select(cell);
    C.type('B');
    if (C.user[cell] !== 'B') ok = false;
    const el = window.document.getElementById('cw-grid').children[cell];
    if (!el || !/B/.test(el.textContent)) ok = false;
  }
  check('and it still takes letters, and still draws them', ok,
    C.user.slice(0, 8).join('|'));
}
{
  /* The same hazard, in the game that has a shelf rather than one board. */
  const S = window.__m.Sudoku;
  await openGame(window, $, 'sudoku');
  S.sel = S.given.indexOf(false);
  S.input(5);
  const before = S.grid.filter(Boolean).length;
  const snap = window.__m.gamesSnapshot();
  snap['arcade_sudoku'].at = Date.now() + 6000;
  window.__m.gamesAdopt(snap);
  check('a sync does not empty the sudoku being played',
    S.grid.length === 81 && S.grid.filter(Boolean).length === before,
    `${S.grid.length} / ${S.grid.filter(Boolean).length} vs ${before}`);
  S.sel = S.given.indexOf(false, S.sel + 1);
  if (S.sel >= 0) S.input(6);
  check('and it still takes numbers afterwards',
    S.grid.filter(Boolean).length >= before, `${S.grid.filter(Boolean).length}`);
}

/* ---- time in the arcade ----
   **Playing, not having a board open.** The clock runs while a game is on
   screen and something has been pressed in the last two minutes; a board left
   open over lunch is not two hours of play, and a total that says it was is
   one nobody believes. Driven through the arcade's own way in and way out,
   with the window's clock held in the hand, because the thing under test is
   exactly which stretches of time count. */
{
  /* One finished block, so Your focus draws its full page rather than the
     empty one — the section has to be on the page people actually see. */
  const pDay = new Date(Date.now() - 3600 * 1000);
  const pKey = pDay.getFullYear() + '-' + String(pDay.getMonth() + 1).padStart(2, '0') + '-' + String(pDay.getDate()).padStart(2, '0');
  const { window: pw, errors: pErr } = boot(withDoor(html, 'window.__p = {Arcade, playTotals, Stats};'), {
    focus_log: JSON.stringify([{ id: 'p1', ts: pDay.getTime(), at: pDay.getTime(), day: pKey, secs: 1500, full: true }]),
  });
  await wait(500);
  const P = pw.__p;
  const realNow = pw.Date.now;
  let now = realNow.call(pw.Date);
  pw.Date.now = () => now;
  const MIN = 60 * 1000;
  const poke = () => pw.document.dispatchEvent(new pw.KeyboardEvent('keydown', { bubbles: true }));
  const secs = () => Math.round((P.playTotals().find((g) => g.id === 'g2048') || { secs: 0 }).secs);

  await P.Arcade.pick('g2048');
  now += MIN; poke();
  check('a minute on a board with keys going is a minute in the arcade', secs() === 60, secs() + 's');
  now += 10 * MIN;
  check('ten minutes with nothing pressed counts only the two before it stopped',
    secs() === 180, secs() + 's');
  poke(); now += 30 * 1000;
  check('and the next key starts it again, without counting the gap', secs() === 210, secs() + 's');
  P.Arcade.back();
  now += 5 * MIN;
  check('leaving the game stops the clock', secs() === 210, secs() + 's');

  P.Stats.open();
  await wait(60);
  const body = pw.document.getElementById('stats-body');
  const row = [...body.querySelectorAll('.stat-games .scomp')].find((r) => r.dataset.game === 'g2048');
  check('Your focus says so, under the name on the game’s card',
    !!body.querySelector('.stat-grid') && /In the arcade/.test(body.textContent) && !!row
    && row.querySelector('.scomp-name').textContent === '2048'
    && row.querySelector('b').textContent === '4 min',
    row ? row.textContent : body.textContent.slice(0, 120));
  check('and nothing went wrong keeping it', pErr.length === 0, pErr.slice(0, 2).join(' | '));
  pw.Date.now = realNow;
}

/* ---- app blocking ----
   The decisions are made natively and tested on the JVM
   (native/focus-guard/android/src/test). What is tested here is the page: that
   a config is cleaned into something those decisions can trust, that the lock
   holds on this side as well as that one, and that the way in exists at all.

   **The way in went missing once.** A partial revert took the menu row out of
   the drawer and left everything else, so the whole feature was unreachable on
   the one platform it is for, with nothing failing and nothing logged. The first
   two checks are about that. */
{
  check('the app blocking row is in the menu, and hidden without the Android plugin',
    !!$('d-block') && $('d-block').classList.contains('hide')
    && window.getComputedStyle($('d-block')).display === 'none',
    $('d-block') ? $('d-block').className : 'no row');

  /* A stand-in for the plugin that enforces the lock the way GuardRules.accept
     does, so the page's handling of a refused save is exercised for real. */
  const fake = `<script>
    window.__gcalls = [];
    window.Capacitor = {Plugins: {FocusGuard: (function(){
      let stored = null;
      const copy = (o) => JSON.parse(JSON.stringify(o));
      return {
        status: async () => ({notifications:true, overlay:false, accessibility:true, admin:false, gray:false}),
        listApps: async () => ({apps:[{id:'x.insta', name:'Instagram', icon:''}, {id:'x.tok', name:'TikTok', icon:''}]}),
        setConfig: async (c) => {
          window.__gcalls.push(['setConfig', copy(c)]);
          const locked = stored && stored.on && stored.lock && stored.lock.on;
          if(!locked){ stored = copy(c); return copy(stored); }
          const kept = copy(stored);
          if(!c.pending) kept.pending = null;
          else if(Number(c.pending.at) >= Date.now() + stored.lock.delay * 60000 - 60000) kept.pending = c.pending;
          stored = kept;
          return copy(stored);
        },
        getStats: async () => ({usage:{}, day:''}),
        setTimer: async () => {}, showNotice: async () => {}, hideNotice: async () => {},
        takeCommand: async () => ({cmd:''}), requestNotifications: async () => ({granted:true}),
        openSettings: async () => {}, requestAdmin: async () => {}, releaseAdmin: async () => {},
        setTasks: async (t) => { window.__gcalls.push(['setTasks', copy(t)]); },
        addListener: () => ({remove(){}}),
      };
    })()}};
  </script>
`;
  const v1 = JSON.stringify({on:true, when:'session', apps:['x.insta', 'x.tok'], pause:12, allow:7, opens:0});
  const gHtml = withDoor(html.replace('<script>', fake + '<script>'),
    'window.__g = {Guard, guardClean, guardSite, guardChange, guardPromote, guardStreak, guardWeek,'
    + ' guardOpen, guardOpenRule, guardLocked, saveTasks, tasks: () => TASKS};');
  const { window: gw, errors: gErr } = boot(gHtml, { focus_guard: v1 });
  await wait(700);
  const G = gw.__g;
  const $g = (id) => gw.document.getElementById(id);
  const calls = (name) => gw.__gcalls.filter((c) => c[0] === name).map((c) => c[1]);

  check('and shown on a build that has it', !!$g('d-block') && !$g('d-block').classList.contains('hide'),
    $g('d-block') ? $g('d-block').className : 'no row');

  /* **The first version had one set of settings for every app**, and updating
     must change nothing about what is blocked. Its zero opens meant no way
     through at all. */
  {
    const r = G.Guard.cfg.rules[0] || {};
    check('an old single config becomes one rule with the same apps and numbers',
      G.Guard.cfg.rules.length === 1 && r.apps.join(',') === 'x.insta,x.tok'
      && r.when === 'session' && r.pause === 12 && r.open.join(',') === '7',
      JSON.stringify(r));
    check('and its zero opens is still no way through', r.hard === true, String(r.hard));
    const three = G.guardClean({on:true, apps:['x.insta'], opens:3});
    check('while a number of opens is still a limit that closes the way',
      three.rules[0].opens === 3 && three.rules[0].after === 'block' && !three.rules[0].hard,
      JSON.stringify(three.rules[0]));
  }

  {
    const c = G.guardClean({on:true, rules:[
      {id:'a', apps:['x.insta', 'bad pkg!', 'x.insta'], sites:['https://www.Reddit.com/r/all', 'youtube', ''],
       when:'nonsense', pause:9999, open:[0, 500, 5, 5], odds:0, days:'9x1175'},
      {id:'a', apps:['x.tok']},
    ]});
    const r = c.rules[0];
    check('a config is cleaned before anything trusts it',
      c.rules.length === 1 && r.apps.join(',') === 'x.insta' && r.sites.join(',') === 'reddit.com'
      && r.when === 'focus' && r.pause === 120 && r.open.join(',') === '1,5,120' && r.odds === 1
      // 7 is not a weekday: they run 0 (Sunday) to 6
      && r.days === '15', JSON.stringify(c));
    check('and a site is reduced the way the phone reduces an address bar',
      G.guardSite('https://m.YouTube.com/watch?v=1') === 'm.youtube.com' && G.guardSite('youtube') === ''
      && G.guardSite('www.bbc.co.uk:443/news') === 'bbc.co.uk',
      [G.guardSite('https://m.YouTube.com/watch?v=1'), G.guardSite('youtube'), G.guardSite('www.bbc.co.uk:443/news')].join(' | '));
  }

  /* The page, through its own buttons. */
  G.guardOpen();
  await wait(200);
  check('a missing permission is said out loud, not left to three grey ticks',
    /Nothing is being blocked yet/.test($g('block-body').textContent), $g('block-body').textContent.slice(0, 140));
  check('grayscale explains the one-time grant rather than offering a switch that cannot work',
    /pm grant app\.focussimulator\.mobile android\.permission\.WRITE_SECURE_SETTINGS/.test($g('block-body').textContent),
    ($g('block-body').querySelector('.blk-code') || {}).textContent);
  const before = calls('setConfig').length;
  $g('blk-add').click();
  await wait(200);
  check('adding a rule opens it and sends it to the phone',
    !$g('block-rule-overlay').classList.contains('hide') && G.Guard.cfg.rules.length === 2
    && calls('setConfig').length > before && calls('setConfig').pop().rules.length === 2,
    G.Guard.cfg.rules.length + ' rules');
  $g('block-rule-body').querySelector('[data-rstep="pause"][data-by="1"]').click();
  await wait(100);
  check('and a stepper in it changes that rule and only that rule',
    G.Guard.cfg.rules[1].pause === 15 && G.Guard.cfg.rules[0].pause === 12,
    G.Guard.cfg.rules.map((r) => r.pause).join(','));
  $g('block-rule-close').click();
  await wait(100);

  /* **The lock.** Every change waits; the phone refuses a save that tries to
     skip the wait; and the page believes the phone. */
  G.guardChange((c) => { c.lock.on = true; c.lock.delay = 10; });
  await wait(150);
  check('locking happens at once', G.guardLocked(G.Guard.cfg), JSON.stringify(G.Guard.cfg.lock));
  G.guardChange((c) => { c.rules[0].pause = 3; });
  await wait(150);
  const pend = G.Guard.cfg.pending;
  check('while locked, a change waits out the delay instead of happening',
    G.Guard.cfg.rules[0].pause === 12 && !!pend && pend.cfg.rules[0].pause === 3
    && Number(pend.at) - Date.now() > 9 * 60000,
    JSON.stringify({applied:G.Guard.cfg.rules[0].pause, pend:pend && pend.cfg.rules[0].pause}));
  G.guardChange((c) => { c.rules[0].pause = 12; });
  await wait(150);
  check('and changing it back cancels the wait', !G.Guard.cfg.pending, JSON.stringify(G.Guard.cfg.pending));
  G.Guard.cfg.rules[0].pause = 3;
  await G.Guard.push();
  await wait(100);
  check('a save that skips the wait is refused by the phone, and the page believes the phone',
    G.Guard.cfg.rules[0].pause === 12, String(G.Guard.cfg.rules[0].pause));
  G.guardChange((c) => { c.lock.on = false; });
  await wait(150);
  /* Guarded rather than assumed: if the lock is broken there is no waiting
     change here, and a throw would take every check after it down too. */
  if(G.Guard.cfg.pending) G.Guard.cfg.pending.at = String(Date.now() - 1);
  check('a change whose time has come is applied', !!G.guardPromote() && !G.guardLocked(G.Guard.cfg),
    JSON.stringify(G.Guard.cfg.lock));

  /* The shield offers open tasks as something to do instead; it cannot ask the
     page, so they go down whenever the list is saved. */
  G.tasks().push({id:'t1', text:'Reply to Sam', done:false}, {id:'t2', text:'Already done', done:true});
  G.saveTasks();
  await wait(80);
  const sent = (calls('setTasks').pop() || {tasks:[]}).tasks;
  check('saving the task list sends the open ones to the phone, and only those',
    sent.length === 1 && sent[0].text === 'Reply to Sam', JSON.stringify(sent));

  /* What has happened, from a stand-in history. */
  {
    const cfg = G.guardClean({on:true, rules:[{id:'s', apps:['x.insta'], opens:3, minutes:30}]});
    const usage = {
      '2026-09-12': {'x.insta': {through:1, secs:600}},
      '2026-09-13': {'x.insta': {through:5, secs:600}},
      '2026-09-14': {'x.insta': {through:2, secs:1200}},
      '2026-09-15': {'x.insta': {through:3, secs:1700}},
    };
    check('the streak counts back from today through days inside every limit, and stops at the first that was not',
      G.guardStreak(usage, '2026-09-15', cfg) === 2, String(G.guardStreak(usage, '2026-09-15', cfg)));
    const week = G.guardWeek(usage, '2026-09-15', cfg);
    check('and the week is seven days, oldest first, in everything the rules cover',
      week.length === 7 && week[6].key === '2026-09-15' && week[6].secs === 1700 && week[0].key === '2026-09-09',
      JSON.stringify(week.map((d) => d.key + ':' + d.secs)));
  }
  check('and the blocking pages ran without an error', gErr.length === 0, gErr.slice(0, 2).join(' | '));
}

/* ---- picross, and the developer page ----
   Both in one extra window, because the developer page is only wired on a build
   carrying the stamp and picross is the easiest thing to point it at.

   The bank's real guarantee — that every puzzle can be solved by reasoning
   alone and has exactly one answer — is proved by the solver in
   tools/make-picross.mjs before a design is allowed in, and re-proved by
   `node tools/make-picross.mjs --check`. What is checked here is that the app
   reads that bank correctly: the right puzzle on the right day, clues worked
   out from the picture, and a finished picture recorded as finished. */
{
  /* The developer build is a stamp *and* a key: see devAttrs in tools/build.mjs.
     The suite makes one of its own rather than reading the real .env.local,
     which is on one machine and not in the repository. */
  const DEV_KEY = 'a-key-for-the-suite';
  const DEV_KEY_HASH = createHash('sha256').update(DEV_KEY, 'utf8').digest('hex');
  /* **Any stamp the local build already carries comes off first.** On the
     developer's own machine dist/index.html is built from their .env.local and
     may name their account; leaving that attribute in place would mean the
     suite testing their lock instead of its own, and failing on one machine
     only — the worst kind of red. */
  const devHtml = withDoor(html.replace(/<html([^>]*)>/,
    (m, attrs) => '<html' + attrs.replace(/\s*data-dev(-[a-z]+)?="[^"]*"/g, '') + '>')
    .replace('<html',
    '<html data-dev="1" data-dev-key="' + DEV_KEY_HASH + '"'),
    'window.__x = {Picross, picOnDay, picClue, picGrid, PIC_BANK, PIC_DIFFS, PIC_EPOCH,'
    + ' Arcade, dailyGet, dailyDef, dailyShift, pktNow, pktNum, pktAt, DAILY_DONE, PIC_SIZE, PIC_TITLES,'
    + ' Embers, LOG, logProgress, logClose, devHash, devUnlocked,'
    + ' EMB_LIGHTS, EMB_SOUNDS, FACES, EMB_SND, EMB_FACE, BUD_COST, budItemId};');
  const { window: xw, errors: xErr } = boot(devHtml);
  await wait(600);
  const X = xw.__x;
  const $x = (id) => xw.document.getElementById(id);

  /* **Thirty of each, and every string the size it says it is.** A puzzle one
     character short would fold into a different picture than the one the solver
     approved, and nothing else would notice. */
  {
    /* **The three sizes stay level with each other.** The count is allowed to
       grow — a bank is appended to, and a day takes one of each — but a size
       that has fallen behind would run out first and start showing encores
       while the others were still on new puzzles. So the number is read from
       the bank rather than written here, and what is insisted on is that all
       three agree and none has shrunk below the thirty it shipped with. */
    /* The sizes come from the game, not from a list written here: they have
       changed once already — 5, 10 and 15 became 10, 15 and 20 — and a suite
       that keeps its own copy of them checks the bank it remembers rather than
       the bank that shipped. */
    const bankSizes = X.PIC_DIFFS.map((d) => X.PIC_SIZE[d]);
    const counts = bankSizes.map((n) => (X.PIC_BANK[n] || []).length);
    const want = Math.max(...counts);
    const sizes = bankSizes.map((n) => [n, want]);
    const wrong = [];
    if (want < 30) wrong.push('the bank has shrunk to ' + want);
    for (const [n, _] of sizes) {
      const list = X.PIC_BANK[n] || [];
      if (list.length !== want) wrong.push(n + 'x' + n + ' has ' + list.length + ' of ' + want);
      for (const flat of list) {
        if (flat.length !== n * n) { wrong.push(n + 'x' + n + ' has a puzzle of ' + flat.length); break; }
        if (/[^01]/.test(flat)) { wrong.push(n + 'x' + n + ' has a puzzle with something other than 0 and 1'); break; }
      }
    }
    check('the picross bank is level across its three sizes, every puzzle the right shape',
      wrong.length === 0, wrong.join('; ') || 'ok');
  }

  /* The day decides the puzzle, counting from the day picross shipped. */
  {
    const before = X.pktAt(X.pktNum(X.PIC_EPOCH) - 1);
    const first = X.PIC_EPOCH;
    const later = X.pktAt(X.pktNum(X.PIC_EPOCH) + 7);
    /* A day past the end of the bank, counted from the bank rather than from a
       number written here: the lists are appended to, and a hard-coded 30 made
       this check quietly measure the wrong day the moment they grew. */
    const wrapped = X.pktAt(X.pktNum(X.PIC_EPOCH) + X.PIC_BANK[X.PIC_SIZE.easy].length);
    /* The epoch is relative to itself in the checks below, so it is pinned
       here too: put back to the crossword's and the game would claim a month of
       puzzles from before it existed, every one of them a missed day in a
       streak nobody could have kept. */
    check('picross starts on the day its bank was made, not before',
      X.pktNum(X.PIC_EPOCH) >= X.pktNum('2026-09-19'), X.PIC_EPOCH);
    check('nothing was published before picross existed',
      X.picOnDay('easy', before).i === -1, JSON.stringify(X.picOnDay('easy', before)));
    check('and each day after it is the next puzzle in the bank',
      X.picOnDay('easy', first).i === 0 && X.picOnDay('easy', later).i === 7
      && !X.picOnDay('easy', later).encore,
      [X.picOnDay('easy', first).i, X.picOnDay('easy', later).i].join(','));
    /* **Every day from here on has a puzzle, at every size.** The bank is
       finite and the schedule is not: a day past the end wraps to the start and
       is marked as an encore rather than left empty, so there is no date — this
       year or in ten — that opens picross to nothing. */
    {
      const epoch = X.pktNum(X.PIC_EPOCH);
      const gaps = [];
      for (const ahead of [0, 1, 239, 240, 241, 500, 1000, 3650]) {
        const day = X.pktAt(epoch + ahead);
        for (const d of X.PIC_DIFFS) {
          if (X.picOnDay(d, day).i < 0) gaps.push(d + ' on day ' + ahead);
        }
      }
      check('every day from the epoch onwards has a puzzle at each size',
        gaps.length === 0, gaps.join(', ') || 'no empty days');
    }
    check('and once the bank runs out it goes round, and says so',
      X.picOnDay('easy', wrapped).i === 0 && X.picOnDay('easy', wrapped).encore === true,
      JSON.stringify(X.picOnDay('easy', wrapped)));
  }

  /* Clues are read off the picture rather than stored beside it. */
  check('a clue is the runs in its line, and an empty line asks for nothing',
    X.picClue([1, 1, 0, 1, 1]).join(',') === '2,2' && X.picClue([0, 0, 0]).join(',') === '0'
    && X.picClue([1, 1, 1]).join(',') === '3',
    [X.picClue([1, 1, 0, 1, 1]), X.picClue([0, 0, 0])].join(' | '));

  /* And the game itself, through the arcade. */
  $x('arcade-open').click();
  await wait(120);
  await X.Arcade.pick('picross');
  await wait(250);
  const P = X.Picross;

  /* **Nothing answers to a name twice.** Picross shipped using the same `pic-`
     ids pictionary already had, and `getElementById` hands back the first one
     in the page: its size chooser was being drawn inside pictionary's hidden
     toolbar, its Fill button wired to pictionary's paint bucket, and its win
     banner set on a banner nobody could see. Every test passed, because the
     tests looked the element up the same wrong way the game did. A collision
     anywhere is worth failing over, so this counts the whole page. */
  {
    const tally = new Map();
    xw.document.querySelectorAll('[id]').forEach((el) => tally.set(el.id, (tally.get(el.id) || 0) + 1));
    const twice = [...tally].filter(([, n]) => n > 1).map(([k, n]) => k + ' ×' + n);
    check('no two elements in the app answer to the same id',
      twice.length === 0, twice.join(', ') || tally.size + ' ids, all different');
  }
  /* **A button does not paint its label in its own background.** The shared
     rule gives `.mini-btn.on` the accent behind and dark text on it; picross
     added an override that set the *text* to the accent as well, so the chosen
     mode — "Fill", the one you start in — was accent on accent and could not be
     read. Any override of that class doing the same thing is the same bug. */
  {
    /* **The stylesheet only, not the page.** `[^{}]*` backtracks across every
       stretch with no braces in it, and the picross bank is one: 369,000
       characters of 0s and 1s between its opening and closing brace. Over the
       whole bundle this one regex ran for more than ten minutes at full CPU and
       looked exactly like a hung test. */
    const flat = (html.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []).join(' ').replace(/\s*\n\s*/g, ' ');
    const bad = [...flat.matchAll(/([^{}]*\.mini-btn\.on)\s*\{([^}]*)\}/g)]
      .filter(([, sel, body]) => /color\s*:\s*var\(--accent\)/.test(body.replace(/(border|background)-color/g, ''))
        && !/background/.test(body))
      .map(([, sel]) => sel.trim());
    check('no button paints its label in the colour it was given to sit on',
      bad.length === 0, bad.join(' | ') || 'none');
  }
  /* And the other half of that: picross's own controls are on picross's screen,
     not merely present somewhere in the page. */
  check('and picross\'s controls are on picross\'s screen',
    ['pix-sizes', 'pix-grid', 'pix-banner', 'pix-meta', 'pix-clear', 'pix-fill', 'pix-mark']
      .every((id) => $x(id) && $x(id).closest('#game-picross')),
    ['pix-sizes', 'pix-grid', 'pix-banner', 'pix-meta', 'pix-clear', 'pix-fill', 'pix-mark']
      .filter((id) => !($x(id) && $x(id).closest('#game-picross'))).join(', ') || 'all seven');

  check('the picross card opens a grid of its own size, with a clue for every line',
    $x('pix-grid').querySelectorAll('.pix-cell').length === P.size * P.size
    && $x('pix-grid').querySelectorAll('.pix-rc').length === P.size
    && $x('pix-grid').querySelectorAll('.pix-cc').length === P.size,
    P.size + ' / ' + $x('pix-grid').querySelectorAll('.pix-cell').length);

  /* ---- the clue numbers cross themselves off ----
     Dimming only when the whole line was right left a fifteen-number row fully
     lit with fourteen of its runs settled, which is exactly when the counting
     is hardest. Runs are matched to numbers from both ends, and the board is
     re-read on every change so a number lights again when its run stops
     matching. The rules below are the ones that were wrong first time. */
  {
    const settled = (line, clue) => P._settled(line, clue).map((v) => (v ? 'x' : '-')).join('');
    check('a clue number crosses off when its own run is settled',
      settled([1, 1, 1, 0, 1, 1, 0, 0], [3, 2]) === 'xx'
      && settled([0, 0, 0, 0, 1, 1, 0, 1], [2, 1]) === 'xx',
      settled([1, 1, 1, 0, 1, 1, 0, 0], [3, 2]));
    /* One run may only settle one number: matching from both ends without that
       let a single five cross off both halves of "5 5", so the second was
       struck through before the player had touched it. */
    check('but one run cannot cross off two numbers',
      settled([1, 1, 1, 1, 1, 0, 0, 0, 0, 0], [5, 5]) === 'x-',
      settled([1, 1, 1, 1, 1, 0, 0, 0, 0, 0], [5, 5]));
    check('and a broken line lights up again',
      settled([1, 1, 1, 0, 1, 1, 0, 1], [3, 2]) === '--'
      && settled([0, 0, 0, 0], [0]) === '-',
      settled([1, 1, 1, 0, 1, 1, 0, 1], [3, 2]));
    /* And the board actually paints it, not just the arithmetic. */
    {
      let row = -1;
      for (let y = 0; y < P.size; y++) if (P.rows[y].length >= 2) { row = y; break; }
      if (row >= 0) {
        let x = 0;
        while (P.sol[row][x] !== 1) x++;
        for (let k = 0; k < P.rows[row][0]; k++) P._put(row * P.size + x + k, 1);
        P._paintClues();
        const el = $x('pix-grid').querySelector('[data-rc="' + row + '"]');
        const marks = [...el.querySelectorAll('i')].map((i) => i.classList.contains('done'));
        check('the first run alone crosses off the first number on the screen',
          marks[0] === true && marks.slice(1).every((v) => v === false),
          marks.map((v) => (v ? 'x' : '-')).join(''));
        for (let k = 0; k < P.rows[row][0]; k++) P._put(row * P.size + x + k, 0);
        P._paintClues();
      }
    }
  }

  /* ---- a drag does not paint over the other kind of mark ----
     It painted whatever it crossed: a fill stroke through a column of crosses
     wiped the notes, a stroke of crosses across a filled row emptied it. A
     stroke that puts something down lands only on blank squares; a stroke that
     takes something away takes only what it started on. jsdom has no layout,
     so `elementFromPoint` is pointed at the square the finger is "over". */
  {
    const n = P.size;
    const grid = $x('pix-grid');
    const cellsEl = grid.querySelector('.pix-cells');
    const sq = (i) => grid.querySelector('[data-i="' + i + '"]');
    const ev = (type) => new xw.MouseEvent(type, { bubbles: true, cancelable: true });
    const realFrom = xw.document.elementFromPoint;
    const stroke = (mode, path) => {
      P.setMode(mode);
      sq(path[0]).dispatchEvent(ev('pointerdown'));
      for (const i of path.slice(1)) {
        xw.document.elementFromPoint = () => sq(i);
        cellsEl.dispatchEvent(ev('pointermove'));
      }
    };
    const lift = () => cellsEl.dispatchEvent(ev('pointerup'));
    const set = (vals) => vals.forEach((v, k) => P._put(k, v));
    const got = () => [0, 1, 2].map((k) => P.cells[k]).join('');

    set([0, 2, 0]);
    stroke(1, [0, 1, 2]); lift();
    check('a fill stroke goes round a crossed-off square instead of over it', got() === '121', got());

    set([0, 1, 0]);
    stroke(2, [0, 1, 2]); lift();
    check('a stroke of crosses leaves a filled square alone', got() === '212', got());

    set([1, 2, 1]);
    stroke(1, [0, 1, 2]); lift();
    check('and rubbing out fills does not rub out the crosses in between', got() === '020', got());

    /* ---- where you are, across and down ----
       Under a finger the square itself is hidden and its clues are far away;
       the row and column through it light up, out to both clue boxes. */
    set([0, 0, 0]);
    const at = n + 2;                          // row 1, column 2
    stroke(1, [0, at]);
    const row = grid.querySelector('.pix-aim-row'), col = grid.querySelector('.pix-aim-col');
    const rcAim = grid.querySelector('[data-rc="1"]').classList.contains('aim');
    const ccAim = grid.querySelector('[data-cc="2"]').classList.contains('aim');
    const lit = grid.querySelectorAll('.pix-rc.aim, .pix-cc.aim').length;
    check('the row and column under the finger are marked, clue boxes and all',
      !!row && !!col && !row.hidden && !col.hidden && rcAim && ccAim && lit === 2,
      [row && !row.hidden, col && !col.hidden, rcAim, ccAim, lit].join(','));
    check('and the bands sit on that row and that column',
      row.style.top === (100 / n) + '%' && col.style.left === (2 * 100 / n) + '%',
      row.style.top + ' / ' + col.style.left);
    lift();
    check('and go when a finger lifts',
      row.hidden && col.hidden && grid.querySelectorAll('.aim').length === 0,
      [row.hidden, col.hidden, grid.querySelectorAll('.aim').length].join(','));
    xw.document.elementFromPoint = realFrom;
    set([0, 0, 0]);
    P.setMode(1);
    for (let k = 0; k < n * n; k++) if (P.cells[k] !== 0) P._put(k, 0);
  }

  /* ---- being told where you went wrong, and being told one square ----
     A picross board gives no feedback of its own: a square filled in error sits
     there looking exactly like a right one until the clues stop adding up
     twenty squares later. Check says how many are wrong without saying which
     are missing, and Fix a square puts one right — taking back a wrong square
     before giving away a right one, because a wrong square is usually what the
     person is stuck on. */
  {
    const n = P.size;
    let blank = -1;
    for (let y = 0; y < n && blank < 0; y++) {
      for (let x = 0; x < n; x++) if (P.sol[y][x] === 0) { blank = y * n + x; break; }
    }
    P._put(blank, 1);                       // a square the picture does not have
    const found = P.check();
    await wait(60);
    check('check counts the squares that are wrong',
      found === 1 && !!P.wrong && P.wrong.has(blank), found + ' wrong');
    check('and marks them on the board',
      $x('pix-grid').querySelector('[data-i="' + blank + '"]').classList.contains('bad'),
      $x('pix-grid').querySelector('[data-i="' + blank + '"]').className);

    const was = P.hints;
    P.reveal();
    await wait(60);
    check('fixing a square takes back a wrong one before giving one away',
      P.cells[blank] === 0 && P.hints === was + 1, 'cell ' + P.cells[blank] + ', hints ' + P.hints);
    check('and clears the check marks, which are about a board that has changed',
      P.wrong === null, String(P.wrong));

    P.reveal();
    await wait(60);
    const right = P._progress();
    check('with nothing wrong left, it fills a square the picture does have',
      P.hints === was + 2 && right.c >= 1, 'hints ' + P.hints + ', right ' + right.c);

    /* **And the archive says where the board stands.** "Started" is the same
       word for two squares in and two from the end. */
    P.persist();
    const rec = X.dailyGet('picross', P.diff, P.day);
    const line = X.dailyDef('picross').line(rec);
    check('the calendar shows how far in the day got, and what was revealed',
      /\d+ of \d+ squares/.test(line) && /revealed/.test(line), line);
  }

  /* Filling in the picture finishes it — and only the filled squares matter,
     which is what "crossing off is a note to yourself" has to mean. */
  {
    const n = P.size;
    P._put(0, 2);                       // a cross in a square that stays empty
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) if (P.sol[y][x] === 1) P._put(y * n + x, 1);
    }
    P._check();
    await wait(80);
    const rec = X.dailyGet('picross', P.diff, P.day);
    check('filling in the picture finishes it, whatever is pencilled around it',
      P.done === true && !!rec && rec.s === X.DAILY_DONE,
      P.done + ' / ' + JSON.stringify(rec));
    check('and the banner says so',
      !$x('pix-banner').classList.contains('hide'), $x('pix-banner').className);
    /* **Then it is a picture, not a worksheet**: no grid lines, no crosses.
       Both are read off the stylesheet. jsdom does not expand the `border`
       shorthand, so a square's computed border style is "none" with or
       without the rule — a check built on it passed with the class removed. */
    {
      const grid = $x('pix-grid');
      const flat = (html.match(/<style[^>]*>[\s\S]*?<\/style>/g) || []).join(' ').replace(/\s*\n\s*/g, ' ');
      check('a finished picross drops its grid lines',
        grid.classList.contains('solved')
          && /\.pix-wrap\.solved \.pix-cell\s*\{[^}]*border-style:\s*none/.test(flat),
        grid.className);
      check('and its crosses',
        /\.pix-wrap\.solved \.pix-cell\.off::after\s*\{\s*display:\s*none/.test(flat),
        'no rule hiding them');
    }
    /* **And now it can be named.** The name is the answer while the grid is
       unsolved, so it is kept out of the bank's reach until this moment — and
       withheld after it, "there it is" leaves you looking at a shape. */
    {
      const what = (X.PIC_TITLES[P.size] || [])[P.idx] || '';
      check('the finish screen says what the picture was',
        !!what && $x('pix-win-sub').textContent.toLowerCase().includes(what.toLowerCase()),
        what + ' / ' + $x('pix-win-sub').textContent);
      check('and counts anything that was revealed',
        !P.hints || /revealed/.test($x('pix-win-sub').textContent),
        P.hints + ' revealed / ' + $x('pix-win-sub').textContent);
    }
  }

  /* **The archive is reachable without finishing today's.** Picross registered
     with the daily system from the start — records, streaks, per-day stats —
     but the only door to the calendar was the win banner, so every other day
     was behind today's puzzle. The crossword has carried a History button on
     its screen all along; this is the same button in the same place. */
  {
    const cal = () => $x('dcal') || $x('dcal-overlay');
    $x('pix-close')?.click();
    check('picross offers its archive on the screen, not only after a win',
      !!$x('pix-list') && !$x('pix-list').classList.contains('hide'),
      $x('pix-list') ? $x('pix-list').textContent : 'no button');
    $x('pix-list').click();
    await wait(150);
    check('and the button opens the calendar',
      !!cal() && !cal().classList.contains('hide'),
      cal() ? cal().className : 'no calendar');
    /* **Finished, a row is called what the picture was.** "Small" is all it
       can say before, because the name is the answer; afterwards it is the
       one thing about the day worth reading back. The unfinished sizes keep
       their edition names. */
    {
      const rows = [...$x('dcal-day').querySelectorAll('.dcal-row')];
      const at = X.PIC_DIFFS.indexOf(P.diff);
      const raw = (X.PIC_TITLES[P.size] || [])[P.idx] || '';
      const named = rows[at] ? rows[at].querySelector('b').textContent : '';
      check('a finished picross is listed in the history by its picture\'s name',
        !!raw && named.toLowerCase() === raw.toLowerCase(), named + ' / ' + raw);
      const others = rows.filter((_, k) => k !== at).map((r) => r.querySelector('b').textContent);
      check('and one not yet finished keeps its size name',
        others.length > 0 && others.every((t) => ['Small', 'Middling', 'Big'].includes(t)),
        others.join(', '));
    }
    ($x('dcal-close') || { click() {} }).click();
    await wait(80);
  }

  /* **Square squares.** The first version sized the rows with the same
     percentage as the columns, and a percentage on a grid row resolves against
     the container's height — every cell came out a slightly wrong rectangle,
     which jsdom cannot see and the eye can. */
  check('a picross square is square by ratio, not by a length used twice',
    /\.pix-cell\{[^}]*aspect-ratio:\s*1/.test(html.replace(/\s*\n\s*/g, '')),
    (html.match(/\.pix-cell\{[^}]*\}/) || ['no rule'])[0].slice(0, 90));

  /* ---- the developer page ---- */
  /* **And no way it reaches anybody else.** The stamp comes from `.env.local`,
     which is in .gitignore, and every path that builds something to hand out
     turns it off: ship-release.ps1 sets FOCUS_RELEASE, and the publish scripts
     build with --release. A new publish script that forgot would be the way
     this quietly ships, so the scripts are checked rather than trusted. */
  {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const leaky = Object.keys(pkg.scripts).filter((k) => /^publish:(win|mac|linux)$/.test(k)
      && !/npm run build:release/.test(pkg.scripts[k]));
    const src = readFileSync(join(root, 'tools', 'build.mjs'), 'utf8');
    check('nothing that builds a release can carry the developer stamp',
      leaky.length === 0 && /FOCUS_RELEASE/.test(src) && /--release/.test(src)
      && /\.env\.local/.test(src),
      leaky.join(', ') || 'guarded');
    const ship = readFileSync(join(root, 'tools', 'ship-release.ps1'), 'utf8');
    check('and the release script says so out loud before it builds',
      /FOCUS_RELEASE = '1'/.test(ship), 'ship-release.ps1');
  }

  check('the developer row is there on a stamped build',
    !!$x('d-dev') && !$x('d-dev').classList.contains('hide'),
    $x('d-dev') ? $x('d-dev').className : 'no row');
  $x('d-dev').click();
  await wait(150);

  /* **A stamp says where the build came from, not who is holding it.** A debug
     APK, a copied folder or a lent phone all carry it, so the page itself is
     locked: a key, hashed into the build, typed once on each device. Until it
     is right there are no tools on the page and no `devFill` to call. */
  check('but the page is shut until the key is given',
    /Locked/.test($x('dev-body').textContent) && !/Version/.test($x('dev-body').textContent)
    && typeof xw.devFill === 'undefined',
    $x('dev-body').textContent.slice(0, 60));
  {
    /* Defensive on purpose: with the lock broken there is no field to type in,
       and the checks below have to go *red* rather than throw and take the rest
       of the suite with them. A crash is a failure nobody can read. */
    const put = (v) => {
      const field = $x('dev-key'), form = $x('dev-keyform');
      if(!field || !form) return false;
      field.value = v;
      form.dispatchEvent(new xw.Event('submit', { bubbles: true, cancelable: true }));
      return true;
    };
    const asked = put('not the key');
    await wait(120);
    check('and a wrong one gets nowhere',
      asked && !/Version/.test($x('dev-body').textContent) && typeof xw.devFill === 'undefined',
      asked ? $x('dev-body').textContent.slice(0, 40) : 'it never asked');
    put(DEV_KEY);
    await wait(150);
    check('the right one opens it, and is remembered on this device alone',
      /Version/.test($x('dev-body').textContent) && X.devUnlocked()
      && xw.localStorage.getItem('focus_dev_unlock') === DEV_KEY_HASH,
      typeof xw.devFill);
  }
  /* The app hashes the key itself, because crypto.subtle does not exist on
     Electron's file:// pages. Two implementations of SHA-256 that disagree
     would lock the developer out of their own build, so they are compared. */
  check('and the app hashes exactly as the build tool does',
    ['', 'abc', 'a'.repeat(56), DEV_KEY, 'ünicode ✓'].every((s) =>
      X.devHash(s) === createHash('sha256').update(s, 'utf8').digest('hex')),
    X.devHash('abc').slice(0, 16));

  check('and opens a page that says what this build is',
    !$x('dev-overlay').classList.contains('hide') && /Version/.test($x('dev-body').textContent),
    $x('dev-body').textContent.slice(0, 80));
  {
    /* The one tool that cannot be had any other way: a daily puzzle is a day
       away, and a streak is a fortnight. */
    const was = X.pktNow();
    $x('dev-body').querySelector('[data-day="1"]').click();
    await wait(120);
    const moved = X.pktNow();
    check('and can move what the whole app calls today',
      X.pktNum(moved) === X.pktNum(was) + 1
      && X.picOnDay('easy', moved).i === X.picOnDay('easy', was).i + 1,
      was + ' -> ' + moved);
    $x('dev-body').querySelector('[data-day="0"]').click();
    await wait(120);
    check('and put it back', X.pktNow() === was && X.dailyShift() === 0, X.pktNow());
  }
  /* ---- what the developer page does to the balance ----

     The balance is derived — focus time, claimed achievements, and `adjust` for
     anything from outside both — minus what everything owned cost. So the two
     ways this page can touch it are the two ways it got them wrong: a credit
     that only existed in memory and was gone by the next start, and a shelf
     full of things nobody paid for, which is a hole the next few thousand
     earned embers fall into. To anyone playing, that is "embers do not go up". */
  {
    const E = X.Embers;
    X.logProgress(1200); X.logClose(true);      // twenty minutes, honestly earned
    await wait(120);
    /* From the derived balance, not the running one: a running total is allowed
       to be ahead of what the inputs explain, and `reconcile` is entitled to
       pull it back. What is being tested is that the grant is one of the
       inputs — so start where the next start would start. */
    E.reconcile();
    const before = E.have;

    $x('dev-body').querySelector('[data-embers="1000"]').click();
    await wait(120);
    const after = E.have;
    E.reconcile();                              // what the next start would compute
    check('a developer grant is still there after a restart',
      after === before + 1000 && E.have === after, before + ' → ' + after + ' → ' + E.have);

    $x('dev-body').querySelector('#dev-own').click();
    await wait(200);
    const owned = E.have;
    E.reconcile();
    X.logProgress(600); X.logClose(true);
    await wait(120);
    E.reconcile();
    check('and owning everything does not swallow what you earn afterwards',
      E.own.length > 50 && owned === after && E.have > owned,
      'own=' + E.own.length + ' have=' + owned + ' → ' + E.have);

    /* And the way out for a copy already in that state — the shelf granted by
       an older build, with nothing recorded as having paid for it. The running
       total has to be cleared along with `adjust`, or `reconcile` does its own
       rescue: a stored balance above what the inputs explain is taken as
       history from before any of this was derivable and written into `adjust`,
       which is right for a device that has been running for years and would
       hide the hole being tested for here. */
    E.adjust = 0; E.earned = 0; E.have = 0;
    E.reconcile();
    const stuck = E.have;
    X.logProgress(600); X.logClose(true);
    await wait(120);
    E.reconcile();
    const stillStuck = E.have;
    const wroteOff = E.settle();
    X.logProgress(600); X.logClose(true);
    await wait(120);
    E.reconcile();
    check('and a balance already in the hole can be put right, once',
      stuck === 0 && stillStuck === 0 && wroteOff > 1000 && E.have > 0 && E.settle() === 0,
      'stuck at ' + stuck + ', wrote off ' + wroteOff + ', now ' + E.have);
  }
  check('and nothing went wrong on either', xErr.length === 0, xErr.slice(0, 2).join(' | '));

  /* **The strongest lock the build offers: the account it belongs to.** With
     `FOCUS_DEV_WHO` set, the page does not open for anybody else even with the
     key, and signing out closes it. */
  {
    const who = createHash('sha256').update('someone-else', 'utf8').digest('hex');
    const { window: ow } = boot(withDoor(html.replace(/<html([^>]*)>/,
      (m, attrs) => '<html' + attrs.replace(/\s*data-dev(-[a-z]+)?="[^"]*"/g, '') + '>')
      .replace('<html',
      '<html data-dev="1" data-dev-key="' + DEV_KEY_HASH + '" data-dev-who="' + who + '"'),
      'window.__o = {devTry, devUnlocked};'));
    await wait(600);
    ow.document.getElementById('d-dev').click();
    await wait(150);
    const body = ow.document.getElementById('dev-body');
    check('a build that belongs to an account stays shut for anybody else',
      /one account/.test(body.textContent) && !body.querySelector('#dev-key')
      && ow.__o.devTry(DEV_KEY) === false && !ow.__o.devUnlocked()
      && typeof ow.devFill === 'undefined',
      body.textContent.slice(0, 60));
  }
}

/* ---- the terms, and the seven languages -----------------------------------

   Two features that meet in one place: the page shown before anything else on
   a first start, and the fact that it — and everything behind it — can be read
   in six languages besides English.

   **English has to be untouched.** No table is read, no observer is attached,
   and every check above this one is asserting English text on the same build.
   That is the first thing checked here, because a translation layer that
   changes the untranslated app is a translation layer that has to come out. */
{
  const door = 'window.__lang = {I18N, LANGS, LANG, T, Tn, langDow, langDayHead,'
    + ' termsAccepted, aboutDoc, TERMS_VERSION};';
  const langHtml = withDoor(html, door);

  /* ---- English, exactly as it was ---- */
  {
    const { window: ew, errors: eErr } = boot(langHtml);
    await wait(400);
    const $e = (id) => ew.document.getElementById(id);
    check('with no language chosen the app is in English, and says so',
      ew.document.documentElement.getAttribute('lang') === 'en'
      && ew.document.documentElement.getAttribute('dir') === 'ltr'
      && $e('begin').textContent === 'Begin focus'
      && ew.__lang.LANG === 'en',
      [$e('begin').textContent, ew.document.documentElement.getAttribute('lang')].join(' / '));
    check('and T() in English is the string it was handed',
      ew.__lang.T('Done in {t}', { t: '3:12' }) === 'Done in 3:12'
      && ew.__lang.Tn('{n} square is wrong', '{n} squares are wrong', 1) === '1 square is wrong'
      && ew.__lang.Tn('{n} square is wrong', '{n} squares are wrong', 4) === '4 squares are wrong',
      ew.__lang.Tn('{n} square is wrong', '{n} squares are wrong', 1));
    check('and nothing threw', eErr.length === 0, eErr.slice(0, 2).join(' | '));

    /* **Every string carries all six.** One language missing from an entry is
       one screen that falls back to English in the middle of a sentence. */
    const langs = ew.__lang.LANGS.map((l) => l.k).filter((k) => k !== 'en');
    const holes = [];
    for (const en of Object.keys(ew.__lang.I18N)) {
      const row = ew.__lang.I18N[en];
      for (const k of langs) {
        const v = row[k];
        const ok = typeof v === 'string' ? !!v.length
          : (v && typeof v === 'object') ? typeof v.other === 'string' : false;
        if (!ok) holes.push(k + ': ' + en.slice(0, 40));
      }
    }
    check('every translated string has all six languages',
      holes.length === 0, holes.slice(0, 4).join(' | ') || Object.keys(ew.__lang.I18N).length + ' strings');
  }

  /* ---- Japanese ---- */
  {
    const { window: jw, errors: jErr } = boot(langHtml, { focus_lang: 'ja' });
    await wait(500);
    const $j = (id) => jw.document.getElementById(id);
    check('choosing Japanese puts the whole screen in Japanese',
      jw.document.documentElement.getAttribute('lang') === 'ja'
      && $j('begin').textContent === '集中を始める'
      && $j('terms-title').textContent === 'はじめる前に'
      && [...jw.document.querySelectorAll('.drawer-item b')].some((b) => b.textContent === 'みんなで集中'),
      $j('begin').textContent);
    check('the app’s own name is not translated',
      jw.document.querySelector('.wordmark').textContent.replace(/\s+/g, ' ').trim() === 'Focus Simulator',
      jw.document.querySelector('.wordmark').textContent);
    check('and the date is written the way Japanese writes it',
      /月/.test($j('today-date').textContent), $j('today-date').textContent);
    check('and the privacy policy is the Japanese one, not the English one',
      /この端末/.test(jw.__lang.aboutDoc('privacy')) && !/What stays on this device/.test(jw.__lang.aboutDoc('privacy')),
      jw.__lang.aboutDoc('privacy').slice(0, 40));
    check('and nothing threw while it was drawn', jErr.length === 0, jErr.slice(0, 2).join(' | '));
  }

  /* ---- Russian, where a counted thing has three forms ---- */
  {
    const { window: rw } = boot(langHtml, { focus_lang: 'ru' });
    await wait(450);
    const one = rw.__lang.Tn('{n} day in a row', '{n} days in a row', 1);
    const few = rw.__lang.Tn('{n} day in a row', '{n} days in a row', 3);
    const many = rw.__lang.Tn('{n} day in a row', '{n} days in a row', 11);
    check('a counted string takes the form its language needs',
      one === '1 день подряд' && few === '3 дня подряд' && many === '11 дней подряд',
      [one, few, many].join(' | '));
  }

  /* ---- Arabic, which reads the other way ---- */
  {
    const { window: aw } = boot(langHtml, { focus_lang: 'ar' });
    await wait(450);
    check('Arabic turns the interface round',
      aw.document.documentElement.getAttribute('dir') === 'rtl'
      && aw.document.getElementById('begin').textContent === 'ابدأ التركيز',
      aw.document.documentElement.getAttribute('dir'));
    /* **A board is a picture, not a sentence.** Right-to-left is right for the
       text and wrong for a grid: read a picross from the other side and it is
       a different puzzle. */
    check('but a board is not turned round with it',
      /\[dir="rtl"\][^{]*\.pix-wrap[^{]*\{[^}]*direction:ltr/.test(html.replace(/\s*\n\s*/g, '')),
      'no rule keeping boards left to right');
    /* Arabic keeps the same digits as the timer and the scores. */
    check('and Arabic keeps the digits the rest of the app uses',
      /\d/.test(aw.document.getElementById('today-date').textContent),
      aw.document.getElementById('today-date').textContent);
  }

  /* ---- Urdu's calendar heads ---- */
  {
    const { window: uw } = boot(langHtml, { focus_lang: 'ur' });
    await wait(450);
    /* The locale's "narrow" weekday in Urdu is a Latin letter — S, M, T — which
       no Urdu calendar prints. */
    const head = uw.__lang.langDayHead(1);
    check('the calendar’s day letters are in the reader’s own script',
      !/^[A-Za-z]$/.test(head) && head.length > 0, head);
  }

  /* ---- the terms, the first time ---- */
  {
    const { window: tw, errors: tErr } = boot(langHtml, { focus_terms: null });
    await wait(500);
    const $t = (id) => tw.document.getElementById(id);
    check('a first start shows the terms over everything',
      !$t('terms-gate').classList.contains('hide')
      && $t('terms-doc').textContent.length > 500
      && tw.document.querySelectorAll('#terms-langs [data-lang]').length === 7,
      $t('terms-doc').textContent.length + ' characters');
    /* The privacy policy is one tap away, in the same page. */
    tw.document.querySelector('#terms-gate [data-doc="privacy"]').click();
    await wait(80);
    check('and the privacy policy is right there beside them',
      /sold, shared for advertising/.test($t('terms-doc').textContent),
      $t('terms-doc').textContent.slice(0, 50));
    /* **Nothing else may interrupt it.** The daily mood question waits. */
    check('and nothing else is asked over the top of it',
      !!$t('mood-ask') && $t('mood-ask').classList.contains('hide'),
      $t('mood-ask') ? $t('mood-ask').className : 'no prompt');

    $t('terms-agree').click();
    await wait(80);
    const rec = JSON.parse(tw.localStorage.getItem('focus_terms') || 'null');
    check('agreeing puts them away and writes down which version was agreed to',
      $t('terms-gate').classList.contains('hide') && rec && rec.v === tw.__lang.TERMS_VERSION,
      JSON.stringify(rec));

    const { window: t2 } = boot(langHtml, { focus_terms: JSON.stringify(rec) });
    await wait(400);
    check('and the next start goes straight to the app',
      t2.document.getElementById('terms-gate').classList.contains('hide'),
      t2.document.getElementById('terms-gate').className);
    /* Still readable afterwards, next to the privacy policy. */
    t2.document.getElementById('menu-btn').click();
    await wait(60);
    t2.document.getElementById('d-terms').click();
    await wait(120);
    check('and they stay in the menu, beside the privacy policy',
      t2.document.getElementById('about-title').textContent === 'Terms of use'
      && /Embers are earned by focusing/.test(t2.document.getElementById('about-body').textContent),
      t2.document.getElementById('about-title').textContent);
    /* A version bump asks again — that is the whole point of storing it. */
    const { window: t3 } = boot(langHtml, { focus_terms: JSON.stringify({ v: 'older', at: 1 }) });
    await wait(400);
    check('and changing the terms asks again',
      !t3.document.getElementById('terms-gate').classList.contains('hide'),
      t3.document.getElementById('terms-gate').className);
    check('and none of that threw', tErr.length === 0, tErr.slice(0, 2).join(' | '));
  }
}

// --- verdict ---------------------------------------------------------------
const allErrors = errors.concat(errors2, hostErr, guestErr, thirdErr);
log('');
if (allErrors.length) {
  log(`✗ ${allErrors.length} runtime error(s):`);
  allErrors.slice(0, 10).forEach((e) => console.log('   ' + e.split('\n')[0]));
} else {
  log('✓ no uncaught runtime errors');
}

const failed = checks.filter((c) => !c.ok);
log(`\n${checks.length - failed.length}/${checks.length} checks passed`
  + (SLOW > 1.05 ? `  (pauses \u00d7${SLOW.toFixed(1)} for this machine)` : ''));

/* Shut the windows before leaving, and leave on the next tick so libuv has an
   iteration to finish closing what they held. Exiting straight from here with
   the rAF loops still running is what trips the assertion in async.c on
   Windows. The exit code is decided first so nothing after this can change it. */
const code = failed.length || allErrors.length ? 1 : 0;
/* **And nothing a closed window says afterwards may change it.** `Arcade._refresh`
   is async: a timer fires it, it awaits a game's `progress()`, and the rest of
   it runs a microtask later — by which time the window it belongs to has been
   closed here and `document` is gone. The throw lands after the verdict is
   printed, with no check attached to it, and took the exit code from 0 to 1
   with nothing to say which of eleven hundred checks had failed. Every real
   runtime error is already in `allErrors`, collected while the windows were
   open; this is only the sound of the door shutting. */
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
for (const w of BOOTED) { try { w.close(); } catch (e) { /* already gone */ } }
setImmediate(() => process.exit(code));
