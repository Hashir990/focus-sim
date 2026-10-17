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
    /* **The same figures the stats screen shows, from the same place.**

       A card used to carry its own little summary -- hours, and a row of
       arcade tallies -- worked out here, beside a screen that was working
       out a different summary from the same log. Two answers to "how much
       have you done" that could drift apart, and the arcade tallies were
       not what anybody opening a profile was asking about anyway.

       So the card is now a copy of what Stats draws: the four figures, the
       fortnight of bars, and the three lines under them. One computation,
       so a friend's profile and your own stats page cannot disagree. */
    let st = null;
    try{ st = Stats._compute(); }catch(e){}
    let buddy = null, anim = -1;
    try{ buddy = budSaved(); anim = budAnimSaved(); }catch(e){}
    return {u: friendMe(), n: (SYNC.name || '').slice(0, 24), hrs, sess, run, own,
      tot: st ? st.totalSecs : 0,
      days: st ? st.days : 0,
      bd: st ? (st.bestDay || '') : '',
      bs: st ? st.bestSecs : 0,
      pd: st ? st.perDay : 0,
      /* Fourteen small numbers. `k` is the day, `l` the label already
         worked out for it, `s` the seconds -- sent rather than derived at
         the far end, because the far end does not have their log. */
      rec: st ? st.recent.map(r=>({k:r.key, l:r.label, s:r.secs})) : [],
      buddy, anim, at: Date.now()};
  }

  /** Keep what a card is allowed to contain, and nothing else. */
  function friendCardClean(c){
    if(!c || typeof c !== 'object') return null;
    const num = (x, cap)=>{ const n = Number(x); return (isFinite(n) && n >= 0) ? Math.min(n, cap) : 0; };
    const out = {
      u: friendName(c.u), n: String(c.n || '').slice(0, 24),
      hrs: num(c.hrs, 1e6), sess: num(c.sess, 1e6),
      run: num(c.run, 1e5), own: num(c.own, 1e4),
      tot: num(c.tot, 1e9), days: num(c.days, 1e5),
      bd: String(c.bd || '').slice(0, 10), bs: num(c.bs, 1e9),
      pd: num(c.pd, 1e9),
      /* Capped at fourteen and cleaned one at a time. This arrives from
         somebody else's machine, so its length is theirs to claim and
         ours to refuse. */
      rec: (Array.isArray(c.rec) ? c.rec : []).slice(0, 14).map(r=>({
        k: String((r && r.k) || '').slice(0, 10),
        l: String((r && r.l) || '').slice(0, 4),
        s: num(r && r.s, 1e7),
      })),
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
    if(!friendMe()){ toast('Sign in first. A request comes from your account'); return; }
    if(u.toLowerCase() === friendMe().toLowerCase()){ toast('That is you'); return; }
    const code = friendCode(u);
    if(!code){ toast('That username will not do'); return; }
    const had = friendFind(code);
    if(had && had.ok){ toast(T('Already friends with {name}', {name:friendLabel(had)})); return; }
    friendSet(code, {u, name: u, asked: Date.now()});
    friendWireSend(code, FRIEND_ASK);
    toast(T('Asked {name}', {name:u}));
  }

  /** Say yes to one waiting, or no. */
  function friendAccept(code){
    const c = syncNormalise(code);
    const req = (SYNC.asks || {})[c];
    friendSet(c, {u: (req && req.u) || undefined, name: (req && req.u) || undefined,
      ok: 1, card: (req && req.card) || undefined, at: Date.now()});
    friendWireSend(c, FRIEND_YES);
    friendDropAsk(c);
    toast(T('Friends with {name}', {name:friendLabel(friendFind(c))}));
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
    /* Blocked people cannot ask, accept, or tell you they have gone. Returning
       true is "handled": the item is consumed rather than left in the mailbox
       to be offered again on the next run. */
    if(blockHas(code)) return true;

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
        try{ toast(T('{name} removed you', {name:(card && card.u) || had.u || T('Someone')})); }catch(e){}
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
    try{ toast(T('{name} wants to be friends', {name:(card && card.u) || T('Someone')})); }catch(e){}
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

  /* ---------------- one person, opened ----------------

     Everything here already existed and had nowhere to go: the card
     travels with `hello`, friendSawCard keeps it for anybody in the room
     whether or not they are a friend, and friendStatsHtml is the same
     block Focus together already draws for you at the top of the page.
     What was missing was a way to ask for somebody else's. */
  function friendWhoOpen(p){
    const box = $('who');
    if(!box || !p) return;
    const card = (function(){ try{ return friendCardOf(p.code); }catch(e){ return null; } })();
    const nm = $('who-who');
    if(nm) nm.textContent = (p.name || 'Someone') + (p.me ? ' ' + T('(you)') : '');
    const sub = $('who-sub');
    if(sub){
      /* Their account name if they have one, and otherwise nothing. A
         room code is not a name and putting one here would read as one. */
      const u = (card && card.u) || '';
      sub.textContent = u ? '@' + u : '';
      sub.classList.toggle('hide', !u);
    }
    /* **Their buddy, doing their antic, not yours.** Same rule the room
       list already follows -- see the note on `pose` in syncRender. */
    const bud = $('who-bud');
    if(bud){
      const pose = (function(){ try{ return budAnimKey(p.anim); }catch(e){ return ''; } })();
      const svg = (function(){ try{ return p.buddy ? budSvg(p.buddy, 78) : ''; }catch(e){ return ''; } })();
      bud.className = 'who-bud' + (pose ? ' bud-mini-' + pose : '') + (svg ? '' : ' hide');
      bud.innerHTML = svg;
      bud.onclick = friendWhoPoke;
    }
    const st = $('who-stats');
    if(st){
      st.innerHTML = card ? friendStatsHtml(card)
        : '<p class="who-none">' + esc(T('They have not shared their numbers yet.')) + '</p>';
      try{ friendWireBars(st); }catch(e){}
    }
    /* **Not about yourself.** The sheet opens on anybody in the room,
       including you, and a Block button under your own name is a joke the app
       should not make. */
    const acts = $('who-acts');
    if(acts){
      acts.innerHTML = (p.me || !p.code) ? '' : blockActs(p.code);
      acts.classList.toggle('hide', !acts.innerHTML);
      try{ blockWire(acts, ()=>{ friendWhoClose(); }); }catch(e){}
    }
    const x = $('who-close');
    if(x) x.onclick = friendWhoClose;
    // the backdrop, like every other card over the app
    box.onclick = (e)=>{ if(e.target === box) friendWhoClose(); };
    box.classList.remove('hide');
  }
  function friendWhoClose(){
    const b = $('who');
    if(b) b.classList.add('hide');
  }
  /* Tapped, so he does his thing. The class comes off at the end rather
     than being left on: an animation class that is already there does
     nothing when you add it again, so without this the second tap is a
     dead tap. The reflow in between is what makes the removal count. */
  function friendWhoPoke(){
    const bud = $('who-bud');
    if(!bud) return;
    bud.classList.remove('hop');
    void bud.offsetWidth;
    bud.classList.add('hop');
  }

  /** How stale a card is, in words. */
  function friendWhen(at){
    const ms = Date.now() - (Number(at) || 0);
    if(!(ms > 0) || ms < 6e4) return T('just now');
    const m = Math.floor(ms / 6e4);
    if(m < 60) return T('{n} min ago', {n:m});
    const h = Math.floor(m / 60);
    if(h < 24) return Tn('{n} hour ago', '{n} hours ago', h);
    const d = Math.floor(h / 24);
    return Tn('{n} day ago', '{n} days ago', d);
  }

  /* ---------------- what a card looks like ----------------

     One block, used twice: at the top of Focus together for yourself, and on a
     friend's profile. Same shape both times on purpose — what you are shown
     about somebody is exactly what they are shown about you, and seeing your
     own is the plainest way to say so. */
  function friendStatsHtml(card){
    if(!card) return '';
    const tot = Math.max(0, card.tot || 0);
    const sess = Math.max(0, card.sess || 0);
    const rec = Array.isArray(card.rec) ? card.rec : [];
    /* The tallest bar in the fortnight is the full height and the rest are
       read against it, which is what makes a quiet week legible instead of
       flat. A floor of 4% so a day with anything on it is still a mark. */
    const max = Math.max.apply(null, rec.map(r=>(r && r.s) || 0).concat([1]));
    const bars = rec.map(r=>{
      const s = Math.max(0, (r && r.s) || 0);
      const h = s ? Math.max(4, Math.round(s / max * 100)) : 0;
      const when = String((r && r.k) || '');
      const much = s ? fmtDur(s) : T('nothing');
      return '<button type="button" class="sbar" data-when="' + esc(when)
        + '" data-much="' + esc(much) + '" title="' + esc(when + ' \u00b7 ' + much) + '">'
        + '<div class="sbar-track"><div class="sbar-fill' + (s ? '' : ' empty')
        + '" style="height:' + h + '%"></div></div>'
        + '<span>' + esc(String((r && r.l) || '')) + '</span></button>';
    }).join('');
    const tile = (v, n)=>'<div class="stat-card"><b>' + esc(v) + '</b><span>'
      + esc(n) + '</span></div>';
    /* Plain English, not T(): these are the same labels the stats screen uses,
       they are whole text nodes, and 00a-i18n.js swaps those where they meet
       the page. Wrapping them here would be a second way of saying the same
       thing and a second entry to keep in step. */
    return '<div class="stat-grid">'
      + tile(fmtDur(tot), 'total focused')
      + tile(String(sess), Tn('session', 'sessions', sess))
      + tile(Tn('{n} day', '{n} days', card.run || 0), 'current streak')
      + tile(String(card.days || 0), Tn('active day', 'active days', card.days || 0))
      + '</div>'
      + (bars
        ? '<p class="q-sec">Last 14 days</p>'
          + '<div class="sbars">' + bars + '</div>'
          + '<p class="sbar-read">Tap a bar for that day</p>'
        : '')
      + '<div class="stat-lines">'
      + '<div><span>Best day</span><b>'
        + (card.bd ? esc(card.bd) + ' \u00b7 ' + esc(fmtDur(card.bs || 0))
                   : esc(fmtDur(0)))
        + '</b></div>'
      + '<div><span>Average day</span><b>' + esc(fmtDur(card.pd || 0)) + '</b></div>'
      + '<div><span>Average session</span><b>'
        + esc(sess ? fmtDur(Math.round(tot / sess)) : fmtDur(0)) + '</b></div>'
      + '</div>';
  }

  /* The bars answer when you point at them. Scoped to whichever card they are
     in, because this block is drawn twice -- yours at the top of Focus
     together, and whoever you just opened -- and an id would collide. */
  function friendWireBars(root){
    if(!root) return;
    const read = root.querySelector('.sbar-read');
    if(!read) return;
    const say = (b)=>{
      read.textContent = b ? (b.dataset.when + ' \u00b7 ' + b.dataset.much)
        : T('Tap a bar for that day');
      read.classList.toggle('on', !!b);
    };
    root.querySelectorAll('.sbar').forEach(b=>{
      b.onclick = ()=>{
        const was = b.classList.contains('on');
        root.querySelectorAll('.sbar.on').forEach(x=>x.classList.remove('on'));
        if(was){ say(null); return; }
        b.classList.add('on');
        say(b);
      };
    });
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
    el.innerHTML = '<em>' + esc(T('looking for {name}…', {name:u})) + '</em>';
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
      el.innerHTML = '<span>' + esc(T('{name} is', {name})) + ' </span><code>' + esc(code) + '</code>';
      return;
    }
    el.innerHTML = '<em>' + esc(T('no account called {name} yet', {name:u})) + '</em>';
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
        + '<span>' + esc(T('as of {when}', {when:friendWhen(card.at)})) + '</span></div>'
        + '</div>' + friendStatsHtml(card) + '</div>'
        + this._acts(f);
      this._wire();
      try{ friendWireBars(box); }catch(e){}
    },
    _acts(f){
      const room = SYNC.inRoom && SYNC.inRoom[this.code];
      /* Blocked, and the first two buttons would be lying: there is nothing to
         join and nothing that would arrive. So the row becomes the one thing
         left to do about them. */
      if(blockHas(this.code)){
        return '<div class="ft-acts">' + blockActs(this.code) + '</div>';
      }
      return '<div class="ft-acts">'
        + '<button class="primary" id="prof-join">' + (room ? 'Join their room' : 'Try their room') + '</button>'
        + '<button class="mini-btn" id="prof-msg">Message</button>'
        + blockActs(this.code)
        + '</div>';
    },
    _wire(){
      const j = $('prof-join');
      if(j) j.onclick = ()=>{ Prof.close(); syncJoin(Prof.code); };
      const m = $('prof-msg');
      if(m) m.onclick = ()=>{ Prof.close(); try{ chatOpenWith(Prof.code); }catch(e){} };
      try{ blockWire($('prof-body'), ()=>Prof.render()); }catch(e){}
    },
  };
  function profOpen(code){ Prof.open(code); }
  if($('prof-close')) $('prof-close').onclick = ()=>Prof.close();
