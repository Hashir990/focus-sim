  /* ---------- chime (Web Audio, generated) ---------- */
  function chime(rest){
    if(!S.sound) return;
    try{
      audio = audio || new (window.AudioContext||window.webkitAudioContext)();
      if(audio.state==='suspended') audio.resume();
      const notes = rest ? [523.25,659.25,784] : [784,587.33,440];
      notes.forEach((f,i)=>{
        const o=audio.createOscillator(), g=audio.createGain();
        o.type='sine'; o.frequency.value=f;
        const t=audio.currentTime + i*0.16;
        g.gain.setValueAtTime(0,t);
        g.gain.linearRampToValueAtTime(0.22,t+0.03);
        g.gain.exponentialRampToValueAtTime(0.0001,t+0.9);
        o.connect(g).connect(audio.destination);
        o.start(t); o.stop(t+1);
      });
    }catch(e){}
  }
  /* A much smaller sound than `chime`, for a message arriving. Two quiet notes
     and out — a session chime announces something you were waiting for, and a
     message is not that. Never played during a focus block; see 33-chat.js. */
  function blip(){
    if(!S.sound) return;
    try{
      audio = audio || new (window.AudioContext||window.webkitAudioContext)();
      if(audio.state==='suspended') audio.resume();
      [880, 1174.66].forEach((f,i)=>{
        const o=audio.createOscillator(), g=audio.createGain();
        o.type='sine'; o.frequency.value=f;
        const t=audio.currentTime + i*0.085;
        g.gain.setValueAtTime(0,t);
        g.gain.linearRampToValueAtTime(0.075,t+0.012);
        g.gain.exponentialRampToValueAtTime(0.0001,t+0.28);
        o.connect(g).connect(audio.destination);
        o.start(t); o.stop(t+0.32);
      });
    }catch(e){}
  }

  /* Pause and resume. One note each, a fifth apart and the right way round —
     down to pause, up to carry on — so you can tell which happened without
     looking. Quieter and shorter than `blip`, because this is a confirmation of
     something *you* just did rather than news: you already know you pressed it,
     and the sound is only there so you do not have to check.

     Follows the Chime setting like everything else that makes a noise. */
  function ding(up){
    if(!S.sound) return;
    try{
      audio = audio || new (window.AudioContext||window.webkitAudioContext)();
      if(audio.state==='suspended') audio.resume();
      const o=audio.createOscillator(), g=audio.createGain();
      o.type='sine'; o.frequency.value = up ? 784 : 523.25;
      const t=audio.currentTime;
      g.gain.setValueAtTime(0,t);
      g.gain.linearRampToValueAtTime(0.06,t+0.008);
      g.gain.exponentialRampToValueAtTime(0.0001,t+0.2);
      o.connect(g).connect(audio.destination);
      o.start(t); o.stop(t+0.24);
    }catch(e){}
  }

  /* A card turning over on the flip clock. Not a note — paper has no pitch, it
     is a short burst of noise with the highs rolled off. So: a handful of
     milliseconds of white noise through a lowpass, with a fast decay. Built
     fresh each time because the buffer is tiny (about 1200 samples) and holding
     one costs more attention than making one.

     Very quiet on purpose. This can fire four times in a second when every
     digit turns at once, and anything louder becomes a rattle. */
  function paper(){
    if(!S.sound) return;
    try{
      audio = audio || new (window.AudioContext||window.webkitAudioContext)();
      if(audio.state==='suspended') audio.resume();
      const n = Math.floor(audio.sampleRate * 0.028);
      const buf = audio.createBuffer(1, n, audio.sampleRate);
      const d = buf.getChannelData(0);
      for(let i=0;i<n;i++){
        // a short envelope over the noise, so it is a *tick* and not a hiss
        d[i] = (Math.random()*2-1) * Math.pow(1 - i/n, 2.6);
      }
      const src = audio.createBufferSource(); src.buffer = buf;
      const lp = audio.createBiquadFilter();
      lp.type='lowpass'; lp.frequency.value=2100; lp.Q.value=0.6;
      const g = audio.createGain(); g.gain.value = 0.09;
      src.connect(lp).connect(g).connect(audio.destination);
      src.start();
    }catch(e){}
  }

  function buzz(ms){ try{ navigator.vibrate && navigator.vibrate(ms); }catch(e){} }

