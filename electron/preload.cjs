/* The one bridge between the desktop shell and the page.
 *
 * The window runs with `contextIsolation` and `sandbox` on, so the page has no
 * Node and cannot reach `ipcRenderer` on its own — which is how it should stay.
 * What it *does* need is to see what the updater is doing, because until now the
 * updater worked entirely in silence: it downloaded in the background and said
 * nothing until it was finished, while the page went on showing a "Get it" link
 * to GitHub as though nothing were happening. Two mechanisms, no connection
 * between them, and the visible one was the useless one.
 *
 * So: a read-only feed of update events, and one action. Nothing else crosses.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('focusUpdate', {
  /** Called with {state, version?, percent?, message?} as things happen. */
  on(cb) {
    if (typeof cb !== 'function') return;
    ipcRenderer.on('focus-update', (_e, payload) => {
      try { cb(payload); } catch (e) { /* the page's problem, not ours */ }
    });
    // tell the main process we are listening, so it can replay the last state
    ipcRenderer.send('focus-update-ready');
  },
  /** Install the downloaded update and come back. */
  restart() { ipcRenderer.send('focus-update-restart'); },
});
