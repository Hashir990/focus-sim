# Handoff — Focus Simulator

Everything a fresh session needs, short. The *reasoning* for anything specific
lives in a comment beside the code; this is the map, not the territory.

**Root:** `D:\Focus` · **Owner:** Hashir · **Version:** see package.json

> ### Update this file after every change
> Not at the end of a session — after each change that lands. Add a line to
> §9, and amend anything above it that stopped being true. The next session
> starts by reading this and believes it; a stale line here costs more than the
> minute it takes to fix. If you changed behaviour, a test in §5 should have
> changed with it.

---

## 1. What it is

A Pomodoro timer with a rest arcade, a session calendar that also plans ahead,
stats, tasks, ambient audio, an earned-cosmetics economy, achievements, and
peer-to-peer shared sessions with five two-player games.

Ships as one self-contained `dist/index.html` — also an Electron desktop app, a
PWA, and an Android/iOS build via Capacitor. Nothing it does needs a server:
the update check, the mailbox and accounts are each opt-in by having a URL
stamped into the build, and with none of them it is an offline app that talks
only peer-to-peer for shared rooms.

## 2. The one architectural idea

**`src/` holds fragments of a single shared closure, concatenated in filename
order into `dist/index.html` by `tools/build.mjs`.** No bundler, no modules.

Rules that follow:

- Never add `"use strict"` or wrap a file in a function. `00-prelude.js` opens
  the IIFE, `99-outro.js` closes it and must sort last.
- If B uses a `const`/`let` from A at load time, **A's number must be lower**.
  Function declarations hoist across the whole script, so they are exempt — this
  is why most cross-file calls are functions.
- **There is no global `.hide` rule.** Every component declares its own
  `.thing.hide{display:none}`. Game containers need
  `#game-x .hide{display:none !important}`.
- Edit `src/`, never `dist/`. Rebuild with `npm run build`.

## 3. Layout

```
src/head.html            <head>, fonts, meta
src/body/*.html          markup fragments, filename order
src/css/*.css            styles, filename order
src/js/*.js              closure fragments, filename order
tools/                   build, tests, generators, release
electron/                desktop shell + auto-updater
server/                  two optional Workers: the mailbox (offline messages)
                         and accounts (sign-in and sync)
```

Numbering to know: `05` timer engine · `06` render · `17a` plan (calendar
scheduling) · `18` calendar · `25` tasks · `26/27` crossword · `29` sync ·
`37` embers · `38` VFX · `40` achievements · `41` update check · `42` dev hook ·
`43` clock faces · `44` the back button · `45` notifications and the background ·
`46` your buddy · `47` merge rules · `48` accounts (client) · `49` idling.

## 4. Commands

```
start.cmd                build + run, one double-click (see below)
npm run build            src/ → dist/index.html (+ dist/dev-unlocked.html)
npm run dev              build, watch, serve on :4321
npm test                 build + full smoke test
npm run electron         run the desktop shell
npm run publish:check    is a release ready? (token, repo, version)
npm run release patch "what changed"
npm run publish:win      build installer, upload, attach latest.json
```

**`start.cmd` exists because there are two of this app on the machine.** The
Start-menu shortcut runs the *installed* copy, which only changes when a version
is published; `npm run electron` and `start.cmd` rebuild from `src/` and run
that. Editing the source and then launching from the Start menu shows the old
app. That is not hypothetical — an entire afternoon of swing animation feedback
was given against a three-day-old binary before anyone checked the build stamp
in the menu footer. `start.cmd` prints that stamp before it opens the window.

**Check the footer first whenever a change appears to have done nothing.**

## 5. Tests

`tools/smoke-test.mjs` drives the built file in jsdom — one file, ~800 checks.
It is the only test that matters and it must stay green.

In this sandbox a shell call is capped at around 178s, and the full file does
not fit. `tools/slice.mjs` cuts the *current* test at a line number and staples
a verdict on, so there is never a stale hand-cut copy to keep in step:

```
node tools/slice.mjs 900 ~/run              # everything up to ~line 900
cd ~/run && node slice-run.mjs \
  /sessions/<id>/mnt/Focus/dist/index.html  # prints n/n passed
```

**Write the slice to `~/run`, not into the repo.** Running it from inside the
repo makes `import jsdom` alone take ~40s (see below), and the whole pass then
does not fit in one call. From `~/run`, with its own local `jsdom`, a full pass
takes about 90s.

It cuts back to the nearest `}` at the left margin, because the file is a series
of `{ … }` blocks and truncating inside one gives `Unexpected end of input`.
Only forward slices work — later blocks build on windows opened earlier — so to
test the end of the file, run to the end and read the tail. A full pass needs
two or three calls.

The older `~/run/tools/*.mjs` slices are from the 8th and do **not** have any of
this month's checks. Do not trust a green run from them.

Two things about the sandbox that each looked like a hanging test:

- **`node_modules` must be local, not the repo's.** Symlinking or copying the
  repo's copy makes `import jsdom` alone take over 40s, because resolving it
  reads hundreds of files back across the Windows mount. The slice then dies in
  the prelude having printed nothing, which reads exactly like an infinite loop.
- **Backgrounding does not survive.** A `nohup … &` process is killed at the end
  of the shell call that started it, so each slice has to *finish* inside one
  call. `pgrep -f smoke-test` will match your own shell command and report a run
  as alive long after it was killed; check `wc -l` on the log instead.

**Green slices do not mean a green `npm test`.** Each slice prepends whatever
setup its block needs, so a block that depends on state the *previous* block
tore down still passes in isolation. Run the whole file on Windows before
shipping.

`account-client-test.mjs` has also outgrown one shell call from inside the repo
— it passes in ~150s there and the cap bites at ~178s. It resolves everything
from its own parent, so to run it from `~/run` it needs `~/dist/index.html` and
`~/server/*` beside it, and then it finishes in about half the time:

```
cp dist/index.html ~/dist/ && cp server/* ~/server/
cp tools/account-client-test.mjs ~/run/acct.mjs && cd ~/run && node acct.mjs
```

Current, all green: **smoke 830**, `account-client-test` 56, `accounts-test` 66,
`merge-test` 48, `scrabble-rules-test` 28, `mailbox-test` 31 — **1059 checks**.
(Three crossword-bank checks want ten puzzles at every size and the background
job is still short of that — `ship-release.ps1 -AllowBankInProgress` is what
that flag is for, and nothing else belongs in it. A *fourth* red, the no-repeat
rule, was the check being wrong rather than the bank; see §6.)

Four of the tools are eyes rather than tests, and need playwright + a Chromium:
`look-swing.mjs` measures whether each antic's animations still share one clock,
`look-glass.mjs` photographs the hourglass at both phases, `look-parts.mjs`
draws every part at icon size and worn (`--tint=7` to check the dye), and
`look-shop.mjs` shoots the shop and the wardrobe. None runs in `npm test`; all
of them run in the sandbox.

## 6. Gotchas that have each cost real time

- **`n` is taken.** Every entry in every buddy part table starts `n:'Pendant'`
  — that is its *name*. Adding a layer called `n:` gave the object literal two
  of them, the second won, and the shop listed a path string where the name
  goes. The neck layer is `nk`.

- **A count that is cheap for a list is not cheap for a keystroke.**
  `Cross._clues(i, rec)` re-parses the grid and re-reads the saved record. That
  is fine once for a list and ruinous on every letter typed, which is where the
  calendar's record is written from — it more than doubled the suite's runtime
  before anyone noticed a slow app. `_cluesNow()` reads `this.puz` and
  `this.user`, both already in hand.

- **Write the calendar record where the board is written, not on the clock's
  beat.** The record used to go down every ten seconds, so a puzzle put away
  between beats lost its last few clues off the calendar. `dailyMark` is a
  no-op when nothing changed, so calling it from `persist()` is free.

- **An `<svg>` clips to its own viewBox unless you say otherwise.** The buddy's
  box stops at y=0 and half the hats go above the crown — a party cone's pompom
  is at −6.6. `.bud-slot svg` has had `overflow:visible` since the jester was
  drawn; the two *editing* stages never got it, so every tall hat was sliced
  flat in the wardrobe and nowhere else. Padding on the box around it cannot
  help: the crop is happening inside.

- **A cord goes behind a head, and `worn.s` is painted after the head.** That is
  why a necklace could only ever start below the jaw and hang there. `budPart`
  returns three layers now — `b` behind everything, `n` between the coat and
  the skull, `s` over the lot — and anything that loops round the neck puts its
  loop in `n`.

- **A second overlay over the first is two washes, not one.** `.overlay` is 96%
  of the background on purpose, so the weather shows through. Open one over
  another and you get ~92%: the puzzle calendar drew its month grid over the
  words of the game underneath. An overlay that opens over an overlay needs a
  solid background and a higher `z-index`.

- **Never seed a shared generator from a module-level variable.** The daily
  puzzles pass `rnd` down into `sShuffle`/`sFill`/`sMake` as an argument
  precisely so the functions stay pure — a hidden seed that some other call
  advances is a puzzle that is reproducible in testing and different in the
  wild. Same reason `pktDay` returns a string: two devices comparing `Date`
  objects agree about an instant and disagree about a day.

- **The crossword bank is append-only, and now it is load-bearing.** A puzzle's
  release date is its position in its size's list counted from `DAILY_EPOCH`.
  Insert one in the middle and every date after it shifts — which relabels
  history and orphans every board saved against those days. Append.

- **Raising a price re-charges everybody who already paid the old one.** The
  balance is derived, so `spent` is recomputed over `own` at whatever the table
  says *today*. Putting the lights, sounds and clock faces up took hundreds of
  embers off long-standing accounts in one update and put several on zero. The
  shape that works: freeze the old numbers (`EMB_WAS`), record what each device
  was holding when the rise landed (`Embers.grand`, written once in `load()`
  when the stored key is absent — `null` means "has not met the rise", `[]`
  means "met it owning nothing", and the two must not be confused), and price
  the owned list with `paidFor` rather than `priceOf`. `grand` has to merge, or
  a second device re-charges the difference. **A per-device flag plus a bump to
  `adjust` does not work** — `adjust` merges by `max` and two devices updating
  weeks apart each add the credit, so the second one doubles it. Anything
  derived has to stay derived.

