// Desktop shell. Loads the same dist/index.html the browser and phone apps use.
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');
const updater = require('./updater.cjs');

function createWindow() {
  const win = new BrowserWindow({
    width: 460,
    height: 900,
    minWidth: 360,
    minHeight: 600,
    backgroundColor: '#0b1220',
    title: 'Focus Simulator',
    autoHideMenuBar: true,
    webPreferences: {
      // The app is fully self-contained and needs no Node access in the page.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // the only bridge: update progress out, "restart now" in. See preload.cjs.
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  /* Any external link (the Google Fonts CSS aside) opens in the real browser. */
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  /* ---- no developer tools in a copy somebody was handed ----
   *
   * F12, Ctrl+Shift+I, Ctrl+Shift+C, Ctrl+Shift+J and the right-click Inspect
   * all go nowhere once packaged, and the menu bar that carries them is gone.
   *
   * **This is a lock, not a safe.** The whole app is one HTML file inside the
   * package and anyone determined can read it with a text editor; nothing here
   * pretends otherwise. What it stops is the accidental case — a console opened
   * by a keyboard slip, a half-remembered tip about editing `localStorage` to
   * award embers, a screenshot of somebody's session log posted with the
   * inspector hanging open. Cheap, and it removes the invitation.
   *
   * Only when packaged. `npm run electron` keeps the tools, because they are how
   * this app gets debugged — the reason the updater was ever found to be missing
   * from the build was a console session in a packaged copy, and giving that up
   * for a dev build is a fair trade.
   */
  if (app.isPackaged) {
    win.webContents.on('before-input-event', (event, input) => {
      const key = (input.key || '').toLowerCase();
      const devCombo = key === 'f12'
        || (input.control && input.shift && (key === 'i' || key === 'c' || key === 'j'))
        /* macOS says the same thing with Command+Option. */
        || (input.meta && input.alt && (key === 'i' || key === 'c' || key === 'j'));
      if (devCombo) event.preventDefault();
    });
    /* The keyboard is not the only door: the context menu has Inspect on it. */
    win.webContents.on('context-menu', (e) => e.preventDefault());
    /* And `openDevTools` can still be reached from inside the shell, so shut
       the window again if anything manages to open one. */
    win.webContents.on('devtools-opened', () => win.webContents.closeDevTools());
  }

  /* **Before `loadFile`, not after.**

     The page announces itself with `focus-update-ready` the moment it subscribes,
     and the updater replies by replaying the last state it knows. That handler
     is registered inside `setup()` — so calling `setup()` *after* `loadFile()`
     is a race: if the page gets there first, its announcement lands on nothing,
     no state is ever replayed, and the banner sits on `idle` for the whole
     session. On `idle` the page believes the shell is handling it and hides the
     manual route, so the visible result is an app that neither downloads
     anything nor offers you the link — it just says nothing.

     Loading is asynchronous and this usually won at a comfortable margin, which
     is exactly why it is worth removing rather than leaving to chance: a race
     you win nine times in ten is a bug report you cannot reproduce.

     See electron/updater.cjs, which is also where the "why not install it the
     moment it lands" reasoning lives. */
  try { updater.setup(win); } catch (e) { console.log('[update] ' + e.message); }

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  return win;
}

app.whenReady().then(() => {
  /* `autoHideMenuBar` only hides it; Alt still brings it back, and the View menu
     on it carries Toggle Developer Tools. Removing the menu outright is the only
     way the accelerator stops working. Kept in dev, where it is useful. */
  if (app.isPackaged) Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
