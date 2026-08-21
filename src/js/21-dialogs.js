  /* ---------------- SMALL SHARED DIALOGS ----------------
     Two things several features wanted and neither had: a confirm, and a
     hold-to-open menu. Both live here rather than in the feature that happened
     to need them first, and both are plain DOM — no library, same as the rest.

     Sorts at 21 so everything from the arcade games (30+) to Focus together
     (29) can call them; they're function declarations, so ordering is moot
     anyway, but the markup has to exist by the time the handlers bind. */

  let confirmYes = null;

  /** A yes/no the user has to mean. `onYes` runs only on Yes. */
  function askConfirm(title, body, yesLabel, onYes){
    if(!$('confirm')) { if(onYes) onYes(); return; }
    $('confirm-title').textContent = title || 'Are you sure?';
    $('confirm-body').textContent = body || '';
    $('confirm-yes').textContent = yesLabel || 'Yes';
    confirmYes = onYes;
    $('confirm').classList.remove('hide');
  }
  function closeConfirm(){
    const el = $('confirm');
    if(el) el.classList.add('hide');
    confirmYes = null;
  }

  if($('confirm')){
    $('confirm-yes').onclick = ()=>{ const f = confirmYes; closeConfirm(); if(f) f(); };
    $('confirm-no').onclick = closeConfirm;
    $('confirm').addEventListener('click', e=>{ if(e.target === $('confirm')) closeConfirm(); });
  }

  /* ---- prompt ----
     One line of text, asked for properly. `window.prompt` would have done the
     job and is the wrong shape for this app: it is a browser chrome dialog that
     looks nothing like anything else here, it is blocked outright in some
     wrappers, and in a packaged desktop build it stops the whole window. */
  let promptYes = null;

  function askPrompt(title, value, yesLabel, onYes){
    if(!$('prompt')){ if(onYes) onYes(value); return; }
    $('prompt-title').textContent = title || '';
    $('prompt-input').value = value || '';
    $('prompt-yes').textContent = yesLabel || 'Save';
    promptYes = onYes;
    $('prompt').classList.remove('hide');
    // selected, not just focused: renaming usually means replacing
    setTimeout(()=>{ try{ $('prompt-input').focus(); $('prompt-input').select(); }catch(e){} }, 30);
  }
  function closePrompt(){
    const el = $('prompt');
    if(el) el.classList.add('hide');
    promptYes = null;
  }
  if($('prompt')){
    const go = ()=>{
      const f = promptYes, v = $('prompt-input').value;
      closePrompt();
      if(f) f(v);
    };
    $('prompt-yes').onclick = go;
    $('prompt-no').onclick = closePrompt;
    $('prompt').addEventListener('click', e=>{ if(e.target === $('prompt')) closePrompt(); });
    $('prompt-input').addEventListener('keydown', e=>{
      if(e.key === 'Enter'){ e.preventDefault(); go(); }
      if(e.key === 'Escape'){ e.preventDefault(); closePrompt(); }
    });
  }

  /* ---- hold / right-click menu ----
     Touch has no right-click and a long press is what people already try, so
     both open the same thing. The press has to stay put — sliding a finger is
     a scroll, not a menu. */

  const HOLD_MS = 500;
  const HOLD_SLOP = 10;          // px of movement allowed before it's a scroll

  function closeMenu(){
    const el = $('hmenu');
    if(el) el.classList.add('hide');
  }

  /** Show `items` (`[{label, danger, run}]`) at a point. Empty list shows nothing. */
  function openMenu(x, y, items){
    const el = $('hmenu'), card = $('hmenu-card');
    if(!el || !card || !items || !items.length) return;
    card.innerHTML = items.map((it,i)=>
      '<button class="hmenu-item'+(it.danger?' danger':'')+'" data-i="'+i+'">'
      + esc(it.label) + '</button>').join('');
    card.onclick = (e)=>{
      const b = e.target.closest('[data-i]');
      if(!b) return;
      closeMenu();
      const it = items[+b.dataset.i];
      if(it && it.run) it.run();
    };
    el.classList.remove('hide');
    // place it, then nudge back inside the window
    card.style.left = '0px'; card.style.top = '0px';
    const w = card.offsetWidth || 160, h = card.offsetHeight || 44;
    card.style.left = Math.max(8, Math.min(x, window.innerWidth  - w - 8)) + 'px';
    card.style.top  = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
  }

  /* A hold with no feedback is indistinguishable from a hold that isn't working,
     which is exactly how the first version of this felt. So the press draws a
     ring that fills over HOLD_MS: you can see it starting, see how long is left,
     and see it give up if you slide off. */
  function holdRing(x, y){
    const el = $('holdring');
    if(!el) return;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.setProperty('--hold-ms', HOLD_MS + 'ms');
    el.classList.remove('hide', 'go');
    void el.offsetWidth;               // restart the animation
    el.classList.add('go');
  }
  function holdRingOff(){
    const el = $('holdring');
    if(el) el.classList.add('hide');
  }

  /** Wire an element so holding or right-clicking it asks `items()` what to show. */
  function holdMenu(el, items){
    if(!el) return;
    let timer = null, sx = 0, sy = 0;

    const cancel = ()=>{ clearTimeout(timer); timer = null; holdRingOff(); };

    el.addEventListener('contextmenu', e=>{
      const list = items();
      if(!list || !list.length) return;
      e.preventDefault();
      openMenu(e.clientX, e.clientY, list);
    });

    el.addEventListener('pointerdown', e=>{
      if(e.pointerType === 'mouse' && e.button !== 0) return;
      const list = items();
      if(!list || !list.length) return;      // nothing to hold for; don't tease
      sx = e.clientX; sy = e.clientY;
      cancel();
      holdRing(sx, sy);
      timer = setTimeout(()=>{
        timer = null;
        holdRingOff();
        const now = items();
        if(now && now.length){
          buzz(18);
          openMenu(sx, sy, now);
        }
      }, HOLD_MS);
    });
    el.addEventListener('pointermove', e=>{
      if(timer && (Math.abs(e.clientX-sx) > HOLD_SLOP || Math.abs(e.clientY-sy) > HOLD_SLOP)) cancel();
    });
    ['pointerup','pointercancel','pointerleave'].forEach(ev=>el.addEventListener(ev, cancel));
  }

  if($('hmenu')){
    $('hmenu').addEventListener('click', e=>{ if(e.target === $('hmenu')) closeMenu(); });
  }
  document.addEventListener('keydown', e=>{
    if(e.key !== 'Escape') return;
    closeMenu();
    closeConfirm();
  });

