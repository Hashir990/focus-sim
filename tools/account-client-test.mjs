/**
 * Two devices, one account.
 *
 * The merge test proves the rules and the server test proves the endpoints;
 * this proves the thing anybody actually cares about — sign in on a second
 * device and nothing is lost. It runs the real Worker in-process against an
 * in-memory D1, and the real built app in two jsdom windows whose `fetch` goes
 * to that Worker. No network, no deploy.
 *
 * The failure this exists to catch is the quiet one: a second device signing in
 * and *replacing* the first device's history instead of joining it. That looks
 * like working software right up until somebody loses a month.
 *
 *   node tools/account-client-test.mjs
 */
var PROFILE = null;   // set while the first device is set up, read by the second
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
/* **`pathToFileURL`, not the path.** `import()` takes a URL, and on Windows an
   absolute path *is* a URL — one whose scheme is the drive letter. Node 24
   stopped being lenient about it and the whole suite died on
   `ERR_UNSUPPORTED_ESM_URL_SCHEME ... Received protocol 'd:'`, one line into
   this file, immediately after the server test had printed a clean pass — so it
   read like the server test crashing on its way out. It only ever worked on
   drives called nothing, which is to say on Linux. */
const worker = (await import(pathToFileURL(join(root, 'server', 'accounts.js')).href)).default;

/* The same in-memory D1 the server test uses, lifted rather than copied so the
   two cannot drift apart. */
const stubSrc = readFileSync(join(root, 'server', 'accounts-test.mjs'), 'utf8');
const fakeDB = new Function(
  stubSrc.slice(stubSrc.indexOf('function fakeDB'), stubSrc.indexOf('const DB = fakeDB'))
  + '; return fakeDB;')();
const DB = fakeDB();

let pass = 0;
const fails = [];
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ok  ' + name); return; }
  fails.push(name + (detail ? ' — ' + detail : ''));
  console.log('  ✗   ' + name + (detail ? ' — ' + detail : ''));
};

/* Point this copy at the in-process Worker, whatever the build was made with.

   This used to replace `const ACC_URL = ''` — the empty value a repo with no
   `.env.release` produces — and broke the day accounts were switched on and
   real builds started carrying a real URL. Matching *whatever is there* is the
   only version of this that does not depend on a local config file. */
const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8')
  .replace(/const ACC_URL = '[^']*'/, "const ACC_URL = 'https://acc.test'");
if (html.indexOf("const ACC_URL = 'https://acc.test'") < 0) {
  console.log('could not point the build at a test server — has ACC_URL changed shape?');
  process.exit(1);
}

const device = (seedLog, seedStore) => new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  virtualConsole: new VirtualConsole(), url: 'http://localhost/',
  beforeParse(w) {
    if (seedLog) w.localStorage.setItem('focus_log', JSON.stringify(seedLog));
    /* Anything else this device is supposed to have already. A finished game is
       seeded rather than played: what is under test is whether a save reaches
       an account, and playing 2048 through the DOM to get one would be testing
       2048. The shape is the game's own - see `writeGame` in 09-arcade-core. */
    for (const k in (seedStore || {})) w.localStorage.setItem(k, seedStore[k]);
    w.fetch = async (url, opt) => {
      const res = await worker.fetch(new Request(String(url), { method: 'POST', body: opt.body }), { DB });
      return { json: async () => JSON.parse(await res.text()) };
    };
  },
}).window;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/* **Wait for the thing, not for a number.** The panels here are redrawn when a
   sign-in or a wipe finishes, and a fixed pause is a bet on how long that
   takes. One of these sat so close to the line that merely reading the DOM
   first — one extra tick — was the difference between finding the form and
   crashing on null, which is a test failing for a reason the app does not
   have. Ask for the element until it appears, then give up loudly. */
const until = async (get, what = "it", ms = 5000) => {
  const end = Date.now() + ms;
  for (;;) {
    const got = get();
    if (got) return got;
    if (Date.now() > end) throw new Error(what + " never appeared");
    await wait(25);
  }
};

