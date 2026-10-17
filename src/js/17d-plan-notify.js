  /* ---- calendar events, on the phone ----

     An event on the calendar already knows the one thing a reminder needs: a
     day, a time, and a repeat rule. What it had no way of doing was telling
     anybody, because the app has to be open for the calendar to be on screen
     and the whole point of putting a time on something is that you are not
     looking at it.

     **A rolling window, re-cut every time the plan changes.** Capacitor can
     repeat a notification on its own, but only on the shapes it knows --
     daily, weekly, a fixed interval. `planRepeat` allows "every third week on
     Monday and Thursday, until the end of May", which none of those express.
     So nothing here is handed to the system as a repeat: the next thirty days
     are walked with the app's own `planOccursOn`, each landing is scheduled as
     its own one-off, and the whole set is thrown away and rebuilt whenever the
     plan changes or the app starts. The rule stays in one place, which is the
     only way the reminder and the row on the screen cannot disagree.

     The window is a window because Android will not hold an unbounded number
     of pending alarms, and a repeat with no end would ask for exactly that.
     Thirty days of lead time on something you wrote in a calendar is plenty,
     and every launch pushes the window forward. */
  const PLAN_NOTIFY_DAYS = 30;
  /* Android starts dropping pending alarms somewhere above a hundred or so and
     does not say which. Staying well under means a very busy month loses the
     far end of the window rather than losing something at random. */
  const PLAN_NOTIFY_MAX = 48;

  function planNotifyApi(){
    try{
      const C = window.Capacitor;
      if(!(C && C.isNativePlatform && C.isNativePlatform())) return null;
      return (C.Plugins && C.Plugins.LocalNotifications) || null;
    }catch(e){ return null; }
  }

  /* A stable 31-bit id for one landing of one entry, so a rebuild replaces the
     same notification rather than stacking a second copy beside it. The id has
     to survive a restart, so it is derived from the entry and the day rather
     than counted. */
  function planNotifyId(id, key){
    let h = 2166136261;
    const s = id + '@' + key;
    for(let i = 0; i < s.length; i++){
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 1) || 1;          // >>> 1 keeps it positive and inside int32
  }

  /** Every timed event landing in the window, soonest first. */
  function planNotifyUpcoming(){
    const out = [];
    const now = Date.now();
    const today = new Date();
    for(let i = 0; i < PLAN_NOTIFY_DAYS && out.length < PLAN_NOTIFY_MAX; i++){
      const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const key = planKey(day);
      for(const p of PLAN){
        /* Only events, and only the ones with a time on them. A task is a
           thing to get round to and a timeless event is a thing that is on
           today -- neither has a moment to be told about. */
        if(!p || p.kind !== 'event' || !p.time) continue;
        if(p.done && p.done[key]) continue;
        if(!planOccursOn(p, key)) continue;
        const hm = String(p.time).split(':');
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(),
                            Number(hm[0]) || 0, Number(hm[1]) || 0, 0, 0);
        // a landing in the past, or so close that scheduling it is a race
        if(at.getTime() <= now + 30000) continue;
        out.push({
          id: planNotifyId(p.id, key),
          title: String(p.text || '').slice(0, 90) || T('On your calendar'),
          body: T('On your calendar'),
          schedule:{ at, allowWhileIdle:true },
        });
        if(out.length >= PLAN_NOTIFY_MAX) break;
      }
    }
    out.sort((a, b)=>a.schedule.at - b.schedule.at);
    return out;
  }

  /* **Permission is asked for when there is something to ask about.**

     Requesting on launch means a fresh install shows a system dialog before
     the person has written anything down, which is the moment they are least
     able to judge it and most likely to say no -- and a no here is sticky.
     So the first request happens on the first save that actually produces a
     reminder, which is a thing they just chose to do. */
  async function planNotifySync(){
    const LN = planNotifyApi();
    if(!LN) return;
    let list = [];
    try{ list = planNotifyUpcoming(); }catch(e){ return; }
    try{
      let st = await LN.checkPermissions();
      if(st && st.display !== 'granted'){
        if(!list.length) return;              // nothing to ask about yet
        st = await LN.requestPermissions();
        if(!st || st.display !== 'granted') return;
      }
      /* Cancel what is pending before scheduling, not after: these are the
         same ids, and a cancel that lands after its own reschedule removes the
         thing it was meant to replace. */
      const pend = await LN.getPending();
      const old = (pend && pend.notifications) || [];
      if(old.length) await LN.cancel({ notifications: old.map(n=>({ id:n.id })) });
      if(list.length) await LN.schedule({ notifications: list });
    }catch(e){ /* a phone that will not schedule is not a reason to fail a save */ }
  }

  /* Saving a plan can happen several times in a row -- a tick, a text edit and
     a sort all call savePlan -- and each rebuild is a round trip to the OS. One
     timer, restarted, so a burst costs one rebuild. */
  /* `var`, not `let`. savePlan() calls this and lives in an earlier file; the
     whole build is one scope, so a save that happened before this line ran
     would hit the temporal dead zone and throw inside a try/catch that would
     swallow it. Nothing calls savePlan that early today, which is exactly the
     kind of thing that changes quietly. */
  var planNotifyTimer = null;
  function planNotifyBump(){
    if(!planNotifyApi()) return;
    if(planNotifyTimer) clearTimeout(planNotifyTimer);
    planNotifyTimer = setTimeout(()=>{
      planNotifyTimer = null;
      try{ planNotifySync(); }catch(e){}
    }, 400);
  }
