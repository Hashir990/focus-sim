  /* ---------- resting when nobody is looking ----------

     One class on `<html>`, and 34-rest.css does the rest. Kept as its own file
     because it is the only thing in the app that cares about whether anyone is
     actually looking at it, and burying that in the timer would hide it.

     **The buddy is stopped rather than paused-in-place.** `animation-play-state`
     alone would leave his layer alive: still composited, still a texture on the
     GPU, just not moving. Setting `display:none` on the layer while hidden lets
     the compositor drop it altogether, which is the actual saving. He is put
     back on return, and because the animations are all `infinite` with no state
     of their own he simply carries on — there is nothing to restore.

     Nothing here touches the clock. The timer is `endAt` minus `Date.now()`, so
     it is right when you come back no matter what the browser did to the
     interval in between; that is why it was written that way. */

  var REST_HIDDEN = false;

  function restSet(hidden){
    if(hidden === REST_HIDDEN) return;
    REST_HIDDEN = hidden;
    try{ document.documentElement.classList.toggle('at-rest', hidden); }catch(e){}
    /* The effects layer is the expensive one — seventeen infinite animations
       over the whole window — so it is taken out of the tree rather than merely
       stilled. `.bud-layer` has its own `hide` for being switched off in
       settings, so this uses a different class and cannot fight it. */
    try{
      const v = $('vfx');
      if(v) v.style.display = hidden ? 'none' : '';
      const b = $('bud-layer');
      if(b) b.classList.toggle('at-rest-off', hidden);
    }catch(e){}
    /* Coming back from a long time away, the day may have turned over while we
       were not running the once-a-minute check. Cheap, and it is the difference
       between opening the laptop to today's plan and to yesterday's. */
    if(!hidden){ try{ planSpawnDue(); }catch(e){} }
  }

  function restWatch(){
    try{
      document.addEventListener('visibilitychange', ()=>{
        restSet(document.visibilityState !== 'visible');
      });
      restSet(document.visibilityState !== 'visible');
    }catch(e){}
  }
