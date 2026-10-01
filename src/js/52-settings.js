  /* ---------------- the settings page ----------------

     A page, not the bottom of the menu.

     The menu was a list of eight places to go with a settings panel stapled
     underneath: three switches, a row of clock faces, seven languages and four
     legal pages. On a phone that put the language chips off the bottom of a
     list nobody scrolls, and a control nobody can find is a control that is not
     there. The shelf went the same way for the same reason — see the note at
     the top of src/body/12c-shop-overlay.html.

     **This file wires a page, it does not own one thing on it.** Every control
     in src/body/12d-settings.html kept the id it had in the menu, so the code
     that owns each one — 08-events.js for the switches, 38-vfx.js for Effects,
     43-faces.js for the faces, 50b-terms.js for the languages, 50-about.js for
     the four About buttons, 20-data-io.js for Reset — still finds it without
     knowing anything moved. That is the whole reason the move was cheap, and
     it is the thing to preserve: if a control here ever needs a new id, it
     needs its handler moved with it.

     Ambience stayed in the menu. It is the one thing under those headings that
     is reached for *during* a session rather than set once, and a tap to start
     the rain belongs where the hand already goes. */
  function settingsOpen(){
    const ov = $('settings-overlay');
    if(!ov) return;
    ov.classList.remove('hide');
    /* Drawn fresh on the way in. Both of these lists can change while the page
       is closed — a face is bought in the shop, and langRender marks which
       language is on — and both are cheap enough that asking whether they
       needed it would cost more than doing it. Guarded because neither is
       essential to the page opening: a stale row of faces is a worse page, a
       throw here is no page at all. */
    try{ faceRender(); }catch(e){}
    try{ langRender(); }catch(e){}
  }

  function settingsClose(){
    const ov = $('settings-overlay');
    if(ov) ov.classList.add('hide');
  }

  if($('d-settings')) $('d-settings').onclick = ()=>{ closeDrawer(); settingsOpen(); };
  if($('settings-close')) $('settings-close').onclick = settingsClose;
