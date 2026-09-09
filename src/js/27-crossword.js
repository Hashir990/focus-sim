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
    /* Which release day the open puzzle belongs to. The bank index is where it
       lives; this is what it is *called*. See the schedule in 09b-daily.js. */
    day:'',
    /* Whether an older edition was opened by hand this run; see enter(). */
    _chose:false,
    /* Where you were at each size, by fingerprint and day. Switching size and
       switching back has to put the same grid in front of you, letters, clock
       and all — see `_where`. */
    seen:{},

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
          this.seen = (d.seen && typeof d.seen === 'object') ? d.seen : {};
          this.idx = -1;
          if(d.key) this.idx = this._find(d.key);
          if(this.idx < 0 && typeof d.idx === 'number' && !d.key) this.idx = d.idx;
        }
        this.loaded = true;
      }
      let pick = null;
      if(this.idx < 0 || !CROSS_GRIDS[this.idx]){
        pick = this._where(this.size);
        this.idx = pick.i;
      }
      this.load(this.idx, pick ? pick.day : '');
      /* **The shelf opens on today.** This used to wait for the puzzle you were
         on to be *finished*, so one abandoned in April was still the one waiting
         in September and the archive had quietly become the front door. Every
         grid's letters live in `progress` under its own fingerprint, so moving
         on loses nothing and History puts it straight back.

         The exception is a day you chose yourself: `_chose` is set by History
         and by the calendar and lives only as long as the app is open, so a
         break and back returns you to the same grid and tomorrow returns you
         to tomorrow's. */
      if(!this._chose && crossReleases(this.size, pktNow())
         && !dailyPlayed('crossword', String(this.size))){
        const t = crossOnDay(this.size, pktNow());
        if(t.i >= 0 && t.i !== this.idx) this.load(t.i, pktNow());
      }
      if(!this.done) this.run();
    },
    leave(){ this.stop(); this.persist(); this._closePicker(); },

    /* ---- which puzzle ---- */
    _at(size){ return crossAtSize(size); },

    /* ---- dates ----
       A puzzle's *name* is the day it came out. The bank index is only where
       it happens to be stored, and it is the position in the size's own list
       that decides the date — which is why the bank has to stay append-only.
       See the schedule and `crossOnDay` in 09b-daily.js. */
    _dayOf(i){
      const g = CROSS_GRIDS[i];
      if(!g) return '';
      const size = crossRows(g).length;
      const pos = this._at(size).indexOf(i);
      return pos < 0 ? '' : crossReleaseDay(size, pos);
    },
    /** The most recent day at this size that has come out, up to today. */
    _latestDay(size){
      const days = crossDaysUpTo(size, pktNow(), 1);
      return days.length ? days[0] : '';
    },

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
        /* **A record that says "finished" has to *be* finished.** Two thirds of
           the letters agreeing is the right test for "this is probably the same
           puzzle, keep the work"; it is far too weak for a flag that locks the
           board. A `done` record carried onto a grid it did not come from opens
           full of letters, under the win banner, refusing every key — which is
           not read as a stale save, it is read as the game being broken. So the
           flag survives only on an exact match with the solution, and otherwise
           the record comes through as work in progress. */
        if(rec.done){
          let exact = true;
          for(let i=0;i<sol.length;i++){
            if(sol[i] === '#') continue;
            if(rec.u[i] !== sol[i]){ exact = false; break; }
          }
          if(!exact){ const c = {}; for(const f in rec) c[f] = rec[f]; delete c.done; out[crossKey(g)] = c; continue; }
        }
        out[crossKey(g)] = rec;
      }
      return out;
    },
    /** Does this string of letters actually solve the grid on screen? Blanks
        count as wrong, which is the point: a record that says it is finished and
        has a hole in it is not finished. */
    _solvedBy(u){
      if(!this.puz || typeof u !== 'string') return false;
      const n = this.puz.n;
      for(let i = 0; i < n * n; i++){
        const sol = this._solAt(i);
        if(!sol) continue;                       // a black square
        if((u[i] || '').toUpperCase() !== String(sol).toUpperCase()) return false;
      }
      return true;
    },
    _isDone(i){ const r = this._rec(i); return !!(r && r.done); },

    /** The one to open by default.

        Today's edition if it has come out and you have not finished it; failing
        that the most recent released day you have not finished, walking
        backwards; failing that today's again, so there is always a grid. */
    /* **Returns the day as well as the index, and that matters.**
       It used to hand back a bank index alone, and `load()` then worked the day
       out again from the index's position — which is right until the schedule
       runs past the end of the bank and a day gets an *encore* of an earlier
       puzzle. Then the index says Aug 17 and the day you actually opened is Aug
       28, so the calendar filed your progress under a day you were not looking
       at. The day the puzzle was *chosen for* is the day it belongs to. */
    _firstUnfinished(size){
      const days = crossDaysUpTo(size, pktNow());
      for(const d of days){
        const t = crossOnDay(size, d);
        if(t.i >= 0 && !this._isDone(t.i)) return {i: t.i, day: d};
      }
      const d0 = days[0] || pktNow();
      const t = crossOnDay(size, d0);
      if(t.i >= 0) return {i: t.i, day: d0};
      const list = this._at(size);
      return {i: list.length ? list[0] : 0, day: d0};
    },

    /** **Returns whether it actually loaded.** It used to return quietly when
        the index was not in the bank, which meant a size button could do
        nothing at all: the puzzle you were on stayed on screen, the button
        looked pressed, and nothing said why. A save pointing at a puzzle the
        bank no longer has is ordinary — the bank grows and records are keyed by
        fingerprint — so the caller has to be able to try somewhere else. */
    load(i, day){
      const g = CROSS_GRIDS[i];
      if(!g) return false;
      this.stop();
      this.idx = i;
      this.day = day || this._dayOf(i);
      this.puz = crossParse(g);
      this.size = this.puz.n;
      const n = this.puz.n, cells = n*n;

      // A record whose length is not this grid's is not this grid's record, so
      // the whole thing is dropped — letters, clock and finished flag together.
      // Trimming it to fit is what turned one stale index into a 9x9's letters
      // showing up inside a 7x7, under a banner saying it had been solved.
      let rec = this._rec(i);
      if(rec && (typeof rec.u !== 'string' || rec.u.length !== cells)) rec = null;
      /* **"Finished" is checked here, every time, not once at migration.**

         `_migrate` verifies the flag against the solution — but only for records
         written under the old index-keyed scheme. A record that passed through
         it once is fingerprint-keyed afterwards and was never looked at again,
         so a wrong `done` became permanent: the grid opened full of letters
         nobody had typed, the board refused every key because `type()` stops
         when `done`, and `_firstUnfinished` skipped that day forever — which is
         a size that will not open. One bad flag, three symptoms, none of them
         looking like the same bug.

         So it is re-derived from the letters on every load. A grid whose squares
         are all correct is finished whatever the record says; one that is not,
         is not. The letters are kept either way — being wrong about the flag is
         no reason to throw away somebody's work. */
      if(rec && rec.done && !this._solvedBy(rec.u)) rec = Object.assign({}, rec, {done:false});
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

      if(!this.seen) this.seen = {};
      this.seen[this.size] = {k:this._fp(i), day:this.day};
      this.built = false;                 // the shape changed; rebuild the grid
      this.build();
      this.render();
      $('cw-banner').classList.toggle('hide', !this.done);
      if(this.done) $('cw-win-sub').textContent = this._summary();
      this.persist();
      /* On the calendar as soon as it is on screen — an opened puzzle is one
         you have met, and a day that only goes amber once you type a letter
         reads as a day you never visited. `dailyMark` only ever moves the
         state forward, so re-opening a finished one cannot un-finish it. */
      if(this.day) dailyMark('crossword', String(this.size),
        this.day, this.done ? DAILY_DONE : DAILY_STARTED);
      return true;
    },

    /* **Nothing here can be started over any more.**
       Every puzzle is published on a day and its result is kept — the time,
       the clues, the letters you revealed. A button that wipes all of that
       makes the record worth nothing, and the archive is what "play something
       else" means now. `resetPuzzle`, `resetAll` and the hold-to-reset gesture
       are gone with it. */

    /** The next one still open at this size, oldest first — what the finished
        banner offers. Falls back to the calendar when there is nothing left. */
    nextPuzzle(){
      const days = crossDaysUpTo(this.size, pktNow());
      for(let k = days.length - 1; k >= 0; k--){
        const t = crossOnDay(this.size, days[k]);
        if(t.i >= 0 && !this._isDone(t.i) && !(t.i === this.idx && days[k] === this.day)){
          this._chose = (days[k] !== pktNow());
          this.load(t.i, days[k]);
          this.run();
          return;
        }
      }
      try{ dailyCalOpen('crossword'); }catch(e){}
    },

    /** **The grid to put in front of you at a size.**

        Where you were, first — switching size and switching back has to hand
        the same puzzle back with its letters and its clock, and it did not:
        `setSize` went to `_firstUnfinished`, which is "the newest one you have
        not finished", which is a different puzzle the moment you finish one.
        Half a 7x7, a look at the 15x15 and back, and the half was gone. It was
        never deleted — it was still filed under its own fingerprint — but you
        could not get back to it, which from a chair is the same thing.

        Then today's edition, even if it is done: finishing today's should not
        drop you into the archive. Only then the newest unfinished. */
    _where(size){
      const s = this.seen && this.seen[size];
      if(s && s.k){
        const i = this._find(s.k);
        if(i >= 0 && crossRows(CROSS_GRIDS[i]).length === size){
          return {i, day: s.day || this._dayOf(i)};
        }
      }
      const t = crossOnDay(size, pktNow());
      if(t.i >= 0) return {i:t.i, day:pktNow()};
      return this._firstUnfinished(size);
    },

    /** **Start this one again.**

        Every other way out of a bad record is a guess about how it went bad.
        This is the one that does not need to be right about that: the puzzle is
        published on a day and can always be rebuilt from the bank, so throwing
        the record away costs the letters and nothing else. It asks first, and it
        only ever touches the puzzle on screen — the archive is untouched.

        The old `resetPuzzle` was removed on purpose, and rightly: a button that
        wipes your record makes the record worth nothing. This is not that. It is
        a repair, offered where repairs belong, and named for what it does. */
    restart(){
      if(this.idx < 0 || !this.puz) return;
      try{ delete this.progress[this._fp(this.idx)]; }catch(e){}
      const i = this.idx, day = this.day;
      this.load(i, day);
      if(!this.done) this.run();
    },

    /** **When something in here throws, say so and offer the way out.**

        A crossword that fails silently is a dead screen: the buttons are there,
        the grid is the last one that worked, and nothing says why. That is what
        "it crashes" means from a chair, and it is unanswerable from here without
        knowing what threw. So every way in goes through this: the error is kept
        where it can be read, the person is told in one line, and they are
        offered the one repair that always works — the puzzle is published on a
        day and can always be rebuilt, so throwing its record away costs the
        letters and nothing else. */
    lastError:'',
    _guard(what, fn){
      try{ return fn(); }
      catch(e){
        this.lastError = what + ': ' + ((e && e.message) || e);
        try{ console.error('[crossword] ' + this.lastError, e); }catch(_){}
        try{
          askConfirm('This crossword would not open',
            this.lastError + '\u2014 starting it again rebuilds the grid from '
            + 'its day. The letters in it go; nothing else does.',
            'Start it again', ()=>{ try{ this.restart(); }catch(_){} });
        }catch(_){}
        return null;
      }
    },

    setSize(size){
      if(this.size === size) return;
      this.persist();
      const pick = this._where(size);
      /* Going back to an older grid is a choice, and `enter()` must not undo it
         by moving you to today the next time you come in from the shelf. */
      this._chose = pick.day !== pktNow();
      /* Every way of choosing one, in order, until one of them is really in the
         bank. Falling through to the size's first puzzle is a poor answer and a
         far better one than a button that does nothing. */
      if(!this.load(pick.i, pick.day)){
        const t = crossOnDay(size, pktNow());
        const list = this._at(size);
        if(!(t.i >= 0 && this.load(t.i, pktNow()))
           && !(list.length && this.load(list[0], ''))){
          toast('No ' + size + '\u00d7' + size + ' to open');
          return;
        }
      }
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
  b.onclick = ()=>this._guard('switching to ' + k + '\u00d7' + k,
          ()=>this.setSize(k));
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
    /** The clue before or after this one. Wired to the arrows either side of
        the clue line and to Tab; the two have to be the same journey or the
        keyboard and the buttons disagree about where you are. */
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
      if(this.day) dailyMark('crossword', String(this.size), this.day, DAILY_DONE,
        {t:this.elapsed, c:this.puz.entries.length, n:this.puz.entries.length, h:this._hintCount()});
      chime(false); buzz(120);
      showBanner('cw-banner', 'Filled in.', this._summary());
    },
    _summary(){
      const h = this._hintCount();
      return this.puz.entries.length + ' clues in ' + fmt(this.elapsed)
        + (h ? ' · ' + h + ' letter' + (h===1?'':'s') + ' revealed' : ' · no hints');
    },

    /** How many of a puzzle's clues are completely filled in, for the picker.

        A clue counts when every one of its squares matches the answer — the
        same standard the finished banner holds a whole puzzle to. Saved letters
        are uppercase and the bank is lowercase, so the comparison is done in
        one case; forgetting that in `_migrate` once threw away every record it
        was supposed to be rescuing. */
    /** How many clues are right *on the board in front of you*.

        `_clues` below answers the same question for any puzzle in the bank, and
        to do it it re-parses the grid and re-reads the saved record — fine once
        for a list, and far too much on every keystroke, which is where the
        calendar's record is written from. This one reads `this.puz` and
        `this.user`, both already in hand. */
    _cluesNow(){
      const p = this.puz;
      if(!p) return {done:0, total:0};
      const n = p.n;
      let done = 0;
      for(const e of p.entries){
        let ok = true;
        for(let k=0;k<e.cells.length;k++){
          const [r,c] = e.cells[k];
          if((this.user[r*n+c] || '') !== e.answer[k].toUpperCase()){ ok = false; break; }
        }
        if(ok) done++;
      }
      return {done, total:p.entries.length};
    },
    _clues(i, rec){
      const g = CROSS_GRIDS[i];
      if(!g) return { done:0, total:0 };
      const puz = crossParse(g), n = puz.n;
      const u = (rec && typeof rec.u === 'string' && rec.u.length === n*n) ? rec.u : '';
      let done = 0;
      if(u) for(const e of puz.entries){
        let ok = true;
        for(let k=0;k<e.cells.length;k++){
          const [r,c] = e.cells[k];
          if(u[r*n+c] !== e.answer[k].toUpperCase()){ ok = false; break; }
        }
        if(ok) done++;
      }
      return { done, total: puz.entries.length };
    },

    /* **The picker is the calendar now.** There were two lists of the same
       puzzles — a panel inside the game and a month grid outside it — and the
       month grid is the one that knows about the other three sizes, what you
       scored and which days are still open. `openPicker` is kept as the name
       everything already calls. */
    openPicker(){ try{ dailyCalOpen('crossword'); }catch(e){} },
    _closePicker(){},

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
      dailyStreakPaint('cw-streak', 'crossword');
      document.querySelectorAll('#cw-size .mini-btn')
        .forEach(b=>b.classList.toggle('on', +b.dataset.s === this.size));
    },

    /* **A puzzle is a date, not a number out of a total.** "#11 of 11" was
       true of the bank and told you nothing about the puzzle — and now that
       every one of them is published on a day, the day is its name. The
       position is still what decides that date; it is just not something to
       read on screen. See `_dayOf` and the schedule in 09b-daily.js. */
    _label(){
      const when = this.day === pktNow() ? 'Today' : (this.day ? pktLabel(this.day) : '');
      return this.size + '×' + this.size + (when ? ' · ' + when : '') + ' · ' + fmt(this.elapsed);
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
      writeGame(this.key, {
        size:this.size, idx:this.idx, key:this._fp(this.idx), p:this.progress,
        seen:this.seen,
      });
      /* **The calendar's record goes down with the board.** It used to be
         written on the clock's ten-second beat, which meant a puzzle put down
         between beats lost its last few clues off the calendar. `dailyMark`
         does nothing when nothing has changed, so calling it on every letter
         is cheap. */
      if(this.day && !this.done && this.puz){
        const c = this._cluesNow();
        dailyMark('crossword', String(this.size), this.day, DAILY_STARTED,
          {t:this.elapsed, c:c.done, n:c.total, h:this._hintCount()});
      }
    },

    /* An account brought different progress. The letters on screen belong to
       the copy that has just been replaced, so the whole game is reloaded from
       storage rather than repainted - and `loaded` going false is what makes
       the next `enter()` do it. */
    /** **An account arriving replaces the save; it must not leave a hole.**

        This emptied `progress` and set `loaded` false, on the understanding
        that the next `enter()` would read the new save in. But `enter()` is not
        the only thing that reads: a size button goes straight to `load()`, and
        `load()` takes the puzzle's letters and its clock out of `progress` —
        which was now `{}`. So the grid came back blank with the clock at zero,
        and the account had not lost anything at all; this object had.

        Rare while a sync only happened on a daily mark. Then sync started
        running every five minutes and on every hide, and it became: play for a
        minute, switch size, switch back, and the clock is at zero. Exactly what
        was reported, and it got worse the day the syncing got better.

        `gamesAdopt` writes `GAME_SAVES[key]` *before* calling this, so the new
        save is already here and can be taken synchronously. Nothing is ever
        emptied and waited on. */
    forget(){
      let d = null;
      try{ d = gameSaved(this.key); }catch(e){}
      this.progress = this._migrate((d && d.p) || {});
      this.seen = (d && d.seen && typeof d.seen === 'object') ? d.seen : {};
      this.size = (d && [5,7,9,15].indexOf(d.size) >= 0) ? d.size : this.size;
      /* `loaded` stays true: this *is* the load. Leaving it false would have the
         next `enter()` read storage again and undo the adopt. */
      this.loaded = true;
      this.puz = null;
      this.built = false;
      /* Where we were, in the new save's terms. A fingerprint that is not in
         the bank any more falls through to `_where`, the way a cold start does. */
      let at = -1;
      if(d && d.key) at = this._find(d.key);
      this.idx = at;
    },
  };

  forgetGame(Cross.key, ()=>Cross.forget());

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

  /* **Four editions, on four different schedules.** The other games make a
     puzzle out of a number and can have one every day for ever; these are
     hand-written and come out of a bank, so the sizes are published on the
     rhythm a newspaper uses — see CROSS_WHEN in 09b-daily.js. */
  registerDaily('crossword', {
    title:'Crossword',
    diffs:CROSS_SIZES.map(n=>({k:String(n), n:n + '×' + n})),
    /* Not every size comes out every day, and a day with nothing published is
       not a missed day. Anything asking this game for a streak reads this. */
    on:(day, k)=>crossReleases(+k, day),
    /* Not every size comes out every day, so the calendar asks before it draws
       a dot — an empty Tuesday under "9×9" is the schedule, not a gap. */
    on(day, diff){ return crossReleases(+diff, day); },
    line(rec){
      if(!rec) return '';
      const h = rec.h ? ' · ' + rec.h + ' revealed' : '';
      if(rec.s !== 2) return (rec.c != null && rec.n ? rec.c + ' of ' + rec.n + ' clues' : 'Started') + h;
      return (rec.n ? rec.n + ' clues' : 'Filled in') + ' in ' + fmt(rec.t || 0) + h;
    },
    stats(all){
      const done = all.filter(r=>r.s === 2);
      const clues = done.reduce((n,r)=>n + (r.n || 0), 0);
      const noHint = done.filter(r=>!r.h).length;
      /* **A streak day is every crossword that came out that day.** Two on a
         Tuesday, three on a Wednesday, and the fifteen as well on a Sunday —
         `crossReleases` is what decides, so a day nothing is published on is
         skipped rather than counted as a miss. It used to be the best of four
         separate streaks, which meant a long run of 5×5s read as a long run
         of crosswords. */
      const run = dailyStreak('crossword', CROSS_SIZES.map(String),
        (day, k)=>crossReleases(+k, day));
      return [
        {v:String(run), n:'day streak'},
        {v:String(done.length), n:'filled in'},
        {v:String(clues), n:'clues'},
      ];
    },
    open(day, diff){
      const size = +diff || 7;
      const t = crossOnDay(size, day);
      if(t.i < 0){ toast('No ' + size + '×' + size + ' on ' + pktLabel(day)); return; }
      Cross.size = size;
      Cross._chose = true;              // picked by hand; see enter()
      Cross.load(t.i, day);
      if(!Cross.done) Cross.run();
    },
  });

  registerGame('crossword', {
    el:'game-crossword', title:'Crossword', progEl:'prog-crossword', game:()=>Cross,

    async progress(){
      const d = await readGame(Cross.key);
      const p = (d && d.p) || {};
      const size = (d && [5,7,9,15].indexOf(d.size) >= 0) ? d.size : 7;
      const list = crossAtSize(size);
      const done = list.filter(i=>p[crossKey(CROSS_GRIDS[i])] && p[crossKey(CROSS_GRIDS[i])].done).length;
      if(!done && !Object.keys(p).length) return 'New<span>tap to start</span>';
      return done + '/' + list.length + '<span>' + size + '×' + size + ' done</span>';
    }
  });