- **`A r r 0 0 1` is the small arc, and the small arc is not the one you want
  over a head.** Two points 32.5 apart on a circle of 16.4 admit two centres;
  the small-arc flag picks the one *below* the chord, which crests at y=14.6
  against a skull that starts at 11. Every hairstyle had four units of bare
  scalp above it for that reason, and no amount of adjusting the radius fixes
  it (a small arc's sagitta cannot exceed its radius). `0 1 1` picks the head's
  own circle. The hats get away with `0 0 1` by luck of having narrower chords.

- **Anything in `worn.s`, `face.s` or `hatSvg` is painted after the head, so
  the head does not cover it.** The skull is `cx=32 cy=27 r=16` — its lowest
  point is y=43. A strap, cord or ribbon that begins at 41 is drawn *on his
  jaw*, not behind it. Nothing worn starts above 44.2.

- **A translucent fill cannot hide what is behind it, whatever the paint
  order.** `.hg-sand` was `opacity:.85`, so the falling grains showed straight
  through the heap they had landed in — and the `insertBefore` that moves the
  stream behind the receiving bulb was doing its job perfectly the whole time.
  Mix the alpha into the colour (`color-mix(... var(--bg))`) when the thing is
  meant to be opaque.

- **A sticky box pinned at `top:0` inside a padded scroller leaves a gap, and
  filling it with a `box-shadow` in `--card` fills it with glass.** `--card` is
  translucent; the shadow also follows the border radius, so what you get is a
  see-through band with square ends over rounded corners. Pin at `-6px` (the
  scroller's own padding) and square off the top corners: the box's own opaque
  background covers the padding and the overflow clips the overshoot.

- **A rule that strips things must know it is looking at the real list.**
  `Embers.own` is `['seaglass']` until the record comes back out of storage,
  and `budOwns` answers "no" for anything it cannot read — so `budStrip` run in
  that window takes everything off him and writes it down. `Embers.ready` (set
  *after* the await in `load()`, unlike `loaded`, which is the re-entrancy latch
  and goes up before it) is the only honest answer. And prefer hiding to
  clearing: `budAnimIdx()` already returns -1 for an unowned antic, so
  overwriting `S.budAnim` bought nothing and lost the choice permanently.

- **A price table beside a drawing table, and a check that they match.** Parts
  are drawings; keeping a `cost` on each one would mean every art change
  touching the economy and every price change touching the art. `BUD_COST` in
  46-buddy.js is one row per list, in the same order as the list, and
  `tools/smoke-test.mjs` fails if the two ever come apart — which is the only
  reason it is safe to keep them separate. **Anything that can appear in
  `Embers.own` must be priceable by `priceOf`** (37-embers.js), because the
  balance is *derived*: `embersFrom` works out what has been spent by pricing
  the list, so an id nothing recognises is a thing that was bought for nothing.
  That is why every buddy purchase is filed as `bud-<row><index>` and parsed
  back by `budPriceOf` rather than being given a friendly name.

- **Recolouring a drawing from the outside beats putting tokens in it.** The
  obvious way to dye a part is `%A%` and `%B%` in the path data and a colour
  pair per item — thirty hand-tuned drawings to rewrite and two shades to get
  right in each. `budDye` reads the hexes already in the string and maps each
  onto the chosen hue at the lightness it already had, keyed off the *first*
  colour (these are written back to front, so the first fill is the garment and
  the rest are its trim). Both layers of a coat are read together or a cape's
  lining picks a different base from its back. Index 0 returns the string
  untouched, so nothing anybody is already wearing moved by a pixel.

- **Two clocks that must start together: the slot and what is inside it.** Every
  antic is written as one animation on the slot that carries him across the
  window (`bud-go` 7.8s for the swing, `bud-skate-lap` 48s for the board) and
  more inside it doing the swinging, the mirroring and the turn. Every period is
  an exact fraction of the lap, so started together they stay locked for ever —
  and nothing in CSS re-locks them. `stage()` refilled the slot with
  `innerHTML`, which builds a new rig whose animations start *now* while the
  slot's own carries on from wherever it had got to. From that moment he swings
  backwards under his own web, hangs off nothing at the edge of the window, and
  the skateboard turns before it reaches the corner. Both were reported as
  "sometimes broken, but not always"; the "not always" is that it only begins
  when something re-renders him mid-lap — saving a colour, an account arriving,
  switching him off and on again. The slot is now *replaced* rather than
  refilled: a fresh element starts everything it contains at one moment. Measure
  it with `tools/look-swing.mjs`, which reads `startTime` off `getAnimations()`
  in a real browser and prints the drift per antic — 700ms+ against the old
  code, 0 against this one. jsdom has no animation engine and cannot see any of
  it, which is how it survived a green suite; the smoke test can only check the
  mechanism, that the node is a new one.

- **A check asserting a rule the data no longer keeps is worse than no check.**
  The crossword no-repeat check wanted `GAP = 4` — no answer inside four puzzles
  at a size. `tools/build-crosswords.py` retired that: "GAP is 2, so only the
  immediately preceding puzzle's answers are blocked at a size. Words recycle by
  design." Against today's bank that is 0 breaches at 2, 27 at 3, 36 at 4 — so
  every release was blocked by a test that was wrong, about data that was right,
  and the habit that forms is waving crossword failures through. The number
  lives in the generator; the check now says so beside itself. Same family: "the
  bank holds every size the picker offers" was written as `=== '5,7,9'` and
  started failing the day fifteens were added, i.e. because a feature worked. It
  asks the picker for its own row of sizes now and checks the direction that
  matters — that no puzzle sits at a size nobody can select.

- **Turning a picture over moves which edge things fall onto.** The hourglass
  face swaps which bulb is filling for a break, and the stylesheet rotates the
  whole face 180deg to say the glass has been turned over. Both were right and
  the sand still collected at the top, because each bulb's fill was a band held
  against a *fixed* edge — the upper one against the neck, the lower one against
  the base. Rotated, those are the high edges: the sand hung off the ceiling of
  one bulb and dangled from the neck of the other. The amounts were never wrong;
  the gravity was. `facePaint` now hands each bulb the edge its sand rests on
  and the direction its surface grows, and both flip with the glass. Anything
  drawn against an edge and then rotated has this bug waiting in it.

- **The server has its own copy of the merge rules, and it rebuilds the
  snapshot.** `server/accounts.js` names every key it keeps; a key it does not
  name is not passed through, it is *dropped*. Because a first write is stored
  verbatim, adding something to `Account.snapshot()` and forgetting the server
  looks like it works — right up to the second device, whose put merges and
  returns a snapshot with your addition missing. That is what "my quotes do not
  follow me" was. Change `src/js/47-merge.js` and `server/accounts.js` in the
  same edit; `server/accounts-test.mjs` now writes a snapshot with every key in
  it, twice, and checks they all survive.

- **To rotate something against a surface, the pivot has to be the contact
  point — so give it no size at all.** The skater rides the whole perimeter of
  the window: floor, right wall, ceiling upside down, left wall, one continuous
  turn per lap. The first version rotated a 55px box about its own middle, which
  swung the drawing half a width clear of every wall it was supposed to be
  riding. `.bud-ride` is `width:0;height:0;transform-origin:0 0`, the drawing
  hangs off it by half a width across and 1.1 heights up (1.1 because the wheels
  are drawn below the 64-unit box and it is the wheels that touch), and the
  keyframes place that one point. Corners then need no special cases: the same
  four `translate()` values put the contact patch on each corner in turn.

  **And the rotation must never unwind.** 0 -> -90 -> -180 -> -270 -> -360 all
  the same way round, so the -360 at the end *is* the 0 at the start. Mixed
  signs spin him backwards at one corner; stopping at -270 and returning to 0
  unwinds three quarters of a turn at the seam, in view, every lap.

- **An eased traverse cannot be in step with anything.** The pacer walked an
  `ease-in-out` lap against a fixed stride, so at the slow ends he was still
  stepping and barely moving — feet going, floor not, and it is worst exactly
  where the eye rests longest. A changing speed against a fixed cadence has no
  correct stride length. `linear`, and then one constant speed means one
  constant distance per step and the two stay locked with nothing to recompute.
  The turn is instantaneous rather than a hold for the same reason: a hold is
  time spent stepping and going nowhere.

- **A grid is bounded by the window's height, not only its width.** The
  crossword sized itself on width alone, which is invisible at 380px and wrong
  the moment the fifteens asked for 560: on a 768-tall window the puzzle ran
  from y=300 to y=860 and a third of it was under the fold, with no way to see
  the whole thing at once. `--cw-size` is now `min(width cap, 100dvh - chrome)`
  and the cell font is derived from *it* rather than from `vw` — a wide, short
  window was otherwise putting a 27px letter in a 28px square.

- **A test that counts is a hostage to the next feature.** `account-client-test`
  asserted `antics.length === 3`, which was true the day it was written; adding
  a fourth antic put a red check between a finished change and a release, and
  the check was not wrong about anything real. It counts what the app defines
  now — a button missing there is an antic that exists, syncs and animates and
  that nobody can choose, which is the failure actually worth catching.

- **`npm test` is seven files and `smoke-test.mjs` is only the loudest.** Work
  done against `node tools/smoke-test.mjs` alone can be green all afternoon and
  still fail the suite: `account-client-test.mjs` drives the *signed-in* picker
  and is where every check about the antic list lives, and it needs `server/`
  present to run at all. If your working copy has no `server/` directory, you
  are not running the half of the tests that covers the account, sync and the
  buddy editor.

- **On Windows an absolute path is a URL whose scheme is the drive letter.**
  `await import(join(root, 'server', 'accounts.js'))` had been in
  `account-client-test.mjs` since it was written and worked everywhere it was
  ever run — which was Linux, where paths start with a slash and no scheme is
  implied. Node 24 stopped being lenient, and the whole suite died with
  `ERR_UNSUPPORTED_ESM_URL_SCHEME ... Received protocol 'd:'` on the *first line*
  of that file, immediately after the server test had printed a clean 59/59. It
  reads exactly like the server test crashing on its way out, and it is not that
  at all. `import()` takes a URL: **`pathToFileURL(p).href`, always.** A relative
  specifier like `'./build.mjs'` is fine; a joined absolute path never is.

- **A round line cap is half a stroke width of shape you did not ask for.** The
  hi-vis vest's reflective bands were `stroke-linecap:round` told to run from
  x=19, the exact edge of the garment — so they actually started at 17.7 and
  hung a unit and a third out in mid-air, at both ends, on both bands. It reads
  as "sharp shape edges" or as sloppy drawing, and it is neither: it is one
  keyword. Butt caps and ends computed against the real silhouette, or round
  caps with the ends pulled in by half the width. **And the silhouette is not
  the bounding box** — the body is a pill whose bottom corners round in by nine,
  so it is 21.3 to 42.7 wide at y=52 and 23.9 to 40.1 at y=54. The cardigan's
  placket had the mirror-image bug: stopped *short* of the hem and left a square
  notch of body colour hanging below a rounded coat.

- **A non-greedy regex ends at the first match anywhere, not the first match in
  the thing you meant.** Deleting the tightrope's `BUD_PROPS` entry with
  `/\*\* Below the fists.*?stroke-linecap="round"\/>'\},/s` ran straight past
  it — the tightrope's entry does not end in a round cap — and swallowed the
  jetpack's as well. Nothing failed: the build succeeded, the tests passed, and
  the jetpack simply had no jetpack. Rendering it is what found it. **After any
  scripted edit to the part tables, look at the pictures** (`tools/look-poses.mjs`).

- **A prop drawn inside the silhouette is a prop nobody sees.** The jetpack was
  a cylinder on his back and two tanks at his shoulders. The body rect covers
  x 19..45 and the head covers roughly x 16..48 above y 43, so the cylinder was
  behind the torso, the tanks were behind the skull, and what reached the screen
  was two grey slivers. The balance pole had the opposite problem — a *front*
  prop is painted after the limbs, so a bar level with the fists simply covered
  the hands holding it. Only three strips of that 64-unit box are actually free:
  outside x 19..45 below the head, below y 55, and above y 11. **Draw the prop,
  render it, and look** (`tools/look-poses.mjs`); reasoning about which layer
  wins is what put the balloon's string inside his ear.

- **`--t` desynchronises the room, and specificity is what breaks it.** Every
  peer's slot carries one negative `animation-delay` in a custom property;
  custom properties inherit, so it shifts every animation in that figure by the
  same amount — which is the point, because the swing's travel, arc and two webs
  are phase-locked by durations that divide. Delay only the travel and the man
  comes off his own rope. Two ways for a part to escape it: **being more
  specific** (`.bud-peer *` is one class; `.bud-swim .bud-hand-r` is two, and its
  `animation` shorthand resets the delay to zero — hence the deliberately
  doubled `.bud-peer.bud-peer`, and hence the block sitting *below* every pose
  it must beat), and **carrying a delay of its own**, which is a relationship —
  one web is a swing behind the other — and must be added to, not replaced.
  Both are checked mechanically, the second by scanning the stylesheet for
  negative delays rather than trusting a list.

- **Half of a peer's buddy was arriving and being thrown away.** `hello` and the
  `buddy` broadcast have carried `anim` alongside `buddy` since they were
  written, and only `buddy` was ever kept — there was no `SYNC.anims`. So
  `budAnimKey(undefined)` fell back to 0 for everyone and a room of four was
  four web-swingers, under a comment reading "their buddy does their antic, not
  yours". Changing your antic also never left the building: the only broadcast
  was in `commit()`, which the antic buttons do not go through. **When a field
  is sent, grep for where it is stored** — sending it is the half that looks
  done.

- **Two things claiming one name is silent, and the symptom is never near the
  cause.** This has now happened three times in the buddy alone. A duplicate
  `@keyframes bud-lift` made the swing travel disappear; the pose class being
  stamped on *both* the slot and the `<svg>` made him run `bud-go` twice and
  drift out from under his own web; `--jump` in a keyframe silently failed to
  resolve. In every case the CSS read correctly on inspection because it *was*
  correct — the second definition was elsewhere. `grep -c` on `dist/index.html`
  found all three in seconds after hours of reading source. **Look at the built
  output, not the files.**

- **An eased `bud-go` fights the pendulum.** Two things move the buddy: the
  travel, and the rig swinging him about the anchor. Over a flight the rig alone
  carries him *backwards* by `2·sin(A)·rope`, ~32vmin. An ease-in-out has
  near-zero velocity at both ends of each segment, so at the head and tail of
  every flight the rig won and he slid back — a visible stutter, twice a flight.
  `bud-go` is `linear` with the shape in the keyframes, and there is a check
  that computes the sweep and fails if the step no longer clears it.
  **In a portrait window `1vw` and `1vmin` are the same length**, which is the
  window shape that binds; a step tuned on a wide monitor can send him backwards
  on a phone.

- **`save()` stamps `S.at`, and an emptied device must stamp 0.** Settings are
  settled by `at` — newer wins. Signing in wipes the device and then pulls, but
  the wipe *writes settings*; stamped with the current time those outrank
  everything the account holds, so the buddy, theme, clock face and antic are
  all judged stale on arrival and thrown away. `Account.wipe()` ends with
  `save(0)` and it must stay the last settings write in that function —
  `ambSet('off')` calls `save()` on the way past.

- **A union cannot express a deletion.** The plan and the checklist merge by id,
  which is right for adding and wrong for removing: the other device still has
  the entry and hands it straight back an hour later. `GONE` (14-util.js) is the
  tombstone list; anything removed from either list must be recorded there or it
  comes back. `done` is the one field that unions rather than being replaced —
  it is keyed by day, and two devices ticking different days is two facts.

- **Look at the buddy, do not reason about him.** `node tools/buddy-look.mjs`
  renders the real `budSvg()` output to PNG so it can be *seen*. The headphones
  were moved twice by working out where an ear "should" be from the head's
  centre and radius, each time with a confident comment, and each time they
  ended up on his jaw. One render settled it in seconds.
  *ImageMagick does not resolve `currentColor` and has no fonts* — anything
  using either renders as nothing, which looks exactly like a bug in the app.
  The tool substitutes a literal ink for that reason.
- **A tap target inside a scroller needs `touch-action:pan-y`.** Without it a
  finger landing on the thing is ambiguous — the element wants the tap, the
  panel wants the pan — and the browser guesses from what happens next. On the
  crossword it guessed wrong often enough that the page would not move at all
  if your thumb started on the puzzle, which is most of the screen. Say which
  you meant. `touch-action:none` (the pictionary canvas) beats it by being more
  specific, so a drawing surface still gets the raw gesture.
- **Two `@keyframes` with the same name is silent and lethal.** The later block
  wins for *every* element using that name. `bud-lift` was both the main menu's
  hand raise and the swing's vertical rise; both drive `transform`, so the
  perch's version overrode the swing's travel on the same element and the buddy
  swung on the spot through several rounds of "why is he not moving". Nothing
  warns you: the CSS parses, both rules exist, one quietly does the other's job.
  A smoke check now fails on any duplicate name.
- **Do not put `var()` inside `@keyframes`.** The buddy's rotation animated and
  his traverse did not, and the only difference between the two was that the
  traverse read its distance out of `var(--jump)` — so he swung on the spot in
  the corner while everything about the CSS looked right. Variables are fine in
  static properties; in an animated value they are a coin toss. Write the
  numbers out and keep the arithmetic in the comment. There is a check.
- **A bad `var()` kills the whole declaration.** `var(--fg)` was never defined;
  it silently removed every crossword bar.
- **A test may not assume the shape of `.env.release`.** Two of them did — the
  smoke test asserted there was no sign-in button, and `account-client-test`
  replaced `const ACC_URL = ''` by exact string. Both broke the day accounts
  were switched on, which is the day they most needed to be trusted. Read what
  the build actually contains and assert the *rule*.
- **`tools/account-client-test.mjs` must be run from `~/run`, like the slices.**
  From the repo it imports jsdom across the Windows mount and produces no output
  at all before the shell call is cut off — indistinguishable from a hang. Copy
  `server/`, `tools/account-client-test.mjs` and `dist/index.html` over first.
- **jsdom has no `scrollIntoView`.** It is not on the prototype at all, so a
  call is a `TypeError` — and both of the app's uses are inside
  `requestAnimationFrame`, where the throw is swallowed by the virtual console
  and the test simply stops doing anything. Use `scrollTo_()` in `24-stats.js`.
- **`<svg>` clips to its viewport** (`overflow:hidden` is the initial value).
  That, not any scroll box, was the square edge on the dial glow.
- **A scroll box clips at its padding box.** Padding inside it cannot rescue a
  spilling glow. `.app` is the only scroller on the timer side; `#setup` must
  stay `overflow:visible` or the main menu stops scrolling.
- **Pseudo-element opacity multiplies by its parent's.** A `::after` on a
  faded-out element is invisible however opaque it is.
- **Full-screen blurs are the performance cliff.** `backdrop-filter` recomputes
  every frame over anything moving. Nothing may exceed 20px; the test enforces it.
- **So are lots of small ones.** Same cliff from the other end: a smoke speck
  carries `filter:blur()`, so each is an offscreen buffer to keep and
  recomposite, and a look asking for fourteen times the default count was asking
  for **112 blurred layers**. That is what "the app is lagging" was. Kinds whose
  specks are expensive now carry a `cap` — a ceiling `fxn` cannot climb past —
  and smoke's blur scales with the shape rather than sitting at 26px however
  small it has been shrunk. Density past the cap has to come from opacity, which
  is free. The 20px rule only covers `backdrop-filter`; nothing counts these.
- **A CSS grid cannot animate a child between cells** — that is a relayout. 2048
  therefore has a slot layer and a tile layer.
- **Shared games are host-authoritative.** Players send intents; the host is the
  only writer and pushes per-player views. A room *is* the host's peer id, so
  handing the timer over migrates the room.
- **A closing socket must prove it is still the current one.** `conn.on('close')`
  deleted a peer's roster line, code and heartbeat by id. When somebody dropped
  without the socket closing and dialled back in, the *old* socket's close
  arrived afterwards and took the *new* connection's entries with it — connected,
  invisible to the host, skipped by every broadcast. Both the supersede tag and
  the identity guard in `syncWire` are load-bearing; the test for it is in the
  sync block and it fails loudly if either goes.
- **Write CSS animations longhand.** jsdom does not expand the `animation:`
  shorthand — it reports `animation-name: none` for even a trivial valid one —
  so anything written shorthand cannot be checked by the smoke test at all.
  `animation-name` / `-duration` / `-delay` separately are read correctly.
  Pseudo-elements are worse: `getComputedStyle(el, '::after')` is *Not
  implemented*, so a rule on `::after` can only be checked as text in the build.
- **`.dial svg` is the progress ring, and it must stay `.dial > svg`.** As a
  descendant selector it also took the clock faces in `.readout` — `position:
  absolute; inset:0` stretched an analog dial over the whole thing and
  `rotate(-90deg)` laid it on its side. Anything else ever put inside the dial
  would have been next. The smoke test checks the computed transform on a face,
  not the text of the rule.
- **A broken `<!--` renders its whole comment as body text.** One lost its two
  opening characters during a scripted edit and several paragraphs about
  Spider-Man's corner webs appeared on every screen — the app's own prose, in
  the middle of the setup page. It is not a build error and nothing warned. The
  smoke test now looks for a stray `-->` in the rendered text and compares the
  count of openers and closers in the build.
- **A kind with a spec and no CSS draws nothing, silently.** Office's `keys` had
  an entry in `VFX_KINDS` — sized, placed on a grid, timed — and no rule in
  31-vfx.css at all, so it laid out two dozen invisible boxes for who knows how
  long. Every `fx:` a look or track names is now checked against the stylesheet
  by the smoke test. If you add a kind, add its `.vfx[data-fx="…"] b{` block.
- **The jsdom version is part of the test result.** jsdom 25 computed
  `display:flex` for an element carrying `class="ch-promo hide"` inside
  `#game-chess`, with `#game-chess .hide{display:none !important}` right there
  in the sheet — the app was correct and the DOM engine was not. Thirteen
  checks, all of them `shown()` or a computed colour, failed for that reason
  alone. Pinned at **^30** now. If you test in a scratch directory, install the
  version package.json pins; a newer one there passes checks that `npm test`
  fails, which is worse than no test at all.
- **A test door must be spliced at the *last* `})();`, not the first.** The
  smoke test's `withDoor(src, code)` opens a window onto the bundle's private
  scope by inserting an assignment just before the IIFE closes. Written as
  `html.replace('})();', …)` it hit the first occurrence in the file — a nested
  one two-thirds up, inside `28-ambience.js` — and a door spliced *there* names
  `const`s that are still in temporal dead zone, so the whole IIFE throws on
  load and about seventeen entirely unrelated room checks fail with nothing to
  connect them to the change. It is `lastIndexOf` now, in `withDoor` and in
  `tools/look-ft.mjs`. If a batch of unrelated checks ever dies at once after a
  door is added, this is why. The other `look-*.mjs` still splice at the first
  match and are fine, but only by accident of shape: their door is a *deferred
  function* (`window.__x = () => {…}`) that nothing runs until the page has
  finished loading, so no binding is read while it is still dead. A door that
  reads anything at splice time must go at the last close.
- **An invisible byte in a string literal is a thing nobody can review.** The
  friend-request sentinel is U+0001, which is the right choice — it has to be
  something a person cannot type into a message — but a *literal* control
  character got into `29a-friends.js` and later into this very file, where it
  showed up as a search that would not match and an edit that would not apply.
  Write it as an escape inside the literal, never pasted — `'\u0001fr:'`.
  `grep -P '\x01' -r src tools *.md` finds any that creep back in.
- **Every `try{ xAdopt(…) }catch(e){}` in `48-account.js` can hide a whole
  section going missing.** The catches are there for a good reason — one bad
  section must not abort the rest of the sign-in — but they turn a typo into
  silence. `dailyAdopt` called `dailyMerge` when the function is `mergeDaily`,
  so from the day the calendar shipped, signing in on a second device threw a
  `ReferenceError` into that catch and brought across no puzzle history at all.
  Nothing logged, nothing visibly wrong, just an empty calendar on the new
  phone. **The test for an adopt path has to go through the adopt path**: the
  streak checks originally wrote the record straight into `DAILY` and would have
  passed forever. If you add a section to the snapshot, add a check that adopts
  it rather than one that inspects the store.
- **A dated puzzle must carry its day, not recompute it from its index.** The
  crossword picks the first unfinished puzzle by walking the days its size
  publishes, so on a day past the end of the bank it picks an *encore* — an
  early puzzle shown again. `_firstUnfinished` used to return only a bank index
  and `load(i)` worked the day back out of that index's position, which is the
  puzzle's *original* date, not the day you opened it. Progress was filed under
  17 August while the calendar, quite correctly, showed the 28th and said "Not
  opened". It returns `{i, day}` now and both call sites pass the day through.
  Any other game that ever gets an encore has the same trap waiting.
- **Never read the version out of a working copy that is not `D:\Focus`.**
  The sandbox copy of `package.json` has drifted — it carries a `playwright`
  dependency the look tools need and is missing the `ship:release` script — and
  its `version` had been left three minor releases behind. Quoting it would
  have shipped 1.0.11 over a 1.3.0 that is already out, and the updater
  compares versions, so every installed copy would have ignored it. `D:\Focus`
  is the only authority on the version; check there before naming a number,
  and never push a sandbox `package.json` over it.
- **The friend code hash exists twice and neither copy throws when it is
  wrong.** `syncCodeFor` in `29-sync.js` and `codeForName` in
  `server/accounts.js` must agree exactly — same alphabet
  (`'23456789ABCDEFGHJKMNPQRSTUVWXYZ'`, not a plausible-looking one), same
  seed, same multiply. A drift does not fail: `/account/who` simply answers
  with the wrong person's name, or with nobody, and the app believes it. The
  alphabet was wrong the first time the endpoint was written, which is why
  `accounts-test.mjs` now reads the client's copy out of the source and
  compares the two that actually ship rather than restating either.
- **jsdom windows must be closed before `process.exit()`.** `pretendToBeVisual`
  gives each one a rAF loop that never stops, and exiting under it aborts libuv
  on Windows — *"Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file
  src\win\async.c"*. It prints nothing else, so it reads like the suite passed
  and the machine broke. Linux exits quietly, so the sandbox never sees it. The
  verdict closes every booted window and exits on the next tick.

## 7. Things worth knowing about the data

- **The account is a profile, not a backup.** `Account.snapshot()` in
  `48-account.js` is the single list of what travels: the log, embers, the
  calendar (`PLAN`), the checklist (`TASKS`), the tombstones (`GONE`), your own
  quotes (`CUSTOM_QUOTES`), the single-player arcade (`gamesSnapshot()`), and a
  `sim` bundle holding the settings, the theme, the ambience, what the buddy
  looks like and which antic he does. What he *owns* rides separately, in
  `Embers.own`, which is unioned — so a hat bought on a phone is his on a
  laptop, and `budStrip` takes off anything the account has not paid for. **If you add something a person sets up,
  add it here, to `Account.wipe()`, to `mergeSnapshots` in `47-merge.js` *and*
  to the server's copy in `server/accounts.js`, in the same commit** — the four
  lists must match or signing out leaves a stranger's things behind and the
  vault silently drops whatever it was not told about (see §6).

- **Saved games ride on a small registry, not on each game.** `09-arcade-core.js`
  holds `GAME_KEYS`, an in-memory copy of each save and when this device wrote
  it; `writeGame(key, obj)` is what every single-player `persist()` calls, and a
  save that reaches `KV.set` directly is a save the account never hears about.
  `forgetGame(key, fn)` is how a game drops its in-memory copy when an account
  overwrites storage underneath it, so the next `enter()` re-reads instead of
  writing the old position back. A board travels whole (the newer save wins);
  the best score, the finished crosswords and the chess shelf are lifted out of
  the loser first, because they are records rather than positions.

- **Signing up keeps this device's data; signing in erases it.** A new account
  has never held anything, so the work here is the only copy and goes up with
  the first sync. An account that already exists has its own history, and
  whatever is on the device came from somewhere else — merging it in is how one
  borrowed login quietly collects everybody's hours and themes. `signInAsk()`
  names what is about to go, offers making an account as the way to keep it, and
  wipes only *after* the password is accepted so a typo costs nothing.

- **Two merge shapes, in `47-merge.js`.** Lists with ids (`plan`, `tasks`) union
  by id minus `gone`, later `at` winning a collision. Everything in `sim` is a
  single value settled on one timestamp. Sessions union with the longer
  observation winning. Embers are never merged — they are *derived* from the
  merged result by `embersFrom`, so two devices cannot hold different balances.

- **Nothing is on `window`.** It is all one IIFE, so a test cannot call
  `Account.sync()` — drive it through the buttons the way a person would.

- **Crossword bank** (`26-crossword-data.js`) is generated by
  `tools/rebuild-bank.py` and patched in, never hand-edited. Rules: no answer
  repeats inside 4 puzzles at a size; ordinary words only; **every clue is
  hand-written** in `tools/cross-clues.py` and the build refuses to write the
  file if one is missing. A clue may be a string or a list of alternatives.
  Currently 36 puzzles (12 × 9x9 barred, 13 × 7x7 — 11 plain and 2 barred —
  and 11 × 5x5).
  *Barred grids need their `v`/`h` bar maps.* Bars were computed for 9x9 only,
  so the first barred sevens went out without them and whole rows parsed as one
  entry (`peepdig`, `godbony`). The build passed and the rules test passed 28/28
  while this was broken — only walking every grid through `crossParse` found it,
  which is now a required step in the daily task.
  Giving them bar maps also changed their shape from a plain row array to the
  `{r,v,h}` object the nines use, and that broke the smoke test a second way:
  **barred does not mean nine.** Bucket a puzzle by `r.length`, the way
  `crossAtSize()` does. Anything keying off the shape instead files the barred
  sevens with the nines and reports repeats that are not there.
  The 5x5s and 7x7s now carry no black squares at all — a 7x7 is a solid block
  of letters, and a 5x5 is a double word square, because a five-run cannot be
  split into entries of three or more.
  **Never key anything saved on a puzzle's index in `CROSS_GRIDS`.** The bank is
  grouped by size and new puzzles are added *inside* their group, so one
  insertion renumbers everything after it. Saved progress was keyed on the index
  and `load()` trimmed a stored letter string to fit rather than rejecting it,
  so after the bank grew people opened grids already full of a different
  puzzle's answers, with revealed squares contradicting the clue and puzzles
  flagged solved that had never been opened — reported as "most clues and
  answers are incorrect", though the bank itself was correct throughout.
  Progress is now filed under `crossKey(g)`, a hash of the grid and its bar
  maps, so the name travels with the content. `Cross._migrate()` converts old
  index-keyed saves once and drops any record that cannot belong to the puzzle
  now at that index (wrong cell count, a revealed square disagreeing with the
  solution, or under two thirds of its letters correct — solving leaves a few
  wrong guesses, a foreign puzzle agrees about one letter in twenty-six).
- **Lights** live in `EMB_LIGHTS` (`37-embers.js`) and need a palette block in
  `30-embers.css` covering all nine scopes — the count on the shelf is read from
  the catalogue by the smoke test, so adding one needs no test edit, but missing
  a scope colours part of the app and not the rest. Eleven of them now.
  **Beach is the only light look.** Every other palette sets four colours and
  trusts the app; beach also has to carry `--card`, `--line` and `--track`,
  which are white at low alpha everywhere else and invisible on cream. A few
  hover and veil rules are overridden beside it for the same reason. Anything
  new that hardcodes `rgba(255,255,255,…)` for a raised surface will be
  invisible under beach and needs a scoped counterpart.
  **Spider-Man is the only one that brings a shape**: an inline SVG web and mask
  in the timer markup plus two corner webs in the shell, all hidden by their own
  `display:none` and shown by that id alone. Its blue is the costume's cobalt
  and is the *ground*; red is the accent, because a red ground with red buttons
  is one flat surface.
  **A look can retune the kind it borrows**: `fxn` count, `fxo` opacity, `fxs`
  size, `fxpal` discrete colours (38-vfx.js). Magma is Dusk's smoke at nine
  times the count, four tenths the size and twice the opacity, coloured from a
  palette instead of a blend — orange between black crust, because a blend of
  orange and near-black is one unbroken brown. All four are opt-in and Dusk,
  sharing the kind, is untouched: 4 blended specks against Magma's 32.
  **Beach's water is `.beach-sea` — a static masked frame with two sliding
  children.** It has to be split that way: **a `mask-image` is carried by the
  transform of the element it is written on**, so with both on one box the
  horizon crept up the screen all cycle and snapped back at the loop. The waves
  were seamless and the fade over them was not, which reads as a video looping.
  The frame owns the mask and never moves; the children own the motion and
  never carry a mask. Crests are one long irregular gradient tiled by
  `background-size` — a `repeating-linear-gradient` is evenly spaced and the eye
  finds the period at once — and each child travels exactly one tile per cycle,
  so change a `background-size` and its keyframe must change with it. Transform
  only; animating `background-position` repaints a full-screen gradient every
  frame. Beach also has its own `.app` gradient with no `--bg2` in it, because
  the shared one hangs the sea colour over the menu bar.
- **Four clock faces** (`43-faces.js`, `33-faces.css`): digital, analog, flip,
  hourglass. `#app[data-face]` picks one and the others are `display:none`, and
  `facePaint` returns early for every face that is not on screen — `paint()`
  runs once a second all session, so three idle faces updating would be three
  quarters of that work thrown away. Add one to `FACES` and it appears in the
  menu on its own; give it a branch in `facePaint` or it will sit frozen at its
  markup default and nothing will complain.
  **Bought, like lights and sounds**, under a `face-` prefix in the same
  `Embers.own`; digital is free and always owned, and a face you no longer own
  falls back to digital rather than leaving the dial empty. Which one you use is
  a *setting* and rides in the `focus_sim` record; what you have *bought* is
  progress and lives with the embers. `tools/dev-build.mjs` lifts all three
  catalogues out of the source, so the dev copy owns new ones automatically.
  Analog is sized to the ring by arithmetic (`min(78vw,300px) * .9`) rather than
  a clamp that looked close, and is taken out of the flow so the phase name and
  session line land inside the circle. The hourglass drops the phase name — sand
  at the top already says a block has started — and its grains are a dozen
  circles on a dozen different clocks; identical grains on identical clocks are
  a dotted line.
- **Two things that bit hard in `44-back.js`, both about doing less.** It used
  to call `history.back()` to tidy its spare entry away once everything was
  closed by hand — that fires a *real*, asynchronous `popstate`, and by the time
  it landed something else had usually been opened, so the app shut a screen the
  instant you opened it. A stale entry costs one extra press of Back on the way
  out, once; synthesising navigation to keep a counter tidy is not worth that.
  It also asked `getComputedStyle().display` alongside the `.hide` check, on a
  timer, in every window: a resolved style is one of the most expensive things
  you can ask for in a loop, and across the three windows of the handover test
  it starved the event loop enough to break a peer connection. `.hide` is the
  app's own convention (§2) and it is a class check.
- **A block survives the Home button** (`45-notify.js`). The countdown always
  did — the engine is wall-clock arithmetic against `S.endAt`, not a count of
  ticks — but everything that happened *per tick* did not, and Android throttles
  background timers to nothing in a minute or two. So the open record is
  flushed on `visibilitychange`/`pagehide` ignoring its thirty-second throttle,
  and `tick()` is called once on the way back in: `logProgress` takes an
  absolute number of seconds, so one call after an hour away records the hour
  and there is nothing to replay. The notification half needs
  `@capacitor/local-notifications` (see ANDROID.md) and is feature-detected —
  no plugin, no-op, which is why web and desktop are untouched. The *scheduled*
  notification is the one that matters: Android fires it whether or not the page
  is ever given another instruction. The ongoing one shows an end time rather
  than a live countdown, because a notification the app must wake up to rewrite
  is wrong exactly when it is the only thing you can see.
- **Back closes a layer instead of leaving the app** (`44-back.js`). There is no
  way to ask "was that Back?" — you only learn afterwards, from `popstate`. So
  the app parks one spare history entry whenever anything is open: Back eats
  that entry, the handler closes the topmost layer, and another is parked if
  something is still up. The URL never changes. `BACK_LAYERS` is in stacking
  order and that order *is* the behaviour — a confirm over the shelf closes
  before the shelf. It watches on a timer rather than hooking every `open()`,
  because the one call site somebody forgets is the one that walks a person out
  of a session.
- **A focus block is written while it runs, not when it ends.** `logProgress`
  opens a record on `start()` and updates it from `tick()` — the one hook both
  the leader and a follower run — and `logSession` is now just progress plus
  `logClose`. This is what fixed stats not updating in somebody else's room: a
  follower only wrote history when the leader's *mode changed*, so a room that
  simply ended wrote nothing at all. Embers accrue in five-second chunks with
  it, which is also what puts the tenth minute's ember on screen while you are
  looking at it. Three endings: `logClose` keeps the row, `logDrop` takes it back
  (only for stopping inside the first half minute), and `logForget` lets go
  without touching the log (only for Reset progress, which is about to empty it
  — without that the next tick writes history straight back).
- **Your buddy** (`46-buddy.js`) is five integers — `{b,c,e,h,a}`, indexes into
  the tables in that file — not an image. About forty bytes, which is why it can
  ride along in the `hello` that opens every peer connection instead of being
  fetched separately. **Never reorder those tables**: somebody else's buddy is
  drawn by *their* numbers against *your* copy of the app, so the two have to
  agree. Add to the end. An index we do not have falls back to the first rather
  than drawing nothing, which is also what makes an older copy safe.
  The SVG carries no `defs` and no ids, because several are on screen at once in
  a room and ids in a repeated fragment collide.
- **The ember balance is derivable, and that is the point** (`47-merge.js`,
  `Embers.reconcile`). `earn`/`credit` still keep a running total, because that
  is what puts an ember on screen the second it is earned — but a running total
  is the one thing that cannot survive two devices, since whichever is behind
  stays behind for ever and nothing notices. So the same number can always be
  recomputed from where it came from: focus time out of the log, achievements
  out of `claimed`, spending out of `own`. Reconciled on load, and after any
  merge. If the two disagree the derived one is true.
  `adjust` is the one stored figure and it exists only for history — a copy from
  before this had embers with no log behind them, so the difference is written
  down once on the first load that notices and carried from then on. Never
  recalculated, or it would drift by definition.
- **Accounts work end to end** — `server/accounts.js` and `src/js/48-account.js`,
  with `tools/account-client-test.mjs` running the real Worker in-process
  against two jsdom devices. **Opt-in by hosting**: `ACC_URL` is stamped at
  build time from `FOCUS_ACCOUNT_URL`, and with nothing there the app has no
  sign-in, makes no request, and never mentions an account — same rule the
  update check follows. Sync is pull, merge, push, on sign-in, on open and after
  a block; it is quiet on every failure because the app has never needed the
  network. The client merges *as well as* the server so what you see is the
  union immediately rather than after a round trip, and the ember balance is
  never sent — `reconcile()` derives it from the merged result, so two devices
  cannot hold different totals for the same history.
  The menu footer is written by `_where()` rather than fixed in the markup: it
  said "your data stays on this device" from the first build and that was true
  until somebody signs in.
- **The accounts Worker, in detail.**
  `server/accounts.js` + `accounts-schema.sql` + `accounts-test.mjs` (38 checks,
  in-memory D1, no deploy needed). Email and username both unique, PBKDF2 at
  210k rounds, tokens stored as hashes, and `/account/gone` really deletes.
  **`/vault/put` merges rather than overwriting** — the client sends the `rev` it
  last saw and the server reconciles with the same rules, which is why the merge
  functions are duplicated verbatim at the top of that file. *Change one, change
  both.* `/account/in` and `/account/new` are rate-limited via the `throttle`
  table — per address *and* per email, checked before the lookup and before any
  hashing, since 210k rounds makes a live endpoint cheaper to attack than to
  serve. The address is `CF-Connecting-IP`; `X-Forwarded-For` is forgeable and
  is not consulted. The client half, the UI and the menu wording are all built.
  See ACCOUNTS.md § Turning it on for the deploy, and for why `apac` was chosen
  and cannot be changed without recreating the database.
- **Merging is the thing to get right before any login exists** (`47-merge.js`,
  `tools/merge-test.mjs`). Two devices both used offline is the normal case.
  Sessions are append-only with unique ids, so they union — and on the same id
  the **fuller observation wins, not the later write**, because a record is
  written *while* a block runs and the short one is usually an earlier snapshot
  of the long one. Owning and claiming are unions; you cannot un-buy a theme.
  Settings are last-write-wins by `at`, because a clock face is not worth a
  conflict. Embers are not merged at all — they are derived from the result.
  All of it is pure functions over plain objects, so the test needs no jsdom.
- **Embers**: one per ten minutes of finished focus, banked by the second so
  short blocks cannot be farmed. `Embers.feats` records one-off moments the
  board itself forgets (a promotion, a scrabble sweep).
- **Achievements** are derived from the log, except the feats above. Only blocks
  that ran their clock out (`full`) count — skipping does not.

## 8. Updates and dev

- **The phone never saw an update, and CORS was why.** A Capacitor web view has
  an origin of its own, so `fetch`ing `latest.json` from GitHub is cross-origin —
  and GitHub redirects release-asset downloads to a host that sends no usable
  `Access-Control-Allow-Origin`. The request was refused before it left the
  device, the `catch` swallowed it, and the app concluded there was no news, for
  ever. `CapacitorHttp.enabled` in `capacitor.config.json` routes it through the
  native stack, where CORS does not apply. Run `npx cap sync` after changing it.
  Separately: **Get update is a link on purpose.** Neither a copied HTML file nor
  a web view can replace its own assets, so telling you is all it can do. Only
  the desktop build installs by itself. See ANDROID.md for the store and
  live-update routes.
- **Update check**: `41-update.js` reads a version stamped at build time and a
  `latest.json` URL from `.env.release`. With no URL it is completely silent.
  `npm run setup:updates <user> <repo>` writes all three places the repo is named.
- **The desktop updater used to work in total silence, and that read as broken.**
  It downloaded in the background and said nothing until a dialog at the end —
  while the same menu went on showing `41-update.js`'s "Get it" link to GitHub.
  Two mechanisms, no connection between them, and the *visible* one was the
  manual one, so everybody used it and concluded nothing was automatic. There is
  now one bridge (`electron/preload.cjs`, `contextIsolation` and `sandbox` left
  on): update events out, "restart now" in. In that build the banner becomes a
  progress bar and the GitHub link disappears — the shell knows, the page does
  not, so whatever the shell says wins.
- **Desktop auto-update**: `electron/updater.cjs`, GitHub Releases. Downloads in
  the background and installs at the next ordinary exit whether or not anybody
  answers the dialog — that prompt only offers to do it *sooner*. Nobody needs
  to visit GitHub.
  It also **sweeps its own cache** on start: electron-updater keeps every
  installer it downloads, on purpose, and at ~130 MB each that becomes half a
  gigabyte of dead versions in `%LOCALAPPDATA%\focus-simulator-updater`.
  Anything untouched for three days goes; the small `.yml`/`.json` bookkeeping
  stays, because that is what lets a part-finished download resume. Worst case
  is one re-download.
- **Dev copy**: `dist/dev-unlocked.html` — everything owned, a retractable bar
  with light/sound/ember controls, and **Fill board**, which finishes whichever
  arcade game is open (`devFill()` in `42-dev.js`, exposed only when the page
  carries `data-dev="1"`).

## 8a. Releasing — the naming rule, and why it bit

> **Every update is a jump to the newest, not a step to the next.** Both paths
> read `releases/latest`, and each installer is complete, so a copy on 1.0.5
> goes straight to the top — there is no ladder and there must not be one. The
> one way that breaks: **GitHub decides "Latest" by publish date, not version
> number**, so editing an old release moves the label onto it and points
> everybody at something older than what they have. `allowDowngrade` and
> `updNewer()` stop anyone actually going backwards; `publish:check` fails if
> the highest version on the repo is not the one marked Latest.
>
> **The updater must be *inside* the app.** `build.files` decides what
> electron-builder copies. Naming `files` explicitly replaces the default, and
> the default is what pulls in `node_modules` — so a three-entry list left
> `electron-updater` out of every packaged build. `require` threw inside the
> app, `setup()` returned before registering its IPC reply, the main process
> went mute, and the page — hearing nothing — fell back to the GitHub link.
> **1.0.7 and the first 1.0.8 installer both shipped like this.** Any installer
> built before 2026-08-20 cannot auto-update and never could. `publish:check`
> now fails if `files` omits node_modules, and `setup()` answers the page before
> anything that can fail, so the next occurrence says why in one console line.

**A release can exist and update nobody.** There are two update paths and they
read different files:

| who | reads | if it is missing |
|---|---|---|
| the page (`41-update.js`) | `latest.json` | no banner |
| electron-updater (installed app) | `latest.yml` + the `.exe` beside it | silence |

Upload one and not the other and the app *correctly* announces a new version it
cannot deliver, then offers the GitHub link because the link is the only route
with a file behind it. That is not a bug in the updater — it is the updater
reading a file nobody uploaded. It cost two rounds of "auto-update is broken"
on 1.0.8, whose release had `latest.json` on it and nothing else.

**Names must have no spaces.** GitHub rewrites spaces to dots on upload, so
`Focus Simulator Setup 1.0.8.exe` becomes `Focus.Simulator.Setup.1.0.8.exe`
while `latest.yml` still asks for the name electron-builder wrote — a 404, and
a 404 looks exactly like "no update" from the outside.

`build.artifactName` in package.json is `Focus-Simulator-Setup-${version}.${ext}`
so a normal build is born correctly named. **Do not write it as
`${productName}-Setup-…`** — `productName` is "Focus Simulator", space and all,
which puts the bug straight back. `npm run publish:check` now fails on a space
in the name, on a `latest.yml` that does not match the file beside it, and on a
published release that is missing its installer or its `latest.yml`.

### The whole thing, in one run

```powershell
$env:GH_TOKEN = "ghp_..."
npm run ship:release -- -Notes "what changed"             # minor by default
npm run ship:release -- -Bump patch -Notes "what changed"
```

`tools/ship-release.ps1`. Runs the section below in order and stops at the first
failure, naming the step: tests, `git add -A` and commit (several source files
are untracked, and a release built from a dirty tree is one nobody can rebuild),
`release`, `publish:check`, then `npm run build` + `npx electron-builder --win`
and `publish:assets` — building and uploading kept apart on purpose — `--publish always` has reported success while
attaching nothing three times in this project, which is the whole reason
`publish-assets.ps1` reads the release back instead of trusting itself.

Re-runnable: the bump is skipped if package.json already carries that version,
and asset upload replaces same-named files rather than duplicating them.
`-SkipTests` is for a second run in the same tree and for nothing else. When a
check is red for a reason that has nothing to do with the change being shipped —
the crossword bank rebuilds in the background, so the four checks that count
puzzles per size go red for as long as that is running — name it with `-Except`
(or `-AllowBankInProgress`, which is those four) rather than skipping the suite.
Everything still runs, everything still prints, the named ones just lose their
veto, and the final summary lists what was shipped knowingly red.

**A non-zero exit with no failing checks is a crash, not a tolerable failure**,
and is refused whatever is named — the suite died on an unsupported import once
and printed no check lines at all.

**It refuses to start on a stale `.git/index.lock`.** There is one in this repo
dated 28 July with no git process behind it; every `git add` in the tree fails
against it with "Another git process seems to be running". Delete it once:

```powershell
Remove-Item .git\index.lock
```

### The normal way

```
npm run release patch "what changed"     # bumps, builds, writes latest.json
npm run publish:check                    # token, names, hashes, last release
npm run publish:win                      # builds, uploads, attaches
```

### When electron-builder does not get the files up

```
npm run publish:assets
```

`tools/publish-assets.ps1`. Written after `--publish always` failed to attach
the installer three times running — a 401, a release holding only `latest.json`,
and a **draft** release (electron-builder's GitHub default, now overridden with
`releaseType: "release"`). Every one of those reported success and left the app
looking like it had no updater.

It finds the release for the current tag *including drafts*, replaces any assets
of the same name, uploads all four files, publishes the draft, sets `make_latest`
explicitly, and then **reads the release back and prints what is on it** — every
failure this script exists for reported success, so it does not trust its own.
Safe to run repeatedly. Reads `GH_TOKEN` from the environment; never prints it.

### By hand, when the token is the problem — the step people forget

**Rename the installer before uploading it.** This is the manual step Hashir did
on 1.0.8 and it is the one that is easy to skip:

```
release/Focus Simulator Setup 1.0.9.exe           →  Focus-Simulator-Setup-1.0.9.exe
release/Focus Simulator Setup 1.0.9.exe.blockmap  →  Focus-Simulator-Setup-1.0.9.exe.blockmap
```

GitHub rewrites spaces to dots on upload, so the spaced name arrives as
`Focus.Simulator.Setup.1.0.9.exe` while `latest.yml` still asks for the
hyphenated one — a 404, and a 404 is indistinguishable from "no update" from
the outside. `build.artifactName` now makes new builds come out hyphenated
already, so **check the name before renaming**: if it is already
`Focus-Simulator-Setup-…`, there is nothing to do.

Then attach all four to the release for that tag, and confirm the release is
marked **Set as the latest release** — GitHub assigns that by publish date, so
a hand-made release can land behind an older one.

The installer is already in `release/` — `publish:win` builds before it
uploads, so a failed publish leaves a complete build behind. Attach **all four**
to the release for that tag:

```
release/Focus-Simulator-Setup-<version>.exe
release/Focus-Simulator-Setup-<version>.exe.blockmap
release/latest.yml
latest.json
```

Forget `latest.yml` and installed copies see nothing, for ever.

## 8b. Outstanding — read this before starting anything

As of **2026-08-20**, version **1.0.10**, 964 checks green, `dist/` built.

1. **Publish 1.0.10.** `npm run publish:win`, then `npm run publish:assets` if
   the upload fails again (it is safe either way and prefers a published release
   over a draft). Then **delete the leftover v1.0.9 draft and the empty v1.0.9
   release** — two releases on one tag is how the Latest label lands on the one
   with no installer, which is the failure that started all of this.

2. **Watch an update actually happen, once.** 1.0.10 is the first build whose
   updater is inside the package. Install it, publish 1.1.0 on top, and confirm
   the banner turns into a progress bar on its own. Nothing before this has ever
   been observed working.

3. **Redeploy the accounts Worker.** `npm run accounts:deploy`. Still predates
   the `/account/forgot` ordering fix.

4. **Password reset: change the design before wiring the key.** See §8c — a
   one-time link instead of a mailed plaintext password. Needs a Resend domain
   either way.

5. **Friends' buddies belong on the main timer screen**, not the sync band.

6. **Push the source.** Only 89 files are tracked and the last commit predates
   all of this month's work. `D:\Focus` is currently the only copy in
   existence. `.gitignore` already excludes `release/`, `dist/` and
   `node_modules/`, so `git add -A && git commit && git push` is source only.
   Do it *after* a successful publish so the tag points at the code that built
   the release.

7. **Versions go `minor` from here.** `make-release` defaults to it now, so
   1.0.10 is followed by 1.1.0. Patch numbers in double figures stop being
   readable at a glance.

## 8c. The systems, and how finished each one is

What exists, what shape it is in, and what the next move on it would be. Read
this before proposing anything: most of these are further along than they look
and the remaining work is usually one specific thing, not a rewrite.

### Accounts and sync — working, one deploy behind

Cloudflare Worker (`server/accounts.js`) plus D1. Nine routes: `/account/new`,
`/in`, `/out`, `/gone`, `/password`, `/forgot`, `/vault/get`, `/vault/put`,
`/health`. Client is `48-account.js`; merge rules are `47-merge.js` and are pure
functions with their own fast test.

Constraints that are not negotiable without re-doing something:

- **PBKDF2 at 50,000 rounds, one pass.** Workers throw above 100,000, and the
  free plan gives 10ms CPU per request. Stored as `1$<base64>`; the leading `1`
  is a pass count so the KDF can be changed later without orphaning anybody.
- **D1 lives in `apac`.** Region is fixed at creation. Moving it means a new
  database and a migration.
- **Throttling happens before hashing**, or the hash *is* the denial of service.
  `LIMIT = {in:10, new:5}` over 15 and 60 minutes.

Next: `npm run accounts:deploy`. The deployed copy still predates the
`/account/forgot` ordering fix.

### Password reset — built, cannot deliver, and worth changing before it can

The mechanism is finished and its hard-won property is the ordering: **the mail
goes out before the password changes.** It did the reverse once and locked
Hashir out of his own account — a reset that fails to send after it has already
changed the password leaves nobody able to get in. It also answers identically
for an address it has never seen, so it cannot be used to find out who has an
account.

It returns **501 unless `RESEND_KEY` and `MAIL_FROM` are set**, which they are
not. That needs a domain verified with Resend; MailChannels closed its free
Workers route in August 2024, so there is no zero-cost path any more.

**Before wiring the key, change the design.** It currently generates a new
password and emails it in plain text. That is weaker than the standard shape and
the standard shape is not much more work:

1. `/account/forgot` writes a single-use token — random, hashed in the table the
   way passwords are, with an expiry around an hour.
2. The mail carries a link, not a secret. The account is untouched at this point,
   so a reset nobody asked for costs nothing.
3. A new `/account/reset` takes token plus new password, checks and burns it.

The throttling, the identical-reply behaviour and `sendMail()` all carry over
unchanged. It is the payload that changes.

### The desktop updater — fixed as of 1.0.10, unproven in the wild

Two paths, deliberately: `latest.json` for the page banner, `latest.yml` plus the
installer for electron-updater. See §8a for every way this has gone wrong.

**No build before 1.0.10 can update itself** — `electron-updater` was not being
packaged. That cannot be fixed from the server; those copies need one manual
install. 1.0.10 is the first build where the mechanism can be observed working
at all, so watch it actually happen once before trusting it.

### The buddy — done, and the invariants are load-bearing

Six swings out and back, both ends off screen, two ropes one swing apart so the
web he throws is the web he lands on. Four smoke checks guard the geometry
(§6). If you change one number, run them; the failure modes here are silent and
look like something else entirely every single time.

### Focus together — people-shaped now

Peer-to-peer, five two-player games, host and leader separable so the timer can
be handed over. As of 2026-08-27 (4) the page is built around **people rather
than codes**: friends are stored and shown under their username, you add
somebody by typing that username, they get a request and agree to it, and their
name opens a **profile** with their focus and puzzle numbers.

The whole thing rests on one fact that was already true and was simply never
used: **a code is a hash of a username** (`syncCodeFor`, deterministic, one
account one code), so typing a name *is* finding the address. No directory, no
lookup, no server change — which is why this shipped without a deploy.

A profile is a **card the person handed over**, not something fetched: it rides
on the request, on the reply, and on `hello` in a room, and the page says how
old it is rather than pretending to be live. The app has never had a server that
knows what anybody did, and a profile page was not a good enough reason to build
one. Codes still work and always will — they are folded into a `<details>` at
the bottom for the one case usernames cannot serve (somebody with no account, a
one-off room).

**Friends' buddies still render in the sync band; Hashir asked for them on the
main timer screen.** That is the only outstanding request.

### What is deliberately not built

- **No analytics of any kind.** Nothing phones home. The update check is a GET
  for a static file and sends nothing about the person.
- **No silent install.** The updater downloads and installs on the next ordinary
  quit. Replacing a file on somebody's disk without telling them needs code
  signing and a trust relationship this app does not have.
- **No password recovery beyond email.** No security questions, no support path.
  If the mail cannot be delivered the account is unreachable, and that is the
  honest trade for having no support desk.

## 9. Log

Newest first. One line each.

- **2026-09-09 (2)** — **The bar sat over the app, and one wrong flag looked
  like three different bugs.**
  **`body { padding-top }` was never going to work.** Every layer in this app is
  `position:fixed`, which is measured against the viewport and ignores padding on
  `body` entirely — so the new caption strip was drawn *over* the top bar rather
  than above it. The offset belongs on the layers: `--winbar` in
  00-tokens-base.css, read by `.app`, `.overlay`, the drawer, the dialogs, the
  chat, the effects pane, the buddy layer and the rest. Zero everywhere that is
  not the packaged desktop app, so nothing on a phone moves.
  `tools/look-winbar.mjs` photographs it with and without.
  **"Why is the 15x15 already filled" and "I cannot get back to 15x15" were the
  same bug, and so was "it crashes".** A record marked `done` that is not
  actually solved opens the board full of letters, refuses every key (`type()`
  stops when `done`), and makes `_firstUnfinished` skip that day forever — which
  is a size button that appears to do nothing. One flag, three symptoms, none of
  them alike, which is why they were reported as three faults.
  `_migrate` did check the flag against the solution, but **only for records
  written under the old index-keyed scheme** — once a record passed through it,
  it was fingerprint-keyed and never looked at again, so a wrong flag became
  permanent. It is re-derived from the letters on every `load` now: a grid whose
  squares are all correct is finished whatever the record says, and one with a
  hole in it is not. The letters are kept either way.
  **And when something does throw, it says so.** `_guard` wraps the ways in,
  keeps the message on `Cross.lastError`, and offers `restart()` — the puzzle is
  published on a day and always rebuilds, so throwing its record away costs the
  letters and nothing else. A silent failure is a dead screen with no way to say
  what happened, which is what "it crashes" has meant every time.
  **Tested the way it was asked for:** every size, in every order, three times
  over, checking after each that the DOM matches the puzzle and the puzzle
  matches the button — plus a `done` flag on an empty grid, a record that really
  did solve it, and a saved position pointing at a puzzle the bank no longer has.

- **2026-09-09** — **The one a video found: an account arriving left a hole.**
  Two phone recordings of the laptop screen, and the numbers in the header line
  are the whole bug: `15x15 · Today · 00:46`, tap 5x5, tap 15x15, `00:00`. Four
  rounds of this were chased as puzzle bugs and none of them was one.
  **`gamesAdopt` empties a game's in-memory save and trusts the next `enter()`
  to read the new one in.** But `enter()` is not the only thing that reads: a
  size or difficulty button goes straight to `load`/`_open`, and those take the
  letters and the clock out of the very map that had just been emptied. The
  account had lost nothing; the object had. `forget()` now takes the adopted
  save synchronously — `gamesAdopt` writes `GAME_SAVES[key]` *before* calling
  it, so it is already there — and nothing is ever emptied and waited on.
  **It got worse the day the syncing got better.** While sync only ran on a
  daily mark this was rare. Then sync started running every five minutes and on
  every hide (the previous batch), and it became: play a minute, switch size,
  switch back, zero. Which is exactly why it read as "still not fixed".
  **Tetris clears on the display's beat now.** The glow was an animated
  `box-shadow` — on each band and again on the whole board for a tetris — and a
  box-shadow that changes every frame repaints everything under it every frame:
  two hundred squares re-rasterised sixty times a second, at the exact moment
  the game is doing the most work. The shadows are still there and no longer
  move; opacity and transform do, on promoted layers. And `setInterval(33)`
  became `requestAnimationFrame`: 30 ticks against a 60Hz screen is judder by
  construction, worst on the falling piece. `Tetris.running()` replaces reading
  `tick` from the outside.
  **The Windows caption is black with white text.** `titleBarOverlay` plus a
  strip the page draws itself, sized from `env(titlebar-area-height)` — which is
  zero in a browser, on a phone and in the harness, so the element knows where
  it is without a flag being passed in. Pinned, because a regression there is a
  black band across the top of the phone build.
  *Also:* one check asserted a 15x15's day `=== today`, which is true one day in
  seven. It passed on the Sunday it was written and failed on the Tuesday.

- **2026-09-06 (7)** — **Seven checks failed on a release run and not one was a
  regression.** They were all cross-window: a guest joining, a promotion, a room
  filling to three, a timer handed over. Every one of them sleeps for a
  hand-picked number of milliseconds and then asserts, and those numbers were
  picked on a fast idle container. On a laptop — or on the same machine while it
  is building the bundle — the message has not arrived yet and a working feature
  reports as broken. That is worse than useless: a suite that cries wolf gets
  its failures explained away, which is the only way a real one gets through.
  **Two fixes, at two levels.** `until(fn)` polls for the thing instead of
  sleeping for a number, and the seven that actually failed now use it — a
  passing run gets *faster*, because it stops sleeping through time it does not
  need, and a real failure still fails, it just takes the ceiling to do it.
  And because there are 119 more sites of the same shape, the machine is now
  measured once at startup — a short CPU loop against the number it takes where
  these pauses were tuned — and every `wait` is scaled by it, clamped to 4x.
  `FOCUS_TEST_SLOW=2` forces it, which is how you reproduce somebody else's
  flake; the run prints the multiplier when it is not 1.
  Verified at 1x and at a forced 2x: 1057/1057 both ways.

- **2026-09-06 (6)** — **One cause under four "puzzle bugs": nothing ever said
  a save had failed.**
  Boards not surviving a difficulty switch, a crossword losing its letters on
  close, a sudoku opening with no clues, games "constantly stopping working" —
  four reports, each chased as a game bug, none of them one. `localStorage`
  throws when it is full; `KV.set` caught it and returned, `writeGame` caught it
  again, and a store that had stopped accepting writes was indistinguishable
  from one that was working right up to the moment a board came back empty.
  None of it could be reproduced here, and that was the evidence: the sandbox's
  store is empty and always accepts.
  **Three rules now.** A read storage cannot answer falls back to what this
  session wrote — `GAME_SAVES` is the newest copy there is, so one sitting is
  safe from anything a disk does, which is what "at least save during the open
  instance" means. A write that fails gets one retry after `KV.pinch` throws out
  the oldest sudoku boards (they rebuild from their day; a puzzle's letters are
  the only thing that cannot, so they go last). And a write that still fails
  says so, once, pointing at **Storage** in the menu — which reports whether the
  store accepts a byte right now, how much is in it and the biggest keys.
  Anybody can read that, because anybody can be the one it is happening to.
  **And the vault on the way out.** `Account.sync(true)` now runs on `pagehide`,
  on the tab going hidden, and every five minutes — a save on this device is one
  disk, and the vault is the copy that survives the disk.
  *Test note:* the storage block has to run **last**. Put before the crossword UI
  checks it moved them off the puzzle they expect; a block that writes storage
  keys is not order-independent however careful it is about putting them back.

- **2026-09-06 (5)** — **Three silent failures, which is why none of them could
  be reproduced from a clean start.**
  A sudoku turned up with no clues in it at all and a crossword size button did
  nothing, and neither could be made to happen here — because in both cases the
  code's answer to "that did not work" was to say nothing and carry on.
  **A shelf entry is handed straight to the player**, so one bad write is a grid
  with no clues and no way back. `_sane()` is the gate: eighty-one squares, a
  full solution, and at least seventeen clues — the real floor, since no sudoku
  with fewer has a single answer, which makes anything under it a corrupt save
  rather than a hard one. Refused on the way *in* to the shelf and again on the
  way out, and a failing entry is deleted rather than left to be found again on
  the next open. That is the difference between a bad day and a game that is
  broken every time you come back to it.
  **`Cross.load` returned quietly when its index was not in the bank**, so a
  size button could leave the old puzzle on screen, look pressed, and say
  nothing — "the smaller sizes keep stopping working". It returns a boolean now
  and `setSize` tries where you were, then today's, then the size's first
  puzzle, and only then says it cannot.
  **And `writeGame` swallowed every storage error.** A full disk, storage
  switched off, a database gone bad: all three looked exactly like working right
  up to the restart, where an hour of play was simply not there. Reported, of
  course, as "it does not save". It now says so once per session — once, because
  a toast on every keystroke of a game that cannot save is its own kind of
  broken.
  **The Tetris question moved to New.** It was on the reset item in the hold
  menu, which is where every other game's reset lives and is not where anybody
  presses; New sat beside the score throwing games away in one silent tap. New
  stops the board and asks — and does not ask about a board nobody has touched.

- **2026-09-06 (4)** — **A blank button, a shelf in no order, and a board that
  kept falling while you read the question.**
  **There is no global `.hide{display:none}` in this app**, on purpose — every
  component hides its own things. The price of that is that a component which
  hides something has to *have* the rule, and the confirm card did not:
  `askConfirm` toggled `hide` on `#confirm-alt` and nothing was listening, so
  every two-answer dialog carried a blank pill beside Cancel. An empty button is
  worse than a wrong one — it reads as a control whose label failed to load, and
  people press it to find out. One rule, and a check on the computed style of
  both shapes of the dialog.
  **Cheapest first, on every shelf.** Looks, sounds, clock faces and all six
  wardrobe rows were in the order the entries happened to be written, which is
  no order at all to the person paying. `embByPrice` sorts a copy — these
  catalogues are read from elsewhere and sorting one in place would reorder the
  thing itself — and ties hold their catalogue position so nothing reshuffles
  between two items at the same price, and the free one stays at the front.
  **The wordle grid is always six rows.** It stopped where the word was found,
  so a lucky first guess drew one row and a six-guess grind drew six — and on a
  calendar the eye compares heights before it reads anything, which made the
  best possible day look like the worst. The spare tries are drawn hollow.
  **Reset stops the clock before asking.** A confirm over a running game asks
  you to decide while the thing you are deciding about carries on happening: in
  Tetris the piece kept falling behind the dialog, so reading the question cost
  you the board whichever answer you gave. `def.beforeReset` is the hook, Tetris
  is the only game with a clock that needs it, and saying no leaves it paused —
  resuming counts you in, which is what that count-in is for.
  **The apron takes no colour**, with the denim jacket, lab coat, blazer and
  dungarees.

- **2026-09-06 (3)** — **"Open on today" was right for the shelf and wrong for
  the difficulty buttons.**
  Yesterday's change made both puzzle games open on the newest edition, which
  was the fix asked for. It also went through the difficulty and size buttons,
  and those are not the same act: half a Tuesday hard, a look at easy and back,
  and hard was today's empty grid with the clock at zero. **The board was never
  deleted** — it sat on its own shelf under its own day the whole time — but
  nothing could reach it again, and from a chair that is the same thing. Both
  games now keep a `seen` map, size or difficulty to the day you last had open
  there, and a button hands that grid back with its letters and its clock.
  Landing on an older one sets `_chose`, so coming in from the shelf afterwards
  does not undo the choice.
  **And the reason the crossword looked broken.** `_migrate` carries a record
  forward onto the grid now at its index if two thirds of its letters agree —
  the right test for "same puzzle, keep the work", and far too weak for a `done`
  flag. A record wrongly carrying that flag opens the board full of letters,
  under the win banner, with `type()` refusing every key, which nobody reads as
  a stale save: they read it as the game being broken, and report that they
  cannot enter or choose anything. The flag now survives only on an exact match
  with the solution; everything else comes through as work in progress.
  **`_where(size)`** replaces `_firstUnfinished` as what a size switch opens:
  where you were, then today's edition *even if it is done*, and only then the
  newest unfinished. Finishing today's should not drop you into the archive —
  that is what put people on the oldest 15x15 without asking.
  Four new checks, each confirmed to go red when its guard is removed.

- **2026-09-06 (2)** — **The five new hairstyles cost something now, and a lab
  coat stays white.**
  **A row of prices shorter than its list of parts is silent.** `BUD_COST.r` had
  six entries and `BUD_HAIR` eleven, so the five hairstyles added last batch all
  showed a bare `0` in the shop — which reads as an option that is broken, not
  as one that is free. The two tables are deliberately kept apart so an art
  change never touches the economy; the price of that separation is exactly this
  failure, so the smoke test now walks every row and fails on any part after
  index 0 with no price. Bowl 18, Mohawk 32, Space buns 30, Afro 34,
  Pigtails 26.
  **Colour belongs to the coats that are a shape, not to the ones that are a
  uniform.** `dye:1` was on nearly all of them, which offered a magenta lab coat
  and a lime denim jacket — at this size a lab coat *is* the white and denim
  *is* the blue, and recolouring one leaves a garment nobody can name. Denim
  jacket, lab coat, blazer and dungarees lose the dial; capes, puffers,
  cardigans, ponchos and the rest keep it. The wardrobe already read the flag
  off the part, so dropping it takes the swatch row with it.

- **2026-09-06** — **Puzzles open on today, sudoku gets a Reveal, and the five
  new heads come up off the ears.**
  **The shelf opens on today.** Both sudoku and the crossword waited for the
  board you were on to be *finished* before moving on, so one abandoned in April
  was still the front door in September — the archive had quietly become the
  default. They now open on the newest edition and the archive is reached
  through History and the calendar, which is the right way round. Nothing is
  lost: sudoku stashes the old grid on its shelf and the crossword keeps every
  puzzle's letters under its own fingerprint. `_chose` is the exception — set
  when you pick an older day by hand, cleared when the app closes, so a break
  and back returns you to the same grid and tomorrow returns you to tomorrow's.
  **A red cross belongs to one square.** `input()` cleared the whole of `wrong`,
  so a check that found four mistakes showed them until you touched anything and
  then showed none. Only the answered square's mark goes now.
  **Sudoku has Reveal**, which the crossword has had since it shipped. The
  square is filled from the solution and locked afterwards, like a given one —
  writing the check for that found that `input()` guarded `given` and not
  revealed, so you could type over the answer you had just been handed. The
  count rides on the calendar record as `h`.
  **Boards save on the way out.** A phone killing the app and a lid closing skip
  every button there is, so the last minutes of a crossword only survived by
  luck of the ten-second beat. `Arcade._stow()` on `pagehide` and on the tab
  going hidden. Both puzzles now say so in a line under the grid, because
  "what happens if I just close this" is a real worry with a good answer.
  **The nearest wave is sharp.** Blurring all three layers equally is what made
  the tide look low-quality — it reads as an out-of-focus photograph rather than
  as distance. The front crest carries no blur at all; the two behind it are
  softened by a little and by more, and that difference is the depth.
  **Magma is not all one size.** Nine shapes at one width is one shape drawn
  nine times and the eye finds the repeat. Every third is half-size and every
  fifth two thirds and faster, with the count up to eleven to keep the ground
  covered.
  **Five snowflakes, and the pellets are back.** One flake repeated is one
  flake, however good it is. Classic, star, dendrite, plate and needle by
  `nth-child`, and every seventh particle is a plain round dot again — real snow
  is mostly those, and dropping them is what made the field feel sparse.
  **The five new hairstyles were all sitting one to three units too low**, each
  drawn on its own circle instead of the skull's, so every head wore a crescent
  of bare scalp on top. Invisible in a list of hairstyles, obvious on a face.
  `tools/look-hair.mjs` is new and draws the row over the skull with the crown,
  brow and equator marked; that is the check, and §6 now carries the rule.

- **2026-09-05 (3)** — **Waves that are waves, flakes with arms, and the
  faces moved to the shelf.**
  **The tide, fourth attempt.** Bright bands were smears; hard dark rules were a
  barcode; fields of soft ellipses were horizontal smudges. All three failed the
  same way — they were built out of *horizontal shapes*, and the one thing a
  wave is not is horizontal. Each layer is now a tiled SVG of the actual thing:
  a scalloped line, a lit edge where the water turns over, a body fading away
  under it. The scallops inside a tile are deliberately uneven (only the first
  and last amplitudes match, which is what keeps the seam smooth) because evenly
  spaced ones tile into something that reads as knitting. Three layers, getting
  wider, darker and slower towards the bottom — that difference in scale is the
  whole of the perspective — and they travel **down**, because the shore is the
  bottom of the screen. Two smoke-test checks pin the coupling nothing else
  connects: tile height in `background-size` against travel in `@keyframes`.
  **Magma is big again.** Nine shapes at 2.3 opacity and a width floored at
  66vw, so the dark ground barely shows through instead of pellets crossing it.
  **Snowflakes have arms.** Crossed bars gave six of them but at 8px each arm is
  a pixel of blur. The paint stays `var(--c)` — a look has to be able to dye the
  snow — and the *shape* is now an SVG mask, which carries no colour and so
  freezes nothing. Six spokes, four pairs of branches, a disc in the middle, and
  `--s` raised to 13–30px so there is room to see any of it.
  **Five hairstyles thrown away and redone.** Cropped/Bob/Afro/Quiff/Braids were
  five hair-shaped domes: at the size he is drawn, the silhouette is nearly all
  of it, and five outlines that differ only in shading are one style five times.
  Bowl cut, Mohawk, Space buns, Afro, Pigtails — each recognisable as a black
  shape with the light off. Same two rules as the first set.
  **The "who is playing what" marks moved off the room list and onto the arcade
  picker**, on the card for the game they are in. The room list is for who is
  here; the shelf is where you decide what to open, so that is where knowing
  someone is already in there changes what you do. `Arcade._faces()` in
  09-arcade-core.js, fed by `syncInGame()`.
  **Tetris pauses when you go back to the shelf**, not only when a session
  starts — `leave()` sets the flag, `enter()` counts you back in.
  **The Tetris card is a T-piece** rather than a stand-in glyph.
  *Also learned:* `vfxApply()` hands the pane an empty kind while the timer is
  on its setup screen, so every look tool was photographing weather that was
  never painted. `look-beach.mjs` now sets `S.mode = 'focus'` first. An effect
  that "renders nothing" is worth checking for this before the CSS is blamed.

- **2026-09-05 (2)** — **Dark water, five more heads, and who is playing what.**
  **The tide is dark lines now.** The crests were lit, in the horizon's orange,
  and spread over thirty-odd pixels each — at that width it is not a line, it is
  a smear, and a screenful read as a blurred photograph rather than as water.
  Look at the real thing: a sunset lights the *water*, and what you see on it
  are the troughs, dark against the light. Each band is a few pixels wide with a
  1.5px feather; the background does the lighting and these only interrupt it.
  Generated from a table rather than typed, so the stops stay exact.
  **Five more hairstyles**, chosen to be different *silhouettes* rather than
  different textures — at the size he is drawn the outline is nearly all of it,
  and two styles differing only in shading are one style twice. Cropped, Bob,
  Afro, Quiff, Braids. Each keeps the two rules the first set set: the sides
  wrap past the widest point so no crescent of scalp shows at the corners, and
  nothing crosses y=23.5 in the middle, which is what leaves a forehead.
  **The room says who is playing what.** A room is four people on their own
  screens, and the list said who was there and nothing about what they were
  doing — so the answer to "is anyone up for chess" was to open chess and find
  out. It rides on the heartbeat, which is the only regular thing a guest sends.
  The glyph is the picker's own, because the mark beside a name should be the
  mark on the card you would tap to join them. **"Following" went** while doing
  it: it appeared on every non-leader row, said the same thing each time, and
  was the first thing to squeeze a name down to "S...".
  **Tetris: opening the board no longer un-pauses it.** `enter()` set
  `paused = false`, which threw away every reason the game had been stopped — a
  focus block paused it, and reopening the arcade mid-block had it running
  behind the timer again. The rule is the timer's now: stopped during a block,
  counted back in at any other time, because a break is what this is *for*. And
  a paused board is **put away** rather than left up: half the game is working
  out where the next piece goes, and a stopped board is that puzzle with the
  clock switched off.
  Also: the mood row is smaller, and in scale with the cards under it.

- **2026-09-05** — **A sunset, a mutual unfriend, and one emoji a day.**
  **Beach is a sunset now, and dark.** It used to be the one *light* look, which
  was the wrong idea twice over: a cream ground meant `--card`, `--line` and
  `--track` had to be inverted for it alone, so every rule reaching past the
  tokens for a white wash needed a beach-shaped exception beside it — and a
  focus app is mostly used in the evening, where a sheet of daylight is not what
  anybody wants. Violet overhead, magenta through the middle, a narrow band of
  hot orange on the horizon, and the crests catch the sky rather than staying
  blue. The tide stayed; the palms went with the daylight (blurred trunks
  against a dark sky read as blots), and with them every light-mode override.
  **Removing a friend removes it for both.** It was one-sided: you took somebody
  off your list and stayed on theirs, still shown as a friend, still able to
  walk into your room without knocking — two lists that happen to agree most of
  the time is not a friends list. `friendRemove` sends `fr:bye` down the same
  path a message takes, and the far side removes quietly (`quiet`), because two
  apps politely un-friending each other forever is not a conversation.
  **One emoji a day** — new `17b-mood.js`. A number out of five is a judgement
  and invites you to argue with it; a face is a shrug you can give on the way
  past, and the point is not measurement but that in three months the calendar
  shows a *shape*. Asked once on the first open of a day and never again, answer
  or no answer (a wave-away is stored as `''`, which is why the merge lets a
  real face beat one). Changeable from the day panel, and picking the one
  already there clears it — otherwise there is no way back to an empty square.
  On the calendar the face sits **bottom-right alone**, because it is the one
  thing on a square you read rather than count; the note, event and task marks
  moved into a **row in the top-left**, and the date stays centred — the first
  attempt moved the date to the top-left as well, which traded one collision for
  another. `.mood` names an emoji font stack explicitly, or the browser draws
  its monochrome fallback and a face becomes a smudge.

- **2026-09-03 (4)** — **A door on the room, and Tetris you can put down.**
  **A room code is not an introduction.** It gets read out, forwarded, passed on
  by somebody you gave it to — and whoever ended up with it simply *appeared* in
  the room, named in the roster, in the chat, watching the timer. Somebody the
  host does not know is now held at the door: connected, because there is no
  other way to ask, and nothing else. The room chat says so in its own voice
  (`Chat.note`, drawn as a note rather than as something a person said), and the
  leader lets them in or does not. **Friends are never held** — being on the list
  is the introduction, and making people knock to enter a friend's room would be
  friction for the case that does not need it. `syncNeedsLetIn` is the whole
  rule; `syncBroadcast` skips anyone still waiting, so *every* kind of message is
  covered rather than each caller having to remember.
  Writing the test for that found the leak it was meant to prevent: the host sent
  the roster and the timer state on **socket open**, which is before `hello` and
  therefore before it has any idea who this is — so somebody held at the door got
  the whole room anyway. Both go through `syncGreet` now, called when a peer is
  actually let in.
  **Tetris**: a focus block starting pauses the board (the arcade is for breaks,
  and a piece falling behind a block is a stack you did not build); resuming
  counts you in over three seconds, because unpausing used to drop you into a
  piece you had stopped thinking about, and nothing moves while the numbers are
  up; and Down sits under Rotate on the pad, with Drop moved away from it — it is
  the one that ends your turn and should not be beside the one you press twenty
  times a piece.
  **The profile is a focus profile again.** "Day streak" was the sudoku streak,
  which is a fine number and is not what anybody reading a focus profile assumes
  it means; it is days in a row with a block finished. Plus the two free-play
  bests (Tetris, 2048) and how many things you have bought — the free look is not
  counted, or a brand new account shows a 1.

- **2026-09-03 (3)** — **Tetris at speed, and a code you have to earn.**
  **A new piece hangs for 220ms before gravity takes it.** By level eight a row
  is 130ms and by twelve it is 80 — less time than it takes to decide where a
  piece goes, let alone move it there, so at speed the game stopped being about
  placing pieces and became about whether you could react at all. Input works
  throughout, so the beat is *for* moving rather than a wait to sit through, and
  a hard drop cuts through it. It does not scale with level: the point is that
  there is always time to start the move. Whatever of the tick is left when the
  beat ends is handed to gravity, because swallowing it whole is a free frame at
  level one and a missed row at twelve.
  **The bag is ten**: one of every shape plus three drawn again. The seven are
  the guarantee — every shape in every bag, so no shape is ever more than
  nineteen pieces away — and the three spares are what stop the tail being
  deducible, which a plain seven-bag gives away entirely. The test pins the
  drought bound, which is the thing a player actually feels, rather than the
  bag, which is only how it is kept.
  **Clearing rows has its own sound.** It was on `chime`, which is what a focus
  block plays when it ends — so finishing a row in the arcade sounded exactly
  like your session finishing. `tetrisTone` is arcade instead: triangle wave,
  short, running up rather than resolving down, with a longer run and a low
  drop under it for four. `tetrisLock` is a barely-there tick for a piece
  landing.
  **Pause moved out of the header** — it was one of four things crowding the top
  bar — and is now a 56px glyph under Best, lit while paused.
  **And the friend box shows a code only once the account is found.** Showing it
  as you type made that box a machine for turning any string into a working
  address, which is a directory; this app does not have one and should not grow
  one by accident. It asks `/account/who` first, and the code is then a
  confirmation rather than a lookup. No server, no opinion — the box says
  nothing and Add still works.

- **2026-09-03 (2)** — **Tetris earns its clears; chat is ordered by who
  actually spoke.**
  Tetris: **the speed follows the score**, not the line count — forty singles
  used to reach the same speed as ten tetrises for a quarter of the points,
  which made the two ways of playing feel identical. Level n starts at
  `400*n*(n+1)`. **One next piece** rather than three (a column of previews
  taller than the information in it), and the previews are **drawn at the
  shape's own size and centred** — on a fixed 4x4 the O sat in a corner and the
  I hugged an edge, which is exactly where they live inside their rotation
  boxes and reads as broken. **And four rows at once now looks like it**: a gold
  band per row, a pulse across the well, and the word said out loud.
  Two bugs came out of building that effect, both found by *looking* at it.
  `_clear` spliced rows as it walked, so every removal shifted the rest down and
  it reported the same index once per row cleared — four rows came back as
  `[21,21,21,21]` and the tetris flashed as one. Fixing it by removing from the
  bottom up was still wrong, because putting a blank row back after each splice
  shifts everything again: it took out two real rows and two innocent ones. It
  is find-them-all, then remove, then pad, and the smoke test pins both.
  **Typing a username shows the code it makes**, in the add box and nowhere
  else. A code is a hash of the name, so this needs nothing and nobody — but a
  screen that turns names into codes on demand is a directory, and this app does
  not have one. Once typing settles it asks `/account/who` whether that name is
  a real account; no answer still lets you send, because somebody may sign up
  tomorrow.
  **Chat: whoever spoke last sits next to the room.** The order was whoever
  happened to be about, then the friends list — no relation to who you are
  talking to, so a reply could be four tabs along behind people who have never
  written to you. Unread outranks read, then most recent. **And a name in the
  room opens that person's thread**: room lines now carry the sender's code,
  because matching a name against the current roster answers this right up until
  they leave, which is exactly when you want to write to them.

- **2026-09-03** — **Tetris, streaks that mean something, and friends that
  follow the account.**
  **Tetris** is in the solo arcade, free play with a best score — `22a-tetris.js`,
  `08h-arcade-tetris.html`, `36-tetris.css`. Two things in it are done properly
  rather than approximately, because both are invisible in a screenshot and
  both are what separate Tetris from something shaped like it: the **seven-bag**
  (one of every piece, shuffled, dealt out before the next bag is made, so an I
  is never twenty pieces away) and the **SRS kick tables**, written out in full
  — a plausible invented table plays subtly, maddeningly wrong. Hold, ghost,
  lock delay, on-screen pad for phones. The smoke test checks the bag and the
  kicks directly, and both go red when removed.
  **A streak day is now the whole day.** Sudoku wants all three difficulties and
  the crossword wants every size that came out — two on a Tuesday, three on a
  Wednesday, the fifteen as well on a Sunday. It was the best of three (or four)
  separate streaks, so a long run of easy sudokus read as a long run of sudoku
  and the number meant nothing. `dailyStreak(game, diffs, on)` takes a list now;
  `dailyDay` decides a single day and `dailyStreakOf(game)` reads the game's own
  registration so the board, the calendar and a friend's profile cannot
  disagree. The number appears on the game screen as a fire chip, and the
  calendar says in one sentence what it counts — a number whose rule is invisible
  is one people either mistrust or misread.
  **Friends travel with the account.** `friends` is in the snapshot, with
  `mergeFriends` byte-identical in `47-merge.js` and `server/accounts.js`.
  Identity only: settled beats pending (a friendship is not undone by the phone
  that never heard the answer), and **cards do not travel** — a card is what
  somebody handed *that* device, and giving a stale one to a phone that has
  never met them would be the app inventing a profile.
  **And a code can be turned back into a name.** New `/account/who` on the
  accounts Worker: it holds every username, so it hashes them and matches.
  `codeForName` there must stay identical to `syncCodeFor` in `29-sync.js` — the
  alphabet was wrong the first time it was written, and a drift does not throw,
  it answers with the wrong person. `accounts-test.mjs` now reads the client's
  hash out of the source and compares the two that actually ship.
  **Needs a deploy**: `npm run accounts:deploy`. Until then `friendResolve`
  fails quietly and a bare code stays a bare code, which is what it was before.
  Also: the room buttons stopped crushing each other (both have a floor now and
  the row wraps before either is squeezed), and `sync-me` lost the negative
  margin that pulled it up into them.

- **2026-08-27 (4)** — **Focus together is about people now, and a streak is
  about the day.** The overlay opened on a six-letter code and a nickname you
  typed yourself, so the same person was "Sam" here and "sam2" there and nobody
  could tell whether a code they had been handed was even real. It leans instead
  on a fact that was already true and never used: **a code is a hash of a
  username** (`syncCodeFor`), so typing a name *is* finding the address — no
  directory, no lookup, no server change, nothing to deploy. You add somebody by
  username, they get a **request** and agree to it, and their name opens a
  **profile**: hours focused, sessions, day streak, sudoku, words, crosswords,
  and their buddy. A request is an ordinary mail item whose `text` starts with
  U+0001 then `fr:` — a control character, because it has to be something a
  person cannot type — and `friendTake` lifts it out of the stream before the chat log
  sees it. A **profile is a card they handed over**, riding on the request, the
  reply and `hello`, saying *as of two hours ago* rather than pretending to be
  live; there has never been a server here that knows what anybody did, and a
  profile page is not a good enough reason to build one. Codes are folded into a
  `<details>` at the bottom, for somebody with no account or a one-off room.
  New file `src/js/29a-friends.js`; the overlay body is rewritten around
  you → room → requests → people → start a room → codes.
  **Streaks count the day of release only.** A finished record now carries `d`
  when it was finished on its own day, and `dailyStreak` walks back over the days
  that game actually publishes (today is a grace day, and it stops at
  `DAILY_EPOCH`). Going back through the archive is welcome; it is not a streak.
  Sudoku, word guess and the crossword all lead their calendar tiles with it.
  **Word guess draws the grid.** The record keeps one string, five characters a
  guess (`g`/`y`/`x`), so the calendar can redraw the picture people screenshot —
  it says how close each try was and never which word it was.
  **And the puzzle calendar never crossed between devices.** `dailyAdopt` called
  `dailyMerge`; the function is `mergeDaily`, and its one caller in
  `48-account.js` wraps it in a `try/catch`, so signing in on a second device
  threw a `ReferenceError` into the void and dropped every day you had ever
  played — no error, no log, streaks simply absent. It has been that way since
  the calendar shipped. The new streak check goes through `dailyAdopt` rather
  than writing the record by hand, which is the only reason it surfaced; a test
  that reaches past the real path finds nothing.
  **A finished day is finished.** "Look again" hands the board back, and every
  key pressed on it used to overwrite the record — a word found in three,
  reopened and abandoned, became a miss, and the grid people screenshot became
  whatever was last typed. `dailyMark` now returns early on a day already at
  `DAILY_DONE`. The board is still playable; it just no longer counts. `p` is
  capped at 30, which is six guesses of five and not a character more.
  **And the grid moved into the row**, in place of the edition's name — a
  calendar of words did not need every line to say "Word" — with the result
  and the button centred against however many tries it took.
  **Some of the prose came back.** The cut of a day earlier went too far in
  three places, all of them things that cannot be worked out from the screen:
  what happens to the minutes left over when a block ends (the shop), what
  "nothing is replaced" actually means when two devices sync (the account), and
  when the next puzzle arrives (the calendar). The paragraphs that stayed cut
  are the ones the app was already demonstrating. The rule that came out of it:
  **cut what the screen shows anyway, keep what only the code knows.**
  **And the dry lines got something to say.** The four solo games were listed
  as specifications — "Easy, medium, hard", "Six tries, five letters",
  "Swipe or arrow keys", "5×5 to 15×15" — and each now says the thing worth
  knowing instead ("Everyone gets the same word", "Small ones daily, a big one
  on Sundays"). The four rooms-required screens all said the identical sentence;
  each says its own now, naming what the second person is actually *for* —
  somebody has to think of the word, no use drawing with nobody watching.
  Also: the picker's `2+` chip moved into the game's title, because it was
  landing on top of "needs a room" in the same corner, and the four two-player
  games now say nothing at all rather than "Room" when there isn't one.
  And the crossword's `_firstUnfinished` returns `{i, day}` — see §6.

- **2026-08-27 (3)** — **The calendar keeps results, not just states.** A
  recorded day was the number 1 or 2; it is `{s, t, g, c, n, h}` now — how long
  it took, how many guesses, how many clues, how many letters given away. The
  day panel shows *that* instead of repeating the edition's name down the page,
  and three tiles above the month give the game's totals; each game supplies
  its own `line(rec)` and `stats(all)`, because only it knows whether its
  numbers are guesses or clues. Old bare-number records read as `{s: n}`, and
  `mergeDaily` picks the record that got further (higher `s`, then longer
  clock) and keeps the loser's fields underneath.
  **No more resets in sudoku, wordle or the crossword.** A dated puzzle is
  played once and the result is kept; a button that wipes the board and the
  time with it makes the record worth nothing. **Sudoku keeps a board per day
  and difficulty** on a shelf in its save, so opening Tuesday's easy no longer
  throws away Monday's half-finished hard — and swapping grids stopped asking
  for confirmation, because nothing is lost by it. The crossword's own puzzle
  list is gone: its button opens the calendar, which is the list that also
  knows about the other three sizes and what you scored. `#11 of 11` is off the
  meta line (the position still decides the date; it just says nothing worth
  reading). Word guess says **History** rather than New.
  Also: the worn-item names were coming out as raw SVG — `n:` is a part's
  *name* and the new neck layer was added as `n:` too, so the second one won;
  it is `nk`. The party hat's yellow bands and pompom now survive being dyed
  (`keep:[…]` holds hexes out of `budDyeMap`). And **the screen copy was cut
  back hard** — the shop's five-line explanation of how embers are banked, the
  chat's paragraph about offline delivery, the picker's two-sentence blurb per
  game, the sign-out essay. The app was explaining itself at every turn.

- **2026-08-27 (2)** — **Every puzzle in the arcade is a dated edition now.**
  Sudoku at each difficulty, Wordle and the four crossword sizes get one a day,
  the same one for everybody, turning over at midnight in Pakistan. Three ideas
  carry it, all in the new `src/js/09b-daily.js`: a day is the *string*
  `pktDay(ts)` (PKT is UTC+5 all year, so the timezone handling is one added
  constant and no `Intl`); a puzzle is *derived* from its day rather than
  shipped — `dailyRng(dailySeed(game, diff, day))` replaces the `Math.random()`
  in `sShuffle`, `Wordle._new` and `Memory._new`, which is why nobody could
  compare a grid before; and the only thing stored is what you *did*, one small
  `{'sudoku:easy': {'2026-08-27': 2}}` record that merges by union-then-max in
  `47-merge.js` and `server/accounts.js`. The crossword can't be generated, so
  it gets a *schedule* instead — 5×5 and 7×7 daily, 9×9 Wednesday and Friday,
  15×15 Sunday, counted from `DAILY_EPOCH` — and its shelf lists dates rather
  than `#1`. **The bank must stay append-only**: a puzzle's date is its position
  in its size's list, so inserting one in the middle rewrites history and
  orphans saved boards; the smoke test pins the first few dates. Days past the
  end of the bank get an *encore* of an earlier puzzle, said out loud, rather
  than nothing. One overlay serves every game's calendar (`#dcal-overlay`): a
  dot per edition, its colour the difficulty and its fill how far you got, with
  the archive always open — only today is rationed. The roll is built in, a
  timer to the next Pakistani midnight re-armed on every wake.
  Also this round: worn cords go *round the neck* — `budPart` grew a third
  layer, `n`, painted under the skull, so a pendant chain and a medal ribbon
  disappear at the jaw instead of starting below it; the party hat was being
  clipped by the `<svg>`'s own default `overflow:hidden` (only `.bud-slot svg`
  ever had `overflow:visible`, which is why it looked fine on the timer and cut
  off in the wardrobe) and now sits on the crown rather than sunk into it; the
  ponytail lost its scratch of a parting line and gained a forehead; and the
  wardrobe has a **Start over** that puts every row, every colour and all three
  eye dials back — the dials to `BUD_EYE_MID`, not 0, which is the bit worth
  saying out loud.

- **2026-08-27** — **A price is not a number you can just change.** The balance
  is derived and never stored — `have = earned - SUM(price(id) for id in own)` —
  so putting eleven lights, five tracks and three clock faces up at once
  recomputed everybody's spend at the *new* numbers and took hundreds of embers
  off people who had bought them at the old ones. Several balances landed on
  zero. Two things are true now: `EMB_WAS` in 37-embers.js freezes what each of
  those cost before the rise, and `Embers.grand` is the list a device was
  holding the first time it met the rise. `paidFor(id)` — not `priceOf(id)` — is
  what `reconcile()` prices the owned list with, so anything grandfathered keeps
  its old price forever and anything bought afterwards pays the shelf. `grand`
  is unioned across devices like `own` is, in both `47-merge.js` and
  `server/accounts.js`; the server rebuilds snapshots from the keys it knows, so
  a key it is not told about is a key it silently drops. The smoke test boots a
  device with a pre-rise record and asserts 195 rather than 88.
  Also this round: **the hair was a ring** — every style hung from `A r r 0 0 1`,
  the *small* arc, which crests four units below the skull, which is the bald
  patch you could see through all six of them; the large-arc flag picks the
  head's own circle. Hairlines moved off the eyes and up to a forehead, and the
  pulled-back ones (bun, ponytail) stop at the equator instead of the ears.
  **Nothing worn may start above y=43** — the chin — because `worn.s` is painted
  after the head: the backpack straps, the pendant cord, the medal ribbon and
  the lanyard were all drawn on his jaw. **The falling sand showed through the
  heap** because `.hg-sand` was `opacity:.85`; moving the stream behind the bulb
  in document order does nothing when the thing in front is see-through, so the
  alpha is mixed into the fill instead. The wardrobe's sticky stage pins at
  `-6px` with square top corners rather than filling the gap with a translucent
  `box-shadow` (that shadow was the "weird outline on top"), and has 26px over
  his head so a party hat's pompom at y=-6.6 clears. **`budStrip` now refuses to
  run before `Embers.ready`**, and never clears `S.budAnim`: `budAnimIdx()`
  already hides an unowned antic, so writing -1 bought nothing and cost the
  choice for good the first time an ownership list was read a beat early — that
  is "sometimes antics randomly reset". Leaving the buddy menu offers three
  answers (Save / Discard / Keep editing) via `askConfirm`'s new `opt`.

- **2026-08-26 (3)** — **Everything he wears is bought now, and there is a shop
  to buy it in.** Five new drawings in every row — eyes, hats, face, worn,
  outerwear — plus **hair**, which is its own row rather than more hats because
  you wear both. Every part can be **dyed**, and no part had to be rewritten for
  it: `budDye` reads the colours already in a drawing and moves each one onto
  the chosen hue *keeping the lightness it had*, so a hoodie's drawstrings stay
  near-white when the hoodie turns red and index 0 returns the string untouched
  (there is a check that the untouched one is byte-identical). Eyes get an ink
  and a size instead of eight more drawings of everything: one `<g>` fill and
  one scale about the point between them, so both apply to every style there is.
  The shop is five tabbed shelves — Looks, Sounds, Clock faces, Buddy, Antics —
  and on the buddy shelf **you put a thing on before paying for it**: the
  preview is him, the tile is lit, and nothing is bought or written down until
  the confirm. The wardrobe holds only what you own, with one button through to
  the shop rather than a wall of locked tiles. Skin and body colour are free and
  always were; so is every dye. Antics are the dearest things in there.
  **The update takes everything off everybody** — not as a migration behind a
  flag but as a rule that holds continuously: `budStrip` takes off anything not
  in `Embers.own`, at boot, when an account arrives, and when progress is reset.
  830 smoke, 56 account-client.

- **2026-08-26 (2)** — **"Sometimes the swing is broken" and "sometimes the
  skateboard turns early" were one bug, and it was a clock.** The travel is an
  animation on the slot and the arc, the mirror and the board's turn are
  animations *inside* it; refilling the slot with `innerHTML` restarted the
  inner ones and left the outer one running, so from then on he swung backwards
  under his own web and the board turned before the corner. The "not always" was
  that it only starts when something re-renders him mid-lap. The slot is
  replaced now rather than refilled — see §6. New `tools/look-swing.mjs` reads
  `startTime` off `getAnimations()` in a real browser and prints the drift for
  every antic: 700ms+ before, 0 after. Also: the crossword no-repeat check was
  asserting `GAP = 4`, a rule the generator retired in favour of 2, which is why
  a correct bank kept blocking releases; and the size check was written as
  `=== '5,7,9'` and had been failing since fifteens were added. Both now take
  their number from the thing that owns it. `-AllowBankInProgress` is down to the
  three counting checks, and the no-repeat rule is deliberately not among them.

- **2026-08-26** — **Fourteen things, and two of them were the account quietly
  eating your work.** The vault's copy of the merge rules (`server/accounts.js`)
  had never grown past `log/own/claimed/feats/adjust/sim`, and it *rebuilds* the
  stored snapshot from the keys it knows — so the first put looked fine, being
  written verbatim, and every put after it dropped the calendar, the checklist
  and the tombstones on the floor. Both copies now carry the same list and
  `server/accounts-test.mjs` fails if one of them forgets again. On top of that,
  `snapshot()` grew the two things that were never in it: **your own quotes**
  (which had no ids, so a deletion could not travel — they are hashed from their
  own words now, see `quoteId`) and **the single-player arcade**, boards and
  best scores both, through a small registry in `09-arcade-core.js` where every
  game's save is stamped and adopted rather than each game inventing its own.
  The rest: the **hourglass** stopped hanging its sand from the ceiling during a
  break (see §6 — turning the glass over moves which edge is the low one, and
  swapping the bulbs was only half of it); **Leave** means left; **one account,
  one room code**, settled after everything has loaded rather than by whichever
  load finished first; the **antic is a draft** until Save, like the rest of
  him; a **0-minute session** is not history unless something was ticked off;
  **Coat became Outerwear**, drawn in curves with nothing poking out, and worn
  items sit over it; **ambience** primes itself on the first tap so a follower's
  track is not blocked by autoplay; **crossword puzzles say how many clues are
  done** rather than "in progress"; and the infinite run pauses **every four**
  blocks instead of eight, with the line under the clock bounded so it fits.
  796 checks, plus 55 account-client and 66 server.

- **2026-08-21 (2)** — **A paused clock was keeping time in the background.**
  45-notify.js calls `tick()` on the way back from being hidden, to catch up a
  block that ran while the page was frozen; it never asked whether the block was
  running, and `S.endAt` is a stale number the moment you pause. Pause, switch
  away, come back: the clock had counted down the whole time, the minutes were
  in the log and the ember count, and if you had been away longer than the block
  it had chimed, banked the session and moved you into the break. Guarded in
  `tick()` *and* at the call site, and there is a check that stands `Date.now`
  on a jump table and moves it half an hour. Alongside: the Coat row moved above
  Worn; the tightrope antic removed and its clean full-window crossing given to
  the jetpack, which now climbs and dives on a 17s clock against a 31s lap; the
  skateboard stands up straight and gains turning wheels, a wheelie and a
  kickflip; Pace slowed to 78s and put on the floor; Read became Reading, with
  the book turned round and held up in front of his face; the headphones raised
  off the skull with the cups moved outboard; and the cardigan and the hi-vis
  stopped hanging off their own hems.

- **2026-08-21** — **The buddy gets a wardrobe, six more antics, and company.**
  The cap and the jester were **redrawn in place, not removed** — the part
  tables are index-based and somebody else's number draws against our list, so
  deleting an entry redresses strangers. The cap has a crown that follows the
  skull and a bill big enough to survive 26px; the jester has three drooping
  belled horns over a two-tone cap. The wrapped band now reaches both sides of
  his tummy: the two units of body colour showing past each end were the whole
  difference between a band going *round* him and one painted *on* him. New
  `BUD_OUTER` list — nine coats, a sixth index, and a missing `o` reads as 0, so
  every buddy that predates it keeps wearing nothing. Six antics appended:
  Skateboard, Tightrope, Jetpack, Balloon, Pace, Read. And everybody in the room
  now stands on the timer screen doing *their own* antic, desynchronised by a
  single inherited `--t`. Their antic had been riding in `hello` and being
  thrown away since the day it was written, so every room was a room of
  identical web-swingers while the comment beside the room list said otherwise.
  777 checks.

- **2026-08-20** — **1.0.10, and the voice.** DevTools sealed in packaged builds
  (F12, Ctrl+Shift+I/C/J, right-click Inspect, and the menu bar that carries the
  accelerator) while dev keeps them. The update banner now shows the release
  notes *while downloading* and says "You are up to date" with when it last
  looked, instead of redrawing the same Check button whether it had looked or
  not. Added a smoke check that scans every quoted string in the build for
  assistant-voice tells — first person, apologising, courtesy formulas. It
  caught its own false positive first (the word "ill" matching `\bI` under a
  case-insensitive flag), which is the useful kind of lesson about tripwires.
  `make-release` now defaults to `minor`.

- **2026-08-20** — **1.0.9.** First build whose auto-updater can work. Also set
  `allowDowngrade`/`allowPrerelease` false explicitly and added a check that
  GitHub's "Latest" label is on the highest version — it is assigned by publish
  date, so editing an old release silently points everybody backwards. And made
  the handover room-name assertion poll instead of trusting a fixed 1800ms
  pause: the name arrives after the handover message, so a loaded machine turned
  a timing gap into a reported product bug.

- **2026-08-20** — **And the deeper one: the updater was never in the app.**
  With the release complete, 1.0.7 *still* only offered the link. From its own
  console, `window.focusUpdate` was a live object but `focus-update-ready` got
  no reply at all — so `setup()` was returning before it registered the handler.
  `build.files` listed three entries and no `node_modules`, which replaces
  electron-builder's default and leaves `electron-updater` out of the package;
  the `require` threw and took the whole updater with it, silently. Fixed by
  packaging node_modules, answering the page before any guard can return,
  and letting `configured()` accept `app-update.yml` — the file electron-updater
  actually reads — rather than gating on a package.json field that packaging is
  entitled to rewrite.

- **2026-08-20** — **"Auto-update is broken" was a release with one file on it.**
  The v1.0.8 release had `latest.json` and no `latest.yml` and no installer, so
  the page correctly announced 1.0.8 and electron-updater correctly found
  nothing. Diagnosed from the app's own DevTools console — `window.focusUpdate`
  was a live object, and the GitHub API said `TAG: v1.0.8 | ASSETS: latest.json`.
  Added `build.artifactName` so builds are born without spaces in the name,
  and three checks to `publish:check`: the token is authenticated, `latest.yml`
  must match the file beside it, and the published release must carry both an
  installer and a `latest.yml`.

- **2026-08-19** — **The shell registered its update listener after loading the
  page.** The renderer announces itself on subscribe and the shell replays its
  state in reply; `setup()` running after `loadFile()` is a race the page can
  win, and when it does no state ever arrives. Also: `idle` — the state written
  the moment the page subscribes, before the shell has said anything — was being
  read as "the shell is handling it", so silence hid the manual link *and*
  showed no progress. Silence now counts as no shell.

- **2026-08-19** — **1.0.8. The account became a profile.** `snapshot()` carried
  the log, embers and five settings; it now carries the calendar, the checklist,
  the theme, the ambience, the buddy and his antic. Added `GONE` tombstones
  (14-util.js) because a union resurrects deletions. Signing in now warns, then
  erases, then pulls; signing up still carries this device's work up with it.
  Two bugs found on the way: `focus_plan` was missing from `DATA_KEYS`, so
  **exporting your data had been silently dropping the whole calendar**, and
  `save()` wrote a timestamp to storage without updating `S.at` in memory, so a
  setting changed and synced in one session could lose to the server's older
  copy.

- **2026-08-19** — **The chosen antic was never written down.** `S.budAnim` and
  `S.budShow` were set by the picker and read by `stage()` and persisted
  nowhere, so the choice lived as long as the tab did. It read as the picker
  ignoring you; it was `02-persistence.js` never saving it.

- **2026-08-19** — **Idling.** `49-rest.js` + `34-rest.css`: ~50 infinite
  animations ran for the entire life of the app, and Chromium throttles timers
  and rAF on its own but not compositor animations. `html.at-rest` stills
  everything on `visibilitychange` and the two decorative layers are taken out
  of the tree rather than merely paused. `prefers-reduced-motion` now removes
  the buddy and the effects layer and shortens the rest. Not blur — watching him
  while you work in another window is half the point.

- **2026-08-19** — **The swing, finally.** Six swings out to 122vw and back to
  -22vw, so both ends and the mirror flip happen off screen; `bud-go` is
  `linear` because an easing curve was losing to the pendulum twice a flight;
  the two ropes are one animation a swing apart, so the web he throws is the web
  he lands on. Arc retimed to 1.3s (one swing) — the throw's counter-rotation
  can only cancel the rig exactly if both are linear over the same interval.

- **2026-08-18** — **The pose class was on two elements.** `budSvg()` stamped
  `bud-swing` on the `<svg>` and `stage()` on the slot; both ran `bud-go`, so
  the drawing travelled twice and drifted out from under the rope. The web was
  never detached from its anchor — *he* was detached from the web. Confirmed
  from a screenshot: he sat at exactly double the rope's displacement.

- **2026-08-18** — **The arm keyframes threw both hands off the canvas.**
  `var(--bud) * .5` inside an SVG is user units on a 64 viewBox while `--bud` is
  55 layout pixels, so a fist at (46,16) landed at (73.5,-4.6). For half of
  every cycle neither hand was near the web. Hands no longer swap: `.bud-hand-l`
  is welded to the anchor, `.bud-hand-r` does all the throwing.

- **2026-08-18** — **The arc ran backwards.** The rig pivots at its top and CSS
  rotation is clockwise-positive, so a point hanging below turns *left* on a
  positive angle: positive is behind him, negative is ahead. `bud-arc` went
  `-30 → +30`, which is front to back — a man swinging backwards under his own
  web, written into the sign the whole time.

- **2026-08-16** — **The buddy was not moving because of a duplicate keyframe
  name.** `bud-lift` existed twice — the main menu's hand raise and the swing's
  rise — and the later definition wins for both. Since it drives `transform` it
  overrode `bud-go` on the same element entirely: he swung, and never travelled.
  The perch's is `bud-perch-arms` now, the swing's rise is folded into `bud-go`
  as `translate(x, y)` so one animation owns `transform`, and a smoke check
  fails on any duplicate `@keyframes` name. See §6 — this one cost hours and
  every inspection of the CSS looked correct, because it *was* correct.

- **2026-08-16** — He was stuck in the corner because `@keyframes bud-go` read
  its distance from `var(--jump)`. The rig's `bud-arc` — literal degrees —
  animated fine, which is what made it look like a positioning problem rather
  than a resolution one. Every animated value is written out now (`42vmin`,
  `84vmin`, …) and `transform-origin` / the rope's `left` use a plain `72%` of
  the rig's own box instead of `var(--hx)`. See §6; there is a check that fails
  if any buddy keyframe starts reading a variable again.

- **2026-08-16** — **The pivot has to be on the rope.** Two webs hung at 0.72 and
  0.28 across while the rig turned about 0.50, so neither strand's top was on
  the pivot and rotating swung both *anchors* round in a circle — the web
  following him about instead of him swinging under it. One anchor x now, the
  rig turns about exactly that point, and alternating hands is done by moving
  the *arms* to it rather than moving the rope.
- **2026-08-16** — And he was pinned in the corner because `--jump` was
  `max(34vw, 40vmin)`: `calc(max(…) * 2)` inside a keyframe failed to resolve,
  so every step evaluated to nothing. **Rope and jump are both plain `vmin`**
  now — one unit, so they are comparable and the sum is forward at any window
  shape, which was the reason for the `max()` in the first place. Two checks:
  same unit, and the pivot on the tie-point.

- **2026-08-16** — **The jump is bigger than the return, so he never goes back.**
  The rig has to swing from +tilt to −tilt between webs, and on a fixed anchor
  that always drags him backwards; four attempts tried to make that acceptable
  (hide it in the gap, hold still through it, fade him out, rock him instead)
  and it was still backwards. He now *travels* while the new web flies, and by
  the time it hits the top of the screen the jump has more than paid for the
  return. **Both lengths are viewport units and the jump takes `max()` of two**
  — mixing `vh` for the rope with `vw` for the jump is what made an earlier try
  reverse at some window shapes and not others. A check reads the multipliers
  off `bud-go` and fails if the traverse ever decreases.

- **2026-08-16** — Swing back to the fixed-anchor 5.2s model, with **one** thing
  changed: the rig finishes turning back *before* the next web is shot, and
  holds still through the shot. It used to sweep from +tilt to −tilt across the
  whole gap, so he was travelling backwards while the web went forwards — two
  things going opposite ways at once, which is what looked wrong. The backswing
  now happens only where he is holding nothing, which is when it reads as
  flight. Two tilts (30°/24°) give two heights without touching his `top`.
  *Three cleverer attempts all made it worse: rocking him on one rope was a
  metronome, stepping the anchor detached the web from his fist, and fading him
  through the turn hid the buddy.* The hold between two adjacent keyframes at
  the same angle is the fix, and there is a check on it.

- **2026-08-16** — **The anchor moves, not the man.** Three wrong answers to the
  backswing before this one: rock him on one rope (a metronome), sweep him back
  at the moment he throws (jarring), fade him out through it (hiding the buddy
  is never the answer). What actually happens is that the *tie-point* moves —
  he releases at the top of an arc and the next web is fixed further along, so
  relative to it he starts at −tilt without having gone anywhere. `.bud-rig`
  rotates back **and** its `left` steps forward by exactly the width that
  rotation gives back; everything is in `vh` so the two cancel whatever shape
  the window is. Four tilts (26/34/22/30) give four heights, and the 8vh left
  over per step is the throw. **Nothing animates his `top` any more** — that was
  what threw him around the screen — and only the web lingers.
- **2026-08-16** — Swim: his head leads *always*. The depth turns exactly where
  the length does (four quarters, one dive each), so the heading can be read off
  the same quarters — right-and-down past 90°, left-and-up short of −90° — and
  the turn at each wall comes round through head-up. Plus an occasional barrel
  roll on `scale`, on a 37s clock that shares no factor with the 64s length.

- **2026-08-16** — Swing reverted to the working model with only the backswing
  removed. **Compensating the rig's return by stepping the whole layer forward
  was a mistake** — it detached the web from his hand and broke a thing that
  worked, to fix a thing that was merely ugly. The return is *hidden* instead:
  he fades for a quarter-second while the rig resets, and it goes unnoticed
  because the released web is still on screen going slack and the next one is
  being fired. **A cut web lingers** — sags, hangs for about a second, fades —
  which is both truer and what holds the eye through the gap. Two rope lengths
  (`--ropeA` 46vh, `--ropeB` 30vh) so he crosses at different heights, baked
  into keyframes rather than re-rolled at runtime.
- **2026-08-16** — Swim depth is four lengths, each with its own turn depth,
  instead of one sine repeated — he works down the window and back over a
  couple of minutes rather than retracing one line. Still a whole multiple of
  the length, which is what lets his heading follow the path.

- **2026-08-16** — **A fresh pendulum per web.** Every previous version reused
  one anchor: `alternate` rocked him on a single rope, and before that the arc
  wound back from +tilt to −tilt — sweeping him backwards at the exact moment he
  was throwing forwards. A real one re-anchors. The arc always runs −tilt →
  +tilt, and between swings two things happen together and cancel: the rig snaps
  back, and the slot steps forward by **`2 * rope * sin(tilt)`** — the width of
  that snap, computed by CSS trigonometry rather than tuned until it stopped
  drifting. He does not move sideways during the float; the *anchor* does, which
  is what re-anchoring looks like. Four swings, then off the right edge and
  round to the left.
- **2026-08-16** — The crossword picker was `position:absolute` inside
  `.ov-body`, which scrolls — so the panel scrolled *and* the page under it did,
  two momentums fighting. `fixed` takes it out of that flow.

- **2026-08-16** — **The swing never resets, it reverses.** The arc ran to
  +tilt then wound back to −tilt to begin the next swing — and the rig is half
  the screen tall, so that rewind swept him ~50vh sideways in a third of a
  second. That was the jarring part, not the handover. `alternate` removes it:
  the next swing *is* the way back, and progress across the screen comes from
  `bud-cross` underneath, which is how a real one works. The rope handover now
  straddles the top of each arc — let go before it, float through, catch on the
  way down — so the turn needs no hiding.
- **2026-08-16** — **The second fist never reached its rope.** Both arms ran the
  same keyframes on a delay, so both moved *down*; the hand meant to be holding
  web B ended up below it and the strand finished in mid-air. They are two
  keyframe sets now, `+.375` for the arm going down and `−.375` for the one
  coming up, landing each fist on `--hxa` / `--hxb` where its rope is.

- **2026-08-16** — **The swing stutter was written on purpose.** `Buddy._roam()`
  re-rolled `--rope` and `--tilt` on every `animationiteration`, and both are
  read by animations already in flight — so the anchor and the hang length moved
  between one frame and the next and he jumped. Not dropped frames: a
  discontinuity. Both are constants in the CSS now and `_roam` is a no-op.
  *No amount of variety is worth a visible seam.*
- **2026-08-16** — Swing rebuilt as swing → release → fly → shoot → caught, one
  per hand, on a single 5.2s clock. The airborne beat was **2% — a tenth of a
  second**, which is not flight, it is a dropped frame; it is 6% now and he
  rises through it. The shot rope used to fade in *while* it grew, so the
  interesting part happened at an opacity nobody could see: it is opaque from
  the moment it leaves the fist and what you watch is the `scaleY` running up
  to the anchor. Ropes alternate fists (`--hxa`/`--hxb`) and the arms trade
  places with them.

- **2026-08-16** — The rope now ends on his **fist**, not the rig's centre: the
  hand is at (46,16) of a 64-unit box, so `--hx`/`--hy` are 0.71875 and 0.25 of
  his rendered size and both the rope and his own offset are written from them.
  The pivot moved onto the fist too. The thrown rope pivots at its *bottom* —
  turned about its top it swung its far end away from his hand, which is a
  second rope going nowhere.
- **2026-08-16** — Crossword scrolls under a finger again: `touch-action:pan-y`
  on the grid, the cells, the clue list and the picker rows, and on `.ov-body`
  itself. See §6 — this is a general rule, not a crossword quirk.

- **2026-08-16** — **The rope left the drawing.** It was two paths inside his
  64-unit viewBox, so it could never be longer than ~50px — a man holding a
  short string, not a man hanging far below an anchor. It is `.bud-rope` in
  `.bud-rig` now, measured in `vh`, and **the rig is what rotates**: rope and
  man are one rigid thing pivoting about a point at the top of the screen. The
  rise at the ends of the arc falls out of the geometry (a rod lifts its bob by
  L(1−cos θ)), so the faked `bud-fall` is gone entirely.
- **2026-08-16** — Swim slowed to a 64s length, and its depth is now *exactly
  half* that rather than an odd number — which is what lets his heading follow
  the path. Out-and-down, out-and-up, back-and-up, back-and-down, turning
  through head-up at each wall. An unmatchable period was why he used to travel
  sideways while pointing somewhere else.

- **2026-08-16** — Webs tied to the swing: **one per sweep, handed over at the
  top of the arc**, on a 3.5s cycle because `bud-arc` alternates and two sweeps
  make a full period. They used to cross-fade on the arc's own period, so both
  were half-there at any moment and neither was the one he was on. Both strands
  leave the *same raised fist* now — the one he hangs from and the one he throws
  ahead; the second used to start at his lowered hand, which reads as being tied
  on by two ropes. *Correlating them exposed the fall being upside down*: it ran
  at a whole sweep's period, so he was lowest at the ends of the arc and highest
  in the middle. Half the sweep, `alternate` — two falls per sweep.

- **2026-08-16** — **`/account/forgot` locked people out, and did it silently.**
  It set the new password *first* and posted it second, so with no mail provider
  configured the old password stopped working and the new one existed only in a
  variable discarded a line later. It did exactly that to the first person who
  pressed the button. **Send first, change second** — nothing is written unless
  the provider accepts the message — and with no provider at all the route now
  refuses with a 501 instead of claiming it emailed you. Two checks pin the
  ordering; one fails with the words `LOCKED OUT`.
- **2026-08-16** — Swing given its verticality: `transform` carries him across
  and `translate` drops him 34vh into each arc and lifts him out, twice per
  crossing, at a 38° sweep. A pendulum that only changes angle reads as a man
  sliding sideways on a string. Swim slowed to a 46s length and rotated 90° so
  he leads with his head, using `rotate`/`transform`/`translate` — **four
  properties, four animations, none cancelling**. The nap's shadow was a
  `::after`, which paints *after* its element's children and so lay across his
  face; `z-index:-1` puts it under him.

- **2026-08-15** — **The buddy lives in `#bud-layer` now: `position:fixed`,
  `inset:0`, outside `.app`.** He was inside the timer column — a ~420px box in
  the middle of the page — so "across the screen" was across a strip and a wide
  monitor sat empty either side of him. Every percentage in his animations is a
  percentage of the window now, which is what was always meant.
- **2026-08-15** — Three animation bugs, all of a kind: the zs were rewritten as
  paths and `.bud-zzz text` was left behind, so *nothing* animated and three
  identical shapes stacked into one still z; the swim lost its facing flip
  because three `transform` animations on one element leave only the last, fixed
  by using `rotate`/`translate`/`scale` (individual properties compose); and the
  swing was bounded by the column rather than the screen.
- **2026-08-15** — **Nothing online without an account.** Focus together asks
  you to sign in and offers to take you there. Rooms, friends and the mailbox
  all hang off a code the account owns and everything they earn syncs to it, so
  the door is shut rather than the disappointment delivered later.
  *This broke six mailbox checks* — the smoke test had started booting a
  configured build with nobody signed in, which is a different app. It now
  blanks `ACC_URL` on read, so it always tests the offline app whatever
  `.env.release` says; `account-client-test` covers the configured half.
- **2026-08-15** — Menu reordered by how often a hand reaches for it. Shop is
  last and apart: it is the only accented row, and an accented row mid-list
  drags the eye past everything above it every time the menu opens.

- **2026-08-15** — `tools/buddy-look.mjs` added, and it immediately found three
  things reasoning had missed: the headphones were at *mouth* level (moved the
  wrong way twice), the moustache was a blob three times too wide sitting on
  the smile, and the beard was a bib whose top edge ran through the mouth. All
  redrawn against a render rather than against arithmetic.
- **2026-08-15** — **The zs were never missing.** They were `<text>` filled
  `#20242e` — the figure's near-black — floating on the app's dark background,
  so they drew perfectly and could not be seen. Now paths (a font is three
  things that can fail for a shape that is two lines and a diagonal) in
  `currentColor`, with `.bud-slot` setting `color:var(--text)`.
- **2026-08-15** — Swing is a real pendulum: the rotation origin is the top of a
  viewBox 60 units taller than the figure, so the rise at each end falls out of
  the geometry instead of being faked. Four swings per crossing, `alternate` for
  the return leg, webs alternating so each arc is thrown by the other hand.
  Hats now draw *over* face items; face and body extras are separate rows.
- **2026-08-15** — Friends' buddies do *their* antic in the room list (`anim`
  rides along with `buddy` in the roster). **`Buddy.on()` and `Buddy.shown()`
  are different questions** — the first needs an account because he lives on
  it, the second is just the switch. Conflating them blanked every buddy in the
  room for anyone signed out, which two slices caught.

- **2026-08-15** — Buddy: parts split into **Hat / Face / Worn** (`BUD_FACE` is
  new — beards, moustache, glasses, masks all fight for the same square inches,
  a tie does not), moustache lifted off the mouth it was covering, headphone
  cups dropped from eye level to where an ear is, 20% bigger everywhere.
  Swing crosses the whole lane in 3.4s instead of shuffling; swim does vertical
  lengths *and* horizontal ones — **`transform` and `translate` are separate CSS
  properties**, which is the only reason two animations can share one element
  without one blanking the other. The nap lies on the *end* of Pause (the middle
  covers the word) with a shadow, and **the zs are counter-rotated**: drawn
  inside a figure turned 74°, they had been drifting sideways into his own body,
  which is why nobody could see them.
- **2026-08-15** — **Editing a buddy is a draft now.** Every tap used to write
  through to `S.buddy` and broadcast, so trying six hats was six announcements
  and no way back. `Buddy.draft` holds it; Save commits, syncs and tells the
  room; leaving the page asks. `29-sync.js` sends `budSaved()`, never the draft.
- **2026-08-15** — Friend code is derived from the account (`syncCodeFor`), so
  it is the same six characters on every device you sign in on rather than one
  per machine. That makes `unavailable-id` on your own code mean *you are
  hosting elsewhere*, and it now says so instead of blaming a session that did
  not close properly.

- **2026-08-15** — Buddy animated properly: hands and feet carry their own
  keyframes, so he swims with an overarm crawl and a flutter kick, swings from
  webs that leave his *fists* (one hauling while the other reaches), and lies
  down to nap with three staggered zs. `Buddy._roam()` picks a fresh anchor,
  landing point and dip for every crossing — CSS cannot choose a number, so the
  randomness is JS and the motion is still all CSS. Three transforms on three
  elements on purpose: two on one element means one overwriting the other.
- **2026-08-15** — Pictionary shows the answer as blanks, filled in per guesser
  (`picMask`). **Built in the host's per-player view, never sent whole**: a
  shared board would let the fastest reader hand the word to the room by
  typing, and masking client-side would put the answer in devtools. A wrong
  guess now turns up whichever of its letters are in the answer, for that
  person only.
- **2026-08-15** — Magma stopped reading as fire on a wide window: the smoke
  shapes are sized in **px** and travel in **vw**, so at four tenths scale on a
  2560px screen it was eight specks crossing 265vw of dark. `--w:max(var(--s),
  26vw)` ties the shape to the screen once the screen is the bigger number;
  phones are untouched. Density is count over distance, so a wide-aspect query
  also shortens the run and spreads the rows.
- **2026-08-15** — Shop is its own page (`12c-shop-overlay.html`), opened by
  the menu row *and* by the ember count in the top bar. It was the bottom half
  of Your focus, and the menu row had to scroll that page to its own middle to
  land anywhere useful — a page needing a shortcut to halfway down itself is
  two pages. Registered in `BACK_LAYERS`.

- **2026-08-15** — Buddy antics are chosen, not assigned by phase: swing (from
  a line that leaves the top of its own viewBox), nap on the Pause button, swim
  a length of the lane. `S.budAnim` indexes `BUD_ANIMS` — **add to the end**,
  same as the parts. The main menu is not one of the three: he is always on the
  minutes box there, crouching and springing, because that is the screen you
  look at while deciding. **Nothing he does may be measured against the
  viewport** — the first swim ran to `100vw`, which is the window and not the
  app column, so he left the screen on a wide one. `.bud-lane` is
  `left:0;right:0`, and a `translateX` percentage resolves against the
  element's own width, which is how "the width of the column" is expressed
  without a viewport unit. A check in `account-client-test` refuses `vw` in any
  buddy rule.

- **2026-08-15** — **Signing out now empties the device**, behind a confirm.
  It used to leave everything, which meant signing into somebody else's
  account, syncing their embers and signing out kept the lot — every theme in
  the shop free to anyone who could borrow a login once. The account is the
  only home for progress once there is one. *`Embers.reconcile()` fought this*:
  its guard against a shrinking log invented an `adjust` to restore the old
  balance, which is right for accidental loss and exactly wrong for a
  deliberate wipe, so `earned`/`have`/`bank` are zeroed before reconciling.
  Caught by a test, not by reading.
- **2026-08-15** — Buddy: parts rebuilt (four dead accessories gone — one had
  `fill:none` and no stroke colour, so it drew *nothing*), crown re-drawn
  symmetrical about x=32, picker shows each part alone rather than a buddy
  wearing it. He now stands on the minutes box ready to jump, swims through
  focus, sleeps through rest, with a toggle — all transform-only, out of the
  flow, `pointer-events:none`. **No buddy without an account.** A smoke check
  now refuses any head or extra that puts no ink on the page.
- **2026-08-15** — `/account/password` (current password required — a token is
  "this browser signed in once", a password is "this is me now") and
  `/account/forgot`, which resets and mails a new one. **`sendMail()` is a stub
  until `RESEND_KEY` and `MAIL_FROM` are set**: Cloudflare's free MailChannels
  route closed in Aug 2024 and every provider needs a domain you control, which
  `workers.dev` cannot be. Forgot replies identically for unknown addresses, or
  it becomes a way to ask which emails are registered.

- **2026-08-15** — Buddy picker draws every face and clothing option instead of
  numbering it: each button is *your* buddy wearing that part, cropped to the
  bit that changes (`BUD_CROP`). "Hat 4" never told anybody it was a crown.
  Five new parts — crown, hair bow, tie, beard, spider mask — **appended, never
  inserted**, because the indices travel in `hello` and are drawn against the
  other person's tables; a smoke check now pins that ordering. Colours stay
  swatches. `Sync now` says what it does: histories are joined, nothing is
  replaced, and it runs on its own anyway.

- **2026-08-14** — **"Get it" always went to GitHub, and this is why.** The page
  could not tell whether the shell underneath had a working updater, so it kept
  drawing the manual link — and the manual link was the only visible route, so
  everyone used it. electron-updater *refuses to run in an unpacked copy*
  ("Skip checkForUpdates because application is not packed"), which is what
  `npm run electron` is, so in dev no event ever arrives and the fallback is
  permanent. The shell now says which it is up front: `auto` (packaged, downloads
  itself — the page drops the link and says so) or `manual` (unpacked, the link
  is the honest answer). `app.isPackaged` decides. Two checks in `handover`.

- **2026-08-14** — **Sign-up never worked, and the reason was a platform limit,
  not the config.** Workers *throw* above 100,000 PBKDF2 iterations, so the
  210k OWASP figure made every `/account/new` and `/account/in` fail as the
  catch-all 500. The handler now logs the exception (`wrangler tail` shows it)
  instead of swallowing it — that is how this was found at all. Iterations are
  **50,000 in one pass**, because the second limit is the one that decides it:
  **Workers Free allows 10ms of CPU per request** and a 100k pass is most of it,
  so three passes would be Error 1102 and nobody could sign in. Below the
  recommendation, deliberately: the throttle defends the live endpoint, the
  recommendation is about an offline grind. On Workers Paid set `PBKDF2_PASSES`
  to 3. Every hash carries a `KDF` marker so old and new can be told apart.
- **2026-08-14** — Your account and your buddy have their own page
  (`12b-account-overlay.html`, opened by the corner chip and a new menu row).
  They were in the middle of Your focus — two things you *change*, wedged into a
  page you *read*, with a password box halfway down a wall of statistics.
  Registered in `BACK_LAYERS`. `account-client-test` 11 → 14.

- **2026-08-14** — Accounts are **live**: `FOCUS_ACCOUNT_URL` in `.env.release`
  points at `https://focus-accounts.focus-accounts.workers.dev`, so every build
  from here has sign-in. Two smoke checks had asserted the *shipped* state —
  no button, date in the corner — and went red the moment that became untrue,
  which is the one day the suite needed to be trusted. They now read whether
  `ACC_URL` is stamped and check the **rule**: the button exists exactly when
  there is somewhere to sign in to, and the corner holds one of the two. Both
  branches verified. *A test may not assume the shape of a local config file.*

- **2026-08-14** — Sign-in moved to the top right corner (`acc-chip`, painted by
  `Account._chip()`): "Sign in" while signed out, your username once you are,
  tapping it opens Your focus at the sign-in panel the way Shop opens it at the
  shelf. **The date keeps that corner in a build with no account server** — the
  button belongs to the server and there is nothing behind it otherwise, which
  is the shipped state and what the smoke test checks. `scrollIntoView` does not
  exist in jsdom and an unguarded call throws inside a rAF callback where
  nothing catches it; both jumps now go through `scrollTo_()`.

- **2026-08-14** — Accounts turned on: `apac` chosen as D1's primary (one region,
  every read and write goes there, and it cannot be moved afterwards), and
  `/account/in` and `/account/new` rate-limited in a new `throttle` table before
  the endpoint went public. Ten failed sign-ins per address *and* per email in
  fifteen minutes, five new accounts per address an hour, all counted **before
  the lookup and before hashing** — 210,000 rounds protects a leaked database
  but makes a live endpoint cheaper to attack than to defend. Deploy steps are
  in ACCOUNTS.md § Turning it on; `npm run accounts:make/schema/deploy`.

