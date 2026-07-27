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

`npm test` loads `dist/index.html` in a real DOM and drives it the way you would —
starts a session, builds a Sudoku, plays a Wordle guess, opens the quote bank and the
calendar, runs an export. 28 checks. Run it after any change you're unsure about.

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
| `09-arcade-core.js` | Toast, and the `Arcade` show/pick/back controller |
| **`10-sudoku.js`** | **Sudoku — generator, solver, grid, numpad, notes** |
| `11-wordle-data.js` | The two word lists (~100 KB; answers + 14.9k valid guesses) |
| **`12-wordle.js`** | **Word guess — board, scoring, keyboard** |
| `13-arcade-wiring.js` | Hooks the arcade buttons to the two games |
| `14-util.js` | `esc`, `fmtDur`, `dayKey` |
| `15-quotes-data.js` | The default quote bank |
| `16-quotes-ui.js` | Quote bank add/list/delete screen |
| `17-session-log.js` | Session history records (`focus_log`) |
| `18-calendar.js` | The month grid and day detail |
| `19-wiring.js` | Drawer, overlays, note box |
| `20-data-io.js` | Export / import backup (see below) |
| `21-init.js` | Kicks everything off |
| `99-outro.js` | Closes the IIFE |

### `src/css/` — one file per visual area
`00-tokens-base` · `01-topbar` · `02-views` · `03-setup` · `04-timer` · `05-arcade` ·
`06-picker` · **`07-sudoku`** · **`08-wordle`** · `09-banner-toast` · `10-misc` ·
`11-quotes` · `12-calendar` · `13-drawer`

### `src/body/` — one file per screen
`01-shell-drawer` · `02-topbar` · `03-setup` · `04-timer` · `05-shell-close` ·
`06-arcade-picker` · **`07-arcade-sudoku`** · **`08-arcade-wordle`** ·
`09-arcade-close` · `10-quotes-overlay` · `11-calendar-overlay`

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

1. `src/body/12-chess.html` — the markup, following the `#game-sudoku` pattern
2. `src/css/14-chess.css` — its styles
3. `src/js/22-chess.js` — its logic, exposing a `Chess.enter()`
4. Add a `.pcard` to `src/body/06-arcade-picker.html` and a branch in `Arcade.pick`

Then `npm run build`. Nothing else to register.

---

## Your data

Data lives in `localStorage` under three keys: `focus_sim` (settings), `focus_log`
(session history + notes), `focus_quotes` (your saved quotes).

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
