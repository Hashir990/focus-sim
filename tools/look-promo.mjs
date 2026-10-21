/**
 * Store screenshots: the real app, framed and captioned for a listing.
 *
 *   npx electron tools/look-promo.mjs
 *
 * Writes look/promo/NN-<name>.png at 1080x1920 -- a 9:16 phone screenshot,
 * which is what Google Play wants -- plus feature.png at exactly 1024x500 for
 * the feature graphic.
 *
 * **The app in these is the app.** Each frame loads dist/index.html in an
 * iframe at phone size, drives it to the screen being advertised, and the
 * caption is laid over it in the page. Nothing is mocked up and nothing is
 * retouched, so a screenshot cannot promise something the build does not do
 * -- which is a store rule as well as a decent way to behave.
 *
 * Same two tricks as tools/look-together.mjs: an in-memory localStorage per
 * frame so each starts clean, and a door spliced into the IIFE where a screen
 * cannot be reached by clicking alone.
 */
import { app, BrowserWindow } from 'electron';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'look', 'promo');
const PORT = 4419;
const W = 1080, H = 1920;          // Play's phone screenshot, 9:16
const APP_W = 460, APP_H = 900;    // the window electron/main.cjs opens
mkdirSync(outDir, { recursive: true });

const raw = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
const termsV = (raw.match(/const TERMS_VERSION = '([^']+)'/) || [])[1] || '';

function withDoor(src, code) {
  const at = src.lastIndexOf('})();');
  if (at < 0) throw new Error('no closing IIFE to splice a door into');
  return src.slice(0, at) + '\n' + code + '\n' + src.slice(at);
}
const DOOR = 'window.__p = {Arcade, Embers, Cal, S, start, SYNC};';

/** Per-frame storage, a seeded history so the calendar and the shop have
    something true to show, and the look the frame wants. */
const shim = (own, light, days, opts) => `<script>(function(){
  var mem = {};
  var store = {
    getItem: function(k){ return Object.prototype.hasOwnProperty.call(mem,k) ? mem[k] : null; },
    setItem: function(k,v){ mem[k] = String(v); },
    removeItem: function(k){ delete mem[k]; },
    clear: function(){ mem = {}; },
    key: function(i){ var ks = Object.keys(mem); return i < ks.length ? ks[i] : null; },
    get length(){ return Object.keys(mem).length; }
  };
  try { Object.defineProperty(window, 'localStorage', {configurable:true, value:store}); } catch(e){}
  var p = function(n){ return String(n).padStart(2,'0'); };
  var key = function (back) {
    var d = new Date(); d.setDate(d.getDate() - back);
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  };
  var log = [], id = 1;
  for (var i = 0; i < ${days}; i++) {
    var d = new Date(); d.setDate(d.getDate() - i);
    /* A real-looking history: most days worked, a couple missed, varying
       lengths. Nothing here is shown as a record or a claim -- it is the
       shape of a calendar with somebody's months in it. */
    if (i % 7 === 3 || i % 11 === 5) continue;
    var mins = [25, 25, 50, 25, 90, 50][i % 6];
    log.push({id:'x'+(id++), day: d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate()),
              ts: d.getTime(), secs: mins * 60});
  }
  /* **One day filled in properly.** The generated history is a block a
     day with nothing written on it: right for a month of dots, empty as a
     day page. A frame can hand in the real contents of one day -- when each
     block started, how long it ran, what it was -- and the generated block
     for that day steps aside for them. */
  var EXTRA = ${JSON.stringify((opts && opts.extra) || [])};
  if (EXTRA.length) {
    var filled = {};
    EXTRA.forEach(function (x) { filled[key(x.back)] = 1; });
    log = log.filter(function (r) { return !filled[r.day]; });
    EXTRA.forEach(function (x, i) {
      var t = new Date(); t.setDate(t.getDate() - x.back);
      var hm = String(x.at).split(':');
      t.setHours(Number(hm[0]), Number(hm[1]), 0, 0);
      log.push({ id: 'ex' + i, day: key(x.back), ts: t.getTime(),
                 secs: x.mins * 60, note: x.note || '' });
    });
  }
  store.setItem('focus_terms', JSON.stringify({v:${JSON.stringify(termsV)}, at:1}));
  store.setItem('focus_setup', '1');
  store.setItem('focus_log', JSON.stringify(log));
  /* **Where the embers come from.** By default a flat grant, because a
     frame has to be able to wear a look it did not pay for. The fromLog
     option takes them from the hours instead -- one per ten minutes, the
     app's own rate -- which leaves adjust at nought and so makes the level
     equal to the history. Only the shop frame wants that, and it is the
     only frame where the level means anything.

     No backticks in here: this comment is inside a template literal, and
     one ends it. */
  var LOGSECS = 0;
  for (var q = 0; q < log.length; q++) LOGSECS += log[q].secs;
  var EARNED = ${(opts && opts.fromLog) ? 'Math.floor(LOGSECS / 600)' : '9000'};
  var HAVE = ${(opts && opts.fromLog) ? 'EARNED' : '2400'};
  store.setItem('focus_embers', JSON.stringify({
    have: HAVE, earned: EARNED, own: ${JSON.stringify(own)}, light: ${JSON.stringify(light)} }));
  /* **Signed in, so the room screen can be photographed at all.**

     Focus together is behind an account -- \`d-sync\` shows the sign-in prompt
     to anybody without one -- so a frame with no account photographs the
     prompt rather than the feature. A token is put here to get past that
     door. The screen on the other side is the app's own, unmodified; what is
     faked is the key, not the room.

     **And \`fetch\` is stopped at the same time.** ACC_URL in a built page is
     the live account worker, and a made-up token would otherwise send real
     requests to it from a screenshot tool -- which would fail, write an
     error into the panel being photographed, and put junk in somebody's
     server log. Nothing in these frames touches the network. */
  store.setItem('focus_account', JSON.stringify({
    token: 'promo-shot-not-a-real-token', username: 'Hashir', rev: 1 }));
  /* **Dressed.** A buddy wearing nothing is a wardrobe that never appears in
     its own screenshots. The numbers are indices into BUD_HATS, BUD_OUTER,
     BUD_ACC and BUD_FACE in 46-buddy.js, where 0 is Bare. */
  /* **And doing something, or he is not there at all.** 5 is the balloon
     in BUD_ANIMS. A frame that does not own it -- the shop -- simply has
     no buddy on its clock, which is the app's own rule and the right
     answer for that one. */
  /* **Dressed, and dressed as something.** He was bare -- no hat, no
     coat, nothing worn -- which is a wardrobe advertised by showing none
     of it. A space helmet over a hoodie dyed red: one silhouette, read at
     thirty pixels beside a name, that is obviously a costume rather than
     a default. See BUD_HATS, BUD_OUTER and BUD_TINT in 46-buddy.js. */
  store.setItem('focus_sim', JSON.stringify({
    budAnim: ${(opts && opts.noBuddy) ? -1 : 5}, budShow: true,
    buddy: { b: 7, c: 9, e: 11, h: 12, a: 0, f: 7, o: 4, r: 1,
      ec: 4, es: 6, ey: 6, ex: 6, rc: 5, hc: 0, ac: 0, fc: 0, oc: 1 } }));
  /* **Something in the diary.** The calendar plans ahead as well as looking
     back, and an empty plan hides half of what it is for. */
  store.setItem('focus_plan', JSON.stringify(
    ${JSON.stringify((opts && opts.plan) || [])}.map(function (x, i) {
      return { id: 'promo' + i, kind: x.kind, text: x.text, day: key(x.back),
               time: x.time || '', rep: null, done: {}, sp: {} };
    })));
  window.fetch = function(){
    return Promise.resolve({ ok: true, status: 200,
      json: function(){ return Promise.resolve({ ok: true, rev: 1, snapshot: null }); },
      text: function(){ return Promise.resolve('{"ok":true}'); } });
  };
  window.Peer = function(){ this.on = function(){ return this; }; this.destroy = function(){}; };
})();</script>`;

