  /* --- v3 wiring --- */
  function openDrawer(){
    $('drawer-backdrop').classList.remove('hide');
    requestAnimationFrame(()=>{ $('drawer').classList.add('open'); $('drawer-backdrop').classList.add('show'); });
  }
  function closeDrawer(){
    $('drawer').classList.remove('open'); $('drawer-backdrop').classList.remove('show');
    setTimeout(()=>$('drawer-backdrop').classList.add('hide'), 280);
  }
  $('menu-btn').onclick = openDrawer;
  if($('emb-chip')) $('emb-chip').onclick = ()=>Stats.open();
  $('ov-menu').onclick = openDrawer;
  $('drawer-close').onclick = closeDrawer;
  $('drawer-backdrop').onclick = closeDrawer;

  /* ---- swipe in from the left edge ----
     The menu button is in the top bar, and the top bar is only on the timer and
     setup screens — from inside a game or the arcade you had to back out of
     wherever you were to reach it. This is the gesture people already try, and
     the arcade header has a menu button of its own for when a gesture isn't
     what somebody wants.

     Nothing is ever prevented. The worst case is that a swipe opens the menu
     and whatever was underneath also gets the touch, which is survivable —
     the drawer closes by tapping away from it. */
  const EDGE = 40;        // px from the left edge a swipe has to start in
  const SWIPE = 45;       // px across before it counts
  let sw = null;

  /* Two places drag with a finger and would be ruined by this: a Scrabble tile
     being pulled off the rack, and the Pictionary canvas, which is a pen. They
     are also the two screens with a menu button of their own in the header, so
     nothing is lost. Everywhere else — including the chess board and the
     crossword grid, where a sideways drag means nothing — the swipe works. */
  function swAllowed(el){
    return !(el && el.closest && el.closest('.sc-boardwrap, .sc-rack, .pic-board'));
  }

  function swStart(x, y, touch, target){
    if(sw && sw.touch && !touch) return;             // a finger is already driving this
    const open = $('drawer').classList.contains('open');
    if(!open && x > EDGE){ sw = null; return; }
    if(!open && !swAllowed(target)){ sw = null; return; }
    sw = {x, y, open, touch:!!touch};
  }
  function swMove(x, y, touch){
    if(!sw || (sw.touch && !touch)) return;
    const dx = x - sw.x, dy = y - sw.y;
    // A gesture that is mostly up or down is a scroll. A ratio rather than a
    // fixed slop, because a long swipe is allowed to drift and a short one is not.
    if(Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx) * 1.3){ sw = null; return; }
    if(!sw.open && dx > SWIPE){ sw = null; openDrawer(); }
    else if(sw.open && dx < -SWIPE){ sw = null; closeDrawer(); }
  }
  function swEnd(touch){ if(sw && sw.touch && !touch) return; sw = null; }

  /* Touch events *and* pointer events, in the capture phase.

     Pointer events alone were the reason this only worked sometimes: the moment
     a browser decides a touch is a scroll it fires `pointercancel` and stops
     sending moves, and almost every screen in this app is inside something
     scrollable. Touch events keep coming regardless, so they are what the
     gesture actually runs on; the pointer handlers are a fallback for anything
     that reports pointers and not touches, and they stand aside the moment a
     real finger is involved. Capture phase, so a `stopPropagation` somewhere
     below can't quietly swallow the whole thing. */
  const opt = {passive:true, capture:true};
  document.addEventListener('touchstart', (e)=>{
    // The finger that just landed, by name. Using touches[0] meant a second
    // finger arriving mid-swipe re-based the gesture on the first one's current
    // position, and the swipe died on the spot.
    const t = e.changedTouches && e.changedTouches[0];
    if(!t) return;
    swStart(t.clientX, t.clientY, true, e.target);
    if(sw) sw.id = t.identifier;
  }, opt);
  document.addEventListener('touchmove', (e)=>{
    if(!sw) return;
    let t = null;
    for(const c of (e.changedTouches || [])) if(c.identifier === sw.id) t = c;
    if(t) swMove(t.clientX, t.clientY, true);
  }, opt);
  document.addEventListener('touchend', ()=>swEnd(true), opt);
  document.addEventListener('touchcancel', ()=>swEnd(true), opt);

  document.addEventListener('pointerdown', (e)=>{
    if(e.pointerType !== 'mouse') swStart(e.clientX, e.clientY, false, e.target);
  }, opt);
  document.addEventListener('pointermove', (e)=>{
    if(e.pointerType !== 'mouse') swMove(e.clientX, e.clientY, false);
  }, opt);
  document.addEventListener('pointerup', ()=>swEnd(false), opt);
  document.addEventListener('pointercancel', ()=>swEnd(false), opt);
  $('d-quotes').onclick = ()=>{ closeDrawer(); openQuotes(); };
  $('d-history').onclick = ()=>{ closeDrawer(); Cal.open(); };
  $('q-back').onclick = closeQuotes;
  $('q-save').onclick = addQuote;
  $('q-share').onchange = toggleQuoteShare;
  $('cal-close').onclick = ()=>Cal.close();
  $('cal-prev').onclick = ()=>Cal.step(-1);
  $('cal-next').onclick = ()=>Cal.step(1);
  if($('day-close')) $('day-close').onclick = ()=>Cal.closeDay();
  if($('day-prev')) $('day-prev').onclick = ()=>Cal.dayStep(-1);
  if($('day-next')) $('day-next').onclick = ()=>Cal.dayStep(1);
  /* Cutting the break short ends it for the whole room, so it is the timer
     holder's call — the same rule as start, pause and skip. The button is
     disabled for everyone else rather than hidden, so it's clear the option
     exists and whose it is. */
  $('ov-focus').onclick = ()=>{
    if(syncActive() && !syncIsLeader()){ toast('Only the timer holder can do that'); return; }
    focusNow();
  };
  $('note-input').addEventListener('input', ()=>{ const rec=S.lastLogId?findLog(S.lastLogId):null; if(rec){ rec.note=$('note-input').value; saveLog(); } });

