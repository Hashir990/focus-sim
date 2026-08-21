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
      if(def){ try{ await def.game().enter(); }catch(e){} }
    }
  };

