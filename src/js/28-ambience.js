  /* ---------------- AMBIENCE ----------------
     Real recordings, 45 minutes each, in dist/audio/. They are the only part of the
     app that isn't inside the single HTML file — an hour of audio can't be
     inlined, so `audio/` ships alongside index.html and every packaging target
     copies it.

     This replaced a synthesised version. Web Audio can make a passable rain or
     fire, but next to an actual recording it sounds harsh, and no amount of
     filtering fixes that. The synth is in the git history if it's ever wanted.

     **Looping: two elements that cross, rather than one that stops.** The first
     version played a track to its end, faded out over three seconds, went back
     to the start and faded in again. All of that is audible. Silence is not a
     quiet part of a recording of rain, it is the room going away, and it
     arrived on a timer you could set your watch by. The fade out and the fade
     in are also the same three seconds twice, so the seam ran six seconds and
     the middle of it was nothing at all.

     So there are two elements and they overlap. The second starts three seconds
     before the first ends, and across those three seconds one rises while the
     other falls. A ticker drives the gains rather than the `timeupdate` event,
     which only fires about four times a second — too coarse to sound smooth. */

  var AMB = { id:'off', vol:0.7, el:null, el2:null, cur:0, tick:null,
              wanted:false, warned:false, primed:false };

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

  var AMB_FADE = 3;          // seconds, the length of the overlap

  /* How far ahead of the seam the other element is told to load. `preload` is
     'none', so without this the crossfade would ask a cold element to start
     playing three seconds from now and get a stall where the overlap should be.
     It is the same URL as the one already sounding, so this is nearly always
     the cache answering. Nearly always is not a thing to build a seam on. */
  var AMB_ARM = 20;

  /** One of the pair. `i` is 0 or 1; they are identical and take turns. */
  function ambElement(i){
    const key = i ? 'el2' : 'el';
    if(AMB[key]) return AMB[key];
    const el = document.createElement('audio');
    el.preload = 'none';     // 52 MB of audio must not load until it's asked for
    el.loop = false;         // we handle the repeat, so we can fade across it
    el.volume = 0;
    el.setAttribute('aria-hidden','true');

    /* **A safety net, not the mechanism.** The ticker starts the other element
       three seconds before this one runs out, so by the time this fires the
       sound has already moved across and there is nothing to do. It stays
       because a tab throttled in the background can skip the whole window: the
       ticker does not run, nothing takes over, and without this the ambience
       would simply stop. Restarting into silence is worse than a crossfade and
       a great deal better than the end. */
    el.addEventListener('ended', ()=>{
      if(!AMB.wanted) return;
      const other = AMB[i ? 'el' : 'el2'];
      if(other && !other.paused) return;      // the overlap did its job
      try{ el.currentTime = 0; el.play(); }catch(e){}
      AMB.cur = i;
    });
    el.addEventListener('error', ()=>{
      if(AMB.warned) return;
      AMB.warned = true;
      toast('Ambience audio not found');
    });

    document.body.appendChild(el);
    AMB[key] = el;
    return el;
  }
  /** The one sounding now, and the one waiting its turn. */
  function ambNow(){ return ambElement(AMB.cur); }
  function ambNext(){ return ambElement(AMB.cur ? 0 : 1); }

  /* **Why these are sines and not fractions.**

     Halfway through a crossfade both tracks sit at half volume, and two
     different recordings at half volume are not half as loud together. They are
     uncorrelated, so their powers add rather than their amplitudes, and a half
     plus a half comes to about 0.71 of the original. A straight-line crossfade
     therefore dips in the middle, which over rain is a soft breath you hear
     every time round — a quieter version of the fault being fixed. Sine and
     cosine square to one, so the pair holds its level the whole way across.

     One curve covers three jobs, which is the reason to write it this way: the
     start of a session, the end of one, and either side of a seam. In the first
     two there is nothing on the other side to add to, and a sine rising from
     silence is already the right fade. */
  function ambFadeFactor(el){
    const d = el.duration;
    if(!isFinite(d) || d <= 0) return 1;
    const t = el.currentTime;
    const arc = (x)=>Math.sin(Math.max(0, Math.min(1, x)) * Math.PI / 2);
    if(t < AMB_FADE) return arc(t / AMB_FADE);
    const left = d - t;
    if(left < AMB_FADE) return arc(left / AMB_FADE);
    return 1;
  }

  function ambLevel(el){
    return AMB.vol * (AMB_GAIN[AMB.id] || 1) * ambFadeFactor(el);
  }

  /* The seam, decided once a beat rather than scheduled in advance.

     Scheduling would mean trusting `duration` at the moment a track starts, and
     for a streamed mp3 that number arrives late and sometimes changes. Asking
     how much is left, twelve times a second, needs no trust at all, and it is
     right again immediately after a seek, a stall, or a tab that was asleep. */
  function ambSeam(){
    const el = ambNow(), other = ambNext();
    if(el.paused) return;
    const d = el.duration;
    if(!isFinite(d) || d <= 0) return;
    const want = AMB_TRACKS[AMB.id];
    if(!want) return;
    const left = d - el.currentTime;

    if(left <= AMB_FADE + AMB_ARM && (!other.src || other.src.indexOf(want) === -1)){
      other.src = want;
      try{ other.load(); }catch(e){}
    }
    if(left <= AMB_FADE && other.paused){
      try{
        other.currentTime = 0;
        other.volume = 0;
        const p = other.play();
        if(p && p.catch) p.catch(()=>{});
        AMB.cur = AMB.cur ? 0 : 1;      // the newcomer is the one sounding now
      }catch(e){}
    }
  }

  function ambTicker(){
    clearInterval(AMB.tick);
    AMB.tick = setInterval(()=>{
      ambSeam();
      /* Both of them, because for three seconds in every forty-five minutes
         they are both sounding and each needs its own side of the curve. */
      const now = ambNow();
      for(const el of [AMB.el, AMB.el2]){
        if(!el || el.paused) continue;
        el.volume = Math.max(0, Math.min(1, ambLevel(el)));
        /* The one that has finished crossing out is put down rather than left
           to reach its own `ended`: a paused element is one the browser can
           stop decoding, and keeping two decoders alive for a sound only one of
           which can be heard is work for nothing. */
        const d = el.duration;
        if(el !== now && isFinite(d) && d > 0 && d - el.currentTime <= 0.15){
          try{ el.pause(); el.currentTime = 0; }catch(e){}
        }
      }
    }, 80);
  }

  /* ---- letting it play at all ----

     **A follower's timer is started by somebody else's finger.** Autoplay is
     allowed only for an element that has already been played from a user
     gesture, and in a shared room the gesture belongs to the leader: the
     follower's clock starts because a `state` message arrived, which is not a
     gesture on their machine. `el.play()` rejects, the `.catch(()=>{})` in
     `ambStart` swallows it, and the ambience is simply silent for everyone who
     is not holding the timer — with nothing anywhere saying so.

     The fix is the standard one and it has to happen while a real gesture is on
     the stack: play the element and pause it again immediately. That is enough
     for the browser to mark it as user-initiated, and every programmatic
     `play()` afterwards is allowed. It is muted and lasts a frame, so there is
     nothing to hear.

     Once, on the first gesture of the session, whatever that gesture was —
     joining a room is a click, so a follower is always primed before the
     leader can start anything. */
  function ambPrime(){
    if(AMB.primed) return;
    AMB.primed = true;
    /* **Both of them.** Autoplay is granted per element, and the one that takes
       over at a seam does so forty-five minutes after the last thing anybody
       touched. Priming only the first would mean every loop handing over to an
       element the browser has never been told it may play: `play()` rejects,
       the catch swallows it, and the sound stops at the first seam with
       nothing anywhere saying why. */
    try{
      for(const el of [ambElement(0), ambElement(1)]){
        const was = el.volume;
        el.volume = 0;
        const p = el.play();
        const settle = ()=>{ try{ if(!AMB.wanted) el.pause(); }catch(e){} el.volume = was; };
        if(p && p.then) p.then(settle, settle); else settle();
      }
    }catch(e){}
  }
  try{
    ['pointerdown','keydown','touchstart'].forEach(ev=>
      document.addEventListener(ev, ambPrime, {once:false, passive:true, capture:true}));
  }catch(e){}

  function ambStart(){
    if(AMB.id === 'off' || !AMB_TRACKS[AMB.id]){ ambStop(); return; }
    AMB.wanted = true;
    const el = ambNow();
    const want = AMB_TRACKS[AMB.id];
    // el.src is resolved to an absolute URL, so compare on the tail
    if(!el.src || el.src.indexOf(want) === -1){
      el.src = want;
      el.load();
    }
    el.volume = 0;
    const p = el.play();
    /* Blocked until a gesture — and in a shared room the gesture is somebody
       else's, which is why `ambPrime()` above exists. Swallowed rather than
       reported because by the time it can succeed it will, and a warning about
       a thing that fixes itself is noise. */
    if(p && p.catch) p.catch(()=>{});
    ambTicker();
  }

  function ambStop(){
    AMB.wanted = false;
    clearInterval(AMB.tick); AMB.tick = null;
    /* Both: stopping during the three seconds of a handover leaves two
       elements sounding, and quietening one of them is a fade to half. */
    const live = [AMB.el, AMB.el2].filter(el=>el && !el.paused);
    if(!live.length) return;
    // short ramp down so pausing doesn't click
    const from = live.map(el=>el.volume);
    let step = 0;
    const fade = setInterval(()=>{
      step++;
      live.forEach((el, i)=>{ el.volume = Math.max(0, from[i] * (1 - step/8)); });
      if(step >= 8){
        clearInterval(fade);
        for(const el of live){ try{ el.pause(); }catch(e){} }
      }
    }, 25);
  }

  function ambSetVolume(v){
    AMB.vol = Math.max(0, Math.min(1, v));
    for(const el of [AMB.el, AMB.el2]){
      if(el && !el.paused) el.volume = Math.max(0, Math.min(1, ambLevel(el)));
    }
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
    if(changed){
      /* Both, and back to the first seat. Pausing only the one that happened to
         be sounding would leave the other mid-handover with the old track still
         in it, and the next seam would cross into the sound you just changed
         away from. */
      for(const el of [AMB.el, AMB.el2]){ try{ if(el) el.pause(); }catch(e){} }
      AMB.cur = 0;
    }
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
        b.dataset.cost = sd ? Tn('{n} ember', '{n} embers', sd.cost) : '';
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

