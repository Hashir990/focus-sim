  /* ---------------- SUDOKU ---------------- */
  function sOK(g,i,n){
    const r=(i/9|0), c=i%9;
    for(let k=0;k<9;k++){ if(g[r*9+k]===n||g[k*9+c]===n) return false; }
    const br=(r/3|0)*3, bc=(c/3|0)*3;
    for(let a=0;a<3;a++)for(let b=0;b<3;b++) if(g[(br+a)*9+(bc+b)]===n) return false;
    return true;
  }
  function sShuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.random()*(i+1)|0; [a[i],a[j]]=[a[j],a[i]]; } return a; }
  function sFill(g,i){
    if(i>=81) return true;
    if(g[i]) return sFill(g,i+1);
    for(const n of sShuffle([1,2,3,4,5,6,7,8,9])) if(sOK(g,i,n)){ g[i]=n; if(sFill(g,i+1)) return true; g[i]=0; }
    return false;
  }
  function sCount(g,lim){
    const i=g.indexOf(0); if(i<0) return 1;
    let c=0;
    for(let n=1;n<=9;n++) if(sOK(g,i,n)){ g[i]=n; c+=sCount(g,lim); g[i]=0; if(c>=lim) break; }
    return c;
  }
  function sMake(diff){
    const sol=new Array(81).fill(0); sFill(sol,0);
    const puz=sol.slice();
    const target = diff==='easy'?42 : diff==='hard'?30 : 35;
    let given=81;
    for(const idx of sShuffle([...Array(81).keys()])){
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
    async enter(){
      if(!this.grid.length){
        const d=await readGame(this.key);
        if(d){ Object.assign(this,{grid:d.grid,given:d.given,sol:d.sol,notes:d.notes||Array.from({length:81},()=>[]),diff:d.diff||'medium',elapsed:d.elapsed||0,done:!!d.done}); }
        else this._gen('medium');
      }
      this.build(); this.render();
      $('sdk-banner').classList.toggle('hide', !this.done);
      if(!this.done) this.run();
    },
    leave(){ this.stop(); this.persist(); },
    _gen(diff){
      const {puz,sol}=sMake(diff);
      this.grid=puz.slice(); this.given=puz.map(v=>!!v); this.sol=sol;
      this.notes=Array.from({length:81},()=>[]); this.sel=-1; this.done=false; this.elapsed=0; this.diff=diff;
      this.persist();
    },
    newGame(diff, force){
      const needConfirm = !force && !this.done;
      if(needConfirm && this.pendDiff!==diff){
        this.pendDiff=diff; clearTimeout(this.pendT);
        this.pendT=setTimeout(()=>{this.pendDiff=null;},2500);
        toast('Tap again to start a new '+diff+' game');
        return;
      }
      this.pendDiff=null; clearTimeout(this.pendT);
      this.stop(); this._gen(diff); this.render();
      $('sdk-banner').classList.add('hide'); this.run();
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
      $('sdk-meta').textContent = this.diff.replace(/^./,m=>m.toUpperCase())+' · '+fmt(this.elapsed);
    },
    checkDone(){
      if(this.grid.includes(0)) return;
      for(let i=0;i<81;i++) if(this.grid[i]!==this.sol[i]){ toast('Not quite — check the reds'); return; }
      this.done=true; this.stop(); this.persist();
      // the board is about to be replaced by the next one, so the count of them
      // has to be kept somewhere that outlives it
      try{ featBump('sudoku', 10); }catch(e){}
      chime(false); buzz(120);
      showBanner('sdk-banner', 'Solved.', 'Finished in '+fmt(this.elapsed)+', across your breaks.');
    },
    run(){ this.stop(); this.tick=setInterval(()=>{ this.elapsed++; $('sdk-meta').textContent=this.diff.replace(/^./,m=>m.toUpperCase())+' · '+fmt(this.elapsed); if(this.elapsed%10===0) this.persist(); },1000); },
    stop(){ clearInterval(this.tick); this.tick=null; },
    persist(){ writeGame(this.key, {grid:this.grid,given:this.given,sol:this.sol,notes:this.notes,diff:this.diff,elapsed:this.elapsed,done:this.done}); },
    /* An account replaced what is in storage: drop the grid so the next
       `enter()` reads the new one instead of writing this one back. */
    forget(){ this.grid = []; this.built = false; }
  };

  forgetGame(Sudoku.key, ()=>Sudoku.forget());

  registerGame('sudoku', {
    el:'game-sudoku', title:'Sudoku', progEl:'prog-sudoku', game:()=>Sudoku,
    reset(){ Sudoku.newGame(Sudoku.diff); },
    resetNote:'A fresh grid. Anything filled in now is lost.',
    async progress(){
      const s = await readGame(Sudoku.key);
      if(!s) return 'New<span>tap to start</span>';
      if(s.done) return 'Solved<span>new game</span>';
      const filled = s.grid.filter((v,i)=>v && !s.given[i]).length;
      return filled>0 ? (filled+' filled<span>in progress</span>') : 'New<span>tap to start</span>';
    }
  });

