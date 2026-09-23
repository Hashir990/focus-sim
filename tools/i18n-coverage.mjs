/* What is still in English once a language is chosen.
 *
 * Boots dist/index.html in a language, opens every screen the app has, and
 * lists the text nodes that still read as English. Latin letters in a Japanese
 * or Arabic interface are the signal: what is left is either a string nobody
 * has translated yet or something that is deliberately English — a name, a
 * crossword clue, the app's own title — and the allow-list below is the short
 * record of which is which.
 *
 *   node tools/i18n-coverage.mjs ja          one language
 *   node tools/i18n-coverage.mjs             all of them
 */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const html = readFileSync('dist/index.html', 'utf8');
const LANGS = process.argv[2] ? [process.argv[2]] : ['ja', 'zh', 'ru', 'hi', 'ur', 'ar'];

/* Deliberately English, wherever it appears. */
const FINE = [
  /^Focus Simulator$/, /^Focus$/, /^Simulator$/,            // the app's own name
  /^v?\d/, /^[\d\s:·×/%+.,-]+$/,                            // versions, numbers, clocks
  /^[A-Z]$/, /^[a-z]$/,                                     // single letters: keyboards, boards
  /^(Developer|Finish a game, move the day, unlock the shelf)$/,  // the dev row, this machine only
  /^(PeerJS|Electron|Capacitor|Cloudflare Workers|Google Fonts)$/,
  /^(CC BY|MIT|CC0|SIL)/,
];

/* The same door the smoke test splices, for the same reason: the app is one
   closure, and this has to open each game the way the shelf does. */
function withDoor(src) {
  const at = src.lastIndexOf('})();');
  return src.slice(0, at) + '\nwindow.__cov = {Arcade, dailyCalOpen};\n' + src.slice(at);
}

function boot(lang) {
  const seed = `localStorage.setItem('focus_lang','${lang}');`;
  const vc = new VirtualConsole();
  const errs = [];
  /* jsdom has no canvas; the drawing game asks for one. Not a fault here. */
  vc.on('jsdomError', (e) => { if (!/getContext/.test(e.message)) errs.push(e.message); });
  const dom = new JSDOM(withDoor(html).replace('<script>', `<script>${seed}</script>\n<script>`), {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc,
  });
  return { w: dom.window, errs };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function sweep(w) {
  const $ = (id) => w.document.getElementById(id);
  const click = (id) => { try { $(id) && $(id).click(); } catch (e) {} };
  const found = new Map();                     // text -> where it was seen

  const collect = (where) => {
    const walk = w.document.createTreeWalker(w.document.body, 4 /* SHOW_TEXT */);
    let n;
    while ((n = walk.nextNode())) {
      const el = n.parentElement;
      if (!el || el.closest('[translate="no"], script, style, textarea')) continue;
      if (el.closest('.hide')) continue;                    // not on screen
      /* An address, a link, a platform or the app's own name sitting inside an
         otherwise translated sentence is not an untranslated string. */
      const t = n.data.replace(/\s+/g, ' ')
        .replace(/[\w.+-]+@[\w.-]+/g, '').replace(/https?:\/\/\S+/g, '')
        .replace(/Focus Simulator|Spider-Man|Android|Google Fonts|PeerJS|Electron|Capacitor/g, '')
        .trim();
      if (!t || !/[A-Za-z]{2,}/.test(t)) continue;
      if (FINE.some((r) => r.test(t))) continue;
      if (!found.has(t)) found.set(t, where);
    }
  };

  collect('start');
  click('terms-agree'); await wait(60); collect('start');
  click('menu-btn'); await wait(60); collect('menu');
  for (const [open, close, where] of [
    ['d-stats', 'stats-close', 'your focus'],
    ['d-history', 'cal-close', 'history'],
    ['d-ach', 'ach-close', 'achievements'],
    ['d-quotes', 'q-back', 'quotes'],
    ['d-account', 'acct-close', 'account'],
    ['emb-spend-row', 'shop-close', 'shop'],
    ['d-sync', 'sync-close', 'focus together'],
    ['d-privacy', 'about-back', 'privacy'],
    ['d-terms', 'about-back', 'terms'],
    ['d-credits', 'about-back', 'credits'],
    ['d-report', 'about-back', 'report'],
    ['d-block', 'block-close', 'app blocking'],
  ]) {
    click('menu-btn'); await wait(40);
    click(open); await wait(140);
    collect(where);
    click(close); await wait(60);
  }
  click('chat-btn'); await wait(80); collect('chat'); click('chat-close'); await wait(40);

  /* The arcade, and every game in it. */
  click('arcade-open'); await wait(120); collect('arcade');
  const games = ['sudoku', 'wordle', 'g2048', 'tetris', 'crossword', 'picross', 'memory',
                 'hangman', 'scrabble', 'chess', 'pictionary', 'spymaster'];
  for (const g of games) {
    try { await w.__cov.Arcade.pick(g); } catch (e) { continue; }
    await wait(160);
    collect('arcade/' + g);
    try { w.__cov.dailyCalOpen(g); } catch (e) {}
    await wait(80);
    collect('calendar/' + g);
    click('dcal-close'); await wait(40);
  }
  return found;
}

let bad = 0;
for (const lang of LANGS) {
  const { w, errs } = boot(lang);
  await wait(900);
  const found = await sweep(w);
  const rows = [...found].sort((a, b) => a[1].localeCompare(b[1]));
  console.log('\n== ' + lang + ' — ' + rows.length + ' left in English'
    + (errs.length ? ' — ' + errs.length + ' errors' : ''));
  for (const [t, where] of rows) console.log('  [' + where + '] ' + t.slice(0, 100));
  if (errs.length) { console.log('  ERRORS: ' + errs.slice(0, 3).join(' | ')); bad++; }
  bad += rows.length;
  w.close();
}
process.exit(bad ? 1 : 0);
