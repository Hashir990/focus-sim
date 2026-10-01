  /* ---------------- MR WHITE (shared) ----------------

     A hidden-role word game for a room. Everybody but Mr White is shown the
     same word. Each of you says one thing about it — a phrase or a question,
     never the word — and then the room votes somebody out. Civilians win by
     voting out every Mr White; Mr White wins by surviving until there are as
     many of them as there are of you, or by guessing the word.

     **The whole game is one sentence long.** Say too little and you sound like
     somebody who does not know the word. Say too much and you have told Mr
     White what it is. That gap is the game: "the one you have at breakfast" is
     a hint, "bread" is a forfeit. The app collects neither — the talking
     happens in the room's chat or across the table, and all this holds is the
     clock.

     **The door shuts when the game starts.** Roles are dealt from who is in the
     room at that moment, so somebody arriving in the middle would have to be
     dealt in mid-hand or sit out a round they can see — and a room game that
     can be joined mid-hand is a room game you can lose by refreshing. The
     lobby says so, and `locked` is what the host checks.

     **The host owns it** — see "shared games" in 29-sync.js. Everybody sends
     intents and the host is the only thing that mutates state. The word is in
     the state and *not* in the view sent to Mr White: it cannot be read off the
     wire because it is not on it, the same rule the hangman answer and the
     Spymaster key follow.

     **Two Mr Whites, optionally.** With five or more in the room the leader can
     deal two, which changes the game completely: they do not know each other,
     so each has to work out whether an odd-sounding hint is a fellow imposter
     or a civilian being clumsy. Below five it is off, because two imposters in
     a room of four is a coin toss. */

  const MW_KEY = 'mrwhite';
  const MW_MIN = 3;               // below this there is no room to hide
  const MW_TWO_AT = 5;            // two imposters need somewhere to hide as well
  /* How long the room gets to talk. Longer than the old turn timer, because
     this is now a conversation rather than one person typing a line. */
  const MW_TIMES = [60, 90, 120, 180, 300];
  /* The vote has its own, short and fixed. It is one tap and at most a typed
     guess, and a five-minute talk should not mean a five-minute silence
     afterwards while everybody waits for the clock. */
  const MW_VOTE_SECS = 60;
  /* **What a turn is: a statement, a question, or one then the other.**

     Saying something about the word and asking somebody about it are two
     different games. A statement puts the weight on you: you have to produce
     something true about a word Mr White does not have. A question puts it on
     whoever you ask, and lets a clever Mr White survive a whole round without
     volunteering anything, because a question can be almost content-free and
     still sound like play.

     Alternating is the interesting one and the reason this is a setting rather
     than a rule. Rooms that always state get a slow reveal; rooms that always
     ask get a stand-off. Turn and turn about, and Mr White has to do both.

     The app does not collect any of it, so this changes nothing but what the
     room is told the round is for. That is the whole feature: four people
     across a table need to have agreed on the form before anybody speaks. */
  const MW_SAYS = ['phrase', 'ask', 'both'];
  const MW_GUESS_MAX = 60;        // characters; a guess is a word, not an essay
  /* **Three guesses each, and the third wrong one is out.** Mr White can guess
     whenever they like now, and something has to stop that from being a free
     look: without a limit the right play is to type a word every ten seconds
     until one lands. Three is enough to act on a hunch twice and be wrong, and
     few enough that the third is a real decision. */
  const MW_TRIES = 3;

  /** Who is still in. */
  function mwAlive(st){ return Object.keys(st.roles).filter(id=>st.out.indexOf(id) < 0); }
  function mwAliveWhites(st){ return mwAlive(st).filter(id=>st.roles[id] === 'white'); }

  /* **Who has won, or nobody yet.** Asked after every elimination and after a
     guess, and it is the only place the answer is decided — the host, the view
     and the tests all read it from here rather than each working it out. */
  function mwOutcome(st){
    const alive = mwAlive(st);
    const whites = alive.filter(id=>st.roles[id] === 'white').length;
    if(!whites) return {winner:'civ', why:'every Mr White is out'};
    if(whites >= alive.length - whites) return {winner:'white', why:'Mr White is not outnumbered any more'};
    return null;
  }

  /** The set with the most votes. A tie is broken by the room, not by order. */
  function mwTopSet(votes, ids){
    const n = {};
    for(const id of ids) n[votes[id]] = (n[votes[id]] || 0) + 1;
    let best = -1, top = [];
    for(const k in n){
      if(n[k] > best){ best = n[k]; top = [k]; }
      else if(n[k] === best) top.push(k);
    }
    if(!top.length || best < 1) return MW_SETS[(Math.random() * MW_SETS.length) | 0].id;
    return top[(Math.random() * top.length) | 0];
  }

  /** Who the room voted out, or null when it could not agree.

      **A tie puts nobody out**, rather than picking one of the tied. Being sent
      home by a coin toss is the one outcome nobody accepts, and a round where
      the vote splits is a real answer: the room did not know. */
  function mwTopVote(votes, alive){
    const n = {};
    for(const id of alive){ const v = votes[id]; if(v) n[v] = (n[v] || 0) + 1; }
    let best = 0, top = [];
    for(const k in n){
      if(n[k] > best){ best = n[k]; top = [k]; }
      else if(n[k] === best) top.push(k);
    }
    return top.length === 1 ? top[0] : null;
  }

  const MrWhite = {
    key:MW_KEY,
    view:null,          // what to draw — every window has one
    state:null,         // the truth — the host only
    built:false,
    tick:null,

    enter(){
      this.build();
      if(syncActive() && !syncIsHost()) syncGameSend(this.key, {a:'look'});
      if(syncIsHost()) this._ensure();
      this.render();
      this.run();
    },
    leave(){ this.stop(); },

    /* The clock is drawn from a deadline the host set, so every window counts
       down to the same instant rather than each running its own timer from
       whenever its message happened to arrive. */
    run(){ this.stop(); this.tick = setInterval(()=>this._paintClock(), 250); },
    stop(){ clearInterval(this.tick); this.tick = null; },

    build(){
      if(this.built) return;
      const send = (m)=>syncGameSend(this.key, m);
      $('mw-need-go').onclick = ()=>{ Arcade.close(); syncOpen(); };
      $('mw-start').onclick = ()=>send({a:'start'});
      $('mw-again').onclick = ()=>send({a:'reset'});
      $('mw-done').onclick = ()=>send({a:'done'});
      $('mw-guess-send').onclick = ()=>this.sendGuess();
      $('mw-guess').addEventListener('keydown', e=>{
        if(e.key === 'Enter'){ e.preventDefault(); this.sendGuess(); }
      });
      /* One handler for the whole panel rather than one per button: the lists
         are redrawn on every view and re-wiring each row every time is how a
         click ends up bound to a row that has since moved. */
      $('game-mrwhite').addEventListener('click', (e)=>{
        const b = e.target.closest && e.target.closest('[data-mw]');
        if(!b) return;
        const k = b.dataset.mw, v = b.dataset.v;
        if(k === 'set') send({a:'set', id:v});
        else if(k === 'vote') send({a:'vote', id:v});
        else if(k === 'whites') send({a:'whites', n:+v});
        else if(k === 'secs') send({a:'secs', n:+v});
        else if(k === 'say') send({a:'say', v});
      });
      this.built = true;
    },

    sendGuess(){
      const el = $('mw-guess');
      const t = (el.value || '').trim().slice(0, MW_GUESS_MAX);
      if(!t) return;
      el.value = '';
      syncGameSend(this.key, {a:'guess', t});
    },

    /* ================= host side =================
       Everything below here only ever runs in the host's window. */

    _blank(){
      return {
        phase:'lobby', game:0, locked:false,
        whites:1, secs:60, say:'phrase',
        setVotes:{}, set:'', word:'',
        roles:{}, out:[], round:0,
        votes:{}, guesses:[],
        lastOut:'', lastTie:false, lastBurn:false,
        deadline:0, winner:null, why:'',
      };
    },

    /** Make sure there is a game, and forget anybody who has gone. */
    _ensure(){
      if(!syncIsHost()) return;
      const seats = syncSeats();
      if(!seats.length) return;
      if(!this.state) this.state = this._blank();
      const st = this.state;
      const here = new Set(seats.map(s=>s.id));
      /* Somebody leaving mid-game is treated as somebody voted out: the game
         carries on without them and can end on their leaving, which is better
         than a room stuck waiting for a hint from an empty chair.

         **Only when somebody actually went.** `_ensure` runs at the top of
         every intent, and calling `_afterOut` unconditionally made every single
         message — every hint, every vote — end the round, bump the counter and
         draw a new speaker at random. Nothing errored. The game simply never
         got past its first hint, because by the time the hint arrived it was no
         longer that player's turn. */
      if(st.phase !== 'lobby' && st.phase !== 'over'){
        let gone = false;
        for(const id in st.roles){
          if(!here.has(id) && st.out.indexOf(id) < 0){ st.out.push(id); gone = true; }
        }
        if(gone) this._afterOut(st);
      }
      if(st.phase === 'lobby'){
        for(const id in st.setVotes) if(!here.has(id)) delete st.setVotes[id];
      }
      this._push();
    },

    _intent(from, m){
      if(!syncIsHost() || !m) return;
      this._ensure();
      const st = this.state;
      if(!st) return;
      const leader = from === SYNC.leaderId;
      const alive = mwAlive(st);
      const playing = alive.indexOf(from) >= 0;

      if(m.a === 'look'){ this._push(); return; }

      if(m.a === 'whites' && leader && st.phase === 'lobby'){
        const seats = syncSeats().length;
        st.whites = (m.n === 2 && seats >= MW_TWO_AT) ? 2 : 1;
      }
      else if(m.a === 'secs' && leader && st.phase === 'lobby'){
        st.secs = MW_TIMES.indexOf(+m.n) >= 0 ? +m.n : 60;
      }
      else if(m.a === 'say' && leader && st.phase === 'lobby'){
        st.say = MW_SAYS.indexOf(m.v) >= 0 ? m.v : 'phrase';
      }
      /* The set is voted on in the lobby, by everybody, and the leader starting
         the game is what finalises it. A vote you can change until the moment
         it counts is a vote people actually cast. */
      else if(m.a === 'set' && st.phase === 'lobby'){
        if(MW_SETS.some(s=>s.id === m.id)) st.setVotes[from] = m.id;
      }
      else if(m.a === 'start' && leader && (st.phase === 'lobby' || st.phase === 'over')){
        this._deal(st);
      }
      else if(m.a === 'reset' && leader){
        const keep = {whites:st.whites, secs:st.secs};
        this.state = Object.assign(this._blank(), keep);
      }
      /* **Ending the talk early.** The clock is a backstop, not a rule: a room
         that has said everything it wants to say should not have to sit and
         watch three minutes run down. The leader decides, the same person who
         starts the game. */
      else if(m.a === 'done' && leader && st.phase === 'talk'){
        this._toVote(st);
      }
      else if(m.a === 'vote' && st.phase === 'vote' && playing){
        if(alive.indexOf(m.id) >= 0) st.votes[from] = m.id;
        if(alive.every(id=>!!st.votes[id])) this._tally(st);
      }
      /* **Mr White's way out, at any point in the round.** The moment you have
         worked the word out is the moment you want to say it, and holding the
         guess back until the vote turned the best part of being Mr White into
         waiting for a panel to appear.

         What stops it being free is the count, and the silence. Three guesses,
         and the third wrong one puts you out where the vote could not — so
         guessing early is a bet rather than a free look. And a guess is not
         shown to the room until the round it was made in is over (see
         `_viewFor`): announced the instant it arrived it would be a
         confession, everybody would vote for whoever sent it, and nobody would
         guess before the vote ever again. */
      else if(m.a === 'guess' && (st.phase === 'talk' || st.phase === 'vote')
              && playing && st.roles[from] === 'white'){
        const t = String(m.t || '').trim().slice(0, MW_GUESS_MAX);
        const used = st.guesses.filter(g=>g.id === from).length;
        if(t && used < MW_TRIES){
          const right = t.toLowerCase() === st.word.toLowerCase();
          st.guesses.push({id:from, t, right, round:st.round});
          if(right){ st.phase = 'over'; st.winner = 'white'; st.why = 'Mr White guessed it'; }
          else if(used + 1 >= MW_TRIES) this._burn(st, from);
        }
      }
      this._push();
    },

    /** Deal a game from whoever is in the room right now, and shut the door. */
    _deal(st){
      const seats = syncSeats();
      if(seats.length < MW_MIN) return;
      const ids = seats.map(s=>s.id);
      const set = mwTopSet(st.setVotes, ids);
      const words = mwWords(set);
      if(!words.length) return;

      st.set = set;
      st.word = words[(Math.random() * words.length) | 0];
      st.whites = (st.whites === 2 && ids.length >= MW_TWO_AT) ? 2 : 1;

      /* Shuffled, then the first n are Mr White. Picking n at random out of the
         list instead would have to guard against picking the same person twice,
         which is the kind of loop that deals one imposter in a hundred games. */
      const bag = ids.slice();
      for(let i = bag.length - 1; i > 0; i--){
        const j = (Math.random() * (i + 1)) | 0;
        const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
      }
      st.roles = {};
      bag.forEach((id, i)=>{ st.roles[id] = i < st.whites ? 'white' : 'civ'; });

      st.locked = true;
      st.out = []; st.round = 1; st.votes = {}; st.guesses = [];
      st.lastOut = ''; st.lastTie = false; st.lastBurn = false;
      st.winner = null; st.why = '';
      st.phase = 'talk';
      st.game++;
      this._deadline(st, st.secs);
    },

    _deadline(st, secs){ st.deadline = Date.now() + secs * 1000; },

    /** Close the talking and open the vote. */
    _toVote(st){
      st.phase = 'vote';
      st.votes = {};
      this._deadline(st, MW_VOTE_SECS);
    },

    /** Out of guesses, and out of the game.

        The round is *not* restarted. `_afterOut` would bump the counter and
        hand everybody a fresh clock, and a Mr White who burns their third
        guess thirty seconds into the talk should not reset the talk for the
        four people who were mid-sentence. All that changes is one player, and
        whether that ended it. */
    _burn(st, who){
      if(st.out.indexOf(who) < 0) st.out.push(who);
      st.lastOut = who; st.lastTie = false; st.lastBurn = true;
      const done = mwOutcome(st);
      if(done){
        st.phase = 'over'; st.winner = done.winner; st.why = done.why;
        return;
      }
      /* They may have been the one vote the room was still waiting on. */
      if(st.phase === 'vote'){
        const left = mwAlive(st);
        if(left.length && left.every(id=>!!st.votes[id])) this._tally(st);
      }
    },

    /** Count the vote, put somebody out, and see whether that ended it. */
    _tally(st){
      const alive = mwAlive(st);
      /* A vote cast for somebody who has since gone — used up their guesses,
         or closed the window — is dropped rather than counted against an empty
         chair, which would otherwise put the same person "out" a second time. */
      const votes = {};
      for(const k in st.votes) if(alive.indexOf(st.votes[k]) >= 0) votes[k] = st.votes[k];
      const out = mwTopVote(votes, alive);
      st.lastOut = out || '';
      st.lastTie = !out;
      st.lastBurn = false;
      if(out) st.out.push(out);
      this._afterOut(st);
    },

    _afterOut(st){
      if(st.phase === 'lobby' || st.phase === 'over') return;
      const done = mwOutcome(st);
      if(done){
        st.phase = 'over';
        st.winner = done.winner;
        st.why = done.why;
        return;
      }
      st.round++;
      st.votes = {};
      st.phase = 'talk';
      this._deadline(st, st.secs);
    },

    /** The clock ran out. Whoever owed something is passed over rather than
        the room waiting: a player who has walked away should cost one turn,
        not the game. */
    _expire(){
      if(!syncIsHost() || !this.state) return;
      const st = this.state;
      if(st.phase !== 'talk' && st.phase !== 'vote') return;
      if(!st.deadline || Date.now() < st.deadline) return;
      if(st.phase === 'talk') this._toVote(st);
      else this._tally(st);
      this._push();
    },

    _viewFor(id){
      const st = this.state;
      if(!st) return null;
      const seats = syncSeats();
      const name = (who)=>(seats.find(s=>s.id === who) || {}).name || 'Someone';
      const alive = mwAlive(st);
      const mine = st.roles[id] || null;
      const iAmWhite = mine === 'white';
      const over = st.phase === 'over';
      const lobby = st.phase === 'lobby';

      /* **The word is not in Mr White's view.** Nor in anybody's before the
         deal, nor in a spectator's. It is the one secret this game has. */
      const seeWord = !lobby && (mine === 'civ' || over);

      return {
        phase:st.phase, game:st.game, round:st.round,
        leader: id === SYNC.leaderId, leaderName: name(SYNC.leaderId),
        enough: seats.length >= MW_MIN, seats: seats.length,
        canTwo: seats.length >= MW_TWO_AT,
        whites: st.whites, secs: st.secs, deadline: st.deadline,
        say: st.say || 'phrase',
        /* Which of the two this round is. "Both" starts on a statement,
           because a round that opens on a question has nothing to ask about
           yet. */
        saying: (st.say === 'ask' || (st.say === 'both' && st.round % 2 === 0)) ? 'ask' : 'phrase',
        sets: MW_SETS.map(s=>({
          id:s.id, name:s.name, note:s.note, n:mwWords(s.id).length,
          votes:Object.keys(st.setVotes).filter(k=>st.setVotes[k] === s.id).length,
          mine:st.setVotes[id] === s.id,
        })),
        set: st.set, setName: (MW_SETS.find(s=>s.id === st.set) || {}).name || '',
        word: seeWord ? st.word : '',
        me: mine ? {role:mine, out:st.out.indexOf(id) >= 0} : null,
        iAmWhite: iAmWhite && !over,
        players: seats.map(s=>({
          id:s.id, name:s.name, me:s.id === id,
          playing: !!st.roles[s.id],
          out: st.out.indexOf(s.id) >= 0,
          /* Roles are only ever sent once the game is over. Before that the
             only role anybody is told is their own. */
          role: over ? (st.roles[s.id] || '') : '',
          voted: st.phase === 'vote' && !!st.votes[s.id],
        })),
        talking: st.phase === 'talk',
        canEnd: id === SYNC.leaderId && st.phase === 'talk',
        myVote: st.votes[id] || '',
        canVote: st.phase === 'vote' && alive.indexOf(id) >= 0,
        /* **Your guesses are yours, and nobody else is ever sent them.** The
           list under the board is there so you are not spending your second
           try on the word you already spent your first one on. It goes to the
           person who typed it and to no other window, which is the only place
           that rule can be kept — a name filtered out in `render()` is a name
           that was still on the wire. Once the game is over there is nothing
           left to protect, and everybody gets the lot with the names on. */
        guesses: st.guesses
          .filter(g=>over || g.id === id)
          .map(g=>({
            name:name(g.id), t:g.t, right:g.right, round:g.round,
            mine:g.id === id, fresh:!over && g.round >= st.round,
          })),
        /* **What the room hears: that a guess happened, and what it was.** Not
           who made it, and not for long.

           A name attached would end the game on the spot — the room would vote
           out whoever was named and Mr White would never guess again. A guess
           the room never learns of at all takes the pressure out of the round
           the other way: the civilians would have nothing to go on but each
           other. So the word is called out once the round it was said in has
           finished, with nobody's name on it, and it is gone again the round
           after. Something everybody heard and nobody can pin on anyone. */
        heard: over ? [] : st.guesses.filter(g=>g.round === st.round - 1).map(g=>g.t),
        canGuess: iAmWhite && st.out.indexOf(id) < 0
          && (st.phase === 'talk' || st.phase === 'vote')
          && st.guesses.filter(g=>g.id === id).length < MW_TRIES,
        tries: MW_TRIES - st.guesses.filter(g=>g.id === id).length,
        lastOut: st.lastOut ? name(st.lastOut) : '',
        lastOutWhite: over || !st.lastOut ? null : st.roles[st.lastOut] === 'white',
        lastTie: !!st.lastTie,
        lastBurn: !!st.lastBurn,
        winner: st.winner, why: st.why,
        alive: alive.length,
      };
    },

    _push(){
      if(!syncIsHost()) return;
      syncGamePushAll(this.key, (id)=>this._viewFor(id));
    },

    /* ================= everybody =================
       Runs in every window, from the view the host sent. */

    apply(v){ this.view = v; this.render(); },

    _paintClock(){
      const v = this.view;
      const el = $('mw-clock');
      if(!el) return;
      if(!v || !v.deadline || (v.phase !== 'talk' && v.phase !== 'vote')){
        el.textContent = '';
        el.classList.add('hide');
        return;
      }
      const left = Math.max(0, Math.ceil((v.deadline - Date.now()) / 1000));
      el.classList.remove('hide');
      el.textContent = left + 's';
      el.classList.toggle('low', left <= 10);
      /* The host is the only one whose clock running out changes anything;
         everybody else is just watching the same number. */
      if(left <= 0 && syncIsHost()) this._expire();
    },

    render(){
      if(!$('game-mrwhite')) return;
      const v = this.view;
      const show = (id, on)=>{ const e = $(id); if(e) e.classList.toggle('hide', !on); };
      if(!v){
        show('mw-need', true); show('mw-lobby', false); show('mw-play', false);
        return;
      }
      show('mw-need', false);
      show('mw-lobby', v.phase === 'lobby');
      show('mw-play', v.phase !== 'lobby');
      if(v.phase === 'lobby') this._renderLobby(v);
      else this._renderPlay(v);
      this._paintClock();
    },

    _renderLobby(v){
      const opt = (k, val, on, label)=>
        '<button class="mini-btn' + (on ? ' on' : '') + '" data-mw="' + k + '"'
        + ' data-v="' + val + '">' + esc(label) + '</button>';

      $('mw-sets').innerHTML = v.sets.map(s=>
        '<button class="mw-set' + (s.mine ? ' mine' : '') + '" data-mw="set" data-v="' + s.id + '">'
        + '<b>' + esc(T(s.name)) + '</b>'
        + '<span>' + esc(T(s.note)) + '</span>'
        + '<em>' + esc(Tn('{n} word', '{n} words', s.n)) + '</em>'
        + (s.votes ? '<i class="mw-votes">' + s.votes + '</i>' : '')
        + '</button>').join('');

      $('mw-whites').innerHTML = [1, 2].map(n=>
        opt('whites', n, v.whites === n, n === 1 ? T('One Mr White') : T('Two Mr Whites'))).join('');
      $('mw-whites').classList.toggle('mw-dim', !v.canTwo);
      /* Shown in whichever unit reads shorter: 300s is a number you have to
         divide, and 5m is one you do not. */
      $('mw-secs').innerHTML = MW_TIMES.map(n=>
        opt('secs', n, v.secs === n, n < 120 ? n + 's' : (n / 60) + 'm')).join('');
      $('mw-say').innerHTML = [
        ['phrase', T('Say something')],
        ['ask', T('Ask somebody')],
        ['both', T('Both, in turn')],
      ].map(([k, label])=>opt('say', k, v.say === k, label)).join('');

      const s = $('mw-start');
      s.classList.toggle('hide', !v.leader);
      s.disabled = !v.enough;
      $('mw-lobby-note').textContent = !v.enough
        ? T('Three to play. {n} here so far.', {n:v.seats})
        : (v.leader ? T('Starting shuts the door. Nobody can join after that.')
                    : T('{name} starts it.', {name:v.leaderName}));
    },

    _renderPlay(v){
      const over = v.phase === 'over';

      /* The card that tells you who you are. Mr White's says nothing about the
         word, because there is nothing to say. */
      const card = $('mw-card');
      if(v.iAmWhite){
        card.className = 'mw-card white';
        card.innerHTML = '<b>' + esc(T('You are Mr White')) + '</b>'
          + '<span>' + esc(T('You do not know the word. Work it out from what everybody says, and sound like you knew it all along.')) + '</span>';
      }else if(v.word){
        card.className = 'mw-card civ';
        card.innerHTML = '<b translate="no">' + esc(v.word) + '</b>'
          + '<span>' + esc(T('Say something about it without saying it.')) + '</span>';
      }else{
        card.className = 'mw-card';
        card.innerHTML = '<span>' + esc(T('Watching this one.')) + '</span>';
      }

      $('mw-round').textContent = over ? '' : T('Round {n}', {n:v.round});

      $('mw-players').innerHTML = v.players.map(p=>
        '<div class="mw-player' + (p.out ? ' out' : '') + (p.turn ? ' turn' : '')
        + (p.role === 'white' ? ' was-white' : '') + '">'
        + '<b translate="no">' + esc(p.name) + (p.me ? ' <em>' + esc(T('you')) + '</em>' : '') + '</b>'
        + (p.out ? '<span>' + esc(T('out')) + '</span>'
           : p.turn ? '<span>' + esc(T('to speak')) + '</span>'
           : p.voted ? '<span>' + esc(T('voted')) + '</span>' : '<span></span>')
        + (p.role ? '<i>' + esc(p.role === 'white' ? T('Mr White') : T('civilian')) + '</i>' : '')
        + '</div>').join('');

      /* The talking happens off the screen — in the room's chat, or out loud in
         the same room. All this does is hold the clock and get out of the way,
         with one button for the leader when the room has finished early. */
      $('mw-talk').classList.toggle('hide', !(v.talking && !over));
      $('mw-done').classList.toggle('hide', !v.canEnd);
      /* The round says which of the two it is, every round, because in a room
         that alternates the answer changes under you and the last thing four
         people need is to be working from what they remember of last time. */
      $('mw-talk-note').textContent = v.saying === 'ask'
        ? T('Ask somebody a question about the word, without naming it. Their answer has to show they know it as well.')
        : T('Say something about the word without saying it. In the chat, or out loud if you are in the same room. Everyone gets a turn before the vote.');

      // the vote
      const voting = v.phase === 'vote' && !over;
      $('mw-voting').classList.toggle('hide', !voting);
      if(voting){
        $('mw-ballot').innerHTML = v.players.filter(p=>p.playing && !p.out).map(p=>
          '<button class="mw-ballot-row' + (v.myVote === p.id ? ' on' : '') + '"'
          + ' data-mw="vote" data-v="' + p.id + '"' + (v.canVote ? '' : ' disabled') + '>'
          + '<span translate="no">' + esc(p.name) + '</span>'
          + (p.me ? '<em>' + esc(T('you')) + '</em>' : '') + '</button>').join('');
        $('mw-vote-note').textContent = v.canVote
          ? T('Vote somebody out. Everybody voting ends the round.')
          : T('You are out. You can watch the vote.');
      }
      /* The guess is open for the whole round, so this hangs off nothing but
         being Mr White, still in, and having a guess left. */
      $('mw-guessing').classList.toggle('hide', !v.canGuess);
      if(v.canGuess){
        $('mw-tries').textContent = Tn('{n} guess left', '{n} guesses left', v.tries)
          + ' \u00b7 ' + T('a wrong last one puts you out');
      }

      /* The round a guess was made in only means anything once there has been
         more than one of them; before that the tag is furniture. */
      const many = v.round > 1 || over;
      /* What each row says about itself is *who knows*, not whether it was
         right — before the end, every guess in this list is one that missed,
         and the thing Mr White actually needs off the screen is how much of it
         has already left the room. */
      const said = (g)=>over ? (g.right ? T('right') : T('wrong'))
        : g.fresh ? T('only you can see this yet')
        : T('the room heard this, not your name');
      $('mw-said').innerHTML = v.guesses.length
        ? v.guesses.map(g=>'<div class="mw-guess' + (g.right ? ' right' : '')
            + (g.fresh ? ' fresh' : '') + '">'
            + '<b translate="no">' + esc(g.name)
            + (many ? ' <i>' + esc(T('round {n}', {n:g.round})) + '</i>' : '') + '</b>'
            + '<span translate="no">' + esc(g.t) + '</span>'
            + '<em>' + esc(said(g)) + '</em></div>').join('')
        : '';

      /* The anonymous half, which every window draws the same. Joined with the
         reader's own conjunction, because two guesses in one round is "badger
         and stoat" in English and something else everywhere else — and left
         deliberately vague about whether that was one person twice or two
         people once. */
      const heard = $('mw-heard');
      const hs = (v.heard || []).filter(Boolean);
      heard.classList.toggle('hide', !hs.length);
      if(hs.length){
        heard.textContent = T('Somebody guessed {w} last round. Not the word.',
          {w:langAnd(hs)});
      }

      // what the last vote did
      const note = $('mw-last');
      if(v.lastBurn && v.lastOut && !over){
        note.classList.remove('hide');
        note.textContent = T('{name} used up their guesses and is out.', {name:v.lastOut});
      }else if(v.lastTie && !over){
        note.classList.remove('hide');
        note.textContent = T('The vote was tied. Nobody went out.');
      }else if(v.lastOut && !over){
        note.classList.remove('hide');
        note.textContent = v.lastOutWhite
          ? T('{name} is out, and was Mr White.', {name:v.lastOut})
          : T('{name} is out, and was not.', {name:v.lastOut});
      }else{
        note.classList.add('hide');
      }

      // the end
      const b = $('mw-banner');
      b.classList.toggle('hide', !over);
      if(over){
        $('mw-win').textContent = v.winner === 'white' ? T('Mr White wins') : T('The room wins');
        $('mw-why').textContent = (v.why ? T(v.why) + ' · ' : '')
          + T('The word was {w}.', {w:v.word});
        $('mw-again').classList.toggle('hide', !v.leader);
      }
    },
  };

  syncGameRegister(MW_KEY, {
    intent(from, m){ MrWhite._intent(from, m); },
    apply(v){ MrWhite.apply(v); },
    roster(){ MrWhite._ensure(); },
    save(){ return MrWhite.state; },
    load(s){ MrWhite.state = s; MrWhite._ensure(); },
  });

  registerGame(MW_KEY, {
    el:'game-mrwhite', title:'Mr White', progEl:'prog-mrwhite', game:()=>MrWhite,
    canReset:()=>syncIsLeader(),
    reset(){ syncGameSend(MW_KEY, {a:'reset'}); },
    resetNote:'The game is thrown away and the room goes back to picking a set.',
    async progress(){
      if(!syncActive()) return '';
      const v = MrWhite.view;
      if(!v) return 'Ready<span>waiting</span>';
      if(v.phase === 'lobby') return 'Lobby<span>' + (v.enough ? 'ready' : 'waiting') + '</span>';
      if(v.phase === 'over') return 'Done<span>' + esc(T(v.winner === 'white' ? 'Mr White' : 'the room')) + '</span>';
      return T('Round {n}', {n:v.round}) + '<span>' + esc(v.phase === 'vote' ? T('voting') : T('talking')) + '</span>';
    },
  });
