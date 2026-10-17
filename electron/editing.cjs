/* ---- cut, copy, paste ----

   **Removing the menu removed the clipboard.** `Menu.setApplicationMenu(null)`
   in main.cjs is there to take away the menu bar and the Toggle Developer
   Tools accelerator on it, and it does. What is not obvious is that Chromium
   routes Ctrl+V, Ctrl+C, Ctrl+X, Ctrl+A, Ctrl+Z and Ctrl+Y through that same
   menu: with no menu there are no accelerators, so in the packaged app those
   keys did nothing at all. Typing worked, pasting did not, and the one screen
   where that matters most is the one asking for an email and a password --
   which is exactly where people paste out of a password manager.

   It only ever affected the installed copy, because the menu is only removed
   when `app.isPackaged`. Run from a checkout it has always worked, which is
   why it could sit here unnoticed for so long.

   Putting a hidden menu back is the usual suggestion and it is worse: a menu
   whose items are invisible still answers Alt on Windows, and bringing the bar
   back for the sake of six shortcuts hands the developer tools back with it.
   So the keys are wired straight to the WebContents, which is what the menu
   items would have called anyway.

   Its own file so it can be tested without starting the app: see
   tools/edit-test.cjs, which removes the menu exactly as the packaged app
   does, pastes, and reads the field back. */
const { Menu } = require('electron');

function wireEditing(win) {
  const wc = win.webContents;

  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const mod = process.platform === 'darwin' ? input.meta : input.control;
    if (!mod || input.alt) return;
    const key = String(input.key || '').toLowerCase();
    const shift = !!input.shift;
    // Only these six. Anything else the page may want for itself.
    if (key === 'v') wc.paste();
    else if (key === 'c') wc.copy();
    else if (key === 'x') wc.cut();
    else if (key === 'a') wc.selectAll();
    else if (key === 'z' && !shift) wc.undo();
    else if ((key === 'z' && shift) || key === 'y') wc.redo();
    else return;
    e.preventDefault();
  });

  /* The other half of "like every other app": a field you can paste into with
     the keyboard but not with the mouse is still missing half of it. Only over
     something you can actually type in -- a context menu on the timer offering
     Paste is noise, and the app draws its own hold-menus elsewhere (holdMenu in
     21-dialogs.js) which this must not sit on top of. */
  wc.on('context-menu', (e, params) => {
    if (!params || !params.isEditable) return;
    const flags = params.editFlags || {};
    const has = !!params.selectionText;
    Menu.buildFromTemplate([
      { role: 'cut', enabled: has && flags.canCut !== false },
      { role: 'copy', enabled: has && flags.canCopy !== false },
      { role: 'paste', enabled: flags.canPaste !== false },
      { type: 'separator' },
      { role: 'selectAll' },
    ]).popup({ window: win });
  });
}

module.exports = { wireEditing };
