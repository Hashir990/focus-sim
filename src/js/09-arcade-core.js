  /* ================================================================
     REST ARCADE
     ================================================================ */
  const fmt = sec => pad(Math.floor(sec/60))+':'+pad(sec%60);
  let toastT=null;
  function toast(msg){
    const el=$('toast'); el.textContent=msg; el.classList.add('show');
    clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('show'),1500);
  }
  /** **Storage first, then this session's own memory.**

      A read that comes back empty used to mean "no such game", and a game told
      that builds a fresh board. But empty is also what a store that has stopped
      accepting writes says, and what a store says about a save an account
      adopt has just cleared out from under it — so the board somebody was
      playing a moment ago was rebuilt from nothing, which is read as the game
      erasing progress, because that is what it is. `GAME_SAVES` holds what this
      session has written and is the newest copy there is; falling back to it
      makes one sitting safe from anything storage does. */
  async function readGame(key){
    try{ const r=await KV.get(key); if(r&&r.value) return JSON.parse(r.value); }catch(e){}
    return gameSaved(key);
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
                     'arcade_memory', 'arcade_cross', 'focus_chess',
                     'arcade_tetris'];

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
  /* **A save that fails has to say so.** Both writes swallowed everything, so
     a full disk, a browser with storage switched off, or a database that has
     gone bad all looked exactly like working — right up to the restart, where
     the board people had been playing for an hour was simply not there. They
     report that as "it does not save", which is true and gives nobody anything
     to go on. Said once per session, because a toast on every keystroke of a
     game that cannot be saved is its own kind of broken. */
  let saveBroke = false;
  function writeGame(key, v){
    /* **The in-memory copy first, and unconditionally.** Whatever storage does
       next, the board you are playing has to survive going back to the shelf
       and coming in again — that is one session, and it should never depend on
       a disk. `GAME_SAVES` is what every game reads on re-entry. */
    GAME_SAVES[key] = v;
    GAME_AT[key] = Date.now();
    try{
      const p = KV.set(key, JSON.stringify(v));
      if(p && p.then) p.then(ok=>{ if(!ok) gameSaveFailed(); }, ()=>gameSaveFailed());
    }catch(e){ gameSaveFailed(); }
    try{ KV.set(GAME_AT_KEY, JSON.stringify(GAME_AT)); }catch(e){}
  }
  function gameSaveFailed(){
    if(saveBroke) return;
    saveBroke = true;
    /* Once. A toast on every keystroke of a game that cannot be saved is its
       own kind of broken, and the drawer carries the detail — see storageLine
       in 42-dev.js. */
    try{ toast('This device has stopped saving \u2014 see Storage in the menu'); }catch(e){}
  }

  /** **Free room, so a full store is a hiccup and not the end of the game.**
      Handed to `KV.set` as `KV.pinch`; it is called only after a write has
      already failed. Everything dropped here can be rebuilt: a sudoku board
      comes back from its day, and a puzzle's letters are the only thing that
      cannot — so those are the last to go and older ones go first. */
  KV.pinch = function(){
    let freed = false;
    try{
      const raw = localStorage.getItem('arcade_sudoku');
      const d = raw ? JSON.parse(raw) : null;
      if(d && d.boards){
        const days = Object.keys(d.boards).sort();       // 'YYYY-MM-DD|diff' sorts by date
        while(days.length > 12){
          delete d.boards[days.shift()];
          freed = true;
        }
        if(freed) localStorage.setItem('arcade_sudoku', JSON.stringify(d));
      }
    }catch(e){ freed = false; }
    return freed;
  };

  function forgetGame(key, fn){ GAME_FORGET[key] = fn; }

  /** What `Account.snapshot()` carries: `{key: {at, v}}`, one per save. */
  /** One game's save, as this device last wrote it, without waiting on storage.
      `readGame` is the honest read and is async; this is the same answer for
      anything that has to be synchronous — `Account.snapshot()` and the profile
      card, both of which are built in one pass. */
  function gameSaved(key){
    const v = GAME_SAVES[key];
    return (v && typeof v === 'object') ? v : null;
  }

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
        /* **Stop the clock before asking.** A confirm over a game that is still
           running asks you to decide while the thing you are deciding about
           carries on happening — in Tetris the piece keeps falling behind the
           dialog, so reading the question costs you the board whichever answer
           you give. Games with a clock say so with `beforeReset`; the rest do
           nothing and are unaffected. */
        try{ if(def.beforeReset) def.beforeReset(); }catch(e){}
        askConfirm('Start ' + (def.title || id) + ' again?',
          def.resetNote || 'Whatever is on the board now is lost.',
          'Reset',
          ()=>{ def.reset(); Arcade._refresh(); toast((def.title || id) + ' reset'); });
      },
    }];
  }

  /* Registered once, outside the object, because the listeners outlive any one
     game and there is nothing to take them down. */
  window.addEventListener('pagehide', ()=>{ try{ Arcade._stow(); }catch(e){} });
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'hidden'){ try{ Arcade._stow(); }catch(e){} }
  });
  /* **And up to the account, on the way out and every so often.** A save on
     this device is one disk; the vault is the copy that survives the disk. The
     window closing is the moment it matters most and the moment there is least
     time, so it goes on `pagehide` as well as on a slow timer — five minutes,
     which is often enough that nothing much is ever at risk and rare enough
     that it is not a background chatter. */
  window.addEventListener('pagehide', ()=>{ try{ Account.sync(true); }catch(e){} });
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'hidden'){ try{ Account.sync(true); }catch(e){} }
  });
  setInterval(()=>{ try{ if(!document.hidden) Account.sync(true); }catch(e){} }, 5 * 60 * 1000);

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
    /** **Put the open board down without leaving it.** A phone killing the app
        and a laptop lid closing both skip every button this app has, so the
        last few minutes of a crossword only survived because the clock happens
        to save on its ten-second beat. This is the same `leave()` the Back
        button calls, on the two events a shutdown does still fire. */
    _stow(){
      const def = this.active && GAMES[this.active];
      if(!def) return;
      try{ const g = def.game(); if(g && g.persist) g.persist(); }catch(e){}
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
      this._faces();
    },
    /* **Whoever is in the room, on the game they are in.**

       This started life as a glyph beside each name in Focus together, which
       answers the question backwards: you do not read down a list of people
       wondering what each is doing, you look at the shelf wondering whether
       anybody is on something. So it is here instead — their actual faces, on
       the card — and the answer to "is anyone up for chess" is on the chess
       card where you were already looking.

       Two at most, and a count past that: four buddies on a card is a crowd,
       and the useful fact is *somebody*, not exactly who. */
    _faces(){
      for(const id in GAMES){
        const def = GAMES[id], card = $(def.progEl);
        if(!card) continue;
        const host = card.parentNode;
        if(!host) continue;
        let box = host.querySelector('.pcard-who');
        let who = [];
        try{ who = syncInGame(id); }catch(e){}
        if(!who.length){ if(box) box.remove(); continue; }
        if(!box){
          box = document.createElement('span');
          box.className = 'pcard-who';
          host.appendChild(box);
        }
        const show = who.slice(0, 2);
        let out = '';
        try{
          out = Buddy.shown()
            ? show.map(p=>'<i title="' + esc(p.name) + '">' + budSvg(p.buddy, 22) + '</i>').join('')
            : show.map(p=>'<i class="initial" title="' + esc(p.name) + '">'
                + esc((p.name || '?').slice(0, 1).toUpperCase()) + '</i>').join('');
        }catch(e){ out = ''; }
        if(who.length > show.length) out += '<em>+' + (who.length - show.length) + '</em>';
        box.innerHTML = out;
        box.title = who.map(p=>p.name).join(', ') + ' here';
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