const appPage = (own, light, days, opts) =>
  withDoor(raw, DOOR).replace('<script>', shim(own, light, days, opts) + '\n<script>');

/* ---- the frames ---------------------------------------------------------
   caption, subline, the look to wear, and what to do once it has loaded.
   Written as a small vocabulary rather than free JS so a frame stays a
   description of a screen rather than a second copy of the app. */

const FRAMES = [
  /* **No buddy on this one.** He is a real part of the screen and he is
     not what the first frame is about: somebody deciding whether this is
     a focus timer has one question, and a figure on a balloon beside the
     dial is an answer to a different one. He is on the rest of them. */
  { file: '01-focus', head: 'Work in blocks.\nRest on purpose.',
    sub: 'A focus timer that gives you something to do with the break.',
    light: 'seaglass', do: 'begin', noBuddy: true },

  /* **Not counted, and not listed out.** A number is the most concrete
     thing this can say and the first thing that goes wrong -- "twelve" is
     wrong the day a thirteenth ships, and nobody re-reads a store listing
     when the arcade grows. Six names have the same fault more slowly: the
     list stops being the list. Categories survive it. */
  /* **The shelf, with two of its boards behind it.**

     This was three frames -- the arcade, a picross, a crossword -- which
     is the same sentence three times: here is a shelf, here is a thing
     off it, here is another. Behind the shelf they say what is on it.

     It also brings the set to eight. Play takes at most eight phone
     screenshots and there were ten, so something had to go, and three
     frames saying one thing were what. */
  { file: '02-arcade', head: 'An arcade\nwaiting in the break.',
    sub: 'Puzzles, word games and board games, several of them played with somebody else.',
    light: 'skyline', top: 420, scale: 1.08, fanH: 1120,
    cards: [
      { do: 'game:picross:26', left: -30, top: 140, h: 900, rot: -8, z: 1 },
      { do: 'game:crossword:30', left: 650, top: 140, h: 900, rot: 8, z: 2 },
      { do: 'arcade', left: 310, top: 0, h: 820, rot: -1, z: 3 },
    ] },

  /* **Eleven days and two looks owned**, so most of the shelf is shut and
     the level bar has somewhere to go. At level 55 with everything bought,
     the one thing the level does -- pace the shelf -- cannot be seen at all,
     and the shop photographs as a list of things already had. */
  { file: '05-shop', head: 'The hours you put in\nbuy the way it looks.',
    sub: 'Looks and ambiences of every kind, earned by focusing. The dearest need the hours to match.',
    light: 'seaglass', do: 'shop', days: 30, own: [], fromLog: true },

  /* **The month and a day off it, in one picture.** They were one frame
     showing one of them, which advertises half of what the calendar is:
     the month is where you see the shape of it, the day is where the work
     and the plans actually are. Fanned, the pair says both at once.

     Yesterday is the day on the front card, filled in properly -- three
     blocks of different lengths with what each one was, two things that
     were on at a time, and one that was not done to a clock. */
  { file: '06-calendar', head: 'Every day you did it,\nand the ones to come.',
    sub: 'Finished blocks behind you, plans ahead, and what happened on any day you open.',
    light: 'frost', top: 450, scale: 1.38, fanH: 1260,
    cards: [
      { do: 'calendar', left: 100, top: 0, h: 575, rot: -7, z: 1 },
      { do: 'calendar:day:1', left: 520, top: 200, h: 700, rot: 5, z: 2 },
    ],
    plan: [{ kind: 'event', back: 1, text: 'Standup', time: '09:00' },
           { kind: 'event', back: 1, text: 'Dentist', time: '17:30' },
           { kind: 'task', back: 1, text: 'Book the flights' },
           { kind: 'event', back: -3, text: 'Library closes early', time: '16:00' },
           { kind: 'task', back: -1, text: 'Finish the slides' }],
    extra: [{ back: 1, at: '08:40', mins: 25, note: 'Inbox, and the standup notes' },
            { back: 1, at: '09:35', mins: 50, note: 'Chapter four, second pass' },
            { back: 1, at: '11:10', mins: 90, note: 'Tax return, finally' }] },

  { file: '07-spiders', head: 'A shelf of looks, and\none of them has spiders.',
    sub: 'Each has its own palette and its own weather behind the dial.',
    light: 'spiderman', do: 'spiders' },

  /* **A picture of two people, because that is what the feature is.**

     Driving this one live photographs the sign-in prompt: rooms hang off an
     account and the frame has none. Rather than fake a signed-in state --
     which risks advertising a screen the app does not really draw -- it uses
     the capture tools/look-together.mjs already makes, where two real copies
     of the app pair over the room protocol and deal a real game between
     them. A photograph of the thing working is the only kind worth putting
     on a listing. */
  { file: '08-together', head: 'Your hours,\nadded up.',
    sub: 'Totals, streaks, averages, your best day and the last fortnight, on the page that also opens a room.',
    light: 'seaglass', do: 'sync' },

  /* And what a room is for, from the two-panel capture tools/look-together.mjs
     makes: two real copies of the app paired over the room protocol with a
     real game dealt between them. A live drive cannot show this -- one window
     is one person -- so the photograph is the honest way to say it. */
  { file: '09-room', head: 'A game across\nthe room.',
    sub: 'Word games, drawing and guessing games, dealt between two devices.',
    /* One card from each of three captures rather than two from one: the
       frame is about how much there is to play, and two halves of the
       same board say less than three different games do. Each was taken
       under its own light, so the shelf gets a word in as well.

       Bottoms aligned and tops stepped down to the right, which is what
       a hand of cards does. The spymaster card is the first panel of a
       four-seat capture: the one holding the key, mid-game, with a clue
       given and three cards turned over. */
    imgs: ['together-scrabble.png', 'together-pictionary.png', 'together-spymaster.png'],
    top: 500, scale: 1.08, fanH: 960,
    cards: [
      { src: 0, x: 0, y: 0, left: -70, top: 30, h: 870, rot: -8, z: 1 },
      { src: 1, x: 0, y: 0, left: 270, top: 170, h: 730, rot: -2, z: 2 },
      { src: 2, x: 0, y: 0, left: 610, top: 260, h: 720, rot: 6, z: 3 },
    ] },

  /* **The other half of a room, which is not a game at all.** The clock is
     shared too: everyone in the room counts the same block down, each
     under their own name with the buddy they dressed. One window cannot
     photograph three people, so this is the three-panel capture
     tools/look-together.mjs makes, where three real copies of the app pair
     over the room protocol and one of them starts the timer. */
  { file: '10-room-timer', head: 'One clock,\nup to twelve people.',
    sub: 'A room shares the timer itself, not only the games. Start a block and everybody is in it.',
    img: 'together-focus.png', top: 430, scale: 0.95, fanH: 1200,
    /* Three of them, the one holding the timer in front. Smaller than the
       two-card decks: three phones across a canvas this wide either
       overlap by half or come down in size, and half a dial is worse than
       a slightly smaller one. */
    cards: [
      { x: 462, left: -78, top: 0, h: 900, rot: -8, z: 1 },
      { x: 924, left: 277, top: 150, h: 900, rot: -2, z: 2 },
      { x: 0, left: 632, top: 300, h: 900, rot: 5, z: 3 },
    ] },
];

