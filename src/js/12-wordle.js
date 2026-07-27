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
    async enter(){
      if(!this.answer){
        const d=await readGame(this.skey);
        if(d){ Object.assign(this,{answer:d.answer,guesses:d.guesses||[],done:!!d.done,won:!!d.won,cur:''}); }
        else this._new();
      }
      this.build(); this.render(); this._banner();
    },
    leave(){ this.persist(); },
    _new(){ this.answer=WORDS[Math.random()*WORDS.length|0]; this.guesses=[]; this.cur=''; this.done=false; this.won=false; this.persist(); },
    newGame(){ this._new(); this.render(); $('wdl-banner').classList.add('hide'); },
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
    },
    // justWon is only true on the guess that ends the game, so re-opening a
    // finished board doesn't fire the confetti again.
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
    persist(){ try{ KV.set(this.skey, JSON.stringify({answer:this.answer,guesses:this.guesses,done:this.done,won:this.won})); }catch(e){} }
  };

  // physical keyboard for wordle
  document.addEventListener('keydown', e=>{
    if(!Arcade.open || Arcade.active!=='wordle') return;
    if(e.key==='Enter') Wordle.key('enter');
    else if(e.key==='Backspace') Wordle.key('back');
    else if(/^[a-zA-Z]$/.test(e.key)) Wordle.key(e.key.toLowerCase());
  });

  registerGame('wordle', {
    el:'game-wordle', title:'Word guess', progEl:'prog-wordle', game:()=>Wordle,
    async progress(){
      const w = await readGame(Wordle.skey);
      if(!w) return 'New<span>tap to start</span>';
      if(w.done) return w.won ? 'Solved<span>new word</span>' : '—<span>new word</span>';
      return (w.guesses.length)+'/6<span>in progress</span>';
    }
  });

