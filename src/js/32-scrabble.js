  /* ---------------- SCRABBLE (shared) ----------------
     The full 15x15 board, standard tiles, standard premium squares, taking
     turns. Built on the shared-game channel in 29-sync.js, so the host owns the
     bag, the racks, the board and the clock, and everybody else sends intents.

     That matters more here than in hangman: a bag is a shared secret. If two
     windows each drew their own tiles they would disagree within one turn, and
     a player who could see the draw could see the game. One writer removes the
     whole class of problem — a rack only ever exists in its owner's window and
     the host's.

     Placement is local until you press Play. `SC.pending` is this window's
     uncommitted tiles; the host has never heard of them, so a recall costs
     nothing and a rejected word leaves the board untouched.

     There is deliberately no solo mode and no AI opponent.               */

  const SC_ALPHA = 'abcdefghijklmnopqrstuvwxyz';
  const SC_QUIET_END = 6;        // scoreless turns in a row that end the game
  const SC_LABEL = {d:'2L', t:'3L', D:'2W', T:'3W', '*':''};
  const SC_ZOOMS = [0, 26, 34, 44];   // 0 = fit the width; then fixed square sizes
  const SC_DRAG_SLOP = 6;             // px before a press counts as a drag

  const Scrabble = {
    key:'scrabble',
    view:null,             // what to draw — every window
    state:null,            // the truth — the host only
    built:false,

    pending:[],            // [{r,c,ch,blank,ri}] placed this turn, not yet played
    sel:-1,                // rack index currently picked up
    swapMode:false,        // the Swap button is a two-press affair
    swapSel:[],            // rack indices marked for a swap
    blankAt:null,          // {r,c,ri} while the blank chooser is open
    zoom:0,                // 0 = fit the width, then bigger
    drag:null,             // the press in progress: a tap until it moves
    pinch:null,            // {from, zoom} while two fingers are on the board

    /* ---- entering and leaving ---- */
    enter(){
      this.build();
      if(syncActive() && !syncIsHost()) syncGameSend(this.key, {a:'look'});
      if(syncIsHost()) this._ensure();
      this.render();
    },
    leave(){ this._closeBlank(); },

    build(){
      if(this.built) return;

      const board = $('sc-board');
      let html = '';
      for(let r=0;r<SCR_SIZE;r++) for(let c=0;c<SCR_SIZE;c++){
        const p = scrPrem(r,c);
        html += '<div class="sc-sq" data-r="'+r+'" data-c="'+c+'"'
              + (p !== '.' ? ' data-p="'+p+'" data-label="'+SC_LABEL[p]+'"' : '') + '></div>';
      }
      board.innerHTML = html;
      /* No click handlers here on purpose. Taps are resolved in `pointerup`
         instead — see `_wireDrag`. A touch that starts a pointer sequence the
         board captures does not reliably produce a click afterwards, which is
         why tapping a tile worked with a mouse and did nothing on a phone. */
      this._wireDrag();
      this._wirePinch();

      $('sc-zin').onclick = ()=>this.setZoom(this.zoom + 1);
      $('sc-zout').onclick = ()=>this.setZoom(this.zoom - 1);
      window.addEventListener('resize', ()=>{
        if(Arcade.open && Arcade.active === 'scrabble') this._sizeBoard();
      });

      /* No hold-menu on the board itself. Holding is how you pick a tile up, so
         a hold that sometimes opens a reset menu is a hold you can't trust —
         resetting lives on the game's card in the arcade instead, where nothing
         else is competing for the gesture. */

      $('sc-blank-keys').innerHTML = QWERTY.map(row=>
        '<div class="sc-blank-row">' + row.split('').map(c=>
          '<button data-b="'+c+'">'+c+'</button>').join('') + '</div>').join('');
      $('sc-blank-keys').onclick = (e)=>{
        const b = e.target.closest('[data-b]');
        if(b) this._placeBlank(b.dataset.b);
      };
      $('sc-blank-cancel').onclick = ()=>this._closeBlank();

      $('sc-play').onclick = ()=>this.play();
      $('sc-recall').onclick = ()=>this.recall();
      $('sc-shuffle').onclick = ()=>this.shuffle();
      $('sc-swap').onclick = ()=>this.swap();
      $('sc-pass').onclick = ()=>this.pass();
      $('sc-new').onclick = ()=>syncGameSend(this.key, {a:'new'});
      $('sc-need-go').onclick = ()=>{ Arcade.close(); syncOpen(); };
      this.built = true;
    },

    /* ---- zoom ----
       Fifteen squares across a phone is about 22px each: tappable, but far too
       small to read "3W" on. So level 0 fits the width and the rest are fixed
       sizes with the board scrolling inside its wrapper. */
    /* `anchor` is a point in client coordinates to keep still — the midpoint of
       a pinch, or the middle of the viewport for the buttons. Without it the
       board grows from its top-left corner and whatever you were looking at
       slides away, which is the opposite of what a pinch is asking for. */
    setZoom(z, anchor){
      const want = Math.max(0, Math.min(SC_ZOOMS.length - 1, z));
      if(want === this.zoom) return;
      const wrap = $('sc-boardwrap'), board = $('sc-board');
      let keep = null;
      if(wrap && board){
        const wr = wrap.getBoundingClientRect();
        const a = anchor || {x:wr.left + wr.width/2, y:wr.top + wr.height/2};
        keep = {
          // where in the board the anchor sits, 0..1, and where on screen it was
          fx:(wrap.scrollLeft + a.x - wr.left) / Math.max(1, board.scrollWidth),
          fy:(wrap.scrollTop  + a.y - wr.top ) / Math.max(1, board.scrollHeight),
          ox:a.x - wr.left, oy:a.y - wr.top,
        };
      }
      this.zoom = want;
      this._sizeBoard();
      if(keep){
        wrap.scrollLeft = keep.fx * board.scrollWidth  - keep.ox;
        wrap.scrollTop  = keep.fy * board.scrollHeight - keep.oy;
      }
      this.render();
    },
    _sizeBoard(){
      const board = $('sc-board'), wrap = $('sc-boardwrap');
      if(!board || !wrap) return;
      let cell = SC_ZOOMS[this.zoom];
      if(!cell){
        const avail = (wrap.clientWidth || 340) - 6 - 14;   // padding, then the 14 gaps
        cell = Math.max(16, Math.floor(avail / SCR_SIZE));
      }
      board.style.setProperty('--sc-cell', cell + 'px');
      const lab = $('sc-zlabel');
      if(lab) lab.textContent = this.zoom ? '×' + (this.zoom + 1) : 'Fit';
      const zin = $('sc-zin'), zout = $('sc-zout');
      if(zin) zin.disabled = this.zoom >= SC_ZOOMS.length - 1;
      if(zout) zout.disabled = this.zoom <= 0;
    },

    /* ---- picking tiles up and putting them down ----
       Pointer events rather than HTML5 drag-and-drop, which does not exist on
       touch, and — importantly — rather than `click`, which is unreliable once
       a touch sequence has been captured. Everything resolves in `pointerup`:
       if the pointer never really moved it was a tap, otherwise it was a drag.
       One code path, and it behaves the same under a finger and a mouse. */
    _wireDrag(){
      const onDown = (e)=>{
        if(this.pinch) return;
        if(e.pointerType === 'mouse' && e.button !== 0) return;
        const rackT = e.target.closest && e.target.closest('#sc-rack [data-i]');
        const sq = e.target.closest && e.target.closest('#sc-board [data-r]');
        if(!rackT && !sq) return;

        const d = {x:e.clientX, y:e.clientY, moved:false, el:null,
                   kind:rackT ? 'rack' : 'board'};
        if(rackT){
          d.i = +rackT.dataset.i;
          d.el = rackT;
        }else{
          d.r = +sq.dataset.r; d.c = +sq.dataset.c;
          d.el = sq;
        }

        // Only a tile you could actually pick up gets to become a drag; a press
        // on an empty square is a tap-to-place and nothing else.
        if(this._myTurn() && !this.swapMode){
          if(rackT && !rackT.disabled && !this.pending.some(t=>t.ri === d.i)){
            d.lift = {ri:d.i, ch:this.view.rack[d.i], blank:false};
          }else if(sq){
            let p = this.pending.find(t=>t.r===d.r && t.c===d.c);
            /* Missed by a square — take the nearest tile you could have meant.
               Only when your hand is empty: if a rack tile is already picked up
               you are trying to *place*, and snapping to a tile next door would
               pick that one up instead, which is the opposite of what you asked
               for. */
            if(!p && this.sel < 0){
              const near = this._magnet(e.clientX, e.clientY, 'lift');
              if(near){
                p = this.pending.find(t=>t.r===near.r && t.c===near.c);
                if(p){ d.r = near.r; d.c = near.c; }
              }
            }
            if(p) d.lift = {ri:p.ri, ch:p.ch, blank:p.blank, from:{r:d.r, c:d.c}};
          }
        }

        this.drag = d;
        /* Capturing the pointer redirects every later event to this element,
           which is what a drag needs and what a scroll must not have. Pressing
           an empty square and dragging is a scroll, so only capture once we
           know there is a tile to carry. */
        if(d.lift){
          try{ e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId); }catch(err){}
        }
      };

      const onMove = (e)=>{
        const d = this.drag;
        if(!d || !d.lift) return;
        if(!d.moved){
          if(Math.abs(e.clientX-d.x) < SC_DRAG_SLOP && Math.abs(e.clientY-d.y) < SC_DRAG_SLOP) return;
          d.moved = true;
          d.el.classList.add('dragging');
          const g = $('sc-ghost');
          g.textContent = d.lift.ch === '?' ? '' : d.lift.ch;
          g.classList.remove('hide');
        }
        if(e.cancelable) e.preventDefault();
        const g = $('sc-ghost');
        g.style.left = e.clientX + 'px';
        g.style.top = e.clientY + 'px';
        this._markDrop(e.clientX, e.clientY);
      };

      const onUp = (e)=>{
        const d = this.drag;
        this.drag = null;
        if(!d) return;
        $('sc-ghost').classList.add('hide');
        if(d.el) d.el.classList.remove('dragging');
        this._markDrop(-1, -1);

        if(!d.moved){
          // a tap
          if(d.kind === 'rack') this.tapRack(d.i);
          else this.tapSquare(d.r, d.c, e.clientX, e.clientY);
          return;
        }

        if(d.lift.from) this._liftAt(d.lift.from.r, d.lift.from.c);
        let sq = this._squareAt(e.clientX, e.clientY);
        const taken = (q)=> !q || this.view.board[q.r*SCR_SIZE+q.c]
                          || this.pending.some(t=>t.r===q.r && t.c===q.c);
        if(taken(sq)) sq = this._magnet(e.clientX, e.clientY, 'drop');
        if(!taken(sq)){
          if(d.lift.ch === '?'){ this.blankAt = {r:sq.r, c:sq.c, ri:d.lift.ri}; this._openBlank(); }
          else this.pending.push({r:sq.r, c:sq.c, ch:d.lift.ch, blank:!!d.lift.blank, ri:d.lift.ri});
        }
        this.sel = -1;
        this.render();
      };

      const live = $('sc-live');
      live.addEventListener('pointerdown', onDown);
      live.addEventListener('pointermove', onMove, {passive:false});
      live.addEventListener('pointerup', onUp);
      live.addEventListener('pointercancel', ()=>{
        const d = this.drag;
        this.drag = null;
        if(d && d.el) d.el.classList.remove('dragging');
        $('sc-ghost').classList.add('hide');
        this._markDrop(-1, -1);
        this.render();
      });
    },

    /* ---- pinch ----
       The buttons stay, because a mouse has no pinch and a one-handed phone grip
       often doesn't either. But reaching for the board and spreading two fingers
       is what everybody tries first, so the board answers it. */
    _wirePinch(){
      const wrap = $('sc-boardwrap');
      const pts = new Map();
      const span = ()=>{
        const [a, b] = [...pts.values()];
        return Math.hypot(a.x - b.x, a.y - b.y);
      };
      const mid = ()=>{
        const [a, b] = [...pts.values()];
        return {x:(a.x + b.x)/2, y:(a.y + b.y)/2};
      };

      wrap.addEventListener('pointerdown', e=>{
        pts.set(e.pointerId, {x:e.clientX, y:e.clientY});
        if(pts.size === 2){
          this.pinch = {from:span(), zoom:this.zoom};
          this.drag = null;                    // a second finger cancels any drag
          $('sc-ghost').classList.add('hide');
          this._markDrop(-1, -1);
        }
      });
      wrap.addEventListener('pointermove', e=>{
        if(!pts.has(e.pointerId)) return;
        pts.set(e.pointerId, {x:e.clientX, y:e.clientY});
        if(pts.size !== 2 || !this.pinch) return;
        if(e.cancelable) e.preventDefault();
        const ratio = span() / (this.pinch.from || 1);
        // a step per 25% change, so it takes a deliberate spread to move a level
        const step = Math.round((ratio - 1) / 0.25);
        const want = Math.max(0, Math.min(SC_ZOOMS.length - 1, this.pinch.zoom + step));
        if(want !== this.zoom) this.setZoom(want, mid());
      }, {passive:false});

      const drop = e=>{
        pts.delete(e.pointerId);
        if(pts.size < 2) this.pinch = null;
      };
      ['pointerup','pointercancel','pointerleave'].forEach(ev=>wrap.addEventListener(ev, drop));
    },

    _squareAt(x, y){
      const el = document.elementFromPoint(x, y);
      const sq = el && el.closest && el.closest('#sc-board [data-r]');
      return sq ? {r:+sq.dataset.r, c:+sq.dataset.c} : null;
    },

    /* ---- the magnet ----
       At Fit zoom a square is about 22px, which is smaller than a fingertip, and
       the tile you meant is often the one *next* to the one you hit. So a press
       that lands on the wrong square is pulled to the nearest tile you could
       actually have meant — a tile of yours to pick up, or a letter to select.

       Only within a square's width, and only ever to a square that answers the
       question you were asking: picking up looks for your own uncommitted tiles,
       putting down looks for empty squares. Snapping to something irrelevant
       would be worse than not snapping at all. */
    _magnet(x, y, want){
      const board = $('sc-board');
      if(!board) return null;
      const cell = parseFloat(getComputedStyle(board).getPropertyValue('--sc-cell')) || 22;
      const reach = Math.max(16, cell) * 1.15;
      let best = null, bestD = Infinity;

      for(let i=0;i<board.children.length;i++){
        const r = (i/SCR_SIZE)|0, c = i%SCR_SIZE;
        if(want === 'lift'){
          if(!this.pending.some(t=>t.r===r && t.c===c)) continue;
        }else{
          if(this.view.board[i]) continue;
          if(this.pending.some(t=>t.r===r && t.c===c)) continue;
        }
        const b = board.children[i].getBoundingClientRect();
        const dx = x - (b.left + b.width/2), dy = y - (b.top + b.height/2);
        const d = Math.hypot(dx, dy);
        if(d < bestD){ bestD = d; best = {r, c}; }
      }
      return (best && bestD <= reach) ? best : null;
    },
    _markDrop(x, y){
      const board = $('sc-board');
      if(!board) return;
      let at = x >= 0 ? this._squareAt(x, y) : null;
      if(x >= 0 && (!at || this.view.board[at.r*SCR_SIZE+at.c]
                        || this.pending.some(t=>t.r===at.r && t.c===at.c))){
        at = this._magnet(x, y, 'drop');
      }
      const want = at ? at.r*SCR_SIZE + at.c : -1;
      for(let i=0;i<board.children.length;i++) board.children[i].classList.toggle('drop', i === want);
    },
    _liftAt(r, c){
      const k = this.pending.findIndex(t=>t.r===r && t.c===c);
      if(k >= 0) this.pending.splice(k,1);
    },

    /* ================= this window's half-finished turn ================= */

    _myTurn(){ return !!(this.view && this.view.myTurn && !this.view.over); },
    _at(r,c){
      const v = this.view;
      if(!v) return null;
      const p = this.pending.find(t=>t.r===r && t.c===c);
      if(p) return p;
      return v.board[r*SCR_SIZE+c] || null;
    },

    tapRack(i){
      if(!this._myTurn()) return;
      const v = this.view;
      if(this.pending.some(t=>t.ri === i)) return;   // that one is on the board
      if(this.swapMode){
        const k = this.swapSel.indexOf(i);
        if(k >= 0) this.swapSel.splice(k,1); else this.swapSel.push(i);
        this.render();
        return;
      }
      this.sel = (this.sel === i) ? -1 : i;
      this.render();
    },

    tapSquare(r,c,x,y){
      if(!this._myTurn()) return;
      // a tap that landed next to one of your tiles was almost certainly aimed
      // at it; squares are smaller than fingers
      if(x != null && !this.pending.some(t=>t.r===r && t.c===c) && !this.view.board[r*SCR_SIZE+c]
         && this.sel < 0){
        const near = this._magnet(x, y, 'lift');
        if(near){ r = near.r; c = near.c; }
      }
      const held = this.pending.findIndex(t=>t.r===r && t.c===c);
      if(held >= 0){                                  // take it back
        const t = this.pending.splice(held,1)[0];
        this.sel = t.ri;
        this.render();
        return;
      }
      if(this.view.board[r*SCR_SIZE+c]) return;       // already played, not yours
      if(this.sel < 0){ this._say('Pick a tile first.'); return; }

      const ch = this.view.rack[this.sel];
      if(ch === '?'){ this.blankAt = {r,c,ri:this.sel}; this._openBlank(); return; }
      this.pending.push({r,c,ch,blank:false,ri:this.sel});
      this.sel = -1;
      this.render();
    },

    _openBlank(){ $('sc-blank').classList.remove('hide'); },
    _closeBlank(){ this.blankAt = null; const el=$('sc-blank'); if(el) el.classList.add('hide'); },
    _placeBlank(ch){
      const b = this.blankAt;
      if(!b) return;
      this.pending.push({r:b.r, c:b.c, ch, blank:true, ri:b.ri});
      this.sel = -1;
      this._closeBlank();
      this.render();
    },

    recall(){ this.pending = []; this.sel = -1; this.render(); },

    shuffle(){
      if(!this.view || !this.view.rack) return;
      // shuffling is cosmetic, so it stays local — the host's copy is the
      // authority on *which* tiles you hold, not what order you like them in.
      const held = this.pending.map(t=>t.ri);
      const rack = this.view.rack.slice();
      const free = rack.map((ch,i)=>i).filter(i=>held.indexOf(i) < 0);
      for(let i=free.length-1;i>0;i--){
        const j = Math.random()*(i+1)|0;
        const a = free[i], b = free[j];
        const t = rack[a]; rack[a] = rack[b]; rack[b] = t;
      }
      this.view.rack = rack;
      this.render();
    },

    swap(){
      if(!this._myTurn()) return;
      if(!this.swapMode){
        if(this.pending.length){ this._say('Recall your tiles first.'); return; }
        this.swapMode = true; this.swapSel = []; this.sel = -1;
        this._say('Pick the tiles to put back, then Swap again.');
        this.render();
        return;
      }
      const idx = this.swapSel.slice();
      this.swapMode = false; this.swapSel = [];
      if(!idx.length){ this._say(''); this.render(); return; }
      syncGameSend(this.key, {a:'swap', idx});
    },

    pass(){
      if(!this._myTurn()) return;
      this.swapMode = false; this.swapSel = [];
      this.recall();
      syncGameSend(this.key, {a:'pass'});
    },

    play(){
      if(!this._myTurn()) return;
      if(!this.pending.length){ this._say('Nothing on the board yet.'); return; }
      syncGameSend(this.key, {a:'play', tiles:this.pending.map(t=>
        ({r:t.r, c:t.c, ch:t.ch, blank:t.blank, ri:t.ri}))});
    },

    _say(m, warn){
      const el = $('sc-msg');
      if(!el) return;
      el.textContent = m || '';
      el.classList.toggle('warn', !!warn);
    },

    /* ---- the live read ----
       Runs the real rules — `scrJudge` is the same function the host will use to
       accept or refuse this play — against this window's copy of the board.

       It stays blank while the tiles are still scattered. Telling somebody
       "leave no gaps" when they have laid one tile down and are reaching for the
       next is nagging, not help; the rules distinguish "not finished" from
       "wrong" so this can tell them apart. */
    _preview(){
      const box = $('sc-preview');
      if(!box) return;
      box.className = 'sc-preview';
      box.innerHTML = '';

      /* The Play button reports the same verdict, because "why is this greyed
         out" is the question a disabled button always raises. Ready and worth
         14 points is a different button from ready and not a word. */
      const btn = $('sc-play'), lab = $('sc-play-label'), pts = $('sc-play-pts');
      const setBtn = (state, label, points)=>{
        if(!btn) return;
        btn.className = 'sc-playbtn' + (state ? ' ' + state : '');
        btn.disabled = state !== 'ready';
        lab.textContent = label;
        pts.textContent = points == null ? '' : '+' + points;
      };

      if(!this._myTurn()){ setBtn('', 'Play', null); return; }
      if(!this.pending.length){ setBtn('', 'Play', null); return; }

      const r = scrJudge(this.view.board, this.pending);
      if(r.ok){
        const main = r.words.slice().sort((a,b)=>b.length - a.length)[0] || '';
        box.innerHTML = '<span class="w">'+esc(main)+'</span>'
          + (r.words.length > 1 ? '<span class="x">+'+(r.words.length-1)+' more</span>' : '');
        setBtn('ready', 'Play ' + main.toUpperCase(), r.pts);
        return;
      }
      if(scrUnfinished(r.why)){ setBtn('', 'Keep going', null); return; }

      box.className = 'sc-preview bad';
      // a rejected word is worth naming; a rule you broke is worth stating
      box.innerHTML = /^Not a word|^Not words/.test(r.why)
        ? '<span class="w">'+esc(r.why.replace(/^Not a? ?words?: /,''))+'</span><span>no such word</span>'
        : '<span>'+esc(r.why)+'</span>';
      setBtn('bad', /^Not a word|^Not words/.test(r.why) ? 'Not a word' : 'Can’t play that', null);
    },

    /* ================= host side ================= */

    _blank(){
      return {
        board:new Array(SCR_SIZE*SCR_SIZE).fill(null),
        bag:scrBag(), seats:[], turn:0, moves:0,
        last:null, quiet:0, over:false, winner:'', endedBy:'',
      };
    },

    /** Seat everyone who's here, drop anyone who left, keep the turn sane. */
    _ensure(){
      if(!syncIsHost()) return;
      const here = syncSeats();
      if(!here.length) return;
      if(!this.state) this.state = this._blank();
      const st = this.state;

      const onTurn = st.seats[st.turn] ? st.seats[st.turn].id : null;

      for(const p of here){
        if(!st.seats.some(s=>s.id === p.id)){
          st.seats.push({id:p.id, name:p.name, rack:[], score:0});
        }else{
          st.seats.find(s=>s.id === p.id).name = p.name;
        }
      }
      // someone left: their tiles go back in the bag rather than out of the game
      const gone = st.seats.filter(s=>!here.some(p=>p.id === s.id));
      for(const s of gone){ st.bag = st.bag.concat(s.rack); this._shuffleBag(); }
      st.seats = st.seats.filter(s=>here.some(p=>p.id === s.id));

      for(const s of st.seats) this._refill(s);

      const i = st.seats.findIndex(s=>s.id === onTurn);
      st.turn = i >= 0 ? i : (st.seats.length ? st.turn % st.seats.length : 0);

      this._push();
    },

    _shuffleBag(){
      const bag = this.state.bag;
      for(let i=bag.length-1;i>0;i--){
        const j = Math.random()*(i+1)|0;
        const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
      }
    },
    _refill(seat){
      const st = this.state;
      while(seat.rack.length < SCR_RACK && st.bag.length) seat.rack.push(st.bag.pop());
    },

    _newGame(){
      const names = (this.state ? this.state.seats : []).map(s=>({id:s.id, name:s.name}));
      this.state = this._blank();
      this.state.seats = names.map(n=>({id:n.id, name:n.name, rack:[], score:0}));
      for(const s of this.state.seats) this._refill(s);
      this._ensure();
    },

    /** Rack check, then the rules. Returns {ok, pts, words} or {why}. */
    _judge(seat, tiles){
      if(!tiles || !tiles.length) return {why:'Nothing to play.'};
      if(tiles.length > SCR_RACK) return {why:'That is more tiles than you hold.'};

      // the tiles must really be in this rack, each one used once
      const spare = seat.rack.slice();
      for(const t of tiles){
        const want = t.blank ? '?' : t.ch;
        const k = spare.indexOf(want);
        if(k < 0) return {why:'You do not hold those tiles.'};
        spare[k] = null;
      }
      return scrJudge(this.state.board, tiles);
    },

    _finish(reason){
      const st = this.state;
      st.over = true;
      // everyone still holding tiles pays for them; whoever went out collects
      let out = null, owed = 0;
      for(const s of st.seats){
        const left = s.rack.reduce((n,ch)=>n + (SCR_VALUES[ch]||0), 0);
        if(!s.rack.length && !st.bag.length) out = s;
        s.score -= left;
        owed += left;
      }
      if(out) out.score += owed;
      const best = st.seats.slice().sort((a,b)=>b.score - a.score);
      const tie = best.length > 1 && best[0].score === best[1].score;
      st.winner = tie ? '' : (best[0] ? best[0].name : '');
      st.endedBy = reason;
    },

    _advance(){
      const st = this.state;
      if(!st.seats.length) return;
      st.turn = (st.turn + 1) % st.seats.length;
    },

    _intent(from, m){
      if(!syncIsHost() || !m) return;
      this._ensure();
      const st = this.state;
      if(!st) return;

      if(m.a === 'look'){ syncGamePush(this.key, from, this._viewFor(from)); return; }

      // Starting over is the timer holder's call, and the host is what enforces
      // it — the menu being hidden elsewhere is a convenience, not the rule.
      // `new` is the same thing from the button on a finished or unstarted game.
      if(m.a === 'reset'){
        if(from !== SYNC.leaderId) return;
        this._newGame();
        return;
      }
      if(m.a === 'new'){
        if(st.moves && !st.over) return;      // not mid-game; use the hold menu
        this._newGame();
        return;
      }

      const seat = st.seats[st.turn];
      if(!seat || seat.id !== from || st.over) return;      // not your turn
      if(st.seats.length < 2) return;                        // nothing to play against

      if(m.a === 'pass'){
        st.quiet++;
        st.last = {name:seat.name, word:'', pts:0, what:'passed'};
        if(st.quiet >= SC_QUIET_END) this._finish('quiet');
        else this._advance();
        this._push();
        return;
      }

      if(m.a === 'swap'){
        const idx = (m.idx||[]).filter(i=>Number.isInteger(i) && i>=0 && i<seat.rack.length);
        const uniq = idx.filter((v,i)=>idx.indexOf(v)===i);
        if(!uniq.length) return;
        if(st.bag.length < uniq.length){
          syncGamePush(this.key, from, this._viewFor(from, 'Not enough left in the bag to swap.'));
          return;
        }
        const back = uniq.map(i=>seat.rack[i]);
        seat.rack = seat.rack.filter((_,i)=>uniq.indexOf(i) < 0);
        this._refill(seat);
        st.bag = st.bag.concat(back);
        this._shuffleBag();
        st.quiet++;
        st.last = {name:seat.name, word:'', pts:0, what:'swapped '+uniq.length};
        if(st.quiet >= SC_QUIET_END) this._finish('quiet');
        else this._advance();
        this._push();
        return;
      }

      if(m.a === 'play'){
        const r = this._judge(seat, m.tiles);
        if(!r.ok){
          // only the player who tried needs telling; everyone else saw nothing
          syncGamePush(this.key, from, this._viewFor(from, r.why));
          return;
        }
        for(const t of m.tiles){
          st.board[t.r*SCR_SIZE+t.c] = {ch:t.ch, blank:!!t.blank, at:st.moves};
          const k = seat.rack.indexOf(t.blank ? '?' : t.ch);
          if(k >= 0) seat.rack.splice(k,1);
        }
        seat.score += r.pts;
        st.moves++;
        st.quiet = 0;
        const longest = r.words.slice().sort((a,b)=>b.length - a.length)[0] || '';
        /* `by`, `sweep` and `tens` ride along on the last play so the person who
           made it can mark their own achievements. The host is the only window
           that judged the play, and it isn't necessarily theirs. */
        st.last = {name:seat.name, word:longest.toUpperCase(), pts:r.pts, what:'',
                   by:from, sweep:!!r.sweep, tens:r.tens|0};

        this._refill(seat);
        if(!seat.rack.length && !st.bag.length) this._finish('out');
        else this._advance();
        this._push();
      }
    },

    /** Your rack is yours. Everyone else's is a number. */
    _viewFor(id, note){
      const st = this.state;
      if(!st) return null;
      const seat = st.seats.find(s=>s.id === id);
      const onTurn = st.seats[st.turn];
      return {
        board: st.board.map(t=>t ? {ch:t.ch, blank:!!t.blank, at:t.at} : null),
        rack: seat ? seat.rack.slice() : [],
        players: st.seats.map(s=>({
          id:s.id, name:s.name, score:s.score, tiles:s.rack.length,
          turn: onTurn && s.id === onTurn.id, me: s.id === id,
        })),
        myTurn: !!(onTurn && onTurn.id === id) && !st.over,
        turnName: onTurn ? onTurn.name : '',
        bagLeft: st.bag.length,
        moves: st.moves,
        last: st.last ? Object.assign({}, st.last, {mine: st.last.by === id}) : null,
        over: st.over, winner: st.winner, endedBy: st.endedBy || '',
        alone: st.seats.length < 2,
        note: note || '',
      };
    },

    _push(){ syncGamePushAll(this.key, id=>this._viewFor(id)); },

    /* ================= drawing ================= */

    apply(v){
      const before = this.view;
      // A rejected word comes back as the same turn with a note on it, so the
      // player keeps their tiles where they put them and can fix the spelling.
      // Anything else — the board moved on, or it stopped being your turn —
      // clears the half-finished play.
      const stale = !v || !v.myTurn || (before && before.moves !== v.moves);
      // a play of mine that the board has just accepted, once, as it lands
      if(v && v.last && v.last.mine && (!before || before.moves !== v.moves)){
        try{
          if(v.last.sweep) featMark('sweep');
          if((v.last.tens|0) >= 2) featMark('tens');
        }catch(e){}
      }
      this.view = v;
      if(stale){ this.pending = []; this.sel = -1; this.swapMode = false; this.swapSel = []; }
      if(Arcade.open && Arcade.active === 'scrabble') this.render(v && v.note);
      if(v && v.over && (!before || !before.over)) this._cheer(v);
      try{ Arcade._refresh(); }catch(e){}
    },

    _cheer(v){
      const me = v.players.find(p=>p.me);
      const won = me && v.winner === me.name;
      if(won){ chime(false); showBanner('sc-banner', 'You won.', me.score + ' points.'); }
      else{
        const bn = $('sc-banner');
        bn.querySelector('h3').textContent = v.winner ? v.winner + ' won.' : 'A draw.';
        $('sc-win-sub').textContent = v.endedBy === 'quiet'
          ? 'Six turns went by with nothing scored.' : 'The bag is empty.';
        bn.classList.remove('hide');
      }
      setTimeout(()=>{ const b=$('sc-banner'); if(b) b.classList.add('hide'); }, 4200);
    },

    render(note){
      if(!$('sc-live')) return;
      const v = this.view;
      const inRoom = syncActive();

      $('sc-need').classList.toggle('hide', inRoom);
      $('sc-live').classList.toggle('hide', !inRoom || !v);
      $('sc-new').classList.toggle('hide', !(v && (v.over || v.moves === 0)));
      $('sc-meta').textContent = v ? (v.bagLeft + ' in the bag') : '';
      if(!inRoom || !v) return;
      if(!$('sc-board').style.getPropertyValue('--sc-cell')) this._sizeBoard();

      // players
      $('sc-players').innerHTML = v.players.map(p=>
        '<div class="sc-player'+(p.turn?' turn':'')+'">'
        + '<span>'+esc(p.name)+(p.me?' (you)':'')+'</span>'
        + '<b>'+p.score+'</b><i>'+p.tiles+'</i></div>').join('');

      // board
      const cells = $('sc-board').children;
      for(let i=0;i<SCR_SIZE*SCR_SIZE;i++){
        const r = (i/SCR_SIZE)|0, c = i%SCR_SIZE;
        const el = cells[i];
        const pend = this.pending.find(t=>t.r===r && t.c===c);
        const t = pend || v.board[i];
        el.classList.toggle('tile', !!t);
        el.classList.toggle('pend', !!pend);
        el.classList.toggle('wild', !!(t && t.blank));
        el.classList.toggle('fresh', !!(t && !pend && v.last && t.at === v.moves-1));
        el.classList.toggle('open', !t && this._myTurn());
        if(t){
          const val = t.blank ? '' : '<span class="v">'+(SCR_VALUES[t.ch]||0)+'</span>';
          el.innerHTML = esc(t.ch) + val;
        }else el.innerHTML = '';
      }

      // rack
      const used = this.pending.map(t=>t.ri);
      $('sc-rack').innerHTML = v.rack.map((ch,i)=>{
        if(used.indexOf(i) >= 0) return '<span class="sc-t gap"></span>';
        const cls = 'sc-t' + (this.sel===i ? ' sel' : '')
                  + (this.swapSel.indexOf(i)>=0 ? ' swap' : '');
        const val = ch === '?' ? '' : '<span class="v">'+(SCR_VALUES[ch]||0)+'</span>';
        return '<button class="'+cls+'" data-i="'+i+'"'+(this._myTurn()?'':' disabled')+'>'
             + (ch === '?' ? '&nbsp;' : esc(ch)) + val + '</button>';
      }).join('');

      // buttons — Play is set by _preview(), which knows whether it would work
      const mine = this._myTurn();
      ['sc-recall','sc-shuffle','sc-swap','sc-pass'].forEach(id=>{
        $(id).disabled = !mine;
      });
      $('sc-swap').textContent = this.swapMode ? 'Swap these' : 'Swap';

      this._preview();

      // the line under the board
      if(note){ this._say(note, true); return; }
      if(v.alone){ this._say('Nobody else is here yet. Share your code from Focus together.'); return; }
      if(v.over){
        this._say(v.winner ? v.winner + ' won it.' : 'It ended level.');
        return;
      }
      const last = v.last;
      const lastTxt = !last ? ''
        : last.what ? last.name + ' ' + last.what + '. '
        : last.name + ' played ' + last.word + ' for ' + last.pts + '. ';
      this._say(lastTxt + (mine ? 'Your turn.' : v.turnName + ' is thinking.'));
    },
  };

  syncGameRegister('scrabble', {
    intent(from, m){ Scrabble._intent(from, m); },
    apply(v){ Scrabble.apply(v); },
    roster(){ Scrabble._ensure(); },
    /* The board travels when the room does — see the handover note in
       29-sync.js. Nothing here needs converting: it is keyed by peer id, and a
       peer id belongs to the person now, not to the room. */
    save(){ return Scrabble.state; },
    load(s){ Scrabble.state = s; Scrabble._ensure(); },
  });

  registerGame('scrabble', {
    el:'game-scrabble', title:'Scrabble', progEl:'prog-scrabble', game:()=>Scrabble,
    canReset:()=>syncIsLeader(),
    reset(){ syncGameSend(Scrabble.key, {a:'reset'}); },
    resetNote:'The board is cleared, the bag refilled, and every score goes back to zero.',
    async progress(){
      if(!syncActive()) return 'Room<span>needs a room</span>';
      const v = Scrabble.view;
      if(!v || v.alone) return 'Ready<span>waiting</span>';
      if(v.over) return 'Over<span>'+(v.winner ? esc(v.winner)+' won' : 'a draw')+'</span>';
      const me = v.players.find(p=>p.me);
      return (me ? me.score : 0)+'<span>'+(v.myTurn ? 'your turn' : 'their turn')+'</span>';
    }
  });