- **2026-08-12** — Crossword progress is filed under `crossKey()`, a hash of the
  puzzle, instead of its position in `CROSS_GRIDS` (§7). The daily task adds
  puzzles inside their size group, so every index after an insertion pointed at
  a different puzzle and its saved letters were trimmed to fit and pasted in:
  grids opening pre-filled with the wrong answers, hints contradicting the clue,
  puzzles marked solved that had never been opened. Reported as a broken bank;
  the bank was correct — every grid and clue checked out by hand. `load()` now
  rejects a record of the wrong length outright rather than trimming it, and
  `_migrate()` cleans up saves written under the old scheme.
- **2026-08-08** — Phone builds keep a block running with the app in the
  background (§7, `45-notify.js`): the record and its embers are flushed on the
  way out and caught up on the way back, and an ongoing plus a scheduled
  notification say what is happening from outside the app. Needs
  `@capacitor/local-notifications`; without it the module is inert.
- **2026-08-08** — **Accounts finished**: sign up, sign in, sync, sign out, and
  a footer that stops claiming the data is local once it is not. Two-device test
  proves the case that matters — signing in on a second device joins the two
  histories instead of replacing one. Set `FOCUS_ACCOUNT_URL` in `.env.release`
  to switch it on; leave it blank and none of it exists.
