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
and stats, and generates a dozen crosswords to check the generator. 86 checks. Run it after any change you're unsure about.

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
| `26-crossword-data.js` | Crossword word/clue banks + difficulty settings |
| **`27-crossword.js`** | **Crossword — layout generator, grid, clues, keyboard** |
| `90-init.js` | Kicks everything off |
| `99-outro.js` | Closes the IIFE |

### `src/css/` — one file per visual area
`00-tokens-base` · `01-topbar` · `02-views` · `03-setup` · `04-timer` · `05-arcade` ·
`06-picker` · **`07-sudoku`** · **`08-wordle`** · `09-banner-toast` · `10-misc` ·
`11-quotes` · `12-calendar` · `13-drawer` · **`14-2048`** · `15-memory` ·
`16-stats` · `17-celebrate` · `18-menu-colors` · `19-tasks` · `20-layout` ·
**`21-crossword`**

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

Three difficulties, set in `CROSS_SETTINGS` in `src/js/26-crossword-data.js`. Every
grid is **9x9** and the fill is centred in it:

| | typical entries | crossing squares | word lengths |
| --- | --- | --- | --- |
| easy | 13–15 | ~32% | 3–5 |
| medium | 11–12 | ~28% | 3–7 |
| hard | 11–13 | ~26% | 3–9 |

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
