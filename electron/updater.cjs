/* Keeping an installed copy up to date, on its own.
 *
 * This is the half of updating that only the desktop build can do. A copy of
 * `dist/index.html` sitting in somebody's Downloads folder can be *told* there
 * is a new version (see src/js/41-update.js); an installed application can go
 * and get it.
 *
 * How it works, end to end:
 *
 *   1. `npm run release patch "..."` bumps the version in package.json.
 *   2. `npm run publish:win` builds the installer and uploads it to GitHub
 *      Releases, along with a small `latest.yml` describing it.
 *   3. Every installed copy asks GitHub for that `latest.yml` a few seconds
 *      after it starts. If the version there is higher than its own, it
 *      downloads the installer in the background.
 *   4. The person is told once it is ready, and chooses when to restart. The
 *      new version is in place next time they open the app.
 *
 * **Nothing happens without a release being published.** With no `publish`
 * block in package.json — which is the state this repo ships in — the updater
 * has no repository to ask, logs that once, and never tries again. A build made
 * before you set any of this up is not broken by it, it just never updates.
 *
 * **Why the download is not silent-installed.** electron-updater will happily
 * quit and install the moment a download finishes. That is a terrible thing to
 * do to a timer: somebody is thirty minutes into a focus block and the app
 * closes itself. `autoInstallOnAppQuit` puts it in at the next ordinary exit
 * instead, which costs nothing and interrupts nobody.
 *
 * **Windows and code signing.** An unsigned build updates fine — the updater
 * verifies the download against the hash in `latest.yml`, not against a
 * certificate. What being unsigned costs you is the SmartScreen warning on the
 * *first* install; updates after that are quiet. macOS is different: it refuses
 * unsigned updates outright, so the dmg is a hand-download-and-replace affair
 * until you have an Apple developer certificate.
 */
const { app, dialog, shell, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

/* ---- clearing up after ourselves ----
 * electron-updater downloads each installer into a cache folder and leaves it
 * there. That is on purpose — a resumed download beats a restarted one — but a
 * Focus Simulator installer is about 130 MB, and over a few releases the folder
 * quietly becomes half a gigabyte of installers for versions nobody is running
 * any more. Nothing ever removes them.
 *
 * So: on start, delete anything in that folder that has not been touched in a
 * few days. A pending update older than that has either been installed already
 * — in which case the file is dead weight — or was abandoned, and will be
 * fetched again if it is still wanted. The only thing this can cost is one
 * re-download; the thing it saves is unbounded.
 */
const STALE_DAYS = 3;

function sweepCache() {
  try {
    // where electron-updater keeps them: %LOCALAPPDATA%\<updaterCacheDirName>
    const base = path.join(path.dirname(app.getPath('userData')), 'focus-simulator-updater');
    if (!fs.existsSync(base)) return;
    const cutoff = Date.now() - STALE_DAYS * 86400000;
    let freed = 0;
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        let st;
        try { st = fs.statSync(full); } catch (e) { continue; }
        if (st.isDirectory()) { walk(full); continue; }
        // the tiny bookkeeping files are what lets a resume work; leave them
        if (/\.(yml|json)$/i.test(name)) continue;
        if (st.mtimeMs > cutoff) continue;
        try { fs.unlinkSync(full); freed += st.size; } catch (e) { /* in use */ }
      }
    };
    walk(base);
    if (freed) console.log('[update] cleared ' + Math.round(freed / 1048576) + ' MB of old downloads');
  } catch (e) { /* never worth failing a launch over */ }
}

/** Is there a repository configured to update from?
 *
 * **Two places, because the packaged app is a different shape.** In a checkout
 * the answer is `build.publish` in package.json. In an installed copy the file
 * that matters is `app-update.yml`, which electron-builder writes into
 * `resources/` at pack time and which is what electron-updater itself reads —
 * package.json may have been rewritten on the way in, and gating on a field
 * that the packaging step is entitled to drop means the updater switches itself
 * off in exactly the build where it is the only way to update.
 *
 * Checked first because it is the authority: if `app-update.yml` is there, the
 * updater has what it needs no matter what package.json says.
 */
function configured() {
  try {
    const yml = path.join(process.resourcesPath || '', 'app-update.yml');
    if (fs.existsSync(yml)) return true;
  } catch (e) { /* not packaged, or no resourcesPath */ }
  try {
    const pkg = require('../package.json');
    const p = pkg.build && pkg.build.publish;
    if (!p) return false;
    const first = Array.isArray(p) ? p[0] : p;
    return !!(first && first.owner && first.repo && first.owner !== 'OWNER');
  } catch (e) {
    return false;
  }
}

