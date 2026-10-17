/**
 * Can you paste into this app?
 *
 *   npx electron tools/edit-test.cjs
 *
 * **What was actually wrong.** Electron ships no context menu of its own, so
 * right-clicking a field offered nothing -- and right-click then Paste is how
 * most people put a password in. The keyboard half is wired here too, because
 * the app removes its application menu when packaged (for the Toggle Developer
 * Tools accelerator on it) and on macOS that is what Cmd+V hangs off.
 *
 * **What this file can and cannot see.** `sendInputEvent` injects straight into
 * the renderer, below the layer where a native accelerator would be resolved,
 * so it cannot reproduce "the real Ctrl+V did nothing" -- an earlier draft of
 * this test asserted that and the assertion failed, which is how the menu
 * theory got thrown out. What it can do is drive the real `wireEditing` and
 * check the editing commands land, and catch the context menu being built.
 *
 * Not part of `npm test`: the suite runs under jsdom, which has no menu, no
 * accelerators and no clipboard. This one needs a real Electron.
 */
const { app, BrowserWindow, Menu, clipboard } = require('electron');
const path = require('path');
const { wireEditing } = require(path.join(__dirname, '..', 'electron', 'editing.cjs'));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
function check(name, ok, detail) {
  console.log((ok ? '✓ ' : '✗ ') + name
    + (ok || detail === undefined ? '' : ' — ' + detail));
  if (!ok) failed++;
}

const PAGE = 'data:text/html;charset=utf-8,'
  + encodeURIComponent('<input id="a" type="email"><input id="b" type="password"><p id="c">plain</p>');

app.whenReady().then(async () => {
  // exactly what the packaged app does
  Menu.setApplicationMenu(null);

  /* Catch the menu rather than show it: popup() would block on a real window
     and there is nobody here to dismiss it. editing.cjs requires this same
     module object, so replacing the builder catches its call. */
  const built = [];
  const realBuild = Menu.buildFromTemplate;
  Menu.buildFromTemplate = (template) => {
    built.push(template.map((i) => i.role || i.type));
    return { popup() {} };
  };

  const win = new BrowserWindow({ show: false, width: 420, height: 220 });
  await win.loadURL(PAGE);
  const wc = win.webContents;
  wireEditing(win);

  const key = (k, mods) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: mods });
    wc.sendInputEvent({ type: 'char', keyCode: k, modifiers: mods });
    wc.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: mods });
  };
  const val = (id) => wc.executeJavaScript(`document.getElementById('${id}').value`);
  const focus = (id) => wc.executeJavaScript(`document.getElementById('${id}').focus(), true`);
  const clear = (id) => wc.executeJavaScript(`document.getElementById('${id}').value = '', true`);

  await clear('a');
  clipboard.writeText('hashir@example.com');
  await focus('a');
  key('v', ['control']);
  await wait(250);
  check('an email pastes', (await val('a')) === 'hashir@example.com',
    JSON.stringify(await val('a')));

  /* The field that matters most: it is where a password manager puts things
     and the one nobody wants to retype. */
  await clear('b');
  clipboard.writeText('correct horse battery staple');
  await focus('b');
  key('v', ['control']);
  await wait(250);
  check('and so does a password',
    (await val('b')) === 'correct horse battery staple',
    JSON.stringify((await val('b')).length) + ' characters');

  clipboard.writeText('');
  await focus('a');
  key('a', ['control']);
  await wait(120);
  key('c', ['control']);
  await wait(250);
  check('select all and copy put it back on the clipboard',
    clipboard.readText() === 'hashir@example.com', JSON.stringify(clipboard.readText()));

  /* Cut is tried on the email, not the password. Chromium refuses to lift
     text out of a type=password field at all -- that is a deliberate rule, not
     something to wire around, and an earlier version of this test read the
     refusal as a broken shortcut. */
  await focus('a');
  key('a', ['control']);
  await wait(120);
  key('x', ['control']);
  await wait(250);
  check('cut empties an ordinary field', (await val('a')) === '', JSON.stringify(await val('a')));
  check('and a password will not be cut out at all, which is Chromium being right',
    (await val('b')) === 'correct horse battery staple', JSON.stringify((await val('b')).length));

  /* **The half that was actually missing.** Right-click a field and there has
     to be a Paste on it. */
  built.length = 0;
  wc.emit('context-menu', {}, { isEditable: true, selectionText: '', editFlags: {} });
  await wait(60);
  check('right-clicking a field offers a menu with Paste on it',
    built.length === 1 && built[0].indexOf('paste') >= 0, JSON.stringify(built));

  /* And nowhere else. A context menu on the timer offering Paste is noise,
     and the app draws its own hold-menus that this must not sit on. */
  built.length = 0;
  wc.emit('context-menu', {}, { isEditable: false, selectionText: 'plain', editFlags: {} });
  await wait(60);
  check('and nothing is offered where you cannot type', built.length === 0,
    JSON.stringify(built));

  Menu.buildFromTemplate = realBuild;
  console.log(failed ? `\n${failed} failed` : '\nclipboard works');
  app.exit(failed ? 1 : 0);
});