- **2026-08-08** — Accounts Worker written (§8): sign up, sign in, vault get/put
  with a server-side merge, and a delete that deletes. 28 checks against an
  in-memory D1. Nothing in the app calls it yet. Pictionary gained a **Fill**
  mode — a lasso that fills what it encloses, carried as one flag on an ordinary
  stroke so undo and the wire format needed no changes.
- **2026-08-08** — **Groundwork for accounts** (§7, `47-merge.js`): every session
  row now carries an `at`, settings carry one too, the ember balance is
  derivable from the log rather than only accumulated, and there is a pure merge
  for two offline copies with 26 checks behind it (`npm test` runs them). No
  server and no login yet — this is the part that has to be right first, because
  a sync layer over data that cannot merge is a sync layer that loses sessions.
- **2026-08-08** — Buddies (§7, `46-buddy.js`): a small customisable person who
  travels in `hello` and stands beside your name in a room. Editor on the Your
  focus page. The room band on the timer screen is now a way in to the room
  rather than a label.
- **2026-08-08** — Cut **1.0.5** instead of replacing 1.0.4, so the old release
  stays where it is and nothing has to be deleted on GitHub.
- **2026-08-08** — **1.0.4 re-cut.** Same version number deliberately: the first
  1.0.4 is being replaced rather than followed, so `make-release.mjs` was given
  the version explicitly instead of `patch`. Delete the old release on GitHub
  before publishing or the assets collide.
