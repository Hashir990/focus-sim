/**
 * Merge rules test.
 *
 * `src/js/47-merge.js` is the part that has to be right before any account or
 * server exists: it decides what happens when two devices that have both been
 * used offline meet again. Getting it wrong loses somebody's afternoon and
 * never tells them, so it is pure functions over plain objects and this runs
 * them directly — no jsdom, no DOM, no clock. Well under a second.
 *
 *   node tools/merge-test.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const R = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'js');
const src = readFileSync(join(R, '47-merge.js'), 'utf8');

const api = new Function(src + `
  return {mergeLog, mergeSet, mergeFeats, mergeSim, mergeSnapshots, embersFrom, MERGE_PER, mergeDaily,
          mergeById, mergeGone, mergeGames};
`)();
const { mergeLog, mergeSet, mergeFeats, mergeSim, mergeSnapshots, embersFrom, mergeDaily,
        mergeById, mergeGone, mergeGames } = api;

let pass = 0;
const fails = [];
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log('  ok  ' + name); return; }
  fails.push(name + (detail ? ' — ' + detail : ''));
  console.log('  ✗   ' + name + (detail ? ' — ' + detail : ''));
};
const sec = (id, secs, at, ts) => ({ id, secs, at: at || 0, ts: ts || 0 });

console.log('\nsessions');
{
  const a = [sec('s1', 600, 10, 1), sec('s2', 300, 20, 2)];
  const b = [sec('s3', 900, 30, 3)];
  check('two devices keep everything both of them saw', mergeLog(a, b).length === 3);
  check('and nothing is duplicated when they overlap', mergeLog(a, a).length === 2);
  check('oldest first, whichever order they arrived in',
    mergeLog(b, a).map((r) => r.id).join(',') === 's1,s2,s3',
    mergeLog(b, a).map((r) => r.id).join(','));

  /* The same block seen twice is the case that matters. A record is written
     *while* a block runs, so the short one is an earlier snapshot of the long
     one — taking the later write would throw away most of the session. */
  const early = [sec('s9', 120, 999, 5)];        // written first, but seen briefly
  const late = [sec('s9', 2400, 1, 5)];          // written earlier, saw the whole thing
  check('the fuller observation of a block wins, not the later write',
    mergeLog(early, late)[0].secs === 2400, `${mergeLog(early, late)[0].secs}`);
  check('and a real tie falls back to whichever was written last',
    mergeLog([sec('s8', 60, 5)], [sec('s8', 60, 9)])[0].at === 9);
  check('junk without an id is dropped rather than merged',
    mergeLog([{ secs: 10 }, null], []).length === 0);
}

console.log('\nthings you have');
{
  check('owning is a union — you cannot un-buy a theme',
    mergeSet(['a', 'b'], ['b', 'c']).join(',') === 'a,b,c',
    mergeSet(['a', 'b'], ['b', 'c']).join(','));
  check('and it survives one side being empty', mergeSet(null, ['x']).join(',') === 'x');
  check('feats only ever go up',
    mergeFeats({ q: 3 }, { q: 1, z: 2 }).q === 3 && mergeFeats({ q: 3 }, { q: 1, z: 2 }).z === 2);
}

console.log('\nsettings');
{
  check('the later write wins, because a clock face is not worth a conflict',
    mergeSim({ face: 'flip', at: 5 }, { face: 'glass', at: 9 }).face === 'glass');
  check('and an unstamped record never beats a stamped one',
    mergeSim({ face: 'flip', at: 5 }, { face: 'glass' }).face === 'flip');
}

console.log('\nembers, derived rather than merged');
{
  const price = (id) => ({ dusk: 10, 'snd-rain': 15, 'face-glass': 60 }[id] || 0);
  const pays = (id) => ({ first: 1, week: 6 }[id] || 0);
  const log = [sec('a', 600), sec('b', 900)];    // 25 minutes: two whole embers, 300 over

  const d = embersFrom(log, [], [], {}, 0, price, pays);
  check('ten minutes of focus is one ember', d.earned === 2, `${d.earned}`);
  check('and the remainder is banked, not rounded up', d.bank === 300, `${d.bank}`);

  const d2 = embersFrom(log, ['dusk', 'snd-rain'], ['first'], {}, 0, price, pays);
  check('achievements add to what was earned', d2.earned === 3, `${d2.earned}`);
  check('what you own is subtracted', d2.have === 3 - 25 || d2.have === 0, `${d2.have}`);
  check('and a balance never goes below nothing', d2.have >= 0, `${d2.have}`);

  /* The property the whole thing exists for: derive twice from the same facts
     and you cannot get two answers, however the facts arrived. */
  const one = embersFrom(mergeLog(log, []), ['dusk'], ['first'], {}, 0, price, pays);
  const two = embersFrom(mergeLog([], log), ['dusk'], ['first'], {}, 0, price, pays);
  check('two devices deriving from the same merged facts agree exactly',
    one.earned === two.earned && one.have === two.have && one.bank === two.bank,
    `${JSON.stringify(one)} vs ${JSON.stringify(two)}`);

  /* And the migration: a copy from before any of this has embers with no log
     behind them. They are carried, not confiscated. */
  const carried = embersFrom([], [], [], {}, 60, price, pays);
  check('embers earned before there was a log to derive them from are kept',
    carried.earned === 60 && carried.have === 60, JSON.stringify(carried));
}

