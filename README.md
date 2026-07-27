# Focus Simulator

A focus timer with a rest arcade, fading quotes, and a progress calendar.

The app used to be one 1,433-line `focus-simulator_2.html`. It is now split into small
files under `src/`, and a build step stitches them back into a single self-contained
`dist/index.html` — which is what the browser, the phone apps and the desktop apps all load.

**No code was rewritten during the split.** The first commit in this repo produced a
`dist/index.html` that was byte-for-byte identical to the original file.

---

## Daily workflow

```bash
npm install          # once
npm run dev          # rebuild on save + http://localhost:4321
```

Edit anything in `src/`, save, refresh the page. That's the whole loop.

| Command | What it does |
| --- | --- |
| `npm run build` | Build `dist/index.html` once |
| `npm run watch` | Rebuild on every save (no server) |
| `npm run dev` | Watch **and** serve on `localhost:4321` |
| `npm run verify` | Diff the build against `tools/original.reference.html` |
| `npm test` | Build, then run the app headlessly and exercise every screen |
| `npm run ship` | Build + test + produce the installer in `release/` |

`npm test` loads `dist/index.html` in a real DOM and drives it the way you would —
adds tasks and ticks them off, starts a session, checks the ticked items land in the
note, plays a Wordle guess, slides the 2048 board, **solves an entire Sudoku by clicking
cells and numpad keys** to trigger the celebration, then opens the quote bank, calendar
and stats, generates crosswords at every size, and plays every ambience through a
recording stand-in for media playback, and checks the calendar compacts and zooms as notes pile up. 119 checks. Run it after any change you're unsure about.

`npm run verify` only passes on the very first commit, before any features were added.
It exists to prove the split was lossless. From here on, `git diff` is the safety net.

---

## Where everything lives

Files are concatenated in **filename order**, which is why everything has a number prefix.

### `src/js/` — behaviour

| File | Holds |
| --- | --- |
| `00-prelude.js` | Opens the IIFE, `$` helper, the shared state object `S` |
| `01-storage.js` | `KV` — the localStorage wrapper every feature persists through |
| `02-persistence.js` | Load/save of timer settings (`focus_sim`) |
| `03-audio.js` | The generated Web Audio chime, vibration |
| `04-wakelock.js` | Keeps the screen awake while running |
| `05-timer-engine.js` | start / pause / tick / complete / skip / stop |
| `06-render.js` | Paints the dial, clock and cycle dots |
| `07-presets.js` | The minute-preset chips |
| `08-events.js` | Setup-screen button wiring |
| `09-arcade-core.js` | Toast, the `GAMES` registry, and the `Arcade` controller |
| `09a-celebrate.js` | `celebrate()` confetti + `showBanner()`, shared by every game |
| **`10-sudoku.js`** | **Sudoku — generator, solver, grid, numpad, notes** |
| `11-wordle-data.js` | The two word lists (~100 KB; answers + 14.9k valid guesses) |
| **`12-wordle.js`** | **Word guess — board, scoring, keyboard** |
| `13-arcade-wiring.js` | Hooks the New/Again buttons to each game |
| `14-util.js` | `esc`, `fmtDur`, `dayKey` |
| `15-quotes-data.js` | The default quote bank |
| `16-quotes-ui.js` | Quote bank add/list/delete screen |
| `17-session-log.js` | Session history records (`focus_log`) |
| `18-calendar.js` | The month grid and day detail |
| `19-wiring.js` | Drawer, overlays, note box |
| `20-data-io.js` | Export / import backup (see below) |
| **`22-2048.js`** | **2048 — sliding, merging, swipe and arrow keys** |
| `23-memory.js` | Memory match — **currently disabled**, see `MEMORY_ENABLED` |
| `24-stats.js` | The "Your focus" dashboard, computed from `focus_log` |
| `25-tasks.js` | Session task list, and folding ticked items into the note |
| `26-crossword-data.js` | Crossword word/clue banks, shared short fill, size settings |
| **`27-crossword.js`** | **Crossword — layout generator, grid, clues, keyboard** |
| **`28-ambience.js`** | **Ambience — Web Audio synthesis, picker, per-sound themes** |
| `90-init.js` | Kicks everything off |
| `99-outro.js` | Closes the IIFE |

### `src/css/` — one file per visual area
`00-tokens-base` · `01-topbar` · `02-views` · `03-setup` · `04-timer` · `05-arcade` ·
`06-picker` · **`07-sudoku`** · **`08-wordle`** · `09-banner-toast` · `10-misc` ·
`11-quotes` · `12-calendar` · `13-drawer` · **`14-2048`** · `15-memory` ·
`16-stats` · `17-celebrate` · `18-menu-colors` · `19-tasks` · `20-layout` ·
**`21-crossword`** · **`22-ambience`**

`20-layout.css` loads last on purpose: it tunes the sizes set in every earlier file
so the app fits a desktop window (which is usually wide but short) as well as a phone.