- **2026-08-06** — Back now closes the topmost layer rather than leaving the app
  (§7, `44-back.js`). Clock faces added to the ember shelf, and the menu picker
  moved onto the ambience chip so the two shops look like one thing. The
  crossword picker scrolls as a panel — the list inside it was a second scroll
  box with `overscroll-behavior:contain`, which put most of thirty-six puzzles
  out of reach. The menu row says **Shop** and lands on the ember count.
- **2026-08-06** — **The shelves were drawing before ownership was loaded.**
  `ambLoad()` renders the ambience picker at the end of its own promise and
  races `Embers.load()` in the same `Promise.all`, so a cold start showed
  everything you had bought as unbought; init now redraws both once the loads
  settle. A "N embers to spend" row added to the menu — the counter was in the
  top bar and the shelf was two taps away and nothing said so. Hourglass: sand
  is one path per bulb with the surface curve built in (it was a rect plus an
  ellipse in `--bg`, which could never match what was behind it), and the grains
  fall the other way in local space for a break, because the face is rotated and
  they had been climbing. Subline says "1 of 4". Analog rim taken out to the
  edge of its box — at r=43 it drew three-quarters of the ring it was meant to
  match. Office keys square with soft corners. Palms down to four, 66–83%.
- **2026-08-06** — A comment lost its `<!--` in an edit and printed itself on
  every screen (see §6); fixed and guarded. Menu subtitles restored — they were
  taken out and were wanted. Flip stacks two over two so it fits inside the
  ring; the analog's phase and session lines pushed clear of the hands; the
  hourglass surfaces flattened from domes to a dish and a heap. Faces repriced:
  flip 20, analog 40, hourglass 60.
