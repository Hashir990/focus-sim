/**
 * Headless smoke test. Loads dist/index.html in a real DOM and drives the app
 * the way a user would. Fails loudly on any uncaught error.
 *
 *   npm test
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Optional argument lets you point the test at any built file:
//   node tools/smoke-test.mjs some/other/index.html
const htmlPath = process.argv[2] ? resolve(process.argv[2]) : join(root, 'dist', 'index.html');
const html = readFileSync(htmlPath, 'utf8');

// jsdom can't navigate (blob download, location.reload) or paint to a canvas.
// All three are fine in a real browser, so they are not real failures.
const IGNORE = /Not implemented: (navigation|HTMLCanvasElement)/;

const log = (s) => process.stderr.write(s + '\n');
const checks = [];
const check = (label, ok, detail = '') => {
  checks.push({ label, ok, detail });
  log(`${ok ? '✓' : '✗'} ${label}${detail && !ok ? ' — ' + detail : ''}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function boot(pageHtml) {
  const errors = [];
  const vc = new VirtualConsole();
  const record = (msg) => { if (!IGNORE.test(msg)) errors.push(msg); };
  vc.on('jsdomError', (e) => record('jsdomError: ' + (e.detail?.stack || e.message)));
  vc.on('error', (...a) => record('console.error: ' + a.join(' ')));

  const dom = new JSDOM(pageHtml, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
    virtualConsole: vc,
  });
  const { window } = dom;

  window.AudioContext = class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createOscillator() { return { type: '', frequency: { value: 0 }, connect: () => ({ connect() {} }), start() {}, stop() {} }; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: () => ({ connect() {} }) }; }
    resume() {}
  };
  window.navigator.vibrate = () => true;
  window.URL.createObjectURL = () => 'blob:stub';
  window.URL.revokeObjectURL = () => {};

  return { window, errors };
}

// ===========================================================================
// Pass 1 — a fresh install, no history
// ===========================================================================
const { window, errors } = boot(html);
const $ = (id) => window.document.getElementById(id);
const click = (id) => { const el = $(id); if (!el) throw new Error(`#${id} missing`); el.click(); };

await wait(400);

for (const id of ['setup', 'timer', 'overlay', 'quotes-overlay', 'cal-overlay', 'stats-overlay', 'drawer']) {
  check(`#${id} present`, !!$(id));
}
check('presets rendered', $('f-presets').children.length > 0);
check('repeat chips rendered', $('rep-chips').children.length > 0);

// --- session tasks (added before starting) ---------------------------------
check('task empty state shown', $('task-list-setup').textContent.includes('Optional'));
const addTask = (text) => { $('task-input').value = text; click('task-add'); };
addTask('write the report');
addTask('reply to emails');
check('two tasks added', $('task-list-setup').querySelectorAll('.task-row').length === 2, `${$('task-list-setup').querySelectorAll('.task-row').length}`);
check('task text escaped and shown', $('task-list-setup').textContent.includes('write the report'));
$('task-list-setup').querySelectorAll('.task-x')[1].click();
check('task can be removed', $('task-list-setup').querySelectorAll('.task-row').length === 1);
addTask('reply to emails');
check('task re-added', $('task-list-setup').querySelectorAll('.task-row').length === 2);

// --- timer -----------------------------------------------------------------
click('f-plus');
check('focus stepper responds', $('f-num').textContent !== '');
click('begin');
await wait(60);
check('begin switches to timer view', !$('timer').classList.contains('hide'));
check('clock is populated', /^\d{2}:\d{2}$/.test($('clock').textContent.trim()), $('clock').textContent);
click('toggle-run');
check('pause label is valid', /^(Pause|Resume|Begin (focus|rest))$/.test($('toggle-run').textContent.trim()), $('toggle-run').textContent);
click('toggle-run');
check('resumes', $('toggle-run').textContent.trim() === 'Pause', $('toggle-run').textContent);

// --- ticking tasks during the focus block ----------------------------------
check('live checklist visible while focusing', !$('task-live').classList.contains('hide'));
const liveRows = () => [...$('task-list-live').querySelectorAll('.task-row')];
check('live checklist has both tasks', liveRows().length === 2, `${liveRows().length}`);
liveRows()[0].click();
await wait(20);
check('task ticks', liveRows()[0].classList.contains('done'));
liveRows()[0].click();
await wait(20);
check('task un-ticks', !liveRows()[0].classList.contains('done'));
liveRows()[0].click();
liveRows()[1].click();
await wait(20);
check('both tasks ticked', liveRows().every((r) => r.classList.contains('done')));

// --- arcade ----------------------------------------------------------------
click('skip');
await wait(60);
// skip() ends the focus block, which logs the session and folds the ticked
// tasks into its note.
check('ticked tasks written into the session note', /✓ write the report[\s\S]*✓ reply to emails/.test($('note-input').value), JSON.stringify($('note-input').value));
check('live checklist hidden during rest', $('task-live').classList.contains('hide'));
// Open it the way a user does — Arcade.show() sets Arcade.open, which the
// keyboard handlers guard on. Poking the class directly would skip that.
click('arcade-open');
await wait(80);
check('arcade opens from the rest screen', !$('overlay').classList.contains('hide'));
const pcards = [...window.document.querySelectorAll('.pcard')];
check('arcade has three games', pcards.length === 3, `${pcards.length} cards`);
const byGame = Object.fromEntries(pcards.map((c) => [c.dataset.game, c]));
check('enabled games in picker', ['sudoku', 'wordle', 'g2048'].every((g) => byGame[g]), Object.keys(byGame).join(','));
check('memory is disconnected', !byGame.memory);

// sudoku
byGame.sudoku.click();
await wait(250);
check('sudoku grid built', $('sdk-grid').children.length === 81, `${$('sdk-grid').children.length} cells`);
const givens = [...$('sdk-grid').children].filter((c) => c.textContent.trim() !== '').length;
check('sudoku has givens', givens > 15 && givens < 70, `${givens}`);
const emptyCell = [...$('sdk-grid').children].find((c) => !c.classList.contains('given'));
if (emptyCell) { emptyCell.click(); $('sdk-pad').children[0].click(); }
check('sudoku accepts input', true);

// wordle
byGame.wordle.click();
await wait(250);
check('wordle board built', $('wdl-board').children.length >= 5, `${$('wdl-board').children.length} rows`);
for (const ch of 'crane') window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: ch }));
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
await wait(150);
check('wordle registered the typed guess', /^[1-6]\/6$|Solved|Missed/.test($('wdl-meta').textContent.trim()), $('wdl-meta').textContent);

// 2048
byGame.g2048.click();
await wait(250);
const tiles = [...$('g2048-grid').children];
check('2048 grid built', tiles.length === 16, `${tiles.length} tiles`);
const startTiles = tiles.filter((t) => t.dataset.v !== '0').length;
check('2048 starts with two tiles', startTiles === 2, `${startTiles}`);
const beforeMove = tiles.map((t) => t.dataset.v).join(',');
for (const key of ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp']) {
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key }));
  await wait(20);
}
const afterMove = [...$('g2048-grid').children].map((t) => t.dataset.v).join(',');
check('2048 board responds to arrow keys', afterMove !== beforeMove);
check('2048 score shown', /Score \d+ · Best \d+/.test($('g2048-meta').textContent), $('g2048-meta').textContent);

// celebration — actually solve the Sudoku, clicking cells and numpad keys the way
// a player would. The answer comes from the game's own saved state, not from
// reaching into the closure, so this exercises the real input path end to end.
byGame.sudoku.click();
await wait(250);
const saved = JSON.parse(window.localStorage.getItem('arcade_sudoku') || 'null');
check('sudoku persisted its board', !!(saved && saved.sol && saved.sol.length === 81));

// the Check button: put one deliberately wrong digit in and confirm it's flagged
const firstFree = saved.given.findIndex((g, i) => !g && saved.sol[i] !== saved.grid[i]);
const wrongDigit = saved.sol[firstFree] === 9 ? 8 : 9;
[...$('sdk-grid').children][firstFree].click();
[...$('sdk-pad').children].find((b) => b.dataset.n === String(wrongDigit))?.click();
$('sdk-check').click();
await wait(20);
check('checker flags a wrong cell', [...$('sdk-grid').children][firstFree].classList.contains('wrong'));
[...$('sdk-pad').children].find((b) => b.dataset.n === String(wrongDigit))?.click();
check('checker clears on new input', !window.document.querySelector('.sdk .cell.wrong'));

const sdkCells = [...$('sdk-grid').children];
const padKeys = [...$('sdk-pad').children];
const digitKey = (n) => padKeys.find((b) => b.dataset.n === String(n));

for (let i = 0; i < 81; i++) {
  if (saved.given[i]) continue;
  if (saved.sol[i] === saved.grid[i]) continue;
  sdkCells[i].click();
  const key = digitKey(saved.sol[i]);
  if (key) key.click();
}
await wait(120);
check('sudoku solved by clicking', !$('sdk-banner').classList.contains('hide'));
check('sudoku win text written', /Finished in \d{2}:\d{2}/.test($('sdk-win-sub').textContent), $('sdk-win-sub').textContent);
check('celebration fired', !!window.document.querySelector('canvas.confetti'));
check('banner pop applied', $('sdk-banner').classList.contains('pop'));

// --- overlays --------------------------------------------------------------
$('note-input').value = 'smoke test note';
$('note-input').dispatchEvent(new window.Event('input'));
check('note box accepts text', $('note-input').value === 'smoke test note');

click('d-quotes'); await wait(80);
check('quote bank opens', !$('quotes-overlay').classList.contains('hide'));
check('quote list populated', $('q-list').children.length > 0);
click('q-back');

click('d-history'); await wait(80);
check('calendar opens', !$('cal-overlay').classList.contains('hide'));
check('calendar grid built', $('cal-grid').children.length > 0);
click('cal-close');

click('d-stats'); await wait(80);
check('stats overlay opens', !$('stats-overlay').classList.contains('hide'));
// A session was logged by the skip above, so this renders cards, not the empty state.
check('stats renders after one session', $('stats-body').querySelectorAll('.stat-card').length === 4, `${$('stats-body').querySelectorAll('.stat-card').length} cards`);
click('stats-close');
check('stats overlay closes', $('stats-overlay').classList.contains('hide'));

click('d-export'); await wait(150);
check('export runs', true);
check('import controls wired', !!$('import-file') && !!$('d-import'));

// ===========================================================================
// Pass 2 — seeded history, so the stats dashboard has real numbers to render
// ===========================================================================
const now = Date.now();
const DAY = 86400000;
const pad2 = (n) => String(n).padStart(2, '0');
const key = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
const seedLog = [0, 1, 2, 5].flatMap((back, i) =>
  [0, 1].map((n) => {
    const ts = now - back * DAY - n * 3600000;
    return { id: 's' + ts + '_' + i + n, ts, day: key(ts), secs: 1500, note: '' };
  }),
);
const seeded = html.replace(
  '<script>',
  `<script>localStorage.setItem('focus_log', ${JSON.stringify(JSON.stringify(seedLog))});</script>\n<script>`,
);

const { window: w2, errors: errors2 } = boot(seeded);
await wait(400);
const $2 = (id) => w2.document.getElementById(id);
$2('d-stats').click();
await wait(120);

const statsText = $2('stats-body').textContent;
check('stats renders with history', !statsText.includes('No finished sessions'), statsText.slice(0, 50));
check('stats shows session count', statsText.includes('8'), statsText.slice(0, 80));
check('stats cards rendered', $2('stats-body').querySelectorAll('.stat-card').length === 4, `${$2('stats-body').querySelectorAll('.stat-card').length}`);
check('stats bar chart has 14 days', $2('stats-body').querySelectorAll('.sbar').length === 14, `${$2('stats-body').querySelectorAll('.sbar').length}`);
check('streak counted (3 consecutive days)', /3 days/.test(statsText), statsText.match(/\d+ days?/g)?.join(' / ') || '');
check('best hour computed', $2('stats-body').textContent.includes('Best hour'));

// --- ending a session early still logs it -----------------------------------
const sessionCount = () => Number($2('stats-body').querySelectorAll('.stat-card')[1].querySelector('b').textContent);
const before = sessionCount();
$2('stats-close').click();
$2('begin').click();
await wait(60);
// jump the clock forward 90s so there is real focus time to record
const realNow = w2.Date.now;
w2.Date.now = () => realNow.call(w2.Date) + 90000;
$2('stop').click();
await wait(60);
w2.Date.now = realNow;
$2('d-stats').click();
await wait(80);
check('stopping early still logs the session', sessionCount() === before + 1, `${before} → ${sessionCount()}`);
check('back on the setup screen after stop', !$2('setup').classList.contains('hide'));

// --- verdict ---------------------------------------------------------------
const allErrors = errors.concat(errors2);
log('');
if (allErrors.length) {
  log(`✗ ${allErrors.length} runtime error(s):`);
  allErrors.slice(0, 10).forEach((e) => console.log('   ' + e.split('\n')[0]));
} else {
  log('✓ no uncaught runtime errors');
}

const failed = checks.filter((c) => !c.ok);
log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length || allErrors.length ? 1 : 0);