### `src/body/` — one file per screen
`01-shell-drawer` · `02-topbar` · `03-setup` · `04-timer` · `05-shell-close` ·
`06-arcade-picker` · **`07-arcade-sudoku`** · **`08-arcade-wordle`** ·
**`08a-arcade-2048`** · `08b-arcade-memory` · **`08c-arcade-crossword`** · `09-arcade-close` ·
`10-quotes-overlay` · `11-calendar-overlay` · `12-stats-overlay`

Note the `08a` / `08b` names: every game's markup must sort **before**
`09-arcade-close.html`, because that file closes the overlay's containing divs.

### `src/head.html`
Meta tags, icons, and the inline PWA manifest.

---

## One important rule

Every `src/js/*.js` file is a **fragment of one shared closure**, not a module. They all
see the same `S`, `KV`, `$`, `toast` and so on. So:

- Don't add `"use strict"` or wrap a file in its own function — `00-prelude.js` already did.
- If file B uses something from file A, A's number must be **lower** than B's.
- `99-outro.js` must always sort last.

## Adding a new arcade game

Games register themselves, so `09-arcade-core.js` never needs editing.

1. `src/body/08c-arcade-chess.html` — markup, following the `#game-sudoku` pattern.
   Must sort before `09-arcade-close.html`.
2. `src/css/20-chess.css` — its styles.
3. `src/js/26-chess.js` — its logic. Expose an object with `enter()` and `leave()`,
   then register it at the bottom of the file:

```js
registerGame('chess', {
  el:'game-chess',          // id of the container div
  title:'Chess',            // shown in the overlay header
  progEl:'prog-chess',      // the .prog span on its picker card
  game:()=>Chess,           // lazy, because Chess is defined after this runs
  async progress(){ return 'New<span>tap to start</span>'; }
});
```

4. Add a `.pcard` with `data-game="chess"` to `src/body/06-arcade-picker.html`.

Then `npm run build`. Call `showBanner('chess-banner', 'You win.', '…')` when the
player wins and you get the confetti for free.

### Turning a game off

Memory is currently disconnected as an example of how to do this without deleting
anything: `MEMORY_ENABLED` at the bottom of `src/js/23-memory.js` is `false`, and its
`.pcard` in `src/body/06-arcade-picker.html` is commented out. Set the flag to `true`
and un-comment the card to bring it back — the game code itself was never touched.

## Crossword

Puzzles are **generated fresh each game**, not drawn by hand. Words are laid down one
at a time, each crossing a word already on the grid, so every intersection is guaranteed
to agree and every answer is a real word with a matching clue. Candidate positions are
scored for compactness — picking at random gave sprawling 25-square grids.

**Size and difficulty are separate choices.** Size sets the geometry, difficulty picks
which word bank the clues come from. Both are in `src/js/26-crossword-data.js`, and the
fill is always centred in the grid.

| size | grid | typical entries | squares filled | crossing squares |
| --- | --- | --- | --- | --- |
| small | 5×5 | 6–7 | ~62% | ~35% |
| medium | 7×7 | 9–11 | ~56% | ~35% |
| large | 9×9 | 14–18 | ~52% | ~36% |

Density comes from `CROSS_SHORT` — a large shared pool of 3 and 4 letter answers folded
into every bank. Long answers can't interlock without them, and a sparse grid can't be
solved from its crossings.

Clues come in three styles, mixed like a newspaper puzzle: plain, **anagram**
(`['REGENT','N greet (anag.)']`) and **abbreviation** (`['ETC','Et cetera (abbr.)']`).
Letter counts are shown after every clue and derived from the entry, so they can't
drift out of step with the answer.

To add clues, drop `['WORD','Its clue']` into the relevant bank — it joins the rotation
immediately. Type with a real keyboard or the on-screen one; Tab moves between clues,
arrow keys move within one, and tapping a square you're already on flips across/down.

`npm test` generates 12 puzzles across the three difficulties and asserts each one is
self-consistent: every entry’s recorded answer matches the letters actually in those
squares, every entry has a clue, every entry is contiguous, and no filled square is
orphaned outside an entry.

## Session tasks

Add tasks on the setup screen before you start. While you're focusing they appear as a
checklist under the dial; tick them as you go. When the focus block ends, everything you
ticked **during that block** is written into that session's note automatically, so it
shows up in the calendar. Anything you tick outside a focus block is just a checkbox.

Tasks persist under `focus_tasks` and survive across sessions — use **Clear done** on the
setup screen to tidy up.

## Menu colours

Each full-screen menu sets its own `--accent`, `--glow` and background on itself, so
everything inside — buttons, tiles, chart bars, even the confetti — follows along:
arcade is amber, quote bank violet, calendar blue, stats green. The timer screen keeps
its original behaviour of shifting between focus and rest palettes. All of it lives in
`src/css/18-menu-colors.css`; change a hex there and the whole menu re-themes.

---

## Your data

