  /* ================================================================
     REST ARCADE
     ================================================================ */
  const fmt = sec => pad(Math.floor(sec/60))+':'+pad(sec%60);
  let toastT=null;
  function toast(msg){
    const el=$('toast'); el.textContent=msg; el.classList.add('show');
    clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('show'),1500);
  }
  async function readGame(key){
    try{ const r=await KV.get(key); if(r&&r.value) return JSON.parse(r.value); }catch(e){}
    return null;
  }

  /* ---------------- saved games, and how they reach an account ----------------

     **A board is part of your profile.** The hours, the calendar and the buddy
     all ride on the account; the half-finished crossword, the 2048 record and
     the chess shelf did not, so signing in on a second machine gave you your
     history back and a brand new empty arcade. This is the plumbing that fixes
     that, and it is here rather than in each game so that adding a game is
     still one `registerGame` call.

     Three pieces:

       * `GAME_SAVES` is what this device has written, in memory, because
         `Account.snapshot()` is synchronous and storage is not. `gamesLoad()`
         fills it at boot from storage, whether or not the arcade is ever
         opened - a game you have not played this session is still yours.
       * `GAME_AT` is when each was last written *by this device*, kept in its
         own key rather than inside the saves. Stamping it into the blob would
         put a stray field inside data the games parse; chess in particular
         reads its whole save as a map of games, and would have listed the
         timestamp as one of them.
       * `forgetGame` lets a game drop its in-memory copy when an account
         overwrites storage underneath it, so the next `enter()` re-reads rather
         than persisting the old position back over the new one. */
  const GAME_AT_KEY = 'focus_game_at';
  const GAME_SAVES = Object.create(null);
  const GAME_AT = Object.create(null);
  const GAME_FORGET = Object.create(null);

  /** Every single-player save, in the order they were added. Two-player games
      are not here: a game of Scrabble belongs to a room, not to a person. */
  const GAME_KEYS = ['arcade_sudoku', 'arcade_wordle', 'arcade_2048',
                     'arcade_memory', 'arcade_cross', 'focus_chess'];

  async function gamesLoad(){
    try{
      const r = await KV.get(GAME_AT_KEY);
      if(r && r.value){
        const d = JSON.parse(r.value);
        if(d && typeof d === 'object') for(const k of GAME_KEYS) if(d[k]) GAME_AT[k] = d[k] | 0;
      }
    }catch(e){}
    for(const k of GAME_KEYS){
      const v = await readGame(k);
      if(v && typeof v === 'object') GAME_SAVES[k] = v;
    }
  }

  /** Save a game, and remember when. Everything that used to call
      `KV.set(this.key, JSON.stringify(x))` calls this instead - a save that
      skips it is a save the account never hears about. */
  function writeGame(key, v){
    GAME_SAVES[key] = v;
    GAME_AT[key] = Date.now();
    try{ KV.set(key, JSON.stringify(v)); }catch(e){}
    try{ KV.set(GAME_AT_KEY, JSON.stringify(GAME_AT)); }catch(e){}
  }

  function forgetGame(key, fn){ GAME_FORGET[key] = fn; }

  /** What `Account.snapshot()` carries: `{key: {at, v}}`, one per save. */
  function gamesSnapshot(){
    const out = {};
    for(const k of GAME_KEYS){
      const v = GAME_SAVES[k];
      if(v) out[k] = {at: GAME_AT[k] | 0, v};
    }
    return out;
  }

  /** Become the account's saved games.

      Only where the merge chose a save this device did not write - comparing
      the merged `at` against our own is what stops a device rewriting its own
      storage on every sync and re-stamping it as new. */
  function gamesAdopt(map){
    if(!map || typeof map !== 'object') return;
    for(const k of GAME_KEYS){
      const got = map[k];
      if(!got || !got.v) continue;
      const at = Number(got.at) || 0;
      if(at === (GAME_AT[k] | 0) && GAME_SAVES[k]) continue;
      GAME_SAVES[k] = got.v;
      GAME_AT[k] = at;
      try{ KV.set(k, JSON.stringify(got.v)); }catch(e){}
      try{ GAME_FORGET[k] && GAME_FORGET[k](); }catch(e){}
    }
    try{ KV.set(GAME_AT_KEY, JSON.stringify(GAME_AT)); }catch(e){}
    try{ if(Arcade.open) Arcade._refresh(); }catch(e){}
  }

  /** Signing out empties the arcade with everything else. */
  function gamesWipe(){
    for(const k of GAME_KEYS){
      delete GAME_SAVES[k];
      delete GAME_AT[k];
      try{ KV.del(k); }catch(e){}
      try{ GAME_FORGET[k] && GAME_FORGET[k](); }catch(e){}
    }
    try{ KV.del(GAME_AT_KEY); }catch(e){}
    try{ if(Arcade.open) Arcade._refresh(); }catch(e){}
  }

  /* Every game registers itself here, so this file never needs editing when you
     add one. Call registerGame() from the bottom of your game's own file:

       registerGame('chess', {
         el:'game-chess',            // id of the game's container div
         title:'Chess',              // shown in the overlay header
         progEl:'prog-chess',        // id of the .prog span on its picker card
         game:()=>Chess,             // lazy — Chess is defined after this runs
         async progress(){ return 'New<span>tap to start</span>'; }
       });

     Then add a .pcard with data-game="chess" to src/body/06-arcade-picker.html. */
  const GAMES = {};
  function registerGame(id, def){ GAMES[id] = Object.assign({id}, def); }

  /* Holding a picker card offers to start that game over. It lives here rather
     than in each game because the gesture should be the same everywhere — the
     games differ only in what "start over" means, which is what `reset` says.

     A game opts in by giving `registerGame` a `reset` — either a function, or
     `false` to say it can't be reset from here (the shared ones refuse when you
     don't hold the timer). Games that say nothing simply don't offer it. */
  function arcadeResetItems(id){
    const def = GAMES[id];
    if(!def || !def.reset) return [];
    const can = def.canReset ? def.canReset() : true;
    if(!can) return [];
    return [{
      label:'Reset ' + (def.title || id).toLowerCase(),
      danger:true,
      run(){
        askConfirm('Start ' + (def.title || id) + ' again?',
          def.resetNote || 'Whatever is on the board now is lost.',
          'Reset',
          ()=>{ def.reset(); Arcade._refresh(); toast((def.title || id) + ' reset'); });
      },
    }];
  }

  const Arcade = {
    open:false, active:null,
    show(){
      this.open=true; $('overlay').classList.remove('hide');
      paint();
      if(this.active) this._showGame(this.active); else this._picker();
    },
    close(){
      this._leaveActive();
      this.open=false; $('overlay').classList.add('hide');
      try{ glowFit(); }catch(e){}     // the dial is back; so is its glow
    },
    back(){
      if(this.active){ this._leaveActive(); this.active=null; this._picker(); }
      else this.close();
    },
    _leaveActive(){
      const def = this.active && GAMES[this.active];
      if(!def) return;
      try{ const g = def.game(); if(g && g.leave) g.leave(); }catch(e){}
    },
    async pick(g){ this.active=g; await this._showGame(g); },
    _picker(){
      this.active=null;
      this._calBtn('');
      $('picker').classList.remove('hide');
      for(const id in GAMES){ const el=$(GAMES[id].el); if(el) el.classList.add('hide'); }
      $('ov-title').textContent='Rest arcade';
      this._refresh();
    },
    async _refresh(){
      for(const id in GAMES){
        const def=GAMES[id], el=$(def.progEl);
        if(!el || !def.progress) continue;
        try{ el.innerHTML = await def.progress(); }
        catch(e){ el.innerHTML = 'New<span>tap to start</span>'; }
      }
    },
    async _showGame(g){
      $('picker').classList.add('hide');
      for(const id in GAMES){ const el=$(GAMES[id].el); if(el) el.classList.toggle('hide', id!==g); }
      const def=GAMES[g];
      $('ov-title').textContent = def ? def.title : 'Rest arcade';
      /* The back catalogue, for the games that have one. Hidden rather than
         disabled: a button that is never usable in 2048 is clutter, not a
         hint. See `registerDaily` in 09b-daily.js. */
      this._calBtn(g);
      if(def){ try{ await def.game().enter(); }catch(e){} }
    },
    _calBtn(g){
      const b=$('ov-cal');
      if(!b) return;
      let has=false;
      try{ has = !!(g && dailyDef(g)); }catch(e){}
      b.classList.toggle('hide', !has);
    }
  };