- **2026-08-06** — Faces are now bought (§7); analog sized to the ring exactly
  with the phase and session lines inside it; flip has a card per digit, each
  turning and sounding on its own; hourglass gained real grains, a dished upper
  surface and a heaped lower one, and lost the phase name. Pause and resume have
  a note each, following the Chime setting. **Palms rebuilt as one element per
  tree** — a single wide `slice`d SVG showed about a tenth of its own viewBox on
  a wide screen, which is why they were cropped to stumps; seven now, at seven
  heights, no cap. The face tests run in a window of their own, because buying
  one spends embers the light and sound checks are counting.
- **2026-08-06** — The analog and hourglass faces were being stretched over the
  whole dial and turned on their side by the ring's own rule (see §6); scoped to
  `.dial > svg`. Flip was getting `display:block` where it needed `flex`, so its
  cards stacked. Hourglass redrawn taller with a neck, grains falling down it,
  and turned over for a break — rotated *and* the bulbs swapped, since rotating
  alone would have the sand climbing. Flip now drops into place from edge-on
  instead of rocking. Palms up to five, bases spread 42–158.
- **2026-08-06** — **Clock faces added** (§7): analog, flip and hourglass beside
  the digital one, chosen from the menu and kept with the settings. Palms
  redrawn again — the droop term was throwing frond tips well below the crown
  and curling them, which is what looked wrong; rise and fall are near balanced
  now and the trunks barely bow. Four of them, much smaller, and scattered
  through a tall band rather than along its foot, which is why they kept
  reading as a row.
