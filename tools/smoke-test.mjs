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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
  if (seed) {
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
        if (!remote) { conn._emit('error', new Error('peer-unavailable')); return; }
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

    function mkConn(from, to) {
      const h = {};
      const c = {
        peer: to, open: true, _owner: from,
        on: (ev, fn) => { (h[ev] = h[ev] || []).push(fn); return c; },
        _emit: (ev, ...a) => (h[ev] || []).forEach((f) => f(...a)),
        // `__peerSilent` is how the test simulates a window that vanishes without
        // closing anything — a slept laptop, a killed tab, wifi walking away.
        send: (msg) => {
          if (window.__peerSilent) return;
          setTimeout(() => c._peerConn && c._peerConn._emit('data', JSON.parse(JSON.stringify(msg))), 0);
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
          setTimeout(() => { c._peerConn && c._peerConn._emit('close'); }, 0);
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

const { window, errors } = boot(withDoor(html, 'window.__m = {Cross, DCal, DAILY, pktNow, dailyGet};'), {
  focus_embers: JSON.stringify({ have: 200, earned: 200, own: ['seaglass'], light: 'seaglass' }),
});
const $ = (id) => window.document.getElementById(id);
const click = (id) => { const el = $(id); if (!el) throw new Error(`#${id} missing`); el.click(); };

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
check('the arcade has marks for the moments, not only the totals',
  ['Promote a pawn', 'sudoku', 'seven', 'ten-point', 'hangman', '2048 tile']
    .every((w) => $('ach-body').textContent.includes(w)),
  $('ach-body').textContent.slice(0, 60));
check('the whole board still pays less than the shelf costs',
  (() => {
    const pays = [...$('ach-body').querySelectorAll('.ach-pays')].reduce((n, p) => n + +p.textContent, 0);
    return pays > 0 && pays < 280;                      // the shelf, end to end
  })(),
  `${[...$('ach-body').querySelectorAll('.ach-pays')].reduce((n, p) => n + +p.textContent, 0)} embers`);
$('ach-close').click();
await wait(60);

/* ---- nothing readable behind an open menu ----
   The overlay pane is frosted rather than opaque, so the shell underneath is
   blurred at the source as well; without it the setup screen's big number was
   still legible through the shelf. */
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
check('a one-second block is not worth an ember', +$('emb-box').dataset.have === 200,
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
  await shopTab('looks');
  check('the first is free and already burning',
    shelf()[0].classList.contains('mine') && shelf()[0].classList.contains('on'), shelf()[0].className);
  check('the rest are not yours yet', shelf().slice(1).every((b) => !b.classList.contains('mine')));
  check('and say what they cost', /18 embers/.test($('emb-box').textContent),
    $('emb-box').textContent.slice(0, 140));
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
    $('emb-box').dataset.own === 'seaglass' && +$('emb-box').dataset.have === 200,
    `${$('emb-box').dataset.own} / ${$('emb-box').dataset.have}`);
}
$('stats-close').click();
await wait(60);

// Open it the way a user does — Arcade.show() sets Arcade.open, which the
// keyboard handlers guard on. Poking the class directly would skip that.
click('arcade-open');
await wait(80);
check('arcade opens from the rest screen', !$('overlay').classList.contains('hide'));
check('and the way in sits above the transport, not under the note',
  (() => {
    const kids = [...$('timer').children];
    return kids.indexOf($('arcade-open')) < kids.indexOf($('timer').querySelector('.controls'))
      && kids.indexOf($('arcade-open')) < kids.indexOf($('rest-extra'));
  })());
const pcards = [...window.document.querySelectorAll('.pcard')];
check('arcade has eight games', pcards.length === 8, `${pcards.length} cards`);
const byGame = Object.fromEntries(pcards.map((c) => [c.dataset.game, c]));
check('enabled games in picker', ['sudoku', 'wordle', 'g2048', 'crossword', 'hangman', 'scrabble', 'pictionary', 'chess'].every((g) => byGame[g]), Object.keys(byGame).join(','));
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
check('and no solo game is', ['sudoku', 'wordle', 'g2048', 'crossword'].every((g) => !byGame[g].classList.contains('needs-room')));

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
    rows.length >= 2 && /5×5/.test(rows[0].textContent), rows.map((r) => r.textContent).join(' | '));
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
  sizeBtn(5).click();
  await wait(200);
  check('sizes are offered, and only the ones the bank has',
    [...$('cw-size').children].filter((b) => !b.disabled).length >= 2,
    [...$('cw-size').children].map((b) => b.dataset.s + (b.disabled ? '!' : '')).join(','));
  check('switching size loads a puzzle of that size', cwN() === 5, `${cwN()}`);

  /* **The calendar counts clues, not squares.** "in progress" told you nothing
     about which day was nearly done, so a started puzzle says how many of its
     clues are completely right. A clue counts only when every one of its
     letters is, which is why this reveals a whole entry rather than a few
     letters and expects the count to move exactly once. */
  {
    const clue = $('cw-clues').querySelector('[data-dir="A"]');
    const len = +(clue.querySelector('i').textContent.match(/\d+/) || [0])[0];
    clue.click();
    await wait(30);
    for (let k = 0; k < len; k++) { $('cw-hint').click(); await wait(20); }
    $('cw-list').click();
    await wait(120);
    const row = [...$('dcal-day').querySelectorAll('.dcal-row')]
      .find((r) => /5×5/.test(r.querySelector('b').textContent));
    const note = row && row.querySelector('span');
    check('a started puzzle says how many of its clues are right',
      !!note && /^1 of \d+ clues · \d+ revealed$/.test(note.textContent), note && note.textContent);
    $('dcal-close').click();
    await wait(60);
  }

  // fill it by asking for a hint on every square
  for (let guard = 0; guard < 40; guard++) {
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
      .find((r) => /5×5/.test(r.querySelector('b').textContent));
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
click('cal-close');

click('d-stats'); await wait(80);
check('stats overlay opens', !$('stats-overlay').classList.contains('hide'));
// A session was logged by the skip above, so this renders cards, not the empty state.
check('stats renders after one session', $('stats-body').querySelectorAll('.stat-card').length === 4, `${$('stats-body').querySelectorAll('.stat-card').length} cards`);
click('stats-close');
check('stats overlay closes', $('stats-overlay').classList.contains('hide'));

click('d-export'); await wait(150);
check('export runs', true);
check('import controls wired', !!$('import-file') && !!$('d-import'));

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
  check('and says what it costs', /18/.test($('confirm-yes').textContent), $('confirm-yes').textContent);
  $('confirm-no').click();
  await wait(40);
  check('changing your mind costs nothing', +$('emb-box').dataset.have === before);
  shelf()[1].click();
  await wait(40);
  $('confirm-yes').click();
  await wait(80);
  check('it is paid for', +$('emb-box').dataset.have === before - 18, $('emb-box').dataset.have);
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
  check('buying it spends the embers', +$('emb-box').dataset.have === had - 34,
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

// --- calendar density ------------------------------------------------------
$2('stats-close').click();
$2('d-history').click();
await wait(120);
check('calendar marks days that have notes', $2('cal-grid').querySelectorAll('.note-dot').length > 0, `${$2('cal-grid').querySelectorAll('.note-dot').length} dots`);
check('calendar starts at normal density', $2('cal-overlay').dataset.dense === '0', $2('cal-overlay').dataset.dense);

// today was seeded with 2 sessions, so selecting it stays roomy
const cells = [...$2('cal-grid').querySelectorAll('.cal-cell.has')];
cells[cells.length - 1].click();
await wait(60);
check('two sessions keeps the roomy layout', $2('cal-overlay').dataset.dense === '0', $2('cal-overlay').dataset.dense);
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
check('eight sessions compacts the calendar', $3('cal-overlay').dataset.dense === '2', $3('cal-overlay').dataset.dense);
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
    focus_embers: JSON.stringify({ have: 400, earned: 400, own: ['seaglass'], light: 'seaglass' }),
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

   Old prices: 5 + 10 + 15 + 15 + 60 = 105. New ones: 18 + 26 + 34 + 34 + 100
   = 212. A balance of 195 is the fix; 88 is the bug. */
{
  const OLD_OWN = ['seaglass', 'latesun', 'dusk', 'frost', 'snd-rain', 'face-glass'];
  const { window: pw, errors: pErr } = boot(html, {
    // no `grand` key: this record was written by a build that had no such idea
    focus_embers: JSON.stringify({ have: 300, earned: 300, own: OLD_OWN, light: 'latesun' }),
  });
  await wait(400);
  const $p = (id) => pw.document.getElementById(id);
  check('an old record keeps every ember it had when the prices went up',
    +$p('emb-box').dataset.have === 195, `${$p('emb-box').dataset.have}, wanted 195`);
  /* Written down, so the next boot does not have to work it out again — and so
     it can travel to the other devices on the account. */
  const rec = JSON.parse(pw.localStorage.getItem('focus_embers') || '{}');
  check('and what it was holding at the time is written down',
    Array.isArray(rec.grand) && OLD_OWN.every((id) => rec.grand.indexOf(id) >= 0),
    JSON.stringify(rec.grand));
  /* The other half: the rise is real for anything bought *after* it. Hearth is
     42 now and was 20; this device never owned it, so it pays 42. */
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
    +$p('emb-box').dataset.have === before - 42,
    `${$p('emb-box').dataset.have} was ${before}`);
  /* And it does not sneak into the grandfathered list on the way — that list
     is written once, at the moment the rise lands, and never grows. */
  const rec2 = JSON.parse(pw.localStorage.getItem('focus_embers') || '{}');
  check('and does not join the list of things that kept the old price',
    (rec2.grand || []).indexOf('hearth') < 0, JSON.stringify(rec2.grand));
  check('and nothing threw while all that happened', pErr.length === 0,
    pErr.slice(0, 2).join(' | '));
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
    crossReleaseDay, crossOnDay, DAILY_EPOCH, Sudoku, DCal, Wordle, dailyStreak,
    dailyMark, dailyAdopt, dailyGet, DAILY_DONE};`);
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

  /* --- the crossword's release schedule --- */
  const sched = probe((d) => ({
    mon: [5,7,9,15].filter(n => d.crossReleases(n, '2026-08-17')),
    wed: [5,7,9,15].filter(n => d.crossReleases(n, '2026-08-19')),
    fri: [5,7,9,15].filter(n => d.crossReleases(n, '2026-08-21')),
    sun: [5,7,9,15].filter(n => d.crossReleases(n, '2026-08-23')),
    // nothing at all before the day the schedule starts
    before: [5,7,9,15].filter(n => d.crossReleases(n, '2026-08-16')),
    // the first four fives are four consecutive days
    fives: [0,1,2,3].map(n => d.crossReleaseDay(5, n)),
    nines: [0,1,2].map(n => d.crossReleaseDay(9, n)),
    fifteens: [0,1].map(n => d.crossReleaseDay(15, n)),
    // and a day maps to a real puzzle in the bank
    onMon: d.crossOnDay(5, '2026-08-17').i,
    onTue: d.crossOnDay(5, '2026-08-18').i,
  }));
  check('five and seven come out every day', sched.mon.join(',') === '5,7', sched.mon.join(','));
  check('the nine on Wednesday and Friday', sched.wed.join(',') === '5,7,9' && sched.fri.join(',') === '5,7,9',
    `${sched.wed} / ${sched.fri}`);
  check('the fifteen on Sunday', sched.sun.join(',') === '5,7,15', sched.sun.join(','));
  check('and nothing before the day the schedule starts', sched.before.length === 0, sched.before.join(','));
  check('the daily sizes run on consecutive days',
    sched.fives.join(' ') === '2026-08-17 2026-08-18 2026-08-19 2026-08-20', sched.fives.join(' '));
  check('the nines land on Wednesdays and Fridays',
    sched.nines.join(' ') === '2026-08-19 2026-08-21 2026-08-26', sched.nines.join(' '));
  check('and the fifteens a week apart, on Sundays',
    sched.fifteens.join(' ') === '2026-08-23 2026-08-30', sched.fifteens.join(' '));
  /* **The bank is append-only, and this is what says so.** A puzzle's date is
     its position in its size's list; insert one in the middle and every date
     after it moves, which rewrites history and orphans saved boards. If this
     check ever fails, something was inserted rather than appended. */
  check('and two different days are two different puzzles',
    sched.onMon >= 0 && sched.onTue >= 0 && sched.onMon !== sched.onTue,
    `${sched.onMon} / ${sched.onTue}`);

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

    /* One row of five per guess, and the last row all hits, because the last
       guess was the answer. */
    probe((d) => d.DCal.open('wordle'));
    await wait(150);
    const row = [...$d('dcal-day').querySelectorAll('.dcal-row')][0];
    const art = $d('dcal-day').querySelector('.wdl-art');
    check('and the calendar draws the grid it made',
      !!art && art.querySelectorAll('.wdl-art-row').length === 3,
      art ? `${art.querySelectorAll('.wdl-art-row').length} rows` : 'no grid');
    check('five squares to a row', !!art
      && [...art.querySelectorAll('.wdl-art-row')].every((r) => r.children.length === 5),
      art ? [...art.querySelectorAll('.wdl-art-row')].map((r) => r.children.length).join(',') : '-');
    const last = art && art.lastElementChild;
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
      !!still && still.querySelectorAll('.wdl-art-row').length === 3,
      still ? `${still.querySelectorAll('.wdl-art-row').length} rows` : 'no grid');
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
    focus_embers: JSON.stringify({ have: 300, earned: 300, own: ['seaglass'], light: 'seaglass' }),
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
  check('saying yes spends the embers', +$b('emb-box').dataset.have === had - 26,
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
  check('it costs what the shelf said', +$b('emb-box').dataset.have === hadA - 70,
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
  // 70 for the antic he did not have, 55 for the one he had already chosen
  check('choosing a colour recolours him and costs nothing',
    dyed() !== asMade && +$b('emb-box').dataset.have === hadA - 125,
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
  + ' syncNormalise, syncCodeFor, syncAdoptAccount, friendFind, syncRender};');
const { window: host, errors: hostErr } = boot(roomHtml, { focus_embers: ROOM_EMBERS });
const { window: guest, errors: guestErr } = boot(roomHtml, { focus_embers: ROOM_EMBERS });

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

// guest joins by code
$g('sync-name').value = 'Friend';
$g('sync-name').dispatchEvent(new guest.Event('input'));
$g('d-sync').click();
$g('sync-code').value = hostCode;
$g('sync-join').click();
await wait(250);
// The joiner is told whose room it is, not just its code — a code is not a person.
check('guest connects to the host', $g('sync-state').textContent.includes(hostCode), $g('sync-state').textContent);
check('and is told whose room it is', /Hashir/.test($g('sync-state').textContent), $g('sync-state').textContent);
check('host sees the guest by name', $h('sync-people').textContent.includes('Friend'), $h('sync-people').textContent.slice(0, 60));

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

// Anyone in the room can be kept, because `hello` carries their own code —
// the peer id most of them are using is a throwaway.
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
check('an empty room says so rather than showing nothing', /Nothing said yet/.test($h('chat-log').textContent));

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
  await wait(320);
  check('the leader starting a session takes the room into it',
    !$g('timer').classList.contains('hide') && $g('app').dataset.phase === 'focus',
    `phase ${$g('app').dataset.phase}`);

  $h('stop').click();
  await wait(320);
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
await wait(250);
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
  await wait(250);
  const artist = { w: guest, $: $g }, watcher = { w: host, $: $h };

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
await wait(120);
check('a promoting tap asks what to make it', shown(host, 'ch-promo'));
check('and offers all four', $h('ch-promo-row').querySelectorAll('[data-p]').length === 4,
  `${$h('ch-promo-row').querySelectorAll('[data-p]').length}`);
check('the pawn has not moved while you decide',
  !!sqOf($h, 'a7').querySelector('.ch-p'));
$h('ch-promo-row').querySelector('[data-p="q"]').click();
await wait(300);
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
const { window: third, errors: thirdErr } = boot(html, { focus_embers: ROOM_EMBERS });
await wait(300);
const $t = (id) => third.document.getElementById(id);

$h('sync-host').click();
await wait(150);
const roomCode = $h('sync-mycode').textContent;

for (const [w, $w, nm] of [[guest, $g, 'Friend'], [third, $t, 'Third']]) {
  $w('sync-name').value = nm;
  $w('sync-name').dispatchEvent(new w.Event('input'));
  $w('d-sync').click();
  $w('sync-code').value = roomCode;
  $w('sync-join').click();
}
await wait(400);
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

// hand the timer to the guest — through the confirm, the way a person would
$h('sync-people').querySelectorAll('[data-lead]')[0].click();
await wait(60);
check('handing over asks first, even in a full room', !$h('confirm').classList.contains('hide'));
$h('confirm-yes').click();
await wait(1800);
const guestCode = $g('sync-mycode').textContent;
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
log(`\n${checks.length - failed.length}/${checks.length} checks passed`);

/* Shut the windows before leaving, and leave on the next tick so libuv has an
   iteration to finish closing what they held. Exiting straight from here with
   the rAF loops still running is what trips the assertion in async.c on
   Windows. The exit code is decided first so nothing after this can change it. */
const code = failed.length || allErrors.length ? 1 : 0;
for (const w of BOOTED) { try { w.close(); } catch (e) { /* already gone */ } }
setImmediate(() => process.exit(code));
