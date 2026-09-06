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
npm test                      # the gate: build + 6 test files, ~905 checks, ~3 min
npm run electron              # run the desktop app
node tools/look-<x>.mjs       # render a screen to look/<x>.png (Chromium)
```

Ship a release (PowerShell, needs `$env:GH_TOKEN`):

```
npm run ship:release -- -Bump patch -Notes "what changed"
```

## Rules that have each cost real time

- **Never edit the version by hand.** `ship:release -Bump patch|minor` does it.
  `package.json` in this folder is the only authority on what version is out.
- **The crossword bank is append-only, and it updates in the background.** A
  puzzle's release date is its position in its size's list counted from
  `DAILY_EPOCH`. Inserting one in the middle rewrites every date after it and
  orphans saved boards. If `src/js/26-crossword-data.js` changes under you,
  accept it and move on — do not tidy it, reorder it, or resolve it.
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
