  /* ---------- events ---------- */
  function bump(field,delta){
    if(field==='f'){ S.focusMin=Math.min(120,Math.max(5,S.focusMin+delta)); if(S.mode==='setup'){S.total=S.remaining=S.focusMin*60;} }
    else{ S.breakMin=Math.min(30,Math.max(5,S.breakMin+delta)); }
    render();
  }
  $('f-minus').onclick=()=>bump('f',-5);
  $('f-plus').onclick =()=>bump('f', 5);
  $('r-minus').onclick=()=>bump('r',-5);
  $('r-plus').onclick =()=>bump('r', 5);
  $('t-auto').onclick =()=>{ S.autoContinue=!S.autoContinue; $('t-auto').classList.toggle('on',S.autoContinue); save(); };
  $('t-sound').onclick=()=>{ S.sound=!S.sound; $('t-sound').classList.toggle('on',S.sound); if(S.sound) chime(false); save(); };
  $('begin').onclick  = beginSession;
  $('toggle-run').onclick=()=>{ S.running ? pause() : start(); };
  $('skip').onclick=skip;
  $('stop').onclick=stop;