function setup(win) {
  /* **Answer the page first, whatever happens next.**

     Both guards below used to `return` before the `focus-update-ready` handler
     was registered, so any failure here made the main process *mute*: the page
     announced itself, nothing replied, and it sat on `idle` for the session.
     From the outside that is indistinguishable from an app with no updater —
     which is exactly how it was read, for three sessions. The renderer would
     print nothing, the reason was on a stdout nobody sees, and the only visible
     symptom was a "Get it" link that should not have been there.

     So the reply is wired up before anything that can fail, and a failure now
     *says* so: `manual` with a reason the page can show and a human can read in
     one console line. A silent updater is worse than a broken one, because a
     broken one tells you which part broke. */
  let last = {state: app.isPackaged ? 'auto' : 'manual'};
  let autoUpdater = null;
  const say = (payload) => {
    last = payload;
    try { if (win && !win.isDestroyed()) win.webContents.send('focus-update', payload); }
    catch (e) { /* window gone */ }
  };
  try {
    ipcMain.removeAllListeners('focus-update-ready');
    ipcMain.on('focus-update-ready', () => say(last));
    ipcMain.removeAllListeners('focus-update-restart');
    ipcMain.on('focus-update-restart', () => {
      if (autoUpdater) setImmediate(() => autoUpdater.quitAndInstall(false, true));
    });
  } catch (e) { /* already wired */ }

  const off = (why) => {
    console.log('[update] ' + why + ' — updates are off');
    say({state: 'manual', message: why});
  };

  if (!configured()) {
    off('no publish target found');
    return;
  }

  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    /* **This is the one that actually happened.** In a packaged build the
       module has to be *inside* the app, and it is only there if electron-
       builder copied it — which depends on `files` in package.json. Listing
       `files` explicitly without `node_modules` leaves the dependency behind,
       the require throws here, and every version of this bug follows. */
    off('electron-updater is not in this build (check "files" in package.json)');
    return;
  }

  /* ---- saying so out loud ----
   * All of this used to happen in complete silence: the download ran in the
   * background and the first anybody heard was a dialog when it was already
   * finished. Meanwhile the page went on showing its "Get it" link to GitHub —
   * so the visible thing was the manual one, and the automatic one was
   * invisible. People reasonably concluded there was no automatic one.
   *
   * `state` is sent to the page, which draws it (41-update.js). `last` is kept
   * so a window that finishes loading mid-download still gets told where things
   * are, rather than waiting for the next event that may never come.
   */
  /* **The page cannot see whether this updater is going to do anything**, and
     that is what made "Get it" send everybody to GitHub.

     electron-updater refuses to run in an unpacked copy — `npm run electron`
     prints "Skip checkForUpdates because application is not packed" and then
     emits nothing at all. The page waited for an event that was never coming,
     stayed on its fallback, and showed the manual link. From the outside that
     looks exactly like the automatic updater not existing.

     So the first thing said is whether there *is* one. `auto` means downloads
     happen on their own and the page should stop offering the manual route;
     `manual` means this copy will never update itself and the link to GitHub is
     the honest answer. Replayed to any window that asks (`focus-update-ready`),
     so a page that finished loading late still finds out. */
  autoUpdater.on('checking-for-update', () => say({state:'checking'}));
  autoUpdater.on('update-not-available', () => say({state:'current'}));
  autoUpdater.on('update-available', (i) => say({state:'downloading', version:i && i.version, percent:0}));
  autoUpdater.on('download-progress', (p) => say({
    state:'downloading', percent: Math.max(0, Math.min(100, Math.round(p && p.percent || 0))),
  }));

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  /* **Whatever is newest, in one step — and never backwards.**

     There is no version-by-version ladder here and there must not be one: the
     GitHub provider reads `latest.yml` off the release GitHub calls "Latest",
     so a copy sitting on 1.0.5 goes straight to whatever the newest release is
     rather than walking 1.0.6, 1.0.7, 1.0.8. Each installer is a full one, so
     the intermediate versions have nothing to contribute.

     The one way that goes wrong is that **GitHub's "Latest" is decided by
     publish date, not by version number.** Re-publishing or editing an older
     release makes it Latest again, and then `latest.yml` describes a version
     older than the one already installed. `allowDowngrade` is false by default;
     it is written out because the default is the load-bearing part — with it
     true, one edit to an old release would push everybody backwards. The page
     is guarded separately by `updNewer()`, and `publish:check` fails if the
     highest version on the repository is not the one marked Latest.

     Pre-releases stay out for the same reason: they are not what somebody
     pressing "update" is asking for. */
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;
  /* Nobody should ever have to go to GitHub for this. The download happens on
     its own, and it goes in at the next ordinary exit whether or not the person
     ever answers the dialog below — the dialog only offers to do it *sooner*. */
  sweepCache();

  autoUpdater.on('update-downloaded', () => {
    /* The new one has landed, so whatever was cached for an older release is
       finished with. Swept again on the next start, once this one is in. */
    setTimeout(sweepCache, 60000);
  });

  autoUpdater.on('error', (err) => {
    say({state:'failed', message: err && err.message ? String(err.message).slice(0, 120) : ''});
    // Offline, rate-limited, mid-publish: all normal, none of it the person's
    // problem. It goes to the log and nowhere else.
    console.log('[update] ' + (err && err.message ? err.message : err));
  });

  autoUpdater.on('update-downloaded', async (info) => {
    say({state:'ready', version: info && info.version});
    const notes = typeof info.releaseNotes === 'string'
      ? info.releaseNotes.replace(/<[^>]+>/g, ' ').trim().slice(0, 400)
      : '';
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Restart now', 'Next time I close it'],
      defaultId: 1,
      cancelId: 1,
      title: 'Update ready',
      message: 'Version ' + info.version + ' is ready to install.',
      detail: (notes ? notes + '\n\n' : '')
        + 'Your sessions, embers, themes and saved games are kept.',
    });
    if (response === 0) {
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
    }
  });

  /* A few seconds after launch rather than immediately: starting up is the one
     moment the app has real work to do, and an update is never urgent. */
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 8000);

  /* And once a day for a copy that is left open for weeks, which this one is
     designed to be. */
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 24 * 60 * 60 * 1000);
}

module.exports = { setup, configured };
