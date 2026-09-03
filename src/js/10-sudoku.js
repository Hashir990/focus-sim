  /* ---------------- SUDOKU ---------------- */
  function sOK(g,i,n){
    const r=(i/9|0), c=i%9;
    for(let k=0;k<9;k++){ if(g[r*9+k]===n||g[k*9+c]===n) return false; }
    const br=(r/3|0)*3, bc=(c/3|0)*3;
    for(let a=0;a<3;a++)for(let b=0;b<3;b++) if(g[(br+a)*9+(bc+b)]===n) return false;
    return true;
  }
  /* **Randomness comes in, it is not reached for.** Every shuffle here used
     `Math.random`, which is why no two people ever saw the same grid — and a
     dated puzzle has to be the same grid for everybody. `rnd` is a generator
     seeded from the game, the difficulty and the day; see `dailyGen` in
     09b-daily.js. Passing it down rather than setting a module-level seed
     keeps these three functions pure, which is what makes the result
     reproducible rather than merely usually-right. */
  function sShuffle(a,rnd){ const r=rnd||Math.random; for(let i=a.length-1;i>0;i--){ const j=r()*(i+1)|0; [a[i],a[j]]=[a[j],a[i]]; } return a; }
  function sFill(g,i,rnd){
    if(i>=81) return true;
    if(g[i]) return sFill(g,i+1,rnd);
    for(const n of sShuffle([1,2,3,4,5,6,7,8,9],rnd)) if(sOK(g,i,n)){ g[i]=n; if(sFill(g,i+1,rnd)) return true; g[i]=0; }
    return false;
  }
  function sCount(g,lim){
    const i=g.indexOf(0); if(i<0) return 1;
    let c=0;
    for(let n=1;n<=9;n++) if(sOK(g,i,n)){ g[i]=n; c+=sCount(g,lim); g[i]=0; if(c>=lim) break; }
    return c;
  }
  function sMake(diff,rnd){
    const sol=new Array(81).fill(0); sFill(sol,0,rnd);
    const puz=sol.slice();
    const target = diff==='easy'?42 : diff==='hard'?30 : 35;
    let given=81;
    for(const idx of sShuffle([...Array(81).keys()],rnd)){
      if(given<=target) break;
      const bak=puz[idx]; if(!bak) continue;
      puz[idx]=0;
      if(sCount(puz.slice(),2)!==1) puz[idx]=bak; else given--;
    }
    return {puz,sol};
  }

  const Sudoku = {
    key:'arcade_sudoku', cells:[], built:false,
    grid:[], given:[], sol:[], notes:[], sel:-1, notesMode:false,
    elapsed:0, done:false, diff:'medium', tick:null, pendDiff:null, pendT:null,
    /* Which dated edition is on the board. A save from before there were
       editions has no day; `pktNow()` adopts it as today's rather than
       throwing away a grid somebody is in the middle of. */
    day:'',
    /* **Every board you have open, keyed `day|difficulty`.**
       There used to be one, so opening Tuesday's easy threw away Monday's
       half-finished hard — and with an archive to browse, that is a thing you
       do by accident on the way to somewhere else. Boards are small (three
       arrays of 81) and only the ones you have actually opened are here, so
       the whole shelf is a few kilobytes. Finished ones are dropped: they can
       be regenerated from the day, and their result is on the calendar. */
    boards:{},
    async enter(){
      if(!this.grid.length){
        const d=await readGame(this.key);
        if(d){
          this.boards = (d.boards && typeof d.boards === 'object') ? d.boards : {};
          /* A save from before the shelf existed is one board; it becomes the
             first entry rather than being thrown away. */
          if(d.grid && !d.boards){
            this.boards[(d.day || pktNow()) + '|' + (d.diff || 'medium')] = {
              grid:d.grid, given:d.given, sol:d.sol,
              notes:d.notes || Array.from({length:81},()=>[]),
              elapsed:d.elapsed || 0, done:!!d.done,
            };
          }
          this.diff = d.diff || 'medium';
          this.day = d.day || pktNow();
          if(!this._take(this.day, this.diff)) this._gen(this.diff, this.day);
        }
        else this._gen('medium', pktNow());
      }
      /* **Finished yesterday's, so here is today's.** Only when the board is
         actually finished and today's edition at that difficulty has not been
         played — a half-solved grid is never taken away from you, and one you
         already solved today is not silently replaced by itself. */
      if(this.done && this.day !== pktNow() && !dailyPlayed('sudoku', this.diff)){
        this._gen(this.diff, pktNow());
      }
      this.build(); this.render();
      $('sdk-banner').classList.toggle('hide', !this.done);
      if(!this.done) this.run();
    },
    leave(){ this.stop(); this.persist(); },
    _slot(day, diff){ return (day || pktNow()) + '|' + (diff || 'medium'); },
    /** Put the board on screen back on the shelf, so leaving it does not lose
        it. Called before anything replaces it. */
    _stash(){
      if(!this.grid.length || !this.day) return;
      this.boards[this._slot(this.day, this.diff)] = {
        grid:this.grid.slice(), given:this.given.slice(), sol:this.sol.slice(),
        notes:this.notes.map(a=>a.slice()), elapsed:this.elapsed, done:this.done,
      };
    },
    /** Take one off the shelf, if it is there. */
    _take(day, diff){
      const b = this.boards[this._slot(day, diff)];
      if(!b || !Array.isArray(b.grid) || b.grid.length !== 81) return false;
      this.grid=b.grid.slice(); this.given=b.given.slice(); this.sol=b.sol.slice();
      this.notes=(b.notes || []).map(a=>(a || []).slice());
      while(this.notes.length < 81) this.notes.push([]);
      this.elapsed=b.elapsed|0; this.done=!!b.done;
      this.sel=-1; this.wrong=null; this.diff=diff; this.day=day;
      return true;
    },
    /** Build one dated edition. Same difficulty and same day gives the same
        grid on every device there is — that is the whole point of `dailyGen`. */
    _gen(diff, day){
      const d = day || pktNow();
      this._stash();
      const {puz,sol}=sMake(diff, dailyGen('sudoku', diff, d));
      this.grid=puz.slice(); this.given=puz.map(v=>!!v); this.sol=sol;
      this.notes=Array.from({length:81},()=>[]); this.sel=-1; this.done=false; this.elapsed=0;
      this.diff=diff; this.day=d;
      this.persist();
      dailyMark('sudoku', diff, d, DAILY_STARTED);
    },
    /** Open a day, from the shelf if it is there and freshly built if not.
        This is what the difficulty buttons and the calendar both call. */
    _open(diff, day){
      const d = day || pktNow();
      if(this.day === d && this.diff === diff) return;
      this._stash();
      if(!this._take(d, diff)) this._gen(diff, d);
      else { this.persist(); dailyMark('sudoku', diff, d, this.done ? DAILY_DONE : DAILY_STARTED); }
    },
    /** A difficulty button, which now means "today's easy" rather than "another
        easy". `day` is how the calendar opens an older one. */
    newGame(diff, force, day){
      const want = day || pktNow();
      /* One a day is the rule for *today*; the archive is always open, which
         is what makes the rule bearable. */
      if(!day && dailyPlayed('sudoku', diff)){
        toast('Today\u2019s ' + diff + ' is done');
        dailyCalOpen('sudoku');
        return;
      }
      /* **No confirmation any more, because nothing is lost.** It used to ask
         twice before swapping grids, which was right when swapping threw the
         old one away. Every board is kept on its own shelf now, so switching
         is just switching. */
      this.pendDiff=null; clearTimeout(this.pendT);
      this.stop(); this._open(diff, want); this.render();
      $('sdk-banner').classList.toggle('hide', !this.done);
      if(!this.done) this.run();
    },
    build(){
      const grid=$('sdk-grid'); grid.innerHTML=''; this.cells=[];
      for(let i=0;i<81;i++){ const d=document.createElement('div'); d.onclick=()=>this.select(i); grid.appendChild(d); this.cells.push(d); }
      const pad=$('sdk-pad'); pad.innerHTML='';
      for(let n=1;n<=9;n++){ const b=document.createElement('button'); b.dataset.n=n; b.innerHTML=n+'<span class="cnt"></span>'; b.onclick=()=>this.input(n); pad.appendChild(b); }
      const er=document.createElement('button'); er.className='util'; er.textContent='Erase'; er.onclick=()=>this.erase(); pad.appendChild(er);
      // controls bar: notes + difficulty (once)
      if(!$('sdk-ctrl')){
        const snew=$('sdk-new'); if(snew) snew.remove();
        const bar=document.createElement('div'); bar.id='sdk-ctrl'; bar.className='sdk-ctrl';
        const notes=document.createElement('button'); notes.id='sdk-notes'; notes.className='mini-btn';
        notes.onclick=()=>{ this.notesMode=!this.notesMode; this.render(); };
        const chk=document.createElement('button'); chk.id='sdk-check'; chk.className='mini-btn'; chk.textContent='Check';
        chk.onclick=()=>this.check();
        const diffs=document.createElement('div'); diffs.className='diffs';
        [['Easy','easy'],['Med','medium'],['Hard','hard']].forEach(([l,d])=>{ const b=document.createElement('button'); b.className='mini-btn'; b.dataset.d=d; b.textContent=l; b.onclick=()=>this.newGame(d); diffs.appendChild(b); });
        bar.appendChild(notes); bar.appendChild(chk); bar.appendChild(diffs);
        $('sdk-grid').parentNode.insertBefore(bar, $('sdk-grid'));
      }
    },
    select(i){ if(this.done) return; this.sel=i; this.render(); },
    input(n){
      if(this.done||this.sel<0||this.given[this.sel]) return;
      const i=this.sel;
      if(this.notesMode){
        const a=this.notes[i], k=a.indexOf(n);
        if(k>=0) a.splice(k,1); else a.push(n);
        this.grid[i]=0;
      }else{
        this.grid[i]= this.grid[i]===n?0:n; this.notes[i]=[];
      }
      this.wrong=null;                    // a new entry clears the last check
      this.persist(); this.render(); this.checkDone();
    },
    /** Marks every filled-in cell that disagrees with the solution. */
    check(){
      if(this.done) return;
      const bad=[];
      for(let i=0;i<81;i++){
        if(this.given[i] || !this.grid[i]) continue;
        if(this.grid[i]!==this.sol[i]) bad.push(i);
      }
      const blank=this.grid.filter((v,i)=>!v && !this.given[i]).length;
      this.wrong=bad;
      this.render();
      if(bad.length) toast(bad.length+' wrong '+(bad.length===1?'cell':'cells'));
      else if(blank) toast('All good so far — '+blank+' left');
      else toast('All correct');
    },
    erase(){ if(this.done||this.sel<0||this.given[this.sel]) return; this.grid[this.sel]=0; this.notes[this.sel]=[]; this.persist(); this.render(); },
    conflict(i,v){
      const r=(i/9|0), c=i%9, br=(r/3|0)*3, bc=(c/3|0)*3;
      for(let k=0;k<9;k++){ if(k!==c&&this.grid[r*9+k]===v) return true; if(k!==r&&this.grid[k*9+c]===v) return true; }
      for(let a=0;a<3;a++)for(let b=0;b<3;b++){ const j=(br+a)*9+(bc+b); if(j!==i&&this.grid[j]===v) return true; }
      return false;
    },
    render(){
      const sel=this.sel, sr=sel>=0?(sel/9|0):-1, sc=sel>=0?sel%9:-1, sbr=sel>=0?(sr/3|0):-1, sbc=sel>=0?(sc/3|0):-1, sv=sel>=0?this.grid[sel]:0;
      for(let i=0;i<81;i++){
        const c=this.cells[i], v=this.grid[i], r=(i/9|0), col=i%9;
        let cls='cell';
        if(this.given[i]) cls+=' given';
        if(col===2||col===5) cls+=' br';
        if(r===2||r===5) cls+=' bb';
        if(i===sel) cls+=' sel';
        else if(sel>=0 && (r===sr||col===sc||((r/3|0)===sbr&&(col/3|0)===sbc))) cls+=' peer';
        if(sv&&v===sv&&i!==sel) cls+=' same';
        if(v&&this.conflict(i,v)) cls+=' bad';
        if(this.wrong && this.wrong.indexOf(i)!==-1) cls+=' wrong';
        c.className=cls;
        if(v){ c.textContent=v; }
        else if(this.notes[i].length){ c.textContent=''; const nd=document.createElement('div'); nd.className='notes'; for(let k=1;k<=9;k++){ const s=document.createElement('span'); s.textContent=this.notes[i].includes(k)?k:''; nd.appendChild(s);} c.appendChild(nd); }
        else c.textContent='';
      }
      for(let n=1;n<=9;n++){ const b=$('sdk-pad').querySelector('[data-n="'+n+'"]'); if(b){ const left=9-this.grid.filter(x=>x===n).length; b.querySelector('.cnt').textContent=left>0?left:'✓'; } }
      const nt=$('sdk-notes'); if(nt){ nt.textContent=this.notesMode?'Notes ✏️':'Notes'; nt.classList.toggle('on',this.notesMode); }
      document.querySelectorAll('#game-sudoku .diffs .mini-btn').forEach(b=>b.classList.toggle('on', b.dataset.d===this.diff));
      $('sdk-meta').textContent = this._meta();
    },
    /** `Hard · Aug 27 · 04:12`, so the board says which edition it is. */
    _meta(){
      const d = this.diff.replace(/^./,m=>m.toUpperCase());
      const when = this.day === pktNow() ? 'Today' : pktLabel(this.day);
      return d + ' · ' + when + ' · ' + fmt(this.elapsed);
    },
    checkDone(){
      if(this.grid.includes(0)) return;
      for(let i=0;i<81;i++) if(this.grid[i]!==this.sol[i]){ toast('Not quite — check the reds'); return; }
      this.done=true; this.stop(); this.persist();
      dailyMark('sudoku', this.diff, this.day, DAILY_DONE, {t:this.elapsed});
      /* Finished, so it comes off the shelf — it can be rebuilt from its day
         and its result is on the calendar. */
      delete this.boards[this._slot(this.day, this.diff)];
      // the board is about to be replaced by the next one, so the count of them
      // has to be kept somewhere that outlives it
      try{ featBump('sudoku', 10); }catch(e){}
      chime(false); buzz(120);
      showBanner('sdk-banner', 'Solved.', fmt(this.elapsed) + ' · ' + this.diff);
    },
    run(){ this.stop(); this.tick=setInterval(()=>{ this.elapsed++; $('sdk-meta').textContent=this._meta();
      if(this.elapsed%10===0) this.persist(); },1000); },
    stop(){ clearInterval(this.tick); this.tick=null; },
    persist(){
      this._stash();
      writeGame(this.key, {diff:this.diff, day:this.day, boards:this.boards});
      /* The calendar's record goes down with the board, so a grid put away
         mid-minute keeps its time. `dailyMark` is a no-op when nothing moved. */
      if(this.day && !this.done){
        dailyMark('sudoku', this.diff, this.day, DAILY_STARTED, {t:this.elapsed});
      }
    },
    /* An account replaced what is in storage: drop the grid so the next
       `enter()` reads the new one instead of writing this one back. */
    forget(){ this.grid = []; this.boards = {}; this.built = false; }
  };

  forgetGame(Sudoku.key, ()=>Sudoku.forget());

  /* **Three editions a day, one per difficulty.** `open` is what the calendar
     presses; everything else about the game is unchanged. */
  registerDaily('sudoku', {
    title:'Sudoku',
    diffs:[{k:'easy', n:'Easy'}, {k:'medium', n:'Medium'}, {k:'hard', n:'Hard'}],
    open(day, diff){ Sudoku.newGame(diff || 'medium', true, day); },
    line(rec){
      if(!rec) return '';
      if(rec.s !== 2) return rec.t ? ('Started · ' + fmt(rec.t)) : 'Started';
      return 'Solved in ' + fmt(rec.t || 0);
    },
    stats(all){
      const done = all.filter(r=>r.s === 2);
      const best = done.reduce((b,r)=>(!b || (r.t && r.t < b)) ? r.t : b, 0);
      const total = done.reduce((n,r)=>n + (r.t || 0), 0);
      /* **A streak counts only puzzles solved on the day they came out.**
         Working back through the archive is worth doing and is not turning up;
         see `dailyStreak` and the `d` flag in 09b-daily.js. Three difficulties
         means three streaks, so this shows the longest of them — the one you
         would tell somebody about. */
      const run = Math.max(dailyStreak('sudoku', 'easy'),
        dailyStreak('sudoku', 'medium'), dailyStreak('sudoku', 'hard'));
      return [
        {v:String(run), n:'day streak'},
        {v:String(done.length), n:'solved'},
        {v:best ? fmt(best) : '—', n:'best'},
      ];
    },
  });

  registerGame('sudoku', {
    el:'game-sudoku', title:'Sudoku', progEl:'prog-sudoku', game:()=>Sudoku,
    /* **No reset.** A dated puzzle is played once and the result is kept; a
       button that wipes the board and the time with it makes the record worth
       nothing. The archive is what "play something else" means now. */
    /* Reads the shelf rather than a single board — see `boards` above. */
    async progress(){
      const d = await readGame(Sudoku.key);
      const b = d && d.boards && d.boards[(d.day || '') + '|' + (d.diff || '')];
      if(!b || !Array.isArray(b.grid)) return 'Today<span>tap to start</span>';
      if(b.done) return 'Solved<span>see history</span>';
      const filled = b.grid.filter((v,i)=>v && !b.given[i]).length;
      return filled>0 ? (filled+' filled<span>in progress</span>') : 'Today<span>tap to start</span>';
    }
  });

