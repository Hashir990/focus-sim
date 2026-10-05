  /* ---------------- PICROSS ----------------

     A picture hidden behind its own row and column counts. The numbers say how
     many squares in a row are filled and in what order; the grid that satisfies
     all of them is the picture, and there is exactly one.

     **The clues are worked out from the picture, here, every time.** The bank
     (27a-picross-data.js) holds nothing but the squares. Storing the clues as
     well would be storing the same fact twice, and the copy that drifted would
     be the one nobody checked.

     **Every puzzle is solvable by reasoning alone.** That is not a hope; it is
     a condition of entering the bank. tools/make-picross.mjs solves each design
     the way a person does — one line at a time, filling only what every possible
     arrangement agrees on — and rejects any that stalls. A nonogram you can only
     finish by guessing is one where a wrong guess is discovered twenty squares
     later, which is the worst experience this kind of puzzle has to offer.

     **Three sizes, one a day each**, counted from the shared epoch like the
     crossword: 5x5, 10x10, 15x15. Thirty of each, and when the bank runs out
     the count wraps and says so, rather than leaving a day empty. */

  const PIC_KEY = 'arcade_picross';
  /* **Its own epoch: the day it shipped.** Sharing the crossword's would mean
     starting a month into a thirty-puzzle bank, with every one of the first
     month's labelled 'again' before anybody had seen one. There were no picross
     puzzles before this date, and the calendar says so by showing nothing. */
  const PIC_EPOCH = '2026-09-19';
  const PIC_DIFFS = ['easy', 'medium', 'hard'];
  /* **The sizes have climbed twice, for the same reason both times.** A 5×5 has
     so few arrangements that the clues give it away at a glance; a 10×10 has to
     throw away most of a drawing to fit, so the picture arrives as a lump. The
     three sizes now start where a nonogram starts being one and end where the
     good ones live — a 30×30 holds a drawing with detail *inside* it, which is
     the whole difference between a shape and a picture.

     Thirty squares is also the widest a phone can take: see the n30 rules in
     41-picross.css, where the clue numbers shrink so the grid still fits the
     screen rather than scrolling off it. */
  const PIC_SIZE = {easy:15, medium:20, hard:30};
  const PIC_NAME = {easy:'Small', medium:'Middling', hard:'Big'};

  /** The puzzle for a day at a size: which one, and whether the bank has wrapped. */
  function picOnDay(diff, day){
    const size = PIC_SIZE[diff];
    const list = (PIC_BANK && PIC_BANK[size]) || [];
    const n = pktNum(day || pktNow()) - pktNum(PIC_EPOCH);
    if(!list.length || n < 0) return {i:-1, no:-1, encore:false};
    return {i:n % list.length, no:n, encore:n >= list.length};
  }

  /** What a picture is, for the moment after it is finished and never before.
      The bank keeps the source's own lower-case file names; the first letter is
      raised here so it reads as a name on a banner or a calendar row. */
  function picTitle(diff, i){
    const list = (typeof PIC_TITLES !== 'undefined' && PIC_TITLES[PIC_SIZE[diff]]) || [];
    const t = (i >= 0 && list[i]) || '';
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  }

  /** The picture as rows of 0/1. */
  function picGrid(diff, i){
    const size = PIC_SIZE[diff];
    const flat = ((PIC_BANK && PIC_BANK[size]) || [])[i] || '';
    const out = [];
    for(let y = 0; y < size; y++){
      const row = [];
      for(let x = 0; x < size; x++) row.push(flat.charCodeAt(y * size + x) === 49 ? 1 : 0);
      out.push(row);
    }
    return out;
  }

  /** The runs in one line, or [0] for a line with nothing in it. */
  function picClue(line){
    const out = [];
    let run = 0;
    for(const v of line){
      if(v) run++;
      else if(run){ out.push(run); run = 0; }
    }
    if(run) out.push(run);
    return out.length ? out : [0];
  }
  function picClues(grid){
    const n = grid.length;
    const cols = [];
    for(let x = 0; x < n; x++) cols.push(picClue(grid.map(r=>r[x])));
    return {rows:grid.map(picClue), cols};
  }

  /* Cells: 0 nothing, 1 filled, 2 crossed off. Crossing off is a note to
     yourself and is never checked — a picture is finished when the filled
     squares are the right ones, whatever else is pencilled around them. */
  const PIC_EMPTY = 0, PIC_FILL = 1, PIC_MARK = 2;

  /* Fit, then half as big again, then twice, then three times. Thirty across on
     a phone is about ten pixels a square at Fit, which is under a thumb and
     under what an eye can count a run of; three times over is comfortably past
     both. More steps than this and the button becomes a thing you press four
     times to get anywhere. */
  const PIC_ZOOMS = [1, 1.5, 2, 3];

  const Picross = {
    key:PIC_KEY,
    diff:'easy',
    day:'',
    idx:-1,
    encore:false,
    size:5,
    sol:[],            // rows of 0/1
    cells:[],          // flat, one per square
    rows:[], cols:[],  // the clues
    secs:0,
    done:false,
    mode:PIC_FILL,     // what a tap puts down
    boards:{},         // day|diff -> a board put down and come back to
    tick:null,
    _chose:false,      // a day opened from the calendar, for this run of the app
    _drag:0,           // what a drag across the grid is painting, 0 when not dragging
    _over:0,           // the only state a drag may paint over; see _wire
    _aimAt:-1,         // the square the row-and-column guide is drawn through
    /* **How far in, as a multiple of whatever fits.** 1 is the old behaviour
       exactly: the puzzle sized to the box it is given. Kept in memory rather
       than saved, because it is a thing about this screen on this phone right
       now and not a thing about the board -- and because the board travels
       between devices, where a zoom that suited a phone would be nonsense on a
       laptop. */
    _zoom:1,
    _pick:false,       // armed: the next square touched is revealed, not painted
    built:false,
    /* Squares revealed rather than worked out. Kept with the board, so the
       count survives leaving the screen, and reported to the calendar — a
       finished puzzle is a different thing depending on how much was given. */
    hints:0,
    /* What the last Check found, held only until the next square is touched:
       a permanent red square would do the solving. */
    wrong:null,
    _wrongT:null,

    async enter(){
      if(!this.sol.length){
        const d = await readGame(this.key);
        if(d){
          this.boards = (d.boards && typeof d.boards === 'object') ? d.boards : {};
          this.diff = PIC_DIFFS.indexOf(d.diff) >= 0 ? d.diff : 'easy';
          this.day = d.day || pktNow();
        }
        this._load(this.diff, this.day || pktNow());
      }
      /* **The newest one, unless you chose otherwise.** Same rule as the other
         dailies: a finished board is not what anybody opens the app to look at,
         and `_chose` lives only as long as the app is open. */
      if(!this._chose && this.day !== pktNow()) this._load(this.diff, pktNow());
      this.build();
      this.render();
      if(!this.done) this.run();
    },
    leave(){ this.stop(); this.persist(); },

    /* ---- the board on the shelf ---- */
    _slot(day, diff){ return (day || pktNow()) + '|' + (diff || 'easy'); },
    _stash(){
      if(!this.sol.length || !this.day) return;
      this.boards[this._slot(this.day, this.diff)] = {
        cells:this.cells.join(''), secs:this.secs, done:this.done, hints:this.hints,
      };
    },
    /** Put a day's puzzle on screen, keeping whatever was on the last one. */
    _load(diff, day){
      this._stash();
      this.diff = PIC_DIFFS.indexOf(diff) >= 0 ? diff : 'easy';
      this.day = day || pktNow();
      this.size = PIC_SIZE[this.diff];
      const at = picOnDay(this.diff, this.day);
      this.idx = at.i;
      this.encore = at.encore;
      this.sol = this.idx < 0 ? [] : picGrid(this.diff, this.idx);
      const c = picClues(this.sol.length ? this.sol : [[0]]);
      this.rows = c.rows;
      this.cols = c.cols;
      const had = this.boards[this._slot(this.day, this.diff)];
      const want = this.size * this.size;
      /* A board whose length is not this puzzle's is not this puzzle's board.
         Trimming it to fit is how one stale save becomes a 10x10's squares
         showing up inside a 5x5. */
      if(had && typeof had.cells === 'string' && had.cells.length === want){
        this.cells = had.cells.split('').map(Number);
        this.secs = had.secs | 0;
        this.done = !!had.done;
        this.hints = had.hints | 0;
      }else{
        this.cells = new Array(want).fill(PIC_EMPTY);
        this.secs = 0;
        this.done = false;
        this.hints = 0;
      }
      this.wrong = null;
      this.built = false;
      if(this.idx >= 0 && !this.done) this._mark();
    },

    open(diff, day){
      this._chose = !!day && day !== pktNow();
      this._load(diff || this.diff, day || pktNow());
      this.build();
      this.render();
      this.persist();
      if(!this.done) this.run(); else this.stop();
    },

    /* ---- the clock ---- */
    run(){
      this.stop();
      this.tick = setInterval(()=>{
        if(this.done) return;
        this.secs++;
        this._paintMeta();
        // the same ten-second beat the crossword saves on
        if(this.secs % 10 === 0) this.persist();
      }, 1000);
    },
    stop(){ clearInterval(this.tick); this.tick = null; },

    persist(){
      this._stash();
      /* Only the boards worth keeping. A save that grows for ever is a save
         that eventually will not write. */
      const keys = Object.keys(this.boards).sort();
      while(keys.length > 40) delete this.boards[keys.shift()];
      writeGame(this.key, {boards:this.boards, diff:this.diff, day:this.day});
      /* The archive rides the same ten-second beat as the save. Marking on
         every square would write a record per tap; marking only on entry would
         leave the calendar showing where you *started*. */
      this._mark();
    },

    /* ---- drawing ---- */
    build(){
      const box = $('pix-grid');
      if(!box) return;
      if(this.idx < 0){
        box.innerHTML = '';
        this.built = false;
        return;
      }
      const n = this.size;
      /* The clue gutters are as wide and as tall as the longest clue, so the
         squares stay square whatever the puzzle needs. */
      const wide = Math.max.apply(null, this.rows.map(r=>r.length));
      const deep = Math.max.apply(null, this.cols.map(c=>c.length));
      box.className = 'pix-wrap n' + n;
      box.style.setProperty('--pix-n', String(n));
      box.style.setProperty('--pix-w', String(wide));
      box.style.setProperty('--pix-d', String(deep));
      let h = '<div class="pix-corner"></div>';
      h += '<div class="pix-cols">' + this.cols.map((c, x)=>
        '<div class="pix-cc" data-cc="' + x + '">'
        + c.map(v=>'<i>' + (v || '·') + '</i>').join('') + '</div>').join('') + '</div>';
      h += '<div class="pix-rows">' + this.rows.map((r, y)=>
        '<div class="pix-rc" data-rc="' + y + '">'
        + r.map(v=>'<i>' + (v || '·') + '</i>').join('') + '</div>').join('') + '</div>';
      h += '<div class="pix-cells">' + this.cells.map((_, i)=>
        '<button class="pix-cell" data-i="' + i + '" aria-label="'
        + (Math.floor(i / n) + 1) + ', ' + ((i % n) + 1) + '"></button>').join('')
        /* After the squares, so the every-fifth-line rules still count only
           squares; out of the grid's flow because they are positioned. */
        + '<i class="pix-aim-row" hidden></i><i class="pix-aim-col" hidden></i></div>';
      box.innerHTML = h;
      this.built = true;
      this._aimAt = -1;
      this._wire();
      this._paintZoom();
    },

    _wire(){
      const box = $('pix-grid');
      if(!box) return;
      const cells = box.querySelector('.pix-cells');
      if(!cells) return;
      const at = (e)=>{
        const el = e.target && e.target.closest ? e.target.closest('.pix-cell') : null;
        return el ? +el.dataset.i : -1;
      };
      const under = (e)=>{
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const cell = el && el.closest ? el.closest('.pix-cell') : null;
        return cell && cells.contains(cell) ? +cell.dataset.i : -1;
      };
      /* Painting, not tapping one at a time. A row of eight is eight taps
         otherwise, and the drag is what every picross on a phone does: what the
         first square becomes is what the rest of the drag becomes.

         **A drag only changes squares in the state it was meant for.** It used
         to paint whatever it crossed, so filling a run straight through a
         column of crosses wiped the notes out, and a stroke of crosses across a
         finished row emptied it. Now a stroke that puts something down only
         lands on blank squares, and a stroke that takes something away only
         takes away what it started on — fills or crosses, never both. The
         first square is still whatever you pressed on: a tap is deliberate. */
      cells.addEventListener('pointerdown', (e)=>{
        const i = at(e);
        if(i < 0 || this.done) return;
        e.preventDefault();
        /* Armed by "Fix a square". This tap spends the hint on the square you
           chose and paints nothing — and starts no drag, so a finger that
           slides off it afterwards does not smear fills across the board. */
        if(this._pick){ this.revealAt(i); return; }
        const was = this.cells[i];
        const put = was === this.mode ? PIC_EMPTY : this.mode;
        this._drag = put + 1;               // +1 so "paint nothing" is still truthy
        this._over = put === PIC_EMPTY ? was : PIC_EMPTY;
        this._put(i, put);
        this._aim(i);
        try{ cells.setPointerCapture(e.pointerId); }catch(err){}
      });
      cells.addEventListener('pointermove', (e)=>{
        const i = under(e);
        this._aim(i);
        if(!this._drag || this.done || i < 0) return;
        if(this.cells[i] === this._over) this._put(i, this._drag - 1);
      });
      const end = (e)=>{
        /* No hover on a finger or a pen once it lifts, so the guide goes with
           it; a mouse still hovering keeps its row and column lit. */
        if(!e || e.pointerType !== 'mouse') this._aim(-1);
        if(!this._drag) return;
        this._drag = 0;
        this.persist();
        this._check();
      };
      cells.addEventListener('pointerup', end);
      cells.addEventListener('pointercancel', end);
      cells.addEventListener('pointerleave', ()=>{ if(!this._drag) this._aim(-1); });
    },

    /* **Where you are, across and down.** On a thirty-wide grid the square under
       a finger is hidden by the finger, and the numbers that matter are twenty
       squares away at the edge. Two faint bands through the square — its row
       and its column — run out to both clue boxes and light them, so the row
       being counted is never a guess. Bands rather than a class on sixty
       squares: two elements move, nothing else is touched. */
    _aim(i){
      const box = $('pix-grid');
      if(!box || !this.built) return;
      if(this.done) i = -1;                // nothing left to count on a finished one
      if(i === this._aimAt) return;
      this._aimAt = i;
      const n = this.size;
      const old = box.querySelectorAll('.pix-rc.aim, .pix-cc.aim');
      for(const el of old) el.classList.remove('aim');
      const hr = box.querySelector('.pix-aim-row'), hc = box.querySelector('.pix-aim-col');
      if(i < 0 || i >= n * n){
        if(hr) hr.hidden = true;
        if(hc) hc.hidden = true;
        return;
      }
      const y = Math.floor(i / n), x = i % n;
      if(hr){ hr.hidden = false; hr.style.top = (y * 100 / n) + '%'; hr.style.height = (100 / n) + '%'; }
      if(hc){ hc.hidden = false; hc.style.left = (x * 100 / n) + '%'; hc.style.width = (100 / n) + '%'; }
      const rc = box.querySelector('[data-rc="' + y + '"]'), cc = box.querySelector('[data-cc="' + x + '"]');
      if(rc) rc.classList.add('aim');
      if(cc) cc.classList.add('aim');
    },

    _put(i, v){
      if(!(i >= 0 && i < this.cells.length) || this.cells[i] === v) return;
      this.cells[i] = v;
      /* A check's marks are about the board as it was; touching a square makes
         them stale, so they go rather than linger and mislead. */
      if(this.wrong){ this.wrong = null; clearTimeout(this._wrongT); this.render(); return; }
      const el = $('pix-grid').querySelector('[data-i="' + i + '"]');
      if(el) el.className = 'pix-cell' + (v === PIC_FILL ? ' on' : v === PIC_MARK ? ' off' : '');
      this._paintClues();
    },

    /* **Each number crosses off on its own, not just when the whole line is
       right.** Waiting for the entire row meant a fifteen-number line stayed
       fully lit while fourteen of its runs were settled, which is precisely
       when the bookkeeping is worst. Runs are matched to numbers from both
       ends — the left ones while they keep agreeing, the right ones likewise —
       and everything is recomputed from the board on every change, so a number
       lights again the moment its run stops matching. */
    _settled(line, clue){
      const out = new Array(clue.length).fill(false);
      if(clue.length === 1 && clue[0] === 0) return out;
      const runs = [];
      for(let i = 0; i < line.length; i++){
        if(line[i] !== 1) continue;
        const start = i;
        while(i < line.length && line[i] === 1) i++;
        runs.push(i - start);
      }
      /* More runs than the clue has numbers means the line is wrong however it
         lines up, so nothing is crossed off — this is the "relight when the
         rules are broken" case at its most obvious. */
      if(runs.length > clue.length) return out;
      let left = 0;
      while(left < clue.length && left < runs.length && runs[left] === clue[left]){
        out[left] = true;
        left++;
      }
      /* **A run may only settle one number.** Matching from both ends without
         this let a single run of five cross off both numbers of "5 5" — it
         matched the first from the left and the last from the right, and the
         second half of the line looked done before it was touched. */
      let right = 0;
      while(right < clue.length - left && right < runs.length - left
            && runs[runs.length - 1 - right] === clue[clue.length - 1 - right]){
        out[clue.length - 1 - right] = true;
        right++;
      }
      return out;
    },

    /** Paint one clue box: its numbers, and whether the line as a whole is right. */
    _paintLine(el, line, clue){
      if(!el) return;
      el.classList.toggle('done', picClue(line).join(',') === clue.join(','));
      const settled = this._settled(line, clue);
      const nums = el.querySelectorAll('i');
      for(let k = 0; k < nums.length; k++) nums[k].classList.toggle('done', !!settled[k]);
    },

    _paintClues(){
      const box = $('pix-grid');
      if(!box || !this.built) return;
      const n = this.size;
      for(let y = 0; y < n; y++){
        const line = [];
        for(let x = 0; x < n; x++) line.push(this.cells[y * n + x] === PIC_FILL ? 1 : 0);
        this._paintLine(box.querySelector('[data-rc="' + y + '"]'), line, this.rows[y]);
      }
      for(let x = 0; x < n; x++){
        const line = [];
        for(let y = 0; y < n; y++) line.push(this.cells[y * n + x] === PIC_FILL ? 1 : 0);
        this._paintLine(box.querySelector('[data-cc="' + x + '"]'), line, this.cols[x]);
      }
    },

    render(){
      const box = $('pix-grid');
      if(!box) return;
      if(this.idx < 0){
        box.innerHTML = '<p class="cal-empty">Nothing for this day.</p>';
        this._paintMeta();
        return;
      }
      if(!this.built) this.build();
      for(let i = 0; i < this.cells.length; i++){
        const el = box.querySelector('[data-i="' + i + '"]');
        if(el) el.className = 'pix-cell'
          + (this.cells[i] === PIC_FILL ? ' on' : this.cells[i] === PIC_MARK ? ' off' : '')
          + (this.wrong && this.wrong.has(i) ? ' bad' : '');
      }
      /* **Finished, it is a picture and not a worksheet.** The grid lines and
         the crosses were scaffolding for getting there; left on, the thing you
         just uncovered is still looking at you through graph paper. */
      box.classList.toggle('solved', !!this.done);
      if(this.done) this._aim(-1);
      this._paintClues();
      this._paintMeta();
      this._paintMode();
      this._paintSizes();
      const b = $('pix-banner');
      if(b) b.classList.toggle('hide', !this.done);
    },

    _paintMeta(){
      const m = $('pix-meta');
      if(!m) return;
      const when = this.day === pktNow() ? T('Today') : pktLabel(this.day);
      m.textContent = when + ' · ' + this.size + '×' + this.size
        + (this.encore ? ' · ' + T('again') : '') + ' · ' + fmt(this.secs);
      const s = $('pix-streak');
      if(s) dailyStreakPaint('pix-streak', 'picross');
    },
    /** The three sizes, with the two you have not finished today still open. */
    _paintSizes(){
      const box = $('pix-sizes');
      if(!box) return;
      box.innerHTML = PIC_DIFFS.map(k=>{
        const rec = dailyGet('picross', k, this.day);
        const done = rec && rec.s === DAILY_DONE;
        return '<button class="pix-size' + (this.diff === k ? ' on' : '') + (done ? ' done' : '') + '"'
          + ' data-size="' + k + '">' + PIC_SIZE[k] + '×' + PIC_SIZE[k]
          + '<span>' + esc(T(PIC_NAME[k])) + (done ? ' ✓' : '') + '</span></button>';
      }).join('');
      box.querySelectorAll('[data-size]').forEach(b=>{
        b.onclick = ()=>{
          if(b.dataset.size === this.diff) return;
          this.open(b.dataset.size, this.day);
          try{ blip(); }catch(e){}
        };
      });
    },

    /* **What one square comes to once the gutter has had its share.**

       Measured rather than worked out from the stylesheet: the gutter is sized
       in the grid's own font and the font changes with the puzzle (see the n30
       rules in 41-picross.css), so the only honest source for how wide it ended
       up is the element itself. Falls back to the CSS cap if it is asked before
       anything has been laid out. */
    _fitCell(){
      const box = $('pix-grid'), pane = $('pix-scroll');
      if(!box || !pane) return 0;
      const gut = box.querySelector('.pix-rows');
      const wide = pane.clientWidth - (gut ? gut.offsetWidth : 0);
      const n = this.size || 1;
      return wide > 0 ? Math.floor(wide / n) : 0;
    },

    /** Hold the clue tracks against the edge of the box as it is panned. */
    _pin(){
      const box = $('pix-grid'), pane = $('pix-scroll');
      if(!box || !pane) return;
      const on = box.classList.contains('zoomed');
      const x = on ? pane.scrollLeft : 0;
      const y = on ? pane.scrollTop : 0;
      const rows = box.querySelector('.pix-rows');
      const cols = box.querySelector('.pix-cols');
      const corner = box.querySelector('.pix-corner');
      /* Each track is held against one edge only: the row clues against the
         left as the picture moves sideways, the column clues against the top as
         it moves up. The corner is held against both, because it is where they
         meet. */
      if(rows) rows.style.transform = x ? 'translateX(' + x + 'px)' : '';
      if(cols) cols.style.transform = y ? 'translateY(' + y + 'px)' : '';
      if(corner) corner.style.transform = (x || y)
        ? 'translate(' + x + 'px,' + y + 'px)' : '';
    },

    /* ---------------- two fingers ----------------

       **One finger cannot both paint and pan**, and painting is what the game
       is, so it keeps the one finger. Everything else is given to the second:

         one finger on a square   paints, as it always has
         one finger on the clues  pans, because the gutters want no gesture
         two fingers              pinch to zoom, and drag to pan, anywhere

       The squares set `touch-action:none` so the browser hands their gestures
       over whole, which is why the pinch has to be worked out here rather than
       left to the page. The clue gutters do not, which is what makes a plain
       drag over them scroll for free.

       A stroke in progress is abandoned the moment a second finger lands. It is
       not undone -- the squares already under the first finger were deliberate,
       and taking them back would be its own surprise -- it simply stops
       growing, so spreading two fingers never draws a line across the board. */
    _wireGestures(){
      const pane = $('pix-scroll');
      if(!pane || pane._pixGest) return;
      pane._pixGest = true;
      const pts = new Map();
      let from = null;

      const spot = (e)=>{
        const r = pane.getBoundingClientRect();
        return {x:e.clientX - r.left, y:e.clientY - r.top};
      };
      const pair = ()=>{
        const [a, b] = [...pts.values()];
        const dx = a.x - b.x, dy = a.y - b.y;
        return {d:Math.max(1, Math.hypot(dx, dy)),
                x:(a.x + b.x) / 2, y:(a.y + b.y) / 2};
      };

      pane.addEventListener('pointerdown', (e)=>{
        if(e.pointerType === 'mouse') return;
        pts.set(e.pointerId, spot(e));
        if(pts.size === 2){
          Picross._drag = 0;          // whatever this was, it is not a stroke
          from = Object.assign(pair(), {z:Picross._zoom || 1,
            l:pane.scrollLeft, t:pane.scrollTop});
        }
      }, {capture:true, passive:true});

      pane.addEventListener('pointermove', (e)=>{
        if(!pts.has(e.pointerId)) return;
        pts.set(e.pointerId, spot(e));
        if(pts.size !== 2 || !from) return;
        e.preventDefault();
        const now = pair();
        /* The drag half: wherever the middle of the two fingers went, the
           picture goes the other way. Applied before the zoom so the zoom's own
           correction is measured from where the content actually is. */
        pane.scrollLeft = from.l - (now.x - from.x);
        pane.scrollTop = from.t - (now.y - from.y);
        Picross.zoomTo(from.z * (now.d / from.d), {x:now.x, y:now.y});
        Picross._pin();
      }, {capture:true, passive:false});

      const lift = (e)=>{
        pts.delete(e.pointerId);
        if(pts.size < 2) from = null;
        /* Still one finger down after a pinch: it must not become a stroke
           halfway through, so the next move is treated as a fresh start. */
        if(pts.size === 1) Picross._drag = 0;
      };
      pane.addEventListener('pointerup', lift, {capture:true, passive:true});
      pane.addEventListener('pointercancel', lift, {capture:true, passive:true});
    },

    /** Follow the box being panned. Bound once, to the box rather than the grid,
        because the grid inside it is rebuilt on every puzzle. */
    _wirePan(){
      const pane = $('pix-scroll');
      if(!pane || pane._pixPan) return;
      pane._pixPan = true;
      pane.addEventListener('scroll', ()=>{ Picross._pin(); }, {passive:true});
    },

    /** Put the current zoom on the grid, and say so on the button. */
    _paintZoom(){
      const box = $('pix-grid');
      if(!box) return;
      const z = this._zoom || 1;
      if(z <= 1){
        /* Back to the stylesheet's own fitting. The inline size has to be
           cleared, not set to the fitted number: leaving a pixel value behind
           would freeze the puzzle at whatever the box happened to be when it
           was last zoomed, and it would stop following a window being resized. */
        box.classList.remove('zoomed');
        box.style.removeProperty('--pix-max');
      }else{
        const cell = this._fitCell();
        if(cell > 0){
          box.classList.add('zoomed');
          box.style.setProperty('--pix-max', Math.round(cell * z) + 'px');
        }
      }
      this._wirePan();
      this._wireGestures();
      this._pin();
      const lab = $('pix-zlabel');
      if(lab) lab.textContent = z <= 1 ? T('Fit')
        : (Math.round(z * 10) % 10 ? z.toFixed(1) : String(Math.round(z))) + '\u00d7';
      /* Compared against the ends rather than looked up in the list: a pinch
         leaves the zoom between two steps, and indexOf would then say -1 and
         light both buttons at the bottom of the range. */
      const out = $('pix-zout'), zin = $('pix-zin');
      if(out) out.disabled = z <= PIC_ZOOMS[0] + 0.001;
      if(zin) zin.disabled = z >= PIC_ZOOMS[PIC_ZOOMS.length - 1] - 0.001;
    },

    /** The nearest step to where a pinch left it, so the buttons still work
        afterwards rather than jumping back to a number nobody chose. */
    _nearestStep(){
      const z = this._zoom || 1;
      let best = 0;
      for(let i = 1; i < PIC_ZOOMS.length; i++){
        if(Math.abs(PIC_ZOOMS[i] - z) < Math.abs(PIC_ZOOMS[best] - z)) best = i;
      }
      return best;
    },

    /** Straight to a number, for a pinch. Between the ends of the step list. */
    zoomTo(z, hold){
      const lo = PIC_ZOOMS[0], hi = PIC_ZOOMS[PIC_ZOOMS.length - 1];
      const next = Math.max(lo, Math.min(hi, z));
      if(Math.abs(next - (this._zoom || 1)) < 0.001) return;
      const pane = $('pix-scroll');
      const was = pane ? {w:pane.scrollWidth, h:pane.scrollHeight,
                          l:pane.scrollLeft, t:pane.scrollTop} : null;
      this._zoom = next;
      this._paintZoom();
      /* **Zoom about the point being held, not about the corner.** Without
         this, pinching on the middle of the picture walks it off to the top
         left, which on a thirty-wide grid means losing the part you were
         working on every time you adjust. The content under the fingers is
         kept where it is by scaling the scroll offset through that point. */
      if(pane && was && was.w > 0 && was.h > 0 && hold){
        const kx = pane.scrollWidth / was.w, ky = pane.scrollHeight / was.h;
        pane.scrollLeft = (was.l + hold.x) * kx - hold.x;
        pane.scrollTop = (was.t + hold.y) * ky - hold.y;
        this._pin();
      }
    },

    /** One step in or out, and keep the square you were looking at in view. */
    setZoom(step){
      const i = this._nearestStep();
      const next = PIC_ZOOMS[Math.max(0, Math.min(PIC_ZOOMS.length - 1, i + step))];
      if(next === this._zoom) return;
      const pane = $('pix-scroll');
      /* Where the middle of the view was, as a fraction of the whole, so
         zooming goes in on what you were looking at rather than throwing you
         back to the top left corner of the picture. */
      const mid = pane && pane.scrollWidth > pane.clientWidth
        ? {x:(pane.scrollLeft + pane.clientWidth / 2) / pane.scrollWidth,
           y:(pane.scrollTop + pane.clientHeight / 2) / pane.scrollHeight}
        : null;
      this._zoom = next;
      this._paintZoom();
      if(pane && mid){
        pane.scrollLeft = mid.x * pane.scrollWidth - pane.clientWidth / 2;
        pane.scrollTop = mid.y * pane.scrollHeight - pane.clientHeight / 2;
      }
      /* Setting scrollLeft fires scroll asynchronously, and zooming out to Fit
         does not fire it at all -- so the tracks are put back by hand rather
         than waiting for an event that may not come. */
      this._pin();
    },

    _paintMode(){
      for(const b of [$('pix-fill'), $('pix-mark')]){
        if(!b) continue;
        const want = b.id === 'pix-fill' ? PIC_FILL : PIC_MARK;
        b.classList.toggle('on', this.mode === want);
      }
      /* Armed is a state, so it has to look like one. The button lights up and
         says what it is now waiting for, and the board says the same thing in
         its cursor — a board that has quietly changed what a tap does, with
         nothing on screen admitting it, is how you lose a square you meant to
         fill. */
      const h = $('pix-hint');
      if(h){
        h.classList.toggle('on', this._pick);
        h.textContent = this._pick ? T('Pick a square') : T('Fix a square');
      }
      const box = $('pix-grid');
      if(box) box.classList.toggle('picking', this._pick);
    },

    setMode(v){ this.mode = v; this._paintMode(); },

    clear(){
      askConfirm('Start this one again?', 'Every square you have filled in goes.', 'Start again', ()=>{
        this.cells = this.cells.map(()=>PIC_EMPTY);
        this.done = false;
        this.secs = 0;
        this.render();
        this.persist();
        this.run();
      });
    },

    /* ---- what the calendar is told ----
       A day in the archive used to read "Started", which says nothing about
       whether you are two squares in or two from the end. These are the three
       numbers that make an unfinished day worth looking at: how much of the
       picture is right, how much there is, and how much was given away. */
    _progress(){
      const n = this.size;
      let right = 0, need = 0;
      for(let y = 0; y < n; y++){
        for(let x = 0; x < n; x++){
          if(this.sol[y] && this.sol[y][x] === 1){
            need++;
            if(this.cells[y * n + x] === PIC_FILL) right++;
          }
        }
      }
      return {c:right, n:need, h:this.hints};
    },
    /** Tell the calendar where this board stands. Cheap, and never on a finished
        day — a done record must not be walked back to "started". */
    _mark(){
      if(this.idx < 0 || this.done) return;
      const p = this._progress();
      dailyMark('picross', this.diff, this.day, DAILY_STARTED,
        {t:this.secs, c:p.c, n:p.n, h:p.h});
    },

    /* ---- checking, and being told one square ---- */

    /** Squares filled in that the picture does not have. */
    _wrongOnes(){
      const n = this.size, out = [];
      for(let y = 0; y < n; y++){
        for(let x = 0; x < n; x++){
          const i = y * n + x;
          if(this.cells[i] === PIC_FILL && !(this.sol[y] && this.sol[y][x] === 1)) out.push(i);
        }
      }
      return out;
    },

    /** **Check marks what is wrong, not what is missing.** A square you have
        not reached yet is not a mistake, and colouring it would hand over the
        picture. Shown for a few seconds and then dropped, so the board cannot
        be read as an answer key. */
    check(){
      if(this.idx < 0 || this.done) return 0;
      const bad = this._wrongOnes();
      this.wrong = bad.length ? new Set(bad) : null;
      this.render();
      clearTimeout(this._wrongT);
      if(bad.length){
        this._wrongT = setTimeout(()=>{ this.wrong = null; this.render(); }, 4000);
      }
      try{
        toast(bad.length
          ? Tn('{n} square is wrong', '{n} squares are wrong', bad.length)
          : 'Nothing wrong so far');
      }catch(e){}
      return bad.length;
    },

    /** **Arm the board instead of choosing for them.**

        This button used to do the choosing: take back the first wrong square,
        or failing that fill in the first missing one, reading top-left to
        bottom-right. That is a good guess surprisingly often and the wrong one
        exactly when it matters — the square somebody is stuck on is rarely the
        first in reading order, and a hint spent on a corner they had already
        worked out is a hint wasted. They can see where they are stuck; the code
        cannot.

        So pressing it now reveals nothing. It arms the next tap, and pressing
        it again disarms. `reveal()` is kept below for the tests and for
        anything that wants the old automatic behaviour. */
    pick(){
      if(this.idx < 0 || this.done) return false;
      this._pick = !this._pick;
      this.render();
      return this._pick;
    },

    /** **One square, told the truth.** Filled if the picture fills it, crossed
        off if it does not — a cross is information too, and on a wide row it is
        often the more useful of the two.

        A square that is already right is not a reveal: it costs nothing, says
        so, and leaves the board armed so the next tap can go somewhere useful.
        Spending somebody's hint on a square they had already solved, silently,
        is the one outcome this whole change exists to avoid. */
    revealAt(i){
      if(this.idx < 0 || this.done) return false;
      const n = this.size;
      const y = Math.floor(i / n), x = i % n;
      if(i < 0 || !this.sol[y]) return false;
      const want = this.sol[y][x] === 1 ? PIC_FILL : PIC_MARK;
      if(this.cells[i] === want){
        try{ toast(T('That one is already right')); }catch(e){}
        return false;
      }
      this.cells[i] = want;
      this.hints++;
      this._pick = false;
      this.wrong = null;
      this.persist();
      this._mark();
      this.render();
      this._check();
      return true;
    },

    /** **One square, put right, chosen by the board.** Takes back a square that
        should not be filled before it gives one away. No longer on a button —
        see `pick()` — but kept because it is the same rule the hint count and
        the day's record were always built on. */
    reveal(){
      if(this.idx < 0 || this.done) return false;
      const n = this.size;
      let at = this._wrongOnes()[0];
      if(at != null){
        this.cells[at] = PIC_EMPTY;
      }else{
        for(let y = 0; y < n && at == null; y++){
          for(let x = 0; x < n; x++){
            const i = y * n + x;
            if(this.sol[y] && this.sol[y][x] === 1 && this.cells[i] !== PIC_FILL){ at = i; break; }
          }
        }
        if(at == null) return false;
        this.cells[at] = PIC_FILL;
      }
      this.hints++;
      this.wrong = null;
      this.persist();
      this._mark();
      this.render();
      this._check();
      return true;
    },

    /** Finished when the filled squares are exactly the picture's. */
    _check(){
      if(this.done || this.idx < 0) return;
      const n = this.size;
      for(let y = 0; y < n; y++){
        for(let x = 0; x < n; x++){
          const want = this.sol[y][x] === 1;
          const got = this.cells[y * n + x] === PIC_FILL;
          if(want !== got) return;
        }
      }
      this.done = true;
      this.stop();
      this.persist();
      const p = this._progress();
      dailyMark('picross', this.diff, this.day, DAILY_DONE,
        {t:this.secs, c:p.c, n:p.n, h:p.h});
      this.render();
      /* **Now it can be named.** Up to this point the name is the answer, so it
         is kept off the screen; once the last square is in, "there it is" on its
         own leaves you looking at a shape and guessing. */
      const what = picTitle(this.diff, this.idx);
      const sub = (what ? what + ' · ' : '') + T('{s}×{s} in {t}', {s:this.size, t:fmt(this.secs)})
        + (this.hints ? ' · ' + T('{n} revealed', {n:this.hints}) : '');
      try{ showBanner('pix-banner', 'There it is.', sub); }catch(e){}
      try{ chime(false); }catch(e){}
      try{ Arcade._refresh(); }catch(e){}
    },
  };

  /* ---- the shelf and the archive ---- */

  registerGame('picross', {
    el:'game-picross', title:'Picross', progEl:'prog-picross', game:()=>Picross,
    reset(){ Picross.clear(); },
    resetNote:'The squares you have filled in on this one, cleared.',
    async progress(){
      const at = picOnDay(Picross.diff || 'easy', pktNow());
      if(at.i < 0) return 'New<span>tap to start</span>';
      const st = dailyDayCount('picross', PIC_DIFFS, null, pktNow());
      if(st[0] >= st[1] && st[1]) return 'Done<span data-done="1">all three today</span>';
      return esc(T('{a} of {b}', {a:st[0], b:st[1]})) + '<span>today</span>';
    },
  });

  registerDaily('picross', {
    title:'Picross',
    diffs:PIC_DIFFS.map(k=>({k, n:PIC_NAME[k]})),
    /* Nothing was published before the bank existed, so the calendar draws no
       dot there and a streak does not count those days as missed. */
    on(day, diff){ return picOnDay(diff, day).i >= 0; },
    open(day, diff){ Picross.open(diff || 'easy', day); },
    /* Finished, it is the picture's name rather than "Small" — the same rule
       as the finish banner: never before the last square is in. */
    name(day, diff, rec){
      if(!rec || rec.s !== DAILY_DONE) return '';
      return picTitle(diff, picOnDay(diff, day).i);
    },
    /* **What a day looks like in the archive.** "Started" was all it said,
       which is the same word for two squares in and two from the end. A board
       part way through reports how much of the picture is right out of how much
       there is, and anything given away is counted on both. */
    line(rec){
      if(!rec) return '';
      const given = rec.h ? ' · ' + T('{n} revealed', {n:rec.h}) : '';
      if(rec.s !== DAILY_DONE){
        const where = rec.n ? T('{c} of {n} squares', {c:rec.c, n:rec.n}) : T('Started');
        return where + (rec.t ? ' · ' + fmt(rec.t) : '') + given;
      }
      return T('Done in {t}', {t:fmt(rec.t || 0)}) + given;
    },
    stats(all){
      const done = all.filter(r=>r.s === DAILY_DONE);
      const best = done.reduce((b, r)=>(!b || (r.t && r.t < b)) ? r.t : b, 0);
      return [
        {v:String(dailyStreak('picross', PIC_DIFFS)), n:'day streak'},
        {v:String(done.length), n:'finished'},
        {v:best ? fmt(best) : ', ', n:'best'},
      ];
    },
  });

  /* The screen's buttons. Wired once at load, like every other game's. */
  if($('pix-fill')) $('pix-fill').onclick = ()=>Picross.setMode(PIC_FILL);
  if($('pix-mark')) $('pix-mark').onclick = ()=>Picross.setMode(PIC_MARK);
  if($('pix-clear')) $('pix-clear').onclick = ()=>Picross.clear();
  if($('pix-again')) $('pix-again').onclick = ()=>{ try{ dailyCalOpen('picross'); }catch(e){} };
  if($('pix-list')) $('pix-list').onclick = ()=>{ try{ dailyCalOpen('picross'); }catch(e){} };
  if($('pix-zin')) $('pix-zin').onclick = ()=>Picross.setZoom(1);
  if($('pix-zout')) $('pix-zout').onclick = ()=>Picross.setZoom(-1);
  /* A zoomed grid is sized in real pixels off the width of its box, so when
     the box changes width the number is stale: rotate the phone and the
     puzzle keeps the shape the other orientation gave it. Only when actually
     zoomed, because at Fit the stylesheet is doing this by itself. */
  try{
    window.addEventListener('resize', ()=>{
      if(Picross._zoom > 1) Picross._paintZoom();
    });
  }catch(e){}
  if($('pix-check')) $('pix-check').onclick = ()=>Picross.check();
  if($('pix-hint')) $('pix-hint').onclick = ()=>Picross.pick();