Data lives in `localStorage` under four keys: `focus_sim` (settings), `focus_log`
(session history + notes), `focus_quotes` (your saved quotes), `focus_tasks` (your task
list). Each arcade game also
saves its own board under `arcade_sudoku`, `arcade_wordle`, `arcade_2048` and
`arcade_memory` — those are unfinished puzzles, not history, so the backup skips them.

**Each packaged build has its own private storage.** The Android app cannot read what
your browser tab saved, and neither can Electron. So before you switch:

1. Open the old version → **Menu → Export backup** → saves a `.json`
2. Open the new app → **Menu → Import backup** → pick that file → it reloads restored

Do this any time you move between browser, phone and desktop.

---

## Shipping

### Android / iOS — Capacitor

```bash
npm install
npm run cap:add:android      # or cap:add:ios
npm run android              # builds, syncs, opens Android Studio
npm run ios                  # builds, syncs, opens Xcode
```

Requires Android Studio (Android) or Xcode on a Mac (iOS). After any `src/` change,
`npm run cap:sync` pushes the new `dist/` into the native projects.

### Desktop — Electron

```bash
npm install
npm run electron             # run it
npm run electron:pack        # installers into release/
```

Produces `.exe` (NSIS) on Windows, `.dmg` on Mac, `.AppImage` on Linux. Simplest to set
up, but the binary is ~150 MB.

### Desktop — Tauri

`src-tauri/tauri.conf.json` is written and points at `../dist`. The Rust side is
generated, not hand-written — run this once:

```bash
npm install -D @tauri-apps/cli
npx tauri init          # accept the existing tauri.conf.json when prompted
npm run tauri           # dev
npm run tauri:build     # installers, ~5 MB
```

Requires the Rust toolchain (`rustup`). Tauri v2 can also target mobile via
`npx tauri android init` if you'd rather not use Capacitor.

### Installable PWA

`dist/index.html` already carries a full manifest, icons and offline-friendly markup.
Serve it over HTTPS from any static host and it installs from the browser directly.

---

## Notes

- The only network request the app makes is the Google Fonts `@import` in
  `src/css/00-tokens-base.css`. Offline, it silently falls back to a system font.
  Bundle the font as base64 there if you want the packaged apps to be truly offline.
- `tools/split.mjs` is the one-shot script that performed the original split. You never
  need to run it again; it's kept so the provenance of every line is checkable.

## Ambience

Five one-hour recordings — **rain, forest, café, office, campfire** — chosen from the
side menu, with a volume slider. They start with the timer, pause when you pause, and
stop when you end a session. Selecting one also repaints the app in colours that suit it;
choose **Off** and the original focus/rest palettes return.

Each track plays to its end, **fades out over three seconds, restarts, and fades back
in**. The fade is driven by an 80 ms ticker rather than the `timeupdate` event, which
only fires about four times a second — too coarse to sound smooth.

### The audio folder

This is the one part of the app that isn't inside `index.html`. An hour of audio can't be
inlined, so it ships as `dist/audio/` next to it:

| | |
| --- | --- |
| length | 45 min each |
| speed | slowed to **0.75x**, pitch unchanged |
| tone | 7 dB off the low shelf, sub-bass below 55 Hz removed |
| format | mono MP3, 32 kbps, 32 kHz |
| size | 10.3 MB each, **52 MB total** |
| level | normalised to about -27 LUFS, all five within 3 dB of each other |

`preload="none"`, and only the chosen track is ever fetched — the app does not pull
69 MB at startup.

The slow-down is a time-stretch (`atempo`), not a pitch shift — rain doesn't drop
into a growl and birdsong stays birdsong. 33 min 45 s of source yields 45 minutes.

Put the full-length recordings in `audio-src/<name>.mp3` and run:

```bash
bash tools/encode-audio.sh          # all five
bash tools/encode-audio.sh rain     # just one
```

The per-track gains in that script were measured with `ebur128`. Sources are gitignored,
since they run to hundreds of megabytes.

**This replaced a synthesised version.** Web Audio can make a passable rain or fire, but
next to a real recording it sounds harsh and no amount of filtering fixes it. The synth
is in the git history if it's ever wanted.

Packaging: Electron unpacks `dist/audio` from the asar so the files stay seekable;
Capacitor and Tauri copy `dist/` wholesale. Expect the Electron installer to grow by
about 52 MB.


## Calendar

Days with notes carry a dot — larger if there are several — so you can find writing
without opening every day. Selecting a day with three or more sessions compacts the
record cards; six or more also drops the month summary to buy vertical space.

**Scrolling down zooms the month grid out**, smoothly, so the notes rise to meet you;
scrolling back up restores it. The whole month block scales as one unit, so level bars
and note dots stay in proportion with the cells instead of drifting.

The height the grid gives up is added as padding beneath the notes, keeping the total
scrollable height constant. That detail matters: without it the page gets shorter as you
scroll, the browser clamps `scrollTop`, that changes the zoom, and the two fight each
other in a visible judder. `npm test` asserts grid height plus padding always equals the
grid's natural height.
