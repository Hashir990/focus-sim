  /* ---------------- 2048 ---------------- */
  const G2048 = {
    key:'arcade_2048', built:false, loaded:false,
    board:[], score:0, best:0, won:false, done:false,

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
      this.build();
      this.render();
      this._restoreBanner();
    },
    leave(){ this.persist(); },

    _new(){
      this.board = new Array(16).fill(0);
      this.score = 0; this.won = false; this.done = false;
      this._spawn(); this._spawn();
    },
    newGame(){
      this._new(); this.persist(); this.render();
      $('g2048-banner').classList.add('hide');
    },

    build(){
      if(this.built) return;
      const grid = $('g2048-grid');
      grid.innerHTML = '';
      for(let i=0;i<16;i++){
        const t = document.createElement('div');
        t.className = 't'; t.dataset.v = '0';
        grid.appendChild(t);
      }
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

    render(){
      const cells = $('g2048-grid').children;
      for(let i=0;i<16;i++){
        const v = this.board[i]||0;
        const el = cells[i];
        if(!el) continue;
        const prev = el.dataset.v;
        el.dataset.v = String(v);
        el.textContent = v ? String(v) : '';
        if(v && prev !== String(v)){
          el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
        }
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
      this.board[empty[Math.random()*empty.length|0]] = Math.random()<0.9 ? 2 : 4;
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

    move(dir){
      if(this.done) return;
      const before = this.board.join(',');
      let gained = 0;

      for(const idx of this._lines(dir)){
        const vals = idx.map(i=>this.board[i]).filter(v=>v);
        const merged = [];
        for(let i=0;i<vals.length;i++){
          if(vals[i] === vals[i+1]){ const m = vals[i]*2; merged.push(m); gained += m; i++; }
          else merged.push(vals[i]);
        }
        while(merged.length < 4) merged.push(0);
        idx.forEach((cell,k)=>{ this.board[cell] = merged[k]; });
      }

      if(this.board.join(',') === before) return;   // nothing shifted; don't spawn

      this.score += gained;
      if(this.score > this.best) this.best = this.score;
      this._spawn();

      if(!this.won && this.board.includes(2048)){
        this.won = true;
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
      this.render();
    },

    persist(){
      try{
        KV.set(this.key, JSON.stringify({
          board:this.board, score:this.score, best:this.best, won:this.won, done:this.done
        }));
      }catch(e){}
    }
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

  registerGame('g2048', {
    el:'game-2048', title:'2048', progEl:'prog-2048', game:()=>G2048,
    async progress(){
      const d = await readGame(G2048.key);
      if(!d || !d.board) return 'New<span>tap to start</span>';
      if(d.done) return 'Over<span>score '+(d.score||0)+'</span>';
      const top = Math.max.apply(null, d.board.concat([0]));
      return top+'<span>best tile</span>';
    }
  });

