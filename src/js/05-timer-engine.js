  /* ---------- timer engine ---------- */
  function start(){
    S.running=true;
    S.endAt = Date.now() + S.remaining*1000;
    acquireWake();
    clearInterval(loop);
    loop = setInterval(tick,250);
    render();
  }
  function pause(){
    S.running=false;
    S.remaining = Math.max(0, Math.round((S.endAt-Date.now())/1000));
    clearInterval(loop); loop=null;
    releaseWake();
    render();
  }
  function tick(){
    const rem = Math.max(0, Math.round((S.endAt-Date.now())/1000));
    if(rem!==S.remaining){ S.remaining=rem; paint(); }
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
      logSession(focusSecs);
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

    if(S.autoContinue){ setTimeout(()=>{ if(!S.running && S.mode!=='setup') start(); }, 1000); }
  }

  function beginSession(){
    S.mode='focus'; S.runCount=0; S.total=S.focusMin*60; S.remaining=S.total;
    // prime audio on user gesture
    try{ audio = audio || new (window.AudioContext||window.webkitAudioContext)(); audio.resume(); }catch(e){}
    swapView(); start();
  }
  function skip(){
    let actual=null;
    if(S.mode==='focus'){ const rem = S.running?Math.max(0,Math.round((S.endAt-Date.now())/1000)):S.remaining; actual = S.total - rem; }
    S.endAt=Date.now(); S.remaining=0; complete(actual);
  }
  function stop(){
    clearInterval(loop); loop=null; S.running=false; releaseWake();
    if(Arcade.open) Arcade.close();
    Quote.stop();
    S.mode='setup'; S.restIsLong=false;
    S.remaining=S.total=S.focusMin*60;
    swapView(); render();
  }
  function focusNow(){
    if(Arcade.open) Arcade.close();
    S.mode='focus'; S.restIsLong=false;
    S.total=S.focusMin*60; S.remaining=S.total;
    try{ audio = audio || new (window.AudioContext||window.webkitAudioContext)(); audio.resume(); }catch(e){}
    swapView(); start();
  }

