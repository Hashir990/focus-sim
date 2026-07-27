  /* ---------------- AMBIENCE ----------------
     Every sound here is synthesised in the browser with the Web Audio API — there
     are no audio files, so the app stays a single self-contained HTML file and
     works offline in every packaged build.

     Three rules learned the hard way, after the first version buzzed:

     1. ONE noise buffer, white, and everything else is a filter on it. Generating
        "brown" noise as a random walk scaled up clipped past ±1, and clipping is
        what distortion sounds like. A lowpass on white noise gives the same warmth
        with no chance of it. It also loops cleanly — a brown-noise buffer has
        strong low frequencies, so its loop point is an audible click.
     2. NO bare oscillator drones. A steady sine is a hum, not an ambience. Pitched
        tones only ever appear as short events (birdsong, a phone, crockery).
     3. Keep filter Q low. A high-Q bandpass on noise rings like a whistle; that
        was the "buzz" in the rain droplets.

     Everything is summed into one gain, then a limiter, so no combination of
     layers can drive the output into distortion. */

  var AMB = { id:'off', vol:0.55, playing:null, live:null };

  var AMB_LIST = [
    ['off','Off'], ['rain','Rain'], ['forest','Forest'],
    ['cafe','Café'], ['office','Office'], ['campfire','Campfire'],
  ];

  var ambBuf = null;

  function ambCtx(){
    try{
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if(audio.state === 'suspended') audio.resume();
      return audio;
    }catch(e){ return null; }
  }

  /** Six seconds of white noise. Long enough that the loop isn't recognisable,
      and white noise loops without a click because a seam is just more noise. */
  function ambNoise(ctx){
    if(ambBuf) return ambBuf;
    const len = Math.floor(ctx.sampleRate * 6);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for(let i=0;i<len;i++) d[i] = (Math.random()*2 - 1) * 0.5;
    ambBuf = buf;
    return buf;
  }

  /** A continuous layer: noise shaped by one filter. */
  function ambBed(ctx, out, o){
    const src = ctx.createBufferSource();
    src.buffer = ambNoise(ctx);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'lowpass';
    f.frequency.value = o.freq;
    f.Q.value = o.q == null ? 0.6 : o.q;
    const g = ctx.createGain();
    g.gain.value = o.level;
    src.connect(f); f.connect(g); g.connect(out);
    src.start(0, Math.random()*5);
    return {src, filter:f, gain:g};
  }

  /** Slow wander on a parameter — keeps a bed from sounding like flat hiss. */
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
    const dur = o.dur || 0.06;
    const s = ctx.createBufferSource();
    s.buffer = ambNoise(ctx);
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'bandpass';
    f.frequency.value = o.freq || 1500;
    f.Q.value = o.q == null ? 1.2 : o.q;      // low Q: a tap, not a whistle
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.peak || 0.05, t + (o.attack || 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random()*5);
    s.stop(t + dur + 0.02);
  }

  /** A short pitched event: birdsong, crockery, a phone. Never sustained. */
  function ambTone(ctx, out, o){
    const dur = o.dur || 0.12;
    const osc = ctx.createOscillator();
    osc.type = o.wave || 'sine';
    const g = ctx.createGain();
    const t = (o.at || ctx.currentTime);
    osc.frequency.setValueAtTime(o.from || 2200, t);
    if(o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.peak || 0.04, t + (o.attack || 0.012));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + dur + 0.03);
  }

  /* ---- voices ----
     A vowel is essentially two resonant peaks (formants) over a buzzy source. Run
     noise through two bandpass filters at those frequencies, wrap it in a quick
     envelope, and you get a syllable: unintelligible, but unmistakably a person.
     Strings of them read as conversation; a fast descending string reads as a
     laugh. Everything is deliberately indistinct — it should sit behind you. */
  var AMB_VOWELS = [[730,1090],[660,1720],[530,1840],[570,840],[440,1020],[300,870],[490,1350]];

  function ambSyllable(ctx, out, o){
    const v = AMB_VOWELS[Math.random()*AMB_VOWELS.length|0];
    const pitch = o.pitch || 1;
    const dur = o.dur || (0.10 + Math.random()*0.10);
    const t = (o.at || ctx.currentTime);

    const s = ctx.createBufferSource();
    s.buffer = ambNoise(ctx);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(o.peak || 0.04, t + dur*0.28);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(env);

    for(let i=0;i<2;i++){
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = v[i] * pitch * (0.92 + Math.random()*0.16);
      f.Q.value = 4;                       // vocal, but not a ringing whistle
      const lvl = ctx.createGain();
      lvl.gain.value = i === 0 ? 1 : 0.55;
      env.connect(f); f.connect(lvl); lvl.connect(out);
    }
    s.start(t, Math.random()*5);
    s.stop(t + dur + 0.03);
  }

  /** A phrase of speech: several syllables, gently trailing off. */
  function ambSpeak(ctx, out, o){
    const n = (o.min || 3) + (Math.random()*((o.max || 7) - (o.min || 3))|0);
    const pitch = o.pitch || (0.85 + Math.random()*0.5);
    let at = ctx.currentTime;
    for(let i=0;i<n;i++){
      const dur = 0.09 + Math.random()*0.11;
      ambSyllable(ctx, out, {at, dur, pitch, peak: (o.peak || 0.035) * (1 - i/(n*1.6))});
      at += dur + 0.02 + Math.random()*0.07;
    }
  }

  /** A laugh: quick, even, descending, and a bit louder than talking. */
  function ambLaugh(ctx, out, o){
    const n = 4 + (Math.random()*4|0);
    const pitch = 1.15 + Math.random()*0.4;
    const gap = 0.115 + Math.random()*0.05;
    let at = ctx.currentTime;
    for(let i=0;i<n;i++){
      ambSyllable(ctx, out, {
        at, dur: 0.085,
        pitch: pitch * (1 - i*0.045),
        peak: (o && o.peak || 0.055) * (1 - i*0.11)
      });
      at += gap;
    }
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
    // A full sheet of rain rather than scattered drips: a wide hiss, a low
    // rumble under it, and only gentle spatter on top.
    rain(ctx, out){
      const sheet = ambBed(ctx, out, {type:'lowpass', freq:5200, q:0.4, level:0.16});
      const cut = ctx.createBiquadFilter();      // trim the very bottom of the hiss
      cut.type = 'highpass'; cut.frequency.value = 420;
      sheet.gain.disconnect(); sheet.gain.connect(cut); cut.connect(out);

      const rumble = ambBed(ctx, out, {type:'lowpass', freq:420, q:0.5, level:0.07});
      const d1 = ambDrift(ctx, sheet.gain.gain, 0.16, 0.03, 0.045);
      const d2 = ambDrift(ctx, rumble.gain.gain, 0.07, 0.022, 0.031);

      const stopSpatter = ambEvery(0.10, 0.34, ()=>{
        ambBurst(ctx, out, {freq: 1800 + Math.random()*2200, q: 1.1, dur: 0.045, peak: 0.010 + Math.random()*0.010});
      });
      return {stop(){ try{sheet.src.stop(); rumble.src.stop(); d1.stop(); d2.stop();}catch(e){} stopSpatter(); }};
    },

    forest(ctx, out){
      const wind = ambBed(ctx, out, {type:'lowpass', freq:820, q:0.5, level:0.26});
      const leaves = ambBed(ctx, out, {type:'bandpass', freq:2800, q:0.8, level:0.046});
      const d1 = ambDrift(ctx, wind.filter.frequency, 820, 340, 0.04);
      const d2 = ambDrift(ctx, leaves.gain.gain, 0.046, 0.032, 0.085);
      const stopBirds = ambEvery(3, 9, ()=>{
        const base = 1900 + Math.random()*1400;
        const n = 1 + (Math.random()*3|0);
        for(let i=0;i<n;i++){
          setTimeout(()=>ambTone(ctx, out, {
            from: base, to: base * (Math.random()<0.5 ? 1.45 : 0.72),
            dur: 0.07 + Math.random()*0.08, peak: 0.05
          }), i*135);
        }
      });
      return {stop(){ try{wind.src.stop(); leaves.src.stop(); d1.stop(); d2.stop();}catch(e){} stopBirds(); }};
    },

    // Friendly: near-constant good-natured chatter, laughter every so often,
    // cups and saucers in the background.
    cafe(ctx, out){
      const room = ambBed(ctx, out, {type:'lowpass', freq:560, q:0.6, level:0.26});
      const air = ambBed(ctx, out, {type:'bandpass', freq:1100, q:0.7, level:0.040});
      const d1 = ambDrift(ctx, room.gain.gain, 0.26, 0.07, 0.13);

      // chatter is the point of a cafe, so it sits above the room tone
      const stopTalk = ambEvery(0.4, 1.8, ()=>{
        ambSpeak(ctx, out, {min:2, max:6, peak:0.058, pitch: 0.9 + Math.random()*0.6});
      });
      const stopLaugh = ambEvery(6, 16, ()=>ambLaugh(ctx, out, {peak:0.09}));
      const stopCups = ambEvery(4, 12, ()=>{
        const n = 1 + (Math.random()<0.35 ? 1 : 0);
        for(let i=0;i<n;i++){
          setTimeout(()=>ambTone(ctx, out, {
            from: 2300 + Math.random()*1500, wave:'triangle',
            dur: 0.13, peak: 0.05
          }), i*(90 + Math.random()*80));
        }
      });
      return {stop(){
        try{room.src.stop(); air.src.stop(); d1.stop();}catch(e){}
        stopTalk(); stopLaugh(); stopCups();
      }};
    },

    // Computers and a phone, with low, businesslike talk. No hum: the fan is
    // filtered noise, because a sine wave here is exactly what buzzed before.
    office(ctx, out){
      const fan = ambBed(ctx, out, {type:'lowpass', freq:330, q:0.5, level:0.32});
      const vent = ambBed(ctx, out, {type:'bandpass', freq:1000, q:0.5, level:0.036});
      const d1 = ambDrift(ctx, fan.gain.gain, 0.32, 0.05, 0.037);

      const stopKeys = ambEvery(0.35, 2.6, ()=>{
        const n = 2 + (Math.random()*7|0);          // a burst, like a word typed
        for(let i=0;i<n;i++){
          setTimeout(()=>ambBurst(ctx, out, {
            type:'highpass', freq: 2800, q: 0.7, dur: 0.016, peak: 0.030 + Math.random()*0.024
          }), i*(65 + Math.random()*60));
        }
      });
      const stopClicks = ambEvery(5, 16, ()=>{
        ambBurst(ctx, out, {type:'bandpass', freq: 1900, q: 1.4, dur: 0.012, peak: 0.042});
      });
      // a soft two-tone desk phone, three rings, well spaced out
      const stopPhone = ambEvery(28, 70, ()=>{
        for(let r=0;r<3;r++){
          const base = ctx.currentTime + r*1.1;
          for(let k=0;k<2;k++){
            ambTone(ctx, out, {at: base + k*0.22, from: k ? 1040 : 880, dur: 0.19, peak: 0.045, attack: 0.02});
          }
        }
      });
      // low and businesslike — the opposite of the cafe's pitch range
      const stopTalk = ambEvery(6, 17, ()=>{
        ambSpeak(ctx, out, {min:3, max:8, peak:0.046, pitch: 0.72 + Math.random()*0.25});
      });
      return {stop(){
        try{fan.src.stop(); vent.src.stop(); d1.stop();}catch(e){}
        stopKeys(); stopClicks(); stopPhone(); stopTalk();
      }};
    },

    campfire(ctx, out){
      const fire = ambBed(ctx, out, {type:'lowpass', freq:700, q:0.5, level:0.34});
      const d1 = ambDrift(ctx, fire.gain.gain, 0.34, 0.09, 0.2);
      const d2 = ambDrift(ctx, fire.filter.frequency, 700, 200, 0.11);
      const stopCrackle = ambEvery(0.18, 1.1, ()=>{
        const n = 1 + (Math.random()*3|0);
        for(let i=0;i<n;i++){
          setTimeout(()=>ambBurst(ctx, out, {
            freq: 900 + Math.random()*1900, q: 1.6,
            dur: 0.018 + Math.random()*0.03, peak: 0.038 + Math.random()*0.07
          }), i*(25 + Math.random()*55));
        }
      });
      const stopPops = ambEvery(5, 14, ()=>{
        ambBurst(ctx, out, {freq: 500 + Math.random()*500, q: 1.1, dur: 0.07, peak: 0.12});
      });
      return {stop(){ try{fire.src.stop(); d1.stop(); d2.stop();}catch(e){} stopCrackle(); stopPops(); }};
    },
  };

  function ambStop(){
    if(AMB.live){
      try{ AMB.live.node.stop(); }catch(e){}
      try{ AMB.live.master.disconnect(); }catch(e){}
      try{ AMB.live.limiter.disconnect(); }catch(e){}
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
      // master → gentle top-end roll-off → limiter → out.
      // The limiter is the safety net: however the layers happen to line up, the
      // output can't be driven into clipping, which is what distortion is.
      const master = ctx.createGain();
      master.gain.value = 0.0001;

      const soften = ctx.createBiquadFilter();
      soften.type = 'lowpass';
      soften.frequency.value = 7200;
      soften.Q.value = 0.5;

      const limiter = ctx.createDynamicsCompressor();
      try{
        limiter.threshold.value = -14;
        limiter.knee.value = 12;
        limiter.ratio.value = 8;
        limiter.attack.value = 0.004;
        limiter.release.value = 0.22;
      }catch(e){}

      master.connect(soften); soften.connect(limiter); limiter.connect(ctx.destination);

      const node = AMB_BUILD[AMB.id](ctx, master);
      const t = ctx.currentTime;
      master.gain.setValueAtTime(0.0001, t);
      master.gain.linearRampToValueAtTime(AMB.vol, t + 1.4);   // fade in, no click

      AMB.live = {master, soften, limiter, node};
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

