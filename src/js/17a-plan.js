  /* ---------------- THE PLAN ----------------
     Things you mean to do, on days that haven't happened yet.

     The session log answers "what did I do"; this answers "what am I meant to
     be doing". They are kept apart on purpose. A log record is evidence — it is
     written by the timer and never by a person, and editing it would make the
     hours a matter of opinion. A plan entry is an intention, freely written and
     freely deleted, and nothing about it counts towards anything.

     Two kinds, because they behave differently:

       **Task** — something to get done. On the day it is due it is copied into
       the checklist beside the timer, which is where you will actually see it.

       **Event** — something that happens at a time, whether or not you do
       anything. It is never copied anywhere; it sits at the top of its day.

     **Repeats are rules, not rows.** "Every Tuesday" is one entry with a rule
     on it, not fifty-two entries. Nothing is generated in advance: a day is
     asked whether the rule lands on it, which means a rule can be edited after
     the fact and the past re-reads correctly, and a repeat that runs for years
     costs one record. `planOccursOn` is the whole of that idea.

     Ticking a repeat off has to be per-day — Tuesday's is done, next Tuesday's
     is not — so `done` is keyed by day rather than being a flag. `sp` is the
     same shape and remembers which days have already been copied into the
     checklist, so deleting one from the checklist doesn't bring it back an hour
     later. */

  var PLAN = [];                       // see planItem() for the shape
  const PLAN_KEY = 'focus_plan';

  async function loadPlan(){
    try{
      const r = await KV.get(PLAN_KEY);
      if(r && r.value){
        const p = JSON.parse(r.value);
        if(Array.isArray(p)) PLAN = p;
      }
    }catch(e){}
  }
  function savePlan(){ try{ KV.set(PLAN_KEY, JSON.stringify(PLAN)); }catch(e){} }

  /* A blank entry, so every field exists from the start and nothing downstream
     has to guess whether an old record has it. */
  function planItem(kind, day, text){
    return {
      id:'p' + Date.now() + '_' + (Math.random()*1e4|0),
      kind: kind === 'event' ? 'event' : 'task',
      text: String(text || '').slice(0, 90),
      day,                    // the first (or only) day it lands on
      time:'',                // 'HH:MM', or '' for "some time that day"
      rep:null,               // see planRepeat()
      done:{},                // {'YYYY-MM-DD':1} — per day, because of repeats
      sp:{},                  // days already copied into the checklist
    };
  }

  /* A repeat rule.
       every : 'day' | 'week' | 'month' | 'year'
       n     : every n-th of those, so 2 weeks is {every:'week', n:2}
       days  : weekly only — which weekdays, 0=Sunday. Empty means "the same
               weekday as the first one", which is what people mean by weekly.
       endOn : 'YYYY-MM-DD' to stop after that date, '' for never
       endAfter : stop after this many landings, 0 for never
     Days-of-week is what makes "every weekday" and "Mondays and Thursdays"
     one rule rather than five entries. */
  function planRepeat(every, n, days, endOn, endAfter){
    return {
      every: every || 'week',
      n: Math.max(1, n|0) || 1,
      days: Array.isArray(days) ? days.slice() : [],
      endOn: endOn || '',
      endAfter: Math.max(0, endAfter|0),
    };
  }

  /* ---- dates ----
     Everything is a 'YYYY-MM-DD' key rather than a Date, because a Date carries
     a time and a timezone and both of them eventually put something on the
     wrong day. These two are the only place the two forms meet. */
  function planDate(key){
    const p = String(key || '').split('-');
    return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1);
  }
  function planKey(d){
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  /** Whole days from a to b, both keys. Sign matters; magnitude is exact. */
  function planDaysBetween(a, b){
    return Math.round((planDate(b) - planDate(a)) / 86400000);
  }
  function planMonthsBetween(a, b){
    const x = planDate(a), y = planDate(b);
    return (y.getFullYear() - x.getFullYear()) * 12 + (y.getMonth() - x.getMonth());
  }

  /** Does this entry land on this day? The whole of the repeat logic. */
  function planOccursOn(p, key){
    if(!p || !p.day || !key) return false;
    if(key === p.day) return true;
    if(!p.rep) return false;
    if(key < p.day) return false;                       // string compare: ISO dates sort
    const r = p.rep;
    if(r.endOn && key > r.endOn) return false;

    const n = Math.max(1, r.n | 0) || 1;
    const from = planDate(p.day), on = planDate(key);
    let hit = false, count = 0;                         // count = which landing this is, 1-based

    if(r.every === 'day'){
      const d = planDaysBetween(p.day, key);
      hit = d % n === 0;
      count = d / n + 1;

    }else if(r.every === 'week'){
      /* Chosen weekdays repeat within the week; the interval counts weeks from
         the week the entry started, so "every other Monday and Thursday" is
         two landings a fortnight rather than two landings a week. */
      const days = (r.days && r.days.length) ? r.days : [from.getDay()];
      if(days.indexOf(on.getDay()) < 0) return false;
      const weekStart = (d)=>{ const c = new Date(d); c.setDate(c.getDate() - c.getDay()); return c; };
      const w = Math.round((weekStart(on) - weekStart(from)) / 604800000);
      hit = w % n === 0;
      count = w / n * days.length + 1;                  // near enough for a cap

    }else if(r.every === 'month'){
      /* Same date each month. The 31st simply doesn't happen in a short month —
         rolling it back to the 30th makes a monthly bill land on two different
         dates and reads as a bug. */
      if(on.getDate() !== from.getDate()) return false;
      const m = planMonthsBetween(p.day, key);
      hit = m % n === 0;
      count = m / n + 1;

    }else if(r.every === 'year'){
      if(on.getDate() !== from.getDate() || on.getMonth() !== from.getMonth()) return false;
      const y = on.getFullYear() - from.getFullYear();
      hit = y % n === 0;
      count = y / n + 1;
    }

    if(!hit) return false;
    if(r.endAfter && count > r.endAfter) return false;
    return true;
  }

  /** Everything landing on a day: events first, then tasks, each by time. */
  function planOn(key){
    const rows = PLAN.filter(p=>planOccursOn(p, key));
    return rows.sort((a, b)=>{
      if(a.kind !== b.kind) return a.kind === 'event' ? -1 : 1;
      const at = a.time || '99:99', bt = b.time || '99:99';
      return at < bt ? -1 : at > bt ? 1 : 0;
    });
  }
  function planCounts(key){
    let tasks = 0, events = 0, left = 0;
    for(const p of PLAN){
      if(!planOccursOn(p, key)) continue;
      if(p.kind === 'event') events++;
      else { tasks++; if(!(p.done && p.done[key])) left++; }
    }
    return {tasks, events, left};
  }

  /** Tick or untick one day of one entry. */
  function planTick(id, key, done){
    const p = PLAN.find(x=>x.id === id);
    if(!p) return;
    p.done = p.done || {};
    if(done) p.done[key] = 1; else delete p.done[key];
    savePlan();
  }
  function planRemove(id){
    PLAN = PLAN.filter(p=>p.id !== id);
    /* The plan merges by id, so dropping it here is not enough — the other
       device still has it and the union would hand it straight back. See the
       tombstone note in 14-util.js. */
    tombstone(id);
    savePlan();
  }

  /** How the rule reads in a sentence, for the row it sits on. */
  function planRepeatLabel(p){
    const r = p && p.rep;
    if(!r) return '';
    const DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const n = Math.max(1, r.n | 0) || 1;
    const unit = {day:'day', week:'week', month:'month', year:'year'}[r.every] || 'week';
    let s = n === 1 ? ('Every ' + unit) : ('Every ' + n + ' ' + unit + 's');
    if(r.every === 'week' && r.days && r.days.length){
      const named = r.days.slice().sort().map(d=>DOW[d].slice(0, 3));
      const weekdays = r.days.length === 5 && [1,2,3,4,5].every(d=>r.days.indexOf(d) >= 0);
      s = weekdays && n === 1 ? 'Every weekday'
        : (n === 1 ? 'Every ' : 'Every ' + n + ' weeks, ') + named.join(', ');
    }
    if(r.endOn) s += ' until ' + r.endOn;
    else if(r.endAfter) s += ', ' + r.endAfter + ' times';
    return s;
  }

  /* ---- the bridge to the checklist ----
     A task due today is copied into TASKS, once, the first time the app notices
     the day. Copied rather than shown live so that everything already built on
     TASKS — ticking during a block, the note it writes, the live list — works
     without knowing the plan exists. `from` is the thread back, so ticking it
     off marks the day on the plan as well. */
  function planSpawnDue(){
    if(typeof TASKS === 'undefined') return 0;
    const key = dayKey(Date.now());
    let made = 0;
    for(const p of PLAN){
      if(p.kind !== 'task') continue;
      if(!planOccursOn(p, key)) continue;
      p.sp = p.sp || {};
      if(p.sp[key]) continue;
      p.sp[key] = 1;
      TASKS.push({
        id:'t' + Date.now() + '_' + (Math.random()*1e4|0),
        text:p.text, done:!!(p.done && p.done[key]),
        from:p.id, on:key, at:p.time || '',
      });
      made++;
    }
    if(made){
      savePlan(); saveTasks();
      try{ tasksRender(); tasksRefresh(); }catch(e){}
      try{ toast(made === 1 ? 'A task you planned is on today’s list'
                            : made + ' tasks you planned are on today’s list'); }catch(e){}
    }
    return made;
  }
