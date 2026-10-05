  /* ---------------- SMALL SHARED DIALOGS ----------------
     Two things several features wanted and neither had: a confirm, and a
     hold-to-open menu. Both live here rather than in the feature that happened
     to need them first, and both are plain DOM — no library, same as the rest.

     Sorts at 21 so everything from the arcade games (30+) to Focus together
     (29) can call them; they're function declarations, so ordering is moot
     anyway, but the markup has to exist by the time the handlers bind. */

  let confirmYes = null;
  let confirmAlt = null;
  let confirmNo = null;

  /** A yes/no the user has to mean. `onYes` runs only on Yes.
   *
   *  `opt` is for the handful of confirms where No is not "do nothing" — an
   *  unsaved buddy is the standing example: Save, throw it away, or go back to
   *  what you were doing. Those are three answers, and a two-button dialog
   *  makes one of them the close box, which nobody reads as an answer.
   *    opt.no   — rename Cancel, when "Cancel" is misleading ("Discard")
   *    opt.onNo — run something on No, for when No is an answer and not an exit
   *    opt.alt  — {label, run} for a third button, shown only when given.
   *    opt.show — {accent, c1, c2, name, note} to paint the thing being bought.
   *
   *  **`show` is fields, not markup.** The shop could have handed over a bit of
   *  HTML and this could have dropped it in, and then the one dialog every
   *  feature shares would be a place where any caller can write into the page.
   *  It takes the four values it knows how to draw and builds the element
   *  itself, so there is nothing a caller can put in here that the dialog has
   *  not agreed to.
   *
   *  Backdrop and Escape still mean "nothing happened", never `onNo` — the way
   *  out of a dialog cannot also be one of its answers.
   */
  function askConfirm(title, body, yesLabel, onYes, opt){
    if(!$('confirm')) { if(onYes) onYes(); return; }
    const o = opt || {};
    $('confirm-title').textContent = title || 'Are you sure?';
    const show = $('confirm-show');
    if(show){
      show.textContent = '';
      const sh = o.show;
      show.classList.toggle('hide', !sh);
      if(sh){
        /* The colours it is actually made of, as the thing itself: the sky it
           paints, and a ring in its accent standing in for the dial. */
        const sky = document.createElement('i');
        sky.className = 'confirm-sky';
        sky.style.background = 'linear-gradient(160deg, ' + (sh.c1 || sh.accent)
          + ' 0%, ' + (sh.c2 || sh.accent) + ' 100%)';
        const ring = document.createElement('b');
        ring.className = 'confirm-ring';
        ring.style.borderColor = sh.accent || '#fff';
        sky.appendChild(ring);
        show.appendChild(sky);
        const words = document.createElement('span');
        words.className = 'confirm-words';
        if(sh.name){
          const nm = document.createElement('b');
          nm.textContent = sh.name;
          words.appendChild(nm);
        }
        if(sh.note){
          const nt = document.createElement('small');
          nt.textContent = sh.note;
          words.appendChild(nt);
        }
        show.appendChild(words);
      }
    }
    $('confirm-body').textContent = body || '';
    $('confirm-yes').textContent = yesLabel || 'Yes';
    $('confirm-no').textContent = o.no || 'Cancel';
    const alt = $('confirm-alt');
    if(alt){
      confirmAlt = (o.alt && o.alt.run) || null;
      alt.textContent = (o.alt && o.alt.label) || '';
      alt.classList.toggle('hide', !o.alt);
    }
    confirmYes = onYes;
    confirmNo = o.onNo || null;
    $('confirm').classList.remove('hide');
  }
  /* Closing puts the card back the way every other caller expects to find it —
     label restored, third button gone. A dialog that remembers the last thing
     it was asked is a dialog that offers "Discard" over a light you are
     buying. */
  function closeConfirm(){
    const el = $('confirm');
    if(el) el.classList.add('hide');
    confirmYes = null;
    confirmAlt = null;
    confirmNo = null;
    if($('confirm-no')) $('confirm-no').textContent = 'Cancel';
    if($('confirm-alt')) $('confirm-alt').classList.add('hide');
    /* Emptied as well as hidden. A left-over swatch is a picture of the last
       thing you bought sitting over the next question you are asked. */
    if($('confirm-show')){
      $('confirm-show').textContent = '';
      $('confirm-show').classList.add('hide');
    }
  }

  if($('confirm')){
    $('confirm-yes').onclick = ()=>{ const f = confirmYes; closeConfirm(); if(f) f(); };
    $('confirm-no').onclick = ()=>{ const f = confirmNo; closeConfirm(); if(f) f(); };
    if($('confirm-alt')) $('confirm-alt').onclick = ()=>{
      const f = confirmAlt; closeConfirm(); if(f) f();
    };
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

