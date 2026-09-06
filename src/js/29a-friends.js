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
  /* Removing somebody. Sent to them, and it takes you off their list too — see
     `friendRemove`. */
  const FRIEND_BYE = 'bye';
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
  /** **Days in a row with a block finished on them.**

      Walked backwards from today over the session log. Today is a grace day —
      a streak does not break because it is four in the afternoon and you have
      not sat down yet — but yesterday missing does break it, which is the same
      rule the puzzle streaks use. Blocks under a minute do not count, for the
      same reason they do not appear in the history.

      This is the streak that belongs on a *focus* app's profile. It used to
      show the sudoku streak, which is a fine number and is not what anybody
      reading a focus profile assumes "day streak" means. */
  function friendFocusStreak(){
    const days = Object.create(null);
    try{
      for(const r of (LOG || [])){
        if(!r || (r.secs | 0) < 60) continue;
        const d = r.day || (r.ts ? dayKey(r.ts) : '');
        if(d) days[d] = 1;
      }
    }catch(e){ return 0; }
    let n = 0, first = true, guard = 0;
    let t = new Date();
    while(guard++ < 800){
      const k = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0')
              + '-' + String(t.getDate()).padStart(2, '0');
      if(days[k]) n++;
      else if(!first) break;
      first = false;
      t = new Date(t.getTime() - 864e5);
    }
    return n;
  }

  function friendCard(){
    let hrs = 0, sess = 0;
    try{
      for(const r of (LOG || [])){ const s = Math.max(0, (r && r.secs) || 0); if(s >= 60){ sess++; hrs += s; } }
      hrs = Math.round(hrs / 360) / 10;                 // one decimal place
    }catch(e){}
    let run = 0, own = 0;
    try{ run = friendFocusStreak(); }catch(e){}
    /* Things bought, not things owned: the first look is free and everybody has
       it, so counting it would give a brand new account a 1. */
    try{ own = Math.max(0, (Embers.own || []).filter(id=>id !== 'seaglass').length); }catch(e){}
    const g = {};
    try{
      const sud = ['easy', 'medium', 'hard'].reduce((n, d)=>
        n + dailyAll('sudoku', d).filter(r=>r.s === 2).length, 0);

      const words = dailyAll('wordle', '').filter(r=>r.s === 2 && r.w);
      const avg = words.length ? words.reduce((n, r)=>n + (r.g || 0), 0) / words.length : 0;
      const cross = [5, 7, 9, 15].reduce((n, k)=>
        n + dailyAll('crossword', String(k)).filter(r=>r.s === 2).length, 0);
      g.sud = sud;
      g.wrd = words.length;
      g.avg = avg ? Math.round(avg * 10) / 10 : 0;
      g.cw = cross;
    }catch(e){}
    /* The two free-play games keep a best rather than a calendar, so a best is
       what there is to show. Read from their saves, which is where the number
       actually lives. */
    try{
      const t = gameSaved('arcade_tetris');
      if(t) g.tet = Math.max(0, (t.best | 0), (t.s | 0));
      const g8 = gameSaved('arcade_2048');
      if(g8) g.g48 = Math.max(0, (g8.best | 0), (g8.score | 0));
    }catch(e){}
    let buddy = null, anim = -1;
    try{ buddy = budSaved(); anim = budAnimSaved(); }catch(e){}
    return {u: friendMe(), n: (SYNC.name || '').slice(0, 24), hrs, sess, run, own,
      g, buddy, anim, at: Date.now()};
  }

  /** Keep what a card is allowed to contain, and nothing else. */
  function friendCardClean(c){
    if(!c || typeof c !== 'object') return null;
    const num = (x, cap)=>{ const n = Number(x); return (isFinite(n) && n >= 0) ? Math.min(n, cap) : 0; };
    const g = (c.g && typeof c.g === 'object') ? c.g : {};
    const out = {
      u: friendName(c.u), n: String(c.n || '').slice(0, 24),
      hrs: num(c.hrs, 1e6), sess: num(c.sess, 1e6),
      run: num(c.run, 1e5), own: num(c.own, 1e4),
      g: {sud: num(g.sud, 1e5), wrd: num(g.wrd, 1e5),
          avg: num(g.avg, 10), cw: num(g.cw, 1e5),
          tet: num(g.tet, 1e9), g48: num(g.g48, 1e9)},
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
  /** **A friendship is one thing, so removing it removes it for both.**

      It used to be one-sided: you took somebody off your list and stayed on
      theirs, still shown as a friend, still able to walk into your room without
      knocking. That is not a friends list, it is two lists that happen to agree
      most of the time, and it is not what anybody means by "remove".

      So it tells them. Over the peer if they are reachable, into the mailbox if
      not — the same path a message takes, so the far side gets it the next time
      the two apps are both open. `quiet` is for handling the message *from*
      them, which must not bounce one back. */
  function friendRemove(code, quiet){
    const c = syncNormalise(code);
    const had = friendFind(c);
    SYNC.friends = SYNC.friends.filter(f=>f.code !== c);
    if(SYNC.asks) delete SYNC.asks[c];
    syncSave();
    if(!quiet && had) friendWireSend(c, FRIEND_BYE);
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
      if(had && !had.ok) friendRemove(code, true);
      return true;
    }
    /* They removed you. Off the list here too, without sending one back — two
       apps politely un-friending each other forever is not a conversation. */
    if(kind === FRIEND_BYE){
      const had = friendFind(code);
      if(had){
        friendRemove(code, true);
        try{ toast(((card && card.u) || had.u || 'Someone') + ' removed you'); }catch(e){}
      }
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
    /* Three rows of three: what you have done, what you have solved, and what
       you have to show for it. The streak is a *focus* streak — days in a row
       with a block finished — because that is what "day streak" means on a
       focus app, whatever the arcade is doing. */
    const num = (n)=>{
      const v = Math.max(0, n | 0);
      return v >= 10000 ? (Math.round(v / 100) / 10) + 'k' : String(v);
    };
    return '<div class="ft-stats">'
      + tile(card.hrs ? card.hrs + 'h' : '0h', 'focused')
      + tile(card.sess || 0, 'sessions')
      + tile(card.run || 0, 'day streak')
      + '</div>'
      + '<div class="ft-stats">'
      + tile(g.sud || 0, 'sudoku')
      + tile(g.wrd || 0, 'words')
      + tile(g.cw || 0, 'crosswords')
      + '</div>'
      + '<div class="ft-stats">'
      + tile(num(g.tet), 'tetris')
      + tile(num(g.g48), '2048')
      + tile(card.own || 0, 'bought')
      + '</div>';
  }

  /* ---------------- what the account carries ----------------

     Identity only. A card is something the person handed *this* device; giving
     a stale one to a phone that has never met them would be the app inventing a
     profile, and the whole design of this is that it never does. The numbers
     turn up the next time you are actually in touch. */
  function friendsSnapshot(){
    return (SYNC.friends || []).map(f=>({
      code: f.code, u: f.u || '', name: f.name || '',
      ok: f.ok ? 1 : 0, asked: f.asked || 0, at: f.at || 0,
    }));
  }
  function friendsAdopt(list){
    if(!Array.isArray(list)) return;
    /* The merged list is the identity; whatever cards this device already holds
       stay attached to the codes they belong to. */
    const cards = Object.create(null);
    for(const f of (SYNC.friends || [])) if(f && f.card) cards[f.code] = f.card;
    SYNC.friends = mergeFriends(SYNC.friends, list).map(f=>
      cards[f.code] ? Object.assign({}, f, {card: cards[f.code]}) : f);
    syncSave();
    try{ syncRender(); }catch(e){}
  }

  /* ---------------- a code, turned back into a name ----------------

     A code is a hash of a username, so nothing here can reverse it — but the
     accounts server holds every username and can. `/account/who` takes a code
     and answers with the name, or with nothing when no account matches. That
     is the only thing it discloses, and the code was derived from the name in
     the first place.

     Used for entries saved before usernames existed, and for anybody added
     from a room before they said hello. Silent on failure: an unresolved code
     is exactly what the app showed a moment ago. */
  async function friendResolve(code){
    const c = syncNormalise(code);
    const had = friendFind(c);
    if(!c || (had && had.u)) return '';
    let name = '';
    try{
      const r = await Account._post('/account/who', {code: c});
      name = (r && r.ok && typeof r.name === 'string') ? friendName(r.name) : '';
    }catch(e){}
    if(!name) return '';
    friendSet(c, {u: name, name});
    return name;
  }
  /** Resolve every entry still showing a bare code. One pass, on opening the
      page, and never again for a code the server did not know. */
  const FRIEND_TRIED = Object.create(null);
  async function friendResolveAll(){
    for(const f of (SYNC.friends || []).slice()){
      if(!f || f.u || FRIEND_TRIED[f.code]) continue;
      FRIEND_TRIED[f.code] = 1;
      try{ await friendResolve(f.code); }catch(e){}
    }
  }

  /* ---------------- the code a name makes ----------------

     **Shown once the account is found, and not before.**

     A code is `syncCodeFor(username)`, so the app can work out anybody's code
     from their name without asking a soul. Showing it as you type would make
     this box a machine for turning names into codes, which is a directory —
     type any string, get a working address back, whether or not there is a
     person behind it. This app does not have a directory and should not grow
     one by accident.

     So the name is checked first. `/account/who` answers whether an account by
     that name exists, and only then is the code worth showing: at that point it
     is not a lookup, it is a confirmation of somebody you already knew about.
     No account, no code — and the request can still be sent, because somebody
     may sign up tomorrow.

     Advisory throughout. If there is no server the box says nothing at all
     rather than guessing, and Add keeps working either way. */
  let friendHintT = 0, friendHintFor = '';
  function friendCodeHint(raw){
    const el = $('ft-hint');
    if(!el) return;
    const u = friendName(raw);
    clearTimeout(friendHintT);
    friendHintFor = u;
    if(u.length < 2){
      el.classList.add('hide');
      el.textContent = '';
      return;
    }
    /* Nothing is claimed until the answer comes back. */
    el.classList.remove('hide');
    el.innerHTML = '<em>looking for ' + esc(u) + '\u2026</em>';
    /* Ask only once the typing stops: every keystroke is a different name and
       therefore a different question, and none of the earlier ones matter. */
    friendHintT = setTimeout(()=>friendCodeCheck(u), 450);
  }
  async function friendCodeCheck(u){
    const code = friendCode(u);
    let name = null;
    try{
      const r = await Account._post('/account/who', {code});
      name = (r && typeof r.name === 'string') ? r.name : '';
    }catch(e){ name = null; }               // no server, no opinion
    const el = $('ft-hint');
    if(!el || friendHintFor !== u) return;  // they carried on typing
    if(name === null){
      el.classList.add('hide');
      el.textContent = '';
      return;
    }
    if(name && name.toLowerCase() === u.toLowerCase()){
      el.innerHTML = '<span>' + esc(name) + ' is </span><code>' + esc(code) + '</code>';
      return;
    }
    el.innerHTML = '<em>no account called ' + esc(u) + ' yet</em>';
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
