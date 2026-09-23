  /* ---------- init ---------- */
  /* First, so everything drawn from here on is drawn into a page that is
     already in the chosen language — the observer it starts catches each
     screen as it is built. Every string table has been read by now; they are
     the files numbered below this one. See 00a-i18n.js. */
  try{ langStart(); }catch(e){}
  buildPresets();
  Promise.all([load(), loadQuotes(), loadLog(), loadTasks(), loadPlan(), loadGone(), gamesLoad(), dailyLoad(), moodLoad(), playLoad(), ambLoad(), syncLoad(), Embers.load(), vfxLoad(), Update.load(), Account.load(), Guard.load()]).then(()=>{
    document.querySelector('.ring-prog').setAttribute('stroke-dasharray',C);
    /* Anything planned for today joins the checklist before the first render,
       so it is simply there rather than appearing a moment later. */
    try{ planSpawnDue(); }catch(e){}
    /* After load(), because the chosen face comes out of the same record — and
       before render(), so the first paint draws the right one rather than the
       digital default for a beat. */
    /* Recompute the ember balance from where it actually came from — the log,
       what has been claimed, what has been bought. Here rather than inside
       `Embers.load()`, because that races `loadLog()` in the same `Promise.all`
       and would derive a balance from an empty log. See reconcile() in
       37-embers.js and 47-merge.js. */
    try{ Embers.reconcile(); Embers.save(); }catch(e){}
    /* **Nothing stays on him that he does not own.** After `Embers.load()`, so
       there is something to check against, and before the first paint, so he is
       never drawn in a hat he has to buy back. See `budStrip` in 46-buddy.js. */
    try{ budStrip(); }catch(e){}
    /* **One account, one room code — settled here, where the load order cannot
       matter.** `syncLoad()` and `Account.load()` are both in the `Promise.all`
       above and neither can see the other's result, so a signed-in device could
       come up on whatever code it happened to have saved rather than the
       account's. Mail is addressed to a code; two devices on two codes is half
       the post going to an address nobody reads. */
    /* **The day turns over on its own.** A timer to the next Pakistani
       midnight, re-armed each time and on every wake, so a phone that slept
       through it still catches up. See 09b-daily.js. */
    try{ dailyRollStart(); }catch(e){}
    try{ syncAdoptAccount(Account.token ? Account.username : ''); }catch(e){}
    try{ faceApply(); }catch(e){}
    /* **Draw the shelves again now everything is loaded.** `ambLoad()` renders
       the ambience picker at the end of its own promise, and it races
       `Embers.load()` in the same `Promise.all` — so on a cold start it usually
       drew the locks before there was any record of what had been bought, and
       everything you owned came up looking unowned until something else
       happened to re-render it. Both of these are cheap and idempotent; the
       ordering is the fix, not the call. */
    try{ ambRender(); }catch(e){}
    /* If there is an account, catch up with it — quietly, because the app has
       never needed the network and still does not. */
    try{ Account.render(); Account.sync(true); }catch(e){}
    try{ Embers.render(); }catch(e){}
    /* **The once-a-day ask, after everything is loaded.** Before the load it
       would not know whether today had already been answered and would ask a
       second time on every restart. See 17b-mood.js. */
    /* And behind the terms, the first time: one question on the screen, not
       two stacked on each other. See 50b-terms.js. */
    try{ termsGate(()=>{ try{ moodAsk(); }catch(e){} }); }catch(e){ try{ moodAsk(); }catch(err){} }
    render();
    /* Last, so the first thing it does cannot race the layers it switches off.
       See 49-rest.js: a timer left running for half an hour behind another
       window should not be painting a buddy for nobody. */
    try{ restWatch(); }catch(e){}
  });

  /* The app is left open overnight far more often than it is opened fresh in
     the morning — it lives in a pinned tab or a window of its own. Without
     this, a task planned for Tuesday would turn up whenever the thing next
     happened to be restarted. Once a minute is more often than it needs to be
     and costs nothing. */
  var PLAN_DAY = dayKey(Date.now());
  setInterval(()=>{
    try{
      const k = dayKey(Date.now());
      if(k === PLAN_DAY) return;
      PLAN_DAY = k;
      planSpawnDue();
    }catch(e){}
  }, 60000);
