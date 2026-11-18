/* What an account's ember balance derives to, and from what.
 *
 *   node tools/embers-audit.mjs <store.json>
 *
 * store.json is a dump of the saved keys -- at minimum focus_embers and
 * focus_log. For the installed desktop app those live in the Local Storage
 * leveldb inside the app folder under APPDATA. Copy that folder before
 * reading it: Chromium compacts a leveldb when it opens one, and the saved
 * data of somebody reporting a bug is the last thing to go writing to.
 *
 * The balance is derived, never stored: have = earned - SUM(price of each
 * owned thing). So "my embers went to zero" is almost never embers being
 * taken away; it is the priced spend overtaking what the log can account
 * for, and the only way to see which is to price the list item by item.
 * That is what this prints.
 *
 * Run against the real saved keys, through the app's own code: the build is
 * loaded under jsdom with a door spliced at the last `})();`, the keys are
 * seeded before it boots, and `Embers.reconcile()` is the thing asked. A
 * reimplementation here would only prove that two of my arithmetic agree. */
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const store = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const html = readFileSync('dist/index.html', 'utf8')
  .replace(/const ACC_URL = '[^']*'/, "const ACC_URL = ''");

const at = html.lastIndexOf('})();');
const door = `
window.__e = {
  Embers,
  embWas: (typeof embWas === 'function') ? embWas : null,
  priced: () => Embers.own.map((id) => [id, Embers.paidFor(id)]),
  get log(){ return LOG; },
  per: EMB_PER,
};
`;
const page = html.slice(0, at) + door + html.slice(at);

const vc = new VirtualConsole();
const errs = [];
vc.on('jsdomError', (e) => errs.push(e.message));

const dom = new JSDOM(page, {
  runScripts: 'dangerously', pretendToBeVisual: true,
  url: 'https://localhost/', virtualConsole: vc,
  beforeParse(w) {
    for (const [k, v] of Object.entries(store)) {
      if (k === '__allKeys' || v == null) continue;
      try { w.localStorage.setItem(k, v); } catch (e) {}
    }
  },
});

await new Promise((r) => setTimeout(r, 1500));
const E = dom.window.__e;
if (!E) { console.log('no door; jsdom errors:\n' + errs.slice(0, 3).join('\n')); process.exit(1); }

const emb = JSON.parse(store.focus_embers);
const log = E.log || [];
let secs = 0;
for (const r of log) secs += Math.max(0, (r && r.secs) || 0);

console.log('--- what is saved -------------------------------------------');
console.log('  stored have    ', emb.have);
console.log('  stored earned  ', emb.earned);
console.log('  stored adjust  ', emb.adjust);
console.log('  own            ', (emb.own || []).length, 'things');
console.log('  grand          ', (emb.grand || []).length, 'entries',
  (emb.grand || []).includes('@bud-rise') ? '(met the wardrobe rise)' : '(has NOT met the wardrobe rise)');
console.log('');
console.log('--- what it derives to --------------------------------------');
console.log('  log            ', log.length, 'rows,', secs, 'seconds =',
  Math.floor(secs / E.per), 'embers of time');
E.Embers.reconcile();
console.log('  derived earned ', E.Embers.earned);
console.log('  derived have   ', E.Embers.have);

const priced = E.priced().filter((p) => p[1] > 0).sort((a, b) => b[1] - a[1]);
const spent = priced.reduce((n, p) => n + p[1], 0);
console.log('  priced spend   ', spent, 'over', priced.length, 'owned things');
console.log('');
console.log('--- the dearest things it is charging for -------------------');
for (const [id, cost] of priced.slice(0, 14)) console.log('  ' + String(cost).padStart(5) + '  ' + id);
console.log('');
console.log(E.Embers.have === 0 && E.Embers.earned > 0
  ? '>>> the balance floors at zero: spend ' + spent + ' against earned ' + E.Embers.earned
    + ' — short by ' + (spent - E.Embers.earned)
  : '>>> balance is ' + E.Embers.have);
if (errs.length) console.log('\njsdom errors: ' + errs.slice(0, 2).join(' | '));
