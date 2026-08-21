  /* ---------------- merging two copies of you ----------------
     Nothing here talks to the DOM, to storage, or to a clock it was not handed.
     That is the point: this is the part that has to be *provably* right before
     any account or server exists, so it is pure functions over plain objects
     and `tools/merge-test.mjs` runs it in a few milliseconds with no jsdom.

     **Why this comes before the login screen.** Two devices both used offline
     is the normal case, not the edge case — a phone on a train and a laptop at
     home. Whatever reconciles them cannot be "last writer wins", because that
     silently eats a session and the person never finds out. So each kind of
     data gets the rule that suits its shape:

       * **Sessions are append-only with unique ids** — union the two sets and
         no conflict is possible. The only collision is the same block seen
         twice, and then the longer observation wins: a record saying forty
         minutes and one saying twelve are the same block, and one of them was
         written before it finished.

       * **Things you own or have earned are unions.** You cannot un-buy a
         theme or un-earn an achievement, so there is nothing to resolve.

       * **Settings are last-write-wins, by `at`.** Losing which clock face you
         picked is not losing anything, and pretending otherwise would mean
         asking somebody to resolve a conflict about a clock face.

       * **Embers are not merged at all.** They are *derived* from the three
         above. A number that is stored can disagree between two devices for
         ever; a number that is computed cannot. See `embersFrom`. */

  /** Seconds of focus per ember. Kept beside the maths that uses it. */
  const MERGE_PER = 600;

  /* ---- sessions ---- */
  function mergeLog(a, b){
    const by = new Map();
    const take = (r)=>{
      if(!r || !r.id) return;
      const had = by.get(r.id);
      if(!had){ by.set(r.id, r); return; }
      /* Same block, seen by two devices. The one that saw more of it is the
         later and more complete observation — a record is written while a block
         runs, so a short one is usually just an earlier snapshot of the long
         one. `at` breaks a genuine tie. */
      const better = (r.secs || 0) !== (had.secs || 0)
        ? ((r.secs || 0) > (had.secs || 0) ? r : had)
        : ((r.at || 0) > (had.at || 0) ? r : had);
      by.set(r.id, better);
    };
    (a || []).forEach(take);
    (b || []).forEach(take);
    // oldest first, which is the order everything else in the app expects
    return [...by.values()].sort((x, y)=>(x.ts || 0) - (y.ts || 0));
  }

  /* ---- things you have ---- */
  function mergeSet(a, b){
    const out = [];
    const seen = Object.create(null);
    for(const v of (a || []).concat(b || [])){
      if(typeof v !== 'string' || seen[v]) continue;
      seen[v] = 1; out.push(v);
    }
    return out;
  }

  /* Moments the board itself forgets — a promotion, a scrabble sweep. Keyed,
     and the bigger count wins, because these only ever go up. */
  function mergeFeats(a, b){
    const out = Object.assign({}, a || {});
    const other = b || {};
    for(const k in other){
      const x = Number(other[k]) || 0, had = Number(out[k]) || 0;
      out[k] = x > had ? x : had;
    }
    return out;
  }

  /* ---- lists you curate: the plan, and today's checklist ----

     Union by id, minus anything deleted. A plain union is right for adding —
     an event made on a phone must survive meeting a laptop that never saw it —
     but wrong for removing, because the other side still holds a copy and hands
     it straight back. `gone` is what makes a deletion a fact that travels
     rather than the absence of one; see the note in 14-util.js.

     Where both sides hold the same id, the *later* record wins on `at` if the
     records carry one, and otherwise the local one is kept. Calendar entries
     get edited — renamed, moved, given a repeat — and an edit is a whole record
     rather than something that can be merged field by field.

     `done` is the exception and is unioned. It is keyed by day, and ticking a
     thing off on one device while ticking a different day off on another is two
     facts, not a conflict. Losing one would un-tick something you did. */
  function mergeById(a, b, gone){
    const dead = new Set(gone || []);
    const by = new Map();
    const take = (r)=>{
      if(!r || !r.id || dead.has(r.id)) return;
      const had = by.get(r.id);
      if(!had){ by.set(r.id, r); return; }
      const win = (Number(r.at) || 0) > (Number(had.at) || 0) ? r : had;
      const lose = win === r ? had : r;
      if(win.done && typeof win.done === 'object' && lose.done && typeof lose.done === 'object'){
        by.set(r.id, Object.assign({}, win, {done: Object.assign({}, lose.done, win.done)}));
      }else{
        by.set(r.id, win);
      }
    };
    (a || []).forEach(take);
    (b || []).forEach(take);
    return [...by.values()];
  }

  /* Deletions only ever accumulate, so this is a union with a cap — the same
     cap the app writes with, newest kept. */
  function mergeGone(a, b, max){
    const out = [];
    const seen = Object.create(null);
    for(const v of (a || []).concat(b || [])){
      if(typeof v !== 'string' || seen[v]) continue;
      seen[v] = 1; out.push(v);
    }
    const cap = Number(max) || 500;
    return out.length > cap ? out.slice(-cap) : out;
  }

  /* ---- settings ---- */
  function mergeSim(a, b){
    const A = a || {}, B = b || {};
    return (Number(B.at) || 0) > (Number(A.at) || 0) ? B : A;
  }

  /* ---- embers, derived ----
     `priceOf(id)` gives what an owned thing cost; `payout(id)` gives what a
     claimed achievement paid. Both are passed in rather than reached for, so
     this file knows nothing about catalogues and the test can supply its own.

     `adjust` is the one stored number, and it exists only for history: a copy
     that has been running since before any of this was derived has a balance
     that cannot be recomputed from a log it never kept. Rather than take those
     embers away, the difference is written down once and carried. It never
     changes again. */
  function embersFrom(log, owned, claimed, feats, adjust, priceOf, payout){
    let secs = 0;
    for(const r of (log || [])) secs += Math.max(0, r && r.secs || 0);
    const fromTime = Math.floor(secs / MERGE_PER);
    let fromAch = 0;
    for(const id of (claimed || [])) fromAch += Math.max(0, payout ? (payout(id) || 0) : 0);
    let spent = 0;
    for(const id of (owned || [])) spent += Math.max(0, priceOf ? (priceOf(id) || 0) : 0);
    const earned = fromTime + fromAch + Math.max(0, Number(adjust) || 0);
    return {
      earned,
      have: Math.max(0, earned - spent),
      // what has not yet added up to a whole ember, which is also just arithmetic
      bank: secs % MERGE_PER,
      spent,
    };
  }

  /* ---- the whole thing ----
     Two snapshots in, one out. A snapshot is what a single device knows:
     `{log, own, claimed, feats, adjust, sim}`. Embers are deliberately absent
     from the output as a stored quantity — `embersFrom` is called on the merged
     result, so the balance is a consequence of the merge rather than an input
     to it. */
  function mergeSnapshots(local, remote){
    const A = local || {}, B = remote || {};
    /* Both sides' deletions, settled before either list is built — a thing
       deleted anywhere is deleted everywhere, whichever copy still holds it. */
    const gone = mergeGone(A.gone, B.gone);
    return {
      log: mergeLog(A.log, B.log),
      own: mergeSet(A.own, B.own),
      claimed: mergeSet(A.claimed, B.claimed),
      feats: mergeFeats(A.feats, B.feats),
      // the larger carried balance, so a merge can never lose history
      adjust: Math.max(Number(A.adjust) || 0, Number(B.adjust) || 0),
      plan: mergeById(A.plan, B.plan, gone),
      tasks: mergeById(A.tasks, B.tasks, gone),
      gone,
      sim: mergeSim(A.sim, B.sim),
    };
  }
