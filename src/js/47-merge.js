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

  /* ---- what a session can possibly be ----

     **The log is the only thing anybody has a reason to forge.** Embers are
     derived from it (see `embersFrom`), and so are the streak, the calendar
     and a good half of the achievements — so one line typed into `focus_log`
     from a console buys all of them at once. Nothing running on somebody's own
     machine can be stopped from writing that line: it is their machine. What
     can be arranged is that the server does not believe it.

     These are the rules a record has to survive, and they are chosen to have
     **no false positives**. Every one is something a person physically cannot
     do, not something a person is unlikely to do:

       * a block cannot run longer than `LOG_MAX`;
       * it cannot have finished in the future, allowing for a device whose
         clock is some hours out — which is ordinary, and not suspicious;
       * and one day cannot hold more than `LOG_DAY` of focus, across every
         device at once. Sixteen hours is far past anything a person does and
         still leaves room for a phone and a laptop running together, which is
         real and does overlap.

     The third is the one with teeth. Without it the first two still let a
     forged log claim every waking hour of every day it invents. */
  const LOG_SKEW = 6 * 3600 * 1000;     // a clock this far ahead is a wrong clock
  const LOG_MAX = 6 * 3600;             // seconds in one block
  const LOG_DAY = 16 * 3600;            // seconds in one day, across every device

  /** Total focus in a log, which is the number everything else is derived from. */
  function logSecs(log){
    let n = 0;
    for(const r of (log || [])) n += Math.max(0, (r && r.secs) || 0);
    return n;
  }

  /** One record, on its own terms. `at` is optional: this file reads no clock
      of its own, and a merge asked to happen without one is still a merge —
      it simply cannot ask whether a record is in the future. */
  function logPossible(r, at){
    if(!r || !r.id) return false;
    const secs = Number(r.secs) || 0;
    if(!(secs >= 0) || secs > LOG_MAX) return false;
    if(at && (Number(r.ts) || 0) > at + LOG_SKEW) return false;
    return true;
  }

  /** The whole log with the impossible taken out and each day held to its cap.

      Oldest first within a day, and the cap is reached by dropping what comes
      after: a real device wrote the early records as the day happened, and a
      batch that arrives to fill a day up is what arrives last. */
  function logSane(log, at){
    const day = Object.create(null);
    const out = [];
    for(const r of (log || []).filter(x=>logPossible(x, at))
        .slice().sort((x, y)=>(x.ts || 0) - (y.ts || 0))){
      const k = String(r.day || '');
      const secs = Math.max(0, Number(r.secs) || 0);
      const had = day[k] || 0;
      if(k && had + secs > LOG_DAY) continue;
      day[k] = had + secs;
      out.push(r);
    }
    return out.sort((x, y)=>(x.ts || 0) - (y.ts || 0));
  }

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

  /* ---- which daily puzzles you have played ----

     `{'sudoku:easy': {'2026-08-27': {s:2, t:412}}}` — a state and whatever the
     game measured. Finishing today's sudoku on a phone and only opening it on
     a laptop is one finished sudoku, not a disagreement. See 09b-daily.js. */
  function mergeDaily(a, b){
    const out = {};
    /* A day is `{s, t, g, …}` — a state and whatever numbers the game hung on
       it. Older records are a bare number and are read as `{s: n}`.

       The winner is the one that got further: higher `s`, and on a tie the one
       whose clock ran longer, which is the same argument `mergeLog` makes
       about two observations of one block. Then the loser's fields are kept
       underneath, so a device that recorded guesses and one that recorded a
       time end up with both rather than with whichever synced last. */
    const asRec = (v)=>{
      if(typeof v === 'number') return (v === 1 || v === 2) ? {s: v} : null;
      if(!v || typeof v !== 'object') return null;
      const s = v.s | 0;
      if(s !== 1 && s !== 2) return null;
      const r = {s};
      for(const k of ['t', 'g', 'w', 'c', 'n', 'h', 'm', 'd']){
        const x = Number(v[k]);
        if(isFinite(x) && x >= 0) r[k] = x;
      }
      /* The word game's grid of squares — five characters a guess.
         A string, and the only one; capped so a bad record stays small. */
      if(typeof v.p === 'string' && v.p && v.p.length <= 40) r.p = v.p;
      return r;
    };
    for(const src of [a || {}, b || {}]){
      if(!src || typeof src !== 'object') continue;
      for(const id in src){
        if(!Object.prototype.hasOwnProperty.call(src, id)) continue;
        const days = src[id];
        if(!days || typeof days !== 'object') continue;
        const into = out[id] || (out[id] = {});
        for(const k in days){
          if(!Object.prototype.hasOwnProperty.call(days, k)) continue;
          const rec = asRec(days[k]);
          if(!rec) continue;
          const had = into[k];
          if(!had){ into[k] = rec; continue; }
          const win = rec.s !== had.s ? (rec.s > had.s ? rec : had)
            : ((rec.t || 0) >= (had.t || 0) ? rec : had);
          const lose = win === rec ? had : rec;
          into[k] = Object.assign({}, lose, win);
        }
      }
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


  /* ---- saved games ----

     A board is one lump of state: half of one device's 2048 grid and half of
     another's is not a game, it is a corrupt one. So the newer save wins
     outright, the same rule settings get, and `at` is stamped by whichever
     device wrote it — see `writeGame` in 09-arcade-core.js.

     Three things are lifted out of the loser first, because they are records
     rather than positions and losing one is losing history rather than losing a
     place:

       * **The best score only ever goes up.** Beating your record on a phone
         and then playing one careless round on a laptop must not reset it.
       * **Crossword progress is a set**, keyed by a hash of each puzzle, so two
         devices working through different puzzles are not in conflict at all.
       * **Saved chess games are a shelf**, each with its own id and clock. Same
         argument; the app trims the shelf to length on its next write.

     Anything else in a save is the position, and the position travels whole. */
  function mergeGames(a, b){
    const A = a || {}, B = b || {}, out = {};
    const keys = Object.create(null);
    for(const k in A) keys[k] = 1;
    for(const k in B) keys[k] = 1;
    for(const k in keys){
      const x = A[k], y = B[k];
      if(!x || !x.v){ if(y && y.v) out[k] = y; continue; }
      if(!y || !y.v){ out[k] = x; continue; }
      const win = (Number(y.at) || 0) > (Number(x.at) || 0) ? y : x;
      const lose = win === y ? x : y;
      out[k] = { at: Number(win.at) || 0, v: mergeGameSave(k, win.v, lose.v) };
    }
    return out;
  }

  /** How far through a crossword a record is, for choosing between two of them.
      Finished beats everything; otherwise the one with more letters in it. */
  function crossFill(r){
    if(!r || typeof r.u !== 'string') return -1;
    if(r.done) return 1e9;
    let n = 0;
    for(let i=0;i<r.u.length;i++) if(r.u[i] !== '.') n++;
    return n;
  }

  function mergeGameSave(key, win, lose){
    if(!win || typeof win !== 'object' || !lose || typeof lose !== 'object') return win;
    if(key === 'arcade_2048'){
      const best = Math.max(Number(win.best) || 0, Number(lose.best) || 0,
                            Number(win.score) || 0, Number(lose.score) || 0);
      return Object.assign({}, win, {best});
    }
    if(key === 'arcade_cross'){
      const p = Object.assign({}, lose.p || {});
      const mine = win.p || {};
      for(const k in mine){
        if(!Object.prototype.hasOwnProperty.call(mine, k)) continue;
        p[k] = crossFill(mine[k]) >= crossFill(p[k]) ? mine[k] : p[k];
      }
      return Object.assign({}, win, {p});
    }
    if(key === 'focus_chess'){
      const out = Object.assign({}, lose, win);
      for(const k in out){
        if(!Object.prototype.hasOwnProperty.call(out, k)) continue;
        const mine = win[k], theirs = lose[k];
        if(mine && theirs) out[k] = (Number(theirs.at) || 0) > (Number(mine.at) || 0) ? theirs : mine;
      }
      return out;
    }
    return win;
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
     `{log, own, claimed, feats, adjust, daily, sim}`. Embers are deliberately absent
     from the output as a stored quantity — `embersFrom` is called on the merged
     result, so the balance is a consequence of the merge rather than an input
     to it. */
  /* **Friends travel with the account, but their cards do not.**

     The list is who you know; a card is what somebody handed you the last time
     you were in touch, and handing a stale one to a device that has never met
     them would be the app inventing a profile. So only the identity crosses —
     code, username, whether it is settled — and the numbers arrive the next
     time you actually meet. See 29a-friends.js.

     Union by code. Settled beats pending, because two devices disagreeing about
     whether somebody accepted should land on yes: a friendship is not undone by
     an old phone that never heard the answer. Otherwise the later `at` wins,
     and a name is kept from whichever side has one. */
  function mergeFriends(a, b){
    const A = Array.isArray(a) ? a : [], B = Array.isArray(b) ? b : [];
    const out = Object.create(null), order = [];
    for(const f of A.concat(B)){
      if(!f || typeof f !== 'object') continue;
      const code = String(f.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
      if(code.length < 4) continue;
      const one = {
        code,
        u: String(f.u || '').slice(0, 20),
        name: String(f.name || '').slice(0, 24),
        ok: f.ok ? 1 : 0,
        asked: Number(f.asked) || 0,
        at: Number(f.at) || 0,
      };
      const had = out[code];
      if(!had){ out[code] = one; order.push(code); continue; }
      const win = one.ok && !had.ok ? one
                : had.ok && !one.ok ? had
                : one.at > had.at ? one : had;
      const lose = win === one ? had : one;
      out[code] = {
        code,
        u: win.u || lose.u,
        name: win.name || lose.name,
        ok: (win.ok || lose.ok) ? 1 : 0,
        asked: Math.max(win.asked, lose.asked),
        at: Math.max(win.at, lose.at),
      };
    }
    /* Capped, because this rides in every sync and a list nobody can have is
       not worth carrying. */
    return order.slice(0, 300).map(c=>out[c]);
  }

  /* **How each day went, one emoji a day.**

     Union by day. Where two devices disagree, the one that says something wins:
     a day can hold an empty string, which means "asked, and waved away", and
     that is mostly the absence of an answer — losing a real face to it would be
     the wrong way round. See 17b-mood.js. */
  function mergeMood(a, b){
    const A = (a && typeof a === 'object') ? a : {};
    const B = (b && typeof b === 'object') ? b : {};
    const out = {};
    for(const src of [A, B]){
      for(const k in src){
        if(!Object.prototype.hasOwnProperty.call(src, k)) continue;
        if(!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
        const v = src[k];
        if(typeof v !== 'string') continue;
        if(!(k in out) || (!out[k] && v)) out[k] = v.slice(0, 8);
      }
    }
    return out;
  }

  function mergeSnapshots(local, remote, at){
    const A = local || {}, B = remote || {};
    /* Both sides' deletions, settled before either list is built — a thing
       deleted anywhere is deleted everywhere, whichever copy still holds it. */
    const gone = mergeGone(A.gone, B.gone);
    return {
      /* Sieved on the way out, not on the way in: a record that is impossible
         is impossible however many devices have passed it along, and doing it
         here means the client's copy of the balance agrees with the server's
         rather than being corrected a moment later. See logSane. */
      log: logSane(mergeLog(A.log, B.log), at),
      own: mergeSet(A.own, B.own),
      /* Grandfathered prices, unioned exactly like `own`: a device that met
         the price rise owning ten things and one that met it owning twelve
         should agree on all twelve. Dropping this key would re-charge the
         difference at the new price — see EMB_WAS in 37-embers.js. */
      grand: mergeSet(A.grand, B.grand),
      claimed: mergeSet(A.claimed, B.claimed),
      feats: mergeFeats(A.feats, B.feats),
      // the larger carried balance, so a merge can never lose history
      adjust: Math.max(Number(A.adjust) || 0, Number(B.adjust) || 0),
      plan: mergeById(A.plan, B.plan, gone),
      tasks: mergeById(A.tasks, B.tasks, gone),
      gone,
      quotes: mergeById(A.quotes, B.quotes, gone),
      games: mergeGames(A.games, B.games),
      /* Which dated puzzle you started and which you finished — see
         `mergeDaily` above and 09b-daily.js. */
      daily: mergeDaily(A.daily, B.daily),
      // who you know, without their cards — see mergeFriends above
      friends: mergeFriends(A.friends, B.friends),
      // one emoji a day — see mergeMood above
      mood: mergeMood(A.mood, B.mood),
      sim: mergeSim(A.sim, B.sim),
    };
  }
