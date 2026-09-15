  /* ---------------- time in the arcade ----------------
     How long has gone on each game, for Your focus.

     **Playing, not having a board open.** The clock runs while a game is on
     screen, the window is visible, and something has been pressed in the last
     two minutes. The third condition is the one that makes the number mean
     anything: a crossword left open on a laptop over lunch is two hours of
     nothing, and a total that says you played for two hours inside a
     twenty-five minute cycle is one nobody believes afterwards. Two minutes
     without a key, a tap or a scroll and the clock stops where the last one
     was; the next one starts it again, and the gap is not counted.

     **Banked as it goes, not kept as a start time.** A start time lasts only
     as long as the page does, and a phone kills a backgrounded app without
     asking. So the running stretch is added to the total every fifteen seconds
     and on the two events a shutdown still fires, and a killed session loses
     at most the last beat.

     **This device's, not the account's.** A total that follows an account has
     to add two devices' time without counting either twice, which means a
     counter per device, and both copies of the merge rules (47-merge.js and
     server/accounts.js) changing together with a Worker deploy. Until that is
     done it is kept here, like the settings that are this device's own. */
  const PLAY_KEY = 'focus_play';
  const PLAY_IDLE = 120 * 1000;
  const PLAY_BEAT = 15 * 1000;
  let PLAY = Object.create(null);     // game id -> seconds
  let PLAY_ON = '';                   // the game on screen, or ''
  let PLAY_AT = 0;                    // counted up to here
  let PLAY_IN = 0;                    // the last key, tap or scroll
  let PLAY_HIDDEN = false;
  let PLAY_DIRTY = false;

  function playClean(v){
    const out = Object.create(null);
    if(!v || typeof v !== 'object') return out;
    for(const k in v){
      if(!Object.prototype.hasOwnProperty.call(v, k) || !/^[a-z0-9_-]{1,32}$/i.test(k)) continue;
      const n = +v[k];
      if(n > 0 && isFinite(n)) out[k] = Math.round(n * 10) / 10;
    }
    return out;
  }
  async function playLoad(){
    try{
      const r = await KV.get(PLAY_KEY);
      if(r && r.value) PLAY = playClean(JSON.parse(r.value));
    }catch(e){}
  }
  function playSave(){
    if(!PLAY_DIRTY) return;
    PLAY_DIRTY = false;
    try{ KV.set(PLAY_KEY, JSON.stringify(PLAY)); }catch(e){}
  }

  /** Add the running stretch to its game, up to now — or up to where the idle
      cut-off fell, if nothing has been pressed for longer than that. */
  function playBank(now){
    if(!PLAY_ON || PLAY_HIDDEN) return;
    now = now || Date.now();
    const end = Math.min(now, PLAY_IN + PLAY_IDLE);
    if(end <= PLAY_AT) return;
    PLAY[PLAY_ON] = (PLAY[PLAY_ON] || 0) + (end - PLAY_AT) / 1000;
    PLAY_AT = end;
    PLAY_DIRTY = true;
  }
  function playStart(game){
    if(game && PLAY_ON === game) return;
    playStop();
    if(!game) return;
    const now = Date.now();
    PLAY_ON = game; PLAY_AT = now; PLAY_IN = now;
    PLAY_HIDDEN = document.visibilityState === 'hidden';
  }
  function playStop(){
    if(!PLAY_ON) return;
    playBank();
    PLAY_ON = '';
    playSave();
  }
  /** Something was pressed with a game on screen. Banks what came before, and
      if that was after a long pause, starts counting again from here rather
      than from where the pause began. */
  function playPoke(){
    if(!PLAY_ON || PLAY_HIDDEN) return;
    const now = Date.now();
    playBank(now);
    PLAY_AT = now; PLAY_IN = now;
  }
  /** Seconds per game, longest first, under the name its card uses. Includes
      the stretch running now, so Your focus opened mid-game is up to date. */
  function playTotals(){
    playBank();
    const out = [];
    for(const id in PLAY){
      if(!(PLAY[id] >= 1)) continue;
      const def = GAMES[id];
      out.push({id, name:(def && def.title) || id, secs:PLAY[id]});
    }
    return out.sort((a, b)=>b.secs - a.secs);
  }

  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'hidden'){ playBank(); playSave(); PLAY_HIDDEN = true; }
    else if(PLAY_HIDDEN){ PLAY_HIDDEN = false; PLAY_AT = PLAY_IN = Date.now(); }
  });
  window.addEventListener('pagehide', ()=>{ playBank(); playSave(); });
  /* Capture phase, because several games stop their keys from going further —
     a crossword swallowing every letter it takes is still a person playing. */
  for(const ev of ['pointerdown', 'keydown', 'wheel']){
    document.addEventListener(ev, playPoke, {capture:true, passive:true});
  }
  setInterval(()=>{ playBank(); playSave(); }, PLAY_BEAT);
