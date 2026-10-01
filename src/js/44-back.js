  /* ---------------- the back button ----------------
     On Android — and in any browser — Back should close whatever is open, not
     leave the app. The app is one page with layers stacked on it, so as far as
     the browser is concerned there is nowhere to go back *to*: the first press
     took you out of a session you were in the middle of.

     The trick is the usual one and it is worth writing down. There is no way to
     ask "was that Back?" — you only find out afterwards, when a `popstate`
     arrives. So the app keeps one spare history entry parked in front of it
     whenever anything is open: Back consumes that entry, `popstate` fires, we
     close the topmost layer, and if anything is still open we park another. The
     URL never changes and no real navigation ever happens.

     The list below is in the order things sit on top of each other, and that
     order *is* the behaviour: a confirm dialog over the shelf closes before the
     shelf does. Anything openable that is not in this list simply carries on
     being closed the old way, which is a safe way to be wrong. */

  const BACK_LAYERS = [
    // a question is always the topmost thing on the screen
    {id:'confirm',        close:()=>{ const b = $('confirm-no'); if(b) b.click(); }},
    {id:'prompt',         close:()=>{ const b = $('prompt-no'); if(b) b.click(); }},
    // a sheet over a screen
    {id:'chat',           close:()=>{ const b = $('chat-close'); if(b) b.click(); }},
    // the crossword's puzzle list sits over its own game
    {id:'dcal-overlay',   close:()=>{ const b = $('dcal-close'); if(b) b.click(); }},
    // the menu, which can be over anything
    {sel:'.drawer.open',  close:()=>{ try{ closeDrawer(); }catch(e){} }},
    // full-screen pages
    /* Above Focus together, because it opens from it. */
    {id:'prof-overlay',   close:()=>{ const b = $('prof-close'); if(b) b.click(); }},
    /* Above App blocking, for the same reason: the picker opens from it. */
    {id:'block-apps-overlay', close:()=>{ const b = $('block-apps-close'); if(b) b.click(); }},
    {id:'block-overlay',  close:()=>{ const b = $('block-close'); if(b) b.click(); }},
    {id:'sync-overlay',   close:()=>{ const b = $('sync-close'); if(b) b.click(); }},
    {id:'ach-overlay',    close:()=>{ const b = $('ach-close'); if(b) b.click(); }},
    {id:'stats-overlay',  close:()=>{ const b = $('stats-close'); if(b) b.click(); }},
    {id:'acct-overlay',   close:()=>{ const b = $('acct-close'); if(b) b.click(); }},
    {id:'shop-overlay',   close:()=>{ const b = $('shop-close'); if(b) b.click(); }},
    /* Above Settings, because the four About pages open from it: Back closes
       what you were reading and leaves you on the page you opened it from.
       Without this line Back reached past what is actually on the screen and
       closed Settings underneath it, leaving the prose stranded over nothing. */
    {id:'about-overlay',  close:()=>{ const b = $('about-back'); if(b) b.click(); }},
    {id:'settings-overlay', close:()=>{ const b = $('settings-close'); if(b) b.click(); }},
    /* Above the month, because it opens from it: Back closes the day and
       leaves you on the month, which is where you were. */
    {id:'day-overlay',    close:()=>{ const b = $('day-close'); if(b) b.click(); }},
    {id:'cal-overlay',    close:()=>{ const b = $('cal-close'); if(b) b.click(); }},
    {id:'quotes-overlay', close:()=>{ const b = $('q-back'); if(b) b.click(); }},
    // the arcade last: it is the thing everything else opens on top of
    {id:'overlay',        close:()=>{ try{ Arcade.close(); }catch(e){ const b = $('ov-back'); if(b) b.click(); } }},
  ];

  function backTop(){
    for(const l of BACK_LAYERS){
      const el = l.id ? $(l.id) : document.querySelector(l.sel);
      if(!el) continue;
      /* `.hide` is per-component in this app (§2 of HANDOFF), so "is it open" is
         asked the only way that works everywhere: is it actually being drawn. */
      /* `.hide` and nothing else. This asked `getComputedStyle().display` as
         well, to be thorough, and thorough is expensive: this runs on a timer,
         in every window, over a dozen elements. A resolved style is one of the
         costliest things you can ask a browser for in a loop, and in the test's
         three-window handover it starved the event loop enough to break a peer
         connection. `.hide` is the app's own convention for this (§2) and it is
         a class check. */
      if(el.classList.contains('hide')) continue;
      if(l.sel === '.drawer.open' && !el.classList.contains('open')) continue;
      return l;
    }
    return null;
  }

  let BACK_PARKED = false;
  function backPark(){
    if(BACK_PARKED || !backTop()) return;
    try{ history.pushState({fs:1}, ''); BACK_PARKED = true; }catch(e){}
  }

  /* Watched rather than hooked into every open() in the app. A dozen call sites
     would each need a line, and the one somebody forgets is the one that walks
     the user out of the app mid-session. This asks the same question the user
     does — is anything on screen? — a few times a second, and only ever touches
     history when the answer changes. */
  function backWatch(){
    /* **Parks, and never unparks.** The first version called `history.back()`
       once everything had been closed by hand, to tidy the spare entry away.
       That fires a real `popstate`, asynchronously, and by the time it arrived
       something else had often been opened — so the app closed a screen the
       moment you opened it. Eight checks caught it and it would have been
       maddening in use.

       A stale entry costs one extra press of Back on the way out of the app,
       once, and nothing else. Firing navigation events to keep a counter tidy
       is not worth a single one of those. */
    setInterval(()=>{ if(backTop()) backPark(); }, 400);
    if(backTop()) backPark();
  }

  window.addEventListener('popstate', ()=>{
    const top = backTop();
    if(!top){ BACK_PARKED = false; return; }   // nothing open: let it through
    BACK_PARKED = false;
    try{ top.close(); }catch(e){}
    // still something underneath? park another entry for the next press
    setTimeout(backPark, 60);
  });

  /* ---- Android's Back ----

     A browser announces a press through `popstate`, and the parked entry above
     is the whole reason that works. Android announces nothing: as far as the
     WebView is concerned there is nowhere to go back to, so the default is to
     finish the activity, and one press from inside a crossword took the block
     with it.

     MainActivity forwards every press here and decides nothing itself — see the
     note in MainActivity.java for why it cannot. This closes the top layer if
     there is one and asks to be put in the background if there is not.
     Backgrounded rather than finished: a finished activity is a cold start next
     time, and a cold start loses whatever block was running.

     **The parked entry is deliberately left where it is.** On this path no
     `popstate` ever arrives, so nothing consumes it; clearing `BACK_PARKED`
     here would have `backWatch` push a fresh entry a few hundred milliseconds
     later and the history would grow by one for every press of Back, for ever.

     On `window` rather than in this scope because the native side reaches it
     by name. */
  window.__androidBack = function(){
    const top = backTop();
    if(top){
      try{ top.close(); }catch(e){}
      return true;
    }
    try{
      const api = guardApi();
      if(api && api.leave) api.leave();
    }catch(e){}
    return false;
  };

  backWatch();
