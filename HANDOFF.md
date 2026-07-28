# Handoff — Focus Simulator

Everything a fresh session needs to keep working on this without re-deriving it.
Read this first, then `README.md` for the day-to-day mechanics.

**Project root:** `D:\Focus` · **Owner:** Hashir · **Last updated:** commit `f22f070`

---

## 1. What this is

A Pomodoro focus timer with a rest arcade, quote bank, session calendar, stats,
session tasks, ambient audio, and peer-to-peer shared timers. It started life as a
single 1,433-line `focus-simulator_2.html` that Hashir wrote, and was split into
modules without rewriting a line of it.

It ships as a browser page, an installable PWA, an Electron desktop app, and can be
wrapped for Android/iOS with Capacitor or Tauri.

---

## 2. The one architectural idea

**`src/` holds fragments of one shared closure. A build step concatenates them in
filename order into a single self-contained `dist/index.html`.**

There is no bundler, no module system, no framework. Every `src/js/*.js` file is a
slice of the same IIFE, so they all see the same `S`, `KV`, `$`, `toast`, and so on.

This shape was chosen deliberately over converting to ES modules, because it let the
original code be split **byte-for-byte** — the first commit produced a `dist/index.html`
identical to Hashir's original file. That fact is worth preserving; it's why nothing
had to be debugged during the split.

### Rules that follow from it

- **Never** add `"use strict"` or wrap a file in its own function. `00-prelude.js`
  opened the IIFE; `99-outro.js` closes it and must always sort last.
- If file B uses something from file A, **A's number must be lower**.
- Exception worth knowing: **function declarations hoist across the whole script**, so
  a low-numbered file *can* call a function declared in a high-numbered one. This is
  used on purpose — `05-timer-engine.js` calls `syncBroadcastState()` (file 29),
  `tasksFlushToNote()` (25) and `ambStart()` (28). `const`/`let` do **not** hoist, so
  anything called from an earlier file must be a `function` declaration, not a `const`
  arrow. This bit me once; it's why `25-tasks.js` uses `var` and function declarations
  throughout.
- Adding a file requires no registration anywhere. `tools/build.mjs` globs and sorts.

### Layout

```
src/head.html        <head> — meta, icons, inline PWA manifest
src/css/*.css        24 files, one per visual area, concatenated into <style>
src/body/*.html      16 files, one per screen, concatenated into <body>
src/js/*.js          32 files, concatenated into <script>
dist/index.html      the build output (gitignored)
dist/audio/*.mp3     52 MB of ambience (gitignored) — the ONLY non-inlined asset
tools/               build, test, audio encoding
```

Two ordering traps:

- Every arcade game's markup must sort **before** `09-arcade-close.html`, which closes
  the overlay's divs. Hence `08a-`, `08b-`, `08c-` names.
- `20-layout.css` loads near-last on purpose: it retunes sizes set by every earlier
  file so the app fits a desktop window (usually wide but short) as well as a phone.

---

## 3. Commands

| Command | Does |
| --- | --- |
| `npm run dev` | Watch `src/`, rebuild, serve on `localhost:4321` |
| `npm run build` | Build `dist/index.html` once |
| `npm test` | Build + run 162 headless checks |
| `npm run ship` | Build + test + Electron installer into `release/` |
| `bash tools/encode-audio.sh [name]` | Regenerate ambience tracks from `audio-src/` |
| `node tools/audio-levels.mjs` | Render each track offline, print peak/RMS |

Every build stamps `build <date> <time> · <commit>` into the drawer footer. If Hashir
reports "it didn't update", **check that stamp first** — twice it turned out he was
opening a stale file or an old installer, not a build problem.

---

## 4. Feature map

| Area | Files | Notes |
| --- | --- | --- |
| Timer engine | `05` | start/pause/tick/complete/skip/stop. Ending early still logs the session (30 s floor). |
| Rest arcade | `09`, `09a`, `13` | `registerGame()` registry — adding a game needs no edits to shared code. |
| Sudoku | `10`, css `07` | Has a Check button that flags wrong cells. |
| Wordle | `11` (data), `12` | ~100 KB of word lists — the bulk of the HTML. |
| 2048 | `22`, css `14` | Swipe + arrow keys. |
| Memory | `23`, css `15` | **Disabled** via `MEMORY_ENABLED = false`; its `.pcard` is commented out. Kept as the worked example of switching a game off. |
| Crossword | `26` (banks), `27`, css `21` | Generated fresh each game. See §5. |
| Quotes | `15`, `16` | |
| Calendar | `18`, css `12` | Note dots, density steps, auto-growing note boxes. |
| Stats | `24`, css `16` | Totals, streak, best day/hour, 14-day chart. |
| Session tasks | `25`, css `19` | Ticked-during-focus tasks fold into that session's note. |
| Ambience | `28`, css `22` | Real recordings. See §6. |
| Focus together | `29`, css `23` | P2P shared timer. See §7. |
| Backup | `20` | Export/import all six `focus_*` keys. |

