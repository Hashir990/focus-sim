  /* ---------------- the notification, and surviving the background ----------
     On a phone, pressing Home does not stop a focus block — it stops the *page*
     from being given any time. The countdown itself is fine either way: the
     engine works off wall-clock arithmetic against `S.endAt` rather than by
     counting ticks (see 05-timer-engine.js), so a block that runs while the
     screen is off comes back with the right number on it.

     What does not survive is everything that happens *per tick*: the running
     record in the log, and the embers accruing into it. Android will throttle
     `setInterval` down to nothing within a minute or two of going away, so a
     forty-minute block spent in a pocket used to come back having recorded
     whichever second the phone last felt like giving us.

     Two halves to the fix, and neither of them needs the page to keep running:

       * **Reconcile on the way in and out.** Going away, write down where we
         got to. Coming back, catch up at once rather than waiting for the next
         interval. `logProgress` takes an absolute number of seconds rather than
         an increment, so one call after an hour away records the hour — there
         is nothing to replay.

       * **Tell the person what is happening from outside the app.** An ongoing
         notification while a block runs, and a real scheduled one at `S.endAt`
         so the end still announces itself even if the web view was frozen
         solid the whole time. The scheduled one is the important half: it is
         handed to Android up front and fires whether or not we are alive.

     All of it is feature-detected. On the web and on the desktop build there is
     no LocalNotifications plugin and every one of these is a no-op — which is
     also why the smoke test never sees any of it. */

  const NOTE_LIVE = 8801;      // the ongoing one: a block is running
  const NOTE_DONE = 8802;      // the scheduled one: this block ends at N

  const Notify = {
    api:null,
    ready:false,
    key:'',                    // what is currently posted, so we don't repost it

    /** The plugin, or null everywhere else. */
    _find(){
      try{
        const C = window.Capacitor;
        if(!C || !C.Plugins || !C.Plugins.LocalNotifications) return null;
        return C.Plugins.LocalNotifications;
      }catch(e){ return null; }
    },

    async init(){
      this.api = this._find();
      if(!this.api) return;
      try{
        /* Ask once. A refusal is a perfectly good answer — the app keeps
           working, it just stops being able to say anything from outside. */
        const p = await this.api.checkPermissions();
        if(p && p.display === 'prompt') await this.api.requestPermissions();
        const now = await this.api.checkPermissions();
        this.ready = !!(now && now.display === 'granted');
      }catch(e){ this.ready = false; }
      this.sync();
    },

    /* Called from render(), which runs on every state change. Keyed so that the
       common case — render firing again with nothing changed — costs one string
       comparison. Same idea as `vfxSet` in 38-vfx.js. */
    sync(){
      if(!this.api || !this.ready) return;
      const running = !!S.running && S.mode !== 'setup';
      const key = running ? (S.mode + '|' + S.endAt) : '';
      if(key === this.key) return;
      this.key = key;
      if(!running){ this.clear(); return; }
      this.post();
    },

    post(){
      const focus = S.mode === 'focus';
      const ends = new Date(S.endAt);
      const hhmm = ends.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
      try{
        this.api.schedule({notifications:[
          /* The ongoing one. No countdown in it on purpose: a notification the
             app has to wake up and rewrite every second is a notification that
             is wrong the moment the app is frozen, which is exactly when it is
             the only thing you can see. An end time is right for as long as the
             block lasts and costs nothing to keep true. */
          {
            id: NOTE_LIVE,
            title: focus ? 'Focusing' : 'On a break',
            body: (focus ? 'Until ' : 'Back at ') + hhmm,
            ongoing: true, autoCancel: false, smallIcon: 'ic_stat_icon_config_sample',
            channelId: 'focus-timer',
          },
          /* And the one that matters: handed to Android now, fired by Android
             then, whether or not this page is ever given another instruction. */
          {
            id: NOTE_DONE,
            title: focus ? 'Focus block done' : 'Break over',
            body: focus ? 'Time for a break.' : 'Back to it when you are ready.',
            schedule: {at: ends, allowWhileIdle: true},
            channelId: 'focus-timer',
          },
        ]});
      }catch(e){}
    },

    clear(){
      try{
        this.api.cancel({notifications:[{id:NOTE_LIVE}, {id:NOTE_DONE}]});
      }catch(e){}
    },
  };

  /* ---- the reconciliation ----
     Both directions, and both cheap. Going away: write down where the block got
     to, because the next thing that happens might be the OS killing us. Coming
     back: catch up immediately, so the calendar and the ember count are right
     before the person has finished looking at them. */
  function notifyReconcile(){
    try{
      if(S.mode !== 'focus' || !S.running) return;
      const rem = Math.max(0, Math.round((S.endAt - Date.now()) / 1000));
      logProgress(Math.max(0, S.total - rem));
      logFlush();
    }catch(e){}
  }

  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'hidden'){ notifyReconcile(); return; }
    /* Back on screen. `tick()` puts the clock, the log and the embers right in
       one go — it reads the wall clock rather than counting — so calling it
       once here is the whole catch-up.

       **Only if the block is actually running.** This used to be unconditional,
       and `S.endAt` is a stale number the moment you pause — so coming back to
       a paused timer advanced it by however long you had been away, logged the
       minutes, and completed the block outright if you had been away long
       enough. `tick()` refuses now for the same reason; the check is written
       twice on purpose, because reading this line should not require knowing
       what the other one does. */
    try{ if(S.running) tick(); }catch(e){}
    try{ Notify.sync(); }catch(e){}
  });
  /* A phone that is about to kill the app gets no visibilitychange, but it does
     usually get this. */
  window.addEventListener('pagehide', notifyReconcile);

  Notify.init();
