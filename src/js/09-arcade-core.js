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

  const Arcade = {
    open:false, active:null,
    show(){
      this.open=true; $('overlay').classList.remove('hide');
      paint();
      if(this.active) this._showGame(this.active); else this._picker();
    },
    close(){
      if(this.active==='sudoku') Sudoku.leave();
      if(this.active==='wordle') Wordle.leave();
      this.open=false; $('overlay').classList.add('hide');
    },
    back(){
      if(this.active){
        if(this.active==='sudoku') Sudoku.leave();
        if(this.active==='wordle') Wordle.leave();
        this.active=null; this._picker();
      }else this.close();
    },
    async pick(g){ this.active=g; this._showGame(g); },
    _picker(){
      this.active=null;
      $('picker').classList.remove('hide');
      $('game-sudoku').classList.add('hide');
      $('game-wordle').classList.add('hide');
      $('ov-title').textContent='Rest arcade';
      this._refresh();
    },
    async _refresh(){
      const s=await readGame(Sudoku.key), w=await readGame(Wordle.skey);
      $('prog-sudoku').innerHTML = (function(){
        if(!s) return 'New<span>tap to start</span>';
        if(s.done) return 'Solved<span>new game</span>';
        const filled = s.grid.filter((v,i)=>v && !s.given[i]).length;
        return filled>0 ? (filled+' filled<span>in progress</span>') : 'New<span>tap to start</span>';
      })();
      $('prog-wordle').innerHTML = w
        ? (w.done ? (w.won?'Solved<span>new word</span>':'—<span>new word</span>') : (w.guesses.length+'/6<span>in progress</span>'))
        : 'New<span>tap to start</span>';
    },
    async _showGame(g){
      $('picker').classList.add('hide');
      $('game-sudoku').classList.toggle('hide', g!=='sudoku');
      $('game-wordle').classList.toggle('hide', g!=='wordle');
      $('ov-title').textContent = g==='sudoku' ? 'Sudoku' : 'Word guess';
      if(g==='sudoku') await Sudoku.enter();
      else await Wordle.enter();
    }
  };

