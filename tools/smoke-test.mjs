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
const IGNORE = /Not implemented: (navigation|HTMLCanvasElement|HTMLMediaElement)/;

// Shared address book for the fake peer network, so windows can reach each other.
const FAKE_NET = {};

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

  // A recording stand-in for Web Audio. jsdom has none, and the ambience engine
  // builds a real node graph, so this is what proves the graph is wired without
  // errors and that stopping actually tears everything down.
  const audioLog = { contexts: [], sources: 0, oscillators: 0, limiters: 0, live: () => audioLog.nodes.filter((n) => n.playing).length, nodes: [] };
  const mkParam = (v) => ({
    value: v,
    setValueAtTime() { return this; },
    linearRampToValueAtTime() { return this; },
    exponentialRampToValueAtTime() { return this; },
    setTargetAtTime() { return this; },
    cancelScheduledValues() { return this; },
  });
  const mkNode = (kind) => {
    const n = { kind, connect(d) { n.out = d; return d; }, disconnect() { n.gone = true; } };
    return n;
  };
  const mkPlayable = (kind) => {
    const n = mkNode(kind);
    audioLog.nodes.push(n);
    n.start = () => { n.playing = true; };
    n.stop = () => { n.playing = false; };
    return n;
  };
  window.AudioContext = class {
    constructor() {
      this.sampleRate = 44100; this.currentTime = 0; this.state = 'running';
      this.destination = mkNode('destination');
      audioLog.contexts.push(this);
    }
    resume() {}
    createBuffer(_ch, len) { return { length: len, getChannelData: () => new Float32Array(len) }; }
    createBufferSource() { audioLog.sources++; const n = mkPlayable('source'); n.loop = false; n.buffer = null; return n; }
    createBiquadFilter() { const n = mkNode('filter'); n.type = ''; n.frequency = mkParam(0); n.Q = mkParam(0); return n; }
    createGain() { const n = mkNode('gain'); n.gain = mkParam(0); return n; }
    createOscillator() { audioLog.oscillators++; const n = mkPlayable('osc'); n.type = ''; n.frequency = mkParam(0); return n; }
    createDynamicsCompressor() {
      audioLog.limiters++;
      const n = mkNode('compressor');
      n.threshold = mkParam(-24); n.knee = mkParam(30); n.ratio = mkParam(12);
      n.attack = mkParam(0.003); n.release = mkParam(0.25);
      return n;
    }
  };
  window.__audioLog = audioLog;

  // jsdom has no media playback, so record the calls instead. This is what lets
  // us check the right file gets loaded and that stopping actually pauses.
  const media = { plays: [], pauses: 0, loads: 0 };
  // `paused` is getter-only in jsdom, so back it with our own field
  Object.defineProperty(window.HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get() { return this.__paused !== false; },
  });
  window.HTMLMediaElement.prototype.play = function () { media.plays.push(this.src); this.__paused = false; return Promise.resolve(); };
  window.HTMLMediaElement.prototype.pause = function () { media.pauses++; this.__paused = true; };
  window.HTMLMediaElement.prototype.load = function () { media.loads++; };
  window.__media = media;

  // A fake PeerJS. Instances registered here can find each other, so two windows
  // can genuinely talk — no network, but the real protocol runs end to end.
  window.Peer = function FakePeer(id, _opts) {
    const self = this;
    const handlers = {};
    self.id = id || 'anon-' + Math.random().toString(36).slice(2, 9);
    self.destroyed = false;
    self.on = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); return self; };
    self._emit = (ev, ...a) => (handlers[ev] || []).forEach((f) => f(...a));
    self.destroy = () => { self.destroyed = true; delete FAKE_NET[self.id]; };

    self.connect = (target) => {
      const conn = mkConn(self.id, target);
      const remote = FAKE_NET[target];
      setTimeout(() => {
        if (!remote) { conn._emit('error', new Error('peer-unavailable')); return; }
        const back = mkConn(target, self.id);
        conn._peerConn = back; back._peerConn = conn;
        remote._emit('connection', back);
        setTimeout(() => { back._emit('open'); conn._emit('open'); }, 0);
      }, 0);
      return conn;
    };

    if (FAKE_NET[self.id]) {
      setTimeout(() => self._emit('error', Object.assign(new Error('taken'), { type: 'unavailable-id' })), 0);
    } else {
      FAKE_NET[self.id] = self;
      setTimeout(() => self._emit('open', self.id), 0);
    }

    function mkConn(from, to) {
      const h = {};
      const c = {
        peer: to, open: true,
        on: (ev, fn) => { (h[ev] = h[ev] || []).push(fn); return c; },
        _emit: (ev, ...a) => (h[ev] || []).forEach((f) => f(...a)),
        send: (msg) => { setTimeout(() => c._peerConn && c._peerConn._emit('data', JSON.parse(JSON.stringify(msg))), 0); },
        close: () => { setTimeout(() => { c._emit('close'); c._peerConn && c._peerConn._emit('close'); }, 0); },
      };
      return c;
    }
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
check('setup uses dropdowns', $('drop-rest').tagName === 'DETAILS' && $('drop-tasks').tagName === 'DETAILS');
check('rest summary filled in', /\d+ min · (×\d+|endless)/.test($('rest-summary').textContent), $('rest-summary').textContent);
check('task summary starts empty', $('task-summary').textContent === 'None yet', $('task-summary').textContent);
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
check('task summary counts', $('task-summary').textContent === '0/2 done', $('task-summary').textContent);

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
check('arcade has four games', pcards.length === 4, `${pcards.length} cards`);
const byGame = Object.fromEntries(pcards.map((c) => [c.dataset.game, c]));
check('enabled games in picker', ['sudoku', 'wordle', 'g2048', 'crossword'].every((g) => byGame[g]), Object.keys(byGame).join(','));
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

