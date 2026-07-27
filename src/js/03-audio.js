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
  function buzz(ms){ try{ navigator.vibrate && navigator.vibrate(ms); }catch(e){} }