const act = (what) => {
  /* **A frame that drives nothing is a frame, not a mistake.** The one that
     shows a picture instead of a live screen has no `do` at all, and without
     this guard the `indexOf` below throws while the page is being built --
     server side, so the request never answers, `loadURL` waits for ever, and
     the run stalls with no output at all rather than failing. */
  if (!what) return '';
  if (what === 'begin') return `d.getElementById('begin').click(); await s(2600);`;
  if (what === 'arcade') return `
    var o = d.getElementById('arcade-open'); o.classList.remove('hide'); o.click(); await s(900);`;
  /* `game:picross` opens one; `game:picross:24` opens it and then presses
     its own fix-a-square that many times, so the board in the picture has
     been played rather than just dealt. */
  if (what.indexOf('game:') === 0) {
    const bits = what.slice(5).split(':');
    const fill = Number(bits[1] || 0);
    return `
    var o = d.getElementById('arcade-open'); o.classList.remove('hide'); o.click(); await s(600);
    d.querySelector('.pcard[data-game=${JSON.stringify(bits[0])}]').click(); await s(2000);`
    + (!fill ? '' : `
    /* **Filled in by the game itself**, so what is on the board is real
       progress on the real puzzle -- the right squares in the right
       places -- rather than scribble put on a grid for a photograph.

       The two ask for it differently. The crossword's Hint reveals the
       letter under the cursor and moves on, so it is a button pressed
       N times. Picross's "Fix a square" only arms a pick: the square is
       chosen by the tap that follows, and it has to be a *tap* rather
       than a click, because that board fills by dragging and so listens
       for pointers rather than for clicks. Pressing it N times on its
       own, which is the obvious reading, just toggles the mode on and
       off and leaves the grid exactly as empty as it was. */
    /* **Which game, from the name -- not from what is in the document.**
       Every game's markup is in the page all the time, hidden; asking
       whether the picross hint button exists is therefore always yes,
       so the crossword card ran the picross routine against a grid
       nobody could see, and came out empty. */
    var pixh = ${JSON.stringify(bits[0])} === 'picross' && d.getElementById('pix-hint');
    if (pixh) {
      var cells = [].slice.call(d.querySelectorAll('#pix-grid .pix-cell'));
      var poke = function (el, type) {
        el.dispatchEvent(new w.PointerEvent(type, { clientX: 10, clientY: 10,
          bubbles: true, cancelable: true, pointerId: 1,
          pointerType: 'touch', isPrimary: true }));
      };
      for (var k = 0; k < ${fill} && cells.length; k++) {
        pixh.click();
        await s(80);
        var cell = cells[(k * 37 + 11) % cells.length];
        poke(cell, 'pointerdown'); poke(cell, 'pointerup');
        await s(110);
      }
    } else {
      var cwh = d.getElementById('cw-hint');
      for (var j = 0; j < ${fill} && cwh && !cwh.disabled; j++) {
        cwh.click();
        await s(150);
      }
    }
    await s(400);`);
  }
  if (what === 'shop') return `d.getElementById('emb-chip').click(); await s(1200);`;
  /* **Wait for a spider rather than hope for one.** They arrive every six to
     fourteen seconds and wander off again, so a fixed pause photographs an
     empty room about as often as not. This waits for two to be on screen, so
     the look is advertised with the thing it is named after in it. */
  if (what === 'spiders') return `
    d.getElementById('begin').click();
    /* **Waited for, and waited for in the right place.** They arrive every
       six to fourteen seconds, wander, and leave. Two on screen is not
       enough on its own: the first version caught one eight pixels from the
       top edge, which in a picture is a speck. This holds until one is
       properly inside the frame. */
    /* **On a web, or you cannot see it.** The inks are near-black on
       purpose -- 39a-spiders.js says so: the one thing this must not be is
       something that asks to be looked at while somebody is working. That
       is right for the app and useless for a photograph of it, because a
       near-black spider crossing a near-black room is a smudge. Where one
       actually reads is against a web: the pale corner webs, or hanging on
       its own thread. So that is what is waited for. */
    var good = function () {
      var host = d.getElementById('spiders');
      if (!host) return false;
      var h = fr.clientHeight;
      return [].slice.call(host.children).some(function (c) {
        var spot = c.dataset.spot || '';
        if (!/^(web|drop)-/.test(spot)) return false;
        var r = c.getBoundingClientRect();
        return r.top > 8 && r.bottom < h - 8;
      });
    };
    for (var t = 0; t < 150 && !good(); t++) await s(400);
    await s(300);`;
  /* `calendar` is the month; `calendar:day:1` is yesterday's page off it.
     The day is named rather than hunted for, because the fanned pair has to
     show the same day twice and "the fourth marked cell from the end" is
     not a day. */
  if (what.indexOf('calendar') === 0) {
    const bits = what.split(':');
    const back = bits[1] === 'day' ? Number(bits[2] || 0) : null;
    return `
    d.getElementById('menu-btn').click(); await s(500);
    d.getElementById('d-history').click(); await s(1400);` + (back === null ? '' : `
    var dd = new Date(); dd.setDate(dd.getDate() - ${back});
    var pp = function (x) { return String(x).padStart(2, '0'); };
    w.__p.Cal.openDay(dd.getFullYear() + '-' + pp(dd.getMonth() + 1) + '-' + pp(dd.getDate()));
    await s(1100);`);
  }
  if (what === 'sync') return `
    d.getElementById('menu-btn').click(); await s(500);
    d.getElementById('d-sync').click(); await s(1200);
    /* A name and an open room, so the screen shows what it looks like in use
       rather than an empty form. The code on it is this frame's own, made by
       the app the way it makes everybody's. */
    var nm = d.getElementById('sync-name');
    if (nm) { nm.value = 'Hashir'; nm.dispatchEvent(new w.Event('input')); }
    var host = d.getElementById('sync-host');
    if (host) { host.click(); await s(1500); }`;
  return '';
};