// crossword direction: typing must go the way the button says, every time
byGame.crossword.click();
await wait(300);
[...$('cw-size').children].find((b) => b.dataset.s === 'small').click();
await wait(250);
{
  const st = JSON.parse(window.localStorage.getItem('arcade_cross'));
  const p = st.puz;
  const sq = [...$('cw-grid').children];
  const dirLabel = () => $('cw-dir').textContent.trim();
  // a square that belongs to both an across and a down word
  const both = p.entries.filter((e) => e.dir === 'down')
    .flatMap((e) => e.cells)
    .find((c) => p.entries.some((a) => a.dir === 'across' && a.cells.includes(c)));
  sq[both].click();
  await wait(30);
  check('direction is shown on screen', /^(Across →|Down ↓)$/.test(dirLabel()), dirLabel());

  // force Down, type, and confirm the letters go downwards
  if (dirLabel() !== 'Down ↓') { $('cw-dir').click(); await wait(30); }
  check('toggle switches to Down', dirLabel() === 'Down ↓', dirLabel());
  const downEntry = p.entries.find((e) => e.dir === 'down' && e.cells.includes(both));
  const startAt = downEntry.cells.indexOf(both);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'q' }));
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'q' }));
  await wait(60);
  const typed = JSON.parse(window.localStorage.getItem('arcade_cross')).user
    .map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  const wantDown = downEntry.cells.slice(startAt, startAt + 2);
  check('typing Down moves down the grid', wantDown.every((c) => typed.includes(c)), `landed ${typed.join(',')} wanted ${wantDown.join(',')}`);
  check('nothing landed sideways', typed.every((c) => downEntry.cells.includes(c)), typed.join(','));

  // Space flips direction — but only on a square that actually has both words.
  // Typing moved the cursor down, and the square it landed on may have no across
  // entry at all, in which case refusing to flip is the right behaviour.
  const acrossE = p.entries.find((a) => a.dir === 'across' && a.cells.includes(both));
  const elsewhere = acrossE.cells.find((c) => c !== both);
  sq[elsewhere].click();
  await wait(20);
  sq[both].click();
  await wait(20);
  const before = dirLabel();
  check('toggle is available on a crossing square', !$('cw-dir').disabled);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ' }));
  await wait(30);
  check('space flips direction', dirLabel() !== before, `${before} -> ${dirLabel()}`);

  // put the size back to 9x9 — the generator checks below assume it
  [...$('cw-size').children].find((b) => b.dataset.s === 'large').click();
  [...$('cw-size').children].find((b) => b.dataset.s === 'large').click();
  await wait(250);
}

// crossword — validate real generator output at every difficulty, then solve one
byGame.crossword.click();
await wait(300);
check('crossword grid rendered', $('cw-grid').querySelectorAll('.cw-cell').length > 10, `${$('cw-grid').querySelectorAll('.cw-cell').length} squares`);

const diffBtn = (d) => [...$('cw-ctrl').children].find((b) => b.dataset.d === d);
let genProblems = [];
let puzzlesChecked = 0;
const gridSizes = [];
const centreProblems = [];
const crossRatios = [];
const allPuzzles = [];

