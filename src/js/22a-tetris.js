  /* ---------------- TETRIS ----------------

     Free play, like 2048: no dated edition, no streak, just a board and the
     best you have managed on it. The arcade is something to do in a five-minute
     break, and a game you can be handed once a day is a poor fit for a break
     you might take four times.

     Two things here are worth doing properly rather than approximately, because
     they are the difference between Tetris and something shaped like it:

       * **the bag.** Pieces are not drawn at random. Each bag holds one of
         every shape plus three drawn again, shuffled, and is dealt out before
         the next is made — so you can never be starved of an I for twenty
         pieces, and planning ahead is a skill rather than a hope. Ten rather
         than a plain seven: one of each is the guarantee, and the three spares
         are what stop the last few pieces of a bag being deducible.

       * **the kicks.** When a rotation would overlap something, the piece is
         nudged and tried again, in a fixed order, and the order is the standard
         one (SRS). It is what makes a T fit into a notch and an I stand up
         against a wall. Written out in full in `TET_KICK` because a plausible
         made-up table plays subtly, maddeningly wrong. */

  const TET_W = 10, TET_H = 20, TET_HIDE = 2;    // two rows above the ceiling to spawn in
  const TET_ROWS = TET_H + TET_HIDE;

  /* Spawn shapes, as cells in a box. `n` is the box width: the I and the O turn
     inside a 4-wide box, everything else inside a 3-wide one. Rotating is
     `(x,y) -> (n-1-y, x)`, which is why the box has to be square and why its
     size is part of the piece. */
  const TET_PIECES = {
    I:{n:4, c:[[0,1],[1,1],[2,1],[3,1]]},
    O:{n:4, c:[[1,0],[2,0],[1,1],[2,1]], spin:false},
    T:{n:3, c:[[1,0],[0,1],[1,1],[2,1]]},
    S:{n:3, c:[[1,0],[2,0],[0,1],[1,1]]},
    Z:{n:3, c:[[0,0],[1,0],[1,1],[2,1]]},
    J:{n:3, c:[[0,0],[0,1],[1,1],[2,1]]},
    L:{n:3, c:[[2,0],[0,1],[1,1],[2,1]]},
  };
  const TET_KEYS = ['I','O','T','S','Z','J','L'];
  /* **Ten to a bag: the seven, and three of them again.**
     A plain seven-bag guarantees fairness and gives it away — by the seventh
     piece there is only one shape left it can be, and the last two or three are
     simply known. Ten keeps the guarantee (every shape still appears in every
     bag, so no drought can run long) while leaving the tail genuinely
     uncertain. The extras are drawn independently, so a bag can hold three
     of one shape. */
  const TET_BAG = 10;

  /* Standard SRS kicks, y already flipped to point down like the board does.
     Keyed `from:to` where the states are 0,1,2,3 clockwise. The I piece has its
     own table; the O never turns and needs none. */
  const TET_KICK = {
    JLSTZ:{
      '0:1':[[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
      '1:0':[[0,0],[1,0],[1,1],[0,-2],[1,-2]],
      '1:2':[[0,0],[1,0],[1,1],[0,-2],[1,-2]],
      '2:1':[[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
      '2:3':[[0,0],[1,0],[1,-1],[0,2],[1,2]],
      '3:2':[[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
      '3:0':[[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
      '0:3':[[0,0],[1,0],[1,-1],[0,2],[1,2]],
    },
    I:{
      '0:1':[[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
      '1:0':[[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
      '1:2':[[0,0],[-1,0],[2,0],[-1,-2],[2,1]],
      '2:1':[[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
      '2:3':[[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
      '3:2':[[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
      '3:0':[[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
      '0:3':[[0,0],[-1,0],[2,0],[-1,-2],[2,1]],
    },
  };

  /* Lines cleared at once, scored. Four at once is worth more than four ones,
     which is the entire reason anybody digs a well. Multiplied by the level. */
  const TET_SCORE = [0, 100, 300, 500, 800];
  /* How long a piece takes to fall one row, by level. Levels past the end of
     the list keep the last one — the game is already faster than reflexes
     there and making it faster only shortens it. */
  const TET_DROP = [800, 720, 630, 550, 470, 380, 300, 220, 130, 100, 80, 80, 80, 70, 70, 70, 50];
  const TET_LOCK = 500;             // grace after landing, so a slide is possible
  /* **A moment before a new piece starts falling.**
     By level eight a row takes 130ms and by twelve it is 80, which is less time
     than it takes to decide where a piece should go, let alone move it there —
     so at speed the game stopped being about placing pieces and became about
     whether you could react at all. A new piece now hangs for a beat before
     gravity takes it. Input works throughout, so the pause is *for* moving,
     not a wait to sit through, and it does not scale with the level: the point
     is that there is always enough time to start the move. */
  const TET_HANG = 220;

  const Tetris = {
    key:'arcade_tetris', built:false, loaded:false,
    cells:[],                       // the 200 visible squares, made once
    grid:[],                        // TET_ROWS * TET_W of '' or a piece letter
    bag:[], queue:[],               // the seven-bag, and what is coming
    piece:null,                     // {k, r, x, y}
    hold:'', held:false,            // what is in the hold, and whether it is spent this piece
    score:0, lines:0, best:0, done:false, paused:false, raf:null,
    fall:0, lockAt:0, hang:0, tick:null, last:0,
    count:0, countT:null,           // the 3-2-1 on the way back in
    dirty:true,

    async enter(){
      if(!this.loaded){
        const d = await readGame(this.key);
        if(d) this._load(d);
        this.loaded = true;
      }
      if(!this.grid.length) this._new();
      this.build();
      /* **Opening the board does not un-pause it.**

         It used to set `paused = false` here, which threw away every reason the
         game had been stopped: a focus block starting paused it, and the moment
         you opened the arcade again — mid-block, to look something up — it was
         running behind the timer.

         So the rule is the timer's. During a focus block the board stays
         stopped, because the arcade is not what a focus block is for. Any other
         time, opening it counts you back in: a break is what this is *for*, and
         being made to press play to resume the thing you opened is a step for
         nothing. */
      if(this._focusOn()) this.paused = true;
      else if(this.paused) this.pause(false);   // clears the flag *and* counts in
      this.render();
      this._banner();
      if(!this.paused && !this.count) this.run();
    },
    /** Is a focus block actually running right now? */
    _focusOn(){
      try{ return S.mode === 'focus' && !!S.running; }catch(e){ return false; }
    },
    /** Leaving the arcade stops the clock. A board that kept falling behind a
        closed overlay would be a game you lose by looking away. */
    /** **Leaving puts it down, rather than leaving it running in a drawer.**
        Going back to the shelf used to only stop the clock, so the board came
        back exactly as it was with no sign that time had passed — and coming
        back to a piece mid-fall that you last saw ten minutes ago is the same
        surprise as never having paused at all. It is paused now, which means
        `enter` counts you back in. */
    leave(){
      this.stop();
      this._countStop();
      if(!this.done) this.paused = true;
      this.persist();
    },

    _load(d){
      try{
        if(typeof d.b === 'string' && d.b.length === TET_ROWS * TET_W) this.grid = d.b.split('');
        this.grid = this.grid.map(c=>TET_PIECES[c] ? c : '');
        this.queue = Array.isArray(d.q) ? d.q.filter(k=>TET_PIECES[k]).slice(0, 6) : [];
        this.bag = Array.isArray(d.g) ? d.g.filter(k=>TET_PIECES[k]) : [];
        this.hold = TET_PIECES[d.h] ? d.h : '';
        this.score = Math.max(0, d.s | 0);
        this.lines = Math.max(0, d.l | 0);
        this.best = Math.max(0, d.best | 0);
        this.done = !!d.done;
        this.piece = (d.p && TET_PIECES[d.p.k]) ? {k:d.p.k, r:(d.p.r | 0) & 3, x:d.p.x | 0, y:d.p.y | 0} : null;
      }catch(e){}
    },
    persist(){
      writeGame(this.key, {
        b:this.grid.join(''), q:this.queue, g:this.bag, h:this.hold,
        s:this.score, l:this.lines, best:this.best, done:this.done,
        p:this.piece ? {k:this.piece.k, r:this.piece.r, x:this.piece.x, y:this.piece.y} : null,
      });
    },
    forget(){ this.grid = []; this.piece = null; this.loaded = false; },

    _new(){
      this.grid = new Array(TET_ROWS * TET_W).fill('');
      this.bag = []; this.queue = [];
      this.hold = ''; this.held = false;
      this.score = 0; this.lines = 0; this.done = false; this.paused = false;
      this.fall = 0; this.lockAt = 0;
      this._fill();
      this._spawn();
      this.persist();
    },
    /** New, with the board stopped and a question. See 13-arcade-wiring.js. */
    askNew(){
      if(this.done){ this.newGame(); return; }
      const started = this.score > 0 || this.lines > 0 || this.grid.some(c=>c);
      if(!started){ this.newGame(); return; }
      this.pause(true);
      askConfirm('Start a new game?',
        'The board is stopped while you decide. A new one loses this game\u2019s '
        + 'score; your best stays.',
        'New game', ()=>this.newGame());
    },
    newGame(){
      this._countStop();
      this._new();
      this.render();
      $('tet-banner').classList.add('hide');
      this.run();
    },

    /* ---- the bag ----
       One of each, shuffled, dealt before the next is made. */
    _fill(){
      while(this.queue.length < 4){
        if(!this.bag.length){
          this.bag = TET_KEYS.slice();
          while(this.bag.length < TET_BAG) this.bag.push(TET_KEYS[Math.random() * TET_KEYS.length | 0]);
          for(let i = this.bag.length - 1; i > 0; i--){
            const j = Math.random() * (i + 1) | 0;
            const t = this.bag[i]; this.bag[i] = this.bag[j]; this.bag[j] = t;
          }
        }
        this.queue.push(this.bag.pop());
      }
    },
    _spawn(k){
      this._fill();
      const key = k || this.queue.shift();
      this._fill();
      const p = TET_PIECES[key];
      /* **Centred, and visible from the first frame.** Born in the hidden rows
         it was invisible until it had fallen twice, so the only thing on screen
         was a ghost at the bottom with nothing casting it. The two hidden rows
         still earn their place: a kick can push a piece up into them. */
      this.piece = {k:key, r:0, x:((TET_W - p.n) / 2) | 0, y:TET_HIDE};
      this.held = false;
      this.lockAt = 0;
      this.hang = TET_HANG;
      this.fall = 0;
      /* **Nowhere to put it is how the game ends** — not a full column, not a
         height. If the spawn overlaps, the stack has reached the roof. */
      if(!this._fits(this.piece)){
        this.done = true;
        this.piece = null;
        this.best = Math.max(this.best, this.score);
        this.stop();
        this.persist();
        this._banner(true);
      }
      this.dirty = true;
    },

    /* ---- geometry ---- */
    _cellsOf(p){
      const def = TET_PIECES[p.k];
      const n = def.n;
      let cs = def.c;
      const turns = (def.spin === false) ? 0 : (p.r & 3);
      for(let t = 0; t < turns; t++) cs = cs.map(([x, y])=>[n - 1 - y, x]);
      return cs.map(([x, y])=>[p.x + x, p.y + y]);
    },
    _fits(p){
      for(const [x, y] of this._cellsOf(p)){
        if(x < 0 || x >= TET_W || y >= TET_ROWS) return false;
        if(y >= 0 && this.grid[y * TET_W + x]) return false;
      }
      return true;
    },
    _move(dx, dy){
      if(!this.piece || this.done || this.paused || this.count) return false;
      const p = {k:this.piece.k, r:this.piece.r, x:this.piece.x + dx, y:this.piece.y + dy};
      if(!this._fits(p)) return false;
      this.piece = p;
      /* Touching down starts the lock clock; moving off an edge stops it again,
         which is what lets you slide a piece into a gap at the last moment. */
      if(this._landed()) { if(!this.lockAt) this.lockAt = TET_LOCK; }
      else this.lockAt = 0;
      this.dirty = true;
      return true;
    },
    _landed(){
      return !this._fits({k:this.piece.k, r:this.piece.r, x:this.piece.x, y:this.piece.y + 1});
    },
    /** Turn, kicking off walls and floors in the standard order. */
    rotate(dir){
      if(!this.piece || this.done || this.paused || this.count) return false;
      const def = TET_PIECES[this.piece.k];
      if(def.spin === false) return false;
      const from = this.piece.r & 3, to = (from + (dir > 0 ? 1 : 3)) & 3;
      const table = (this.piece.k === 'I' ? TET_KICK.I : TET_KICK.JLSTZ)[from + ':' + to] || [[0, 0]];
      for(const [dx, dy] of table){
        const p = {k:this.piece.k, r:to, x:this.piece.x + dx, y:this.piece.y + dy};
        if(this._fits(p)){
          this.piece = p;
          if(this._landed()){ if(!this.lockAt) this.lockAt = TET_LOCK; }
          else this.lockAt = 0;
          this.dirty = true;
          blip();
          return true;
        }
      }
      return false;
    },
    /** Put this one aside and take the other. Once per piece, or it is a way to
        stall forever. */
    swap(){
      if(!this.piece || this.done || this.paused || this.held || this.count) return;
      const was = this.hold;
      this.hold = this.piece.k;
      this.held = true;
      if(was) this._spawnHeld(was);
      else this._spawn();
      this.held = true;
      this.dirty = true;
      blip();
    },
    _spawnHeld(k){
      const p = TET_PIECES[k];
      this.piece = {k, r:0, x:((TET_W - p.n) / 2) | 0, y:TET_HIDE};
      this.lockAt = 0;
      this.hang = TET_HANG;
      this.fall = 0;
      if(!this._fits(this.piece)){
        this.done = true; this.piece = null;
        this.best = Math.max(this.best, this.score);
        this.stop(); this.persist(); this._banner(true);
      }
    },

    softDrop(){
      if(this._move(0, 1)){ this.score++; this.fall = 0; }
    },
    /** Straight down and locked, no grace. Two points a row, because the reason
        to do it is speed and speed should be worth something. */
    hardDrop(){
      if(!this.piece || this.done || this.paused || this.count) return;
      let n = 0;
      while(this._move(0, 1)) n++;
      this.score += n * 2;
      this.lockAt = 1;
      this._lock();
    },
    _lock(){
      if(!this.piece) return;
      for(const [x, y] of this._cellsOf(this.piece)){
        if(y >= 0) this.grid[y * TET_W + x] = this.piece.k;
      }
      tetrisLock();
      const cleared = this._clear();
      if(cleared){
        this.lines += cleared;
        /* Scored at the level you were on when you earned it, not the one the
           points then pushed you up to. */
        this.score += TET_SCORE[cleared] * this.level();
        tetrisTone(cleared);
        if(cleared === 4) buzz(60);
        this._zap(this.went, cleared);
      }
      this.best = Math.max(this.best, this.score);
      this._spawn();
      this.persist();
      try{ Embers.earn(0); }catch(e){}
    },
    /** Takes the full rows out and says which ones they were.

        **Two passes, because one pass cannot answer both questions.** Removing
        a row shifts everything above it down, so the row indices seen while
        removing are not the rows that were full: the old single-pass version
        spliced at 21, found the next row had fallen into 21, and reported the
        same index four times — which is why a tetris flashed as one row. Find
        them all first, then take them out from the bottom so the earlier
        indices stay true. */
    _clear(){
      const went = [];
      for(let y = 0; y < TET_ROWS; y++){
        let full = true;
        for(let x = 0; x < TET_W; x++) if(!this.grid[y * TET_W + x]){ full = false; break; }
        if(full) went.push(y);
      }
      /* **Take them all out, then pad the top.** Putting a blank row back after
         each splice shifts everything down again, so the next index in the list
         no longer points at the row it named — clearing four took out two real
         rows and two innocent ones. Splicing from the bottom up keeps the lower
         indices true; the padding is a separate step for the same reason. */
      for(let i = went.length - 1; i >= 0; i--) this.grid.splice(went[i] * TET_W, TET_W);
      for(let i = 0; i < went.length; i++){
        this.grid.unshift.apply(this.grid, new Array(TET_W).fill(''));
      }
      this.went = went;
      return went.length;
    },
    level(){
      const n = Math.floor((Math.sqrt(1 + this.score / 100) - 1) / 2);
      return Math.max(1, Math.min(TET_DROP.length, n + 1));
    },
    /** Points still to go before the next rung, for the label. */
    _toNext(){
      const n = this.level();
      if(n >= TET_DROP.length) return 0;
      return Math.max(0, 400 * n * (n + 1) - this.score);
    },
    _speed(){ return TET_DROP[Math.min(this.level() - 1, TET_DROP.length - 1)]; },

    /* ---- the clock ---- */
    run(){
      this.stop();
      if(this.done) return;
      this.last = Date.now();
      /* **On the display's beat, not on a timer of our own.**

         `setInterval(33)` is 30 ticks a second against a screen drawing 60, so
         every other frame carried a change and the rest carried none — which is
         judder, and it was worst exactly where the eye was looking, on a piece
         coming down. `requestAnimationFrame` lands on the frame instead, and it
         stops of its own accord while the window is hidden, which is what
         should happen to a falling piece anyway. `_step` was already written
         against elapsed time rather than against tick count, so the rate can
         change without changing the game. */
      const loop = ()=>{ this.raf = requestAnimationFrame(loop); this._step(); };
      this.raf = requestAnimationFrame(loop);
    },
    /** Whether the loop is turning. A predicate rather than a field, because
        which timer drives it is an implementation detail that has changed once
        and may change again — and three tests were reading `tick` directly. */
    running(){ return !!(this.raf || this.tick); },
    stop(){
      if(this.raf){ try{ cancelAnimationFrame(this.raf); }catch(e){} this.raf = null; }
      if(this.tick){ clearInterval(this.tick); this.tick = null; }
    },

    /* **Coming back needs a moment; going away does not.**

       Unpausing used to drop you straight into a falling piece you had stopped
       thinking about, which at level ten is a piece already halfway down. So a
       resume counts you in and a pause does not: one of them is a decision you
       just made and the other is a thing about to happen to you. */
    pause(on){
      const want = on === undefined ? !this.paused : !!on;
      if(want){
        this.paused = true;
        this._countStop();
        this.stop();
      }else if(this.paused){
        this.paused = false;
        this._countIn();
      }
      this.dirty = true;
      this.render();
    },
    _countStop(){
      if(this.countT) clearInterval(this.countT);
      this.countT = null;
      this.count = 0;
      const el = $('tet-count');
      if(el) el.remove();
    },
    _countIn(){
      this._countStop();
      this.stop();
      if(this.done) return;
      this.count = 3;
      this._countPaint();
      this.countT = setInterval(()=>{
        this.count--;
        if(this.count > 0){ this._countPaint(); return; }
        this._countStop();
        /* `last` is reset here or the first tick back charges the game for
           however long you were away, and the piece jumps. */
        this.last = Date.now();
        this.run();
        this.render();
      }, 1000);
    },
    _countPaint(){
      const board = $('tet-grid');
      if(!board) return;
      let el = $('tet-count');
      if(!el){
        el = document.createElement('div');
        el.className = 'tet-count';
        el.id = 'tet-count';
        el.setAttribute('aria-live', 'assertive');
        board.appendChild(el);
      }
      /* Replaced rather than rewritten, so the animation restarts on each
         number instead of the first three staying on screen for a second. */
      el.innerHTML = '<b>' + this.count + '</b>';
      try{ blip(); }catch(e){}
    },
    _step(){
      const now = Date.now();
      let dt = Math.min(200, now - this.last);
      this.last = now;
      if(this.done || this.paused || !this.piece) return;
      /* The hanging beat. It runs down whether or not you use it, and anything
         you do during it — move, turn, hold — still counts. A hard drop cuts
         straight through it, because that is a decision already made. */
      if(this.hang > 0){
        this.hang -= dt;
        if(this.hang > 0){
          if(this.dirty) this.render();
          return;
        }
        /* Whatever of this tick was left after the beat ended belongs to
           gravity. Swallowing the whole tick is a free frame at level one and
           a missed row at level twelve, where a tick is longer than a row. */
        dt = -this.hang;
        this.hang = 0;
      }
      if(this._landed()){
        if(!this.lockAt) this.lockAt = TET_LOCK;
        this.lockAt -= dt;
        if(this.lockAt <= 0) this._lock();
      }else{
        this.fall += dt;
        while(this.fall >= this._speed()){
          this.fall -= this._speed();
          if(!this._move(0, 1)) break;
        }
      }
      if(this.dirty) this.render();
    },

    /* ---- drawing ---- */
    build(){
      if(this.built) return;
      const g = $('tet-grid');
      if(!g) return;
      g.innerHTML = '';
      this.cells = [];
      for(let i = 0; i < TET_W * TET_H; i++){
        const c = document.createElement('i');
        g.appendChild(c);
        this.cells.push(c);
      }
      this.built = true;
    },
    /* **Four at once should not look like one at once.**

       A single is a tidy-up; a tetris is the thing the whole well was dug for,
       and it was worth exactly the same puff of nothing. So every clear gets a
       bright band where the rows were, and four gets that band in gold, a pulse
       across the whole board, and the word said out loud.

       Drawn *over* the board rather than by holding the rows back: the model
       has already dropped everything into place by the time this runs, so an
       interrupted animation — leaving the arcade mid-flash — cannot leave the
       board wrong. Positioned by row fraction, so it never needs to know the
       cell size. */
    _zap(rows, n){
      const board = $('tet-grid');
      if(!board || !rows || !rows.length) return;
      try{ if(prefersReducedMotion()) return; }catch(e){}
      const vis = rows.map(y=>y - TET_HIDE).filter(y=>y >= 0);
      if(!vis.length) return;
      /* One band per row, not one band from the first to the last: four full
         rows are often not four *touching* rows, and a single band spanning
         them would light up whatever is sitting in between. */
      for(const y of vis){
        const el = document.createElement('div');
        el.className = 'tet-zap' + (n >= 4 ? ' big' : '');
        el.style.setProperty('--y0', String(y));
        el.setAttribute('aria-hidden', 'true');
        board.appendChild(el);
        setTimeout(()=>{ try{ el.remove(); }catch(e){} }, n >= 4 ? 900 : 420);
      }
      if(n < 4) return;
      board.classList.remove('tetris');
      void board.offsetWidth;                   // restart it when two land in a row
      board.classList.add('tetris');
      setTimeout(()=>{ try{ board.classList.remove('tetris'); }catch(e){} }, 900);
      const word = document.createElement('div');
      word.className = 'tet-word';
      word.textContent = 'TETRIS';
      word.setAttribute('aria-hidden', 'true');
      board.appendChild(word);
      setTimeout(()=>{ try{ word.remove(); }catch(e){} }, 1000);
    },

    /** Where the piece would land, drawn hollow. Without it the game is a test
        of counting columns rather than of stacking. */
    _ghost(){
      if(!this.piece) return null;
      const p = {k:this.piece.k, r:this.piece.r, x:this.piece.x, y:this.piece.y};
      while(this._fits({k:p.k, r:p.r, x:p.x, y:p.y + 1})) p.y++;
      return p;
    },
    render(){
      if(!this.built) this.build();
      if(!this.cells.length) return;
      this.dirty = false;
      const cls = new Array(TET_W * TET_H).fill('');
      for(let y = TET_HIDE; y < TET_ROWS; y++){
        for(let x = 0; x < TET_W; x++){
          const v = this.grid[y * TET_W + x];
          if(v) cls[(y - TET_HIDE) * TET_W + x] = 'on p' + v;
        }
      }
      const ghost = this._ghost();
      if(ghost){
        for(const [x, y] of this._cellsOf(ghost)){
          const i = (y - TET_HIDE) * TET_W + x;
          if(y >= TET_HIDE && i >= 0 && i < cls.length && !cls[i]) cls[i] = 'ghost p' + ghost.k;
        }
      }
      if(this.piece){
        for(const [x, y] of this._cellsOf(this.piece)){
          const i = (y - TET_HIDE) * TET_W + x;
          if(y >= TET_HIDE && i >= 0 && i < cls.length) cls[i] = 'on p' + this.piece.k;
        }
      }
      for(let i = 0; i < this.cells.length; i++){
        const want = cls[i];
        if(this.cells[i].className !== want) this.cells[i].className = want;
      }
      /* **A paused board is put away, not left on screen.** Half the game is
         working out where the next piece goes, and a stopped board is that
         puzzle with the clock switched off. Hidden, and the reason said. */
      const board = $('tet-grid');
      if(board){
        board.classList.toggle('away', this.paused && !this.count);
        board.dataset.paused = T('Paused');
      }
      const meta = $('tet-meta');
      if(meta) meta.textContent = this.paused ? 'Paused'
        : (this.score + ' · ' + Tn('{n} line', '{n} lines', this.lines));
      const lv = $('tet-level');
      if(lv) lv.textContent = T('Level {n}', {n:this.level()});
      /* The best *including this game*, or beating your record shows the old
         one still sitting there until you lose. */
      const top = Math.max(this.best, this.score);
      const bs = $('tet-best');
      if(bs) bs.textContent = top ? T('Best {n}', {n:top}) : '';
      /* One, not three. Three is a planning aid for a game you sit down to;
         this one is for five minutes, and the column of previews was taller
         than the information in it. */
      this._mini('tet-next', this.queue.slice(0, 1));
      this._mini('tet-hold', this.hold ? [this.hold] : []);
      /* The glyph swaps between the two bars and the triangle. The label is
         the only thing a screen reader gets, so it has to say which. */
      const pb = $('tet-pause');
      if(pb){
        pb.classList.toggle('on', this.paused);
        pb.setAttribute('aria-label', this.paused ? 'Resume' : 'Pause');
        pb.innerHTML = this.paused
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l12 7-12 7z"></path></svg>'
          : '<svg viewBox="0 0 24 24" aria-hidden="true">'
            + '<rect x="6" y="4" width="4" height="16" rx="1.4"></rect>'
            + '<rect x="14" y="4" width="4" height="16" rx="1.4"></rect></svg>';
      }
    },
    /** The little previews.

        **Drawn at the piece's own size, then centred.** On a fixed 4x4 the O
        sat in a corner and the I hugged one edge, because that is where those
        shapes live inside their rotation box — correct, and it reads as the
        preview being broken. So the grid here is the shape's bounding box and
        nothing else, and flex puts that box in the middle of the tile. */
    _mini(id, keys){
      const box = $(id);
      if(!box) return;
      box.innerHTML = keys.map(k=>{
        const c = TET_PIECES[k].c;
        let x0 = 9, x1 = -1, y0 = 9, y1 = -1;
        for(const [x, y] of c){
          if(x < x0) x0 = x;
          if(x > x1) x1 = x;
          if(y < y0) y0 = y;
          if(y > y1) y1 = y;
        }
        const w = x1 - x0 + 1, h = y1 - y0 + 1;
        const own = {};
        for(const [x, y] of c) own[(y - y0) * w + (x - x0)] = 1;
        let out = '<div class="tet-mini"><div class="tet-mini-in" style="--w:' + w + '">';
        for(let i = 0; i < w * h; i++) out += '<i class="' + (own[i] ? 'on p' + k : '') + '"></i>';
        return out + '</div></div>';
      }).join('');
    },
    _banner(justLost){
      const bn = $('tet-banner');
      if(!bn) return;
      if(!this.done){ bn.classList.add('hide'); return; }
      const title = 'Stack topped out.';
      const sub = T('{points}, {lines}.', {points:Tn('{n} points', '{n} points', this.score),
          lines:Tn('{n} line', '{n} lines', this.lines)})
        + (this.score >= this.best && this.score > 0 ? ' ' + T('A new best.') : '');
      if(justLost){ showBanner('tet-banner', title, sub); return; }
      $('tet-win-title').textContent = title;
      $('tet-win-sub').textContent = sub;
      bn.classList.remove('hide');
    },
  };

  /* ---------------- holding a direction ----------------

     **Tapping eleven times to cross the board.** The on-screen arrows were
     `onclick`, which is one move per tap and nothing at all while a finger
     rests on them, so on a phone the only way to reach the far wall was to tap
     for it, against a piece that is falling. The keyboard was better only by
     accident: it rode the operating system key repeat, which waits about half
     a second and then runs at whatever rate the machine is set to. Neither is
     a control you can aim with.

     So the repeat is ours, on both. The two numbers are separate ideas and
     the gap between them is the whole feel of it: DAS is how long you must
     hold before it decides you meant to hold, ARR is how fast it goes after
     that. Without the delay a tap slides three cells and nothing can be
     placed; without the speed, holding is no better than tapping.

     The soft drop keeps its own rate. It is the one repeat that ends the
     piece, and overshooting costs the placement. */
  var TET_DAS = 170;        // held this long before it starts repeating
  var TET_ARR = 50;         // and a cell every this long after that
  var TET_SOFT = 45;        // the soft drop, which ends the piece

  var TET_HELD = {};        // what is being held down, by name

  function tetHoldStop(id){
    const h = TET_HELD[id];
    if(!h) return;
    clearTimeout(h.wait); clearInterval(h.beat);
    delete TET_HELD[id];
  }
  /* **Everything, for the events that mean a release will never arrive.** A
     pointer leaving the window, a tab going away: the finger or key is still
     notionally down and the matching up event is not coming. Without this the
     piece keeps sliding into the wall while the app is in the background. */
  function tetHoldAll(){ for(const id in TET_HELD) tetHoldStop(id); }

  /* **The rate is looked up here rather than passed in.** 13-arcade-wiring.js
     runs at load, before this file has assigned any of the numbers above, so a
     rate handed over at wiring time would be undefined -- and setInterval
     reads that as zero, which is a piece crossing the board in a frame. Asked
     for when a hold actually begins, by which point every file has run. */
  function tetRate(id){ return id === "down" ? TET_SOFT : TET_ARR; }

  function tetHoldStart(id, fn){
    tetHoldStop(id);
    fn();                                   // a tap is one move, always
    const h = {};
    h.wait = setTimeout(()=>{
      h.beat = setInterval(()=>{
        /* Asked every beat rather than once: a game can end, be paused or be
           left while a finger is still down on the arrow. */
        if(!Arcade.open || Arcade.active !== "tetris"
           || Tetris.done || Tetris.paused){ tetHoldStop(id); return; }
        fn();
      }, tetRate(id));
    }, TET_DAS);
    TET_HELD[id] = h;
  }

  /** Wire a button so holding it repeats. Called by 13-arcade-wiring.js. */
  function tetHoldBind(el, id, fn){
    if(!el) return;
    let fromPointer = false;
    el.addEventListener("pointerdown", (e)=>{
      fromPointer = true;
      /* So a finger that slides off the button still ends the hold here,
         rather than on whatever it slid onto. */
      try{ el.setPointerCapture(e.pointerId); }catch(err){}
      tetHoldStart(id, fn);
      e.preventDefault();
    });
    for(const ev of ["pointerup", "pointercancel", "pointerleave"]){
      el.addEventListener(ev, ()=>tetHoldStop(id));
    }
    /* **Click stays wired for the one case pointers do not cover**: a button
       reached by Tab and pressed with Enter fires a click with no pointer
       sequence in front of it. The flag is what stops a tap counting twice,
       since a tap fires both. */
    el.onclick = ()=>{
      if(fromPointer){ fromPointer = false; return; }
      fn();
    };
  }

  try{
    window.addEventListener("blur", tetHoldAll);
    document.addEventListener("visibilitychange", ()=>{
      if(document.visibilityState !== "visible") tetHoldAll();
    });
  }catch(e){}

  /* The keyboard, when tetris is the game on screen. Arrows to move and soft
     drop, space to slam it down, Z and X to turn, C to hold, P to pause. */
  document.addEventListener('keydown', e=>{
    if(!Arcade.open || Arcade.active !== 'tetris') return;
    const k = e.key;
    /* **The operating system repeat is thrown away.** Holding a key fires
       keydown over and over on its own schedule, which is the slow one being
       replaced here. Taking the first and ignoring the rest leaves our own
       timing in charge of everything after it. */
    const move = (id, fn)=>{
      if(!e.repeat) tetHoldStart(id, ()=>{ fn(); Tetris.render(); });
    };
    const once = (fn)=>{ if(!e.repeat){ fn(); Tetris.render(); } };
    if(k === 'ArrowLeft'){ move('left', ()=>Tetris._move(-1, 0)); }
    else if(k === 'ArrowRight'){ move('right', ()=>Tetris._move(1, 0)); }
    else if(k === 'ArrowDown'){ move('down', ()=>Tetris.softDrop()); }
    /* Turning and dropping do not repeat. A held rotate is a piece spinning on
       the spot, and a held hard drop would take the next piece down with it. */
    else if(k === 'ArrowUp' || k === 'x' || k === 'X'){ once(()=>Tetris.rotate(1)); }
    else if(k === 'z' || k === 'Z'){ once(()=>Tetris.rotate(-1)); }
    else if(k === ' '){ once(()=>Tetris.hardDrop()); }
    else if(k === 'c' || k === 'C' || k === 'Shift'){ once(()=>Tetris.swap()); }
    else if(k === 'p' || k === 'P'){ if(!e.repeat){ Tetris.pause(); } }
    else return;
    e.preventDefault();
  });

  document.addEventListener('keyup', e=>{
    if(e.key === 'ArrowLeft') tetHoldStop('left');
    else if(e.key === 'ArrowRight') tetHoldStop('right');
    else if(e.key === 'ArrowDown') tetHoldStop('down');
  });

  forgetGame(Tetris.key, ()=>Tetris.forget());

  registerGame('tetris', {
    el:'game-tetris', title:'Tetris', progEl:'prog-tetris', game:()=>Tetris,
    reset(){ Tetris.newGame(); },
    /* Held while the confirm is up, so the piece is not still falling behind
       it. Saying no leaves it paused rather than dropping you back into a board
       you stopped watching — resuming counts you in, which is the whole reason
       that count-in exists. */
    beforeReset(){ try{ if(!Tetris.done) Tetris.pause(true); }catch(e){} },
    resetNote:'The board stops while you decide. A fresh one loses this game’s '
      + 'score; your best stays.',
    async progress(){
      const d = await readGame(Tetris.key);
      if(!d || typeof d.b !== 'string') return 'New<span>tap to start</span>';
      if(d.done) return (d.best || 0) + '<span>best</span>';
      return (d.s || 0) + '<span>' + (d.l || 0) + ' lines</span>';
    },
  });
