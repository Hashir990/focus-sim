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
  return {mergeLog, mergeSet, mergeFeats, mergeSim, mergeSnapshots, embersFrom, MERGE_PER,
          mergeById, mergeGone};
`)();
const { mergeLog, mergeSet, mergeFeats, mergeSim, mergeSnapshots, embersFrom,
        mergeById, mergeGone } = api;

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
  const A = { log: [sec('s1', 600, 1, 1)], own: ['dusk'], claimed: ['first'], feats: { p: 1 }, adjust: 0, sim: { face: 'flip', at: 2 } };
  const B = { log: [sec('s2', 600, 1, 2)], own: ['beach'], claimed: [], feats: { p: 4 }, adjust: 7, sim: { face: 'glass', at: 9 } };
  const m = mergeSnapshots(A, B);
  check('every session from both sides survives', m.log.length === 2);
  check('every purchase from both sides survives', m.own.length === 2, m.own.join(','));
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

console.log('\n' + pass + '/' + (pass + fails.length) + ' merge checks passed');
if (fails.length) { fails.forEach((f) => console.log('   ' + f)); process.exit(1); }