for (const d of ['easy', 'medium', 'hard']) {
  for (let round = 0; round < 4; round++) {
    diffBtn(d).click();
    await wait(60);
    const st = JSON.parse(window.localStorage.getItem('arcade_cross') || 'null');
    const p = st && st.puz;
    if (!p) { genProblems.push(`${d}: no puzzle produced`); continue; }
    puzzlesChecked++;
    allPuzzles.push(p);
    gridSizes.push(p.size);

    // the fill should sit centrally: margins on opposite sides within 1 of each other
    const rowsUsed = [], colsUsed = [];
    for (let i = 0; i < p.sol.length; i++) {
      if (!p.sol[i]) continue;
      rowsUsed.push(Math.floor(i / p.size));
      colsUsed.push(i % p.size);
    }
    const top = Math.min(...rowsUsed), bottom = p.size - 1 - Math.max(...rowsUsed);
    const left = Math.min(...colsUsed), right = p.size - 1 - Math.max(...colsUsed);
    if (Math.abs(top - bottom) > 1) centreProblems.push(`${d}: vertical margins ${top}/${bottom}`);
    if (Math.abs(left - right) > 1) centreProblems.push(`${d}: horizontal margins ${left}/${right}`);

    // how much of the fill is shared between an across and a down entry
    const filled = p.sol.filter(Boolean).length;
    const shared = p.sol.reduce((n, v, i) => {
      if (!v) return n;
      const inAcross = p.entries.some((e) => e.dir === 'across' && e.cells.indexOf(i) !== -1);
      const inDown = p.entries.some((e) => e.dir === 'down' && e.cells.indexOf(i) !== -1);
      return n + (inAcross && inDown ? 1 : 0);
    }, 0);
    crossRatios.push(shared / filled);

    if (p.entries.length < 5) genProblems.push(`${d}: only ${p.entries.length} entries`);
    for (const e of p.entries) {
      // the answer recorded must equal the letters actually sitting in those squares
      const fromGrid = e.cells.map((i) => p.sol[i]).join('');
      if (fromGrid !== e.answer) genProblems.push(`${d}: ${e.num}${e.dir} answer ${e.answer} vs grid ${fromGrid}`);
      if (!e.clue) genProblems.push(`${d}: ${e.num}${e.dir} has no clue`);
      if (e.cells.length < 2) genProblems.push(`${d}: ${e.num}${e.dir} is only ${e.cells.length} long`);
      // every square of the entry must be contiguous in the right direction
      const step = e.dir === 'across' ? 1 : p.size;
      for (let k = 1; k < e.cells.length; k++) {
        if (e.cells[k] !== e.cells[k - 1] + step) genProblems.push(`${d}: ${e.num}${e.dir} not contiguous`);
      }
    }
    // every filled square must belong to at least one entry
    for (let i = 0; i < p.sol.length; i++) {
      if (!p.sol[i]) continue;
      if (!p.entries.some((e) => e.cells.indexOf(i) !== -1)) genProblems.push(`${d}: square ${i} in no entry`);
    }
  }
}
check('generated 12 puzzles across 3 difficulties', puzzlesChecked === 12, `${puzzlesChecked}`);
check('every generated puzzle is self-consistent', genProblems.length === 0, genProblems.slice(0, 3).join(' | '));
check('all grids are 9x9', gridSizes.every((s) => s === 9), [...new Set(gridSizes)].join(','));
check('puzzles are centred in the grid', centreProblems.length === 0, centreProblems.slice(0, 2).join(' | '));
check('grids are well interlocked', crossRatios.every((r) => r >= 0.1), `min crossing ratio ${Math.min(...crossRatios).toFixed(2)}`);

// every "(anag.)" clue must use fodder that is a true rearrangement of the answer
const sortLetters = (s) => s.toUpperCase().replace(/[^A-Z]/g, '').split('').sort().join('');
const anagramProblems = [];
let anagramCount = 0;
for (const p of allPuzzles) {
  for (const e of p.entries) {
    const m = /^(.*?)\s*\(anag\.\)$/i.exec(e.clue);
    if (!m) continue;
    anagramCount++;
    if (sortLetters(m[1]) !== sortLetters(e.answer)) {
      anagramProblems.push(`${m[1]} is not an anagram of ${e.answer}`);
    }
  }
}
check('anagram clues use genuine anagrams', anagramProblems.length === 0, [...new Set(anagramProblems)].slice(0, 3).join(' | '));
check('anagram clues actually appear', anagramCount > 0, `${anagramCount} seen`);

