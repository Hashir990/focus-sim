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
  $('drawer-close').onclick = closeDrawer;
  $('drawer-backdrop').onclick = closeDrawer;
  $('d-quotes').onclick = ()=>{ closeDrawer(); openQuotes(); };
  $('d-history').onclick = ()=>{ closeDrawer(); Cal.open(); };
  $('q-back').onclick = closeQuotes;
  $('q-save').onclick = addQuote;
  $('cal-close').onclick = ()=>Cal.close();
  $('cal-prev').onclick = ()=>Cal.step(-1);
  $('cal-next').onclick = ()=>Cal.step(1);
  $('ov-focus').onclick = focusNow;
  $('note-input').addEventListener('input', ()=>{ const rec=S.lastLogId?findLog(S.lastLogId):null; if(rec){ rec.note=$('note-input').value; saveLog(); } });