- **2026-08-06** — Palms redrawn as actual palms: a frond is a sampled spine
  that lifts from the crown and droops, with a blade widest in the middle, and
  the trunk is a filled leaning taper with rings. The old version radiated
  straight blades from a point, which is a sea anemone. Smaller again and moved
  up to `bottom:66%`.
- **2026-08-06** — Beach's water moved out of `.app::before/::after` into
  `.beach-sea`, a static masked frame with two sliding children (§7). The loop
  had been visibly resetting: the mask travelled with the transform, so the
  horizon drifted up and snapped back once a cycle. Palms shrunk again.
- **2026-08-06** — **Office's keyboard was never being drawn** — `keys` had a
  spec and no CSS rule (see §6); written, and the smoke test now compares every
  `fx:` a look names against the stylesheet. Beach: no blue at the top any more
  (the shared `.app` gradient was hanging `--bg2` over the menu bar), waves
  rebuilt as an irregular 560/420px tile instead of a repeating one so there is
  no period to lock onto, the water's top edge fades over half the screen rather
  than a quarter, and the palms are down to three, scattered, up near the top.
- **2026-08-06** — **Performance pass.** Magma was drawing 112 blur-carrying
  smoke specks on a full machine; kinds now have a `cap` and smoke's blur scales
  with the shape, so it draws 26 at a smaller radius. The live log was also
  serialising every session ever, twelve times a minute — that is now every
  thirty seconds, with embers still settled every five. Live checklist floored at
  about three rows and tightened under 760px tall. Magma's dial text and
  transport went yellow; Beach's palms moved up onto the sand. `solo2` reseeded
  from `seedLog` rather than replaying the first half, which had stopped fitting.