console.log('\nthe whole snapshot');
{
  const A = { log: [sec('s1', 600, 1, 1)], own: ['dusk'], grand: ['dusk'], claimed: ['first'], feats: { p: 1 }, adjust: 0,
    daily: { 'sudoku:easy': { '2026-08-20': 2, '2026-08-21': 1 } }, sim: { face: 'flip', at: 2 } };
  const B = { log: [sec('s2', 600, 1, 2)], own: ['beach'], grand: ['beach', 'dusk'], claimed: [], feats: { p: 4 }, adjust: 7,
    daily: { 'sudoku:easy': { '2026-08-21': 2 }, 'crossword:7': { '2026-08-22': 1 } }, sim: { face: 'glass', at: 9 } };
  const m = mergeSnapshots(A, B);
  check('every session from both sides survives', m.log.length === 2);
  check('every purchase from both sides survives', m.own.length === 2, m.own.join(','));
  /* **What each device was holding when the prices went up, unioned.** Two
     devices meeting the rise weeks apart hold different lists, and the one
     that met it later knows about more — so anything either of them was
     charged the old price for keeps it. Dropping this key on a merge would
     re-charge the difference at the new price and take the embers away, which
     is the whole failure `grand` exists to prevent. See EMB_WAS in
     37-embers.js. */
  /* The dated puzzles, which is two unions and a max. Started on one device
     and finished on the other is one finished puzzle. */
  check('every day either device played is on the merged calendar',
    m.daily['sudoku:easy']['2026-08-20'].s === 2
    && m.daily['crossword:7']['2026-08-22'].s === 1,
    JSON.stringify(m.daily));
  check('and finishing beats starting, whichever side did which',
    m.daily['sudoku:easy']['2026-08-21'].s === 2,
    JSON.stringify(m.daily['sudoku:easy']));

  check('what kept the old price on either device keeps it on both',
    m.grand.length === 2 && m.grand.indexOf('dusk') >= 0 && m.grand.indexOf('beach') >= 0,
    (m.grand || []).join(','));
  check('claims are unioned', m.claimed.join(',') === 'first');
  check('the larger carried balance is kept', m.adjust === 7, `${m.adjust}`);
  check('the newer settings win', m.sim.face === 'glass');
  check('and no ember total is carried across at all',
    m.have === undefined && m.earned === undefined,
    'a stored balance leaked into the merge');
  check('merging is order-independent',
    JSON.stringify(mergeSnapshots(B, A).log) === JSON.stringify(m.log),
    'A+B and B+A disagree');
  check('and merging a snapshot with itself changes nothing',
    JSON.stringify(mergeSnapshots(m, m)) === JSON.stringify(m));
}

console.log('\nthe plan and the checklist');
{
  const it = (id, text, at, done) => ({ id, text, at, done: done || {} });

  /* The point of unioning: an entry made on one device and never seen by the
     other must survive meeting it. */
  check('an entry only one side has survives',
    mergeById([it('p1', 'gym', 1)], [it('p2', 'dentist', 1)], []).length === 2);

  /* And the point of the tombstones: without them the union hands back
     everything the other copy has not heard about yet. */
  check('a deleted entry stays deleted, even though the other side still has it',
    mergeById([], [it('p1', 'gym', 1)], ['p1']).length === 0);
  check('deleting one does not take the others with it',
    mergeById([it('p1', 'gym', 1)], [it('p2', 'dentist', 1)], ['p1'])
      .map((r) => r.id).join(',') === 'p2');

  /* Edits are whole records — a renamed event is not a field-by-field merge. */
  const edited = mergeById([it('p1', 'gym', 5)], [it('p1', 'gym at six', 9)], []);
  check('the later edit of the same entry wins',
    edited.length === 1 && edited[0].text === 'gym at six', JSON.stringify(edited));

  /* Except `done`, which is keyed by day. Two devices ticking two different
     days off is two facts, and dropping either un-ticks something real. */
  const ticked = mergeById(
    [it('p1', 'gym', 5, { '2026-08-01': 1 })],
    [it('p1', 'gym', 9, { '2026-08-02': 1 })], []);
  check('but days ticked off on both devices are kept',
    ticked[0].done['2026-08-01'] === 1 && ticked[0].done['2026-08-02'] === 1,
    JSON.stringify(ticked[0].done));

  check('tombstones are unioned', mergeGone(['a'], ['b', 'a']).join(',') === 'a,b');
  check('and capped, newest kept',
    mergeGone(['a', 'b'], ['c'], 2).join(',') === 'b,c');

  /* The whole-snapshot wiring: a delete recorded on one side has to reach the
     other side's copy of the list, which only works if `gone` is merged first. */
  const A = { plan: [it('p1', 'gym', 1)], tasks: [], gone: [] };
  const B = { plan: [], tasks: [], gone: ['p1'] };
  check("one device's deletion removes the other device's copy",
    mergeSnapshots(A, B).plan.length === 0,
    JSON.stringify(mergeSnapshots(A, B).plan));
  check('and it is still gone with the sides the other way round',
    mergeSnapshots(B, A).plan.length === 0);
}

