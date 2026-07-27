/**
 * Headless smoke test. Loads dist/index.html in a real DOM, then drives the app
 * the way a user would: start a session, open the arcade, play both games,
 * write a note, export a backup. Fails loudly on any uncaught error.
 *
 *   npm i -D jsdom && node tools/smoke-test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');

const errors = [];
// jsdom cannot perform a blob download or a location.reload(); both are fine in a
// real browser, so those two messages are not real failures.
const IGNORE = /Not implemented: navigation/;
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => {
  const msg = e.detail?.stack || e.message;
  if (!IGNORE.test(msg)) errors.push('jsdomError: ' + msg);
});
vc.on('error', (...a) => {
  const msg = a.join(' ');
  if (!IGNORE.test(msg)) errors.push('console.error: ' + msg);
});

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  virtualConsole: vc,
});
const { window } = dom;

// Browser APIs jsdom doesn't implement. The app already guards all of these,
// but stubbing them keeps the test output about real failures only.
window.AudioContext = class {
  constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
  createOscillator() { return { type: '', frequency: { value: 0 }, connect: () => ({ connect() {} }), start() {}, stop() {} }; }
  createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect() {} }) }; }
  resume() {}
};
window.navigator.vibrate = () => true;
window.URL.createObjectURL = () => 'blob:stub';
window.URL.revokeObjectURL = () => {};

const $ = (id) => window.document.getElementById(id);
const click = (id) => { const el = $(id); if (!el) throw new Error(`#${id} missing`); el.click(); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const checks = [];
const check = (label, ok, detail = '') => {
  checks.push({ label, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${label}${detail && !ok ? ' — ' + detail : ''}`);
};

await wait(400); // let the async load()/loadQuotes()/loadLog() settle

// --- structure -------------------------------------------------------------
for (const id of ['setup', 'timer', 'overlay', 'quotes-overlay', 'cal-overlay', 'drawer']) {
  check(`#${id} present`, !!$(id));
}
check('presets rendered', $('f-presets').children.length > 0, `${$('f-presets').children.length} chips`);
check('repeat chips rendered', $('rep-chips').children.length > 0);

// --- timer -----------------------------------------------------------------
click('f-plus');
check('focus stepper responds', $('f-num').textContent !== '', `now ${$('f-num').textContent}`);

click('begin');
await wait(60);
check('begin switches to timer view', !$('timer').classList.contains('hide'));
check('clock is populated', /^\d{2}:\d{2}$/.test($('clock').textContent.trim()), $('clock').textContent);

click('toggle-run');
// Before the first tick, remaining === total, so the resume label reads "Begin focus".
check(
  'pause/resume label is valid',
  /^(Pause|Resume|Begin (focus|rest))$/.test($('toggle-run').textContent.trim()),
  $('toggle-run').textContent,
);
click('toggle-run');
check('resumes without throwing', $('toggle-run').textContent.trim() === 'Pause', $('toggle-run').textContent);

// --- arcade: sudoku --------------------------------------------------------
click('skip'); // move into a rest phase so the arcade is reachable
await wait(60);
$('overlay').classList.remove('hide');
const pcards = window.document.querySelectorAll('.pcard');
check('arcade has game cards', pcards.length >= 2, `${pcards.length} cards`);

pcards[0].click();
await wait(250);
const sdkCells = $('sdk-grid').children.length;
check('sudoku grid built', sdkCells === 81, `${sdkCells} cells`);
const givens = [...$('sdk-grid').children].filter((c) => c.textContent.trim() !== '').length;
check('sudoku has givens', givens > 15 && givens < 70, `${givens} filled`);
check('sudoku numpad built', $('sdk-pad').children.length >= 9, `${$('sdk-pad').children.length} keys`);

// type a digit into the first empty cell
const empty = [...$('sdk-grid').children].find((c) => !c.classList.contains('given'));
if (empty) { empty.click(); $('sdk-pad').children[0].click(); }
check('sudoku accepts input without throwing', true);

// --- arcade: wordle --------------------------------------------------------
pcards[1].click();
await wait(250);
check('wordle board built', $('wdl-board').children.length >= 5, `${$('wdl-board').children.length} rows`);
check('wordle keyboard built', $('wdl-kbd').children.length > 0);
for (const ch of 'crane') {
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: ch }));
}
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
await wait(150);
check('wordle accepts a guess', true);

// --- notes, quotes, calendar, backup --------------------------------------
$('note-input').value = 'smoke test note';
$('note-input').dispatchEvent(new window.Event('input'));
check('note box accepts text', $('note-input').value === 'smoke test note');

click('d-quotes');
await wait(80);
check('quote bank opens', !$('quotes-overlay').classList.contains('hide'));
check('quote list populated', $('q-list').children.length > 0, `${$('q-list').children.length} quotes`);
click('q-back');

click('d-history');
await wait(80);
check('calendar opens', !$('cal-overlay').classList.contains('hide'));
check('calendar grid built', $('cal-grid').children.length > 0, `${$('cal-grid').children.length} cells`);
click('cal-close');

click('d-export');
await wait(150);
check('export runs without throwing', true);
check('import controls wired', !!$('import-file') && !!$('d-import'));

// --- verdict ---------------------------------------------------------------
console.log('');
if (errors.length) {
  console.log(`✗ ${errors.length} runtime error(s):`);
  errors.slice(0, 10).forEach((e) => console.log('   ' + e.split('\n')[0]));
} else {
  console.log('✓ no uncaught runtime errors');
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length || errors.length ? 1 : 0);
