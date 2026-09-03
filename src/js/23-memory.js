  /* ---------------- MEMORY MATCH ---------------- */
  const Memory = {
    key:'arcade_memory', built:false, loaded:false,
    SYMBOLS:['✦','❍','▲','■','✚','◆','☾','✿'],
    cards:[], matched:[], flipped:[], moves:0, elapsed:0,
    done:false, busy:false, tick:null, day:'',

    async enter(){
      if(!this.loaded){
        const d = await readGame(this.key);
        if(d && Array.isArray(d.cards) && d.cards.length===16){
          this.cards = d.cards;
          this.matched = Array.isArray(d.matched) && d.matched.length===16
            ? d.matched : new Array(16).fill(false);
          this.moves = d.moves||0; this.elapsed = d.elapsed||0; this.done = !!d.done;
          this.day = d.day || pktNow();
        }
        this.loaded = true;
      }
      if(this.cards.length !== 16) this._new();
      this.flipped = []; this.busy = false;
      this.build();
      this.render();
      $('mem-banner').classList.toggle('hide', !this.done);
      if(this.done){ $('mem-win-sub').textContent = this._summary(); }
      else this.run();
    },
    leave(){ this.stop(); this.persist(); },

    /* Dated like the rest of the arcade, so two people get the same layout —
       see 09b-daily.js. (Memory is switched off at the bottom of this file;
       this is here so that turning it back on turns on a daily rather than a
       thing that needs converting into one.) */
    _new(day){
      this.day = day || pktNow();
      const rnd = dailyGen('memory', '', this.day);
      const deck = this.SYMBOLS.concat(this.SYMBOLS);
      for(let i=deck.length-1;i>0;i--){
        const j = rnd()*(i+1)|0;
        const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
      }
      this.cards = deck;
      this.matched = new Array(16).fill(false);
      this.flipped = []; this.moves = 0; this.elapsed = 0;
      this.done = false; this.busy = false;
    },
    newGame(day){
      this.stop(); this._new(day); this.persist(); this.render();
      $('mem-banner').classList.add('hide');
      this.run();
    },

    build(){
      if(this.built) return;
      const grid = $('mem-grid');
      grid.innerHTML = '';
      for(let i=0;i<16;i++){
        const c = document.createElement('button');
        c.className = 'mcard';
        c.type = 'button';
        c.innerHTML = '<span class="mface mback"></span><span class="mface mfront"></span>';
        c.onclick = ()=>this.flip(i);
        grid.appendChild(c);
      }
      this.built = true;
    },

    render(){
      const cells = $('mem-grid').children;
      for(let i=0;i<16;i++){
        const el = cells[i];
        if(!el) continue;
        const up = this.matched[i] || this.flipped.indexOf(i) !== -1;
        el.classList.toggle('up', up);
        el.classList.toggle('matched', !!this.matched[i]);
        el.querySelector('.mfront').textContent = this.cards[i] || '';
      }
      const pairs = this.matched.filter(Boolean).length / 2;
      $('mem-meta').textContent = pairs+'/8 · '+this.moves+' moves · '+fmt(this.elapsed);
    },

    flip(i){
      if(this.done || this.busy) return;
      if(this.matched[i] || this.flipped.indexOf(i) !== -1) return;
      if(this.flipped.length >= 2) return;

      this.flipped.push(i);
      this.render();
      if(this.flipped.length < 2) return;

      this.moves++;
      const a = this.flipped[0], b = this.flipped[1];

      if(this.cards[a] === this.cards[b]){
        this.matched[a] = true; this.matched[b] = true;
        this.flipped = [];
        this.persist(); this.render();
        if(this.matched.every(Boolean)){
          this.done = true; this.stop(); this.persist();
          dailyMark("memory", "", this.day, DAILY_DONE);
          chime(false); buzz(120);
          showBanner('mem-banner', 'All matched.', this._summary());
        }
      } else {
        this.busy = true;
        this.render();
        setTimeout(()=>{
          this.flipped = []; this.busy = false;
          this.persist(); this.render();
        }, 720);
      }
    },

    _summary(){ return 'Cleared in '+this.moves+' moves, '+fmt(this.elapsed)+'.'; },

    run(){
      this.stop();
      this.tick = setInterval(()=>{
        this.elapsed++;
        const pairs = this.matched.filter(Boolean).length / 2;
        $('mem-meta').textContent = pairs+'/8 · '+this.moves+' moves · '+fmt(this.elapsed);
        if(this.elapsed % 10 === 0) this.persist();
      }, 1000);
    },
    stop(){ clearInterval(this.tick); this.tick = null; },

    persist(){
      writeGame(this.key, {
        cards:this.cards, matched:this.matched, moves:this.moves,
        elapsed:this.elapsed, done:this.done, day:this.day
      });
    },
    forget(){ this.loaded = false; this.cards = []; }
  };

  /* Memory is switched off for now. Flip this to true and un-comment its .pcard
     in src/body/06-arcade-picker.html to bring it back — nothing else to change. */
  const MEMORY_ENABLED = false;

  forgetGame(Memory.key, ()=>Memory.forget());

  if(MEMORY_ENABLED) registerDaily('memory', {
    title:'Memory',
    diffs:[{k:'', n:'Board'}],
    open(day){ Memory.newGame(day); },
  });

  if(MEMORY_ENABLED) registerGame('memory', {
    el:'game-memory', title:'Memory', progEl:'prog-memory', game:()=>Memory,
    async progress(){
      const d = await readGame(Memory.key);
      if(!d || !d.cards) return 'New<span>tap to start</span>';
      if(d.done) return 'Cleared<span>new board</span>';
      const pairs = (d.matched||[]).filter(Boolean).length / 2;
      return pairs>0 ? (pairs+'/8<span>in progress</span>') : 'New<span>tap to start</span>';
    }
  });

