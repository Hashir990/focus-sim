  /* ---------------- SPYMASTER (shared) ----------------
     A Codenames-style word game for a room. Called Spymaster rather than by
     the board game's name, which belongs to somebody else.

     Twenty-five words in a grid. Each team has some of them; a few belong to
     nobody; one is the assassin. Each team has one spymaster, who can see which
     word is whose, and gives one-word clues with a number — "ocean, 2" — and the
     rest of the team guess from the clue alone. Turn over your own and you keep
     going; turn over anything else and the turn passes; turn over the assassin
     and you have lost.

     **A game has a before.** People pick a side and a job while nothing is
     dealt, so changing your mind costs nothing, and the leader — whoever holds
     the timer, the same person every other shared game defers to — starts it
     when the sides make sense. After it ends, everyone goes back to that screen
     with the sides as they were, so swapping who is spymaster is one tap.

     **Four to play: a spymaster and somebody guessing on each side.** It used
     to start with two — one side staffed, and the board playing the other by
     turning over one of its own words at the end of every turn. The shelf said
     2+ and meant it. It is a four-person game now, the card says 4+, and the
     start waits until both sides are staffed, so the card and the button agree
     about what the game needs.

     **The host owns it** — see "shared games" in 29-sync.js. The key (which word
     is whose) is sent to the spymasters and to nobody else until the game is
     over, the same way the hangman answer never leaves the setter: an operative
     cannot read the colours out of the wire, because they are not on it. */

  const SM_SIZE = 25;
  const SM_FIRST = 9;        // the side that goes first has one more to find
  const SM_SECOND = 8;
  const SM_TEAMS = ['red', 'blue'];
  const SM_MAX_N = 9;        // "ocean, 9" is already optimistic

  /* ---- the words ----
     Short, ordinary, and **most of them mean two things**. That is the whole
     game: "bat" is a club and an animal, "bank" is money and a river, and a
     clue that reaches two of your words without touching the assassin lives
     in exactly those gaps. A list of plain single-meaning nouns makes every
     clue obvious and every game the same.

     Eight letters at most, because the grid is five across on a phone and a
     long word on a small card is a word in a font nobody can read. The smoke
     test holds that line. */
  const SM_WORDS = (
    'bank, bark, bat, bear, bell, belt, board, bolt, bond, boot, bow, box, '
    + 'bridge, bug, button, cabin, cap, capital, card, cast, cell, chain, '
    + 'change, charge, check, chest, chip, circle, club, coach, code, cold, '
    + 'comet, cook, copper, court, crane, crash, cross, crown, date, deck, '
    + 'diamond, dice, disc, draft, dragon, drill, drop, duck, engine, face, '
    + 'fair, fall, fan, fence, field, figure, file, film, fire, fish, flag, '
    + 'flat, fly, foot, fork, frame, game, gas, ghost, glass, glove, gold, '
    + 'grace, grass, ground, guard, head, heart, horn, horse, ice, iron, '
    + 'jack, jam, jet, key, king, kite, knife, knight, lab, lap, lead, leaf, '
    + 'lemon, letter, light, line, link, lock, log, mail, march, mark, mass, '
    + 'match, mercury, mine, mint, model, mole, moon, mount, mouse, nail, '
    + 'needle, net, night, note, nurse, nut, oil, olive, opera, orange, '
    + 'organ, pan, paper, park, pass, patch, pen, pepper, piano, pie, pilot, '
    + 'pin, pipe, pit, pitch, plane, plate, play, plot, point, pole, pool, '
    + 'port, post, pound, press, prince, pupil, queen, rabbit, race, ray, '
    + 'record, ring, robin, rock, roll, root, rose, round, row, ruler, sail, '
    + 'scale, school, seal, server, shadow, shell, ship, shoe, shot, sink, '
    + 'slip, snow, soap, sock, soul, space, spell, spike, spider, spine, spot, '
    + 'spring, square, stage, star, stick, stock, storm, straw, stream, '
    + 'strike, string, suit, swing, table, tail, tap, temple, tie, tip, toast, '
    + 'tooth, torch, tower, track, train, trip, trunk, tube, turkey, vet, '
    + 'wake, wall, watch, wave, web, well, whale, whip, wind, witch, wolf, '
    + 'worm, yard, anchor, arm, back, ball, band, bar, bass, beam, bench, '
    + 'berry, block, bomb, bottle, bowl, brush, buck, bull, cake, camp, '
    + 'canal, candle, cane, cannon, casino, castle, cat, cave, cloak, clock, '
    + 'cloud, comb, compass, cotton, cow, crow, cycle, dance, dart, dog, '
    + 'drum, eagle, egg, fairy, feather, fever, flute, fog, forest, fox, '
    + 'frog, genius, giant, gloss, grape, gum, hammer, hawk, honey, hood, '
    + 'hook, jewel, jungle, kiwi, ladder, laser, lion, magic, map, mask, '
    + 'maze, medal, mirror, monkey, net, nose, novel, ocean, owl, palm, '
    + 'parrot, pearl, penguin, pirate, pistol, planet, poison, police, '
    + 'pumpkin, puzzle, pyramid, radio, rain, robot, rocket, saddle, salt, '
    + 'satchel, saw, scarf, screen, script, shark, sheep, shield, silk, '
    + 'skull, slide, smoke, snake, soldier, sphinx, spoon, spy, stamp, '
    + 'statue, steam, sugar, sun, swan, sword, tank, telescope, thief, '
    + 'thread, throne, thunder, tiger, time, titan, tornado, tunnel, '
    + 'unicorn, vampire, van, violin, volcano, wagon, wand, window, wing, '
    + 'wizard, wool'
  ).split(',').map(w=>w.trim()).filter(Boolean)
    /* A long word slipped in is a card nobody can read — dropped here rather
       than trusted to whoever edits the list next. Duplicates too: two copies
       of "net" is a board that can deal the same word twice. */
    .filter((w, i, all)=>w.length <= 8 && all.indexOf(w) === i);

  function smOther(t){ return t === 'red' ? 'blue' : 'red'; }

  /* ================= the rules, as pure functions =================
     Everything that decides an outcome is here, over plain objects, so it can
     be tested without a room — which is the only way the refusals can be
     tested honestly, since the buttons that would send them are hidden from the
     people who may not press them. */

  /** A fresh board. Whichever side goes first has the extra word to find. */
  function smDeal(rnd){
    rnd = rnd || Math.random;
    const pool = SM_WORDS.slice();
    for(let i = 0; i < SM_SIZE; i++){
      const j = i + Math.floor(rnd() * (pool.length - i));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    const words = pool.slice(0, SM_SIZE);
    const first = rnd() < .5 ? 'red' : 'blue';
    const second = smOther(first);
    const key = [];
    for(let i = 0; i < SM_FIRST; i++) key.push(first);
    for(let i = 0; i < SM_SECOND; i++) key.push(second);
    key.push('kill');
    while(key.length < SM_SIZE) key.push('none');
    for(let i = key.length - 1; i > 0; i--){
      const j = Math.floor(rnd() * (i + 1));
      const t = key[i]; key[i] = key[j]; key[j] = t;
    }
    return {words, key, first};
  }

  /** How many of a side's words are still face down. */
  function smLeft(st, team){
    let n = 0;
    for(let i = 0; i < st.key.length; i++) if(st.key[i] === team && !st.shown[i]) n++;
    return n;
  }

  /** '' if the clue is fair, otherwise why not.

      **One word, and not one on the board.** That is the rule that matters: a
      clue that *is* a visible word, or is one with an ending stuck on ("ships"
      for "ship", "starry" for "star"), is just pointing. Words already turned
      over are fair game — they are out of play. */
  function smClueWhy(word, n, words, shown){
    const w = String(word || '').trim().toLowerCase();
    if(!w) return 'Type a clue first.';
    if(!/^[a-z][a-z'-]{0,23}$/.test(w)) return 'One word, letters only.';
    n = Number(n);
    if(!(n >= 1 && n <= SM_MAX_N && Math.floor(n) === n)) return 'Pick how many words it points at.';
    for(let i = 0; i < words.length; i++){
      if(shown[i]) continue;
      const b = words[i];
      if(b === w) return T('“{w}” is on the board.', {w:b});
      const short = b.length < w.length ? b : w;
      if(short.length >= 3 && (b.indexOf(w) === 0 || w.indexOf(b) === 0)){
        return T('Too close to “{w}”, which is on the board.', {w:b});
      }
    }
    return '';
  }

  /** Who is sitting where, among the people still here, and whether it is a
      game yet: both sides staffed, which is four people at the least. `mode`
      is 'duel' when it is and '' when it is not. */
  function smLineup(seats, present){
    const t = {red:{spy:null, ops:[]}, blue:{spy:null, ops:[]}};
    for(const id in seats){
      if(present && !present.has(id)) continue;
      const s = seats[id];
      if(!s || SM_TEAMS.indexOf(s.team) < 0) continue;
      if(s.role === 'spy') t[s.team].spy = id; else t[s.team].ops.push(id);
    }
    const staffed = (k)=>!!t[k].spy && t[k].ops.length > 0;
    const empty = (k)=>!t[k].spy && !t[k].ops.length;
    const mode = staffed('red') && staffed('blue') ? 'duel' : '';
    const needs = [];
    if(!mode){
      if(empty('red') && empty('blue')) needs.push('Pick a side to begin.');
      else for(const k of SM_TEAMS){
        const name = k === 'red' ? 'Red' : 'Blue';
        if(!t[k].spy) needs.push(name + ' needs a spymaster.');
        if(!t[k].ops.length) needs.push(name + ' needs somebody to guess.');
      }
    }
    return {red:t.red, blue:t.blue, mode, needs};
  }

  /** Turn one card over for `team`. Mutates `st`; returns what happened.
      The only place a guess is decided, so the host and the tests agree. */
  function smReveal(st, team, i){
    st.shown[i] = true;
    const card = st.key[i];
    const other = smOther(team);
    if(card === 'kill'){ st.winner = other; st.why = 'kill'; st.phase = 'over'; return 'kill'; }
    if(card === team){
      st.guessed++;
      if(!smLeft(st, team)){ st.winner = team; st.why = 'found'; st.phase = 'over'; return 'won'; }
      /* A clue for N buys N guesses and one more: the spare is for a word an
         earlier clue left behind, which is most of the craft in this game. */
      if(st.clue && st.guessed > st.clue.n) return 'spent';
      return 'hit';
    }
    if(card === other && !smLeft(st, other)){
      st.winner = other; st.why = 'found'; st.phase = 'over'; return 'gave';
    }
    return card === other ? 'theirs' : 'miss';
  }

  /** Hand the turn to the other side. */
  function smEndTurn(st){
    st.clue = null; st.guessed = 0;
    st.turn = smOther(st.turn);
  }

  const Spymaster = {
    key:'spymaster',
    view:null,          // what to draw — every window has one
    state:null,         // the truth — the host only
    built:false,
    pick:-1,            // a card tapped once, waiting for the second tap
    n:1,                // the number the spymaster has chosen for the next clue
    noting:false,       // tapping a card writes on it instead of turning it over

    enter(){
      this.build();
      if(syncActive() && !syncIsHost()) syncGameSend(this.key, {a:'look'});
      if(syncIsHost()) this._ensure();
      this.render();
    },
    leave(){ this.pick = -1; this.noting = false; },

    build(){
      if(this.built) return;
      $('sm-need-go').onclick = ()=>{ Arcade.close(); syncOpen(); };
      $('sm-start').onclick = ()=>syncGameSend(this.key, {a:'start'});
      $('sm-again').onclick = ()=>syncGameSend(this.key, {a:'reset'});
      $('sm-pass').onclick = ()=>syncGameSend(this.key, {a:'pass'});
      $('sm-send').onclick = ()=>this.giveClue();
      $('sm-word').addEventListener('keydown', e=>{
        if(e.key === 'Enter'){ e.preventDefault(); this.giveClue(); }
      });
      /* **The leader can reset at any point — and here, not only on the card.**
         Every other shared game keeps its reset on its card in the arcade (a
         long press; see arcadeResetItems) so it never competes with the board.
         This one is asked for by name: a word game goes wrong in ways the
         others do not — the wrong person on the wrong side, a spymaster who
         had to go — and the one who can put it right needs to find the way to
         do it without knowing a gesture. Same confirm, same intent as the card. */
      $('sm-reset').onclick = ()=>askConfirm('Start Spymaster again?',
        'The board is thrown away and everybody goes back to picking sides. Sides stay as they were.',
        'Reset', ()=>syncGameSend(this.key, {a:'reset'}));

      $('sm-nums').innerHTML = Array.from({length:SM_MAX_N}, (_, k)=>
        '<button class="sm-num" data-n="' + (k + 1) + '">' + (k + 1) + '</button>').join('');
      $('sm-nums').onclick = (e)=>{
        const b = e.target.closest('[data-n]');
        if(!b) return;
        this.n = Number(b.dataset.n);
        this._paintNums();
      };
      $('sm-sides').onclick = (e)=>{
        const b = e.target.closest('[data-seat]');
        if(!b) return;
        const [team, role] = b.dataset.seat.split(':');
        syncGameSend(this.key, {a:'seat', team, role});
      };
      $('sm-watch').onclick = (e)=>{
        if(e.target.closest('[data-unseat]')) syncGameSend(this.key, {a:'unseat'});
      };
      /* A taken-over spymaster's seat, mid-game — see the host's 'seat'. */
      $('sm-status').onclick = (e)=>{
        const b = e.target.closest('[data-seat]');
        if(!b) return;
        const [team, role] = b.dataset.seat.split(':');
        syncGameSend(this.key, {a:'seat', team, role});
      };
      /* **Two taps to turn a card over.** One marks it — for you, and it says
         so — and a second on the same card commits. A misplaced thumb on a
         five-by-five grid is otherwise a turn lost, or a game lost if it lands
         on the assassin, and there is no taking a card back. */
      $('sm-grid').onclick = (e)=>{
        const b = e.target.closest('[data-i]');
        if(!b) return;
        const i = Number(b.dataset.i);
        /* **In notes mode a tap writes rather than guesses**, and it is allowed
           on cards the guess handler has disabled — the whole point of a note
           is to put it on a card you are *not* turning over this turn. */
        if(this.noting){
          const v = this.view;
          if(!v || !v.canNote || v.shown[i]) return;
          syncGameSend(this.key, {a:'mark', i});
          return;
        }
        if(b.disabled) return;
        if(this.pick === i){
          this.pick = -1;
          syncGameSend(this.key, {a:'guess', i});
        }else{
          this.pick = i;
        }
        this.render();
      };
      $('sm-notes').onclick = ()=>{
        this.noting = !this.noting;
        this.pick = -1;      // the two modes must not share a half-made choice
        this.render();
      };
      $('sm-notes-clear').onclick = ()=>syncGameSend(this.key, {a:'unmark'});
      this.built = true;
    },

    giveClue(){
      const v = this.view;
      if(!v || !v.canClue) return;
      const word = ($('sm-word').value || '').trim();
      const why = smClueWhy(word, this.n, v.words, v.shown);
      if(why){ toast(why); return; }
      syncGameSend(this.key, {a:'clue', word, n:this.n});
      $('sm-word').value = '';
    },

    /* ================= host side =================
       Everything below here only ever runs in the host's window. */

    _blank(seats){
      return {
        phase:'lobby', game:0, seats:seats || {},
        words:[], key:[], shown:[], first:'red', turn:'red',
        clue:null, guessed:0, log:[], winner:null, why:'',
        /* What each side has written on the board for itself. Two objects of
           card index to mark; see the marks note by the intent. */
        marks:{red:{}, blue:{}},
      };
    },

    /** Make sure there is a game, and drop the seats of anybody who has gone. */
    _ensure(){
      if(!syncIsHost()) return;
      const seats = syncSeats();
      if(!seats.length) return;
      if(!this.state) this.state = this._blank();
      const st = this.state;
      const here = new Set(seats.map(s=>s.id));
      for(const id in st.seats) if(!here.has(id)) delete st.seats[id];
      this._push();
    },

    _viewFor(id){
      const st = this.state;
      if(!st) return null;
      const seats = syncSeats();
      const here = new Set(seats.map(s=>s.id));
      const name = (who)=>(seats.find(s=>s.id === who) || {}).name || 'Someone';
      const who = (pid)=>pid ? {id:pid, name:name(pid), me:pid === id} : null;
      const mine = st.seats[id] || null;
      const spy = !!(mine && mine.role === 'spy');
      const over = st.phase === 'over';
      const play = st.phase === 'play';
      const line = smLineup(st.seats, here);
      const turnOp = play && !!mine && mine.team === st.turn && mine.role === 'op';
      return {
        phase:st.phase, game:st.game, turn:st.turn, first:st.first,
        me: mine ? {team:mine.team, role:mine.role} : null,
        leader: id === SYNC.leaderId,
        leaderName: name(SYNC.leaderId),
        teams:{
          red:{spy:who(line.red.spy), ops:line.red.ops.map(who)},
          blue:{spy:who(line.blue.spy), ops:line.blue.ops.map(who)},
        },
        watching: seats.filter(s=>!st.seats[s.id]).map(s=>who(s.id)),
        words: st.words.slice(),
        shown: st.shown.slice(),
        /* **The key goes to the spymasters, and to nobody else until it is
           over.** Everybody else gets a colour only for a card that has been
           turned over. The rest of the array is blank, so there is nothing to
           read in the view that the screen does not already show. */
        colours: st.words.map((w, i)=>(spy || over || st.shown[i]) ? st.key[i] : ''),
        spy,
        left: st.words.length ? {red:smLeft(st, 'red'), blue:smLeft(st, 'blue')} : {red:0, blue:0},
        clue: st.clue ? {word:st.clue.word, n:st.clue.n, team:st.clue.team,
          left:Math.max(0, st.clue.n + 1 - st.guessed)} : null,
        guessed: st.guessed,
        canClue: play && spy && mine.team === st.turn && !st.clue,
        canGuess: turnOp && !!st.clue,
        canPass: turnOp && !!st.clue && st.guessed > 0,
        /* Your side's notes, and only your side's. Writing is the operatives';
           reading is the whole team's, because a mark tells a spymaster
           nothing they do not already know. */
        marks: (mine && st.marks && st.marks[mine.team]) ? Object.assign({}, st.marks[mine.team]) : {},
        canNote: play && !!mine && mine.role === 'op',
        vacant: play ? {red:!line.red.spy, blue:!line.blue.spy} : {red:false, blue:false},
        log: st.log.slice(-10),
        winner: st.winner, why: st.why,
        mode: line.mode, needs: line.needs,
        canStart: st.phase === 'lobby' && !!line.mode,
        alone: seats.length < 2,
        // how many more people the room needs before a game is possible at all
        short: Math.max(0, 4 - seats.length),
      };
    },

    _push(){ syncGamePushAll(this.key, id=>this._viewFor(id)); },

    _intent(from, m){
      if(!syncIsHost() || !m) return;
      this._ensure();
      const st = this.state;
      if(!st) return;
      const here = new Set(syncSeats().map(s=>s.id));

      if(m.a === 'look'){ syncGamePush(this.key, from, this._viewFor(from)); return; }

      /* Sides are chosen before the deal. Once it is dealt the only seat that
         can change is a spymaster's that has been left empty — somebody had to
         go — and only somebody already on that side can take it, so nobody
         crosses over having seen the other side's guesses. */
      if(m.a === 'seat'){
        const team = m.team, role = m.role === 'spy' ? 'spy' : 'op';
        if(SM_TEAMS.indexOf(team) < 0) return;
        const line = smLineup(st.seats, here);
        if(st.phase === 'play'){
          const mine = st.seats[from];
          if(role !== 'spy' || !mine || mine.team !== team || line[team].spy) return;
          st.seats[from] = {team, role:'spy'};
          this._push();
          return;
        }
        if(st.phase !== 'lobby') return;
        if(role === 'spy' && line[team].spy && line[team].spy !== from) return;
        st.seats[from] = {team, role};
        this._push();
        return;
      }
      if(m.a === 'unseat'){
        if(st.phase !== 'lobby') return;
        delete st.seats[from];
        this._push();
        return;
      }

      // Only the timer holder starts it and resets it, and the host is what
      // enforces that — the button being hidden elsewhere is a convenience.
      if(m.a === 'start'){
        if(from !== SYNC.leaderId || st.phase !== 'lobby') return;
        const line = smLineup(st.seats, here);
        if(line.mode !== 'duel') return;
        const d = smDeal(Math.random);
        Object.assign(st, {
          phase:'play', game:st.game + 1, words:d.words, key:d.key,
          shown:d.words.map(()=>false), first:d.first, turn:d.first,
          clue:null, guessed:0, log:[], winner:null, why:'',
        });
        this._push();
        return;
      }
      if(m.a === 'reset'){
        if(from !== SYNC.leaderId) return;
        /* Back to the sides screen with the sides as they were: the common
           reason to reset is to swap who is spymaster, and making everybody
           pick again to do that is a chore. Anyone can still change seats. */
        this.state = this._blank(st.seats);
        this.state.game = st.game;
        this._push();
        return;
      }

      if(st.phase !== 'play') return;
      const mine = st.seats[from];

      if(m.a === 'clue'){
        if(!mine || mine.role !== 'spy' || mine.team !== st.turn || st.clue) return;
        const word = String(m.word || '').trim().toLowerCase();
        const n = Number(m.n);
        if(smClueWhy(word, n, st.words, st.shown)) return;
        st.clue = {word, n, team:st.turn};
        st.guessed = 0;
        st.log.push({team:st.turn, word, n});
        this._push();
        return;
      }

      if(m.a === 'guess'){
        if(!st.clue || !mine || mine.role !== 'op' || mine.team !== st.turn) return;
        const i = Number(m.i);
        if(!(i >= 0 && i < st.words.length) || st.shown[i]) return;
        const got = smReveal(st, st.turn, i);
        /* A card on the table is not a card to remember. Both sides lose their
           mark on it — the other team's too, because theirs was a guess about
           a card that has now answered for itself. */
        if(st.marks){ delete (st.marks.red || {})[i]; delete (st.marks.blue || {})[i]; }
        if(st.phase === 'play' && got !== 'hit') smEndTurn(st);
        this._push();
        return;
      }

      /* **Notes, which are a team's memory and nothing else.**

         A clue of "river, 2" that the room only half solves leaves a candidate
         nobody can write down, and next turn it is gone — so this is a mark a
         side puts on a card for itself. Three of them, cycled by tapping:
         ours, avoid, and a maybe.

         **Only the operatives may write.** A spymaster marking a card "ours"
         would be giving the answer, which is the one thing a spymaster may not
         do outside their clue — and it would be undetectable from the other
         side of the table. They can read the marks; they already know
         everything a mark could tell them.

         **And a side only ever sees its own.** They go out in `_viewFor` by
         team, so the other side's notes are not in the view to be read off the
         wire, which is the same rule the key itself follows. */
      if(m.a === 'mark'){
        if(!mine || mine.role !== 'op') return;
        const i = Number(m.i);
        if(!(i >= 0 && i < st.words.length) || st.shown[i]) return;
        if(!st.marks) st.marks = {red:{}, blue:{}};
        const mk = st.marks[mine.team] || (st.marks[mine.team] = {});
        const was = mk[i] || '';
        const next = was === '' ? 'ours' : was === 'ours' ? 'avoid' : was === 'avoid' ? 'maybe' : '';
        if(next) mk[i] = next; else delete mk[i];
        this._push();
        return;
      }
      if(m.a === 'unmark'){
        if(!mine || mine.role !== 'op') return;
        if(st.marks) st.marks[mine.team] = {};
        this._push();
        return;
      }

      /* At least one guess first: a turn you can pass without trying is a clue
         thrown away, and the rules have always asked for one. */
      if(m.a === 'pass'){
        if(!st.clue || !mine || mine.role !== 'op' || mine.team !== st.turn) return;
        if(st.guessed < 1) return;
        smEndTurn(st);
        this._push();
      }
    },

    /* ================= drawing =================
       Runs in every window, from the view the host sent. */

    apply(v){
      const before = this.view;
      this.view = v;
      /* A tapped-once card that has since been turned over, or a turn that has
         moved on, is not a choice any more. */
      if(!v || !v.canGuess || (v.shown && v.shown[this.pick])) this.pick = -1;
      if(Arcade.open && Arcade.active === 'spymaster') this.render();
      if(v && v.phase === 'over' && (!before || before.phase !== 'over')) this._cheer(v);
      try{ Arcade._refresh(); }catch(e){}
    },

    _cheer(v){
      const mine = v.me && v.me.team;
      const won = mine && mine === v.winner;
      const title = T(v.winner === 'red' ? 'Red wins.' : 'Blue wins.');
      const sub = v.why === 'kill' ? 'Somebody found the assassin.' : 'Every word found.';
      if(won) chime(false);
      showBanner('sm-banner', title, sub);
      setTimeout(()=>{ const b = $('sm-banner'); if(b) b.classList.add('hide'); }, 3600);
    },

    _paintNums(){
      $('sm-nums').querySelectorAll('[data-n]').forEach(b=>{
        b.classList.toggle('on', Number(b.dataset.n) === this.n);
      });
    },

    render(){
      if(!$('sm-lobby')) return;
      const v = this.view;
      const inRoom = syncActive();
      $('sm-need').classList.toggle('hide', inRoom);
      $('sm-lobby').classList.toggle('hide', !inRoom || !v || v.phase !== 'lobby');
      $('sm-play').classList.toggle('hide', !inRoom || !v || v.phase === 'lobby');
      $('sm-reset').classList.toggle('hide', !(inRoom && v && v.leader && (v.phase !== 'lobby' || v.game)));
      $('sm-meta').textContent = v && v.game ? T('Game {n}', {n:v.game}) : '';
      if(!inRoom || !v) return;
      if(v.phase === 'lobby') this._lobby(v); else this._board(v);
    },

    _lobby(v){
      const side = (k)=>{
        const t = v.teams[k];
        const me = v.me && v.me.team === k ? v.me.role : '';
        const nm = k === 'red' ? 'Red' : 'Blue';
        const spy = t.spy
          ? '<span class="sm-who' + (t.spy.me ? ' me' : '') + '">' + esc(t.spy.name) + (t.spy.me ? ' ' + esc(T('(you)')) : '') + '</span>'
          : '<button class="mini-btn" data-seat="' + k + ':spy">' + esc(T(k === 'red' ? 'Be Red’s spymaster' : 'Be Blue’s spymaster')) + '</button>';
        const ops = t.ops.map(p=>'<span class="sm-who' + (p.me ? ' me' : '') + '">'
          + esc(p.name) + (p.me ? ' ' + esc(T('(you)')) : '') + '</span>').join('');
        const join = me === 'op' ? '' : '<button class="mini-btn" data-seat="' + k + ':op">' + esc(T(k === 'red' ? 'Join Red' : 'Join Blue')) + '</button>';
        return '<div class="sm-side sm-' + k + '">'
          + '<h4>' + nm + '</h4>'
          + '<p class="sm-job">Spymaster</p><div class="sm-slot">' + spy + '</div>'
          + '<p class="sm-job">Guessing</p><div class="sm-slot">' + (ops || '<span class="sm-none">nobody yet</span>') + join + '</div>'
          + '</div>';
      };
      $('sm-sides').innerHTML = side('red') + side('blue');
      $('sm-watch').innerHTML = (v.watching.length
        ? '<span class="sm-job">Watching</span> ' + v.watching.map(p=>esc(p.name) + (p.me ? ' ' + esc(T('(you)')) : '')).join(langSep())
        : '')
        + (v.me ? ' <button class="mini-btn" data-unseat="1">Sit this one out</button>' : '');

      /* What would make it a game. **A room of two or three is told how many
         more it needs**, not which seats are empty: with three people there is
         no seating that starts, and a list of empty chairs reads as something
         they could fix by moving around. */
      $('sm-needs').textContent = v.alone
        ? 'Share your code from Focus together and they can join in.'
        : v.mode === 'duel' ? (v.leader ? T('Two sides. Ready when you are.') : T('Two sides. Ready when {name} is.', {name:v.leaderName}))
        : v.short ? T(v.short === 1 ? 'Four to play. One more to go.' : 'Four to play. Two more to go.')
        : v.needs.map(n=>T(n)).join(' ');
      $('sm-start').classList.toggle('hide', !v.leader);
      $('sm-start').disabled = !v.canStart;
    },

    _board(v){
      const nm = (k)=>k === 'red' ? 'Red' : 'Blue';
      const over = v.phase === 'over';

      /* whose turn, and how many each side has left */
      const vacant = !over && v.vacant[v.turn];
      $('sm-status').innerHTML =
        '<span class="sm-turn sm-' + (over ? v.winner : v.turn) + '">'
          + esc(over ? T(v.winner === 'red' ? 'Red won' : 'Blue won') : T(v.turn === 'red' ? 'Red’s turn' : 'Blue’s turn')) + '</span>'
        + '<span class="sm-left">' + T('{r} red · {b} blue left', {r:'<b class="sm-red">' + v.left.red + '</b>',
            b:'<b class="sm-blue">' + v.left.blue + '</b>'}) + '</span>'
        + (vacant && v.me && v.me.team === v.turn
          ? '<button class="mini-btn" data-seat="' + v.turn + ':spy">Take over as spymaster</button>' : '');

      /* the clue, once there is one */
      $('sm-clue').innerHTML = v.clue
        ? '<span class="sm-clue-word sm-' + v.clue.team + '" translate="no">' + esc(v.clue.word) + '</span>'
          + '<span class="sm-clue-n">' + v.clue.n + '</span>'
          + '<span class="sm-clue-left">' + esc(Tn('{n} guess left', '{n} guesses left', v.clue.left)) + '</span>'
        : '';

      $('sm-give').classList.toggle('hide', !v.canClue);
      if(v.canClue) this._paintNums();

      /* the grid */
      $('sm-grid').dataset.spy = v.spy && !over ? '1' : '';
      /* Notes are your side's own and are shown whoever you are on it — the
         spymaster reading them learns nothing they were not already looking
         at. Writing is a different question; see the intent. */
      const marks = v.marks || {};
      const noting = this.noting && v.canNote;
      $('sm-grid').dataset.noting = noting ? '1' : '';
      $('sm-grid').innerHTML = v.words.map((w, i)=>{
        const c = v.colours[i];
        const shown = v.shown[i];
        const cls = ['sm-card'];
        if(c) cls.push('c-' + c);
        if(shown) cls.push('shown');
        else if(c) cls.push('key');               // a spymaster's view, or the end
        if(i === this.pick) cls.push('pick');
        const mk = !shown && marks[i] ? marks[i] : '';
        if(mk) cls.push('note-' + mk);
        /* **Enabled while taking notes even when it cannot be guessed.** The
           card you most want to write on is the one you are not turning over,
           and a disabled button takes no taps at all. */
        const can = noting ? !shown : (v.canGuess && !shown);
        /* The mark reaches a screen reader through the button's label, not
           through a hidden span: this app has no visually-hidden class and
           inventing one for three words is a utility nothing else will use. */
        const lab = mk ? ' aria-label="' + esc(w + ', ' + (mk === 'ours' ? T('noted: ours')
          : mk === 'avoid' ? T('noted: avoid') : T('noted: maybe'))) + '"' : '';
        return '<button class="' + cls.join(' ') + '" data-i="' + i + '"' + lab
          + (can ? '' : ' disabled') + '>'
          + '<span>' + esc(w) + '</span>'
          + (mk ? '<i class="sm-note" aria-hidden="true"></i>' : '')
          + '</button>';
      }).join('');

      /* The row only exists for somebody who can write on the board. A
         spectator and a spymaster both see the marks and neither can make
         one, so neither is offered a button that would do nothing. */
      $('sm-notes-row').classList.toggle('hide', !v.canNote);
      $('sm-notes').classList.toggle('on', noting);
      $('sm-notes').textContent = noting ? T('Done with notes') : T('Take notes');
      $('sm-notes-clear').classList.toggle('hide', !(noting && Object.keys(marks).length));
      $('sm-notes-help').textContent = noting
        ? T('Tap a card to mark it: ours, then avoid, then a maybe.')
        : (Object.keys(marks).length ? Tn('{n} card marked', '{n} cards marked', Object.keys(marks).length) : '');

      $('sm-pass').classList.toggle('hide', !v.canPass);
      $('sm-again').classList.toggle('hide', !(over && v.leader));

      /* one line for what you are waiting on */
      const turnName = nm(v.turn);
      $('sm-msg').textContent = noting
        /* In notes mode the tap does something else, so the line that tells you
           what a tap does has to say the other thing. Both at once read as the
           screen contradicting itself. */
        ? T('Nothing is turned over while you are taking notes.')
        : over
        ? (v.leader ? 'Back to teams when you are ready.' : T('Waiting for {name} to set up the next one.', {name:v.leaderName}))
        : vacant ? T(v.turn === 'red' ? 'Red has no spymaster. Somebody on Red can take over.' : 'Blue has no spymaster. Somebody on Blue can take over.')
        : v.canClue ? 'Your clue: one word, and how many of your words it points at.'
        : v.canGuess ? (this.pick >= 0 ? 'Tap it again to turn it over.' : 'Tap a word, then tap it again to turn it over.')
        : !v.clue ? T(v.turn === 'red' ? 'Waiting for Red’s spymaster.' : 'Waiting for Blue’s spymaster.')
        : v.spy ? T(v.turn === 'red' ? 'Red is guessing. You can only watch.' : 'Blue is guessing. You can only watch.')
        : T(v.turn === 'red' ? 'Red is guessing.' : 'Blue is guessing.');

      $('sm-log').innerHTML = v.log.slice().reverse().map(l=>
        '<span class="sm-' + l.team + '">' + esc(l.word) + ' ' + l.n + '</span>').join('');
    },
  };

  syncGameRegister('spymaster', {
    intent(from, m){ Spymaster._intent(from, m); },
    apply(v){ Spymaster.apply(v); },
    roster(){ Spymaster._ensure(); },
    /* Travels with the room when the host changes — see the handover note in
       29-sync.js. Keyed by peer id throughout, which is what the rekey expects. */
    save(){ return Spymaster.state; },
    load(s){ Spymaster.state = s; Spymaster._ensure(); },
  });

  registerGame('spymaster', {
    el:'game-spymaster', title:'Spymaster', progEl:'prog-spymaster', game:()=>Spymaster,
    canReset:()=>syncIsLeader(),
    reset(){ syncGameSend(Spymaster.key, {a:'reset'}); },
    resetNote:'The board is thrown away and everybody goes back to picking sides.',
    async progress(){
      if(!syncActive()) return '';
      const v = Spymaster.view;
      if(!v || v.alone) return 'Ready<span>waiting</span>';
      if(v.phase === 'lobby') return 'Sides<span>' + (v.mode ? 'ready' : 'picking') + '</span>';
      if(v.phase === 'over') return 'Done<span>' + esc(T(v.winner === 'red' ? 'red won' : 'blue won')) + '</span>';
      return (v.turn === 'red' ? 'Red' : 'Blue') + '<span>to play</span>';
    },
  });