/* ---- saved games ----
   A board travels whole; a record does not travel with it. */
{
  const save = (at, v) => ({ at, v });
  const two = (a, b) => mergeGames(a, b);

  const older = { arcade_2048: save(10, { board: [2], score: 40, best: 900 }) };
  const newer = { arcade_2048: save(20, { board: [4], score: 8, best: 12 }) };
  const m = two(older, newer).arcade_2048;
  check('the newer board wins whole', JSON.stringify(m.v.board) === '[4]', JSON.stringify(m.v));
  check('but a best score is never lost to it', m.v.best === 900, `${m.v.best}`);
  check('and it does not matter which side it comes from',
    two(newer, older).arcade_2048.v.best === 900);
  check('a score standing higher than the best it was saved with counts',
    two({ arcade_2048: save(1, { score: 500 }) },
        { arcade_2048: save(2, { score: 1, best: 0 }) }).arcade_2048.v.best === 500);

  check('a game only one device has still arrives',
    !!two({}, { arcade_wordle: save(3, { answer: 'crane' }) }).arcade_wordle);
  check('and one nobody wrote is not invented',
    Object.keys(two({}, {})).length === 0);

  /* Crosswords are the case that decides the design: two devices working
     through different puzzles are not in conflict, so a newer save must not
     take the other one's finished puzzles away with it. */
  const cwA = { arcade_cross: save(5, { idx: 1, p: { aaa: { u: 'CAT', done: true } } }) };
  const cwB = { arcade_cross: save(9, { idx: 2, p: { bbb: { u: 'DOG', done: true } } }) };
  const cw = two(cwA, cwB).arcade_cross.v;
  check('a crossword keeps puzzles finished on the other device',
    !!cw.p.aaa && !!cw.p.bbb && cw.idx === 2, JSON.stringify(cw));
  check('and the further-along copy of the same puzzle is the one kept',
    two({ arcade_cross: save(5, { p: { aaa: { u: 'C..' } } }) },
        { arcade_cross: save(9, { p: { aaa: { u: '...' } } }) }).arcade_cross.v.p.aaa.u === 'C..');
  check('a finished puzzle beats a fuller unfinished one',
    two({ arcade_cross: save(9, { p: { aaa: { u: 'C..', done: true } } }) },
        { arcade_cross: save(5, { p: { aaa: { u: 'CAT' } } }) }).arcade_cross.v.p.aaa.done === true);

  const chA = { focus_chess: save(4, { g1: { at: 4, m: 'e4' } }) };
  const chB = { focus_chess: save(8, { g2: { at: 8, m: 'd4' } }) };
  const ch = two(chA, chB).focus_chess.v;
  check('saved chess games are a shelf, not a slot', !!ch.g1 && !!ch.g2, JSON.stringify(ch));

  check('merging a snapshot with itself changes nothing',
    JSON.stringify(mergeSnapshots({ games: cwA }, { games: cwA }).games)
    === JSON.stringify(mergeSnapshots(mergeSnapshots({ games: cwA }, { games: cwA }),
                                      { games: cwA }).games));
}

/* ---- your own quotes ----
   They ride on ids now (see `quoteId`), which is what lets a deletion travel. */
{
  const q = (id, t) => ({ id, t, a: '' });
  const A = { quotes: [q('q1', 'one')], gone: [] };
  const B = { quotes: [q('q2', 'two')], gone: [] };
  check('quotes written on two devices are both kept',
    mergeSnapshots(A, B).quotes.length === 2, JSON.stringify(mergeSnapshots(A, B).quotes));
  const del = { quotes: [], gone: ['q1'] };
  check('and one deleted anywhere is deleted everywhere',
    mergeSnapshots(A, del).quotes.length === 0
    && mergeSnapshots(del, A).quotes.length === 0);
}

console.log('\n' + pass + '/' + (pass + fails.length) + ' merge checks passed');
if (fails.length) { fails.forEach((f) => console.log('   ' + f)); process.exit(1); }
