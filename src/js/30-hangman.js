  /* ---------------- HANGMAN (shared) ----------------
     One player sets a word, everybody else guesses letters against a single
     shared board and a single shared set of lives.

     Each round opens with a scramble: whoever claims it first sets the word.
     The only rule is that you can't set two rounds running, so the fastest
     finger can't hog it. Rotating the chair in a fixed order was tried first
     and was worse — it stalls the whole room on whoever happens to be next but
     has wandered off.

     The host owns the game — see the "shared games" note in 29-sync.js. Only
     the host ever holds `HM.state`; every other window holds `HM.view`, which is
     whatever the host last told it. The word itself never leaves the host until
     the round is over, so a guesser cannot read it out of the wire.

     There is deliberately no solo mode. The picker card says so and offers the
     Focus together screen instead. */

  const HM_LIVES = 8;               // matches the eight limbs in the drawing
  const HM_ALPHA = 'abcdefghijklmnopqrstuvwxyz';
  /* Laid out the way a keyboard is, not the way the alphabet is — people hunt
     for a letter by muscle memory, and A-to-Z makes them read every key. */
  const QWERTY = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const HM_MAX = 15;                // characters, not letters — the board is one line
  const HM_MISS = 1;                // points a wrong letter costs the guesser

  /* Spaces, hyphens and apostrophes are shown from the start. They're part of
     the answer but nobody guesses punctuation, and hiding them makes a phrase
     unreadable. Everything else is stripped. */
  const HM_KEEP = /[a-z '\-]/;
  function hmClean(raw){
    return String(raw||'').toLowerCase()
      .replace(/[\u2018\u2019]/g, "'")
      .split('').filter(c=>HM_KEEP.test(c)).join('')
      .replace(/\s+/g,' ').trim().slice(0, HM_MAX);
  }
  function hmLetters(w){ return String(w||'').split('').filter(c=>HM_ALPHA.indexOf(c) >= 0); }

  const Hangman = {
    key:'hangman',
    view:null,          // what to draw — every window has one
    state:null,         // the truth — the host only
    built:false,

    /* ---- entering and leaving ---- */
    enter(){
      this.build();
      if(syncActive() && !syncIsHost()) syncGameSend(this.key, {a:'look'});
      if(syncIsHost()) Hangman._ensure();
      this.render();
    },
    leave(){},

    build(){
      if(this.built) return;
      const keys = $('hm-keys');
      keys.innerHTML = QWERTY.map(row=>
        '<div class="hm-row">' + row.split('').map(c=>
          '<button class="hm-key" data-k="'+c+'">'+c+'</button>').join('') + '</div>').join('');
      keys.onclick = (e)=>{
        const b = e.target.closest('[data-k]');
        if(b && !b.disabled) Hangman.guess(b.dataset.k);
      };
      $('hm-go').onclick = ()=>Hangman.setWord();
      $('hm-word-in').addEventListener('keydown', e=>{
        if(e.key === 'Enter'){ e.preventDefault(); Hangman.setWord(); }
      });
      $('hm-hint-in').addEventListener('keydown', e=>{
        if(e.key === 'Enter'){ e.preventDefault(); Hangman.setWord(); }
      });
      $('hm-take').onclick = ()=>syncGameSend(this.key, {a:'claim'});
      $('hm-next').onclick = ()=>syncGameSend(this.key, {a:'next'});
      $('hm-need-go').onclick = ()=>{ Arcade.close(); syncOpen(); };

      // Resetting lives on the game's card in the arcade, not in here — see the
      // note in 32-scrabble.js. Same gesture, one place, no competition with the
      // letter keys.
      this.built = true;
    },

    /* ---- what this window sends ---- */
    guess(ch){
      const v = this.view;
      if(!v || v.phase !== 'playing' || v.iAmSetter) return;
      ch = String(ch||'').toLowerCase();
      if(HM_ALPHA.indexOf(ch) < 0) return;
      if(v.tried.some(t=>t.ch === ch)) return;
      syncGameSend(this.key, {a:'guess', ch});
    },
    setWord(){
      const word = hmClean($('hm-word-in').value);
      if(hmLetters(word).length < 3){ toast('Three letters or more'); return; }
      if(word.length > HM_MAX){ toast('Fifteen characters at most'); return; }
      syncGameSend(this.key, {a:'set', word, hint:($('hm-hint-in').value||'').slice(0,40)});
      $('hm-word-in').value = ''; $('hm-hint-in').value = '';
    },

    /* ================= host side =================
       Everything below here only ever runs in the host's window. */

    _blank(){
      return {
        round:0, setter:null, lastSetter:null, word:'', hint:'',
        tried:[], wrong:0, over:null, scores:{},
      };
    },

    /** Everyone allowed to claim this round: anyone but whoever set the last one. */
    _eligible(seats){
      const st = this.state;
      const open = seats.filter(s=>s.id !== st.lastSetter);
      return open.length ? open : seats;     // alone in the room, set as often as you like
    },

    /** Make sure there is a game, and that it hasn't been left mid-round by a leaver. */
    _ensure(){
      if(!syncIsHost()) return;
      const seats = syncSeats();
      if(!seats.length) return;
      if(!this.state) this.state = this._blank();
      const st = this.state;

      for(const s of seats) if(!st.scores[s.id]) st.scores[s.id] = 0;
      for(const id in st.scores) if(!seats.some(s=>s.id === id)) delete st.scores[id];

      // Setter walked off mid-round? Abandon it rather than sit on a word nobody
      // can vouch for, and throw the next one open again.
      if(st.setter && !seats.some(s=>s.id === st.setter)) this._open();
      this._push();
    },

    /** Throw the round open for whoever claims it first. */
    _open(){
      const st = this.state;
      st.setter = null; st.word = ''; st.hint = '';
      st.tried = []; st.wrong = 0; st.over = null;
    },

    _next(){
      const st = this.state;
      st.round++;
      st.lastSetter = st.setter;
      this._open();
      this._push();
    },

    _mask(){
      const st = this.state;
      const got = new Set(st.tried.filter(t=>t.hit).map(t=>t.ch));
      return st.word.split('').map(c=>{
        if(HM_ALPHA.indexOf(c) < 0) return c;          // punctuation is never hidden
        return (st.over === 'lost' || got.has(c)) ? c : '';
      });
    },

    /** Everyone gets the same board; only the setter is told they're the setter,
        and only when the round is over does the answer travel at all. */
    _viewFor(id){
      const st = this.state;
      if(!st) return null;
      const seats = syncSeats();
      const name = who => (seats.find(s=>s.id === who) || {}).name || 'Someone';
      return {
        round:st.round,
        phase: st.over ? 'over' : !st.setter ? 'claim' : (st.word ? 'playing' : 'setting'),
        iAmSetter: id === st.setter,
        canClaim: !st.setter && this._eligible(seats).some(s=>s.id === id),
        setterName: st.setter ? name(st.setter) : '',
        mask: st.word ? this._mask() : [],
        tried: st.tried.map(t=>({ch:t.ch, hit:t.hit})),
        wrong: st.wrong, lives: HM_LIVES,
        hint: st.hint,
        over: st.over,
        answer: st.over ? st.word : '',
        alone: seats.length < 2,
        players: seats.map(s=>({
          id:s.id, name:s.name, pts:st.scores[s.id]||0,
          setter:s.id === st.setter, me:s.id === id,
          justSet:s.id === st.lastSetter,
        })),
      };
    },

    _push(){ syncGamePushAll(this.key, id=>this._viewFor(id)); },

    _intent(from, m){
      if(!syncIsHost() || !m) return;
      this._ensure();
      const st = this.state;
      if(!st) return;

      if(m.a === 'look'){ syncGamePush(this.key, from, this._viewFor(from)); return; }

      // First claim wins. Everything after it is a no-op, which is the whole
      // race — two people pressing at once resolve by arrival order at the host.
      if(m.a === 'claim'){
        if(st.setter || st.over) return;
        if(!this._eligible(syncSeats()).some(s=>s.id === from)) return;
        st.setter = from;
        this._push();
        return;
      }

      if(m.a === 'set'){
        if(from !== st.setter || st.word) return;
        const w = hmClean(m.word);
        if(hmLetters(w).length < 3 || w.length > HM_MAX) return;
        st.word = w;
        st.hint = String(m.hint||'').slice(0,40);
        st.tried = []; st.wrong = 0; st.over = null;
        this._push();
        return;
      }

      if(m.a === 'guess'){
        if(st.over || !st.word) return;
        if(from === st.setter) return;                 // no marking your own homework
        const ch = String(m.ch||'').toLowerCase();
        if(HM_ALPHA.indexOf(ch) < 0) return;
        if(st.tried.some(t=>t.ch === ch)) return;

        const hit = st.word.indexOf(ch) >= 0;
        st.tried.push({ch, hit, by:from});
        // A wrong letter costs the guesser a point, but a score never goes
        // below zero — going negative reads as a punishment rather than a game.
        st.scores[from] = hit
          ? (st.scores[from]||0) + 1
          : Math.max(0, (st.scores[from]||0) - HM_MISS);
        if(!hit) st.wrong++;

        const got = new Set(st.tried.filter(t=>t.hit).map(t=>t.ch));
        if(hmLetters(st.word).every(c=>got.has(c))) st.over = 'won';
        else if(st.wrong >= HM_LIVES){
          st.over = 'lost';
          st.scores[st.setter] = (st.scores[st.setter]||0) + 3;
        }
        this._push();
        return;
      }

      if(m.a === 'next'){
        if(!st.over) return;
        this._next();
        return;
      }

      // Only the timer holder can wipe the game, and the host is what enforces
      // that — the menu being hidden elsewhere is a convenience, not the rule.
      if(m.a === 'reset'){
        if(from !== SYNC.leaderId) return;
        this.state = this._blank();
        this._ensure();
      }
    },

    /* ================= drawing =================
       Runs in every window, from the view the host sent. */

    apply(v){
      const before = this.view;
      this.view = v;
      // scores are the host's to keep and are wiped with the game, so forty of
      // them is a moment rather than a state — written down as it goes past
      try{
        const me = v && v.players && v.players.find(p=>p.me);
        if(me && me.pts >= 40) featMark('hm40');
      }catch(e){}
      if(Arcade.open && Arcade.active === 'hangman') this.render();
      if(v && v.over && (!before || !before.over)) this._cheer(v);
      try{ Arcade._refresh(); }catch(e){}
    },

    _cheer(v){
      const won = v.over === 'won';
      if(won && !v.iAmSetter){
        chime(false);
        showBanner('hm-banner', 'Got it.', 'The word was “'+v.answer+'”.');
      }else if(!won && v.iAmSetter){
        chime(false);
        showBanner('hm-banner', 'They never found it.', '“'+v.answer+'” stays yours.');
      }
      setTimeout(()=>{ const b=$('hm-banner'); if(b) b.classList.add('hide'); }, 3600);
    },

    render(){
      if(!$('hm-live')) return;
      const v = this.view;
      const inRoom = syncActive();

      $('hm-need').classList.toggle('hide', inRoom);
      $('hm-live').classList.toggle('hide', !inRoom || !v);
      $('hm-next').classList.toggle('hide', !(v && v.phase === 'over'));
      $('hm-meta').textContent = v ? 'Round '+(v.round+1) : '';
      if(!inRoom || !v) return;

      // the drawing
      const parts = $('hm-draw').querySelectorAll('.hm-p');
      parts.forEach(g=>g.classList.toggle('on', Number(g.dataset.p) <= v.wrong));

      // who you are and how much rope is left
      $('hm-role').textContent = v.alone
        ? 'Nobody else is here yet'
        : v.phase === 'claim'
          ? (v.canClaim ? 'Up for grabs — first to claim sets it'
                        : 'You set the last one. Somebody else’s turn.')
        : v.iAmSetter
          ? (v.phase === 'setting' ? 'Your word to set' : 'They’re guessing yours')
          : 'Guessing ' + v.setterName + '’s word';
      $('hm-lives').textContent = (v.phase === 'claim' || v.phase === 'setting')
        ? '' : (v.lives - v.wrong) + ' of ' + v.lives + ' left';

      $('hm-scores').innerHTML = v.players.map(p=>
        '<div class="hm-score'+(p.setter?' turn':'')+'">'
        + '<span>'+esc(p.name)+(p.me?' (you)':'')+'</span><b>'+p.pts+'</b></div>').join('');

      // the word
      const wordBox = $('hm-word');
      if(v.phase === 'claim' || v.phase === 'setting'){
        wordBox.innerHTML = '';
      }else{
        const missed = v.over === 'lost'
          ? new Set(v.tried.filter(t=>t.hit).map(t=>t.ch)) : null;
        wordBox.innerHTML = v.mask.map(c=>{
          if(!c) return '<span class="hm-let"></span>';
          if(c === ' ') return '<span class="hm-let gap"></span>';
          // Punctuation was never hidden, so it is never right or wrong —
          // it just sits there being part of the answer.
          if(HM_ALPHA.indexOf(c) < 0) return '<span class="hm-let punct">'+esc(c)+'</span>';
          const bad = missed && !missed.has(c);
          return '<span class="hm-let '+(bad?'miss':'got')+'">'+esc(c)+'</span>';
        }).join('');
        // Long answers shrink rather than wrapping — a hangman board that runs
        // onto a second line stops reading as one word.
        wordBox.dataset.len = v.mask.length > 11 ? 'long' : v.mask.length > 8 ? 'mid' : '';
      }
      $('hm-hint').textContent = (v.phase === 'playing' || v.phase === 'over') && v.hint
        ? '“'+v.hint+'”' : '';

      // claiming the round, and the setter's box
      $('hm-claim').classList.toggle('hide', !(v.phase === 'claim' && v.canClaim));
      $('hm-set').classList.toggle('hide', !(v.phase === 'setting' && v.iAmSetter));

      // the keyboard
      const canGuess = v.phase === 'playing' && !v.iAmSetter;
      $('hm-keys').classList.toggle('hide', v.phase === 'claim' || v.phase === 'setting');
      const tried = {};
      v.tried.forEach(t=>{ tried[t.ch] = t.hit; });
      $('hm-keys').querySelectorAll('[data-k]').forEach(b=>{
        const k = b.dataset.k, done = k in tried;
        b.classList.toggle('hit', done && tried[k]);
        b.classList.toggle('miss', done && !tried[k]);
        b.disabled = !canGuess || done;
      });

      $('hm-msg').textContent =
        v.alone ? 'Share your code from Focus together and they can join in.'
        : v.phase === 'over'
          ? (v.over === 'won' ? 'Found it — the word was “'+v.answer+'”.'
                              : 'Nobody got it. It was “'+v.answer+'”.')
        : v.phase === 'claim'
          ? (v.canClaim ? 'Whoever claims it first sets the word.'
                        : 'Waiting for somebody to claim this one.')
        : v.phase === 'setting'
          ? (v.iAmSetter ? 'Letters only. They see the length, not the word.'
                         : 'Waiting for '+v.setterName+' to think of one.')
        : v.iAmSetter ? 'Sit tight — you can’t guess your own word.' : '';
    },
  };

  syncGameRegister('hangman', {
    intent(from, m){ Hangman._intent(from, m); },
    apply(v){ Hangman.apply(v); },
    roster(){ Hangman._ensure(); },
    /* The board travels when the room does — see the handover note in
       29-sync.js. Nothing here needs converting: it is keyed by peer id, and a
       peer id belongs to the person now, not to the room. */
    save(){ return Hangman.state; },
    load(s){ Hangman.state = s; Hangman._ensure(); },
  });

  document.addEventListener('keydown', e=>{
    if(!Arcade.open || Arcade.active !== 'hangman') return;
    if(e.metaKey || e.ctrlKey || e.altKey) return;
    if(document.activeElement && document.activeElement.tagName === 'INPUT') return;
    if(/^[a-zA-Z]$/.test(e.key)){ e.preventDefault(); Hangman.guess(e.key.toLowerCase()); }
  });

  registerGame('hangman', {
    el:'game-hangman', title:'Hangman', progEl:'prog-hangman', game:()=>Hangman,
    canReset:()=>syncIsLeader(),
    reset(){ syncGameSend(Hangman.key, {a:'reset'}); },
    resetNote:'Scores go back to zero for everyone and the round is thrown open.',
    async progress(){
      if(!syncActive()) return 'Room<span>needs a room</span>';
      const v = Hangman.view;
      if(!v || v.alone) return 'Ready<span>waiting</span>';
      if(v.phase === 'claim') return 'Open<span>claim to set</span>';
      if(v.phase === 'setting') return 'Setting<span>'+esc(v.setterName)+'</span>';
      if(v.phase === 'over') return 'Done<span>next round</span>';
      return (v.lives - v.wrong)+'<span>lives left</span>';
    }
  });

