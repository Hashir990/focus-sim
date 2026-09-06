  WORDS.forEach(w=>WVALID.add(w));

  function wScore(guess,ans){
    const res=Array(5).fill('x'), cnt={};
    for(const ch of ans) cnt[ch]=(cnt[ch]||0)+1;
    for(let i=0;i<5;i++) if(guess[i]===ans[i]){ res[i]='g'; cnt[guess[i]]--; }
    for(let i=0;i<5;i++) if(res[i]==='x'&&cnt[guess[i]]>0){ res[i]='y'; cnt[guess[i]]--; }
    return res;
  }

  const Wordle = {
    skey:'arcade_wordle', built:false, tiles:[], keys:{},
    answer:'', guesses:[], cur:'', done:false, won:false,
    /* Which dated edition is on the board; a save from before there were
       editions is adopted as today's rather than thrown away. */
    day:'',
    async enter(){
      if(!this.answer){
        const d=await readGame(this.skey);
        if(d){ Object.assign(this,{answer:d.answer,guesses:d.guesses||[],done:!!d.done,won:!!d.won,cur:'',day:d.day||pktNow()}); }
        else this._new(pktNow());
      }
      /* Finished an older one and today's is untouched: hand over today's.
         A word still being guessed is never taken away. */
      if(this.done && this.day !== pktNow() && !dailyPlayed('wordle', '')){
        this._new(pktNow());
      }
      this.build(); this.render(); this._banner();
    },
    leave(){ this.persist(); },
    /** **The same word for everybody, chosen by the date.** It was
        `WORDS[Math.random()*…]`, which is precisely why no two people could
        compare a result. The generator is seeded from the day; see 09b-daily.js. */
    _new(day){
      const d = day || pktNow();
      this.answer=WORDS[dailyGen('wordle', '', d)()*WORDS.length|0];
      this.guesses=[]; this.cur=''; this.done=false; this.won=false; this.day=d;
      this.persist();
      dailyMark('wordle', '', d, DAILY_STARTED);
    },
    newGame(day){
      if(!day && dailyPlayed('wordle', '')){
        toast('Today\u2019s word is done');
        dailyCalOpen('wordle');
        return;
      }
      this._new(day || pktNow()); this.render(); $('wdl-banner').classList.add('hide');
    },
    build(){
      const b=$('wdl-board'); b.innerHTML=''; this.tiles=[];
      for(let r=0;r<6;r++){ const row=document.createElement('div'); row.className='wrow'; const rr=[]; for(let c=0;c<5;c++){ const t=document.createElement('div'); t.className='wtile'; row.appendChild(t); rr.push(t);} b.appendChild(row); this.tiles.push(rr); }
      const kb=$('wdl-kbd'); kb.innerHTML=''; this.keys={};
      const rows=['qwertyuiop','asdfghjkl','\u21b5zxcvbnm\u232b'];
      rows.forEach(rs=>{ const row=document.createElement('div'); row.className='krow';
        for(const ch of rs){ const k=document.createElement('button'); k.className='key';
          if(ch==='\u21b5'){ k.classList.add('wide'); k.textContent='Enter'; k.onclick=()=>this.key('enter'); }
          else if(ch==='\u232b'){ k.classList.add('wide'); k.textContent='Del'; k.onclick=()=>this.key('back'); }
          else { k.textContent=ch; this.keys[ch]=k; k.onclick=()=>this.key(ch); }
          row.appendChild(k);
        }
        kb.appendChild(row);
      });
    },
    key(k){
      if(this.done) return;
      if(k==='enter') return this.submit();
      if(k==='back'){ this.cur=this.cur.slice(0,-1); return this.render(); }
      if(/^[a-z]$/.test(k) && this.cur.length<5){ this.cur+=k; this.render(); }
    },
    submit(){
      if(this.cur.length<5){ toast('Not enough letters'); return; }
      if(!WVALID.has(this.cur)){ toast('Not in word list'); return; }
      this.guesses.push(this.cur);
      if(this.cur===this.answer){ this.won=true; this.done=true; }
      else if(this.guesses.length>=6){ this.done=true; }
      this.cur=''; this.persist(); this.render();
      /* Out of guesses counts as played: the word is spent either way, and a
         calendar that only marked wins would read as "never opened". */
      /* **The picture, not just the count.** Five characters a guess — `g`
         green, `y` yellow, `x` grey — which is exactly what `wScore` already
         works out for the tiles, and is the one thing about a finished word
         that cannot be reconstructed from a number afterwards. */
      if(this.done) dailyMark('wordle', '', this.day, DAILY_DONE,
        {g:this.guesses.length, w:this.won ? 1 : 0, p:this._pattern()});
      if(this.done){ chime(false); if(this.won) buzz(120); this._banner(this.won); }
    },
    render(){
      for(let r=0;r<6;r++){
        const guess = this.guesses[r];
        const active = r===this.guesses.length && !this.done;
        for(let c=0;c<5;c++){
          const t=this.tiles[r][c]; t.className='wtile';
          if(guess){ const st=wScore(guess,this.answer); t.textContent=guess[c].toUpperCase(); t.classList.add(st[c]); }
          else if(active && c<this.cur.length){ t.textContent=this.cur[c].toUpperCase(); t.classList.add('filled'); }
          else t.textContent='';
        }
      }
      // keyboard colors
      const best={};
      for(const g of this.guesses){ const st=wScore(g,this.answer); for(let i=0;i<5;i++){ const ch=g[i], s=st[i]; const rank={x:0,y:1,g:2}; if(!best[ch]||rank[s]>rank[best[ch]]) best[ch]=s; } }
      for(const ch in this.keys){ this.keys[ch].className='key'; if(best[ch]) this.keys[ch].classList.add(best[ch]); }
      $('wdl-meta').textContent = this.done ? (this.won?'Solved':'Missed') : (this.guesses.length+'/6');
      dailyStreakPaint('wdl-streak', 'wordle');
    },
    // justWon is only true on the guess that ends the game, so re-opening a
    // finished board doesn't fire the confetti again.
    /** The grid of squares, as one string. */
    _pattern(){
      return this.guesses.map(g=>wScore(g, this.answer).join('')).join('');
    },
    _banner(justWon){
      const bn=$('wdl-banner');
      if(!this.done){ bn.classList.add('hide'); return; }
      const title = this.won ? 'Nice.' : 'So close.';
      const sub = this.won
        ? ('Found it in '+this.guesses.length+'/6.')
        : ('The word was '+this.answer.toUpperCase()+'.');

      if(justWon && this.won){ showBanner('wdl-banner', title, sub); return; }
      $('wdl-win-title').textContent = title;
      $('wdl-win-sub').textContent = sub;
      bn.classList.remove('hide');
    },
    persist(){ writeGame(this.skey, {answer:this.answer,guesses:this.guesses,done:this.done,won:this.won,day:this.day}); },
    forget(){ this.answer = ''; this.guesses = []; this.cur = ''; }
  };

  // physical keyboard for wordle
  document.addEventListener('keydown', e=>{
    if(!Arcade.open || Arcade.active!=='wordle') return;
    if(e.key==='Enter') Wordle.key('enter');
    else if(e.key==='Backspace') Wordle.key('back');
    else if(/^[a-zA-Z]$/.test(e.key)) Wordle.key(e.key.toLowerCase());
  });

  forgetGame(Wordle.skey, ()=>Wordle.forget());

  registerDaily('wordle', {
    title:'Word guess',
    diffs:[{k:'', n:'Word'}],
    open(day){ Wordle.newGame(day); },
    /* What one day's line says on the calendar, in place of repeating the
       word "Word" down the page. */
    line(rec){
      if(!rec) return '';
      if(rec.s !== 2) return 'Started';
      return rec.w ? ('Found in ' + (rec.g || '?') + '/6') : 'Missed';
    },
    /* The grid, drawn from the five-characters-a-guess string. This is the
       picture people screenshot: it says how close each try was without ever
       giving away the word. */
    art(rec){
      const p = rec && rec.p;
      if(typeof p !== 'string' || p.length < 5) return '';
      /* **All six rows, always.** It used to stop where the word was found, so
         a lucky first guess drew one row and a six-guess grind drew six — and
         the short one read as a *worse* day, because on a calendar the eye
         compares heights before it reads anything. The tries you did not need
         are the whole point of finding it in one, so they are drawn: empty, and
         dimmer than an unfilled square, which is what says "spare" rather than
         "wrong". */
      let out = '<div class="wdl-art" aria-hidden="true">';
      const rows = Math.min(6, Math.max(1, Math.ceil(p.length / 5)));
      for(let i = 0; i + 5 <= p.length; i += 5){
        out += '<div class="wdl-art-row">';
        for(let k = 0; k < 5; k++){
          const c = p[i + k];
          out += '<i class="' + (c === 'g' ? 'hit' : c === 'y' ? 'near' : '') + '"></i>';
        }
        out += '</div>';
      }
      for(let r = rows; r < 6; r++){
        out += '<div class="wdl-art-row spare"><i></i><i></i><i></i><i></i><i></i></div>';
      }
      return out + '</div>';
    },
    stats(all){
      const done = all.filter(r=>r.s === 2);
      const won = done.filter(r=>r.w);
      const avg = won.length ? (won.reduce((n,r)=>n + (r.g || 0), 0) / won.length) : 0;
      return [
        {v:String(dailyStreak('wordle', '')), n:'streak'},
        {v:String(won.length), n:'found'},
        {v:avg ? avg.toFixed(1) : '—', n:'guesses'},
      ];
    },
  });

  registerGame('wordle', {
    el:'game-wordle', title:'Word guess', progEl:'prog-wordle', game:()=>Wordle,
    /* No reset: the day's word is guessed once and the result is kept. */
    async progress(){
      const w = await readGame(Wordle.skey);
      if(!w) return 'New<span>tap to start</span>';
      if(w.done) return w.won ? 'Found<span>see history</span>' : 'Missed<span>see history</span>';
      return (w.guesses.length)+'/6<span>in progress</span>';
    }
  });