### Storage keys

`focus_sim` (settings) · `focus_log` (sessions + notes) · `focus_quotes` ·
`focus_tasks` · `focus_amb` · `focus_sync` (your code, name, friends) ·
`arcade_sudoku` / `arcade_wordle` / `arcade_2048` / `arcade_memory` / `arcade_cross`

The `arcade_*` keys are unfinished puzzles, not history, so the backup deliberately
skips them. **If you add a new `focus_*` key, add it to `DATA_KEYS` in `20-data-io.js`.**

---

## 5. Crossword — the non-obvious parts

Puzzles are **generated at runtime**, not hand-drawn. Words are placed one at a time,
each crossing a word already on the grid, so intersections cannot disagree.

Three fixes were needed to make it good, all of which will look arbitrary without
this context:

1. **Compactness must be scored for, not hoped for.** Picking a random valid position
   gave sprawling 19–28 square grids. Candidates are now scored, crossings weighted
   heavily.
2. **Feeding words longest-first meant only long words ever got used.** The longest is
   the spine; the rest stay shuffled.
3. **Density comes from short words.** `CROSS_SHORT` — ~110 three- and four-letter
   answers shared across all difficulties — is what lets long answers interlock. Without
   it grids are sparse and unsolvable from crossings.

Size and difficulty are **separate axes**: size sets geometry (5×5 / 7×7 / 9×9),
difficulty picks the word bank. Fill is centred in the grid.

Clue styles: plain, `(anag.)`, `(abbr.)`. **The test verifies every anagram's fodder is
a genuine rearrangement of its answer**, so a typo fails the build rather than shipping.

Generation is bounded by `good` (early exit) and a 420 ms deadline — without those,
hard puzzles blocked the UI for ~2.3 s.

**Typing direction is shown, never inferred.** An Across/Down button in the header,
switchable by click or space bar. Hashir reported "typing down goes right"; I could not
reproduce a logic bug, but instrumenting every dual-direction square showed a single
click gave across 3 times and down 2 — it inherited whatever direction was used last.
Making it explicit was the fix.

---

## 6. Ambience — the non-obvious parts

Five real recordings in `dist/audio/`, 45 min each, mono 32 kbps, 10.3 MB each,
**52 MB total**. This is the only part of the app not inside `index.html`.

Source recordings live in `audio-src/` (gitignored, ~790 MB) as symlinks to the
originals in the project root. `tools/encode-audio.sh` regenerates the cut-downs.

Things that were learned the hard way:

- **A synthesised version was built first and thrown away.** Web Audio can make a
  passable rain or fire, but next to a recording it sounds harsh. It's in git history
  (`d7c4520`) if ever wanted.
- **Tracks are slowed to 0.75×** for calmness, pitch preserved. 2025 s of source →
  2700 s out.
- **Café uses `librubberband`; the other four use `atempo`.** `atempo` is overlap-add:
  fine on steady noise, but it mangles voices at 0.75× — the café chatter warbled badly.
  A phase vocoder holds speech together at ~5× the encoding cost, so only the one track
  that needs it pays for it.
- **Bass is cut** (−7 dB shelf, −9 for café) and sub-bass removed. That rumble is
  inaudible on phones and just costs bitrate.
- **Levels are matched at playback, not in the files** — `AMB_GAIN` in `28-ambience.js`
  trims each track to the quietest. Re-encoding an already-32 kbps file to fix gain is
  exactly how artifacts come back.
- Looping is manual: play → fade out 3 s → restart → fade in, driven by an 80 ms ticker.
  `timeupdate` fires ~4×/s and is too coarse to sound smooth.
- `preload="none"` and only the chosen track is fetched. Never load all 52 MB.

If Hashir says a track still sounds off, the cheapest lever is `tempo=` in
`tools/encode-audio.sh` — 0.85 is much gentler than 0.75.

---

## 7. Focus together — the design

Peer-to-peer over WebRTC via PeerJS's **public signalling server**. No backend of ours,
no accounts, nothing stored off-device. PeerJS loads from a CDN **only when the screen
opens**, so offline launches don't pay for it.

**Two roles, deliberately separate:**

- **Host** — the network hub. Owns the peer id the room code resolves to, so it cannot
  change for the life of the room. Everyone connects to it; it relays.
- **Leader** — whose timer everyone follows. Starts as the host, can be handed to anyone.

Separating them is what makes handover possible **without every device reconnecting**.
A non-host leader sends state to the host, and the host relays it onward.

Only the leader broadcasts — that's what stops two clocks fighting. Followers' controls
are disabled. The host is the referee: it ignores `state` from anyone who isn't the
current leader, and only honours `setleader`/`kick` from the current leader.

If the timer holder disconnects, **the host reclaims it** rather than leaving the room
without a clock.