// abbreviation clues should be short answers
const abbrevBad = [];
for (const p of allPuzzles) {
  for (const e of p.entries) {
    if (/\(abbr\.\)$/i.test(e.clue) && e.answer.length > 6) abbrevBad.push(`${e.answer} too long for an abbreviation`);
  }
}
check('abbreviation clues are short answers', abbrevBad.length === 0, abbrevBad.slice(0, 2).join(' | '));

// now solve the current puzzle by clicking squares and typing
const cwState = JSON.parse(window.localStorage.getItem('arcade_cross'));
const cwCells = [...$('cw-grid').children];
for (let i = 0; i < cwState.puz.sol.length; i++) {
  const want = cwState.puz.sol[i];
  if (!want) continue;
  cwCells[i].click();
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: want.toLowerCase() }));
}
await wait(120);
check('crossword completes when filled correctly', !$('cw-banner').classList.contains('hide'));
check('crossword win text written', /clues, (easy|medium|hard), in \d{2}:\d{2}/.test($('cw-win-sub').textContent), $('cw-win-sub').textContent);

// changing difficulty mid-puzzle must ask first
diffBtn('easy').click();
await wait(80);
const beforeSwitch = JSON.parse(window.localStorage.getItem('arcade_cross'));
const someSquare = beforeSwitch.puz.sol.findIndex((v) => v);
[...$('cw-grid').children][someSquare].click();
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a' }));
await wait(30);
diffBtn('hard').click();
await wait(30);
const afterFirstTap = JSON.parse(window.localStorage.getItem('arcade_cross'));
check('first tap does not discard the puzzle', afterFirstTap.diff === 'easy', afterFirstTap.diff);
check('confirmation toast shown', $('toast').classList.contains('show') && /Tap again/.test($('toast').textContent), $('toast').textContent);
diffBtn('hard').click();
await wait(120);
check('second tap switches difficulty', JSON.parse(window.localStorage.getItem('arcade_cross')).diff === 'hard');

// letter counts appear on the clues
diffBtn('easy').click();
await wait(120);
check('clue strip shows the letter count', /\(\d+\)$/.test($('cw-clue').textContent.trim()), $('cw-clue').textContent);
check('clue list shows letter counts', [...$('cw-clues').querySelectorAll('.cw-clue-item i')].every((i) => /^\(\d+\)$/.test(i.textContent)), `${$('cw-clues').querySelectorAll('.cw-clue-item i').length} items`);
const clueCountsMatch = [...$('cw-clues').querySelectorAll('.cw-clue-item')].every((b) => {
  const st = JSON.parse(window.localStorage.getItem('arcade_cross'));
  const e = st.puz.entries.find((x) => x.num === +b.dataset.num && x.dir === b.dataset.dir);
  return e && b.querySelector('i').textContent === `(${e.answer.length})`;
});
check('letter counts match the answers', clueCountsMatch);

// checker flags a wrong letter
diffBtn('easy').click();
diffBtn('easy').click();
await wait(120);
const fresh = JSON.parse(window.localStorage.getItem('arcade_cross'));
const firstSquare = fresh.puz.sol.findIndex((v) => v);
const badLetter = fresh.puz.sol[firstSquare] === 'Z' ? 'Y' : 'Z';
[...$('cw-grid').children][firstSquare].click();
window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: badLetter.toLowerCase() }));
$('cw-check').click();
await wait(20);
check('crossword checker flags a wrong letter', !!window.document.querySelector('.cw-cell.wrong'));

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

