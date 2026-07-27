  /* ---------------- CROSSWORD ----------------
     The puzzle is built at run time: words are laid down one at a time, each
     crossing a word already on the grid, so every intersection is guaranteed to
     agree. That means no hand-drawn grids to get wrong, and a fresh puzzle every
     game. Placement rules are the standard ones — a new word may only touch the
     existing fill at its crossing squares, never alongside them. */

  function crossShuffle(a){
    const out = a.slice();
    for(let i=out.length-1;i>0;i--){ const j=Math.random()*(i+1)|0; const t=out[i]; out[i]=out[j]; out[j]=t; }
    return out;
  }

  /** Attempt one full layout. Returns {cells:Map, placed:[...]} or null. */
  function crossAttempt(bank, want, maxSide){
    const cells = new Map();                       // "r,c" -> letter
    const at = (r,c)=>cells.get(r+','+c) || null;
    const placed = [];

    let minR=0, maxR=0, minC=0, maxC=0;

    /** -1 if the word can't go here, otherwise how many squares it crosses. */
    const fits = (word, r, c, dir)=>{
      const dr = dir==='down' ? 1 : 0, dc = dir==='across' ? 1 : 0;
      // squares immediately before and after must be empty
      if(at(r-dr, c-dc)) return -1;
      if(at(r+dr*word.length, c+dc*word.length)) return -1;
      let crossings = 0;
      for(let i=0;i<word.length;i++){
        const rr = r+dr*i, cc = c+dc*i;
        const cur = at(rr,cc);
        if(cur){
          if(cur !== word[i]) return -1;
          crossings++;
        }else{
          // an empty square we're filling may not have neighbours on the
          // perpendicular axis, or we'd create an unintended word
          if(dir==='across'){ if(at(rr-1,cc) || at(rr+1,cc)) return -1; }
          else { if(at(rr,cc-1) || at(rr,cc+1)) return -1; }
        }
      }
      return crossings > 0 ? crossings : -1;
    };

    const put = (word, clue, r, c, dir)=>{
      const dr = dir==='down' ? 1 : 0, dc = dir==='across' ? 1 : 0;
      for(let i=0;i<word.length;i++) cells.set((r+dr*i)+','+(c+dc*i), word[i]);
      placed.push({word, clue, r, c, dir});
      minR = Math.min(minR, r); maxR = Math.max(maxR, r + dr*(word.length-1));
      minC = Math.min(minC, c); maxC = Math.max(maxC, c + dc*(word.length-1));
    };

    // The longest word forms the spine; the rest stay shuffled rather than sorted
    // by length. Feeding them longest-first meant only the long words ever got
    // used, which is what made the hard grids so wide.
    const pool = crossShuffle(bank).slice(0, Math.max(want*4, want+14));
    pool.sort((a,b)=>b[0].length-a[0].length);
    const order = [pool[0]].concat(crossShuffle(pool.slice(1)));

    put(order[0][0], order[0][1], 0, 0, 'across');

    for(let p=1; p<order.length && placed.length<want; p++){
      const [word, clue] = order[p];
      if(placed.some(e=>e.word===word)) continue;
      // Score every legal spot and take the tightest. Picking at random here is
      // what produced those sprawling 25-square grids: compactness has to be
      // chosen for, not hoped for.
      let bestSpot = null, bestScore = Infinity;
      for(const e of placed){
        const dr = e.dir==='down' ? 1 : 0, dc = e.dir==='across' ? 1 : 0;
        const dir = e.dir==='across' ? 'down' : 'across';
        for(let i=0;i<e.word.length;i++){
          if(word.indexOf(e.word[i]) === -1) continue;
          for(let k=word.indexOf(e.word[i]); k!==-1; k=word.indexOf(e.word[i], k+1)){
            const rr = e.r + dr*i - (dir==='down' ? k : 0);
            const cc = e.c + dc*i - (dir==='across' ? k : 0);
            const crossings = fits(word, rr, cc, dir);
            if(crossings < 0) continue;
            const er = rr + (dir==='down' ? word.length-1 : 0);
            const ec = cc + (dir==='across' ? word.length-1 : 0);
            const h = Math.max(maxR, er) - Math.min(minR, rr) + 1;
            const w = Math.max(maxC, ec) - Math.min(minC, cc) + 1;
            if(Math.max(h,w) > maxSide) continue;      // hard ceiling on grid size
            // squareness first, then total area, then reward extra crossings
            const score = Math.max(h,w)*400 + h*w - crossings*30 + Math.random()*8;
            if(score < bestScore){ bestScore = score; bestSpot = [rr,cc,dir]; }
          }
        }
      }
      if(!bestSpot) continue;
      put(word, clue, bestSpot[0], bestSpot[1], bestSpot[2]);
    }

    return placed.length >= 4 ? {cells, placed} : null;
  }

  /** Build a finished puzzle: normalised grid, numbering and clue entries. */
  function crossBuild(diff){
    const bank = CROSS_BANK[diff] || CROSS_BANK.easy;
    const cfg = CROSS_SETTINGS[diff] || CROSS_SETTINGS.easy;

    let best = null;
    for(let t=0;t<cfg.tries;t++){
      const r = crossAttempt(bank, cfg.words, cfg.maxSide);
      if(r && (!best || r.placed.length > best.placed.length)) best = r;
      if(best && best.placed.length >= cfg.words) break;
    }
    if(!best) return null;

    // normalise coordinates to a 0-based square grid
    let minR=Infinity, maxR=-Infinity, minC=Infinity, maxC=-Infinity;
    for(const k of best.cells.keys()){
      const [r,c] = k.split(',').map(Number);
      if(r<minR) minR=r; if(r>maxR) maxR=r;
      if(c<minC) minC=c; if(c>maxC) maxC=c;
    }
    const rows = maxR-minR+1, cols = maxC-minC+1;
    const size = Math.max(rows, cols);
    const sol = new Array(size*size).fill(null);
    for(const [k,v] of best.cells){
      const [r,c] = k.split(',').map(Number);
      sol[(r-minR)*size + (c-minC)] = v;
    }

    // standard numbering: a square starts an entry if it has no filled neighbour
    // above (down) or to its left (across), and a run of 2+ follows
    const num = new Array(size*size).fill(0);
    const entries = [];
    let n = 0;
    const solAt = (r,c)=> (r<0||c<0||r>=size||c>=size) ? null : sol[r*size+c];
    for(let r=0;r<size;r++){
      for(let c=0;c<size;c++){
        if(!solAt(r,c)) continue;
        const startsAcross = !solAt(r,c-1) && !!solAt(r,c+1);
        const startsDown   = !solAt(r-1,c) && !!solAt(r+1,c);
        if(!startsAcross && !startsDown) continue;
        n++;
        num[r*size+c] = n;
        if(startsAcross){
          const idx=[]; let cc=c;
          while(solAt(r,cc)){ idx.push(r*size+cc); cc++; }
          entries.push({num:n, dir:'across', cells:idx, answer:idx.map(i=>sol[i]).join('')});
        }
        if(startsDown){
          const idx=[]; let rr=r;
          while(solAt(rr,c)){ idx.push(rr*size+c); rr++; }
          entries.push({num:n, dir:'down', cells:idx, answer:idx.map(i=>sol[i]).join('')});
        }
      }
    }

    // attach clues by matching each entry's answer to a placed word
    const byWord = {};
    for(const p of best.placed) byWord[p.word] = p.clue;
    for(const e of entries){
      e.clue = byWord[e.answer] || null;
    }
    // an entry with no clue means the layout produced an unintended word — reject
    if(entries.some(e=>!e.clue)) return null;

    return {size, sol, num, entries, diff};
  }

  function crossGenerate(diff){
    for(let i=0;i<25;i++){
      const p = crossBuild(diff);
      if(p && p.entries.length >= 5) return p;
    }
    return crossBuild(diff);
  }

  const Cross = {
    key:'arcade_cross', built:false, loaded:false,
    diff:'easy', puz:null, user:[], sel:-1, dir:'across',
    done:false, elapsed:0, tick:null, wrong:null,

    async enter(){
      if(!this.loaded){
        const d = await readGame(this.key);
        if(d && d.puz && d.puz.sol){
          this.puz = d.puz; this.user = d.user || [];
          this.diff = d.diff || 'easy'; this.elapsed = d.elapsed || 0; this.done = !!d.done;
        }
        this.loaded = true;
      }
      if(!this.puz) this._new(this.diff);
      this.build();
      this.render();
      $('cw-banner').classList.toggle('hide', !this.done);
      if(this.done) $('cw-win-sub').textContent = this._summary();
      else this.run();
    },
    leave(){ this.stop(); this.persist(); },

    _new(diff){
      this.diff = diff || this.diff;
      const p = crossGenerate(this.diff);
      if(!p){ toast('Could not build a puzzle — try again'); return; }
      this.puz = p;
      this.user = new Array(p.size*p.size).fill('');
      this.sel = p.entries[0] ? p.entries[0].cells[0] : -1;
      this.dir = 'across';
      this.done = false; this.elapsed = 0; this.wrong = null;
    },
    newGame(diff){
      this.stop();
      this._new(diff);
      this.persist();
      this.built = false;      // grid dimensions change, so rebuild the DOM
      this.build();
      this.render();
      $('cw-banner').classList.add('hide');
      this.run();
    },

    build(){
      if(this.built || !this.puz) return;
      const p = this.puz;
      const grid = $('cw-grid');
      grid.innerHTML = '';
      grid.style.setProperty('--n', p.size);
      for(let i=0;i<p.size*p.size;i++){
        const d = document.createElement('div');
        if(p.sol[i]){
          d.className = 'cw-cell';
          if(p.num[i]) d.innerHTML = '<span class="cw-num">'+p.num[i]+'</span><span class="cw-let"></span>';
          else d.innerHTML = '<span class="cw-let"></span>';
          d.onclick = ()=>this.select(i);
        }else{
          d.className = 'cw-block';
        }
        grid.appendChild(d);
      }

      // difficulty buttons + on-screen letters, built once
      const bar = $('cw-ctrl');
      bar.innerHTML = '';
      [['Easy','easy'],['Med','medium'],['Hard','hard']].forEach(([label,d])=>{
        const b = document.createElement('button');
        b.className = 'mini-btn'; b.dataset.d = d; b.textContent = label;
        b.onclick = ()=>this.newGame(d);
        bar.appendChild(b);
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

    entryAt(i, dir){
      if(!this.puz) return null;
      return this.puz.entries.find(e=>e.dir===dir && e.cells.indexOf(i)!==-1) || null;
    },
    current(){
      if(this.sel<0) return null;
      return this.entryAt(this.sel, this.dir) || this.entryAt(this.sel, this.dir==='across'?'down':'across');
    },

    select(i){
      if(this.done) return;
      if(this.sel === i){
        // tapping the same square flips direction, if there is one to flip to
        const other = this.dir==='across' ? 'down' : 'across';
        if(this.entryAt(i, other)) this.dir = other;
      }else{
        this.sel = i;
        if(!this.entryAt(i, this.dir)) this.dir = this.dir==='across' ? 'down' : 'across';
      }
      this.render();
    },

    type(ch){
      if(this.done || this.sel<0) return;
      this.user[this.sel] = ch.toUpperCase();
      this.wrong = null;
      const e = this.current();
      if(e){
        const at = e.cells.indexOf(this.sel);
        if(at !== -1 && at < e.cells.length-1) this.sel = e.cells[at+1];
      }
      this.persist(); this.render(); this.checkDone();
    },
    back(){
      if(this.done || this.sel<0) return;
      this.wrong = null;
      if(this.user[this.sel]) this.user[this.sel] = '';
      else{
        const e = this.current();
        if(e){
          const at = e.cells.indexOf(this.sel);
          if(at > 0){ this.sel = e.cells[at-1]; this.user[this.sel] = ''; }
        }
      }
      this.persist(); this.render();
    },
    nextClue(step){
      const es = this.puz.entries;
      const cur = this.current();
      let k = cur ? es.indexOf(cur) : -1;
      k = (k + (step||1) + es.length) % es.length;
      this.sel = es[k].cells[0];
      this.dir = es[k].dir;
      this.render();
    },

    /** Flags every filled square that disagrees with the answer. */
    check(){
      if(this.done) return;
      const bad = [];
      for(let i=0;i<this.user.length;i++){
        if(!this.puz.sol[i] || !this.user[i]) continue;
        if(this.user[i] !== this.puz.sol[i]) bad.push(i);
      }
      const blank = this.puz.sol.filter((v,i)=>v && !this.user[i]).length;
      this.wrong = bad;
      this.render();
      if(bad.length) toast(bad.length+' wrong '+(bad.length===1?'letter':'letters'));
      else if(blank) toast('All good so far — '+blank+' left');
      else toast('All correct');
    },

    checkDone(){
      for(let i=0;i<this.puz.sol.length;i++){
        if(this.puz.sol[i] && this.user[i] !== this.puz.sol[i]) return;
      }
      this.done = true; this.stop(); this.persist();
      chime(false); buzz(120);
      showBanner('cw-banner', 'Filled in.', this._summary());
    },
    _summary(){
      return this.puz.entries.length+' clues, '+this.diff+', in '+fmt(this.elapsed)+'.';
    },

    render(){
      if(!this.puz) return;
      const p = this.puz;
      const cur = this.current();
      const inCur = cur ? cur.cells : [];
      const cells = $('cw-grid').children;

      for(let i=0;i<p.size*p.size;i++){
        const el = cells[i];
        if(!el || !p.sol[i]) continue;
        let cls = 'cw-cell';
        if(i === this.sel) cls += ' sel';
        else if(inCur.indexOf(i) !== -1) cls += ' peer';
        if(this.wrong && this.wrong.indexOf(i) !== -1) cls += ' wrong';
        el.className = cls;
        const let_ = el.querySelector('.cw-let');
        if(let_) let_.textContent = this.user[i] || '';
      }

      // clue strip: the one you're on
      $('cw-clue').textContent = cur
        ? (cur.num+' '+cur.dir+' · '+cur.clue)
        : 'Pick a square to start';

      // full clue list
      const list = $('cw-clues');
      const side = (dir, label)=>{
        const items = p.entries.filter(e=>e.dir===dir).sort((a,b)=>a.num-b.num).map(e=>{
          const filled = e.cells.every(i=>this.user[i]);
          const on = cur && cur.num===e.num && cur.dir===e.dir;
          return '<button class="cw-clue-item'+(on?' on':'')+(filled?' filled':'')+'" '
            + 'data-num="'+e.num+'" data-dir="'+e.dir+'">'
            + '<b>'+e.num+'</b><span>'+esc(e.clue)+'</span></button>';
        }).join('');
        return '<div class="cw-clue-col"><p class="q-sec">'+label+'</p>'+items+'</div>';
      };
      list.innerHTML = side('across','Across') + side('down','Down');
      list.querySelectorAll('.cw-clue-item').forEach(b=>{
        b.onclick = ()=>{
          const e = p.entries.find(x=>x.num===+b.dataset.num && x.dir===b.dataset.dir);
          if(e){ this.sel = e.cells[0]; this.dir = e.dir; this.render(); }
        };
      });

      $('cw-meta').textContent = this.diff.replace(/^./,m=>m.toUpperCase())+' · '+fmt(this.elapsed);
      document.querySelectorAll('#cw-ctrl .mini-btn').forEach(b=>b.classList.toggle('on', b.dataset.d===this.diff));
    },

    run(){
      this.stop();
      this.tick = setInterval(()=>{
        this.elapsed++;
        $('cw-meta').textContent = this.diff.replace(/^./,m=>m.toUpperCase())+' · '+fmt(this.elapsed);
        if(this.elapsed % 10 === 0) this.persist();
      }, 1000);
    },
    stop(){ clearInterval(this.tick); this.tick = null; },

    persist(){
      try{
        KV.set(this.key, JSON.stringify({
          puz:this.puz, user:this.user, diff:this.diff, elapsed:this.elapsed, done:this.done
        }));
      }catch(e){}
    }
  };

  document.addEventListener('keydown', e=>{
    if(!Arcade.open || Arcade.active!=='crossword') return;
    if(e.key === 'Backspace'){ e.preventDefault(); Cross.back(); }
    else if(e.key === 'Tab'){ e.preventDefault(); Cross.nextClue(e.shiftKey ? -1 : 1); }
    else if(e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'ArrowDown'){
      e.preventDefault();
      const want = (e.key==='ArrowRight'||e.key==='ArrowLeft') ? 'across' : 'down';
      if(Cross.dir !== want && Cross.entryAt(Cross.sel, want)){ Cross.dir = want; Cross.render(); }
      else{
        const step = (e.key==='ArrowRight'||e.key==='ArrowDown') ? 1 : -1;
        const en = Cross.current();
        if(en){
          const at = en.cells.indexOf(Cross.sel) + step;
          if(at >= 0 && at < en.cells.length){ Cross.sel = en.cells[at]; Cross.render(); }
        }
      }
    }
    else if(/^[a-zA-Z]$/.test(e.key)) Cross.type(e.key);
  });

  registerGame('crossword', {
    el:'game-crossword', title:'Crossword', progEl:'prog-crossword', game:()=>Cross,
    async progress(){
      const d = await readGame(Cross.key);
      if(!d || !d.puz) return 'New<span>tap to start</span>';
      if(d.done) return 'Filled<span>new puzzle</span>';
      const total = d.puz.sol.filter(Boolean).length;
      const got = d.puz.sol.filter((v,i)=>v && d.user && d.user[i]).length;
      return got>0 ? (got+'/'+total+'<span>'+(d.diff||'easy')+'</span>') : 'New<span>tap to start</span>';
    }
  });

