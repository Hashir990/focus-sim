  /* ---------------- 2048 ----------------

     **Tiles are things, not cell contents.** The board was sixteen fixed
     squares whose text was rewritten after every move, which is correct and
     reads as nothing happening: a four appears where a two was and you are left
     working out what moved where. So there are two layers now — sixteen empty
     slots that never change, and a tile per number, absolutely placed over them
     and moved by transform. A tile keeps its identity across a move, so the
     browser animates it from where it was to where it went.

     `board` is still the only thing the game logic and the save file know
     about. `tiles` is a view of it that happens to remember which number is
     which, and is rebuilt from `board` whenever a game is loaded. Nothing reads
     the tiles to decide anything. */

  const T2048_MS = 130;             // how long a slide takes

  const G2048 = {
    key:'arcade_2048', built:false, loaded:false,
    board:[], score:0, best:0, won:false, done:false,
    tiles:[],                       // [{id, v, i}] — one per number on the board
    seq:0,                          // next tile id
    busy:false,                     // mid-slide; a second swipe would tangle it

    async enter(){
      if(!this.loaded){
        const d = await readGame(this.key);
        if(d){
          this.board = Array.isArray(d.board) && d.board.length===16 ? d.board : [];
          this.score = d.score||0; this.best = d.best||0;
          this.won = !!d.won; this.done = !!d.done;
        }
        this.loaded = true;
      }
      if(this.board.length!==16) this._new();
      else this._tilesFromBoard();
      this.build();
      this.render();
      this._restoreBanner();
    },
    leave(){ this.persist(); },

    _new(){
      this.board = new Array(16).fill(0);
      this.tiles = []; this.busy = false;
      this.score = 0; this.won = false; this.done = false;
      this._spawn(); this._spawn();
    },

    /** Start the tile layer again from the board — on load, and after a reset. */
    _tilesFromBoard(){
      this.tiles = [];
      this.busy = false;
      for(let i=0;i<16;i++) if(this.board[i]) this.tiles.push({id:++this.seq, v:this.board[i], i});
    },
    _tileAt(i){ return this.tiles.find(t=>t.i === i && !t.dying); },
    newGame(){
      const layer = $('g2048-tiles');
      if(layer) layer.innerHTML = '';    // ids restart; stale elements would linger
      this._new(); this.persist(); this.render();
      $('g2048-banner').classList.add('hide');
    },

    build(){
      if(this.built) return;
      const grid = $('g2048-grid');
      grid.innerHTML = '';
      /* Sixteen empty slots that never move or change, and a layer over them
         that holds the numbers. Two layers because a CSS grid cannot animate a
         child from one cell to another — the cell is where the child *is*, so
         moving it is a relayout, and a relayout has no in-between. */
      const slots = document.createElement('div');
      slots.className = 'g2048-slots';
      for(let i=0;i<16;i++){
        const t = document.createElement('div');
        t.className = 'slot';
        slots.appendChild(t);
      }
      const layer = document.createElement('div');
      layer.className = 'g2048-tiles';
      layer.id = 'g2048-tiles';
      grid.appendChild(slots);
      grid.appendChild(layer);
      // swipe
      let sx=0, sy=0, tracking=false;
      grid.addEventListener('touchstart', e=>{
        const t=e.changedTouches[0]; sx=t.clientX; sy=t.clientY; tracking=true;
      }, {passive:true});
      grid.addEventListener('touchend', e=>{
        if(!tracking) return; tracking=false;
        const t=e.changedTouches[0];
        const dx=t.clientX-sx, dy=t.clientY-sy;
        if(Math.max(Math.abs(dx),Math.abs(dy)) < 24) return;
        this.move(Math.abs(dx)>Math.abs(dy) ? (dx>0?'right':'left') : (dy>0?'down':'up'));
      }, {passive:true});
      this.built = true;
    },

    /* Reconcile the tile layer with `this.tiles`, keyed by id.
       Elements are reused rather than rebuilt, which is the whole point: a tile
       that keeps its element keeps its position, so changing its transform is
       something the browser can animate. Rebuilding the layer every move would
       animate nothing however many transitions were declared. */
    render(){
      const layer = $('g2048-tiles');
      if(layer){
        const seen = {};
        for(const t of this.tiles){
          seen[t.id] = 1;
          let el = layer.querySelector('[data-id="' + t.id + '"]');
          if(!el){
            el = document.createElement('div');
            el.className = 't born';
            el.dataset.id = String(t.id);
            layer.appendChild(el);
          }
          el.style.setProperty('--c', String(t.i % 4));
          el.style.setProperty('--r', String((t.i / 4) | 0));
          if(el.dataset.v !== String(t.v)){
            el.dataset.v = String(t.v);
            el.textContent = String(t.v);
          }
          el.classList.toggle('dying', !!t.dying);
          if(t.pop){
            el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
            t.pop = false;
          }
        }
        // anything no longer in the list has been merged away
        [...layer.children].forEach(el=>{ if(!seen[el.dataset.id]) el.remove(); });
      }
      $('g2048-meta').textContent = 'Score '+this.score+' · Best '+this.best;
    },

    _restoreBanner(){
      const bn = $('g2048-banner');
      if(this.done){
        bn.querySelector('h3').textContent = 'No moves left.';
        $('g2048-win-sub').textContent = 'Final score '+this.score+'.';
        bn.classList.remove('hide');
      } else bn.classList.add('hide');
    },

    _spawn(){
      const empty = [];
      for(let i=0;i<16;i++) if(!this.board[i]) empty.push(i);
      if(!empty.length) return;
      const at = empty[Math.random()*empty.length|0];
      const v = Math.random()<0.9 ? 2 : 4;
      this.board[at] = v;
      this.tiles.push({id:++this.seq, v, i:at});
    },

    /** Index groups in traversal order — first index is the one things slide toward. */
    _lines(dir){
      const out = [];
      for(let i=0;i<4;i++){
        const row = [0,1,2,3].map(j=>i*4+j);
        const col = [0,1,2,3].map(j=>j*4+i);
        if(dir==='left') out.push(row);
        else if(dir==='right') out.push(row.slice().reverse());
        else if(dir==='up') out.push(col);
        else out.push(col.slice().reverse());
      }
      return out;
    },

    _canMove(){
      if(this.board.includes(0)) return true;
      for(let r=0;r<4;r++) for(let c=0;c<4;c++){
        const v = this.board[r*4+c];
        if(c<3 && v===this.board[r*4+c+1]) return true;
        if(r<3 && v===this.board[(r+1)*4+c]) return true;
      }
      return false;
    },

    /* A move in two beats.
       The first is the whole move as far as the game is concerned: the board is
       final, the score is final, and every tile has been told which square it is
       going to. Then the browser spends T2048_MS animating them there.
       The second beat is cosmetic — the tiles that merged are taken away, the
       survivors show their new number and pop, and the new tile appears. Doing
       that immediately is what made a merge look like a number changing its mind
       rather than two tiles arriving in the same place. */
    move(dir){
      if(this.done || this.busy) return;
      const before = this.board.join(',');
      let gained = 0;
      const merges = [];             // {keep, gone, v} — settled after the slide

      for(const idx of this._lines(dir)){
        const line = idx.map(i=>this._tileAt(i)).filter(Boolean);
        const vals = [];
        let k = 0;
        while(k < line.length){
          const a = line[k], b = line[k+1];
          const dest = idx[vals.length];
          if(b && a.v === b.v){
            /* Both travel to the same square. The one that arrives second is
               marked dying so it can be drawn underneath and then removed. */
            a.i = dest; b.i = dest; b.dying = true;
            merges.push({keep:a, gone:b, v:a.v * 2});
            vals.push(a.v * 2);
            gained += a.v * 2;
            k += 2;
          }else{
            a.i = dest;
            vals.push(a.v);
            k += 1;
          }
        }
        while(vals.length < 4) vals.push(0);
        idx.forEach((cell,n)=>{ this.board[cell] = vals[n]; });
      }

      if(this.board.join(',') === before && !merges.length){
        return;   // nothing shifted; don't spawn
      }

      this.score += gained;
      if(this.score > this.best) this.best = this.score;

      this.persist();
      this.render();                 // the slide starts here

      /* And lands here. Guarded so a second swipe mid-slide is ignored rather
         than interleaved — the tile list would be half-updated and the board
         would disagree with it. */
      this.busy = true;
      const settle = ()=>{
        this.busy = false;
        for(const m of merges){
          m.keep.v = m.v;
          m.keep.pop = true;
          this.tiles = this.tiles.filter(t=>t !== m.gone);
        }
        this._spawn();
        this.render();
        this._after(gained);
      };
      if(typeof requestAnimationFrame === 'function') setTimeout(settle, T2048_MS);
      else settle();
    },

    /* Everything that is decided by the board once the move has landed: the
       marks, the banner, and whether the game is over. Split out because it has
       to run after the spawn, and the spawn waits for the animation. */
    _after(gained){
      // the score mark reads `best` straight off this object, so it needs no
      // record of its own — only a nudge on the move that crosses the line
      if(this.score >= 10000 && this.score - gained < 10000){ try{ achCheck(); }catch(e){} }
      if(!this.won && this.board.includes(2048)){
        this.won = true;
        // the tile is gone the moment it merges again, so mark it while it's here
        try{ featMark('t2048'); }catch(e){}
        chime(false); buzz(120);
        showBanner('g2048-banner', '2048!', 'You got there. Keep going for a bigger score.');
        setTimeout(()=>$('g2048-banner').classList.add('hide'), 3200);
      } else if(!this._canMove()){
        this.done = true;
        $('g2048-banner').querySelector('h3').textContent = 'No moves left.';
        $('g2048-win-sub').textContent = 'Final score '+this.score+'.';
        $('g2048-banner').classList.remove('hide');
      }
      this.persist();
    },

    persist(){
      writeGame(this.key, {
        board:this.board, score:this.score, best:this.best, won:this.won, done:this.done
      });
    },
    forget(){ this.loaded = false; this.board = []; this.tiles = []; }
  };

  document.addEventListener('keydown', e=>{
    if(!Arcade.open || Arcade.active!=='g2048') return;
    const map = {ArrowLeft:'left', ArrowRight:'right', ArrowUp:'up', ArrowDown:'down',
                 a:'left', d:'right', w:'up', s:'down'};
    const dir = map[e.key];
    if(!dir) return;
    e.preventDefault();
    G2048.move(dir);
  });

  forgetGame(G2048.key, ()=>G2048.forget());

  registerGame('g2048', {
    el:'game-2048', title:'2048', progEl:'prog-2048', game:()=>G2048,
    reset(){ G2048.newGame(); },
    resetNote:'A fresh board. Your score this game is lost; the best stays.',
    async progress(){
      const d = await readGame(G2048.key);
      if(!d || !d.board) return 'New<span>tap to start</span>';
      if(d.done) return 'Over<span>score '+(d.score||0)+'</span>';
      const top = Math.max.apply(null, d.board.concat([0]));
      return top+'<span>best tile</span>';
    }
  });

