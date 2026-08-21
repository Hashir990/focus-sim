# Putting Focus Simulator on someone else's computer

Three ways, easiest first. All of them include the ambience audio; none of them
puts the developer bar in front of the person using it.

**Never hand over `dist/dev-unlocked.html`.** That is the developer copy — it
starts with everything bought, 999 embers, and a control bar across the bottom.
The file to give people is `dist/index.html`.

---

## 1. Copy two things (no installer, works anywhere)

The whole app is one HTML file plus the sound files it plays.

1. Copy the **`dist` folder** onto a USB stick, into Drive/Dropbox, or wherever
   — but only these:

   ```
   dist/index.html
   dist/audio/          (cafe.mp3, campfire.mp3, forest.mp3, office.mp3, rain.mp3)
   ```

   Delete `dist/dev-unlocked.html` from the copy.

2. On the other computer, double-click `index.html`. It opens in their browser
   and works offline.

The `audio` folder has to stay **beside** `index.html`, in a folder called
exactly `audio` — that is where the app looks for the tracks. If the sounds are
silent, that is nearly always why.

To make it feel like an app rather than a tab: open it in Chrome or Edge, then
**⋮ → Cast, save and share → Install page as app** (Edge: **⋮ → Apps → Install
this site as an app**). It gets its own window and a Start-menu entry.

---

## 2. Build a real Windows installer

This is what put "Focus Simulator" in your own Start menu. It produces a single
`.exe` you can hand over.

On your machine, in the project folder:

```
npm install          # once
npm run electron:pack
```

The installer appears in **`release/`** — something like
`Focus Simulator Setup 1.0.0.exe`. Copy that one file over and run it. Audio is
bundled inside it (`asarUnpack` in package.json keeps the mp3s playable), so
there is nothing else to copy.

`npm run ship` does the same thing but runs the test suites first, which is the
one to use if you have been editing.

Two things to expect on the other machine:

- **SmartScreen.** The build is unsigned, so Windows shows "Windows protected
  your PC". *More info → Run anyway*. Signing it properly means buying a code
  signing certificate.
- **Where the data lives.** Each install keeps its own embers, sessions and
  saved games. Nothing is shared between computers unless you move it — see
  below.

Other platforms, from the same project: `npx electron-builder --mac` (dmg) and
`--linux` (AppImage).

---

## 3. Put it on a phone

`npm run android` / `npm run ios` (Capacitor is already configured). Both need
the platform's own toolchain — Android Studio, or Xcode on a Mac. The full
Android walkthrough is in [ANDROID.md](ANDROID.md).

---

## Keeping other people's copies up to date

Set this up once and updating somebody is two commands. What they get depends on
how they installed:

| They installed via | What happens when you publish |
|---|---|
| The `.exe` installer (route 2) | Their app notices, downloads it in the background, and offers to restart. Nothing for them to do. |
| A copied `index.html` (route 1) | Their app shows a line in the menu — new version, your note, a download link. They replace the file. |
| Android | Same notice as above; installing a new APK is manual. |

Either way their **data is untouched**. Sessions, embers, themes and saved games
live in the browser's local storage, not in the app file.

### Setting it up (once)

1. **Make a repository** at <https://github.com/new>. Any name; public or
   private both work. Do not tick anything that adds files to it.

2. **Point the project at it:**

   ```
   npm run setup:updates YOUR-GITHUB-NAME THE-REPO-NAME
   ```

   That writes the publish target into `package.json`, writes `.env.release`
   with the URL the plain HTML build checks, and adds the git remote.

3. **Push what you have:**

   ```
   git add -A
   git commit -m "first"
   git branch -M main
   git push -u origin main
   ```

4. **Make a token** at <https://github.com/settings/tokens> — *classic*, with
   the **repo** scope ticked — and put it in your environment as `GH_TOKEN`.
   This is what lets the build upload the installer. In PowerShell, to keep it:

   ```powershell
   setx GH_TOKEN "ghp_your_token_here"
   ```

   Close and reopen the terminal afterwards.

5. **Install and hand over the new build.** The copy somebody already has
   predates all of this and has nothing to check — so this once, they need a
   fresh installer from you. Everything after this is automatic for them.

### Releasing (every time)

```
npm run release patch "What changed, in a sentence"
npm run publish:win
```

Two commands, and **no git** — `latest.json` is attached to the release by the
same step that uploads the installer.

- `release` bumps the version, rebuilds with it stamped inside, writes
  `latest.json`. Use `minor` instead of `patch` for something bigger.
- `publish:win` checks everything first (see below), builds the installer,
  uploads it to GitHub Releases, and attaches `latest.json` beside it.

If something is not ready, `npm run publish:check` says which thing in about a
second — rather than electron-builder failing at the end of a ten-minute build,
which is where it would otherwise tell you:

```
Focus Simulator 1.0.1 — publish check

  ok    publishing to github.com/you/focus-sim
  ✗     GH_TOKEN is not set in this terminal
        → setx GH_TOKEN "ghp_..."  — then CLOSE this window and open a new one
  ok    electron-updater is installed
  ok    release note: "first release"
  ok    repository found, public
```

Installed copies check about eight seconds after launch, and once a day after
that. They download in the background and ask before restarting — never mid
session.

### Things worth knowing

- **Unsigned is fine for updates.** The updater checks the download against a
  hash, not a certificate. Being unsigned costs you the SmartScreen warning on
  the *first* install only; updates after that are quiet.
- **macOS is the exception** — it refuses unsigned updates outright, so the
  `.dmg` stays a hand-replace job until you have an Apple certificate.
- **Nothing is sent anywhere.** Both checks are a GET of a public file; the
  version comparison happens on their machine. No identifiers, no usage data.
- **Before any of this is set up, the app is silent about updates**: no menu
  item, no request. That is the right default for a build handed over on a USB
  stick, and it means a copy made today is not broken by you setting this up
  tomorrow — it simply never updates.

---

## Moving your progress across

The app keeps everything in the browser's local storage for that specific copy,
so a new install starts empty. To carry your history over:

1. On the old one: **Menu → Your data → Export backup**. It saves a `.json`.
2. On the new one: **Menu → Your data → Import backup**, and pick that file.

That brings the session log, embers, themes, quotes, tasks, friends and saved
games with it.

---

## If you are handing it to somebody who will use it properly

Worth telling them:

- **Embers** are earned by finishing focus blocks — one per ten minutes — and
  are spent on themes under **Your focus**. Nothing is unlocked at the start
  except the default look, which is deliberate.
- **Focus together** shares a timer directly between two devices; it needs both
  to be online at the same time, and nothing goes through a server of ours.
- **Effects** in the menu turns off the weather behind the timer, which is the
  first thing to try on an old or low-powered machine.
