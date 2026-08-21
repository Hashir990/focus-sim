  /* ---------- timer engine ----------

     AUTO_CAP: how many focus blocks an endless run will carry itself through
     before it stops and waits for you.

     Endless plus auto-continue is the one combination that needs no person in
     the room: it will start block after block on its own all afternoon, and
     every one of them banks embers. Stopping to be told to carry on, every
     eight blocks — a little over three hours at the default length — costs a
     tap to somebody who is really there and costs everything to somebody who
     isn't. A counted run doesn't need this; it already stops at its own end. */
  const AUTO_CAP = 8;

  function start(){
    S.running=true;
    S.autoHold=false;      // whatever paused the run, somebody has answered it
    S.endAt = Date.now() + S.remaining*1000;
    /* Open the block here rather than waiting for the first tick a quarter of a
       second later — the block began when this was pressed. On a resume this is
       the elapsed time so far, which the accrual reads as no progress and
       ignores, so pausing cannot open a second record. */
    if(S.mode==='focus') logProgress(Math.max(0, S.total - S.remaining));
    ding(true);            // up a fifth: carrying on
    acquireWake();
    ambStart();
    clearInterval(loop);
    loop = setInterval(tick,250);
    render();
    syncBroadcastState();
  }
  function pause(){
    S.running=false;
    ding(false);           // down a fifth: stopped
    S.remaining = Math.max(0, Math.round((S.endAt-Date.now())/1000));
    clearInterval(loop); loop=null;
    releaseWake();
    ambStop();
    render();
    syncBroadcastState();
  }
  /* **`S.endAt` means nothing while the clock is paused, and this is the only
     place that can be hurt by that.**

     `pause()` reads the remainder off `S.endAt` and then leaves it alone — the
     end time of a block that is no longer heading anywhere. So a minute after
     pausing, `S.endAt - Date.now()` is a minute short; ten minutes after
     pausing it is negative. Nothing noticed while the only caller was the
     250ms loop, which `pause()` clears.

     Then 45-notify.js added a second caller: come back from the background and
     `tick()` once, to catch up a block that ran while the page was frozen. It
     did not ask whether the block was running. Pause, switch away, come back —
     and the paused clock had counted down the whole time you were gone,
     written the phantom minutes into the log and the ember count, and if you
     had been away longer than the block, run `complete()`: chime, session
     banked, straight into the break. A paused timer that keeps time is the
     single worst thing this app can do, and it only happened where nobody was
     watching.

     The guard lives *here* rather than only at that call site, because the call
     site was written in good faith and the next one will be too. */
  function tick(){
    if(!S.running) return;
    const rem = Math.max(0, Math.round((S.endAt-Date.now())/1000));
    if(rem!==S.remaining){ S.remaining=rem; paint(); }
    /* Focus is written down while it happens rather than when it ends, so a
       block that never gets an ending still counts. This is the one hook that
       covers both sides of a shared room: a follower's clock runs on the same
       loop. See 17-session-log.js. */
    if(S.mode==='focus') logProgress(Math.max(0, S.total - rem));
    if(rem<=0) complete();
  }
  function complete(actualSecs){
    clearInterval(loop); loop=null; S.running=false; releaseWake();
    if(Arcade.open) Arcade.close();
    const wasFocus = S.mode==='focus';
    const focusSecs = wasFocus ? Math.min(S.total, Math.max(0, actualSecs!=null ? actualSecs : S.total)) : 0;
    chime(!wasFocus ? false : true); buzz([90,60,90]);

    if(wasFocus){
      S.cycle++; S.sessionsToday++; S.runCount++;
      // no actualSecs means the clock reached zero on its own; anything else
      // came from skip(), which is a block cut short however long it ran
      logSession(focusSecs, actualSecs == null);
      tasksFlushToNote();   // ticked tasks become this session's note
      // reached the requested number of focus blocks? end the run.
      if(S.repeat>0 && S.runCount>=S.repeat){
        save();
        Quote.stop();
        S.mode='setup'; S.restIsLong=false; S.remaining=S.total=S.focusMin*60;
        swapView(); render();
        toast(S.runCount+' session'+(S.runCount>1?'s':'')+' done — nice work');
        return;
      }
      S.restIsLong = (S.cycle % 4 === 0);
      S.mode='rest';
      S.total = (S.restIsLong ? S.longRestMin : S.breakMin)*60;
    }else{
      S.mode='focus';
      S.total = S.focusMin*60;
    }
    S.remaining = S.total;
    save(); render();
    syncBroadcastState();

    if(S.autoContinue){
      /* An endless run pauses for breath every AUTO_CAP blocks. The rest still
         starts — you have earned it — it just doesn't roll into the next focus
         block until somebody says so. */
      if(wasFocus && S.repeat === 0 && S.runCount % AUTO_CAP === 0){
        S.autoHold = true;
        render();
        toast(S.runCount + ' blocks in — tap play when you are ready to carry on');
        return;
      }
      setTimeout(()=>{ if(!S.running && S.mode!=='setup') start(); }, 1000);
    }
  }

  function beginSession(){
    S.mode='focus'; S.runCount=0; S.total=S.focusMin*60; S.remaining=S.total;
    // prime audio on user gesture
    try{ audio = audio || new (window.AudioContext||window.webkitAudioContext)(); audio.resume(); }catch(e){}
    swapView(); start();
    syncBroadcastState();
  }
  function skip(){
    let actual=null;
    if(S.mode==='focus'){ const rem = S.running?Math.max(0,Math.round((S.endAt-Date.now())/1000)):S.remaining; actual = S.total - rem; }
    S.endAt=Date.now(); S.remaining=0; complete(actual);
  }
  function stop(){
    // Ending early still counts: log whatever focus time was actually done, so it
    // reaches the calendar and the stats instead of vanishing.
    if(S.mode==='focus'){
      const rem = S.running ? Math.max(0, Math.round((S.endAt-Date.now())/1000)) : S.remaining;
      const done = Math.max(0, S.total - rem);
      if(done >= 30){
        S.sessionsToday++;
        logSession(done, false);   // ending early is never a whole block
        tasksFlushToNote();
        toast('Saved '+fmtDur(done)+' to your history');
      }else{
        // under half a minute has never been written down; the ticks opened a
        // record anyway, so it has to be taken back
        logDrop();
      }
    }
    clearInterval(loop); loop=null; S.running=false; releaseWake();
    ambStop();
    if(Arcade.open) Arcade.close();
    Quote.stop();
    S.mode='setup'; S.restIsLong=false;
    S.remaining=S.total=S.focusMin*60;
    swapView(); render();
    syncBroadcastState();
  }
  function focusNow(){
    if(Arcade.open) Arcade.close();
    S.mode='focus'; S.restIsLong=false;
    S.total=S.focusMin*60; S.remaining=S.total;
    try{ audio = audio || new (window.AudioContext||window.webkitAudioContext)(); audio.resume(); }catch(e){}
    swapView(); start();
  }