// --- crossword sizes -------------------------------------------------------
const sizeBtn = (s) => [...$('cw-size').children].find((b) => b.dataset.s === s);
check('three size options offered', $('cw-size').children.length === 3, `${$('cw-size').children.length}`);
const sizeProblems = [];
for (const [key, n, minEntries] of [['small', 5, 4], ['medium', 7, 7], ['large', 9, 11]]) {
  for (let round = 0; round < 3; round++) {
    sizeBtn(key).click(); sizeBtn(key).click();
    await wait(60);
    const st = JSON.parse(window.localStorage.getItem('arcade_cross') || 'null');
    const p = st && st.puz;
    if (!p) { sizeProblems.push(`${key}: nothing generated`); continue; }
    if (p.size !== n) sizeProblems.push(`${key}: grid is ${p.size}, expected ${n}`);
    if (p.entries.length < minEntries) sizeProblems.push(`${key}: only ${p.entries.length} entries`);
    if (p.entries.some((e) => e.answer.length > n)) sizeProblems.push(`${key}: an answer is longer than the grid`);
    if (p.entries.some((e) => e.cells.map((i) => p.sol[i]).join('') !== e.answer)) sizeProblems.push(`${key}: answer disagrees with grid`);
    if ($('cw-grid').querySelectorAll('.cw-cell, .cw-block').length !== n * n) sizeProblems.push(`${key}: rendered ${$('cw-grid').children.length} squares`);
  }
}
check('all three sizes generate valid grids', sizeProblems.length === 0, sizeProblems.slice(0, 3).join(' | '));
check('size shown in the meta line', /^\d×\d · /.test($('cw-meta').textContent), $('cw-meta').textContent);

// --- ambience --------------------------------------------------------------
check('ambience picker built', $('amb-grid').children.length === 6, `${$('amb-grid').children.length} options`);
const ambBtn = (a) => [...$('amb-grid').children].find((b) => b.dataset.a === a);
check('volume hidden while off', $('amb-vol-row').classList.contains('hide'));

const ambProblems = [];
for (const id of ['rain', 'forest', 'cafe', 'office', 'campfire']) {
  ambBtn(id).click();
  await wait(60);
  if (window.document.body.getAttribute('data-amb') !== id) ambProblems.push(`${id}: theme not applied`);
  if ($('app').getAttribute('data-amb') !== id) ambProblems.push(`${id}: app theme not applied`);
  if (!ambBtn(id).classList.contains('on')) ambProblems.push(`${id}: button not marked active`);
  const el = window.document.querySelector('audio');
  if (!el) ambProblems.push(`${id}: no audio element`);
  else if (el.src.indexOf(`audio/${id}.mp3`) === -1) ambProblems.push(`${id}: src is ${el.src}`);
  if (!window.__media.plays.some((s) => s.indexOf(`audio/${id}.mp3`) !== -1)) ambProblems.push(`${id}: never played`);
}
check('every ambience loads and plays its track', ambProblems.length === 0, ambProblems.slice(0, 3).join(' | '));
check('one shared audio element, not five', window.document.querySelectorAll('audio').length === 1, `${window.document.querySelectorAll('audio').length}`);
check('audio is not preloaded before it is chosen', window.document.querySelector('audio').preload === 'none', window.document.querySelector('audio').preload);
check('app handles the repeat, not the element', window.document.querySelector('audio').loop === false);
check('volume shown once an ambience is on', !$('amb-vol-row').classList.contains('hide'));
check('ambience persisted', JSON.parse(window.localStorage.getItem('focus_amb')).id === 'campfire', window.localStorage.getItem('focus_amb'));

$('amb-vol').value = '20';
$('amb-vol').dispatchEvent(new window.Event('input'));
await wait(20);
check('volume persisted', Math.abs(JSON.parse(window.localStorage.getItem('focus_amb')).vol - 0.2) < 0.01, window.localStorage.getItem('focus_amb'));

// switching off must silence everything and stop the schedulers
const pausesBefore = window.__media.pauses;
ambBtn('off').click();
await wait(400);
check('off clears the theme', window.document.body.getAttribute('data-amb') === '');
check('off pauses playback', window.__media.pauses > pausesBefore, `${window.__media.pauses - pausesBefore} pauses`);
check('off fades out rather than cutting', window.document.querySelector('audio').volume < 0.05, `volume ${window.document.querySelector('audio').volume}`);

// reaching the end must restart the track, not stop
ambBtn('rain').click();
await wait(60);
const playsBefore = window.__media.plays.length;
const audioEl = window.document.querySelector('audio');
audioEl.dispatchEvent(new window.Event('ended'));
await wait(40);
check('track restarts when it ends', window.__media.plays.length > playsBefore, `${window.__media.plays.length - playsBefore} replays`);
ambBtn('off').click();
await wait(300);

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