/* ---- the page the screenshot is of -------------------------------------- */

const promo = (f) => `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gabarito:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap">
<style>
  /* **The picture is a box, not the window.** The window is deliberately
     bigger than the picture so the capture can take a rect out of the
     middle of a surface rather than off its edge -- see the note at
     setContentSize. Everything that lays out has to be inside this box,
     or it centres itself in a window nobody is photographing. */
  html,body{margin:0;background:#090e1a}
  .page{position:absolute;left:0;top:0;transform-origin:top left;
        width:${W}px;height:${H}px;
        overflow:hidden;
        background:${f.bg || 'radial-gradient(120% 70% at 50% -5%, #16203a 0%, #090e1a 60%)'};
        font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#eef2fb}
  .head{padding:92px 86px 0}
  h1{font-family:'Gabarito',sans-serif;font-weight:800;font-size:82px;line-height:1.04;
     letter-spacing:-.02em;margin:0 0 26px;white-space:pre-line}
  p{margin:0;font-size:32px;line-height:1.42;color:#9fb0cc;max-width:880px}
  /* The app itself, at the size it opens, scaled up bodily so the pixels in
     the picture are the app's own and not a re-layout at a width nobody uses. */
  /* **Centred by the layout, scaled by the transform.** Doing both in one
     transform does not work: translateX(-50%) scale(k) scales the
     translation too, and the phone walks off the left of the canvas. */
  /* **Up, and sized to fit the bottom row in.** The caption ends around
     380 and the phone started at 560, which left a band of nothing across
     the middle of every frame. It was then raised and scaled past the
     bottom edge, on the theory that a screen running off the picture
     reads better than a picture of a phone -- which is true, and cost the
     one row that has to be there. The controls are the last thing on the
     timer, so "Pause" came out sliced through the middle of its letters.
     1.6 puts all 900 of the app's own pixels inside the canvas with a
     margin under them. */
  .scale{position:absolute;left:0;right:0;top:${f.top || 440}px;
         display:flex;justify-content:center}
  .shot{width:${f.imgW || APP_W}px;height:${f.imgCrop || f.imgH || APP_H}px;flex:0 0 auto;
        transform:scale(${f.scale || 1.6});transform-origin:top center;
        border-radius:30px;overflow:hidden;
        box-shadow:0 40px 90px rgba(0,0,0,.62), 0 0 0 1.2px rgba(255,255,255,.1)}
  .shot iframe{width:${APP_W}px;height:${APP_H}px;border:0;display:block}
  .shot img{display:block}
  /* **Fanned.** Cards of the same width overlapping at an angle, so a set
     of screens reads as one thing held in a hand rather than as several
     screenshots pasted side by side. The rotation puts a corner of the
     outer ones past the edge of the canvas, which is the point: a deck is
     wider than the picture of it.

     Anchored at the top, so scale only ever adds height downwards. About
     the centre it adds half of it upwards as well, and the deck climbs
     into the caption however far down the box is put.

     The box is the full width of the canvas, so a card's left is simply
     where it goes on it and the centre it is scaled about is half an app
     further on. A card is either a screen being driven in an iframe or a
     window onto one of the photographs, moved to the panel it wants. */
  .sfan{position:absolute;left:0;right:0;top:${f.top || 440}px;
        display:flex;justify-content:center}
  .sbox{position:relative;width:${W}px;height:${f.fanH || 1200}px}
  .card{position:absolute;width:${APP_W}px;border-radius:30px;overflow:hidden;
        transform-origin:top center;background-repeat:no-repeat;
        box-shadow:0 40px 90px rgba(0,0,0,.62), 0 0 0 1.2px rgba(255,255,255,.1)}
  .card iframe{width:${APP_W}px;height:${APP_H}px;border:0;display:block}
</style></head><body><div class="page">
<div class="head"><h1>${f.head}</h1><p>${f.sub}</p></div>
${f.cards
  ? '<div class="sfan"><div class="sbox">'
    + f.cards.map((c, i) => '<div class="card" style="'
        + 'left:' + c.left + 'px;top:' + c.top + 'px;height:' + c.h + 'px;'
        + 'z-index:' + (c.z || i + 1) + ';'
        + (c.do === undefined
            ? 'background-image:url(/shot.png?i=' + (c.src || 0) + ');'
              + 'background-position:' + (-(c.x || 0)) + 'px ' + (-(c.y || 0)) + 'px;'
            : '')
        + 'transform:rotate(' + c.rot + 'deg) scale(' + (f.scale || 1) + ')">'
        + (c.do === undefined ? ''
            : '<iframe src="/app?f=' + encodeURIComponent(f.file) + '&c=' + i + '"></iframe>')
        + '</div>').join('')
    + '</div></div>'
  : '<div class="scale"><div class="shot">' + (f.img
      ? '<img src="/shot.png" width="' + f.imgW + '" height="' + f.imgH + '" alt="">'
      : '<iframe src="/app?f=' + encodeURIComponent(f.file) + '"></iframe>')
    + '</div></div>'}
</div>
<script>
  /* **The window is not the size it was asked for.** setContentSize(1024,
     500) on a desktop scaled to 1.25 produces a 1280x627 CSS viewport at
     a reported pixel ratio of 1 -- Windows applies its scaling to the
     window and Chromium does not know it happened. A stage drawn at its
     own size then sits in the top left corner of a bigger page, and the
     resample at the end squashes the empty margin in with it.

     So the stage is grown to fill whatever viewport turned up, and the
     exact rectangle it ends up occupying is handed back for the capture
     to take. Growing rather than shrinking also means the resample is a
     downsample, which is the direction that looks better. */
  window.__fit = function () {
    var el = document.querySelector(".page");
    var k = Math.min(innerWidth / ${W}, innerHeight / ${H});
    if (!(k > 0)) k = 1;
    el.style.transform = "scale(" + k + ")";
    return { w: Math.max(1, Math.round(${W} * k)),
             h: Math.max(1, Math.round(${H} * k)) };
  };
  window.__shot = async function () {
    var cards = [].slice.call(document.querySelectorAll('iframe'));
    if (!cards.length) return 'a picture, not a screen';
    var s = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    /* One driver per card, in the order they sit in the page. A plain frame
       has a single card; the fanned pair has two, each its own copy of the
       app with its own storage, each driven to a different screen. */
    var drive = [${(f.cards ? f.cards.filter((c) => c.do !== undefined).map((c) => c.do)
                   : [f.do]).map((what) => `async function (fr) {
      var w = fr.contentWindow, d = fr.contentDocument;
      for (var t = 0; t < 100 && !d.getElementById('begin'); t++) await s(120);
      /* The mood question and any toast are true parts of the app and wrong
         for a picture of one screen: they cover the thing being advertised
         and they are the first thing a new install does not have. */
      var hide = function () {
        ['.mood-ask', '.toast', '.ach-pop', '#update-band', '#emb-gain'].forEach(function (sel) {
          var el = d.querySelector(sel); if (el) el.style.display = 'none';
        });
      };
      hide();
      ${act(what)}
      hide();
      return (d.body.textContent || '').replace(/\\s+/g, ' ').slice(0, 44);
    }`).join(', ')}];
    var said = [];
    for (var i = 0; i < cards.length && i < drive.length; i++) {
      said.push(await drive[i](cards[i]));
    }
    return said.join('  ||  ');
  };
</script></body></html>`;