Wire protocol (all `{t: ...}` objects): `hello`, `roster`, `state`, `setleader`, `kick`,
`kicked`, `bye`.

Codes are 6 chars from an alphabet with no confusable pairs; input is normalised, so a
mistyped `O` still finds the room.

**Known limits** (all told to Hashir):

- Both devices must be online simultaneously — no store-and-forward.
- **No TURN relay**, so strict corporate/school firewalls will block it outright.
  Fixing this properly needs a paid relay service.
- Host leaving ends the room. Leadership can move; hosting cannot.
- **Never tested over a real network.** The protocol is thoroughly tested against a fake
  peer implementation, but WebRTC needs two real devices. Hashir has confirmed it works
  in practice as of `812f9e1`.

---

## 8. Testing

`tools/smoke-test.mjs` — 866 lines, **162 checks**, jsdom, no framework. Run `npm test`.

It drives the real UI rather than calling internals. Notable things it does:

- **Solves an entire Sudoku** by clicking cells and numpad keys, using the solution
  from the game's own saved state — so the real input path is exercised end to end.
- **Generates 12 crosswords** across sizes/difficulties and asserts each is
  self-consistent: recorded answers match the grid, every entry has a clue and is
  contiguous, no orphaned squares, anagram fodder is genuine.
- **Boots two or three windows against a fake PeerJS** that lets them find each other
  in memory, and runs the whole sync protocol: join, roster, leader drives, clocks agree
  within a second, follower can't drive the leader, handover, kick, host reclaim.
- Jumps `Date.now()` forward to test that ending a session early gets logged.

### Stubs it installs

jsdom has no Web Audio, no media playback, and no WebRTC, so `boot()` installs
recording stand-ins for all three. **If a feature uses a new browser API, the mock
needs extending** — a missing `createDynamicsCompressor` once caused a real failure that
the tests correctly caught.

### Sandbox gotchas (for the agent, not the user)

- **Importing jsdom across the mounted Windows folder takes minutes.** Copy
  `dist/index.html` and `tools/smoke-test.mjs` to `/tmp/run/` and run there. This is a
  sandbox artifact only; `npm test` on Hashir's machine is fast.
- **Bash calls are capped at 45 s and background processes are killed when the call
  ends.** Long ffmpeg encodes must be chunked across calls (see the pattern in git
  history around `d6c1113`).
- Only 2 cores.
- File deletion needs `mcp__cowork__allow_cowork_file_delete` first.

---

## 9. Working with Hashir

- He is **new to this** — he said so explicitly. Explain in plain terms, give exact
  commands, and don't assume tooling knowledge. He installed Node and ran his first
  build during this project.
- He is on **Windows**, so **iOS builds are impossible on his machine** (needs a Mac).
- He gives **short, direct feedback** on what feels wrong, usually about feel rather
  than mechanism: "too harsh", "feels too fast", "broken". Diagnose the mechanism
  yourself rather than asking him to.
- He **corrects course readily** — he asked for the calendar zoom, then had it removed
  when it didn't work. Offering to revert is welcome, not a failure.
- **He can see; the agent cannot.** Every visual and audio change is unverifiable from
  here. Say so explicitly rather than implying it's confirmed. This has come up on
  menu colours, layout, and all five audio tracks.
- No Chrome extension is connected, so screenshots aren't available. If visual
  verification starts mattering a lot, suggest installing Claude in Chrome.

### Mistakes made here, so they aren't repeated

- Declared the Electron installer broken while electron-builder was **still running**.
  Check for in-progress work before calling something failed.
- Shipped a scroll-driven calendar zoom that **broke day selection** — the wrapper
  clipped the grid. Ambitious layout changes need real verification, which isn't
  available; prefer the boring option.
- Left the original `focus-simulator_2.html` in the project root, where he kept opening
  it and seeing no changes. It's now in `tools/original-upload.html`.

---

## 10. Where things stand

**Working and tested:** everything in §4. 162/162 checks pass. Electron installer builds.

**Not done / open:**

- **Shared games.** He asked for these alongside the shared timer and they were deferred.
  The connection layer now exists, so co-op crossword or competitive Wordle is a much
  smaller job — the natural next step. Co-op needs conflict handling for two people
  typing in one square; competitive (same puzzle, separate boards, compare at the end)
  is simpler.
- **Capacitor/Tauri never actually built.** Configs are written and point at `dist/`;
  only Electron has been run. Tauri's Rust side still needs `npx tauri init`.
- **No TURN relay** for WebRTC.
- **Memory match disabled** at his request; re-enable with one flag.
- App icons are the inline SVG from the original; `electron-builder` uses defaults.

**Deliberately rejected**, so nobody re-proposes them:

- ES modules for `src/js` — would have broken the byte-identical split.
- Baking audio gain into the files — causes generation loss.
- Inlining the audio — 52 MB cannot go in an HTML file.
- Calendar scroll-zoom — tried, broke day selection, removed at his request.
