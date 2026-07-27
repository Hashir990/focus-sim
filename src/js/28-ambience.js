  /* ---------------- AMBIENCE ----------------
     Every sound here is synthesised in the browser with the Web Audio API — there
     are no audio files, so the app stays a single self-contained HTML file and
     works offline in every packaged build.

     The recipe in each case is a continuous noise bed shaped by filters, plus
     randomly scheduled one-shot events on top (droplets, birdsong, crackles).
     They are impressions of the real thing rather than recordings; the point is
     something steady to focus against, not realism.

     Everything hangs off one gain node, so stopping is always the same: kill the
     sources, clear the timers, drop the graph. */

  var AMB = { id:'off', vol:0.55, playing:null, live:null };

  var AMB_LIST = [
    ['off','Off'], ['rain','Rain'], ['forest','Forest'],
    ['cafe','Café'], ['office','Office'], ['campfire','Campfire'],
  ];

  var ambNoiseCache = {};

  function ambCtx(){
    try{
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if(audio.state === 'suspended') audio.resume();
      return audio;
    }catch(e){ return null; }
  }

  /** Two seconds of looping noise. Brown is noticeably warmer than white. */
  function ambNoise(ctx, kind){
    if(ambNoiseCache[kind]) return ambNoiseCache[kind];
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    if(kind === 'brown'){
      let last = 0;
      for(let i=0;i<len;i++){
        const white = Math.random()*2 - 1;
        last = (last + 0.02*white) / 1.02;
        d[i] = last * 3.2;
      }
    }else{
      for(let i=0;i<len;i++) d[i] = Math.random()*2 - 1;
    }
    ambNoiseCache[kind] = buf;
    return buf;
  }

  function ambBed(ctx, kind, filterType, freq, q, level){
    const src = ctx.createBufferSource();
    src.buffer = ambNoise(ctx, kind);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q || 0.7;
    const g = ctx.createGain(); g.gain.value = level;
    src.connect(f); f.connect(g);
    src.start();
    return {src, filter:f, gain:g};
  }

  /** Slow wander on a parameter — keeps a bed from sounding like a flat hiss. */
  function ambDrift(ctx, param, centre, depth, rate){
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rate;
    const amt = ctx.createGain(); amt.gain.value = depth;
    param.value = centre;
    lfo.connect(amt); amt.connect(param);
    lfo.start();
    return lfo;
  }

  /** A short filtered noise hit: droplets, crackles, key presses. */
  function ambBurst(ctx, out, o){
    const dur = o.dur || 0.08;
    const s = ctx.createBufferSource();
    s.buffer = ambNoise(ctx, o.kind || 'white');
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.value = o.freq || 1500;
    f.Q.value = o.q || 1;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.peak || 0.25, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random()*1.5);
    s.stop(t + dur + 0.02);
  }

  /** A short pitched tone: birdsong, cup clinks. */
  function ambTone(ctx, out, o){
    const dur = o.dur || 0.12;
    const osc = ctx.createOscillator();
    osc.type = o.wave || 'sine';
    const g = ctx.createGain();
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(o.from || 2200, t);
    if(o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.peak || 0.06, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  /** Fire `fn` at random intervals between lo and hi seconds. */
  function ambEvery(lo, hi, fn){
    let id = null;
    const loop = ()=>{
      fn();
      id = setTimeout(loop, (lo + Math.random()*(hi-lo)) * 1000);
    };
    id = setTimeout(loop, Math.random()*(hi*1000));
    return ()=>clearTimeout(id);
  }

  var AMB_BUILD = {
    // steady hiss with a low rumble under it, and irregular droplets on top
    rain(ctx, out){
      const bed = ambBed(ctx, 'white', 'bandpass', 1100, 0.5, 0.42);
      bed.gain.connect(out);
      const low = ambBed(ctx, 'brown', 'lowpass', 320, 0.7, 0.30);
      low.gain.connect(out);
      const lfo = ambDrift(ctx, bed.filter.frequency, 1100, 320, 0.05);
      const stopDrops = ambEvery(0.05, 0.22, ()=>{
        ambBurst(ctx, out, {freq: 2400 + Math.random()*2600, q: 6, dur: 0.05, peak: 0.05 + Math.random()*0.07});
      });
      return {stop(){ try{bed.src.stop(); low.src.stop(); lfo.stop();}catch(e){} stopDrops(); }};
    },

    // wind through leaves, with birds calling now and then
    forest(ctx, out){
      const bed = ambBed(ctx, 'brown', 'lowpass', 700, 0.6, 0.34);
      bed.gain.connect(out);
      const leaves = ambBed(ctx, 'white', 'bandpass', 3200, 1.4, 0.05);
      leaves.gain.connect(out);
      const lfo = ambDrift(ctx, bed.filter.frequency, 700, 380, 0.045);
      const lfo2 = ambDrift(ctx, leaves.gain.gain, 0.05, 0.04, 0.09);
      const stopBirds = ambEvery(2.4, 8, ()=>{
        const base = 1900 + Math.random()*1500;
        const n = 1 + (Math.random()*3|0);
        for(let i=0;i<n;i++){
          setTimeout(()=>ambTone(ctx, out, {
            from: base, to: base * (Math.random()<0.5 ? 1.5 : 0.7),
            dur: 0.07 + Math.random()*0.09, peak: 0.05
          }), i*130);
        }
      });
      return {stop(){ try{bed.src.stop(); leaves.src.stop(); lfo.stop(); lfo2.stop();}catch(e){} stopBirds(); }};
    },

    // low murmur of a room full of people, with occasional crockery
    cafe(ctx, out){
      const bed = ambBed(ctx, 'brown', 'lowpass', 620, 0.8, 0.40);
      bed.gain.connect(out);
      const air = ambBed(ctx, 'white', 'bandpass', 900, 0.9, 0.045);
      air.gain.connect(out);
      // the wander in level is what reads as conversation rather than hum
      const lfo = ambDrift(ctx, bed.gain.gain, 0.40, 0.13, 0.16);
      const lfo2 = ambDrift(ctx, bed.filter.frequency, 620, 180, 0.07);
      const stopClinks = ambEvery(3.5, 11, ()=>{
        ambTone(ctx, out, {from: 2400 + Math.random()*1400, wave:'triangle', dur: 0.16, peak: 0.045});
      });
      return {stop(){ try{bed.src.stop(); air.src.stop(); lfo.stop(); lfo2.stop();}catch(e){} stopClinks(); }};
    },

    // air conditioning, distant machines, someone typing
    office(ctx, out){
      const bed = ambBed(ctx, 'brown', 'lowpass', 240, 0.7, 0.34);
      bed.gain.connect(out);
      const hiss = ambBed(ctx, 'white', 'lowpass', 1400, 0.6, 0.035);
      hiss.gain.connect(out);
      const hum = ctx.createOscillator();
      hum.type = 'sine'; hum.frequency.value = 104;
      const humG = ctx.createGain(); humG.gain.value = 0.02;
      hum.connect(humG); humG.connect(out); hum.start();
      const stopKeys = ambEvery(0.12, 1.9, ()=>{
        const n = 1 + (Math.random()*5|0);      // little bursts, like words
        for(let i=0;i<n;i++){
          setTimeout(()=>ambBurst(ctx, out, {
            type:'highpass', freq: 2600, q: 0.8, dur: 0.022, peak: 0.035 + Math.random()*0.03
          }), i*(70 + Math.random()*70));
        }
      });
      return {stop(){ try{bed.src.stop(); hiss.src.stop(); hum.stop();}catch(e){} stopKeys(); }};
    },

    // the roar of a fire, with pops and spits
    campfire(ctx, out){
      const bed = ambBed(ctx, 'brown', 'lowpass', 820, 0.7, 0.40);
      bed.gain.connect(out);
      const lfo = ambDrift(ctx, bed.gain.gain, 0.40, 0.12, 0.23);
      const lfo2 = ambDrift(ctx, bed.filter.frequency, 820, 260, 0.13);
      const stopCrackle = ambEvery(0.08, 0.6, ()=>{
        const n = 1 + (Math.random()*3|0);
        for(let i=0;i<n;i++){
          setTimeout(()=>ambBurst(ctx, out, {
            freq: 900 + Math.random()*2600, q: 3.5,
            dur: 0.02 + Math.random()*0.05, peak: 0.05 + Math.random()*0.12
          }), i*(20 + Math.random()*60));
        }
      });
      return {stop(){ try{bed.src.stop(); lfo.stop(); lfo2.stop();}catch(e){} stopCrackle(); }};
    },
  };

  function ambStop(){
    if(AMB.live){
      try{ AMB.live.node.stop(); }catch(e){}
      try{ AMB.live.master.disconnect(); }catch(e){}
      AMB.live = null;
    }
    AMB.playing = null;
  }

  function ambStart(){
    if(AMB.id === 'off'){ ambStop(); return; }
    if(AMB.playing === AMB.id) return;      // already running
    ambStop();
    const ctx = ambCtx();
    if(!ctx || !AMB_BUILD[AMB.id]) return;
    try{
      const master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      const node = AMB_BUILD[AMB.id](ctx, master);
      // fade in, so switching sounds doesn't click
      const t = ctx.currentTime;
      master.gain.setValueAtTime(0.0001, t);
      master.gain.linearRampToValueAtTime(AMB.vol, t + 1.2);
      AMB.live = {master, node};
      AMB.playing = AMB.id;
    }catch(e){ ambStop(); }
  }

  function ambSetVolume(v){
    AMB.vol = Math.max(0, Math.min(1, v));
    if(AMB.live){
      try{
        const ctx = ambCtx();
        AMB.live.master.gain.setTargetAtTime(AMB.vol, ctx.currentTime, 0.05);
      }catch(e){}
    }
    ambSave();
  }

  function ambSet(id){
    AMB.id = id;
    ambTheme();
    ambRender();
    ambSave();
    if(id === 'off') ambStop();
    else ambStart();          // selecting is a user gesture, so it can start here
  }

  /** Repaint the app in colours that suit the sound. */
  function ambTheme(){
    const v = (AMB.id && AMB.id !== 'off') ? AMB.id : '';
    const app = document.getElementById('app');
    if(app) app.setAttribute('data-amb', v);
    document.body.setAttribute('data-amb', v);
  }

  function ambRender(){
    const grid = $('amb-grid');
    if(grid){
      grid.querySelectorAll('.amb-btn').forEach(b=>{
        b.classList.toggle('on', b.dataset.a === AMB.id);
      });
    }
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
        if(d && typeof d.id === 'string' && (d.id === 'off' || AMB_BUILD[d.id])) AMB.id = d.id;
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

