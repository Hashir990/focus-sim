  /* ================================================================
     FRIENDS, REQUESTS AND PROFILES
     ================================================================

     **A friend is a person, not a code.**

     Focus together used to be a list of six-letter codes with a nickname you
     typed yourself — so the same person was "Sam" on one device and "sam2" on
     another, and nobody could tell whether a code they had been given was even
     real until they tried to join it. Three things change that, and they all
     lean on one fact that was already true:

       **a code is a hash of a username.** `syncCodeFor(name)` in 29-sync.js is
       deterministic, and since one account holds one code, knowing somebody's
       username is knowing their address. So there is no directory to look up
       and no server to ask — typing a username *is* finding them.

     From that:

       * **Friends are stored under their username** and shown under it. The
         nickname field is gone. Old entries have only a code; they keep
         working and are shown by their code until the person is re-added.

       * **A request is a message**, carried by the same mail path everything
         else uses — peer first, the mailbox if they are closed. That path
         moves `{id, name, text, at}` and nothing else, so a request travels as
         a `text` beginning with a sentinel and is pulled out of the stream
         before it reaches the chat log. No new endpoint, no server change, no
         deploy. See `friendIsWire` below.

       * **A profile is a card the person sends you**, not something the app
         fetches. It rides on the request, on the reply, and on `hello` in a
         room — so it is exactly as fresh as the last time you were in touch,
         and it says so. This is the honest version: the app has never had a
         server that knows what you did, and a profile page is not a good
         enough reason to build one.

     **Why a request at all**, when the code is derivable? Two reasons that are
     not technical: the other person gets to agree to being on a list, and the
     exchange is what carries their card. Adding somebody puts them in your
     list as *asked*; they become a friend when they accept.

     Nothing here is private. A card holds hours focused, puzzles solved and a
     drawing of a buddy — the same things two people in a room can already see
     about each other. */

  /* **The sentinel is a control character, written as an escape.**
     A request travels as a message's `text`, so the marker has to be something
     a person cannot type — "fr:" alone is a thing somebody could plausibly
     send, and it would vanish out of their conversation. U+0001 cannot come
     off a keyboard. It is written `\u0001` rather than pasted, because an
     invisible byte in a string literal is a thing nobody can review. */
  const FRIEND_WIRE = '\u0001fr:';
  const FRIEND_ASK = 'ask', FRIEND_YES = 'yes', FRIEND_NO = 'no', FRIEND_CARD = 'card';
  /* Requests waiting for an answer, `{u, name, code, card, at}` by code.
     Kept with the friends list, because an unanswered request is a thing you
     came back to the app to deal with. */

  /** The username this device answers to, or '' when signed out. */
  function friendMe(){
    try{ return (Account.token && Account.username) ? String(Account.username) : ''; }
    catch(e){ return ''; }
  }
  /** Tidy a typed username into the form the code is hashed from. */
  function friendName(raw){
    return String(raw || '').trim().replace(/^@+/, '').slice(0, 20);
  }
  function friendCode(user){
    try{ return syncCodeFor(friendName(user).toLowerCase()); }catch(e){ return ''; }
  }

  /* ---------------- the card ----------------

     Everything on it is derived at the moment it is sent. Nothing is stored
     about *you* for this; the numbers come from the log and the puzzle
     calendar, the same places the stats page reads. */
  function friendCard(){
    let hrs = 0, sess = 0;
    try{
      for(const r of (LOG || [])){ const s = Math.max(0, (r && r.secs) || 0); if(s >= 60){ sess++; hrs += s; } }
      hrs = Math.round(hrs / 360) / 10;                 // one decimal place
    }catch(e){}
    const g = {};
    try{
      const sud = ['easy', 'medium', 'hard'].reduce((n, d)=>
        n + dailyAll('sudoku', d).filter(r=>r.s === 2).length, 0);
      const runs = ['easy', 'medium', 'hard'].map(d=>dailyStreak('sudoku', d));
      const words = dailyAll('wordle', '').filter(r=>r.s === 2 && r.w);
      const avg = words.length ? words.reduce((n, r)=>n + (r.g || 0), 0) / words.length : 0;
      const cross = [5, 7, 9, 15].reduce((n, k)=>
        n + dailyAll('crossword', String(k)).filter(r=>r.s === 2).length, 0);
      g.sud = sud;
      g.run = Math.max.apply(null, runs.concat([0]));
      g.wrd = words.length;
      g.avg = avg ? Math.round(avg * 10) / 10 : 0;
      g.cw = cross;
    }catch(e){}
    let buddy = null, anim = -1;
    try{ buddy = budSaved(); anim = budAnimSaved(); }catch(e){}
    return {u: friendMe(), n: (SYNC.name || '').slice(0, 24), hrs, sess, g, buddy, anim, at: Date.now()};
  }

  /** Keep what a card is allowed to contain, and nothing else. */
  function friendCardClean(c){
    if(!c || typeof c !== 'object') return null;
    const num = (x, cap)=>{ const n = Number(x); return (isFinite(n) && n >= 0) ? Math.min(n, cap) : 0; };
    const g = (c.g && typeof c.g === 'object') ? c.g : {};
    const out = {
      u: friendName(c.u), n: String(c.n || '').slice(0, 24),
      hrs: num(c.hrs, 1e6), sess: num(c.sess, 1e6),
      g: {sud: num(g.sud, 1e5), run: num(g.run, 1e5), wrd: num(g.wrd, 1e5),
          avg: num(g.avg, 10), cw: num(g.cw, 1e5)},
      anim: (c.anim | 0) >= 0 ? (c.anim | 0) : -1,
      at: num(c.at, 1e15) || Date.now(),
    };
    try{ if(c.buddy) out.buddy = budClean(c.buddy); }catch(e){}
    return out;
  }

  /* ---------------- the list ----------------

     `SYNC.friends` is the same array it always was, so nothing that reads it
     — the probe, the room, the chat — had to change. What is new is that an
     entry may carry `u` (their username), `card`, and `ok` (they said yes).
     An entry with no `u` came from before this and is shown by its code. */
  function friendFind(code){
    const c = syncNormalise(code);
    return SYNC.friends.find(f=>f.code === c) || null;
  }
  function friendByUser(user){
    const u = friendName(user).toLowerCase();
    return SYNC.friends.find(f=>String(f.u || '').toLowerCase() === u) || null;
  }
  /** What to call them: their username, or the code if that is all we have. */
  function friendLabel(f){
    if(!f) return '';
    return f.u || f.name || f.code;
  }
  function friendSet(code, patch){
    const c = syncNormalise(code);
    let f = friendFind(c);
    if(!f){ f = {code: c}; SYNC.friends.push(f); }
    Object.assign(f, patch);
    syncSave();
    try{ syncRender(); }catch(e){}
    return f;
  }

  /* ---------------- asking ---------------- */

  /** Send somebody a friend request, by username. */
  function friendAsk(raw){
    const u = friendName(raw);
    if(u.length < 2){ toast('Type their username'); return; }
    if(!friendMe()){ toast('Sign in first — a request comes from your account'); return; }
    if(u.toLowerCase() === friendMe().toLowerCase()){ toast('That is you'); return; }
    const code = friendCode(u);
    if(!code){ toast('That username will not do'); return; }
    const had = friendFind(code);
    if(had && had.ok){ toast('Already friends with ' + friendLabel(had)); return; }
    friendSet(code, {u, name: u, asked: Date.now()});
    friendWireSend(code, FRIEND_ASK);
    toast('Asked ' + u);
  }

  /** Say yes to one waiting, or no. */
  function friendAccept(code){
    const c = syncNormalise(code);
    const req = (SYNC.asks || {})[c];
    friendSet(c, {u: (req && req.u) || undefined, name: (req && req.u) || undefined,
      ok: 1, card: (req && req.card) || undefined, at: Date.now()});
    friendWireSend(c, FRIEND_YES);
    friendDropAsk(c);
    toast('Friends with ' + friendLabel(friendFind(c)));
  }
  function friendDecline(code){
    const c = syncNormalise(code);
    friendWireSend(c, FRIEND_NO);
    friendDropAsk(c);
  }
  function friendDropAsk(code){
    if(SYNC.asks) delete SYNC.asks[syncNormalise(code)];
    syncSave();
    try{ syncRender(); }catch(e){}
  }
  function friendRemove(code){
    SYNC.friends = SYNC.friends.filter(f=>f.code !== syncNormalise(code));
    syncSave();
    try{ syncRender(); }catch(e){}
  }

  /* ---------------- the wire ----------------

     One mail item, whose `text` is the sentinel, a kind, and a card as JSON.
     It goes down the same path as a message — straight to them if they are
     reachable, into the mailbox if not — and `friendTake` lifts it out before
     the chat log ever sees it. */
  function friendWireSend(code, kind){
    const body = FRIEND_WIRE + kind + ':' + JSON.stringify(friendCard());
    try{ chatSendRaw(syncNormalise(code), body); }catch(e){}
  }
  function friendIsWire(text){
    return typeof text === 'string' && text.indexOf(FRIEND_WIRE) === 0;
  }
  /** Handle one wire item. Returns true when it was machinery, so the caller
      knows to keep it out of the conversation. */
  function friendTake(item){
    if(!item || !friendIsWire(item.text)) return false;
    const rest = item.text.slice(FRIEND_WIRE.length);
    const cut = rest.indexOf(':');
    if(cut < 0) return true;
    const kind = rest.slice(0, cut);
    let card = null;
    try{ card = friendCardClean(JSON.parse(rest.slice(cut + 1))); }catch(e){}
    const code = syncNormalise(item.fromCode || (card && friendCode(card.u)) || '');
    if(!code) return true;

    if(kind === FRIEND_ASK){
      /* **Already friends, or already asked them?** Then this is the other half
         of a handshake rather than a new request, and answering it immediately
         is right — two people adding each other at the same time should end up
         friends, not with two notifications each. */
      const had = friendFind(code);
      if(had && (had.ok || had.asked)){
        friendSet(code, {u: (card && card.u) || had.u, name: (card && card.u) || had.name,
          ok: 1, card: card || had.card, at: Date.now()});
        friendWireSend(code, FRIEND_YES);
        return true;
      }
      SYNC.asks = SYNC.asks || {};
      SYNC.asks[code] = {code, u: (card && card.u) || '', card, at: Date.now()};
      syncSave();
      try{ syncRender(); friendPing(card); }catch(e){}
      return true;
    }
    if(kind === FRIEND_YES){
      const had = friendFind(code);
      friendSet(code, {u: (card && card.u) || (had && had.u), name: (card && card.u) || (had && had.name),
        ok: 1, asked: 0, card: card || (had && had.card), at: Date.now()});
      try{ toast(((card && card.u) || 'They') + ' accepted'); }catch(e){}
      return true;
    }
    if(kind === FRIEND_NO){
      const had = friendFind(code);
      if(had && !had.ok) friendRemove(code);
      return true;
    }
    if(kind === FRIEND_CARD){
      const had = friendFind(code);
      if(had && card) friendSet(code, {card, at: Date.now()});
      return true;
    }
    return true;
  }
  function friendPing(card){
    if(chatQuietHours && chatQuietHours()) return;
    try{ blip(); buzz(14); }catch(e){}
    try{ toast(((card && card.u) || 'Someone') + ' wants to be friends'); }catch(e){}
  }

  /** Somebody in the room said hello and sent a card with it. */
  function friendSawCard(code, card){
    const c = syncNormalise(code);
    const clean = friendCardClean(card);
    if(!c || !clean) return;
    const had = friendFind(c);
    if(had) friendSet(c, {card: clean, u: had.u || clean.u || undefined, at: Date.now()});
    /* Not a friend, but you are sitting in a room with them — so their card is
       worth keeping for the length of the room, which is what makes the people
       list tappable. */
    SYNC.cards = SYNC.cards || {};
    SYNC.cards[c] = clean;
  }
  /** The best card we have for a code, from either place. */
  function friendCardOf(code){
    const c = syncNormalise(code);
    const f = friendFind(c);
    if(f && f.card) return f.card;
    return (SYNC.cards && SYNC.cards[c]) || null;
  }

  /** How stale a card is, in words. */
  function friendWhen(at){
    const ms = Date.now() - (Number(at) || 0);
    if(!(ms > 0) || ms < 6e4) return 'just now';
    const m = Math.floor(ms / 6e4);
    if(m < 60) return m + ' min ago';
    const h = Math.floor(m / 60);
    if(h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    const d = Math.floor(h / 24);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }

  /* ---------------- what a card looks like ----------------

     One block, used twice: at the top of Focus together for yourself, and on a
     friend's profile. Same shape both times on purpose — what you are shown
     about somebody is exactly what they are shown about you, and seeing your
     own is the plainest way to say so. */
  function friendStatsHtml(card){
    if(!card) return '';
    const g = card.g || {};
    const tile = (v, n)=>'<div class="ft-stat"><b>' + esc(String(v)) + '</b><span>'
      + esc(n) + '</span></div>';
    return '<div class="ft-stats">'
      + tile(card.hrs ? card.hrs + 'h' : '0h', 'focused')
      + tile(card.sess || 0, 'sessions')
      + tile(g.run || 0, 'day streak')
      + '</div>'
      + '<div class="ft-stats">'
      + tile(g.sud || 0, 'sudoku')
      + tile(g.wrd || 0, 'words')
      + tile(g.cw || 0, 'crosswords')
      + '</div>';
  }

  /* ---------------- the profile page ---------------- */
  const Prof = {
    code:'',
    open(code){
      const c = syncNormalise(code);
      if(!c || !$('prof-overlay')) return;
      this.code = c;
      $('prof-overlay').classList.remove('hide');
      this.render();
    },
    close(){ const el = $('prof-overlay'); if(el) el.classList.add('hide'); },
    render(){
      const box = $('prof-body');
      if(!box) return;
      const f = friendFind(this.code);
      const card = friendCardOf(this.code);
      const who = friendLabel(f) || (card && card.u) || this.code;
      const t = $('prof-title');
      if(t) t.textContent = who;

      if(!card){
        /* **Nothing to show, and why.** There is no server here that knows what
           anybody did — a profile is a card they hand over, so before you have
           been in touch there is honestly nothing to draw. */
        box.innerHTML = '<div class="ft-me"><div class="ft-me-top">'
          + '<div class="ft-me-who"><b>' + esc(who) + '</b>'
          + '<span>' + esc(f && f.ok ? 'Nothing shared yet' : 'Waiting for them to accept') + '</span>'
          + '</div></div></div>'
          + '<p class="cal-empty">Their stats arrive the next time you are in a '
          + 'room together, or when they accept.</p>'
          + this._acts(f);
        this._wire();
        return;
      }
      box.innerHTML = '<div class="ft-me"><div class="ft-me-top">'
        + (Buddy.shown() && card.buddy ? '<span class="ft-face">' + budSvg(card.buddy, 46) + '</span>' : '')
        + '<div class="ft-me-who"><b>' + esc(who) + '</b>'
        + '<span>as of ' + esc(friendWhen(card.at)) + '</span></div>'
        + '</div>' + friendStatsHtml(card) + '</div>'
        + (card.g && card.g.avg
            ? '<p class="ft-note">Finds the word in ' + esc(String(card.g.avg)) + ' guesses on average.</p>'
            : '')
        + this._acts(f);
      this._wire();
    },
    _acts(f){
      const room = SYNC.inRoom && SYNC.inRoom[this.code];
      return '<div class="ft-acts">'
        + '<button class="primary" id="prof-join">' + (room ? 'Join their room' : 'Try their room') + '</button>'
        + '<button class="mini-btn" id="prof-msg">Message</button>'
        + '</div>';
    },
    _wire(){
      const j = $('prof-join');
      if(j) j.onclick = ()=>{ Prof.close(); syncJoin(Prof.code); };
      const m = $('prof-msg');
      if(m) m.onclick = ()=>{ Prof.close(); try{ chatOpenWith(Prof.code); }catch(e){} };
    },
  };
  function profOpen(code){ Prof.open(code); }
  if($('prof-close')) $('prof-close').onclick = ()=>Prof.close();
