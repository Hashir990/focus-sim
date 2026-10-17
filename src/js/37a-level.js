  /* ---------------- LEVEL, AND MENDING A STREAK ----------------

     Three things that all hang off the same idea: **a number that only ever
     goes up, and never gets spent.**

     Embers are a currency, and a currency has a hole in it. Spend four hundred
     of them on a clock face and the counter says what it said on your first
     day, so the thing that is meant to be a record of your hours stops being
     one the moment you use it. That is also why the shop can be finished on a
     Tuesday: nothing stops somebody claiming a dozen achievements, buying the
     dearest thing on the shelf, and finding the rest of the shelf is now just
     a list of prices.

     So beside the spendable number there is a level, and the level is **hours
     of focus**. It cannot be spent, it cannot be bought, and it is *derived*
     from the log and nothing else, which is the same argument `embersFrom`
     makes in 47-merge.js: a stored number disagrees between two devices for
     ever, a computed one cannot. Nothing new is written down for it.

     What it does is **pace the shelf**. Everything carries a level, worked out
     from its price rather than from a table somebody has to keep up to date,
     and the sum is arranged so it is never the binding constraint for somebody
     who earned their embers by focusing: by the time the hours have paid for a
     thing, the hours have long since opened it. It binds exactly one case,
     which is the case it is for: embers that came from somewhere other than
     the clock.

     **A streak can be mended.** Missing a day used to be the end of a run of
     sixty, which is the one place in the app where a bad week erases a good
     season. So a day can be bought back, the price rises with the length of
     the streak being saved, and a mended day is only a streak day: it adds no
     time, earns no embers, and shows in the chart as what it is. There is
     nothing to farm, because the thing being bought is a date rather than an
     hour.

     **And the ember itself gets brighter.** Consecutive days are the one thing
     the top bar can show without a second number in it, so the diamond burns
     harder the longer the run has been going and goes back to its quiet self
     when the run does.

     Nothing here has its own storage. The level is the log; a mend is a thing
     you own, filed in `Embers.own` beside the lights and the hats, which is
     what makes it sync, merge and reset with everything else and what lets
     `priceOf` charge for it. See the note on `mendId` below. */

  /* **The curve, and why it is this one.**

     Level 2 is an hour, level 3 is three, level 4 is six: the nth level is the
     nth triangular number of hours. It is the gentlest curve that still slows
     down. Early levels arrive inside a morning, which is when somebody is
     deciding whether any of this is worth doing, and by level twelve it is
     asking for a week of evenings per step. The dearest thing in the shop is
     about seventy-five hours of focus, which lands around level twelve, so the
     top of the shelf and the top of the useful range of this curve are the
     same place by construction rather than by coincidence. */
  function lvlFloor(n){ return Math.max(0, (n - 1) * n / 2) * 3600; }
  /** Which level that many seconds of focus is. Inverts `lvlFloor`.

      The epsilon is not superstition: `lvlFloor` is exact in seconds, but the
      division by 3600 and the square root are not obliged to be, and being one
      ten-thousandth of an hour short of level nine would show a level eight to
      somebody who had just watched the bar fill. */
  function lvlOf(secs){
    const h = Math.max(0, secs || 0) / 3600;
    return Math.max(1, Math.floor((1 + Math.sqrt(1 + 8 * h)) / 2 + 1e-9));
  }

  /* **What counts as an hour.** Finished focus out of the log, plus `adjust`
     read back as the hours it must have been.

     `adjust` is the embers a copy had before any of this was derivable (see
     the note on it in 37-embers.js). Leaving it out would be the one way this
     could take something away from somebody: a device carrying three hundred
     carried embers and a short log would come up level four and find half the
     shelf shut, having been able to afford it yesterday. Those embers came
     from hours that were never written down, so they are read back at the rate
     everything else is paid at.

     Achievements are the deliberate exception. They pay embers and they do not
     pay hours, which is what leaves the level with anything to do. */
  function lvlSecs(){
    let n = 0;
    try{ for(const r of LOG) n += Math.max(0, (r && r.secs) || 0); }catch(e){}
    try{ n += Math.max(0, Embers.adjust | 0) * EMB_PER; }catch(e){}
    return n;
  }
  function lvlNow(){ return lvlOf(lvlSecs()); }

  /** Where you are inside the level, for the bar at the top of the shop. */
  function lvlStep(){
    const secs = lvlSecs();
    const n = lvlOf(secs);
    const a = lvlFloor(n), b = lvlFloor(n + 1);
    return {n, secs, at:Math.max(0, secs - a), of:Math.max(1, b - a),
            left:Math.max(0, b - secs)};
  }

  /* **The gate, as a fraction of the thing's own price.**

     A thing costing C embers is C ten-minute blocks of focus, so it already
     implies a level: the one you would be at if you had spent nothing.
     Charging exactly that would mean the hours that pay for a thing also open
     it at the same moment, and the gate would never be visible at all.
     Charging much less than half would mean it never bites.

     At 0.55 the dearest shelf (450 embers, seventy-five hours) opens at level
     nine, which is thirty-six hours: three weeks of ordinary evenings, and
     flatly impossible on a first day whatever is claimed or granted. The cheap
     end lands at level two or three, which is the same afternoon. And because
     the fraction is below one, a windfall of bonus embers still buys something
     sooner than the clock would have, about half of the wait, rather than
     buying nothing at all, which is the point of a bonus. */
  const LVL_GATE = 0.55;
  /** The level a price asks for. Free things ask for nothing. */
  function lvlNeed(cost){
    const c = Math.max(0, Number(cost) || 0);
    return c ? lvlOf(c * EMB_PER * LVL_GATE) : 1;
  }
  /** The level a price asks for, if you are not there yet. 0 means go ahead. */
  function lvlLocked(cost){
    const n = lvlNeed(cost);
    return n > lvlNow() ? n : 0;
  }
  /** Every buy path starts with this. True means it said so and nothing happens.

      **Owning something is never revisited.** A gate is a pace, not a price,
      and a thing already on the shelf as yours has to stay yours whatever the
      curve says later. The one lesson of the price rise in 37-embers.js is
      that rewriting what somebody already has reads as the app breaking. So
      this is asked before a purchase and nowhere else. */
  function lvlDeny(cost){
    const n = lvlLocked(cost);
    if(!n) return false;
    try{ toast(T('Level {n} opens this', {n:n})); }catch(e){}
    return true;
  }

  /** What a locked tile says where its price would go, or '' when it is open.
      Plain text, not markup: one of the shelves it is for escapes its own
      labels and one of them does not. */
  function lvlTag(cost, mine){
    if(mine) return '';
    const n = lvlLocked(cost);
    return n ? T('Level {n}', {n:n}) : '';
  }

  /* The block at the top of the shop. It is here rather than in `Embers.html`
     because it is the only part of that page that is not about money. */
  function lvlHtml(){
    const s = lvlStep();
    const pc = Math.max(2, Math.min(100, Math.round(s.at / s.of * 100)));
    return '<div class="lvl" data-lvl="' + s.n + '">'
      + '<div class="lvl-head"><b>' + esc(T('Level {n}', {n:s.n})) + '</b>'
      + '<span>' + esc(T('{d} to level {n}', {d:fmtDur(s.left), n:s.n + 1})) + '</span></div>'
      + '<div class="lvl-track"><i style="width:' + pc + '%"></i></div>'
      + '<p class="emb-sub">Hours of focus raise your level. The dearest things '
      + 'need a higher one, and nothing you own is ever taken back.</p>'
      + '</div>';
  }

  /* ---------------- the streak, and mending it ---------------- */

  /** Every day with finished focus on it, as a set of day keys. */
  function lvlDays(){
    const set = Object.create(null);
    try{ for(const r of LOG) set[(r && r.day) || dayKey(r && r.ts)] = 1; }catch(e){}
    return set;
  }
  /** `n` days ago, as a day key. */
  function lvlBack(n){
    const d = new Date();
    d.setDate(d.getDate() - n);
    return dayKey(d.getTime());
  }

  /** Consecutive days up to now, counting mended ones.

      Today is a grace day: an empty today is this morning rather than a missed
      day, so the run is allowed to end yesterday. `byDay` is passed in by
      `Stats._compute`, which has already built it; without one it is built
      here, because the top bar asks this on every paint and must not have to
      open the statistics page to find out. */
  function lvlStreak(byDay){
    const has = byDay || lvlDays();
    const live = (n)=>{ const k = lvlBack(n); return !!has[k] || mendHas(k); };
    let run = 0;
    const from = live(0) ? 0 : 1;
    while(live(from + run)) run++;
    return run;
  }

  /* **How bright the diamond burns.** Six steps rather than a smooth ramp: a
     continuous glow is a glow nobody notices changing, where arriving at a
     week and seeing the thing visibly harder is the whole point. The last step
     is a month, and it is where it starts to breathe. */
  const LVL_GLOW = [2, 4, 7, 14, 30];
  function lvlGlow(){
    const run = lvlStreak();
    let g = 0;
    for(const n of LVL_GLOW) if(run >= n) g++;
    return g;
  }

  /* ---- a mend ----

     **A mend is a thing you own.** `mend-2026-10-11-15` is the eleventh of
     October, bought for fifteen. It goes in `Embers.own` with the lights and
     the hats, and that one decision is most of this working: `own` is unioned
     by the merge, carried by the account snapshot, priced by `priceOf` (so the
     balance stays derived rather than stored) and emptied by Reset progress
     along with everything else it belongs with. Nothing had to be taught a new
     key.

     **The price rides in the id** because it cannot be worked out again later:
     it depends on how long the streak was on the day it was paid, and that is
     gone the moment the days join up. The cost of that is narrow and worth
     saying. Two devices that are both offline and both mend the same day write
     two different ids and are charged twice, where one of them should have
     found the day already mended. It takes a deliberate effort to arrange and
     the result is a few embers, not a broken record. */
  const MEND_ID = 'mend-';
  /** 5 embers for every 20 days of streak being saved, and never fewer. */
  const MEND_PER = 5;
  const MEND_STEP = 20;
  /** The longest hole that can be bought back, in days. */
  const MEND_SPAN = 2;
  /** And the shortest run worth saving. Selling the mend of a two-day streak
      is the shop charging for something nobody would miss. */
  const MEND_KEEP = 3;

  function mendId(day, cost){ return MEND_ID + day + '-' + (cost | 0); }
  /** Has this day been bought back? Matched on the day, not the price, so the
      double-mend above shows as one day however many ids are behind it. */
  function mendHas(day){
    if(!day) return false;
    const pre = MEND_ID + day + '-';
    try{
      return (Embers.own || []).some(id=>typeof id === 'string' && id.indexOf(pre) === 0);
    }catch(e){ return false; }
  }
  /** What `priceOf` charges for one. Unparseable means free, which is the safe
      direction: it cannot invent a debt out of a malformed id. */
  function mendPrice(id){
    const m = /^mend-\d{4}-\d{2}-\d{2}-(\d+)$/.exec(String(id || ''));
    return m ? Math.max(0, +m[1]) : 0;
  }
  function mendCost(save){
    return MEND_PER * Math.max(1, Math.ceil(Math.max(0, save) / MEND_STEP));
  }

  /** The hole in front of the current run, if there is one worth offering.

      Walks back from today: the run that is still going, then the empty days
      behind it, then the run behind those. The offer exists only when the hole
      is small and the thing behind it is a streak, which is also what stops a
      month away from being buyable. The search for the hole gives up after
      `MEND_SPAN` days, so a long absence returns nothing rather than a price.

      `{days, save, cost}`: the days oldest first, how long the run behind them
      is, and what the lot costs. */
  function mendGap(){
    const has = lvlDays();
    const live = (n)=>{ const k = lvlBack(n); return !!has[k] || mendHas(k); };
    let run = 0;
    const from = live(0) ? 0 : 1;
    while(live(from + run)) run++;
    const days = [];
    let at = from + run;
    while(days.length <= MEND_SPAN && !live(at)){ days.push(lvlBack(at)); at++; }
    if(!days.length || days.length > MEND_SPAN) return null;
    let save = 0;
    while(live(at + save)) save++;
    if(save < MEND_KEEP) return null;
    return {days:days.slice().reverse(), save:save, cost:mendCost(save) * days.length};
  }

  /** Buy it. Asks first, because it is embers and there is no way back. */
  function mendBuy(){
    const g = mendGap();
    if(!g) return;
    let have = 0;
    try{ have = Embers.have; }catch(e){}
    if(have < g.cost){ toast(T('Not enough embers yet')); return; }
    askConfirm(T('Mend your streak?'),
      T('The days join up again. Nothing is added to your hours.'),
      T('Spend {n}', {n:g.cost}), ()=>{
        /* Asked again inside the dialog, because a block can finish while it is
           open and the hole it was about can close under it. */
        const now = mendGap();
        if(!now || Embers.have < now.cost) return;
        const each = now.cost / now.days.length;
        Embers.have -= now.cost;
        for(const d of now.days) Embers.own.push(mendId(d, each));
        Embers.save();
        try{ Embers.render(); }catch(e){}
        try{ Stats.render(); }catch(e){}
        try{ Cal.render && Cal.render(); }catch(e){}
        try{ Embers._mark(); }catch(e){}
        try{ chime(false); }catch(e){}
        toast(T('Mended'));
      });
  }

  /** The offer, under the fortnight of bars that shows the hole. Nothing at
      all when there is nothing to mend, which is nearly always. */
  function mendHtml(){
    const g = mendGap();
    if(!g) return '';
    const when = g.days.map(k=>{
      try{
        return new Date(k + 'T00:00:00')
          .toLocaleDateString(langLocale(), {weekday:'short', month:'short', day:'numeric'});
      }catch(e){ return k; }
    });
    return '<div class="smend">'
      + '<div class="smend-say"><b>' + esc(langAnd(when)) + '</b>'
      + '<span>' + esc(Tn('{n} day of your streak is missing',
                          '{n} days of your streak are missing', g.days.length)) + '</span></div>'
      + '<button type="button" class="smend-go" id="smend-go">'
      + esc(T('Mend it')) + ' ' + embPrice(g.cost) + '</button>'
      + '</div>';
  }
  function mendWire(root){
    const b = root && root.querySelector('#smend-go');
    if(b) b.onclick = mendBuy;
  }
