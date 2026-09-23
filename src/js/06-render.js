  /* ---------- render ---------- */
  let RING = null;
  function swapView(){
    const setup = S.mode==='setup';
    $('setup').classList.toggle('hide', !setup);
    $('timer').classList.toggle('hide', setup);
    // the dial has just appeared or gone; its glow follows on the next frame
    try{ glowLater(); }catch(e){}
  }
  function paint(){ // light: just the changing digits + ring
    /* No glowFit() here. This runs once a second for the whole of a session, and
       measuring the dial costs a layout flush; the dial does not move between
       ticks, and everything that can move it — a resize, a scroll, a change of
       view — asks for the glow to be refitted itself. */
    const m=Math.floor(S.remaining/60), s=S.remaining%60;
    const clock = pad(m)+':'+pad(s);
    const el = $('clock');
    // the same string as last second means the same pixels; skip the write
    if(el.textContent !== clock) el.textContent = clock;
    const frac = S.total ? S.remaining/S.total : 0;
    /* The ring is one element, looked up once. `stroke-dasharray` is set at
       init and never changes, so writing it every second was a wasted attribute
       change on an SVG — which invalidates the path and re-rasterises the
       drop-shadow on it. */
    RING = RING || document.querySelector('.ring-prog');
    RING.setAttribute('stroke-dashoffset', (C*(1-frac)).toFixed(2));
    /* Whichever face is on. It returns immediately for the digital one, which
       is the digits written just above. See 43-faces.js. */
    try{ facePaint(m, s, frac); }catch(e){}
    if(Arcade.open){
      const t=$('ov-timer');
      t.textContent = S.remaining>0 ? pad(m)+':'+pad(s) : 'Break over';
      t.classList.toggle('over', S.remaining<=0);
    }
  }
  function render(){
    /* **The phone's copy of the clock, kept up to date here.** Everything that
       has to know about the block while the web view is frozen — the ongoing
       notification and the app blocker — reads a mirror rather than `S`, and
       this is the one hook that fires on every state change. Keyed inside, so
       the once-a-second call with nothing changed costs a string compare.
       No-op on anything that is not the Android build. See 50-guard.js. */
    try{ guardPushTimer(); }catch(e){}
    document.getElementById('app').setAttribute('data-phase', S.mode==='setup' ? '' : S.mode);
    document.body.setAttribute('data-phase', S.mode==='setup' ? '' : S.mode);
    tasksRefresh();
    paintDate();
    try{ Embers.paint(); }catch(e){}
    try{ glowFit(); }catch(e){}
    /* Cheap on purpose: `stage()` compares a signature and returns without
       touching the DOM unless the pose or the buddy actually changed. This runs
       once a second for the whole of a block. */
    try{ Buddy.stage(); }catch(e){}

    if(S.mode==='setup'){
      $('f-num').textContent=S.focusMin; $('r-num').textContent=S.breakMin;
      const rs=$('rest-summary');
      if(rs) rs.textContent = T('{m} min', {m:S.breakMin}) + ' · ' + (S.repeat>0 ? '×'+S.repeat : T('endless'));
      $('f-minus').disabled = S.focusMin<=5; $('f-plus').disabled = S.focusMin>=120;
      $('r-minus').disabled = S.breakMin<=5; $('r-plus').disabled = S.breakMin>=30;
      markPresets();
      $('t-auto').classList.toggle('on', S.autoContinue);
      $('t-sound').classList.toggle('on', S.sound);
      return;
    }

    // timer view
    $('phase-name').textContent = S.mode==='focus' ? 'Focus' : (S.restIsLong ? 'Long rest' : 'Rest');
    /* An endless run stops itself every so often and says why, otherwise the
       one time the timer doesn't roll on by itself reads as a bug. */
    /* **It has to fit inside the dial.** This line sits under the clock inside
       a circle a hundred and fifty pixels across at most, uppercase, with a
       fifth of an em of letter-spacing on every character — and it said
       "PAUSED AFTER 4 — TAP PLAY TO CARRY ON", which is thirty-one characters
       and about twice the width there is. Five words, one line. */
    $('subline').textContent = S.autoHold
      ? T('{n} done — tap play', {n:S.runCount})
      : S.mode==='focus'
        /* Just the count. "Session 1 of 4" spends two thirds of the line saying
           what the line is, under a clock, on a screen with nothing else it
           could be counting. */
        ? (S.repeat>0 ? T('{a} of {b}', {a:S.runCount+1, b:S.repeat}) : T('No {n}', {n:S.runCount+1}))
        : 'Recover';
    $('toggle-run').textContent = S.running ? 'Pause' : (S.remaining<S.total ? 'Resume' : (S.mode==='focus' ? 'Begin focus' : 'Begin rest'));
    /* Keep the phone's notification in step with the timer. Keyed inside, so
       this costs a string comparison on the renders where nothing changed. */
    try{ Notify.sync(); }catch(e){}
    $('rest-extra').classList.toggle('hide', S.mode!=='rest');
    // the arcade lives above the transport now, so it is shown on its own
    $('arcade-open').classList.toggle('hide', S.mode!=='rest');
    /* Written from the shelf rather than from the markup — see Arcade.offer.
       Compared first because this runs once a second for a whole session. */
    try{
      const em = $('arcade-open').querySelector('.arcade-txt em');
      const offer = Arcade.offer();
      if(em && em.textContent !== offer) em.textContent = offer;
    }catch(e){}
    if(S.mode==='rest') refreshNote();
    if(S.mode==='focus' && S.running) Quote.ensure(); else Quote.stop();
    renderCycle();
    paint();
  }
  function renderCycle(){
    const box=$('cycle'); box.innerHTML='';
    const pos = S.cycle % 4;                 // completed within current run of 4
    for(let i=0;i<4;i++){
      const p=document.createElement('div');
      p.className='pip'+(i<pos?' done':'');
      box.appendChild(p);
    }
    const l=document.createElement('div'); l.className='pip long';
    if(S.mode==='rest'&&S.restIsLong) l.classList.add('done');
    box.appendChild(l);
  }
  function markPresets(){
    document.querySelectorAll('#f-presets .chip').forEach(c=>c.classList.toggle('on', +c.dataset.v===S.focusMin));
    document.querySelectorAll('#r-presets .chip').forEach(c=>c.classList.toggle('on', +c.dataset.v===S.breakMin));
    document.querySelectorAll('#rep-chips .chip').forEach(c=>c.classList.toggle('on', +c.dataset.v===S.repeat));
  }