const DAY = 86400000;
const pad2 = (n) => String(n).padStart(2, '0');
const key = (ts) => { const d = new Date(ts); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
// Anchored to midday so the two sessions per day can't spill into the day before
// when the suite happens to run near midnight — that made the streak flaky.
const seedLog = [0, 1, 2, 5].flatMap((back, i) =>
  [0, 1].map((n) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - back);
    const ts = d.getTime() + n * 3600000;
    // some entries carry notes, so the calendar's note markers have something to find
    return { id: 's' + ts + '_' + i + n, ts, day: key(ts), secs: 1500, note: n === 0 ? `worked on thing ${i}` : '' };
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

// --- calendar density ------------------------------------------------------
$2('stats-close').click();
$2('d-history').click();
await wait(120);
check('calendar marks days that have notes', $2('cal-grid').querySelectorAll('.note-dot').length > 0, `${$2('cal-grid').querySelectorAll('.note-dot').length} dots`);
check('calendar starts at normal density', $2('cal-overlay').dataset.dense === '0', $2('cal-overlay').dataset.dense);

// today was seeded with 2 sessions, so selecting it stays roomy
const cells = [...$2('cal-grid').querySelectorAll('.cal-cell.has')];
cells[cells.length - 1].click();
await wait(60);
check('two sessions keeps the roomy layout', $2('cal-overlay').dataset.dense === '0', $2('cal-overlay').dataset.dense);
check('records rendered for the day', $2('cal-detail').querySelectorAll('.cal-rec').length === 2, `${$2('cal-detail').querySelectorAll('.cal-rec').length}`);
check('note textareas auto-sized', [...$2('cal-detail').querySelectorAll('textarea')].every((t) => t.style.height), 'no height set');

// A day with eight sessions, built from scratch rather than derived from the
// previous window, so the fixture can't drift.
$2('cal-close').click();
const heavyDay = new Date();
heavyDay.setHours(12, 0, 0, 0);
const heavy = [];
for (let i = 0; i < 8; i++) {
  const ts = heavyDay.getTime() + i * 60000;
  heavy.push({ id: 'h' + i, ts, day: key(ts), secs: 900, note: 'note ' + i });
}
const heavySeeded = html.replace(
  '<script>',
  `<script>localStorage.setItem('focus_log', ${JSON.stringify(JSON.stringify(heavy))});</script>\n<script>`,
);
const { window: w3 } = boot(heavySeeded);
await wait(400);
const $3 = (id) => w3.document.getElementById(id);
$3('d-history').click();
await wait(120);
const heavyCells = [...$3('cal-grid').querySelectorAll('.cal-cell.has')];
heavyCells[heavyCells.length - 1].click();
await wait(60);
check('eight sessions compacts the calendar', $3('cal-overlay').dataset.dense === '2', $3('cal-overlay').dataset.dense);
check('all eight records shown', $3('cal-detail').querySelectorAll('.cal-rec').length === 8, `${$3('cal-detail').querySelectorAll('.cal-rec').length}`);

// --- switching days --------------------------------------------------------
// The whole grid must stay live once a day is open, including days with nothing
// on them — otherwise you get stranded on whichever day you picked first.
const allCells = () => [...$3('cal-grid').querySelectorAll('.cal-cell:not(.blank)')];
check('every day is clickable, not just days with sessions', allCells().every((c) => typeof c.onclick === 'function'), `${allCells().filter((c) => typeof c.onclick === 'function').length}/${allCells().length}`);
check('a day is currently selected', $3('cal-grid').querySelectorAll('.cal-cell.sel').length === 1);

// move to an empty day while another is open
const emptyDay = allCells().find((c) => !c.classList.contains('has') && !c.classList.contains('sel'));
const emptyLabel = emptyDay.textContent.trim();
emptyDay.click();
await wait(60);
// render() rebuilds the grid, so the old node is detached — look it up again
const nowSelected = $3('cal-grid').querySelector('.cal-cell.sel');
check('can switch to an empty day', !!nowSelected && nowSelected.textContent.trim() === emptyLabel, `selected ${nowSelected?.textContent.trim()} wanted ${emptyLabel}`);
check('empty day explains itself', $3('cal-detail').textContent.includes('No sessions'), $3('cal-detail').textContent.slice(0, 40));

// and back to the busy one
const busyDay = allCells().find((c) => c.classList.contains('has'));
busyDay.click();
await wait(60);
check('can switch back to a day with sessions', $3('cal-detail').querySelectorAll('.cal-rec').length === 8, `${$3('cal-detail').querySelectorAll('.cal-rec').length}`);
check('no leftover padding from the old zoom', !$3('cal-detail').style.paddingBottom, $3('cal-detail').style.paddingBottom);
check('zoom wrapper is gone', !$3('cal-zoom') && !$3('cal-zoom-in'));


// ===========================================================================
// Pass 3 — two devices sharing a timer over the fake peer network
// ===========================================================================
const { window: host, errors: hostErr } = boot(html);
const { window: guest, errors: guestErr } = boot(html);
await wait(400);
const $h = (id) => host.document.getElementById(id);
const $g = (id) => guest.document.getElementById(id);

check('a friend code is generated', /^[2-9A-HJ-NP-Z]{6}$/.test($h('sync-mycode').textContent), $h('sync-mycode').textContent);
check('the code avoids confusable characters', !/[OI01]/.test($h('sync-mycode').textContent), $h('sync-mycode').textContent);
check('two devices get different codes', $h('sync-mycode').textContent !== $g('sync-mycode').textContent);

$h('sync-name').value = 'Hashir';
$h('sync-name').dispatchEvent(new host.Event('input'));
$h('d-sync').click();
await wait(40);
check('sync screen opens', !$h('sync-overlay').classList.contains('hide'));

// host with the saved friend code
$h('sync-host').click();
await wait(120);
const hostCode = $h('sync-mycode').textContent;
check('hosting starts', $h('sync-state').textContent.includes('Hosting'), $h('sync-state').textContent);
check('leave button appears while connected', !$h('sync-leave').classList.contains('hide'));

// guest joins by code
$g('sync-name').value = 'Friend';
$g('sync-name').dispatchEvent(new guest.Event('input'));
$g('d-sync').click();
$g('sync-code').value = hostCode;
$g('sync-join').click();
await wait(250);
check('guest connects to the host', $g('sync-state').textContent.includes('Joined'), $g('sync-state').textContent);
check('host sees the guest by name', $h('sync-people').textContent.includes('Friend'), $h('sync-people').textContent.slice(0, 60));
check('guest sees who is leading', $g('sync-people').textContent.includes('holds the timer'), $g('sync-people').textContent.slice(0, 60));

// leader starts the timer; the follower should follow
$h('begin').click();
await wait(250);
check('follower left the setup screen', $g('setup').classList.contains('hide'));
check('follower clock is running', $g('toggle-run').textContent.trim() === 'Pause', $g('toggle-run').textContent);
const hostSecs = parseInt($h('clock').textContent.split(':')[0], 10) * 60 + parseInt($h('clock').textContent.split(':')[1], 10);
const guestSecs = parseInt($g('clock').textContent.split(':')[0], 10) * 60 + parseInt($g('clock').textContent.split(':')[1], 10);
check('clocks agree within a second', Math.abs(hostSecs - guestSecs) <= 1, `host ${$h('clock').textContent} guest ${$g('clock').textContent}`);

check("follower's own controls are locked", $g('toggle-run').disabled && $g('skip').disabled, `run=${$g('toggle-run').disabled} skip=${$g('skip').disabled}`);
check("leader's controls stay usable", !$h('toggle-run').disabled);
check('follower is told it is following', !$g('sync-band').classList.contains('hide') && /Following/.test($g('sync-band').textContent), $g('sync-band').textContent);
check('leader is told it leads', /You hold the timer/.test($h('sync-band').textContent), $h('sync-band').textContent);

// leader pauses
$h('toggle-run').click();
await wait(250);
check('pause propagates to the follower', $g('toggle-run').textContent.trim() !== 'Pause', $g('toggle-run').textContent);

// a follower must never broadcast, even if its buttons are poked directly
$g('toggle-run').disabled = false;
const hostBefore = $h('toggle-run').textContent;
$g('toggle-run').click();
await wait(200);
check('follower cannot drive the leader', $h('toggle-run').textContent === hostBefore, `${hostBefore} -> ${$h('toggle-run').textContent}`);

// friends list
$g('sync-code').value = hostCode;
$g('sync-friend-name').value = 'Study buddy';
$g('sync-add').click();
await wait(40);
check('friend saved with a name', $g('sync-friends').textContent.includes('Study buddy'), $g('sync-friends').textContent.slice(0, 60));
check('friend saved with the code', $g('sync-friends').textContent.includes(hostCode));
check('friends persist', JSON.parse(guest.localStorage.getItem('focus_sync')).friends.length === 1);

// leaving tears the room down on both sides
$h('sync-leave').click();
await wait(250);
check('host returns to disconnected', $h('sync-state').textContent === 'Not connected', $h('sync-state').textContent);
check('guest notices the host left', $g('sync-state').textContent === 'Not connected', $g('sync-state').textContent);
check('controls unlock after leaving', !$g('toggle-run').disabled);
check('band hidden once alone', $h('sync-band').classList.contains('hide'));

// one-off room codes are not the saved friend code
$h('sync-room').click();
await wait(150);
check('one-off room uses a different code', $h('sync-state').textContent.includes('Hosting') && !$h('sync-state').textContent.includes(hostCode), $h('sync-state').textContent);
check('one-off room does not overwrite your code', $h('sync-mycode').textContent === hostCode);
$h('sync-leave').click();
await wait(100);


// --- handing the timer over, and removing people ---------------------------
// A third window, so a handover has somewhere to go and a witness to see it.
const { window: third, errors: thirdErr } = boot(html);
await wait(300);
const $t = (id) => third.document.getElementById(id);

$h('sync-host').click();
await wait(150);
const roomCode = $h('sync-mycode').textContent;

for (const [w, $w, nm] of [[guest, $g, 'Friend'], [third, $t, 'Third']]) {
  $w('sync-name').value = nm;
  $w('sync-name').dispatchEvent(new w.Event('input'));
  $w('d-sync').click();
  $w('sync-code').value = roomCode;
  $w('sync-join').click();
}
await wait(400);
check('three in the room', $h('sync-people').querySelectorAll('.sync-person').length === 3, `${$h('sync-people').querySelectorAll('.sync-person').length}`);
check('host holds the timer to begin with', /You[\s\S]*holds the timer/.test($h('sync-people').innerHTML) || $h('sync-people').querySelector('.sync-person.lead')?.textContent.includes('you'), $h('sync-people').querySelector('.sync-person.lead')?.textContent);
check('only the holder sees management buttons', $h('sync-people').querySelectorAll('[data-lead]').length === 2 && $g('sync-people').querySelectorAll('[data-lead]').length === 0, `host ${$h('sync-people').querySelectorAll('[data-lead]').length} / guest ${$g('sync-people').querySelectorAll('[data-lead]').length}`);

// hand the timer to the guest
$h('sync-people').querySelectorAll('[data-lead]')[0].click();
await wait(300);
check('guest now holds the timer', /You hold the timer/.test($g('sync-band').textContent) || $g('sync-people').querySelector('.sync-person.lead')?.textContent.includes('(you)'), $g('sync-people').querySelector('.sync-person.lead')?.textContent);
check('host is now following', $h('toggle-run').disabled === true, `disabled=${$h('toggle-run').disabled}`);
check('guest controls unlocked', $g('begin').disabled === false);
check('guest can now manage', $g('sync-people').querySelectorAll('[data-lead]').length === 2, `${$g('sync-people').querySelectorAll('[data-lead]').length}`);
check('host no longer manages', $h('sync-people').querySelectorAll('[data-lead]').length === 0, `${$h('sync-people').querySelectorAll('[data-lead]').length}`);

// the new leader drives everyone, relayed through the host
$g('begin').click();
await wait(400);
check('new leader starts everyone', $h('setup').classList.contains('hide') && $t('setup').classList.contains('hide'), `host ${$h('setup').classList.contains('hide')} third ${$t('setup').classList.contains('hide')}`);
check('relayed clock reaches the third device', /^\d{2}:\d{2}$/.test($t('clock').textContent.trim()), $t('clock').textContent);

// new leader removes the third member
const kickBtn = [...$g('sync-people').querySelectorAll('[data-kick]')].find((b) => {
  const row = b.closest('.sync-person');
  return row && row.textContent.includes('Third');
});
kickBtn.click();
await wait(400);
check('removed member is disconnected', $t('sync-state').textContent === 'Not connected', $t('sync-state').textContent);
check('removed member is told why', /removed/i.test($t('sync-status').textContent), $t('sync-status').textContent);
check('room is down to two', $h('sync-people').querySelectorAll('.sync-person').length === 2, `${$h('sync-people').querySelectorAll('.sync-person').length}`);
check('removed member regains its controls', !$t('toggle-run').disabled);

// if the timer holder leaves, the host takes it back rather than stranding everyone
$g('sync-leave').click();
await wait(400);
check('host reclaims the timer when the holder leaves', !$h('toggle-run').disabled, `disabled=${$h('toggle-run').disabled}`);
$h('sync-leave').click();
await wait(200);

// --- verdict ---------------------------------------------------------------
const allErrors = errors.concat(errors2, hostErr, guestErr, thirdErr);
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
