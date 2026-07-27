  /* ---------- render ---------- */
  function swapView(){
    const setup = S.mode==='setup';
    $('setup').classList.toggle('hide', !setup);
    $('timer').classList.toggle('hide', setup);
  }
  function paint(){ // light: just the changing digits + ring
    const m=Math.floor(S.remaining/60), s=S.remaining%60;
    $('clock').textContent = pad(m)+':'+pad(s);
    const frac = S.total ? S.remaining/S.total : 0;
    document.querySelector('.ring-prog').setAttribute('stroke-dasharray', C);
    document.querySelector('.ring-prog').setAttribute('stroke-dashoffset', (C*(1-frac)).toFixed(2));
    if(Arcade.open){
      const t=$('ov-timer');
      t.textContent = S.remaining>0 ? pad(m)+':'+pad(s) : 'Break over';
      t.classList.toggle('over', S.remaining<=0);
    }
  }
  function render(){
    document.getElementById('app').setAttribute('data-phase', S.mode==='setup' ? '' : S.mode);
    document.body.setAttribute('data-phase', S.mode==='setup' ? '' : S.mode);
    tasksRefresh();
    $('today-count').textContent = S.sessionsToday;

    if(S.mode==='setup'){
      $('f-num').textContent=S.focusMin; $('r-num').textContent=S.breakMin;
      const rs=$('rest-summary');
      if(rs) rs.textContent = S.breakMin+' min · '+(S.repeat>0 ? '×'+S.repeat : 'endless');
      $('f-minus').disabled = S.focusMin<=5; $('f-plus').disabled = S.focusMin>=120;
      $('r-minus').disabled = S.breakMin<=5; $('r-plus').disabled = S.breakMin>=30;
      markPresets();
      $('t-auto').classList.toggle('on', S.autoContinue);
      $('t-sound').classList.toggle('on', S.sound);
      return;
    }

    // timer view
    $('phase-name').textContent = S.mode==='focus' ? 'Focus' : (S.restIsLong ? 'Long rest' : 'Rest');
    $('subline').textContent = S.mode==='focus'
      ? (S.repeat>0 ? ('Session '+(S.runCount+1)+' of '+S.repeat) : 'Session '+(S.runCount+1))
      : 'Recover';
    $('toggle-run').textContent = S.running ? 'Pause' : (S.remaining<S.total ? 'Resume' : 'Begin '+(S.mode==='focus'?'focus':'rest').toLowerCase());
    $('rest-extra').classList.toggle('hide', S.mode!=='rest');
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