console.log('\none device, making an account');
const A = device([{ id: 'x1', secs: 1800, ts: 1, at: 1, day: '2026-08-01' }], {
  arcade_2048: JSON.stringify({ board: new Array(16).fill(0), score: 120, best: 2048, won: false, done: false }),
  focus_game_at: JSON.stringify({ arcade_2048: 5 }),
  /* **Owning a few antics, without a purse to match.** They are bought now, and
     the checks below are about where each one draws — so this device needs more
     than the free one. `own` is seeded and the balance is *not*: embers are
     derived from the log by `embersFrom`, so an invented balance here would be
     read as carried history, written into `adjust`, synced, and would break the
     "the account's embers, not the two added up" check further down. Owning
     more than you could afford simply leaves the balance at zero, which is
     true, harmless, and exactly what a test wants. */
  focus_embers: JSON.stringify({
    own: ['seaglass', 'bud-an0', 'bud-an1', 'bud-an2', 'bud-an4', 'bud-an7'],
    light: 'seaglass' }),
});
await wait(800);
{
  const a = A.document;
  /* The corner. Signed out it is the invitation, and it has taken the date's
     place — both being there would be two things competing in a 34px bar. */
  check('the corner offers a way in before anything else happens',
    !a.getElementById('acc-chip').classList.contains('hide')
    && /sign in/i.test(a.getElementById('acc-chip').textContent),
    a.getElementById('acc-chip').textContent);
  check('and the date stands down while it is there',
    a.getElementById('today-wrap').classList.contains('hide'));

  /* **Nothing online without an account.** Rooms, friends and shared games all
     hang off a code the account owns, and everything they earn syncs to it — so
     an evening spent in a room with nowhere to keep the result is the failure
     worth preventing, and preventing it at the door beats delivering the
     disappointment afterwards. */
  a.getElementById('d-sync').click();
  await wait(120);
  check('focus together is shut until you sign in',
    a.getElementById('sync-overlay').classList.contains('hide')
    && !a.getElementById('confirm').classList.contains('hide'),
    a.getElementById('confirm-title').textContent);
  check('and it says why, rather than just refusing',
    /account/i.test(a.getElementById('confirm-body').textContent),
    a.getElementById('confirm-body').textContent.slice(0, 60));
  a.getElementById('confirm-no').click();
  await wait(60);

  a.getElementById('acc-chip').click();
  await wait(200);
  check('tapping it opens the account page',
    !a.getElementById('acct-overlay').classList.contains('hide'));
  check('the panel is there when a server is configured',
    !a.getElementById('acc-box').classList.contains('hide'));
  /* The account page is its own thing now. Your focus is totals and the shelf;
     being asked for a password halfway down a wall of statistics was the
     wrong place to be asked. */
  check('and Your focus no longer carries the sign-in panel or the buddy',
    a.getElementById('stats-overlay').classList.contains('hide')
    && !a.getElementById('stats-overlay').contains(a.getElementById('acc-box'))
    && !a.getElementById('stats-overlay').contains(a.getElementById('bud-box')));
  check('while the account page carries both',
    a.getElementById('acct-overlay').contains(a.getElementById('acc-box'))
    && a.getElementById('acct-overlay').contains(a.getElementById('bud-box')));
  (await until(() => a.getElementById('acc-email'), 'the sign-in form')).value = 'me@example.com';
  a.getElementById('acc-new').click();          // first press reveals the username
  await wait(60);
  check('asking for an account asks for a username first',
    !a.getElementById('acc-user').classList.contains('hide'));
  a.getElementById('acc-user').value = 'hashir';
  a.getElementById('acc-pass').value = 'hunter2hunter2';
  a.getElementById('acc-new').click();
  await wait(800);
  check('and then it is signed in', /hashir/.test(a.getElementById('acc-box').textContent),
    a.getElementById('acc-box').textContent.slice(0, 60));
  /* The one line in the app that was a promise about privacy. */
  check('the menu stops claiming the data stays on this device',
    /synced to your account/.test(a.getElementById('acc-where').textContent),
    a.getElementById('acc-where').textContent);
  check('and the corner becomes who you are',
    /hashir/.test(a.getElementById('acc-chip').textContent)
    && !a.getElementById('acc-chip').classList.contains('out'),
    a.getElementById('acc-chip').textContent);

  /* The buddy only exists once there is an account to keep him in, so this is
     the only place the picker can be looked at. */
  const opts = (k) => [...a.querySelectorAll(`[data-bud="${k}"]`)];
  check('signing in is what brings the buddy',
    opts('e').length > 0 && !/sign in/i.test(a.getElementById('bud-box').textContent),
    a.getElementById('bud-box').textContent.slice(0, 50));
  /* It was numbered, and "Hat 4" does not tell you it is a crown — the only way
     to find out was to press all of them and watch the figure above. */
  check('every face and clothing option is a picture, not a number',
    ['e', 'h', 'a'].every((k) => opts(k).length > 0
      && opts(k).every((b) => b.querySelector('svg') && !/\d/.test(b.textContent))));
  /* The part on its own. At 30px a whole buddy is a blob with a speck on top,
     which is what made numbering look like the better idea to begin with. */
  check('and it shows the thing itself, not a figure wearing it',
    opts('h').slice(1).every((b) => !/r="16"/.test(b.innerHTML)),
    opts('h')[1] && opts('h')[1].innerHTML.slice(0, 50));
  check('colours stay swatches, being pictures of themselves already',
    opts('c').every((b) => b.classList.contains('sw')) && opts('c').length > 0);
  /* And once you are in, the door is open. */
  a.getElementById('acct-close').click();
  await wait(80);
  a.getElementById('d-sync').click();
  await wait(120);
  check('and signing in opens focus together',
    !a.getElementById('sync-overlay').classList.contains('hide'));
  a.getElementById('sync-close').click();
  await wait(60);
  a.getElementById('d-account').click();
  await wait(150);

  /* On the main menu he is always on the minutes box, jumping — that is not
     one of the antics, it is the screen you look at while deciding. */
  check('on the main menu he is on the minutes box',
    !a.getElementById('bud-perch').classList.contains('hide')
    && /<svg/.test(a.getElementById('bud-perch').innerHTML));
  check('and the antic slots are empty while he is there',
    a.getElementById('bud-live').classList.contains('hide')
    && a.getElementById('bud-pause').classList.contains('hide'));

  /* Each antic in the slot it belongs to. The swing and the swim ride the lane;
     the nap sits on the Pause button, which is somewhere else entirely.

     **The picker offers what he owns, and this account has bought nothing.**
     It used to offer every antic the app defines, and that was the right check
     while they were free. They are bought now, and the one everybody starts
     with is the only free one — so what has to hold here is that a new account
     has exactly that one and a way to get the rest. A count against the table
     would now be asserting that nothing is for sale. */
  const antics = [...a.querySelectorAll('[data-anim]')];
  const defined = (html.match(/\{k:'[\w-]+', n:'/g) || []).length;
  const ownHere = (JSON.parse(A.localStorage.getItem('focus_embers') || '{}').own || []);
  check('the antic picker offers exactly the ones he owns, and no more',
    defined >= 8 && antics.length < defined
    && antics.every((b) => ownHere.indexOf('bud-an' + b.dataset.anim) >= 0)
    && antics.length === ownHere.filter((id) => /^bud-an/.test(id)).length,
    `${antics.length} buttons, owns ${ownHere.filter((id) => /^bud-an/.test(id)).join(',')}`);
  check('and the wardrobe says how to get the others',
    !!a.getElementById('bud-shop') && /more to try on/.test(a.getElementById('bud-shop').textContent),
    a.getElementById('bud-shop') ? a.getElementById('bud-shop').textContent : 'no shop button');
  /* Nothing is chosen to begin with — the web-swing is bought like everything
     else now — so this chooses one first and then reads the line. */
  antics[0].click();
  await wait(90);
  check('and choosing one says which it is',
    !!a.querySelector('.bud-anim-name')
    && a.querySelector('.bud-anim-name').textContent.length > 8,
    a.querySelector('.bud-anim-name')
      ? a.querySelector('.bud-anim-name').textContent.slice(0, 40) : 'no line');

  // Actually start a block: `S` lives inside the IIFE and is not reachable
  // from here, so the way to be on the clock screen is to be on the clock.
  a.getElementById('acct-close').click();
  await wait(60);
  a.getElementById('begin').click();
  await wait(200);
  a.getElementById('d-account').click();
  await wait(120);
  /* By the antic's own number rather than by its place in the row: the row is
     what he owns now, so the third button is not antic 2. */
  for (const [i, slot, other, name] of [
    [0, 'bud-live', 'bud-pause', 'swing'],
    [2, 'bud-live', 'bud-pause', 'swim'],
    [1, 'bud-pause', 'bud-live', 'nap on the pause button'],
  ]) {
    a.querySelector(`[data-anim="${i}"]`).click();
    await wait(90);
    check(`${name} draws in its own place`,
      !a.getElementById(slot).classList.contains('hide')
      && /<svg/.test(a.getElementById(slot).innerHTML)
      && a.getElementById(other).classList.contains('hide'),
      `${slot}=${a.getElementById(slot).innerHTML.slice(0, 30)}`);
  }
  /* **The rope belongs to the layer, not to the drawing.** Inside his 64-unit
     viewBox it could never be longer than about fifty pixels, which is a man
     holding a short piece of string rather than a man hanging a long way below
     an anchor. It is an element in the rig now, measured in `vh`, and the rig
     is what rotates — so the rope and the man pivot together about a real
     point instead of him turning on the spot under a line that stays put. */
  a.querySelector('[data-anim="0"]').click();
  await wait(90);
  const rig = a.getElementById('bud-live').querySelector('.bud-rig');
  check('the swing hangs from a rig, not from lines inside the drawing',
    !!rig && rig.querySelectorAll('.bud-rope').length === 2
    && !/bud-web/.test(a.getElementById('bud-live').innerHTML),
    a.getElementById('bud-live').innerHTML.slice(0, 60));
  /* **The anchor is what moves between swings, not the man.** The rope reaches
     the top of the screen (`--rope` in `vh`) and the rig's `left` steps forward
     by exactly the width the rotation gives back — so his position on screen is
     continuous and only the tie-point jumps. Both halves are checked: a rope
     measured against the screen, and an anchor that actually steps. */
  const css = [...a.querySelectorAll('style')].map((n) => n.textContent).join('');
  check('the rope is measured against the screen, so it reaches the top',
    /--rope:\s*[\d.]+(vmin|vh|vw)/.test(css));
  /* **He goes out and comes back, and both ends are off the screen.**

     This used to assert the traverse never decreased, because the lap ran in
     one direction and a decrease meant he was being dragged backwards by the
     rig. The lap is a round trip now — he leaves one side, turns, and returns —
     so decreasing is the *point* over the second half. What still has to hold
     is that it is a clean there-and-back: rising to a single peak, falling to a
     single trough, and starting and ending at the same place so the loop has no
     seam. Anything else is him wandering.

     And both ends must sit outside the window, or the turn happens in view. */
  const go = (css.replace(/\s+/g, ' ')
    .match(/@keyframes bud-go\{(?:[^{}]|\{[^{}]*\})*\}/) || [''])[0];
  const rests = [...go.matchAll(/translate\(\s*(-?[\d.]+)vw,\s*0\)/g)].map((m) => Number(m[1]));
  check('the traverse goes out and comes back, once, to where it began', (() => {
    if (rests.length < 4) return `only ${rests.length} resting positions`;
    if (rests[0] !== rests[rests.length - 1]) return `starts ${rests[0]}, ends ${rests[rests.length - 1]}`;
    const peak = rests.indexOf(Math.max(...rests));
    const up = rests.slice(0, peak + 1), down = rests.slice(peak);
    if (!up.every((v, i) => i === 0 || v > up[i - 1])) return 'the way out is not monotonic';
    if (!down.every((v, i) => i === 0 || v < down[i - 1])) return 'the way back is not monotonic';
    return true;
  })() === true, rests.join(' '));
  check('and he turns round off the screen, not in front of you',
    rests.length > 0 && Math.min(...rests) < 0 && Math.max(...rests) > 100,
    rests.join(' '));
  /* And the pivot has to sit on the rope, or rotating swings the *anchor* round
     in a circle — the web following him about instead of him swinging under it. */
  check('and the rig turns about the point the web is tied to',
    /transform-origin:\s*72%\s*0/.test(css.replace(/\s+/g, ' ')));
  /* **Nothing animated may depend on a custom property.** The rig's rotation
     ran and the traverse did not, and the only difference was that the traverse
     read its distance out of `var(--jump)` inside `@keyframes` — so he swung on
     the spot in the corner. Variables are fine in static properties; in an
     animated value they are a coin toss across engines. */
  check('and no animated value is left depending on a variable',
    !/@keyframes bud-(go|arc|lift|web-a|web-b)\{(?:[^{}]|\{[^{}]*\})*var\(/
      .test(css.replace(/\s+/g, ' ')),
    'a keyframe still reads var()');
  check('while the man himself is drawn in the same square as everywhere else',
    /viewBox="0 0 64 64"/.test(rig.querySelector('svg').outerHTML));
  /* **He may use viewport units — he may not escape.** The old rule here was
     "no `vw` anywhere", which was right while he lived inside the timer column
     and viewport units meant a box he was not in. He is in a fixed, full-screen
     layer now, so `vh` and `vw` mean exactly what they say and the swing is
     written in them deliberately. What still has to hold is that the layer
     clips — it is the only thing between a rope a quarter of a screen long and
     a buddy halfway down somebody's desktop. */
  const sheet = [...a.querySelectorAll('style')].map((n) => n.textContent).join('\n');
  check('the buddy layer is fixed to the screen and clips what leaves it',
    /\.bud-layer\{[^}]*position:fixed/.test(sheet)
    && /\.bud-layer\{[^}]*overflow:hidden/.test(sheet),
    (sheet.match(/\.bud-layer\{[^}]*\}/) || [''])[0].slice(0, 90));
  /* A flourish you can switch off — and switching it off must not take the
     editor away with it. */
  a.getElementById('bud-onscreen').checked = false;
  a.getElementById('bud-onscreen').dispatchEvent(new A.Event('change'));
  await wait(80);
  check('switching him off takes him off the screen, not out of the app',
    a.getElementById('bud-perch').classList.contains('hide') && opts('e').length > 0);

  /* A quote of his own, written the way anybody writes one. Quotes were device
     data: the bank lived in `focus_quotes` and nothing carried it, so one
     written on a phone stayed on the phone. */
  a.getElementById('acct-close').click();
  await wait(60);
  a.getElementById('d-quotes').click();
  await wait(120);
  a.getElementById('q-text').value = 'Deep work is the point.';
  a.getElementById('q-author').value = 'Hashir';
  a.getElementById('q-save').click();
  await wait(80);
  check('a quote written here is kept with an id to travel under',
    (JSON.parse(A.localStorage.getItem('focus_quotes') || '[]')[0] || {}).id !== undefined,
    A.localStorage.getItem('focus_quotes'));
  a.getElementById('q-back').click();
  await wait(60);
  a.getElementById('d-account').click();
  await wait(150);

  /* Set up a profile worth carrying, then push it, so the second device has
     something recognisable to receive. Him back on, a face, and an antic. */
  a.getElementById('bud-onscreen').checked = true;
  a.getElementById('bud-onscreen').dispatchEvent(new A.Event('change'));
  /* A colour rather than a part: colours are free and every one of them is
     there from the first minute, so this is the only change that is guaranteed
     to be available on a device that has bought nothing. */
  const skin = a.querySelectorAll('[data-bud="c"]')[3];
  if (skin) skin.click();
  const shade = a.querySelectorAll('[data-bud="b"]')[2];
  if (shade) shade.click();
  /* One he owns and did not start with, so what crosses to the second device is
     a real choice rather than the default. */
  const antic = [...a.querySelectorAll('[data-anim]')].find((b) => +b.dataset.anim > 0);
  if (antic) antic.click();
  await wait(120);

  /* **Which antic he does is a draft until Save is pressed**, exactly like the
     rest of him. Choosing one used to take effect on the spot — it was written
     down and sent to everybody in the room the instant you touched a button,
     so there was no way to look through them, and Undo could not take back
     something already gone. Everything on this page now moves together. */
  check('choosing an antic changes nothing on its own',
    (JSON.parse(A.localStorage.getItem('focus_sim') || '{}').budAnim | 0) === 0,
    A.localStorage.getItem('focus_sim'));
  check('and the page says so while it is unsaved',
    /Unsaved changes/.test(a.querySelector('.bud-save').textContent),
    a.querySelector('.bud-save').textContent.slice(0, 40));
  a.getElementById('bud-save').click();
  await wait(150);

  /* Nothing is on `window` — it is all one IIFE — so the push is made the way
     a person makes it, with the button. */
  a.getElementById('acc-sync').click();
  await wait(900);
  const mine = JSON.parse(A.localStorage.getItem('focus_sim') || '{}');
  check('the chosen antic is written down on the way out',
    mine.budAnim > 0, JSON.stringify(mine.budAnim));
  PROFILE = { budAnim: mine.budAnim, face: mine.face, buddy: JSON.stringify(mine.buddy || null) };

  /* **One account, one code.** A friend code used to be per device, so signing
     in on a phone and a laptop gave you two of them and "my code" meant nothing
     to whoever you handed it to. It is derived from the username now; the
     second device is checked against this one further down. */
  a.getElementById('acct-close').click();
  await wait(60);
  a.getElementById('d-sync').click();
  await wait(150);
  PROFILE.code = a.getElementById('sync-mycode').textContent.trim();
  check('a signed-in device has a code at all', /^[0-9A-Z]{6}$/.test(PROFILE.code), PROFILE.code);
  a.getElementById('sync-close').click();
  await wait(60);
}

console.log('\na second device, with its own history');
const B = device([{ id: 'x2', secs: 2400, ts: 2, at: 2, day: '2026-08-02' }]);
await wait(800);
{
  const b = B.document;
  // the other way in: the menu row rather than the corner
  b.getElementById('d-account').click();
  await wait(150);
  check('the menu row opens the same page',
    !b.getElementById('acct-overlay').classList.contains('hide'));
  (await until(() => b.getElementById('acc-email'), 'the sign-in form')).value = 'me@example.com';
  b.getElementById('acc-pass').value = 'hunter2hunter2';
  b.getElementById('acc-in').click();
  await wait(150);

  /* **Signing in replaces this device; it does not merge into it.**

     This used to join the two histories, and that was the same hole as the
     sign-out wipe seen from the other side: sit down at a machine with an
     afternoon of somebody else's work on it, sign in, and their hours — and
     anything those hours had bought — are silently yours. Whatever is on a
     device before you sign in came from somewhere else.

     Making an account is the opposite case and still carries everything across:
     a new account has never held anything, so this device's work is the only
     copy there is. That path is exercised at the top of this file. */
  check('signing in warns before it clears the device',
    !b.getElementById('confirm').classList.contains('hide'));
  check('and says what is about to go, in so many words',
    /1 session/.test(b.getElementById('confirm-body').textContent),
    b.getElementById('confirm-body').textContent.slice(0, 110));
  check('and offers making an account as the way to keep it',
    /make a new account/i.test(b.getElementById('confirm-body').textContent));

  /* Cancelling has to be free. Nothing has been sent and nothing removed. */
  b.getElementById('confirm-no').click();
  await wait(200);
  check('cancelling leaves the device exactly as it was',
    JSON.parse(B.localStorage.getItem('focus_log') || '[]').length === 1
    && !JSON.parse(B.localStorage.getItem('focus_account') || '{}').token,
    B.localStorage.getItem('focus_log'));

  b.getElementById('acc-in').click();
  await wait(150);
  b.getElementById('confirm-yes').click();
  await wait(900);
  const log = JSON.parse(B.localStorage.getItem('focus_log') || '[]');
  check('confirming replaces this history with the account’s',
    log.some((r) => r.id === 'x1') && !log.some((r) => r.id === 'x2'),
    log.map((r) => r.id).join(',') || 'nothing');
  /* 30 minutes is three whole embers — the account's own, derived from the
     account's own history, with nothing of this device's added in. */
  const emb = JSON.parse(B.localStorage.getItem('focus_embers') || '{}');
  check('and the ember balance is the account’s, not the two added up',
    emb.earned === 3, `${emb.earned} earned`);

  /* **The profile has to arrive, not just the hours.**

     This is the half that makes an account an account. It also has a trap in
     it: signing in *wipes* this device first, and a wipe writes settings. Left
     stamped with the current time those writes out-rank everything the account
     holds — `mergeSim` takes the newer — so the buddy, the antic, the theme and
     the clock face would all be judged stale on arrival and thrown away. You
     would sign in on a new machine and watch your profile reset to defaults.
     The wipe stamps 0 for exactly this reason; see `save()` in 02-persistence. */
  const got = JSON.parse(B.localStorage.getItem('focus_sim') || '{}');
  check('the antic chosen on the other device came across',
    !!PROFILE && got.budAnim === PROFILE.budAnim,
    `${got.budAnim} here, ${PROFILE && PROFILE.budAnim} there`);
  check('and the settings were not judged stale by the wipe that preceded them',
    !!PROFILE && got.face === PROFILE.face && JSON.stringify(got.buddy || null) === PROFILE.buddy,
    `${got.face}/${JSON.stringify(got.buddy || null)} here, `
    + `${PROFILE && PROFILE.face}/${PROFILE && PROFILE.buddy} there`);

  /* The rest of what a profile is. Each of these was device-only, and each of
     them read as the account quietly not working: a quote bank that stayed
     behind, an arcade that started again from nothing, and post going to a code
     nobody was listening on. */
  const quotes = JSON.parse(B.localStorage.getItem('focus_quotes') || '[]');
  check('the quotes he wrote came with him',
    quotes.some((q) => /Deep work/.test(q.t)), JSON.stringify(quotes).slice(0, 80));

  const g = JSON.parse(B.localStorage.getItem('arcade_2048') || 'null');
  check('and so did the arcade, best score and all',
    !!g && g.best === 2048, JSON.stringify(g && g.best));

  b.getElementById('acct-close').click();
  await wait(60);
  b.getElementById('d-sync').click();
  await wait(200);
  check('and both devices answer to one room code',
    b.getElementById('sync-mycode').textContent.trim() === PROFILE.code,
    `${b.getElementById('sync-mycode').textContent.trim()} here, ${PROFILE.code} there`);
  b.getElementById('sync-close').click();
  await wait(60);
  b.getElementById('d-account').click();
  await wait(150);
  /* **Signing out empties the device**, because otherwise signing into
     somebody else's account, syncing their embers and signing out again keeps
     everything they had bought. The account is the only home for progress once
     there is an account. */
  b.getElementById('acc-out').click();
  await wait(80);
  check('signing out asks first, because it clears this device',
    !b.getElementById('confirm').classList.contains('hide'));
  check('and says where the history is going, not that it is safe',
    /stays in the account/i.test(b.getElementById('confirm-body').textContent),
    b.getElementById('confirm-body').textContent.slice(0, 80));

  b.getElementById('confirm-yes').click();
  await wait(900);
  check('confirming empties the history',
    JSON.parse(B.localStorage.getItem('focus_log') || '[]').length === 0,
    B.localStorage.getItem('focus_log'));
  check('and the embers with it',
    (JSON.parse(B.localStorage.getItem('focus_embers') || '{}').earned | 0) === 0,
    B.localStorage.getItem('focus_embers'));

  /* Emptied, not destroyed — which is the whole claim the dialog makes. */
  (await until(() => b.getElementById('acc-email'), 'the sign-in form')).value = 'me@example.com';
  b.getElementById('acc-pass').value = 'hunter2hunter2';
  b.getElementById('acc-in').click();
  await wait(1200);
  /* The account's own history, which is what was put into it — this device's
     own hours went when it signed in the first time and are not coming back. */
  check('and signing back in brings the account’s history back', (() => {
    const l = JSON.parse(B.localStorage.getItem('focus_log') || '[]');
    return l.some((r) => r.id === 'x1') && !l.some((r) => r.id === 'x2');
  })(), B.localStorage.getItem('focus_log'));
}

/* ---- what the band says when a sync does not work ----

   **"Could not reach the server" used to be the answer to every question.**
   `_post` throws the server's own words whenever it answers `ok:false` — rate
   limited, snapshot refused, no database bound, a route that moved — and every
   one of them came out as a network problem, which sends whoever is reading it
   to look at their wifi. A request that never arrived is the only thing that
   deserves that sentence, and in a browser that is a `TypeError` out of `fetch`
   itself, which is a thing the server cannot cause.

   Driven through the band's own button, with the transport swapped underneath
   it, because the discrimination is in the catch and nowhere else. */
{
  const b2 = B.document;
  const real = B.fetch;
  /* The note is the line under the username in the account panel. */
  const band = () => { const el = b2.querySelector('.acc-in span'); return el ? el.textContent : '(no panel)'; };
  const sync = async () => {
    const btn = b2.getElementById('acc-sync');
    if (btn) btn.click();
    await wait(600);
  };

  // 1. the server answers, and says why
  B.fetch = async () => ({ json: async () => ({ ok: false, error: 'the vault is having a lie down' }) });
  await sync();
  check('a server that answers with a reason has its reason shown',
    /lie down/.test(band()) && !/could not reach/i.test(band()), band().slice(0, 120));

  // 2. the request never arrives
  B.fetch = async () => { throw new B.TypeError('Failed to fetch'); };
  await sync();
  check('and only a request that never arrived is a server out of reach',
    /could not reach the server|offline/i.test(band()), band().slice(0, 120));

  B.fetch = real;
}

console.log('\n' + pass + '/' + (pass + fails.length) + ' account client checks passed');
if (fails.length) { fails.forEach((f) => console.log('   ' + f)); process.exit(1); }
process.exit(0);
