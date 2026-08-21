  /* ---------------- AMBIENCE ----------------
     Real recordings, 45 minutes each, in dist/audio/. They are the only part of the
     app that isn't inside the single HTML file — an hour of audio can't be
     inlined, so `audio/` ships alongside index.html and every packaging target
     copies it.

     This replaced a synthesised version. Web Audio can make a passable rain or
     fire, but next to an actual recording it sounds harsh, and no amount of
     filtering fixes that. The synth is in the git history if it's ever wanted.

     Looping: each track plays to its end, fades out over three seconds, restarts,
     and fades back in. A ticker drives the fade rather than the `timeupdate`
     event, which only fires about four times a second — too coarse to sound
     smooth. */

  var AMB = { id:'off', vol:0.7, el:null, tick:null, wanted:false, warned:false };

  var AMB_LIST = [
    ['off','Off'], ['rain','Rain'], ['forest','Forest'],
    ['cafe','Café'], ['office','Office'], ['campfire','Campfire'],
  ];

  var AMB_TRACKS = {
    rain:'audio/rain.mp3', forest:'audio/forest.mp3', cafe:'audio/cafe.mp3',
    office:'audio/office.mp3', campfire:'audio/campfire.mp3',
  };

  /* Per-track trim, so no ambience is louder than another.

     Measured with ebur128 after encoding; each track is scaled down to match the
     quietest (café, at -30.5 LUFS). Doing it here rather than baking gain into the
     files avoids a second lossy encode — and re-encoding an already-32 kbps file
     is exactly how you reintroduce the artifacts we just removed. */
  var AMB_GAIN = {
    rain: 0.79,       // -28.5 LUFS
    forest: 0.68,     // -27.1
    cafe: 1.00,       // -30.5, the quietest, so it sets the reference
    office: 0.63,     // -26.5
    campfire: 0.88,   // -29.4
  };

  var AMB_FADE = 3;          // seconds, in and out

  function ambElement(){
    if(AMB.el) return AMB.el;
    const el = document.createElement('audio');
    el.preload = 'none';     // 52 MB of audio must not load until it's asked for
    el.loop = false;         // we handle the repeat, so we can fade across it
    el.volume = 0;
    el.setAttribute('aria-hidden','true');

    el.addEventListener('ended', ()=>{
      if(!AMB.wanted) return;
      try{ el.currentTime = 0; el.play(); }catch(e){}
    });
    el.addEventListener('error', ()=>{
      if(AMB.warned) return;
      AMB.warned = true;
      toast('Ambience audio not found');
    });

    document.body.appendChild(el);
    AMB.el = el;
    return el;
  }

  /** Volume for right now: ramps in at the start and out at the end. */
  function ambFadeFactor(el){
    const d = el.duration;
    if(!isFinite(d) || d <= 0) return 1;
    const t = el.currentTime;
    if(t < AMB_FADE) return Math.max(0, t / AMB_FADE);
    const left = d - t;
    if(left < AMB_FADE) return Math.max(0, left / AMB_FADE);
    return 1;
  }

  function ambLevel(el){
    return AMB.vol * (AMB_GAIN[AMB.id] || 1) * ambFadeFactor(el);
  }

  function ambTicker(){
    clearInterval(AMB.tick);
    AMB.tick = setInterval(()=>{
      const el = AMB.el;
      if(!el || el.paused){ return; }
      el.volume = Math.max(0, Math.min(1, ambLevel(el)));
    }, 80);
  }

  function ambStart(){
    if(AMB.id === 'off' || !AMB_TRACKS[AMB.id]){ ambStop(); return; }
    AMB.wanted = true;
    const el = ambElement();
    const want = AMB_TRACKS[AMB.id];
    // el.src is resolved to an absolute URL, so compare on the tail
    if(!el.src || el.src.indexOf(want) === -1){
      el.src = want;
      el.load();
    }
    el.volume = 0;
    const p = el.play();
    if(p && p.catch) p.catch(()=>{});   // blocked until a gesture; harmless
    ambTicker();
  }

  function ambStop(){
    AMB.wanted = false;
    clearInterval(AMB.tick); AMB.tick = null;
    const el = AMB.el;
    if(!el) return;
    // short ramp down so pausing doesn't click
    const from = el.volume;
    let step = 0;
    const fade = setInterval(()=>{
      step++;
      el.volume = Math.max(0, from * (1 - step/8));
      if(step >= 8){
        clearInterval(fade);
        try{ el.pause(); }catch(e){}
      }
    }, 25);
  }

  function ambSetVolume(v){
    AMB.vol = Math.max(0, Math.min(1, v));
    const el = AMB.el;
    if(el && !el.paused) el.volume = Math.max(0, Math.min(1, ambLevel(el)));
    ambSave();
  }

  function ambSet(id){
    /* A track you haven't unlocked isn't chosen, it's offered — see
       EMB_SOUNDS in 37-embers.js. Rain and Café cost nothing, so there is
       always something to put on. */
    if(id !== 'off' && !embHasSound(id)){ Embers.buySound(id, ()=>ambSet(id)); return; }
    const changed = id !== AMB.id;
    AMB.id = id;
    AMB.warned = false;
    ambTheme();
    ambRender();
    ambSave();
    // rides in `sim`, which is settled by `S.at` — see Embers.use()
    try{ save(); }catch(e){}
    if(id === 'off'){ ambStop(); return; }
    if(changed && AMB.el){ try{ AMB.el.pause(); }catch(e){} }
    ambStart();               // selecting is a user gesture, so it can start here
  }

  /** Repaint the app in colours that suit the sound, and set its weather going. */
  function ambTheme(){
    const v = (AMB.id && AMB.id !== 'off') ? AMB.id : '';
    const app = document.getElementById('app');
    if(app) app.setAttribute('data-amb', v);
    document.body.setAttribute('data-amb', v);
    ambVfx();
  }

  /** One pane, one look — see Embers.look() in 37-embers.js. */
  function ambVfx(){
    try{ Embers.paint(); }catch(e){}
  }

  function ambRender(){
    const grid = $('amb-grid');
    if(grid){
      grid.querySelectorAll('.amb-btn').forEach(b=>{
        const id = b.dataset.a;
        const locked = id !== 'off' && typeof embHasSound === 'function' && !embHasSound(id);
        b.classList.toggle('on', id === AMB.id);
        b.classList.toggle('locked', locked);
        const sd = locked && typeof embSound === 'function' ? embSound(id) : null;
        b.dataset.cost = sd ? sd.cost + ' embers' : '';
      });
    }
    // the shelf shows which of the two is on, so it has to hear about this —
    // the track can be changed from the menu without the shelf being touched
    try{ Embers.render(); }catch(e){}
    const vol = $('amb-vol');
    if(vol && document.activeElement !== vol) vol.value = Math.round(AMB.vol*100);
    const row = $('amb-vol-row');
    if(row) row.classList.toggle('hide', AMB.id === 'off');
  }

  function ambSave(){
    try{ KV.set('focus_amb', JSON.stringify({id:AMB.id, vol:AMB.vol})); }catch(e){}
  }
  async function ambLoad(){
    try{
      const r = await KV.get('focus_amb');
      if(r && r.value){
        const d = JSON.parse(r.value);
        if(d && typeof d.id === 'string' && (d.id === 'off' || AMB_TRACKS[d.id])) AMB.id = d.id;
        // a save from before these were unlockable, or a reset since: don't
        // silently play something that isn't owned
        try{ if(AMB.id !== 'off' && !embHasSound(AMB.id)) AMB.id = 'off'; }catch(e){}
        if(d && typeof d.vol === 'number') AMB.vol = Math.max(0, Math.min(1, d.vol));
      }
    }catch(e){}
    ambTheme();
    ambRender();
  }

  // build the picker
  (function(){
    const grid = $('amb-grid');
    if(!grid) return;
    grid.innerHTML = '';
    AMB_LIST.forEach(([id,label])=>{
      const b = document.createElement('button');
      b.className = 'amb-btn'; b.dataset.a = id; b.textContent = label;
      b.onclick = ()=>ambSet(id);
      grid.appendChild(b);
    });
    const vol = $('amb-vol');
    if(vol) vol.addEventListener('input', ()=>ambSetVolume(vol.value/100));
  })();