/* ---- the feature graphic, which is its own shape ------------------------ */

const feature = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gabarito:wght@700;800&family=Plus+Jakarta+Sans:wght@500&display=swap">
<style>
  /* **border-box, and the gradient on both.** Without it the 62px of padding
     is added to the 1024 width, so the body is 1148 wide inside a 1024
     window and its background stops short of the right edge -- which shows
     up as a hard vertical seam about four fifths of the way across. Putting
     the same gradient on html as well means nothing can show through even
     if the box is a pixel out. */
  *{box-sizing:border-box}
  html,body{margin:0;background:#0a1020}
  /* Same reason as the screenshot page: the window is larger than the
     graphic so the capture comes from inside the surface, so the graphic
     is a box at the top left rather than the window itself. */
  .fg{position:absolute;left:0;top:0;transform-origin:top left;
      width:1024px;height:500px;overflow:hidden;
      background:radial-gradient(90% 150% at 18% 50%, #18324a 0%, #0a1020 62%);
      font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#eef2fb;
      display:flex;align-items:center;padding:0 62px}
  .l{max-width:560px}
  .mark{display:flex;align-items:center;gap:11px;margin-bottom:20px}
  .mark i{width:13px;height:13px;border-radius:4px;background:#4fe0c8;
          transform:rotate(45deg);box-shadow:0 0 14px rgba(79,224,200,.6)}
  .mark b{font-size:15px;letter-spacing:.14em;color:#9fb0cc;font-weight:600}
  h1{font-family:'Gabarito',sans-serif;font-weight:800;font-size:60px;line-height:1.03;
     letter-spacing:-.02em;margin:0 0 16px}
  p{margin:0;font-size:22px;line-height:1.45;color:#9fb0cc}
  .ring{position:absolute;right:92px;top:50%;transform:translateY(-50%);
        width:300px;height:300px;border-radius:50%;
        border:13px solid #4fe0c8;box-shadow:0 0 70px rgba(79,224,200,.34);
        display:grid;place-items:center}
  .ring b{font-family:'Gabarito',sans-serif;font-weight:800;font-size:71px;
          letter-spacing:-.012em;font-variant-numeric:tabular-nums}
</style></head><body><div class="fg">
  <div class="l">
    <div class="mark"><i></i><b>focUS simulator</b></div>
    <h1>Focus in blocks.<br>Earn the break.</h1>
    <p>A Pomodoro timer with an arcade in the rest, a calendar of
       everything you have finished, and a shop you pay for in hours.</p>
  </div>
  <div class="ring"><b>24:58</b></div>
</div>
<script>
  /* **The window is not the size it was asked for.** setContentSize(1024,
     500) on a desktop scaled to 1.25 produces a 1280x627 CSS viewport at
     a reported pixel ratio of 1 -- Windows applies its scaling to the
     window and Chromium does not know it happened. A stage drawn at its
     own size then sits in the top left corner of a bigger page, and the
     resample at the end squashes the empty margin in with it.

     So the stage is grown to fill whatever viewport turned up, and the
     exact rectangle it ends up occupying is handed back for the capture
     to take. Growing rather than shrinking also means the resample is a
     downsample, which is the direction that looks better. */
  window.__fit = function () {
    var el = document.querySelector(".fg");
    var k = Math.min(innerWidth / 1024, innerHeight / 500);
    if (!(k > 0)) k = 1;
    el.style.transform = "scale(" + k + ")";
    return { w: Math.max(1, Math.round(1024 * k)),
             h: Math.max(1, Math.round(500 * k)) };
  };
</script>
</body></html>`;

/* ---- serve ---------------------------------------------------------------- */

let current = FRAMES[0];
createServer((q, r) => {
  const u = new URL(q.url, 'http://x');
  let body;
  if (u.pathname === '/app') {
    body = appPage(current.own || [], current.light,
      current.days === undefined ? 96 : current.days, current);
  }
  else if (u.pathname === '/shot.png') {
    /* A fan can be cut from several captures, so a card says which. */
    const which = (current.imgs && current.imgs[Number(u.searchParams.get('i') || 0)])
      || current.img;
    r.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    r.end(readFileSync(join(root, 'look', 'games', which)));
    return;
  }
  else if (u.pathname === '/feature') body = feature;
  else body = promo(current);
  r.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  r.end(body);
}).on('error', (e) => {
  /* **Not a warning.** An unheard EADDRINUSE leaves the window
     loading from the previous run's server, which answers every
     request with the last frame it reached -- so every file comes
     out correctly named and containing the wrong picture. */
  console.log('port ' + PORT + ' is already in use (' + e.code + ').'
    + ' Another run of this tool is still alive; its pictures would be'
    + ' served in place of these. Stop it and try again.');
  process.exit(1);
}).listen(PORT, '127.0.0.1');

/* **Photographed at whatever the display gives, then resampled.**

   `capturePage` hands back the window's own bitmap, which on a display
   scaled to 1.25 is 1.25 times the CSS size: a 1080 wide window comes out
   1350. Two obvious fixes both fail. Dividing the CSS size by the scale
   needs a window 819.2px wide for a 1024px picture, and there is no such
   window. Forcing the device scale to 1 makes Chromium disagree with the
   desktop about how big the surface is, and everything past four fifths of
   the way across -- and four fifths of the way down -- composites
   differently, which shows up as a hard seam. Taking a rect out of a bigger
   window does not help either: the seam is at four fifths of the *rect*.

   So the size is not argued with at all. The picture is drawn large, and
   `nativeImage.resize` puts it at the exact number of pixels the store
   asks for -- which is a downsample, so the type comes out crisper than it
   would have at 1:1. */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** **A capture, with the rejection caught.**

    `capturePage()` rejects with "Current display surface not available for
    capture" when the window is not composited at the moment it is asked,
    which a second after making one it sometimes is not. Unhandled, that
    rejection stops the chain where it stands: the frames are all written,
    the server is still listening, and the process sits there printing
    nothing. Asking again a moment later is all it takes. */
async function grab(wc, label) {
  for (let i = 0; i < 8; i++) {
    try { return await wc.capturePage(); } catch (e) { await wait(500); }
  }
  console.log(label + ': the window never offered a surface to capture');
  return null;
}

/** A machine that goes to sleep mid-run answers one load with
    ERR_NETWORK_IO_SUSPENDED and the rest fine. Worth a second ask rather
    than losing the run. */
async function load(win, url) {
  for (let go = 0; go < 4; go++) {
    try {
      /* **With a deadline.** `loadURL` waits for the load event, and a page
         whose server threw mid-response never fires one -- so a small bug in
         building the HTML becomes a run that burns CPU for half an hour and
         prints nothing. Thirty seconds is longer than any of these take and
         far shorter than for ever. */
      await Promise.race([
        win.loadURL(url),
        new Promise((_, no) => setTimeout(() => no(new Error('timed out')), 30000)),
      ]);
      return true;
    } catch (e) { await wait(1200); }
  }
  return false;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 700, show: true, frame: false,
    backgroundColor: '#090e1a', webPreferences: { backgroundThrottling: false } });

  /* Named on the command line, or all of them. A name matches any frame
     whose file contains it, so `calendar` finds `06-calendar`. */
  const only = process.argv.slice(2).filter((x) => !x.startsWith('-'));
  for (const f of FRAMES) {
    if (only.length && !only.some((x) => f.file.includes(x))) continue;
    current = f;
    /* The look a frame wears has to be owned or the room stays teal. A frame
       that is *about* the shelf owns much less on purpose: a shop with
       everything bought and nothing locked says nothing about either the
       shop or the level that paces it. */
    if (!f.own) {
      /* The antic and the clothes both have to be owned: `budStrip` in
         46-buddy.js takes off anything that is not and writes that down,
         which is how the buddy came out bare-headed in a red body. */
      f.own = ['spiderman', 'magma', 'skyline', 'beach', 'space', 'bubblegum',
               'peony', 'fireworks', 'snd-rain', 'snd-cafe', 'snd-forest',
               'bud-an5', 'bud-e11', 'bud-h12', 'bud-f7', 'bud-o4', 'bud-r1'];
    }
    /* **Bigger than the picture, and the picture cut out of it.**

       Forcing the device scale to 1 on a display that is set to 1.25 leaves
       the compositor disagreeing with itself about how wide the surface is:
       everything past width/1.25 -- exactly four fifths across -- composites
       differently, and comes out as a hard vertical seam down the frame. It
       is invisible on a busy screenshot and obvious on the feature graphic.

       Capturing a rect out of a larger window sidesteps the whole question:
       the seam, if it is there at all, is outside the part being taken. */
    win.setContentSize(W, H);
    /* **Long enough for the window to actually be that size.** A capture
       taken while the resize is still in flight comes out two pixels over,
       and a feature graphic two pixels over is rejected outright rather
       than merely looking untidy next to its neighbours. */
    await wait(1100);
    if (!await load(win, `http://127.0.0.1:${PORT}/?f=${f.file}&t=${Date.now()}`)) {
      console.log(f.file.padEnd(14) + 'could not load'); continue;
    }
    await wait(1500);
    let said = '';
    try { said = await win.webContents.executeJavaScript('window.__shot()'); }
    catch (e) { said = 'threw: ' + e.message; }
    await wait(900);
    const box = await win.webContents.executeJavaScript('window.__fit()')
      .catch(() => ({ w: W, h: H }));
    await wait(250);
    /* **Cropped by measurement.** `capturePage`'s rect is in
       device-independent pixels and `__fit` answers in CSS pixels; on a
       display scaled to 1.25 those differ by a quarter, except when the
       window comes up at a size Windows leaves alone, and then they do
       not. Passing one as the other photographed the page correctly on
       one run and squeezed it into four fifths of the frame on the next.
       The bitmap's own width against the width the page reports is the
       conversion, whatever happened to the window. */
    const raw = await grab(win.webContents, f.file);
    if (!raw) continue;
    const vw = Number(await win.webContents.executeJavaScript('window.innerWidth'))
      || raw.getSize().width;
    const k = raw.getSize().width / vw;
    const shot = raw.crop({ x: 0, y: 0,
      width: Math.min(raw.getSize().width, Math.round(box.w * k)),
      height: Math.min(raw.getSize().height, Math.round(box.h * k)) });
    const img = shot.resize({ width: W, height: H, quality: 'best' });
    writeFileSync(join(outDir, f.file + '.png'), img.toPNG());
    const sz = img.getSize();
    console.log(f.file.padEnd(14) + sz.width + 'x' + sz.height + '  ' + String(said).slice(0, 46));
  }

  /* **A window of its own for the feature graphic.**

     Shrinking the 1080-wide window to 1024 and photographing it left a hard
     vertical seam a fifth of the way in: the compositor keeps the larger
     surface and the capture picks up a strip of the frame before. Nothing
     short of a new window reliably clears it, and a new window costs a
     second. */
  /* Made before the other is closed: Electron quits by itself when the last
     window goes, so destroying this one first ends the process and the
     feature graphic never gets taken. */
  const fw = new BrowserWindow({ width: 1024, height: 500, show: true, frame: false,
    backgroundColor: '#0a1020', webPreferences: { backgroundThrottling: false } });
  win.destroy();
  fw.setContentSize(1024, 500);
  /* Long enough to be composited. A window a few hundred
     milliseconds old has no surface to capture yet, and the retry
     in `grab` should be the safety net rather than the mechanism. */
  await wait(1400);
  await load(fw, `http://127.0.0.1:${PORT}/feature?t=${Date.now()}`);
  await wait(2000);
  const fgBox = await fw.webContents.executeJavaScript('window.__fit()')
    .catch(() => ({ w: 1024, h: 500 }));
  await wait(250);
  const fgWhole = await grab(fw.webContents, 'feature');
  const fgVw = !fgWhole ? 1
    : Number(await fw.webContents.executeJavaScript('window.innerWidth'))
      || fgWhole.getSize().width;
  const fgK = fgWhole ? fgWhole.getSize().width / fgVw : 1;
  if (fgWhole) {
    const fgRaw = fgWhole.crop({ x: 0, y: 0,
      width: Math.min(fgWhole.getSize().width, Math.round(fgBox.w * fgK)),
      height: Math.min(fgWhole.getSize().height, Math.round(fgBox.h * fgK)) });
    const fg = fgRaw.resize({ width: 1024, height: 500, quality: 'best' });
    writeFileSync(join(outDir, 'feature.png'), fg.toPNG());
    console.log('feature'.padEnd(14) + fg.getSize().width + 'x' + fg.getSize().height);
  }

  fw.destroy();
  app.quit();
});
