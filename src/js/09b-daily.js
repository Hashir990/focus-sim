  /* ================================================================
     ONE A DAY
     ================================================================

     **Every puzzle in the arcade is now a dated edition.** Sudoku at each of
     its three difficulties, Wordle, Memory and the four crossword sizes each
     get one new puzzle a day, the same puzzle for everybody, and the day turns
     over at midnight in Pakistan.

     Three ideas carry the whole thing, and they are worth reading before
     changing any of it.

     **1. A day is a string, not a Date.**  `pktDay(ts)` is `YYYY-MM-DD` in
     Pakistan Standard Time. PKT is UTC+5 all year — the country has no
     daylight saving — so the whole timezone question is one added constant and
     needs no database, no `Intl`, and no correctness worry in June. Everything
     downstream keys off that string: what today's puzzle is, what the calendar
     draws, what counts as played. A device in London and a device in Karachi
     agree on the string, so they agree on the puzzle.

     **2. A puzzle is derived from its day, not stored.**  Sudoku, Wordle and
     Memory are *generated*, and they used `Math.random()` — which is exactly
     why two people never saw the same board. They take a seeded generator
     now: `dailyRng(dailySeed(game, difficulty, day))`. Same three strings, same
     stream of numbers, same puzzle, on every device, for ever, with nothing
     shipped and nothing synced. The crossword is different because its puzzles
     are hand-made and live in a bank; it gets a *schedule* instead — see
     `crossOnDay` below.

     **3. What is stored is only what you did.**  `DAILY` is one small record:
     for each game-and-difficulty, what happened on each day — whether you
     started or finished it, and how. That is what colours the calendar and
     what fills in the numbers under it, and it is all that has to travel
     between devices. The boards themselves stay where they always were, in
     each game's own save.

     **The archive is open.** One *new* puzzle a day is the rule; going back to
     an older one you never finished is not cheating, it is the whole point of
     keeping a calendar. So the day's puzzle is offered once and the past is
     always playable. Only today is rationed.

     Not everything in the arcade is a daily. 2048 is endless and has no
     puzzle to date; chess, scrabble and pictionary are played against somebody
     rather than against a grid. Those keep working exactly as they did. */

  /* Pakistan Standard Time, which never moves. Adding this to a UTC timestamp
     and reading the date off the result is the entire timezone handling in
     this file, and it is correct on every day of the year. */
  const PKT_MS = 5 * 3600 * 1000;
  const PKT_DAY_MS = 86400000;

  /** The Pakistani date of an instant, as `YYYY-MM-DD`. */
  function pktDay(ts){
    const t = (typeof ts === 'number' && isFinite(ts)) ? ts : Date.now();
    return new Date(t + PKT_MS).toISOString().slice(0, 10);
  }
  /** Today, in Pakistan. The one everything defaults to.

      **Shiftable, and only from the developer page.** A daily puzzle is the one
      thing that cannot be tested by playing it: tomorrow's crossword is a day
      away, and a streak is a fortnight. `DAILY_SHIFT` moves what the whole app
      calls today, so every daily — the puzzle, the calendar, the streak, the
      mood prompt — moves together and nothing has to be faked one piece at a
      time. It is zero in any build without the developer stamp, because nothing
      can reach `dailyShift` to set it (42-dev.js). */
  let DAILY_SHIFT = 0;
  function dailyShift(days){
    if(typeof days === 'number' && isFinite(days)) DAILY_SHIFT = Math.max(-3650, Math.min(3650, Math.round(days)));
    return DAILY_SHIFT;
  }
  function pktNow(){ return pktDay(Date.now() + DAILY_SHIFT * 86400000); }
  /** A day string as a count of days, so two of them can be compared or spanned. */
  function pktNum(key){
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if(!m) return 0;
    return Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / PKT_DAY_MS);
  }
  /** And back again. */
  function pktAt(n){ return new Date(n * PKT_DAY_MS).toISOString().slice(0, 10); }
  /** 0 = Sunday. 1970-01-01 was a Thursday, which is where the 4 comes from. */
  function pktDow(key){ return ((pktNum(key) + 4) % 7 + 7) % 7; }
  /** `Aug 27`, for a heading. */
  const PKT_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  function pktLabel(key){
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if(!m) return String(key || '');
    if(LANG !== 'en'){
      try{ return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString(langLocale(), {month:'short', day:'numeric', timeZone:'UTC'}); }catch(e){}
    }
    return PKT_MON[+m[2] - 1] + ' ' + (+m[3]);
  }
  /** `Sep 2026`, for a month's heading, in the reader's own language. */
  function pktMonthLabel(y, m){
    if(LANG !== 'en'){
      try{ return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(langLocale(), {month:'long', year:'numeric', timeZone:'UTC'}); }catch(e){}
    }
    return PKT_MON[m - 1] + ' ' + y;
  }
  /** Milliseconds until the next Pakistani midnight — never 0, always a wait. */
  function pktUntilRoll(ts){
    const t = ((typeof ts === 'number' && isFinite(ts)) ? ts : Date.now()) + PKT_MS;
    const into = ((t % PKT_DAY_MS) + PKT_DAY_MS) % PKT_DAY_MS;
    return PKT_DAY_MS - into;
  }

  /* ---------------- the same puzzle for everybody ----------------

     FNV-1a over the three strings, then mulberry32. Neither is cryptography
     and neither needs to be: what they have to be is *identical everywhere*,
     which rules out `Math.random`, anything seeded from the clock, and
     anything that depends on how a particular engine orders a hash map. These
     are integer arithmetic on 32 bits and give the same stream in every
     browser there is. */
  function dailyHash(str){
    let h = 2166136261 >>> 0;
    const s = String(str);
    for(let i = 0; i < s.length; i++){
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  /** A generator, not a number: call it for the next value in [0, 1). */
  function dailyRng(seed){
    let a = (seed >>> 0) || 1;
    return function(){
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  /** The seed for one edition. Change this string and every past puzzle changes. */
  function dailySeed(game, diff, day){
    return dailyHash(String(game) + '|' + String(diff || '') + '|' + String(day || ''));
  }
  /** The generator for one edition, which is what the games actually want. */
  function dailyGen(game, diff, day){ return dailyRng(dailySeed(game, diff, day)); }

  /* ---------------- what you have played ----------------

     One record for the whole arcade:

       {'sudoku:easy': {'2026-08-27': {s:2, t:412}}}

     `s` is 1 for started and 2 for finished; everything beside it is what
     happened — seconds taken, guesses used, clues filled, letters revealed.
     One-letter keys because this is written on every board change and carried
     in every account sync, and a year of it should stay a few kilobytes.

     **It used to be a bare number**, and records written then still are; they
     are read as `{s: n}` on the way in. Nothing has to be migrated, because
     nothing is stored that cannot be re-derived except the stats themselves,
     and an old day simply has none.

     Days are never pruned. The calendar *is* the feature; throwing away its
     contents to save a few kilobytes would be a bad trade. */
  const DAILY_KEY = 'focus_daily';
  const DAILY_STARTED = 1;
  const DAILY_DONE = 2;
  let DAILY = Object.create(null);

  function dailyId(game, diff){ return String(game) + ':' + String(diff == null ? '' : diff); }

  /* The numbers a game may hang on a day. Anything not in here is dropped on
     the way in, which is what stops one game's typo becoming everybody's
     storage. `t` seconds, `g` guesses, `w` won, `c` clues filled, `n` clues in
     the puzzle, `h` letters revealed, `m` moves. */
  const DAILY_STATS = ['t', 'g', 'w', 'c', 'n', 'h', 'm', 'd'];
  /* One string, and it earns its place: `p` is the word game's grid of squares
     — five characters a guess, `g` green, `y` yellow, `x` grey — which is the
     picture of how the puzzle went and cannot be reconstructed from a count.
     Capped at exactly six guesses of five squares, so a corrupt record cannot
     become a large one and cannot describe a game longer than the game is. */
  const DAILY_TEXT = {p: 30};
  /** A stored day, in whichever shape it was written. */
  function dailyRec(v){
    if(typeof v === 'number') return (v === DAILY_STARTED || v === DAILY_DONE) ? {s: v} : null;
    if(!v || typeof v !== 'object') return null;
    const st = v.s | 0;
    if(st !== DAILY_STARTED && st !== DAILY_DONE) return null;
    const out = {s: st};
    for(const k of DAILY_STATS){
      const n = Number(v[k]);
      if(isFinite(n) && n >= 0) out[k] = n;
    }
    for(const k in DAILY_TEXT){
      const t = v[k];
      if(typeof t === 'string' && t && t.length <= DAILY_TEXT[k]) out[k] = t;
    }
    return out;
  }

  async function dailyLoad(){
    try{
      const r = await KV.get(DAILY_KEY);
      if(r && r.value){
        const d = JSON.parse(r.value);
        if(d && typeof d === 'object') DAILY = dailyClean(d);
      }
    }catch(e){}
  }
  /** Anything that is not `{id: {day: 1|2}}` is dropped rather than trusted. */
  function dailyClean(d){
    const out = Object.create(null);
    for(const id in d){
      if(!Object.prototype.hasOwnProperty.call(d, id)) continue;
      const days = d[id];
      if(!days || typeof days !== 'object') continue;
      const keep = Object.create(null);
      let any = false;
      for(const k in days){
        if(!Object.prototype.hasOwnProperty.call(days, k)) continue;
        if(!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
        const rec = dailyRec(days[k]);
        if(!rec) continue;
        keep[k] = rec; any = true;
      }
      if(any) out[id] = keep;
    }
    return out;
  }
  function dailySave(){
    try{ KV.set(DAILY_KEY, JSON.stringify(DAILY)); }catch(e){}
  }
  /** Everything known about one day, or null. */
  function dailyGet(game, diff, day){
    const rec = DAILY[dailyId(game, diff)];
    return (rec && dailyRec(rec[day || pktNow()])) || null;
  }
  /** 0 not touched, 1 started, 2 finished. */
  function dailyState(game, diff, day){
    const r = dailyGet(game, diff, day);
    return r ? r.s : 0;
  }
  /** **The state only ever goes forward; the numbers always land.**
      A game re-entered to look at a finished board must not un-finish it, so
      `s` is a maximum. The stats are not — a clock that has run another ten
      seconds is a better answer than the one before it, and a puzzle finished
      after being started needs its time written even though `s` is already as
      high as it goes. */
  function dailyMark(game, diff, day, state, stats){
    const id = dailyId(game, diff), k = day || pktNow(), n = state | 0;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
    if(n !== DAILY_STARTED && n !== DAILY_DONE) return;
    const rec = DAILY[id] || (DAILY[id] = Object.create(null));
    const had = dailyRec(rec[k]);
    /* **A finished day is finished, and the first result is the result.**
       "Look again" hands the board back so you can see how it went, and every
       key you press on it used to overwrite the record — a word solved in
       three, opened again and abandoned, became a miss, and the grid people
       screenshot became whatever you last typed. One puzzle, one score. The
       live board is still yours to play with; it just no longer counts. */
    if(had && had.s === DAILY_DONE) return;
    const next = Object.assign({}, had || {}, dailyRec(Object.assign({s: n}, stats || {})) || {});
    next.s = Math.max(had ? had.s : 0, n);
    /* Nothing changed, so nothing is written or synced — this is called from
       the clock tick and from every keystroke. */
    /* **Finished, and finished *on the day*, are two different facts.** A
       streak is about turning up, so it counts only the puzzles solved on the
       day they came out; going back through the archive a week later is worth
       doing and is not a streak. The flag is set here rather than by the games
       because here is the only place that knows both the day the puzzle is
       from and the day it is now. */
    if(n === DAILY_DONE && k === pktNow()) next.d = 1;
    if(had && DAILY_STATS.every(x=>had[x] === next[x])
       && Object.keys(DAILY_TEXT).every(x=>had[x] === next[x]) && had.s === next.s) return;
    rec[k] = next;
    dailySave();
    try{ Account.sync(true); }catch(e){}
  }
  /* **The streak: release days in a row, each solved on the day.**

     Walked backwards from today over the days this game actually publishes —
     which matters for the crossword, where a 9×9 comes out on Wednesday and
     Friday and the days between are not misses. Today is a grace day: a streak
     does not break because it is four in the afternoon and you have not sat
     down yet. Yesterday missing does break it.

     `on(day)` is the game's own "does this come out today", so a size that
     publishes twice a week is judged on its own two days. */
  /** **A day counts when the whole day is done.**

      `diffs` is one edition key or a list of them. With a list, the day is only
      a streak day when *every* edition published that day was finished on it —
      all three sudokus, or whichever crosswords came out (two on a Tuesday,
      three on a Wednesday, and the fifteen as well on a Sunday). Doing the easy
      one and walking away is a puzzle solved; it is not a day cleared.

      Returns `{runs, done}`: `runs` false means the game published nothing that
      day, which is not a miss and is skipped rather than counted. */
  function dailyDay(game, diffs, on, day){
    const list = Array.isArray(diffs) ? diffs : [diffs];
    let runs = false, done = true;
    for(const k of list){
      if(on && !on(day, k)) continue;
      runs = true;
      const rec = DAILY[dailyId(game, k)] || {};
      const r = dailyRec(rec[day]);
      if(!(r && r.d)) done = false;
    }
    return {runs, done: runs && done};
  }
  /** How many of the editions published that day are finished, `[done, of]`. */
  function dailyDayCount(game, diffs, on, day){
    const list = Array.isArray(diffs) ? diffs : [diffs];
    let of = 0, done = 0;
    for(const k of list){
      if(on && !on(day, k)) continue;
      of++;
      const rec = DAILY[dailyId(game, k)] || {};
      const r = dailyRec(rec[day]);
      if(r && r.d) done++;
    }
    return [done, of];
  }
  function dailyStreak(game, diffs, on){
    let n = 0, day = pktNow(), first = true, guard = 0;
    while(day >= DAILY_EPOCH && guard++ < 800){
      const st = dailyDay(game, diffs, on, day);
      if(st.runs){
        if(st.done) n++;
        else if(!first) break;
        first = false;
      }
      day = pktAt(pktNum(day) - 1);
    }
    return n;
  }
  /** This game's streak, on whatever editions and schedule it registered.
      One place, so the game screen, the calendar and a friend's profile cannot
      disagree about a number the person is being asked to care about. */
  function dailyStreakOf(game){
    const def = dailyDef(game);
    if(!def) return 0;
    return dailyStreak(game, (def.diffs || [{k:''}]).map(d=>d.k), def.on);
  }
  /** Paint the fire chip on a game screen. Hidden at zero — "0 in a row" is
      not encouragement, it is a scoreboard for not having played. */
  function dailyStreakPaint(id, game){
    const el = $(id);
    if(!el) return;
    const n = dailyStreakOf(game);
    el.classList.toggle('hide', n < 1);
    if(n < 1) return;
    el.textContent = '\uD83D\uDD25 ' + n;
    el.title = Tn('{n} day in a row', '{n} days in a row', n);
  }
  /** The best run there has ever been, on the same rule. */
  function dailyBestStreak(game, diffs, on){
    let best = 0, run = 0, day = DAILY_EPOCH, guard = 0;
    const today = pktNow();
    while(day <= today && guard++ < 800){
      const st = dailyDay(game, diffs, on, day);
      if(st.runs){
        if(st.done){ run++; if(run > best) best = run; }
        else if(day !== today) run = 0;
      }
      day = pktAt(pktNum(day) + 1);
    }
    return best;
  }

  /** Every day recorded for one game and difficulty, oldest first:
      `[{day, ...rec}]`. What the calendar's numbers are worked out from. */
  function dailyAll(game, diff){
    const rec = DAILY[dailyId(game, diff)] || {};
    const out = [];
    for(const k in rec){
      if(!Object.prototype.hasOwnProperty.call(rec, k)) continue;
      const r = dailyRec(rec[k]);
      if(r) out.push(Object.assign({day: k}, r));
    }
    return out.sort((a, b)=>a.day < b.day ? -1 : 1);
  }
  /** Today's edition is spent once it is finished. Started is not spent — you
      may put a board down and come back to it in the same day. */
  function dailyPlayed(game, diff, day){
    return dailyState(game, diff, day || pktNow()) === DAILY_DONE;
  }
  /** Every day this game has anything recorded against it, newest first. */
  function dailyDays(game, diffs){
    const seen = Object.create(null);
    for(const d of (diffs && diffs.length ? diffs : [''])){
      const rec = DAILY[dailyId(game, d)];
      for(const k in rec) if(Object.prototype.hasOwnProperty.call(rec, k)) seen[k] = 1;
    }
    return Object.keys(seen).sort().reverse();
  }

  /* What the account carries, and how two devices agree.
     The higher state wins for every day either of them knows about: finishing
     a puzzle on a phone and starting it on a laptop is one finished puzzle,
     not a disagreement. Union, then max — the same shape as `own`. */
  function dailySnapshot(){ return DAILY; }
  /* **`mergeDaily`, not `dailyMerge`.** The rule lives in 47-merge.js beside
     every other merge and is named the other way round; this called a function
     that does not exist, and its one caller in 48-account.js wraps it in a
     `try/catch`, so signing in on a second device dropped the whole puzzle
     calendar without a word. Nothing to see, nothing logged, streaks simply
     absent. The smoke test now goes through this path rather than writing the
     record by hand, which is what found it. */
  function dailyAdopt(d){
    if(!d || typeof d !== 'object') return;
    DAILY = mergeDaily(DAILY, dailyClean(d));
    dailySave();
    try{ if(Arcade.open) Arcade._refresh(); }catch(e){}
  }
  function dailyWipe(){
    DAILY = Object.create(null);
    try{ KV.del(DAILY_KEY); }catch(e){}
  }

  /* ---------------- the crossword's own schedule ----------------

     The other games make a puzzle out of a number, so they can have one for
     any day there will ever be. The crossword's are hand-written and come out
     of a bank, so it gets a release calendar instead: two sizes every day, the
     nines twice a week, the fifteens on Sundays — which is roughly how a
     newspaper does it, and for the same reason, that a fifteen is an evening's
     work and a five is a bus stop.

     **The rule that keeps it honest: the bank is append-only.** A puzzle's
     release date is its position in the list for its size, counted from the
     epoch. Insert one in the middle and every date after it shifts, which
     would rewrite history and orphan every saved board. New puzzles go on the
     end. `tools/smoke-test.mjs` checks that the first few dates have not
     moved.

     **And when the bank runs dry**, the schedule keeps going: the day gets an
     encore of an earlier puzzle rather than nothing at all. Everybody still
     gets the same one, the calendar says what it is, and the day quietly
     becomes a fresh puzzle once the bank has grown past it. A day with no
     crossword at all would be the worse answer. */
  /* **The first day any of this existed.** Sudoku and Wordle can make a puzzle
     out of any date there has ever been, which is not a reason to offer one
     for a Tuesday in 1997: a back catalogue that runs to the beginning of time
     is not a catalogue. Every game's calendar starts here, and the crossword's
     release schedule is counted from here too. */
  const DAILY_EPOCH = '2026-08-17';
  const CROSS_EPOCH = DAILY_EPOCH;
  /* '*' is every day; digits are weekdays with 0 = Sunday.

     **A week with a shape.** The 5s and the 7s both used to come out every day,
     which made two thirds of the week the same two grids and left the 9 as an
     occasional visitor on a Wednesday. Now the small and the big one take turns
     — 5s on Tuesday, Thursday and Saturday, 9s on Monday, Wednesday and Friday
     — the 7 still comes every day so no day is empty, and Sunday is the 15 on
     its own. Three a week each rather than seven and two.

     **Changing this moves every release date for those two sizes**, because a
     date is a position counted from the epoch through this table (see
     `crossReleaseNo`). That is the intended effect — the bank is untouched and
     is still in its original order — but a 5×5 that was Wednesday's is now
     some other day's, so a part-finished grid is found through History rather
     than where it used to sit on the calendar. Nothing is lost: progress is
     keyed by the grid's own fingerprint, not by its date. */
  const CROSS_WHEN = {5:'246', 7:'*', 9:'135', 15:'0'};
  const CROSS_SIZES = [5, 7, 9, 15];

  /** Does a puzzle of this size come out on this day? */
  function crossReleases(size, day){
    const when = CROSS_WHEN[size];
    if(!when) return false;
    if(pktNum(day) < pktNum(CROSS_EPOCH)) return false;
    return when === '*' || when.indexOf(String(pktDow(day))) >= 0;
  }
  /** Which release this is, counting from the epoch. -1 when nothing comes out.

      Closed form rather than a loop: each weekday in the set contributes one
      every seven days from its first occurrence on or after the epoch. A loop
      would be fine today and quadratic in five years. */
  function crossReleaseNo(size, day){
    if(!crossReleases(size, day)) return -1;
    const n0 = pktNum(CROSS_EPOCH), n = pktNum(day);
    const when = CROSS_WHEN[size];
    if(when === '*') return n - n0;
    let count = 0;
    for(const ch of when){
      const w = +ch;
      const first = n0 + (((w - pktDow(CROSS_EPOCH)) % 7) + 7) % 7;
      if(first <= n) count += Math.floor((n - first) / 7) + 1;
    }
    return count - 1;
  }
  /** The day a given release of a size comes out — the inverse of the above. */
  function crossReleaseDay(size, no){
    const when = CROSS_WHEN[size];
    if(!when || no < 0) return '';
    const n0 = pktNum(CROSS_EPOCH);
    if(when === '*') return pktAt(n0 + no);
    /* A handful of steps: walk forward day by day until the count matches.
       Bounded by 7 * (no + 1), which for any real archive is small. */
    let seen = -1;
    for(let n = n0; n <= n0 + 7 * (no + 1) + 7; n++){
      const k = pktAt(n);
      if(crossReleases(size, k)){ seen++; if(seen === no) return k; }
    }
    return '';
  }
  /** The last day a size came out, on or before `from`. '' if there is none.

      With the 5s and the 9s on three days each, "today's 5×5" is a question
      with no answer four days a week — so the front door for a size is its most
      recent edition, which on the days it does run is today's. A week is a
      hard bound: every size in the table comes out at least once in one. */
  function crossLatestDay(size, from){
    let n = pktNum(from || pktNow());
    for(let i = 0; i < 8; i++, n--){
      const k = pktAt(n);
      if(k < CROSS_EPOCH) break;
      if(crossReleases(size, k)) return k;
    }
    return '';
  }
  /** The bank index of the crossword published on a day, or -1.
      `encore` says the bank had not caught up and an earlier one was reissued. */
  function crossOnDay(size, day){
    const no = crossReleaseNo(size, day);
    if(no < 0) return {i:-1, no:-1, encore:false};
    let list = [];
    try{ list = crossAtSize(size) || []; }catch(e){}
    if(!list.length) return {i:-1, no:no, encore:false};
    const encore = no >= list.length;
    return {i: list[no % list.length], no: no, encore: encore};
  }
  /** Every day of this size that has been released up to `day`, newest first. */
  function crossDaysUpTo(size, day, cap){
    const out = [];
    const n = pktNum(day || pktNow()), n0 = pktNum(CROSS_EPOCH);
    for(let d = n; d >= n0 && out.length < (cap || 400); d--){
      const k = pktAt(d);
      if(crossReleases(size, k)) out.push(k);
    }
    return out;
  }

  /* ---------------- the roll ----------------

     **Built in, as asked, rather than noticed on the next open.** A timer set
     for the next Pakistani midnight; when it fires, anything on screen that
     shows a day redraws itself and the next timer is set. Rescheduled rather
     than run on an interval so it cannot drift, and re-armed on `visibilitychange`
     because a phone that slept through midnight never fired it.

     Nothing is *reset* at the roll. The old day's board stays saved and stays
     in the calendar; what changes is which day is "today", and therefore which
     puzzle a game hands you when you next ask for a new one. */
  let dailyRollT = null;
  let dailyRollDay = '';
  const DAILY_ROLL_WATCH = [];
  /** Something that should redraw when the date changes. */
  function onDailyRoll(fn){ if(typeof fn === 'function') DAILY_ROLL_WATCH.push(fn); }

  function dailyRollArm(){
    clearTimeout(dailyRollT);
    if(!dailyRollDay) dailyRollDay = pktNow();
    /* A second past midnight, so the timer never fires on the wrong side of
       it through rounding, and capped so a month-long sleep still wakes up. */
    const wait = Math.min(pktUntilRoll(Date.now()) + 1000, 6 * 3600 * 1000);
    dailyRollT = setTimeout(dailyRollCheck, wait);
  }
  function dailyRollCheck(){
    const now = pktNow();
    if(now !== dailyRollDay){
      dailyRollDay = now;
      for(const fn of DAILY_ROLL_WATCH){ try{ fn(now); }catch(e){} }
      try{ if(Arcade.open) Arcade._refresh(); }catch(e){}
    }
    dailyRollArm();
  }
  function dailyRollStart(){
    dailyRollDay = pktNow();
    dailyRollArm();
    try{
      document.addEventListener('visibilitychange', ()=>{
        if(!document.hidden) dailyRollCheck();
      });
    }catch(e){}
  }

  /* ---------------- the games that have editions ----------------

     One entry per game, registered from the game's own file so this list is
     never the thing you forget to update. `diffs` is what the calendar draws a
     dot for; an empty label is a game with only one puzzle a day.

     `open(day, diff)` is how the calendar plays an older one: the game loads
     that edition and shows it. */
  const DAILIES = {};
  function registerDaily(id, def){ DAILIES[id] = Object.assign({id}, def); }
  function dailyDef(id){ return DAILIES[id] || null; }

  /* ================================================================
     THE CALENDAR
     ================================================================

     One overlay for every game, because a calendar of sudoku and a calendar of
     crosswords differ only in how many dots a day has and what they are
     called. `dailyCalOpen('sudoku')` fills in `#dcal-overlay`; the markup is
     src/body/17-daily-cal.html.

     **A dot says two things at once.** Its colour is the difficulty — easy,
     medium and hard are three colours, and the four crossword sizes are four —
     and how it is filled is how far you got: a faint ring for a day you never
     opened, a bright ring for one you started, a solid disc for one you
     finished. That is the whole legend, and it is drawn above the grid so
     nobody has to work it out.

     Days with no edition get no dot rather than an empty one. Only the
     crossword has any — a Tuesday has no 9×9 because none is published on a
     Tuesday, and drawing a hollow dot there would read as a puzzle you had
     skipped. */

  /* Four hues that hold up against the app's own accent and against each
     other, in the order the difficulties are declared. A game with one
     edition a day uses the accent and never shows a key. */
  const DCAL_HUES = ['var(--accent)', '#f7bd52', '#ff8fd0', '#b78cff'];

  const DCal = {
    game:'',            // which game's calendar is open
    month:'',           // 'YYYY-MM', the month on screen
    sel:'',             // the day whose editions are listed underneath

    open(id){
      const def = dailyDef(id);
      if(!def || !$('dcal-overlay')) return;
      this.game = id;
      const today = pktNow();
      this.month = today.slice(0, 7);
      this.sel = today;
      $('dcal-overlay').classList.remove('hide');
      this.render();
    },
    close(){
      const el = $('dcal-overlay');
      if(el) el.classList.add('hide');
    },
    /** Step a month, never past the one containing today — there is nothing to
        show in the future and a calendar that scrolls into it invites the
        question of why every day is empty. */
    step(n){
      const [y, m] = this.month.split('-').map(Number);
      const d = new Date(Date.UTC(y, m - 1 + n, 1));
      const want = d.toISOString().slice(0, 7);
      if(want > pktNow().slice(0, 7)) return;
      if(want < DAILY_EPOCH.slice(0, 7)) return;
      this.month = want;
      this.render();
    },

    /** The editions of one day: `[{k, n, hue, state, on}]`, `on` false when
        this game publishes nothing of that kind on that day. */
    _editions(day){
      const def = dailyDef(this.game);
      if(!def) return [];
      const started = day >= DAILY_EPOCH;
      return (def.diffs || [{k:'', n:''}]).map((d, i)=>{
        const rec = dailyGet(this.game, d.k, day);
        return {
          k: d.k, n: d.n,
          hue: DCAL_HUES[i % DCAL_HUES.length],
          /* Two ways to have nothing on a day: it is before the arcade had
             days at all, or this size simply does not come out then. */
          on: started && (def.on ? !!def.on(day, d.k) : true),
          state: rec ? rec.s : 0,
          rec: rec,
        };
      });
    },

    render(){
      const def = dailyDef(this.game);
      if(!def) return;
      const today = pktNow();
      const [y, m] = this.month.split('-').map(Number);

      const t = $('dcal-title');
      if(t) t.textContent = T('{game} puzzles', {game:T(def.title || this.game)});
      /* **When the next one arrives is the one thing the grid cannot show.**
         The archive rule is visible — the older days are right there — but
         the turnover is not, and it is the question somebody has at eleven at
         night. The paragraph about timezones stays cut. */
      const lede = $('dcal-lede');
      if(lede) lede.textContent = 'One a day, new at midnight. Older ones stay here.';

      /* The key. Hidden entirely for a game with one edition a day: a legend
         with a single row in it explains nothing. */
      /* **The numbers for the whole game, above the month.** Three tiles, and
         the game decides what they are — solved-and-best for sudoku, found-and
         -average-guesses for the word, clues for the crossword. Hidden until
         there is something in them, because "0 solved · — best" is worse than
         no tiles at all. */
      /* Worked out before the tiles are drawn, because the sentence underneath
         them is shown on the same condition: there is something to explain only
         once there is a number to explain. */
      let tiles = [];
      const sum = $('dcal-sum');
      {
        try{
          if(def.stats){
            const all = [];
            for(const d of (def.diffs || [{k:''}])) all.push.apply(all, dailyAll(this.game, d.k));
            if(all.some(r=>r.s === DAILY_DONE)) tiles = def.stats(all) || [];
          }
        }catch(err){}
      }
      if(sum){
        sum.classList.toggle('hide', !tiles.length);
        sum.innerHTML = tiles.map(t=>'<div class="dcal-stat"><b>' + esc(String(t.v))
          + '</b><span>' + esc(String(t.n)) + '</span></div>').join('');
      }

      /* **Say what the streak counts, because nobody can guess it.** "4" on a
         tile could be four puzzles, four days, or four of something else, and
         this game's rule is the strict one: every edition published that day,
         finished that day. A number whose rule is invisible is a number people
         either mistrust or misread. Written once here from the game's own
         `diffs`, so a game that gains a difficulty cannot leave a stale
         sentence behind. */
      const rule = $('dcal-rule');
      if(rule){
        const many = (def.diffs || []).length > 1;
        rule.classList.toggle('hide', !tiles.length);
        rule.textContent = many
          ? T('A streak day means every {game} published that day, finished that day. '
              + 'Older ones you go back to are still counted everywhere else, just not here.',
              {game:LANG === 'en' ? (def.title || this.game).toLowerCase() : T(def.title || this.game)})
          : ('A streak day means that day\u2019s puzzle, finished that day. '
             + 'Older ones you go back to are still counted everywhere else '
             + ', just not here.');
      }

      const keys = $('dcal-keys');
      if(keys){
        const ds = def.diffs || [];
        const many = ds.length > 1;
        keys.classList.toggle('hide', !many);
        if(many){
          keys.innerHTML = ds.map((d, i)=>
            '<span class="dcal-key"><i class="dcal-dot done" style="--hue:'
            + DCAL_HUES[i % DCAL_HUES.length] + '"></i>' + esc(d.n) + '</span>').join('')
            + '<span class="dcal-key dcal-key-how"><i class="dcal-dot"></i>not opened'
            + '<i class="dcal-dot start"></i>started'
            + '<i class="dcal-dot done"></i>finished</span>';
        }
      }

      const mon = $('dcal-month');
      if(mon) mon.textContent = pktMonthLabel(y, m);
      const prev = $('dcal-prev'), next = $('dcal-next');
      if(next) next.disabled = this.month >= today.slice(0, 7);
      if(prev) prev.disabled = this.month <= DAILY_EPOCH.slice(0, 7);

      /* Monday-first, to match the history calendar's own week strip. */
      const first = new Date(Date.UTC(y, m - 1, 1));
      const lead = (first.getUTCDay() + 6) % 7;
      const days = new Date(Date.UTC(y, m, 0)).getUTCDate();

      let html = '';
      for(let i = 0; i < lead; i++) html += '<div class="dcal-cell blank"></div>';
      for(let d = 1; d <= days; d++){
        const key = this.month + '-' + String(d).padStart(2, '0');
        const future = key > today || key < DAILY_EPOCH;
        const eds = future ? [] : this._editions(key);
        const dots = eds.filter(e=>e.on).map(e=>
          '<i class="dcal-dot' + (e.state === DAILY_DONE ? ' done'
            : e.state === DAILY_STARTED ? ' start' : '')
          + '" style="--hue:' + e.hue + '"></i>').join('');
        html += '<button class="dcal-cell' + (future ? ' future' : '')
          + (key === today ? ' today' : '') + (key === this.sel ? ' sel' : '') + '"'
          + (future ? ' disabled' : '') + ' data-d="' + key + '">'
          + '<b>' + d + '</b><span class="dcal-dots">' + dots + '</span></button>';
      }
      const grid = $('dcal-grid');
      if(grid){
        grid.innerHTML = html;
        grid.querySelectorAll('[data-d]').forEach(b=>{
          b.onclick = ()=>{ DCal.sel = b.dataset.d; DCal.render(); };
        });
      }
      this._renderDay();
    },

    /** What is under the grid: the chosen day's editions, each with what
        happened and the one button that makes sense for it.

        **The right-hand text is the result, not the state.** "Finished" three
        times down a page says nothing you could not see from the dots; "Solved
        in 6:12" is the reason to keep a calendar at all. Each game supplies
        its own `line(rec)` — it is the only one that knows whether its numbers
        are guesses, clues or seconds. */
    _renderDay(){
      const box = $('dcal-day');
      const def = dailyDef(this.game);
      if(!box || !def) return;
      const day = this.sel, today = pktNow();
      const eds = this._editions(day).filter(e=>e.on);
      if(!eds.length){
        box.innerHTML = '<p class="dcal-none">' + esc(T('Nothing was published on {day}.', {day:pktLabel(day)})) + '</p>';
        return;
      }
      box.innerHTML = '<p class="dcal-head">' + (day === today ? 'Today' : esc(pktLabel(day)))
        + '</p>' + eds.map((e, i)=>{
          let what = '';
          try{ what = def.line ? (def.line(e.rec) || '') : ''; }catch(err){}
          if(!what) what = e.state === DAILY_DONE ? 'Finished'
                         : e.state === DAILY_STARTED ? 'Started' : 'Not opened';
          const act = e.state === DAILY_DONE ? 'Look again'
                    : e.state === DAILY_STARTED ? 'Carry on' : 'Play';
          /* **Some results are a picture, and the picture is the name.**
             The word game's grid says how it went in a way no number does — so
             where a row would otherwise repeat the edition's name back at you
             ("Word", under a calendar of words), the grid takes that place
             instead. It sits *in* the row rather than under it, which is the
             difference between a result and a loose graphic on the page.
             `art(rec)` is the game's own; it returns markup or nothing. */
          let art = '';
          try{ art = (def.art && def.art(e.rec)) || ''; }catch(err){}
          /* **A finished one can be called what it was.** The edition's name
             ("Small") is all a row can say before it is played, because for
             some games the real name is the answer. `name(day, diff, rec)` is
             the game's chance to say more once it no longer gives anything
             away; the dot's colour still says which edition it was. */
          let label = e.n || def.title || '';
          try{ if(def.name) label = def.name(day, e.k, e.rec) || label; }catch(err){}
          return '<div class="dcal-row' + (art ? ' art' : '') + '"><i class="dcal-dot'
            + (e.state === DAILY_DONE ? ' done' : e.state === DAILY_STARTED ? ' start' : '')
            + '" style="--hue:' + e.hue + '"></i>'
            + (art || '<b title="' + esc(e.n || '') + '">' + esc(label) + '</b>')
            + '<span>' + esc(what) + '</span>'
            + '<button class="mini-btn" data-play="' + i + '">' + act + '</button></div>';
        }).join('');
      box.querySelectorAll('[data-play]').forEach(b=>{
        const e = eds[+b.dataset.play];
        b.onclick = ()=>{
          DCal.close();
          try{ def.open(day, e.k); }catch(err){}
        };
      });
    },
  };

  /** What every game's Calendar button calls. */
  function dailyCalOpen(id){ DCal.open(id); }

  /* Wired once, here rather than in 19-wiring.js, because everything this
     touches is in this file and the overlay it drives is this feature's. */
  if($('dcal-close')) $('dcal-close').onclick = ()=>DCal.close();
  if($('dcal-prev')) $('dcal-prev').onclick = ()=>DCal.step(-1);
  if($('dcal-next')) $('dcal-next').onclick = ()=>DCal.step(1);
  if($('ov-cal')) $('ov-cal').onclick = ()=>{
    try{ if(Arcade.active) dailyCalOpen(Arcade.active); }catch(e){}
  };
  /* Midnight: if the calendar happens to be open when the day turns over, it
     redraws rather than sitting there insisting yesterday is today. */
  onDailyRoll(()=>{
    const el = $('dcal-overlay');
    if(el && !el.classList.contains('hide')){ DCal.sel = pktNow(); DCal.render(); }
  });
