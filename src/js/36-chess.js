  /* ---------------- CHESS (shared) ----------------
     Two people out of however many are in the room, which is what makes this
     one different from the other shared games. Hangman, Scrabble and Pictionary
     are one game the whole room is in; chess is a duel, and a room of four
     should be able to run two boards at once without anyone choosing seats.

     So the screen opens on a lobby: who's here, who's already playing, and
     what you left half-finished with each of them. You pick a person, not a
     seat.

     The host still owns every board — same rule as everywhere else, see the
     shared-games note in 29-sync.js. Players send intents; the host decides
     whether a move is legal, using the same engine every window uses to draw
     the dots, so a move that looks legal is legal.

     **A game is its move list.** Nothing else is ever stored or sent: not a
     board, not a FEN. Everything — the position, the captured pieces, the
     notation, whose turn it is, whether it's over — is derived by replaying.
     That is what makes leaving one half-played cheap: both players keep the
     list, and whoever picks it up hands it back to whichever machine happens to
     be hosting that day. The host replays it before accepting it, so a made-up
     list can't put a made-up position on the board.

     There is deliberately no computer to play against. This is a break from
     work, not a chess app. */

  const CH_GLYPH = {
    K:'♔', Q:'♕', R:'♖', B:'♗', N:'♘', P:'♙',
    k:'♚', q:'♛', r:'♜', b:'♝', n:'♞', p:'♟',
  };
  const CH_VALUE = {p:1, n:3, b:3, r:5, q:9, k:0};
  const CH_FULL = {p:'pawn', n:'knight', b:'bishop', r:'rook', q:'queen', k:'king'};
  const CH_SAVE = 'focus_chess';
  const CH_KEEP = 20;                 // games remembered; older ones fall off the end

  /** Where the rook stands before a castling move — h-file going short, a-file long. */
  function chRookHome(mv){ return mv.to > mv.from ? mv.to + 1 : mv.to - 2; }

  function chPair(a, b){ return [a, b].sort().join('~'); }
  function chSide(game, code){ return game.white === code ? 'w' : 'b'; }

  const Chess = {
    key:'chess',
    view:null,          // what to draw — every window has one
    state:null,         // the truth — the host only
    saved:{},           // games I have left off, by the other person's code
    built:false,
    loaded:false,
    sel:-1,             // square I have picked up, or -1
    lobby:true,         // showing the list rather than a board
    pendPromo:null,     // a move waiting on "make it a…"
    board:null,         // the replayed position, rebuilt on every apply
    line:[],            // the same game as a list of {uci, san, from, to}

    /* ---- entering and leaving ---- */
    async enter(){
      this.build();
      await this.load();
      if(syncActive()) syncGameSend(this.key, {a:'look'});
      this.render();
    },
    leave(){ this.sel = -1; this.pendPromo = null; },

    async load(){
      if(this.loaded) return;
      this.loaded = true;
      const raw = await readGame(CH_SAVE);
      if(raw && typeof raw === 'object') this.saved = raw;
    },
    persist(){
      // newest first, and only so many — a year of breaks would otherwise turn
      // into a list nobody can find anything in
      const keys = Object.keys(this.saved).sort((a, b)=>(this.saved[b].at||0) - (this.saved[a].at||0));
      const trimmed = {};
      for(const k of keys.slice(0, CH_KEEP)) trimmed[k] = this.saved[k];
      this.saved = trimmed;
      writeGame(CH_SAVE, trimmed);
    },

    build(){
      if(this.built) return;
      const board = $('ch-board');

      board.onclick = (e)=>{
        const sq = e.target.closest('[data-sq]');
        if(sq) Chess.tap(+sq.dataset.sq);
      };
      $('ch-people').onclick = (e)=>{
        const b = e.target.closest('[data-code]');
        if(!b) return;
        if(b.dataset.act === 'decline') Chess.decline(b.dataset.code);
        else Chess.play(b.dataset.code);
      };
      $('ch-saved').onclick = (e)=>{
        const b = e.target.closest('[data-code]');
        if(!b) return;
        if(b.dataset.act === 'forget') Chess.forget(b.dataset.code);
        else Chess.play(b.dataset.code);
      };
      $('ch-promo-row').onclick = (e)=>{
        const b = e.target.closest('[data-p]');
        if(b) Chess.promote(b.dataset.p);
      };
      $('ch-back').onclick = ()=>{ Chess.lobby = true; Chess.sel = -1; Chess.render(); };
      $('ch-leave').onclick = ()=>{
        Chess.lobby = true; Chess.sel = -1; Chess.render();
        toast('Kept where it is');
      };
      $('ch-resign').onclick = ()=>{
        const g = this.view && this.view.game;
        if(!g || g.over) return;
        askConfirm(T('Resign to {name}?', {name:g.oppName}), 'They win this one. The game is over.',
          'Resign', ()=>syncGameSend(Chess.key, {a:'resign'}));
      };
      $('ch-again').onclick = ()=>syncGameSend(this.key, {a:'again'});
      $('ch-need-go').onclick = ()=>{ Arcade.close(); syncOpen(); };
      this.built = true;
    },

    /* ---- what this window sends ---- */

    /** Start, accept, or pick up where you left off — all one tap. */
    play(code){
      const v = this.view;
      if(!v) return;
      const p = (v.people || []).find(x=>x.code === code);
      if(p && p.invitedMe){ syncGameSend(this.key, {a:'accept', from:code}); return; }
      if(p && p.game){ this.lobby = false; this.sel = -1; this.render(); return; }
      if(p && p.busy){ toast(T('{name} is in a game', {name:p.name})); return; }
      if(!p){ toast('They’re not here right now'); return; }

      const s = this.saved[code];
      const resume = s && !s.over && (s.moves || []).length;
      syncGameSend(this.key, {
        a:'invite', to:code,
        moves: resume ? s.moves : [],
        white: resume ? s.white : null,
      });
      toast(resume ? 'Asked to pick it up' : 'Asked for a game');
    },
    decline(code){ syncGameSend(this.key, {a:'decline', from:code}); },
    forget(code){
      const s = this.saved[code];
      askConfirm(T('Forget the game with {name}?', {name:(s && s.name) || T('them')}),
        'The moves go with it. There’s no getting it back.',
        'Forget', ()=>{ delete Chess.saved[code]; Chess.persist(); Chess.render(); });
    },

    tap(sq){
      const g = this.view && this.view.game;
      if(!g || g.over || !this.board) return;
      if(!this.myTurn()){ if(this.board.b[sq]) toast('Not your turn'); return; }

      const mine = this.board.b[sq] && (chWhite(this.board.b[sq]) === (this.mySide() === 'w'));
      if(this.sel >= 0){
        /* Every legal move between these two squares, not one of them. A pawn
           reaching the last rank has four, and all four carry a promotion
           piece — so asking for "the move with no promotion" found nothing and
           the tap silently put the pawn back down. */
        const here = chessMoves(this.board).filter(m=>m.from === this.sel && m.to === sq);
        if(here.length > 1 && here[0].promo){
          this.pendPromo = {from:this.sel, to:sq};
          this.render();
          return;
        }
        if(here.length){ this.send(here[0]); return; }

        /* Castling by tapping your own rook. The rules call it a king move and
           the dots appear on g1 and c1, but reaching for the rook is what a lot
           of people do first, and having nothing happen reads as "castling is
           broken" rather than "that isn't where the king goes". */
        const castle = chessMoves(this.board).find(m=>
          m.from === this.sel
          && this.board.b[this.sel].toLowerCase() === 'k'
          && Math.abs(m.to - m.from) === 2
          && chRookHome(m) === sq);
        if(castle){ this.send(castle); return; }

        if(!mine){ this.sel = -1; this.render(); return; }
      }
      if(mine){ this.sel = this.sel === sq ? -1 : sq; this.render(); }
    },
    promote(p){
      const pend = this.pendPromo;
      if(!pend) return;
      const mv = chessFind(this.board, pend.from, pend.to, p);
      this.pendPromo = null;
      if(mv){
        // the pawn stops being a pawn the instant this lands, so nothing on the
        // board afterwards can be asked whether it ever happened
        try{ featMark('promo'); }catch(e){}
        this.send(mv);
      }else this.render();
    },
    send(mv){
      this.sel = -1; this.pendPromo = null;
      syncGameSend(this.key, {a:'move', uci:chessUci(mv)});
    },

    myTurn(){
      const g = this.view && this.view.game;
      return !!(g && !g.over && this.board && (this.board.w ? 'w' : 'b') === this.mySide());
    },
    mySide(){
      const g = this.view && this.view.game;
      return g ? (g.white === this.view.me ? 'w' : 'b') : 'w';
    },

    /* ================= host side =================
       Everything below here only ever runs in the host's window. */

    _blank(){ return {games:{}, invites:{}}; },

    /** Everyone in the room who has a friend code, which is what a game is filed under. */
    _seats(){
      return syncPeople().filter(p=>!!p.code);
    },
    _seatByCode(code){ return this._seats().find(p=>p.code === code) || null; },
    _seatById(id){ return this._seats().find(p=>p.id === id) || null; },

    /** The unfinished game somebody is in, if any. */
    _gameOf(code){
      const gs = this.state.games;
      for(const k in gs){ if(gs[k].codes.indexOf(code) >= 0 && !gs[k].over) return gs[k]; }
      return null;
    },

    _ensure(){
      if(!syncIsHost()) return;
      if(!this.state) this.state = this._blank();
      // an invite from or to somebody who has left is just noise
      const here = this._seats().map(p=>p.code);
      for(const to in this.state.invites){
        const inv = this.state.invites[to];
        if(here.indexOf(to) < 0 || here.indexOf(inv.from) < 0) delete this.state.invites[to];
      }
      this._push();
    },

    _start(aCode, bCode, moves, white){
      const a = this._seatByCode(aCode), b = this._seatByCode(bCode);
      if(!a || !b) return;
      const replay = chessReplay(moves || []);
      const clean = replay.ok ? (moves || []) : [];
      const names = {}; names[aCode] = a.name; names[bCode] = b.name;
      const w = (white === aCode || white === bCode) && clean.length ? white : aCode;
      this.state.games[chPair(aCode, bCode)] = {
        codes:[aCode, bCode], names, white:w, moves:clean.slice(), over:null, at:Date.now(),
      };
      delete this.state.invites[aCode];
      delete this.state.invites[bCode];
    },

    _intent(fromId, m){
      if(!syncIsHost()) return;
      if(!this.state) this.state = this._blank();
      const me = this._seatById(fromId);
      if(!me || !me.code) return;
      const code = me.code;
      const st = this.state;

      if(m.a === 'look'){ this._pushTo(fromId); return; }

      if(m.a === 'invite'){
        const them = this._seatByCode(m.to);
        if(!them || them.code === code) return;
        if(this._gameOf(code) || this._gameOf(them.code)) return;
        const back = st.invites[code];
        // they asked first: don't make anybody press Accept twice
        if(back && back.from === them.code){
          this._start(them.code, code, back.moves, back.white);
        }else{
          st.invites[them.code] = {
            from:code, name:me.name, at:Date.now(),
            moves:Array.isArray(m.moves) ? m.moves.slice(0, 400) : [],
            white:m.white || null,
          };
        }
      }

      else if(m.a === 'accept'){
        const inv = st.invites[code];
        if(!inv || inv.from !== m.from) return;
        if(this._gameOf(code) || this._gameOf(inv.from)) return;
        this._start(inv.from, code, inv.moves, inv.white);
      }

      else if(m.a === 'decline'){
        const inv = st.invites[code];
        if(inv && inv.from === m.from) delete st.invites[code];
      }

      else if(m.a === 'move'){
        const g = this._gameOf(code);
        if(!g) return;
        const r = chessReplay(g.moves);
        if(!r.ok) return;
        if((r.pos.w ? 'w' : 'b') !== chSide(g, code)) return;      // not your turn
        const mv = chessParse(r.pos, m.uci);
        if(!mv) return;                                            // not a legal move
        g.moves.push(chessUci(mv));
        g.at = Date.now();
        const after = chessReplay(g.moves);
        const res = chessResult(after.pos, after.keys);
        if(res.over){
          g.over = {
            winner:res.winner, reason:res.reason,
            by:res.winner ? (chSide(g, g.codes[0]) === res.winner ? g.codes[0] : g.codes[1]) : null,
          };
        }
      }

      else if(m.a === 'resign'){
        const g = this._gameOf(code);
        if(!g) return;
        const them = g.codes[0] === code ? g.codes[1] : g.codes[0];
        g.over = {winner:chSide(g, them), reason:'resignation', by:them};
      }

      else if(m.a === 'again' || m.a === 'reset'){
        const gs = st.games;
        let g = this._gameOf(code);
        if(!g) for(const k in gs) if(gs[k].codes.indexOf(code) >= 0) g = gs[k];
        if(!g) return;
        // colours swap, so nobody is White twice running
        g.white = g.codes[0] === g.white ? g.codes[1] : g.codes[0];
        g.moves = []; g.over = null; g.at = Date.now();
      }

      this._push();
    },

    _viewFor(id){
      const seat = this._seatById(id);
      if(!seat) return {me:'', people:[], game:null};
      const code = seat.code;
      const st = this.state;
      const mine = this._gameOf(code)
        || Object.keys(st.games).map(k=>st.games[k])
             .filter(g=>g.codes.indexOf(code) >= 0)
             .sort((a, b)=>b.at - a.at)[0] || null;

      const people = this._seats().filter(p=>p.code !== code).map(p=>{
        const inv = st.invites[p.code];
        const back = st.invites[code];
        return {
          code:p.code, name:p.name,
          busy:!!this._gameOf(p.code),
          game:!!(mine && !mine.over && mine.codes.indexOf(p.code) >= 0),
          iInvited:!!(inv && inv.from === code),
          invitedMe:!!(back && back.from === p.code),
          resuming:!!(back && back.from === p.code && (back.moves || []).length),
        };
      });

      return {
        me:code,
        people,
        game: mine ? {
          opp: mine.codes[0] === code ? mine.codes[1] : mine.codes[0],
          oppName: mine.names[mine.codes[0] === code ? mine.codes[1] : mine.codes[0]] || 'Them',
          white: mine.white, moves: mine.moves.slice(), over: mine.over,
        } : null,
      };
    },

    _push(){
      if(!syncIsHost()) return;
      syncGamePushAll(this.key, (id)=>this._viewFor(id));
    },
    _pushTo(id){
      if(!syncIsHost()) return;
      syncGamePush(this.key, id, this._viewFor(id));
    },

    /* ================= every window ================= */

    apply(v){
      const before = this.view && this.view.game;
      this.view = v;
      const g = v && v.game;

      // the position, rebuilt from the moves — see the note at the top
      const r = g ? chessReplay(g.moves) : null;
      this.board = r && r.ok ? r.pos : (g ? chessStart() : null);
      this.line = r && r.ok ? r.list : [];

      if(g){
        /* A live board arriving that you weren't looking at means something
           happened for you — an invite you accepted, or somebody accepting
           yours — so take you to it. A *finished* one doesn't: the last game
           you played stays reachable, but landing on a board that's over
           instead of on the list is not what anybody wants from a break. */
        if((!before || before.opp !== g.opp) && !g.over) this.lobby = false;
        if(before && before.moves.length !== g.moves.length) this.sel = -1;
        this.remember(g);
        if(g.over && (!before || !before.over)) this._cheer(g);
      }else{
        this.lobby = true;
      }
      this.render();
      try{ Arcade._refresh(); }catch(e){}
    },

    remember(g){
      this.saved[g.opp] = {
        name:g.oppName, white:g.white, me:this.view.me,
        moves:g.moves.slice(), over:g.over || null, at:Date.now(),
      };
      this.persist();
    },

    _cheer(g){
      const won = g.over.winner && g.over.by === this.view.me;
      chime(false);
      showBanner('ch-banner',
        !g.over.winner ? 'A draw.' : won ? 'You won.' : T('{name} won.', {name:g.oppName}),
        g.over.reason === 'resignation'
          ? (won ? T('{name} resigned.', {name:g.oppName}) : 'You resigned.')
          : g.over.reason === 'checkmate' ? 'Checkmate.'
          : T('Drawn by {why}.', {why:T(g.over.reason)}));
      setTimeout(()=>{ const b = $('ch-banner'); if(b) b.classList.add('hide'); }, 4200);
    },

    /* ---- drawing ---- */
    render(){
      if(!$('ch-board')) return;
      const inRoom = syncActive();
      const v = this.view;
      const g = v && v.game;
      const showBoard = !!(inRoom && g && !this.lobby);

      $('ch-need').classList.toggle('hide', inRoom);
      $('ch-lobby').classList.toggle('hide', !inRoom || showBoard);
      $('ch-live').classList.toggle('hide', !showBoard);
      $('ch-back').classList.toggle('hide', !showBoard);
      $('ch-meta').textContent = !inRoom ? '' : showBoard ? '' : 'Pick an opponent';
      if(!inRoom) return;
      if(showBoard) this._renderBoard(g); else this._renderLobby(v);
    },

    _renderLobby(v){
      const people = (v && v.people) || [];
      const saved = this.saved;

      $('ch-people').innerHTML = people.length ? people.map(p=>{
        const s = saved[p.code];
        const half = s && !s.over && (s.moves || []).length;
        const sub = p.invitedMe ? (p.resuming ? 'Wants to pick your game back up' : 'Wants a game')
          : p.iInvited ? 'Asked: waiting for them'
          : p.game ? 'You’re playing'
          : p.busy ? 'In a game with someone else'
          : half ? T('Left off at move {n}', {n:Math.ceil(half / 2)})
          : 'Free';
        const cta = p.invitedMe ? 'Accept' : p.game ? 'Open' : p.iInvited ? 'Asked'
          : p.busy ? ', ' : half ? 'Pick it up' : 'Play';
        return '<div class="ch-person'+(p.invitedMe?' asks':'')+'">'
          + '<button class="ch-pick" data-code="'+esc(p.code)+'"'+(p.busy && !p.game ? ' disabled' : '')+'>'
          + '<b>'+esc(p.name)+'</b><em>'+esc(sub)+'</em><span>'+cta+'</span></button>'
          + (p.invitedMe ? '<button class="ch-no" data-code="'+esc(p.code)+'" data-act="decline">No thanks</button>' : '')
          + '</div>';
      }).join('') : '<p class="ch-note">Nobody else is here yet. Share your code from Focus together.</p>';

      // games with people who aren't in the room right now
      const here = people.map(p=>p.code);
      const away = Object.keys(saved).filter(c=>here.indexOf(c) < 0);
      $('ch-saved-head').classList.toggle('hide', !away.length);
      $('ch-saved').innerHTML = away.map(c=>{
        const s = saved[c];
        const n = (s.moves || []).length;
        const sub = s.over ? 'Finished' : n ? T('Move {n} · they’re not here', {n:Math.ceil(n / 2)}) : 'Not started';
        return '<div class="ch-person away">'
          + '<button class="ch-pick" data-code="'+esc(c)+'" disabled>'
          + '<b>'+esc(s.name || 'Someone')+'</b><em>'+esc(sub)+'</em></button>'
          + '<button class="ch-no" data-code="'+esc(c)+'" data-act="forget">Forget</button>'
          + '</div>';
      }).join('');

      $('ch-note').textContent = away.length
        ? 'A game waits for whenever you’re both in a room again.' : '';
    },

    _renderBoard(g){
      const pos = this.board;
      const side = this.mySide();
      const flip = side === 'b';
      const mine = this.myTurn();
      const legal = mine ? chessMoves(pos) : [];
      const targets = this.sel >= 0 ? legal.filter(m=>m.from === this.sel).map(m=>m.to) : [];
      const last = this.line.length ? this.line[this.line.length - 1] : null;
      const checked = chessInCheck(pos) ? chessKingSq(pos.b, pos.w) : -1;

      let html = '';
      for(let i = 0; i < 64; i++){
        const sq = flip ? 63 - i : i;
        const p = pos.b[sq];
        const dark = (chR(sq) + chF(sq)) % 2 === 1;
        const cls = ['ch-sq', dark ? 'dark' : 'light'];
        if(sq === this.sel) cls.push('sel');
        if(targets.indexOf(sq) >= 0) cls.push(p ? 'take' : 'go');
        if(last && (sq === last.from || sq === last.to)) cls.push('last');
        if(sq === checked) cls.push('check');
        html += '<button class="'+cls.join(' ')+'" data-sq="'+sq+'"'
          + ' aria-label="'+chName(sq)+(p ? ' ' + CH_FULL[p.toLowerCase()] : '')+'">'
          + (p ? '<span class="ch-p'+(chWhite(p) ? ' w' : ' b')+'">'+CH_GLYPH[p]+'</span>' : '')
          + '</button>';
      }
      $('ch-board').innerHTML = html;

      // material: what each of you has taken, and who is up
      const gone = this._taken(pos.b);
      const mineTaken = side === 'w' ? gone.black : gone.white;
      const theirs = side === 'w' ? gone.white : gone.black;
      const edge = mineTaken.pts - theirs.pts;
      $('ch-taken-top').innerHTML = this._takenRow(theirs, -edge);
      $('ch-taken-bottom').innerHTML = this._takenRow(mineTaken, edge);

      $('ch-vs').innerHTML = '<b>'+esc(g.oppName)+'</b><em>'
        + esc(T(side === 'w' ? 'you play White' : 'you play Black')) + '</em>';

      const turn = $('ch-turn');
      turn.textContent = g.over ? 'Over'
        : mine ? (chessInCheck(pos) ? 'Your move, check' : 'Your move')
        : T('{name}’s move', {name:g.oppName});
      turn.classList.toggle('yours', mine && !g.over);

      $('ch-msg').textContent = g.over
        ? (!g.over.winner ? T('Drawn by {why}.', {why:T(g.over.reason)})
           /* Whole sentences per outcome: who won, how, and who resigned
              change places between languages, so no two of them are glued. */
           : g.over.by === this.view.me
             ? (g.over.reason === 'checkmate' ? T('You won by checkmate.')
                : g.over.reason === 'resignation' ? T('You won. They resigned.')
                : T('You won by {why}.', {why:T(g.over.reason)}))
             : (g.over.reason === 'checkmate' ? T('{name} won by checkmate.', {name:g.oppName})
                : g.over.reason === 'resignation' ? T('{name} won, you resigned.', {name:g.oppName})
                : T('{name} won by {why}.', {name:g.oppName, why:T(g.over.reason)})))
        : this.sel >= 0 ? 'Tap a highlighted square, or tap the piece again to put it back.'
        : mine ? 'Tap a piece to see where it can go.'
        : 'Leave it here and come back. It keeps its place.';

      // the moves, in pairs, most recent visible
      const rows = [];
      for(let i = 0; i < this.line.length; i += 2){
        rows.push('<span class="ch-mv"><i>'+(i / 2 + 1)+'.</i>'
          + esc(this.line[i].san) + (this.line[i + 1] ? ' ' + esc(this.line[i + 1].san) : '') + '</span>');
      }
      const moves = $('ch-moves');
      moves.innerHTML = rows.join('') || '<span class="ch-mv empty">No moves yet</span>';
      moves.scrollLeft = moves.scrollWidth;

      $('ch-resign').classList.toggle('hide', !!g.over);
      $('ch-again').classList.toggle('hide', !g.over);
      $('ch-leave').textContent = g.over ? 'Back to the list' : 'Leave it here';

      const promo = $('ch-promo');
      promo.classList.toggle('hide', !this.pendPromo);
      if(this.pendPromo){
        $('ch-promo-row').innerHTML = CH_PROMOS.map(p=>
          '<button class="ch-promo-b" data-p="'+p+'">'
          + CH_GLYPH[side === 'w' ? p.toUpperCase() : p]
          + '<em>'+CH_FULL[p]+'</em></button>').join('');
      }
    },

    /** What has been captured, worked out from what's left on the board. */
    _taken(b){
      const full = {p:8, n:2, b:2, r:2, q:1};
      const left = {w:{}, b:{}};
      for(const k in full){ left.w[k] = 0; left.b[k] = 0; }
      for(const p of b){
        if(!p || p.toLowerCase() === 'k') continue;
        left[chWhite(p) ? 'w' : 'b'][p.toLowerCase()]++;
      }
      const out = {};
      for(const side of ['w', 'b']){
        const men = []; let pts = 0;
        for(const k in full){
          // a promoted pawn can leave you with more queens than you started with
          const n = Math.max(0, full[k] - left[side][k]);
          for(let i = 0; i < n; i++){ men.push(side === 'w' ? k.toUpperCase() : k); pts += CH_VALUE[k]; }
        }
        out[side === 'w' ? 'white' : 'black'] = {men, pts};
      }
      return out;
    },
    _takenRow(t, edge){
      return t.men.map(p=>'<span class="ch-gone">'+CH_GLYPH[p]+'</span>').join('')
        + (edge > 0 ? '<em>+'+edge+'</em>' : '');
    },
  };

  syncGameRegister('chess', {
    intent(from, m){ Chess._intent(from, m); },
    apply(v){ Chess.apply(v); },
    roster(){ Chess._ensure(); },
    /* The boards travel when the room does. Chess needs the least care of the
       four: every game in here is already filed under the two players' friend
       codes, which never change at all. */
    save(){ return Chess.state; },
    load(s){ Chess.state = s; Chess._ensure(); },
  });

  forgetGame(CH_SAVE, ()=>{ Chess.loaded = false; Chess.saved = {}; });

  registerGame('chess', {
    el:'game-chess', title:'Chess', progEl:'prog-chess',
    game:()=>Chess,
    canReset:()=>!!(Chess.view && Chess.view.game),
    reset(){ syncGameSend(Chess.key, {a:'again'}); },
    resetNote:'The board goes back to the opening and you swap colours.',
    async progress(){
      /* **Nothing.** The group heading above these four already says "needs a
         room", and the card's own chip says how many people — three ways of
         saying the same thing, stacked on top of each other in the same
         corner. An empty status collapses; see `.pcard .prog:empty`. */
      if(!syncActive()) return '';
      const g = Chess.view && Chess.view.game;
      if(g && !g.over) return Chess.myTurn() ? 'You<span>your move</span>' : 'Them<span>their move</span>';
      const saved = Object.keys(Chess.saved).filter(c=>!Chess.saved[c].over).length;
      if(saved) return saved + '<span>left off</span>';
      return 'Ready<span>pick someone</span>';
    }
  });
