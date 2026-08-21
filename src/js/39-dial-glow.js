  /* ---------------- the dial's glow ----------------
     The halo around the dial kept being clipped, and every fix for it was the
     same fix: find whichever ancestor was scrolling and give it padding. That
     never works, because a scroll box clips at its padding box — the padding
     moves the clip along with the content. Move the scrolling one level out and
     the next box up clips it instead.

     So the outer glow stops being inside the layout at all. It is a fixed
     element that lives beside the effects pane, behind everything, and is told
     where the dial is. Nothing between it and the viewport scrolls, so there is
     nothing left that can crop it — at any window size, in either phase, on
     every border.

     The dial keeps its own inner halo; this is only the part that spills. */

  const GLOW_GROW = 0.42;            // how far past the dial the spill reaches

  function glowFit(){
    const g = $('dial-glow'), d = $('dial'), t = $('timer');
    if(!g || !d) return;
    const show = !!t && !t.classList.contains('hide') && S.mode !== 'setup'
      && !Arcade.open;
    g.classList.toggle('on', show);
    if(!show) return;
    const r = d.getBoundingClientRect();
    if(!r.width) return;
    /* Size from the layout box and position from the middle of the painted one.
       `getBoundingClientRect` includes the breathing scale, so sizing from it
       made this box grow and shrink a step behind the dial once a second, which
       is its own kind of flicker. offsetWidth ignores transforms. */
    const w = d.offsetWidth || r.width;
    const grow = w * GLOW_GROW;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const size = w + grow * 2;
    const left = cx - w / 2 - grow, top = cy - w / 2 - grow;
    /* Only write when something actually moved. Reading a rect and then writing
       four styles is a layout flush each way round, and this used to run on
       every scroll event and every tick of the clock — so a slow drag on the
       setup screen was doing that a hundred times a second for a box that had
       not moved a pixel. */
    if(GLOW_AT.size === size && Math.abs(GLOW_AT.left - left) < .5
       && Math.abs(GLOW_AT.top - top) < .5) return;
    GLOW_AT.size = size; GLOW_AT.left = left; GLOW_AT.top = top;
    g.style.width = size + 'px';
    g.style.height = size + 'px';
    g.style.left = left + 'px';
    g.style.top = top + 'px';
  }
  const GLOW_AT = {size:-1, left:-1, top:-1};

  /* One measurement per frame at most, and only if a frame is coming anyway. */
  let glowSoon = 0;
  function glowLater(){
    if(glowSoon) return;
    glowSoon = requestAnimationFrame(()=>{ glowSoon = 0; glowFit(); });
  }

  window.addEventListener('resize', glowLater, {passive:true});
  // the dial moves when the screen scrolls, and the glow has to go with it
  const _app = $('app');
  if(_app) _app.addEventListener('scroll', glowLater, {passive:true});

  /* ---------------- VEILING ----------------
     Whatever is open on top, the app underneath should not be readable through
     it. The overlays are 96–97% opaque, which sounds like enough and isn't: at
     the size the setup screen's numbers are drawn, three per cent of them is
     still plainly a number, and the shelf ended up with a ghost of the main
     menu sitting behind it.

     Two halves to the fix. The overlay pane keeps its frosted glass, and the
     shell underneath is *blurred at the source* — so there is nothing legible
     behind the glass to begin with, whether or not the browser has
     backdrop-filter and whether or not the weather is turned on.

     Driven by an observer rather than by every open() and close() in the app.
     There are a dozen ways to open an overlay — buttons, the drawer, keyboard,
     the arcade, a game finishing — and each one of them is a place to forget to
     call this. The class attribute changing is the one thing they all do. */
  function veilCheck(){
    let on = false;
    const overlays = document.querySelectorAll('.overlay');
    for(const o of overlays) if(!o.classList.contains('hide')){ on = true; break; }
    if(!on){
      const d = $('drawer');
      if(d && d.classList.contains('open')) on = true;
    }
    document.body.classList.toggle('veiled', on);
  }
  (function veilWatch(){
    try{
      const targets = [...document.querySelectorAll('.overlay')];
      const d = $('drawer');
      if(d) targets.push(d);
      if(!targets.length) return;
      const mo = new MutationObserver(veilCheck);
      for(const t of targets) mo.observe(t, {attributes:true, attributeFilter:['class']});
      veilCheck();
    }catch(e){}
  })();

  /* ---------------- IDLE ----------------
     Nothing on this screen is worth animating when nobody is looking at it.

     A minimised window, another tab in front, a locked laptop: the compositor
     keeps running every animation the page has asked for, and this page asks for
     a lot of them — thirty specks, a breathing glow, a pulsing halo. Browsers
     throttle timers in a hidden tab; they do not throttle CSS animations, and in
     a desktop wrapper there is no tab to hide in the first place. So the pane
     is switched off by hand and switched back on when somebody comes back.

     The timer is untouched by this. It works off wall-clock arithmetic against
     `S.endAt` rather than by counting ticks, so a session runs correctly whether
     or not anything was drawn while it did. */
  function idleWatch(){
    const apply = ()=>{
      const away = document.hidden === true;
      document.body.classList.toggle('away', away);
      const pane = $('vfx');
      /* Take the specks off the compositor entirely rather than pausing them.
         `animation-play-state:paused` leaves every layer allocated; display:none
         hands the memory back, and the field is rebuilt from the same key when
         it returns, so it comes back as it was. */
      if(pane) pane.classList.toggle('idle', away);
      if(!away){
        try{ glowFit(); }catch(e){}
        try{ render(); }catch(e){}
      }
    };
    document.addEventListener('visibilitychange', apply);
    apply();
  }
  idleWatch();
