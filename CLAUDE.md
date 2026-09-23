# Focus Simulator

A focus/pomodoro app with a rest arcade. Electron on the desktop, Capacitor on
Android, one HTML file everywhere.

`HANDOFF.md` is the long version — architecture, every system's state, and a
gotchas section that is worth reading before touching anything unfamiliar. This
file is only the things you need in the first five minutes.

## Build

`tools/build.mjs` concatenates `src/{js,css,body}` in filename order into
`dist/index.html`. There is no bundler and no module system.

**Everything shares one IIFE scope.** Function declarations hoist across files,
`const` and `let` do not — a file that reads a `const` declared in a later file
throws on load, and the whole app comes up blank with nothing in the console to
say which line did it. Order is the filename prefix; that is the only reason
`09b-daily.js` is called that.

## Commands

```
npm run build                 # → dist/index.html
npm test                      # the gate: build + 6 test files, ~1440 checks, ~3 min
cd android && gradlew :focus-guard:testDebugUnitTest   # app blocking's rules, on the JVM (Java 17)
npm run electron              # run the desktop app
npm run phone                 # → the Android phone plugged in (see ANDROID.md)
node tools/look-<x>.mjs       # render a screen to look/<x>.png (Chromium)
node tools/look-picross.mjs   # every puzzle in the bank, as one page (no browser needed)
node tools/look-screens.mjs   # real markup under real CSS; open it — it measures itself
node tools/make-picross.mjs   # re-check every picross design and rebuild its bank
node tools/picross-import.mjs <pic.png> --size 15 --append "name"   # a picture → a puzzle
node tools/picross-sheet.mjs <pack|sheet.png> --size 20 --one --holes 1 --out look/harvest/x-20.json
node tools/picross-pick.mjs --want 200   # merge the harvest → tools/picross-designs.mjs
node tools/i18n-coverage.mjs             # what is still in English, screen by screen
node tools/look-lang.mjs                 # every language's screens → look/lang-<code>.html
```

Ship a release (PowerShell, needs `$env:GH_TOKEN`):

```
npm run ship:release -- -Bump patch -Notes "what changed"
```

## Rules that have each cost real time

- **Never edit the version by hand.** `ship:release -Bump patch|minor` does it.
  `package.json` in this folder is the only authority on what version is out.
- **The picross bank is generated, and its dates are positions.** Three sizes,
  15×15, 20×20 and 30×30, and they have to stay level with each other because a
  day serves one of each. The pictures come from game-icons.net (**CC BY 3.0**)
  and Twemoji (**CC BY 4.0**) — for both, **the About page credit is a condition
  of the licence, not a courtesy; do not remove it** — and Kenney's icon packs
  (CC0, credited anyway). SVG sources are rendered by `tools/svg-raster.mjs`,
  which is why a library of drawn icons can be used at all; everything is then
  converted by `tools/picross-sheet.mjs`
  (a pack) or `tools/picross-import.mjs` (one file) and chosen by
  `tools/picross-pick.mjs`. Never traced from a puzzle site, where the grids
  belong to whoever submitted them. **Only sources that name their files** are
  used: the name is what proves a puzzle is a thing and not a wall, and the
  picker rejects names that are shapes or interface parts, allowing each thing
  once per size. Designs live in `tools/picross-designs.mjs`; `node tools/make-picross.mjs` proves each one
  is solvable by line logic alone (which is what makes its answer unique) and
  writes `src/js/27a-picross-data.js`. Never edit that file by hand, and never
  *insert* into the middle of a list: a puzzle's date is its position counted
  from `PIC_EPOCH`, so inserting moves every date after it.

  Replacing a design in place is allowed — but only above the waterline. Work
  out how many days have passed since `PIC_EPOCH`; those entries are out in the
  world and a saved board belongs to them. Everything after is unpublished and
  may be redrawn freely. Check it afterwards rather than trusting the count:
  the published entries have to come out of the generator byte-identical.

- **The crossword bank is append-only, and it updates in the background.** A
  puzzle's release date is its position in its size's list counted from
  `DAILY_EPOCH`. Inserting one in the middle rewrites every date after it and
  orphans saved boards. If `src/js/26-crossword-data.js` changes under you,
  accept it and move on — do not tidy it, reorder it, or resolve it.
- **Seven languages, and English is the key.** `00a-i18n.js` translates the page
  where strings meet it: a text node whose whole text is a known English string
  is swapped, and a MutationObserver keeps doing it for everything drawn later.
  So **a sentence built out of pieces has to go through `T()`** (or `Tn()` when
  something is counted) at the place it is built — `T('Done in {t}', {t})`,
  never `'Done in ' + t` — because half a sentence is not a whole string.
  Strings live in `60*-i18n-*.js`, one entry per English string with all six
  translations beside it; a missing one is a failing check. The prose pages —
  privacy, terms, credits — are whole documents per language in `61-docs-*.js`,
  not assembled from entries. **Text drawn by CSS `content:` cannot be
  translated**: write it into a `data-` attribute from JS. Anything that is not
  the app's own words — what somebody typed, a username, an English crossword
  clue or word-game board — is marked `translate="no"`. After changing any
  interface text, run `node tools/i18n-coverage.mjs`: it opens every screen in
  every language and lists what is still in English.
- **Changing the terms re-asks everybody.** `TERMS_VERSION` in `50b-terms.js`
  is what a device records when somebody agrees; bump it and the gate comes
  back for everyone on their next start. Do that for a change that matters, and
  only then.
- **The merge rules exist twice and must stay byte-identical**: `src/js/47-merge.js`
  and `server/accounts.js`. The server rebuilds the account snapshot, so a key
  the two sides disagree about is silently dropped on sync.
- **Adopt paths are wrapped in `try/catch`** in `48-account.js`. A typo in one
  becomes a whole section of the account quietly not syncing, with nothing
  logged. Test an adopt path *through* the adopt path.

## How to be sure something works

Reason about the code, then go and look. `tools/look-*.mjs` render real screens
to PNG with Chromium — use them for anything visual rather than describing what
the CSS ought to do. For behaviour, add the check to `tools/smoke-test.mjs` and
then **break the fix and confirm the check goes red**. A check that passes with
the code reverted is testing nothing, and this suite has caught that twice.

## Style

Comments explain *why*, in prose, especially where the obvious thing is wrong.
Screen copy is plain and short: cut what the screen already shows, keep what
only the code knows. No em-dash-free rewriting, no filler, no explaining the app
to its own user.