- **2026-08-06** — Beach's waves run up the sand now; blurred palms added in the
  sand band (static `filter:blur`, which rasterises once — the 20px ceiling the
  test enforces is on `backdrop-filter` only). Magma down to one dark in ten.
  Test harness: `solo` split into `solo1`/`solo2`, and the ghost-connection check
  moved to the very end of the sync pass — its second connection is wired only on
  the host's side, so anything sent to the guest afterwards went nowhere, which
  cost the chat checks about two runs in five. It also now asks the host's roster
  who the guest is instead of searching the fake network, where a peer keeps
  every connection it ever made and long-dead ones still match.
- **2026-08-06** — Beach gained a body of water under the crests: they are
  highlights, and on their own they were stripes of blue with sand showing
  through every trough. Magma's ring went yellow — an orange ring on an orange
  ground is the one thing you cannot pick out, because the dial is drawn onto
  the room rather than onto a card.
- **2026-08-06** — Beach's water flows one way on a linear loop, each layer
  travelling exactly one repeat of its own gradient so the cycle has no seam;
  it ran `alternate` with easing before, which stopped and reversed and read as
  disconnected. Change a crest spacing and the keyframe distance must change
  with it. The shelf says **in use** rather than "burning" — that metaphor died
  when a look could be a beach or a man in a mask. The two corner webs are now
  separate drawings from separate seeds, because a mirrored pair is exactly what
  an eye catches.
- **2026-08-06** — Beach's crests softened: they had hard stops (a colour held
  flat, then cut), which drew lines across the screen and made the sea into
  corrugated iron — each crest now fades all the way in and out, brighter.
  Spider-Man's corner webs shrunk to 132px and rebuilt with jittered spokes,
  wandering ring radii and two rings that stop a strand short; the even version
  was a doily. Its ring oscillates white to red over 11s. Magma's ground turned
  further orange again with only two darks left in ten.
- **2026-08-06** — Magma's ground turned orange (nothing in the palette is black
  now — the black belongs to the crust drawn over it) and the count went to 14×,
  fifty shapes. Beach's water became two layers of repeating crests at 9s and
  13.5s drifting through each other; one sliding gradient had no edge in it to
  watch and read as a still background.
- **2026-08-06** — Magma reworked into lava: `fxs` size lever added and the
  smoke kind given opt-in `pal`, so it is nine times as many shapes at four
  tenths the size in discrete oranges through black. Spider-Man's dial — ring,
  clock, phase and subline — and its corner webs went white, because red on red
  was the clock disappearing into the mask. Beach: sand-yellow glow, sea pulled
  back to a band at the top, tide fixed rather than absolute (it was tearing a
  strip off the bottom when `.app` scrolled) and lightened so the labels down
  there can be read.
- **2026-08-06** — Focus is now recorded as it happens (§7): the open record
  fixes stats not updating in someone else's room, and embers land on screen at
  the ten-minute mark instead of at the end of the block. Magma turned up again
  (`fxn` 5, new `fxo` opacity lever — 18 specks against Dusk's 4); Beach's text
  darkened for contrast and both it and Spider-Man dropped to 40; Spider-Man's
  mask moved to the centre of the dial with the web radiating out of it, eyes
  dark with a white rim, and the corner webs breathe on two durations that do
  not divide into each other.
- **2026-08-06** — The three new lights reworked: Magma's smoke tripled via the
  new `fxn` density multiplier and run ember-red rather than through orange;
  Beach given light-blue text and accents over a stronger sand and sea, with a
  sliding tide; Spider-Man's spider replaced by the mask symbol, corner webs
  added to the shell, and the blue moved to the costume's cobalt.
- **2026-08-06** — Three lights added: **Magma** (25, dusk's smoke run hot),
  **Beach** (45, the first light-mode look — see §7), **Spider-Man** (60, web
  behind the dial). Shelf count in the smoke test now read from the catalogue
  rather than written down. Ghost members fixed: a superseded socket closing no
  longer clears the live connection's roster entry, and hosting your own code
  retries while the broker lets go of a session that died — that pair was "a
  ghost is left and then you cannot host your own room". Drawer title dropped
  the serif italic for Space Grotesk 600.
- **2026-08-06** — jsdom moved to ^30: under 25 it mis-computed `display` for
  anything hidden by `#game-chess .hide{…!important}`, failing 13 checks the app
  was passing (see §6). `publish-check` no longer calls `process.exit()` under
  an open fetch socket, which was aborting libuv on Windows and killing the
  publish chain after every check had printed ok.
- **2026-08-06** — Smoke test now closes every jsdom window before exiting, on
  the next tick, so `npm test` stops aborting libuv on Windows at the very end
  (see §6). The chess crash was hiding it: the run never reached the exit.
- **2026-08-06** — Chess ran with no room, because the scrabble block above it
  leaves one deliberately: the panel opened on `ch-need`, the board never
  rendered and the run died on a null `firstElementChild`. The block now
  rebuilds the room first, placed above the `// chess ---` marker so
  `slice-test.mjs` does not hand it a second one. This is why no 1.0.3
  installer exists — `ship` is an `&&` chain and electron-builder never ran.
- **2026-08-06** — Smoke test was filing the new barred sevens as nines and
  reporting three phantom gap breaches (`ant`/`ago`/`inn`); it now buckets by
  row count in CROSS_GRIDS order, as `crossAtSize()` does. The bank was always
  fine. Back to 302/302; §7's puzzle count corrected to 36.
  *Two sessions were editing this repo at once* — the daily crossword task was
  mid-run — which is how the version moved from 1.0.1 to 1.0.2 under a session
  that had not bumped it. Check §5 before assuming a number is yours.
- **2026-08-06** — 2048 tiles slide (slot layer + tile layer, tiles keep their
  identity); tasks can be renamed or removed anywhere (hold menu + `askPrompt`);
  shelf and ember count refresh on load; crossword revealed-dot glow removed;
  dev **Fill board** added; two broken 7x7 grids given the bar maps they were
  missing (this line first said "removed" — they are still in the bank, see §7);
  this file rewritten short.
- **2026-08-06** — Publishing needs no git: `latest.json` goes up as a release
  asset. `publish:check` added. `setup:updates` refuses placeholder arguments.
- **2026-08-05** — Performance pass: the full-screen `backdrop-filter` haze
  removed, overlay/drawer blurs cut to 16/14px, shell fades instead of blurring,
  dial glow loses its filter, particles scale to the machine, everything stops
  while the window is hidden, `glowFit` rAF-throttled and out of the tick.
- **2026-08-05** — Electron auto-updater wired; in-app update notice; version
  stamped into the build; `ANDROID.md` written.
- **2026-08-05** — Achievements carry their game's icon; stats bars are tappable
  and report the day; best hour → average day; `#setup` stopped being a scroll
  box; arcade button moved above the transport; calendar compresses while
  reading; crossword bars run the full edge.
- **2026-08-04** — Whole crossword bank regenerated with the no-repeat rule and
  a wider word list; all clues hand-written.
- **2026-08-03** — Calendar plans ahead: tasks and events on future days, times,
  full repeat rules, per-day ticking; menus blurred behind overlays.
- **2026-08-02** — Ember spam closed (banked seconds); achievements require
  completed blocks; nine game achievements added; Infinity pauses every eight.

## 10. Working with Hashir

- Terse, direct feedback, often several unrelated items in one message. Take
  each literally and do all of them.
- **Do not update `README.md`** unless asked. This file is the exception — it is
  expected to be current.
- Reasoning goes in comments beside the code, in prose, explaining *why* and what
  was tried before. That is the house style and it is load-bearing: nearly every
  gotcha in §6 is written down beside the line it bit.
