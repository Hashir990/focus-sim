  /* ---------------- CROSSWORD ----------------
     Puzzles come from the bank in 26-crossword-data.js — real grids generated
     offline by tools/build-crosswords.py. Nothing is laid out at run time any
     more.

     The bank holds two kinds of grid and `crossParse()` is the only thing that
     knows the difference: black-square grids, and *barred* grids where every
     square is a letter and the entries are divided by thick bars on the square
     edges. Barred exists because a fully checked 9x9 with black squares almost
     never fills. Here it means two things: `puz.bars` decides how the grid is
     drawn, and `render()` has to put the bar classes back because it rewrites
     each square's whole class list.

     The old version built a grid in the browser by dropping words across each
     other. It worked, but it could only ever make sparse, sprawling shapes with a
     handful of crossings, and it drew its clues from three small hand-kept banks
     — which is why the same ones came round within a session.

     Three things follow from puzzles being fixed rather than generated:

     - **Progress is per puzzle, not one board.** `arcade_cross` keeps a record
       against each puzzle's index, so you can leave one half-finished, do
       another, and come back. That is what makes the picker worth having.
     - **Size is the only choice.** Difficulty used to mean "which of three word
       banks", which is not a difficulty.
     - **Entries are derived, never stored.** `crossParse()` walks the grid for
       numbers, directions and answers. Storing them would be storing something
       the shape already says, and the two could then disagree.

     Hints reveal one letter. They are counted, they lock the square, and they
     look different from a letter you worked out — a hint you can't see is a hint
     you take twice by accident, and "solved it with nine revealed" is a different
     thing from "solved it". */

  const Cross = {
    key:'arcade_cross', built:false, loaded:false,
    size:7,                  // 5, 7, 9 or 15
    idx:-1,                  // where we are in CROSS_GRIDS *right now* — this
                             // moves when the bank grows, so nothing is ever
                             // saved against it; see _fp() and crossKey()
    puz:null,                // {n, rows, entries} from crossParse
    user:[], given:[],       // letters typed; squares revealed by a hint
    sel:-1, dir:'across',
    done:false, elapsed:0, tick:null, wrong:null,
    progress:{},             // puzzle index -> {u, g, done, secs}

    /* ---- coming and going ---- */
    async enter(){
      if(!this.loaded){
        const d = await readGame(this.key);
        if(d){
          this.progress = this._migrate(d.p || {});
          this.size = [5,7,9,15].indexOf(d.size) >= 0 ? d.size : 7;
          // Where you were is remembered by fingerprint too, for the same
          // reason: `idx` alone would reopen whatever has since moved into
          // that slot. The number is only a fallback for saves from before.
          this.idx = -1;
          if(d.key) this.idx = this._find(d.key);
          if(this.idx < 0 && typeof d.idx === 'number' && !d.key) this.idx = d.idx;
        }
        this.loaded = true;
      }
      if(this.idx < 0 || !CROSS_GRIDS[this.idx]) this.idx = this._firstUnfinished(this.size);
      this.load(this.idx);
      if(!this.done) this.run();
    },
    leave(){ this.stop(); this.persist(); this._closePicker(); },

    /* ---- which puzzle ---- */
    _at(size){ return crossAtSize(size); },

    /* A puzzle's name, which is a hash of the puzzle — see crossKey(). Note
       `this.key` is the storage key for the whole game and is a different
       thing entirely. */
    _fp(i){ const g = CROSS_GRIDS[i]; return g ? crossKey(g) : ''; },
    _find(fp){
      for(let i=0;i<CROSS_GRIDS.length;i++) if(crossKey(CROSS_GRIDS[i]) === fp) return i;
      return -1;
    },
    _rec(i){ const k = this._fp(i); return (k && this.progress[k]) || null; },

    /** Bring a saved bundle forward, and throw out what the old index-keyed
        scheme corrupted.

        Records written before this change are keyed by position, and after the
        bank grew, some of those positions point at a different puzzle. A record
        is only carried over if it could plausibly belong to the puzzle now
        sitting at its index: the right number of squares, revealed squares that
        agree with the solution — those came *from* the solution, so a single
        disagreement is proof — and most of its letters correct. Solving turns up
        a few wrong guesses; a foreign puzzle's letters agree about one time in
        twenty-six, so two thirds separates the two cases cleanly.

        Anything that fails is dropped rather than repaired. A puzzle you have to
        start again is a small loss; one that opens full of contradictions is the
        bug being reported. */
    _migrate(p){
      const out = {};
      for(const k in p){
        if(!Object.prototype.hasOwnProperty.call(p, k)) continue;
        const rec = p[k];
        if(!rec) continue;
        if(!/^\d+$/.test(k)){ out[k] = rec; continue; }   // already a fingerprint
        const g = CROSS_GRIDS[+k];
        if(!g) continue;
        // Stored letters are uppercased on the way in (see `_solAt`); the bank
        // is lowercase. Compare in one case or nothing ever matches and every
        // record gets thrown away, including the good ones.
        const sol = crossRows(g).join('').toUpperCase();
        if(typeof rec.u !== 'string' || rec.u.length !== sol.length) continue;
        let filled = 0, agree = 0;
        for(let i=0;i<sol.length;i++){
          if(sol[i] === '#' || rec.u[i] === '.') continue;
          filled++;
          if(rec.u[i] === sol[i]) agree++;
        }
        if(filled && agree * 3 < filled * 2) continue;
        if(Array.isArray(rec.g) && rec.g.some(i=>rec.u[i] !== sol[i])) continue;
        out[crossKey(g)] = rec;
      }
      return out;
    },
    _isDone(i){ const r = this._rec(i); return !!(r && r.done); },

    /** The one to open by default: the first at this size you haven't finished. */
    _firstUnfinished(size){
      const list = this._at(size);
      for(const i of list) if(!this._isDone(i)) return i;
      return list.length ? list[0] : 0;
    },

    load(i){
      const g = CROSS_GRIDS[i];
      if(!g) return;
      this.stop();
      this.idx = i;
      this.puz = crossParse(g);
      this.size = this.puz.n;
      const n = this.puz.n, cells = n*n;

      // A record whose length is not this grid's is not this grid's record, so
      // the whole thing is dropped — letters, clock and finished flag together.
      // Trimming it to fit is what turned one stale index into a 9x9's letters
      // showing up inside a 7x7, under a banner saying it had been solved.
      let rec = this._rec(i);
      if(rec && (typeof rec.u !== 'string' || rec.u.length !== cells)) rec = null;
      this.user  = new Array(cells).fill('');
      this.given = new Array(cells).fill(false);
      if(rec){
        for(let k=0;k<cells;k++){
          if(rec.u[k] !== '.') this.user[k] = rec.u[k];
        }
        if(Array.isArray(rec.g)) for(const k of rec.g) if(k >= 0 && k < cells) this.given[k] = true;
      }
      this.elapsed = (rec && rec.secs) || 0;
      this.done = !!(rec && rec.done);
      this.wrong = null;

      const first = this.puz.entries[0];
      this.sel = first ? first.cells[0][0]*n + first.cells[0][1] : -1;
      this.dir = 'across';

      this.built = false;                 // the shape changed; rebuild the grid
      this.build();
      this.render();
      $('cw-banner').classList.toggle('hide', !this.done);
      if(this.done) $('cw-win-sub').textContent = this._summary();
      this.persist();
    },

    /* Start one over: clear its letters and the ones it revealed.

       Order matters. `persist()` writes the *in-memory* letters back against the
       current index, so deleting the record and then persisting immediately puts
       everything straight back. The reload has to happen in between — it is what
       empties `user` and `given` — and it persists on its way out. */
    resetPuzzle(i){
      delete this.progress[this._fp(i)];
      if(i === this.idx){ this.load(i); this.run(); }
      else{ this.persist(); this._renderList(); }
      this._renderList();
    },

    /** From the game's card in the arcade — clears the whole set. */
    resetAll(){
      this.progress = {};
      if(this.puz){ this.load(this._firstUnfinished(this.size)); this.run(); }
      else{ this.idx = -1; this.persist(); }
    },

    nextPuzzle(){
      const list = this._at(this.size);
      const k = list.indexOf(this.idx);
      for(let step=1; step<=list.length; step++){
        const cand = list[(k + step + list.length) % list.length];
        if(!this._isDone(cand)){ this.load(cand); this.run(); return; }
      }
      this.load(list[(k + 1) % list.length]);
      this.run();
    },

    setSize(size){
      if(this.size === size) return;
      this.persist();
      this.load(this._firstUnfinished(size));
      if(!this.done) this.run();
    },

    /* ---- building the screen ---- */
    build(){
      if(this.built || !this.puz) return;
      const p = this.puz, n = p.n;

      // Clue numbers live on the first cell of each entry. Two entries can start
      // on the same square (one across, one down) and they share the number.
      const nums = {};
      for(const e of p.entries){
        const k = e.cells[0][0]*n + e.cells[0][1];
        if(!nums[k]) nums[k] = e.num;
      }

      const grid = $('cw-grid');
      grid.innerHTML = '';
      grid.style.setProperty('--n', n);
      // A 15x15 in the 380px box the small sizes use gives 23px squares, which
      // is under the 44px touch target and unreadable besides. `cw--wide` lets
      // it take the full width of the column instead; see 21-crossword.css.
      grid.classList.toggle('cw--wide', n >= 15);
      // A barred grid is drawn as one solid block of squares with thick lines
      // between entries, so it loses the gaps and the rounded corners that make
      // a black-square grid readable. Marking it on the container keeps that
      // decision in the stylesheet rather than spread across the cells.
      grid.classList.toggle('cw--barred', !!p.bars);
      for(let r=0;r<n;r++) for(let c=0;c<n;c++){
        const i = r*n + c;
        const d = document.createElement('div');
        if(p.rows[r][c] === '#'){
          d.className = 'cw-block';
        }else{
          d.className = 'cw-cell';
          if(p.bars){
            if(c > 0 && p.bars.v[r][c] === '1') d.classList.add('bar-l');
            if(r > 0 && p.bars.h[r][c] === '1') d.classList.add('bar-t');
          }
          d.innerHTML = (nums[i] ? '<span class="cw-num">'+nums[i]+'</span>' : '')
                      + '<span class="cw-let"></span>';
          d.onclick = ()=>this.select(i);
        }
        grid.appendChild(d);
      }

      const sizeBar = $('cw-size');
      sizeBar.innerHTML = '';
      [[5,'5×5'],[7,'7×7'],[9,'9×9'],[15,'15×15']].forEach(([k,label])=>{
        const b = document.createElement('button');
        b.className = 'mini-btn'; b.dataset.s = k; b.textContent = label;
        b.disabled = !this._at(k).length;
        b.onclick = ()=>this.setSize(k);
        sizeBar.appendChild(b);
      });

      const kbd = $('cw-kbd');
      kbd.innerHTML = '';
      ['QWERTYUIOP','ASDFGHJKL','ZXCVBNM'].forEach((row,ri)=>{
        const r = document.createElement('div');
        r.className = 'krow';
        row.split('').forEach(ch=>{
          const b = document.createElement('button');
          b.className = 'key'; b.textContent = ch;
          b.onclick = ()=>this.type(ch);
          r.appendChild(b);
        });
        if(ri===2){
          const b = document.createElement('button');
          b.className = 'key wide'; b.textContent = '⌫';
          b.onclick = ()=>this.back();
          r.appendChild(b);
        }
        kbd.appendChild(r);
      });

      this.built = true;
    },

    /* ---- entries ---- */
    _cellsOf(e){ const n = this.puz.n; return e.cells.map(rc=>rc[0]*n + rc[1]); },
    entryAt(i, dir){
      if(!this.puz) return null;
      const want = dir === 'across' ? 'A' : 'D';
      return this.puz.entries.find(e=>e.dir === want && this._cellsOf(e).indexOf(i) !== -1) || null;
    },
    current(){
      if(this.sel < 0) return null;
      return this.entryAt(this.sel, this.dir) || this.entryAt(this.sel, this._other());
    },
    _other(){ return this.dir === 'across' ? 'down' : 'across'; },
    _full(e){ return !!e && this._cellsOf(e).every(c=>this.user[c]); },

    toggleDir(){
      const other = this._other();
      if(this.sel >= 0 && !this.entryAt(this.sel, other)) return;
      this.dir = other;
      this.render();
    },

    select(i){
      if(this.done) return;
      if(this.sel === i){
        const other = this._other();
        if(this.entryAt(i, other)) this.dir = other;
      }else{
        this.sel = i;
        const here = this.entryAt(i, this.dir);
        const other = this.entryAt(i, this._other());
        // No word this way — the choice makes itself. And never land typing on a
        // finished word when the crossing one still needs letters.
        if(!here) this.dir = this._other();
        else if(other && this._full(here) && !this._full(other)) this.dir = this._other();
      }
      this.render();
    },

    type(ch){
      if(this.done || this.sel < 0) return;
      if(this.given[this.sel]){ this._step(1); this.render(); return; }   // a hint isn't yours to change
      this.user[this.sel] = ch.toUpperCase();
      this.wrong = null;
      this._step(1);
      this.persist(); this.render(); this.checkDone();
    },
    _step(by){
      const e = this.current();
      if(!e) return;
      const cells = this._cellsOf(e);
      const at = cells.indexOf(this.sel);
      if(at !== -1 && at + by >= 0 && at + by < cells.length) this.sel = cells[at + by];
    },
    back(){
      if(this.done || this.sel < 0) return;
      this.wrong = null;
      if(this.user[this.sel] && !this.given[this.sel]) this.user[this.sel] = '';
      else{
        const e = this.current();
        if(e){
          const cells = this._cellsOf(e);
          const at = cells.indexOf(this.sel);
          if(at > 0){
            this.sel = cells[at-1];
            if(!this.given[this.sel]) this.user[this.sel] = '';
          }
        }
      }
      this.persist(); this.render();
    },
    nextClue(step){
      const es = this.puz.entries;
      const cur = this.current();
      let k = cur ? es.indexOf(cur) : -1;
      k = (k + (step||1) + es.length) % es.length;
      const e = es[k];
      this.sel = this._cellsOf(e)[0];
      this.dir = e.dir === 'A' ? 'across' : 'down';
      this.render();
    },

    /* ---- hints ---- */
    _solAt(i){
      if(!this.puz) return '';
      const n = this.puz.n;
      const ch = this.puz.rows[(i/n)|0][i%n];
      return ch === '#' ? '' : ch.toUpperCase();
    },
    _hintCount(){ return this.given.filter(Boolean).length; },

    /** Reveal one letter: the square you're on, or the next empty one in its word. */
    hint(){
      if(this.done || !this.puz) return;
      let i = (this.sel >= 0 && this._solAt(this.sel) && !this.user[this.sel]) ? this.sel : -1;
      if(i < 0){
        const e = this.current();
        const cells = e ? this._cellsOf(e) : [];
        for(const c of cells) if(!this.user[c]){ i = c; break; }
      }
      if(i < 0){
        for(let k=0;k<this.user.length;k++){
          if(this._solAt(k) && !this.user[k]){ i = k; break; }
        }
      }
      if(i < 0){ toast('Nothing left to reveal'); return; }
      this.user[i] = this._solAt(i);
      this.given[i] = true;
      this.sel = i;
      this.wrong = null;
      buzz(12);
      this.persist(); this.render(); this.checkDone();
    },

    check(){
      if(this.done) return;
      const bad = [];
      let blank = 0;
      for(let i=0;i<this.user.length;i++){
        const sol = this._solAt(i);
        if(!sol) continue;
        if(!this.user[i]) blank++;
        else if(this.user[i] !== sol) bad.push(i);
      }
      this.wrong = bad;
      this.render();
      if(bad.length) toast(bad.length+' wrong '+(bad.length===1?'letter':'letters'));
      else if(blank) toast('All good so far — '+blank+' left');
      else toast('All correct');
    },

    checkDone(){
      for(let i=0;i<this.user.length;i++){
        const sol = this._solAt(i);
        if(sol && this.user[i] !== sol) return;
      }
      this.done = true; this.stop(); this.persist();
      chime(false); buzz(120);
      showBanner('cw-banner', 'Filled in.', this._summary());
      this._renderList();
    },
    _summary(){
      const h = this._hintCount();
      return this.puz.entries.length + ' clues in ' + fmt(this.elapsed)
        + (h ? ' · ' + h + ' letter' + (h===1?'':'s') + ' revealed' : ' · no hints');
    },

    /* ---- the puzzle picker ---- */
    openPicker(){ this._renderList(); $('cw-picker').classList.remove('hide'); },
    _closePicker(){ const el = $('cw-picker'); if(el) el.classList.add('hide'); },

    _renderList(){
      const box = $('cw-list-body');
      if(!box) return;
      const list = this._at(this.size);
      box.innerHTML = list.map((i,k)=>{
        const rec = this._rec(i);
        const done = !!(rec && rec.done);
        const started = !done && rec && rec.u && /[A-Z]/.test(rec.u);
        const note = done ? 'finished' + (rec.secs ? ' in ' + fmt(rec.secs) : '')
                   : started ? 'in progress' : 'not started';
        const hints = rec && rec.g && rec.g.length ? rec.g.length + ' revealed' : '';
        return '<button class="cw-item'+(done?' done':'')+(i===this.idx?' on':'')+'" '
          + 'data-i="'+i+'" data-k="'+(k+1)+'"><b>#'+(k+1)+'</b><span>'+note+'</span>'
          + (hints ? '<em>'+hints+'</em>' : '') + '</button>';
      }).join('');

      box.querySelectorAll('[data-i]').forEach(b=>{
        const i = +b.dataset.i, k = b.dataset.k;
        b.onclick = ()=>{
          this._closePicker();
          this.load(i);
          if(!this.done) this.run();
        };
        // hold one to start it over, the same gesture as the arcade cards
        holdMenu(b, ()=>[{
          label:'Reset puzzle #'+k, danger:true,
          run(){ askConfirm('Start puzzle #'+k+' again?',
            'Its letters, and any you revealed, are cleared.',
            'Reset', ()=>Cross.resetPuzzle(i)); },
        }]);
      });
    },

    /* ---- drawing ---- */
    render(){
      if(!this.puz) return;
      const p = this.puz, n = p.n;
      const cur = this.current();
      const inCur = cur ? this._cellsOf(cur) : [];
      const cells = $('cw-grid').children;

      for(let i=0;i<n*n;i++){
        const el = cells[i];
        if(!el || !this._solAt(i)) continue;
        let cls = 'cw-cell';
        // Bars are part of the shape, not of the state, but this rewrites the
        // whole class list — so they have to be put back or the grid loses its
        // divisions the first time anything is typed.
        if(p.bars){
          const r = (i / n) | 0, c = i % n;
          if(c > 0 && p.bars.v[r][c] === '1') cls += ' bar-l';
          if(r > 0 && p.bars.h[r][c] === '1') cls += ' bar-t';
        }
        if(i === this.sel) cls += ' sel';
        else if(inCur.indexOf(i) !== -1) cls += ' peer';
        if(this.wrong && this.wrong.indexOf(i) !== -1) cls += ' wrong';
        if(this.given[i]) cls += ' given';
        el.className = cls;
        const let_ = el.querySelector('.cw-let');
        if(let_) let_.textContent = this.user[i] || '';
      }

      // The letter count comes from the entry itself, so it can never drift out
      // of step with the answer.
      $('cw-clue').textContent = cur
        ? (cur.num + ' ' + (cur.dir === 'A' ? 'across' : 'down') + ' · '
           + crossClue(cur.answer, this.idx) + ' (' + cur.answer.length + ')')
        : 'Pick a square to start';

      const list = $('cw-clues');
      const side = (tag, label)=>{
        const items = p.entries.filter(e=>e.dir === tag).sort((a,b)=>a.num-b.num).map(e=>{
          const filled = this._cellsOf(e).every(i=>this.user[i]);
          const on = cur && cur.num === e.num && cur.dir === e.dir;
          return '<button class="cw-clue-item'+(on?' on':'')+(filled?' filled':'')+'" '
            + 'data-num="'+e.num+'" data-dir="'+e.dir+'">'
            + '<b>'+e.num+'</b><span>'+esc(crossClue(e.answer, this.idx))
            + ' <i>('+e.answer.length+')</i></span></button>';
        }).join('');
        return '<div class="cw-clue-col"><p class="q-sec">'+label+'</p>'+items+'</div>';
      };
      list.innerHTML = side('A','Across') + side('D','Down');
      list.querySelectorAll('.cw-clue-item').forEach(b=>{
        b.onclick = ()=>{
          const e = p.entries.find(x=>x.num === +b.dataset.num && x.dir === b.dataset.dir);
          if(e){
            this.sel = this._cellsOf(e)[0];
            this.dir = e.dir === 'A' ? 'across' : 'down';
            this.render();
          }
        };
      });

      // Direction is shown, not inferred. Every square belongs to two words, so
      // which way typing goes has to be visible or it feels random.
      const dirBtn = $('cw-dir');
      if(dirBtn){
        dirBtn.textContent = this.dir === 'across' ? 'Across →' : 'Down ↓';
        dirBtn.disabled = this.sel >= 0 && !this.entryAt(this.sel, this._other());
      }

      const h = this._hintCount();
      const hEl = $('cw-hints');
      if(hEl) hEl.textContent = h ? h + ' revealed' : '';
      const hBtn = $('cw-hint');
      if(hBtn) hBtn.disabled = this.done;

      $('cw-meta').textContent = this._label();
      document.querySelectorAll('#cw-size .mini-btn')
        .forEach(b=>b.classList.toggle('on', +b.dataset.s === this.size));
    },

    _label(){
      const list = this._at(this.size);
      const k = list.indexOf(this.idx);
      return this.size + '×' + this.size + ' · #' + (k >= 0 ? k+1 : 1)
        + ' of ' + list.length + ' · ' + fmt(this.elapsed);
    },

    run(){
      this.stop();
      this.tick = setInterval(()=>{
        this.elapsed++;
        $('cw-meta').textContent = this._label();
        if(this.elapsed % 10 === 0) this.persist();
      }, 1000);
    },
    stop(){ clearInterval(this.tick); this.tick = null; },

    persist(){
      if(this.idx >= 0 && this.puz){
        const u = [];
        for(let i=0;i<this.user.length;i++) u.push(this.user[i] || '.');
        const g = [];
        for(let i=0;i<this.given.length;i++) if(this.given[i]) g.push(i);
        const rec = {u:u.join(''), secs:this.elapsed};
        if(g.length) rec.g = g;
        if(this.done) rec.done = true;
        this.progress[this._fp(this.idx)] = rec;
      }
      try{
        KV.set(this.key, JSON.stringify({
          size:this.size, idx:this.idx, key:this._fp(this.idx), p:this.progress,
        }));
      }catch(e){}
    },
  };

  document.addEventListener('keydown', e=>{
    if(!Arcade.open || Arcade.active!=='crossword') return;
    if(e.key === 'Backspace'){ e.preventDefault(); Cross.back(); }
    else if(e.key === ' '){ e.preventDefault(); Cross.toggleDir(); }
    else if(e.key === 'Tab'){ e.preventDefault(); Cross.nextClue(e.shiftKey ? -1 : 1); }
    else if(e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown'){
      e.preventDefault();
      const want = (e.key==='ArrowRight'||e.key==='ArrowLeft') ? 'across' : 'down';
      if(Cross.dir !== want && Cross.entryAt(Cross.sel, want)){ Cross.dir = want; }
      else Cross._step((e.key==='ArrowRight'||e.key==='ArrowDown') ? 1 : -1);
      Cross.render();
    }
    else if(/^[a-zA-Z]$/.test(e.key)) Cross.type(e.key);
  });

  registerGame('crossword', {
    el:'game-crossword', title:'Crossword', progEl:'prog-crossword', game:()=>Cross,
    reset(){ Cross.resetAll(); },
    resetNote:'Every puzzle goes back to blank, including the ones you finished.',
    async progress(){
      const d = await readGame(Cross.key);
      const p = (d && d.p) || {};
      const size = (d && [5,7,9,15].indexOf(d.size) >= 0) ? d.size : 7;
      const list = crossAtSize(size);
      const done = list.filter(i=>p[i] && p[i].done).length;
      if(!done && !Object.keys(p).length) return 'New<span>tap to start</span>';
      return done + '/' + list.length + '<span>' + size + '×' + size + ' done</span>';
    }
  });

