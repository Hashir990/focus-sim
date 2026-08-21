  /* ---------------- CHESS — the rules ----------------
     Pure, like the Scrabble judge next door and for the same reason: the host
     has to decide whether a move is legal, and every other window has to draw
     the same legal-move dots before anyone sends anything. Two implementations
     of "can this piece go there" would disagree inside a week.

     No DOM, no network, no state of its own. A position goes in, a list of
     moves comes out. Everything else in 36-chess.js is presentation.

     A position is:
       { b:[64] pieces, w:true if White to move, cr:'KQkq' castling rights,
         ep:index behind a pawn that just went two squares, or -1,
         half:moves since a pawn move or capture, full:move number }

     Board order is reading order: index 0 is a8, index 63 is h1. So rank
     0 is Black's back rank and White moves towards *smaller* indices. That's
     the opposite of the usual engine convention and it is worth it — it means
     an array of 64 squares draws straight onto a grid with no flipping, and the
     only place the direction matters is pawns.

     Pieces are letters, uppercase for White: PNBRQK / pnbrqk. Empty is ''.   */

  const CH_FILES = 'abcdefgh';
  const CH_PROMOS = ['q', 'r', 'b', 'n'];

  function chSq(r, f){ return r * 8 + f; }
  function chR(sq){ return (sq / 8) | 0; }
  function chF(sq){ return sq % 8; }
  function chOn(r, f){ return r >= 0 && r < 8 && f >= 0 && f < 8; }
  function chWhite(p){ return !!p && p === p.toUpperCase(); }
  function chMine(p, w){ return !!p && chWhite(p) === w; }
  function chName(sq){ return CH_FILES[chF(sq)] + (8 - chR(sq)); }
  function chIndex(name){
    const f = CH_FILES.indexOf(String(name)[0]);
    const r = 8 - parseInt(String(name)[1], 10);
    return chOn(r, f) ? chSq(r, f) : -1;
  }

  function chessStart(){
    const b = new Array(64).fill('');
    const back = 'rnbqkbnr';
    for(let f = 0; f < 8; f++){
      b[chSq(0, f)] = back[f];
      b[chSq(1, f)] = 'p';
      b[chSq(6, f)] = 'P';
      b[chSq(7, f)] = back[f].toUpperCase();
    }
    return {b, w:true, cr:'KQkq', ep:-1, half:0, full:1};
  }

  /* ---- what attacks what ----
     Asked from the square's point of view rather than by generating every
     enemy move: "is there a knight a knight's-move away, a pawn diagonally in
     front, a rook or queen along a rank". Cheaper, and it can be asked about an
     empty square, which is what castling needs. */
  const CH_KNIGHT = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  const CH_DIAG = [[-1,-1],[-1,1],[1,-1],[1,1]];
  const CH_ORTHO = [[-1,0],[1,0],[0,-1],[0,1]];

  function chessAttacked(b, sq, byWhite){
    const r = chR(sq), f = chF(sq);

    // pawns: a White pawn attacks upwards, so it sits one rank *below* the square
    const pr = byWhite ? r + 1 : r - 1;
    const pawn = byWhite ? 'P' : 'p';
    for(const df of [-1, 1]){
      if(chOn(pr, f + df) && b[chSq(pr, f + df)] === pawn) return true;
    }

    const knight = byWhite ? 'N' : 'n';
    for(const [dr, df] of CH_KNIGHT){
      if(chOn(r + dr, f + df) && b[chSq(r + dr, f + df)] === knight) return true;
    }

    const king = byWhite ? 'K' : 'k';
    for(const [dr, df] of CH_DIAG.concat(CH_ORTHO)){
      if(chOn(r + dr, f + df) && b[chSq(r + dr, f + df)] === king) return true;
    }

    const rook = byWhite ? 'R' : 'r', bish = byWhite ? 'B' : 'b', queen = byWhite ? 'Q' : 'q';
    for(const [dirs, piece] of [[CH_ORTHO, rook], [CH_DIAG, bish]]){
      for(const [dr, df] of dirs){
        let rr = r + dr, ff = f + df;
        while(chOn(rr, ff)){
          const p = b[chSq(rr, ff)];
          if(p){ if(p === piece || p === queen) return true; break; }
          rr += dr; ff += df;
        }
      }
    }
    return false;
  }

  function chessKingSq(b, white){
    const k = white ? 'K' : 'k';
    for(let i = 0; i < 64; i++) if(b[i] === k) return i;
    return -1;
  }

  /** Is the side to move (or the side you name) currently in check? */
  function chessInCheck(pos, white){
    const w = white === undefined ? pos.w : white;
    const k = chessKingSq(pos.b, w);
    return k >= 0 && chessAttacked(pos.b, k, !w);
  }

  /* ---- move generation ----
     Pseudo-legal first, then anything that leaves your own king in check is
     thrown away. Slower than doing it properly with pins, and completely
     irrelevant at this scale: a position has forty-odd moves and a person is
     about to spend twenty seconds looking at them. */
  function chessPseudo(pos){
    const b = pos.b, w = pos.w, out = [];
    const add = (from, to, promo) => out.push(promo ? {from, to, promo} : {from, to});

    for(let sq = 0; sq < 64; sq++){
      const p = b[sq];
      if(!chMine(p, w)) continue;
      const r = chR(sq), f = chF(sq), kind = p.toLowerCase();

      if(kind === 'p'){
        const dr = w ? -1 : 1;
        const last = w ? 0 : 7;
        const home = w ? 6 : 1;
        const one = chSq(r + dr, f);
        if(chOn(r + dr, f) && !b[one]){
          if(r + dr === last) for(const q of CH_PROMOS) add(sq, one, q);
          else{
            add(sq, one);
            const two = chSq(r + 2 * dr, f);
            if(r === home && !b[two]) add(sq, two);
          }
        }
        for(const df of [-1, 1]){
          if(!chOn(r + dr, f + df)) continue;
          const to = chSq(r + dr, f + df);
          const t = b[to];
          const takes = (t && !chMine(t, w)) || to === pos.ep;
          if(!takes) continue;
          if(r + dr === last) for(const q of CH_PROMOS) add(sq, to, q);
          else add(sq, to);
        }
        continue;
      }

      if(kind === 'n' || kind === 'k'){
        const steps = kind === 'n' ? CH_KNIGHT : CH_DIAG.concat(CH_ORTHO);
        for(const [dr, df] of steps){
          if(!chOn(r + dr, f + df)) continue;
          const to = chSq(r + dr, f + df);
          if(!chMine(b[to], w)) add(sq, to);
        }
        continue;
      }

      const dirs = kind === 'r' ? CH_ORTHO : kind === 'b' ? CH_DIAG : CH_DIAG.concat(CH_ORTHO);
      for(const [dr, df] of dirs){
        let rr = r + dr, ff = f + df;
        while(chOn(rr, ff)){
          const to = chSq(rr, ff);
          if(b[to]){ if(!chMine(b[to], w)) add(sq, to); break; }
          add(sq, to);
          rr += dr; ff += df;
        }
      }
    }

    /* Castling. The right has to still exist, the squares between have to be
       empty, and you may not castle out of, through, or into check — the last
       of those is left to the legality filter, which throws away any move that
       ends with your king attacked. */
    const home = w ? 7 : 0;
    const king = chSq(home, 4);
    const rights = w ? ['K', 'Q'] : ['k', 'q'];
    if(b[king] === (w ? 'K' : 'k') && !chessAttacked(b, king, !w)){
      if(pos.cr.indexOf(rights[0]) >= 0 && !b[chSq(home, 5)] && !b[chSq(home, 6)]
         && !chessAttacked(b, chSq(home, 5), !w)) add(king, chSq(home, 6));
      if(pos.cr.indexOf(rights[1]) >= 0 && !b[chSq(home, 3)] && !b[chSq(home, 2)]
         && !b[chSq(home, 1)] && !chessAttacked(b, chSq(home, 3), !w)) add(king, chSq(home, 2));
    }
    return out;
  }

  function chessMoves(pos){
    const out = [];
    for(const mv of chessPseudo(pos)){
      const nx = chessMake(pos, mv);
      if(!chessInCheck(nx, pos.w)) out.push(mv);
    }
    return out;
  }

  /** All the legal moves from one square, for drawing the dots. */
  function chessMovesFrom(pos, from){ return chessMoves(pos).filter(m => m.from === from); }

  function chessFind(pos, from, to, promo){
    return chessMoves(pos).find(m =>
      m.from === from && m.to === to && (m.promo || '') === (promo || '')) || null;
  }

  /** A new position. The old one is never touched — undo is just the old object. */
  function chessMake(pos, mv){
    const b = pos.b.slice();
    const p = b[mv.from];
    const kind = p.toLowerCase();
    const w = pos.w;
    const taken = b[mv.to];
    let ep = -1, cr = pos.cr;

    b[mv.to] = mv.promo ? (w ? mv.promo.toUpperCase() : mv.promo) : p;
    b[mv.from] = '';

    if(kind === 'p'){
      if(mv.to === pos.ep) b[chSq(chR(mv.from), chF(mv.to))] = '';       // the pawn beside you
      if(Math.abs(chR(mv.to) - chR(mv.from)) === 2) ep = chSq((chR(mv.to) + chR(mv.from)) / 2, chF(mv.from));
    }
    if(kind === 'k'){
      if(mv.to - mv.from === 2){ b[mv.to - 1] = b[mv.to + 1]; b[mv.to + 1] = ''; }   // O-O
      if(mv.from - mv.to === 2){ b[mv.to + 1] = b[mv.to - 2]; b[mv.to - 2] = ''; }   // O-O-O
      cr = cr.replace(w ? /[KQ]/g : /[kq]/g, '');
    }
    // a rook that moves, or is captured on its home square, takes its right with it
    const corners = {56:'Q', 63:'K', 0:'q', 7:'k'};
    for(const sq of [mv.from, mv.to]){
      if(corners[sq]) cr = cr.replace(corners[sq], '');
    }

    return {
      b, w:!w, cr:cr || '-', ep,
      half: (kind === 'p' || taken) ? 0 : pos.half + 1,
      full: pos.full + (w ? 0 : 1),
    };
  }

  /* ---- naming moves ----
     Standard notation, because the move list is for a person to read: Nf3,
     exd5, O-O, e8=Q+, Qxf7#. Disambiguation follows the usual rule — file if
     that's enough, then rank, then both. */
  function chessSan(pos, mv, legal){
    const p = pos.b[mv.from], kind = p.toLowerCase();
    const takes = !!pos.b[mv.to] || (kind === 'p' && mv.to === pos.ep);
    const after = chessMake(pos, mv);
    const check = chessInCheck(after);
    const mated = check && !chessMoves(after).length;
    const tail = mated ? '#' : check ? '+' : '';

    if(kind === 'k' && Math.abs(mv.to - mv.from) === 2){
      return (mv.to > mv.from ? 'O-O' : 'O-O-O') + tail;
    }
    if(kind === 'p'){
      return (takes ? CH_FILES[chF(mv.from)] + 'x' : '') + chName(mv.to)
        + (mv.promo ? '=' + mv.promo.toUpperCase() : '') + tail;
    }

    const all = (legal || chessMoves(pos)).filter(m =>
      m.to === mv.to && m.from !== mv.from && pos.b[m.from] === p);
    let where = '';
    if(all.length){
      const sameFile = all.some(m => chF(m.from) === chF(mv.from));
      const sameRank = all.some(m => chR(m.from) === chR(mv.from));
      where = !sameFile ? CH_FILES[chF(mv.from)]
            : !sameRank ? String(8 - chR(mv.from))
            : chName(mv.from);
    }
    return p.toUpperCase() + where + (takes ? 'x' : '') + chName(mv.to) + tail;
  }

  /* ---- moves on the wire ----
     Four or five characters: e2e4, e7e8q. Short enough that a whole game is a
     few hundred bytes, which is what lets a game be handed to the host to
     restart when two people pick one up again days later. */
  function chessUci(mv){ return chName(mv.from) + chName(mv.to) + (mv.promo || ''); }
  function chessParse(pos, uci){
    const s = String(uci || '');
    if(s.length < 4) return null;
    return chessFind(pos, chIndex(s.slice(0, 2)), chIndex(s.slice(2, 4)), s.slice(4, 5));
  }

  /** Everything that decides a repetition: the board, the turn, the rights. */
  function chessKey(pos){ return pos.b.join('') + '|' + (pos.w ? 'w' : 'b') + '|' + pos.cr + '|' + pos.ep; }

  function chessMaterialDraw(b){
    const men = [];
    for(let i = 0; i < 64; i++){
      const p = b[i];
      if(!p || p.toLowerCase() === 'k') continue;
      men.push({p, dark:(chR(i) + chF(i)) % 2 === 1});
    }
    if(!men.length) return true;                                   // bare kings
    if(men.length === 1) return 'nb'.indexOf(men[0].p.toLowerCase()) >= 0;
    if(men.length === 2 && men.every(m => m.p.toLowerCase() === 'b')){
      return men[0].dark === men[1].dark && chWhite(men[0].p) !== chWhite(men[1].p);
    }
    return false;
  }

  /** Is the game over, and why. `keys` is every position key so far, this one last. */
  function chessResult(pos, keys){
    const moves = chessMoves(pos);
    if(!moves.length){
      if(chessInCheck(pos)) return {over:true, winner:pos.w ? 'b' : 'w', reason:'checkmate'};
      return {over:true, winner:null, reason:'stalemate'};
    }
    if(pos.half >= 100) return {over:true, winner:null, reason:'the fifty-move rule'};
    if(chessMaterialDraw(pos.b)) return {over:true, winner:null, reason:'not enough pieces left'};
    if(keys && keys.length){
      const here = keys[keys.length - 1];
      let n = 0;
      for(const k of keys) if(k === here) n++;
      if(n >= 3) return {over:true, winner:null, reason:'the same position three times'};
    }
    return {over:false, winner:null, reason:''};
  }

  /* ---- replaying a game from its moves ----
     The only thing ever stored or sent is the list of moves, so this is how a
     position comes back — on resume, on joining, and in every window that is
     shown a game it wasn't playing. It also validates: a list that doesn't
     replay cleanly is refused rather than half-applied, which is what stops a
     doctored move list from putting a bogus position on the host. */
  function chessReplay(uciList){
    let pos = chessStart();
    const keys = [chessKey(pos)];
    const list = [];
    for(const uci of (uciList || [])){
      const mv = chessParse(pos, uci);
      if(!mv) return {ok:false, pos, list, keys, at:list.length};
      list.push({uci:chessUci(mv), san:chessSan(pos, mv), from:mv.from, to:mv.to});
      pos = chessMake(pos, mv);
      keys.push(chessKey(pos));
    }
    return {ok:true, pos, list, keys, at:-1};
  }
