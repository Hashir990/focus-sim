  /* ---------------- FOCUS TOGETHER ----------------
     Peer-to-peer sync over WebRTC, using PeerJS's public signalling server. No
     account, no backend of ours, no data stored anywhere but on the devices.

     Two roles, deliberately separate:

       HOST   — the network hub. Everyone connects to the host and the host relays.
                Fixed for the life of the room, because it owns the peer id that
                the room code resolves to.
       LEADER — whose timer everyone follows. Starts as the host but can be handed
                to anyone. Only the leader broadcasts state, which is what stops
                two clocks fighting.

     Keeping those apart is what makes "give someone else the timer" possible
     without every device reconnecting to a new address. A non-host leader sends
     its state to the host, and the host relays it onward.

     The leader also holds membership: it can hand the timer over and remove
     people. The host enforces both, since it's the only one holding every
     connection.

     PeerJS is fetched from a CDN the first time you open this screen, not at
     startup. Everything else in the app works offline; this obviously can't.

     Codes are 6 characters from an alphabet with no confusable pairs (no O/0,
     no I/1). Your own code is saved and reusable — that's a "friend". A room code
     is generated fresh and thrown away — that's a "room". */

  var SYNC_CDN = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  var SYNC_NS = 'fsim-';                     // a room, under your code
  /* Joining used to open a throwaway peer id. Two things wanted it to be
     stable instead: a reconnect came back as a stranger, and — since the room
     now moves when the timer is handed on — every score, rack and turn a game
     had filed under your id was orphaned the moment the host changed. Deriving
     it from your own code fixes both, and costs nothing: if the id is somehow
     taken (a second tab of your own), we fall back to a random one. */
  var SYNC_NSU = 'fsimu-';                   // a person, under their own code
  var SYNC_PNS = 'fsimp-';                   // just you, present, under your code
  var SYNC_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  var SYNC_BEAT = 2000;                      // ms between leader heartbeats
  var SYNC_GONE = 6000;                      // three missed beats and you are gone
  var SYNC_SETTLE = 6000;                    // grace while a moved room re-forms
  var SYNC_OPENING = 350;                    // let the new host open before dialling it
  var SYNC_PROBE_MS = 4500;                  // how long to wait on an online check

  /* Where the optional mailbox lives — see server/mailbox.js for what it is and
     how to deploy one. Empty means peer-to-peer only, which is the default and
     works: a message to somebody who is closed simply waits on your device until
     you are both open at once.

     This is a constant rather than a setting on purpose. It is a deployment
     decision, not a preference — nobody opening a focus timer should have to
     work out what a message server is, and a URL field with no explanation is
     worse than no field. Set it here, rebuild, and messaging gains the ability
     to arrive while the sender is closed. */
  var SYNC_MAILBOX = '';

  var SYNC = {
    lib:null, peer:null, code:null, mode:'off',   // 'off' | 'hosting' | 'joined'
    selfId:null, leaderId:null, hostId:null,
    /* **`anims` was the missing half of `buddies`.** Both halves of somebody's
       buddy have been arriving in `hello` since the day it was written — what
       they look like *and* which antic they do — and only the first was ever
       kept. So `budAnimKey(undefined)` fell back to 0 for everybody and a room
       of four was four web-swingers, whatever any of them had chosen. The
       comment beside the room list said "their buddy does their antic, not
       yours" the whole time; it just was not true. */
    conns:{}, roster:{}, codes:{}, buddies:{}, anims:{}, remoteList:null,
    leaving:false, lastState:null,   // see syncLeave(), and the joiner's first state
    name:'', myCode:null, accountCode:false, friends:[],
    /* Requests waiting for an answer, by code. Kept with the friends list
       because an unanswered request is a thing you came back to deal with.
       `cards` is what people in the room told us about themselves this
       session — see 29a-friends.js. */
    asks:{}, cards:{},
    beat:null, lastApplied:0, status:'',
    seen:{},                                 // host: id -> when we last heard from them
    hostSeen:0,                              // follower: when the host last spoke
    online:{},                               // friend code -> around? from the last probe
    inRoom:{},                               // friend code -> hosting a room right now?
    /* Which game each peer has open, by peer id. Travels on the heartbeat and
       in `hello`, and rides back out in the roster. */
    games:{},
    /* Peers connected but not in the room yet: `id -> {name, code, at}`. See
       the waiting-room note above `syncAdmit`. On the joining side, `held` is
       true while you are the one outside. */
    waiting:{}, held:false,
    probing:false, probePeer:null,
    beacon:null, beaconOn:false,             // "I'm around" — see syncBeacon()
    posting:false, mailTimer:null,           // see syncMailRun()
    token:'', fetching:false,                // the optional mailbox; see syncMailFetch()
    rejoin:null, rejoinTries:0, rejoinCode:null,   // see syncRetry()
    epoch:0,                                 // bumped by syncLeave; see syncJoin
    hostName:'', hostCode:null,              // whose room this is
    moving:'', leaveAfterMove:false,         // see syncMigrate()
    pendingGames:null,                       // boards handed to us with the room
    expect:[], expectUntil:0,                // who is mid-redial; see syncSeats()
  };

  /* ---- shared games ----
     The host is already the referee for the timer. It is the referee for games
     too: everybody else sends *intents* ("I guess E", "I play these tiles") and
     the host is the only thing that ever mutates game state. It then pushes each
     player a view of that state — per player, because a Scrabble rack and a
     hangman answer are nobody else's business.

     One writer means no conflict handling at all, which is what made co-op
     games look expensive in the first place.

     A game registers a handler here from its own file (30+):

       syncGameRegister('hangman', {
         intent(fromId, m){},   // host only — someone wants to do something
         apply(view){},         // everyone — here is your state, render it
         roster(){},            // host only — someone joined or left
       });                                                                   */
  var SYNC_GAMES = {};
  function syncGameRegister(id, h){ SYNC_GAMES[id] = h; }

  function syncGameIntent(g, from, m){
    const h = SYNC_GAMES[g];
    if(h && h.intent) try{ h.intent(from, m); }catch(e){}
  }
  function syncGameApply(g, s){
    const h = SYNC_GAMES[g];
    if(h && h.apply) try{ h.apply(s); }catch(e){}
  }

  /** Any player -> the host. If we are the host, we just handle it. */
  function syncGameSend(g, m){
    if(!syncActive()) return;
    if(syncIsHost()) syncGameIntent(g, SYNC.selfId, m);
    else syncBroadcast({t:'gmove', g:g, m:m});   // joined: our only conn is the host
  }

  /** Host -> one player. */
  function syncGamePush(g, id, s){
    if(!syncIsHost()) return;
    if(id === SYNC.selfId) syncGameApply(g, s);
    else if(SYNC.conns[id]) syncSend(SYNC.conns[id], {t:'gstate', g:g, s:s});
  }

  /** Host -> everyone, each getting their own view of the same state. */
  function syncGamePushAll(g, viewFor){
    if(!syncIsHost()) return;
    syncGamePush(g, SYNC.selfId, viewFor(SYNC.selfId));
    for(const id in SYNC.conns) syncGamePush(g, id, viewFor(id));
  }

  /* ---- handing the games over ----
     The host owns every board, so without this a host change wiped them: the
     new host started from nothing and a half-finished Scrabble game, everyone's
     scores and whose turn it was all went with the old one.

     A game opts in with `save`/`load`, which are just its host state in and
     out. The state is keyed by peer id, and peer ids are stable now (see
     SYNC_NSU) — except for exactly two people, the outgoing host and the
     incoming one, whose ids change because one of them stops being a room and
     the other starts. Those two are rewritten on the way out. */
  function syncGamesSnapshot(){
    const out = {};
    for(const g in SYNC_GAMES){
      const h = SYNC_GAMES[g];
      if(h && h.save) try{ const s = h.save(); if(s) out[g] = s; }catch(e){}
    }
    return out;
  }
  function syncGamesAdopt(snap){
    if(!snap) return;
    for(const g in SYNC_GAMES){
      const h = SYNC_GAMES[g];
      if(h && h.load && snap[g]) try{ h.load(snap[g]); }catch(e){}
    }
  }
  /** Swap ids inside a snapshot wholesale — they appear as both keys and values. */
  function syncRekey(snap, map){
    const keys = Object.keys(map).filter(Boolean);
    if(!keys.length) return snap;
    const re = new RegExp(keys.map(k=>k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    try{ return JSON.parse(JSON.stringify(snap).replace(re, m=>map[m])); }
    catch(e){ return snap; }
  }

  /** Host only. Someone joined or left; seats may need re-cutting. */
  function syncGameRosterChanged(){
    if(!syncIsHost()) return;
    for(const g in SYNC_GAMES){
      const h = SYNC_GAMES[g];
      if(h && h.roster) try{ h.roster(); }catch(e){}
    }
  }

  /** Everyone in the room, host first, in a stable order both ends agree on. */
  function syncSeats(){
    if(!syncIsHost()) return [];
    const out = [{id:SYNC.selfId, name:SYNC.name || 'Host'}];
    for(const id in SYNC.conns){
      if(id === SYNC.selfId) continue;
      out.push({id, name:SYNC.roster[id] || 'Someone'});
    }
    /* For a few seconds after taking a room over, everybody who was in it a
       moment ago still has a seat. They are mid-redial, and without this the
       first game to look around sees a room of one, decides the person who set
       the word has left, and clears the board they are all coming back to. */
    if(SYNC.expectUntil > Date.now()){
      for(const p of SYNC.expect) if(p.id !== SYNC.selfId && !out.some(o=>o.id === p.id)) out.push(p);
    }
    return out;
  }

  function syncCode(n){
    let s = '';
    for(let i=0;i<(n||6);i++) s += SYNC_ALPHABET[Math.random()*SYNC_ALPHABET.length|0];
    return s;
  }
  /* ---- one code per account ----
     A friend code was per *device*: sign in on a phone and a laptop and you had
     two, so "my code" meant nothing to the person you gave it to and whichever
     you happened to be holding was the one that worked. Derived from the
     account instead, it is the same six characters everywhere you sign in.

     Deterministic, and from the username rather than the token — a token
     changes every time you sign in and a code that changes is not a code.
     Two accounts colliding costs nothing worse than one being unable to host
     while the other is: the same thing that already happens between strangers,
     and PeerJS refuses the second with `unavailable-id` either way. */
  function syncCodeFor(name){
    const s = String(name || '').toLowerCase();
    let a = 0x811c9dc5;
    for(let i=0;i<s.length;i++) a = Math.imul(a ^ s.charCodeAt(i), 0x01000193) >>> 0;
    let out = '';
    for(let i=0;i<6;i++){ out += SYNC_ALPHABET[a % SYNC_ALPHABET.length]; a = Math.floor(a / SYNC_ALPHABET.length) + 0x9e37; }
    return out;
  }

  /* Called when signing in or out. Signing out puts the device back on a code
     of its own, because the account's code is the account's. */
  /* **Whose code is this, really.**

     `syncLoad()` restores `myCode` from disk and this is called from the
     account, and the two sit in the same `Promise.all` — so on a cold start
     whichever finished last won. Land in the wrong order and a signed-in device
     came up on the code it had *before* it signed in while the other device was
     on the account's: one account, two codes. Mail is addressed to a code, so
     half of it went somewhere nobody was listening. That is the whole of
     "messaging is a little broken since accounts".

     Called again once everything has loaded (see 90-init.js), where the answer
     cannot depend on what finished first. Idempotent on purpose. */
  function syncAdoptAccount(username){
    const want = username ? syncCodeFor(username) : null;
    if(want){
      if(SYNC.myCode === want) return;
      SYNC.myCode = want;
    }else{
      if(!SYNC.accountCode) return;
      SYNC.myCode = syncCode();
    }
    SYNC.accountCode = !!want;
    syncSave();
    try{ syncRender(); }catch(e){}
  }

  function syncNormalise(c){
    return String(c||'').toUpperCase().replace(/[^0-9A-Z]/g,'')
      .replace(/O/g,'0').replace(/I/g,'1')     // forgive the confusable ones
      .replace(/0/g,'O').replace(/1/g,'J')     // ...then map them to real letters
      .slice(0,6);
  }
  function syncActive(){ return SYNC.mode !== 'off'; }
  function syncIsHost(){ return SYNC.mode === 'hosting'; }
  function syncIsLeader(){ return syncActive() && !!SYNC.selfId && SYNC.leaderId === SYNC.selfId; }

  /** Load PeerJS once, on demand. */
  function syncLoadLib(){
    if(SYNC.lib) return Promise.resolve(SYNC.lib);
    if(window.Peer){ SYNC.lib = window.Peer; return Promise.resolve(SYNC.lib); }
    return new Promise((resolve, reject)=>{
      const s = document.createElement('script');
      s.src = SYNC_CDN;
      s.async = true;
      s.onload = ()=>{
        if(window.Peer){ SYNC.lib = window.Peer; resolve(SYNC.lib); }
        else reject(new Error('peerjs did not load'));
      };
      s.onerror = ()=>reject(new Error('offline'));
      document.head.appendChild(s);
    });
  }

  function syncSetStatus(msg){
    SYNC.status = msg || '';
    const el = $('sync-status');
    if(el) el.textContent = SYNC.status;
    syncRender();
  }

  /* ---- the wire protocol ----
     Small on purpose. Every message is a plain object with a `t` tag.

       hello      {name, code}          greeting, both directions
       roster     {leaderId, list}      host -> everyone, who is here and who leads
       state      {timer fields}        leader -> everyone (relayed by the host)
       setleader  {id}                  leader -> host, hand the timer over
       kick       {id}                  leader -> host, remove someone
       kicked     {}                    host -> the removed person
       ping       {}                    everyone, so silence can be told from idle
       gmove      {g, m}                any player -> host, a game intent
       gstate     {g, s}                host -> one player, their view of a game
       say        {id, name, text, at, to}  a chat line; the host relays it onward
       quotes     {list}                the sender's quote bank, if they're sharing

     And two that travel on a presence connection rather than inside a room:

       mail       {items}               messages for somebody who wasn't there
       mailok     {ids}                 what actually landed, so the outbox clears
       bye        {}                    polite disconnect

     `hello` carries the sender's own friend code as well as their name. Without
     it you could only ever save the host as a friend, since everybody else's
     peer id is a throwaway.
  */

  function syncStateMsg(){
    return {
      t:'state',
      mode:S.mode, running:S.running,
      remaining:S.running ? Math.max(0, Math.round((S.endAt-Date.now())/1000)) : S.remaining,
      total:S.total, cycle:S.cycle, restIsLong:S.restIsLong,
      repeat:S.repeat, runCount:S.runCount,
      focusMin:S.focusMin, breakMin:S.breakMin,
      at:Date.now(),
    };
  }

  /** Followers only. Adopt the leader's clock. */
  function syncApplyState(m){
    if(syncIsLeader() || !m || m.t !== 'state') return;
    if(m.at && m.at < SYNC.lastApplied) return;      // ignore out-of-order
    SYNC.lastApplied = m.at || Date.now();

    const wasSetup = S.mode === 'setup';
    const wasMode = S.mode;
    const wasTotal = S.total, wasRemaining = S.remaining;
    S.focusMin = m.focusMin; S.breakMin = m.breakMin;
    S.repeat = m.repeat; S.runCount = m.runCount;
    S.cycle = m.cycle; S.restIsLong = m.restIsLong;
    S.mode = m.mode; S.total = m.total;
    S.remaining = m.remaining;

    // The leader's own `complete()` shuts the arcade when the break runs out.
    // Followers have to be told, or they sit in a game while everybody else has
    // gone back to focusing — which was the whole point of sharing the timer.
    if(m.mode !== wasMode && m.mode !== 'rest' && Arcade.open){
      Arcade.close();
      if(m.mode === 'focus') toast('Break’s over — back to it');
    }

    /* A follower never runs `complete()` or `stop()`, so without this it would
       sit through an hour of shared focus and record none of it — no calendar
       entry, no streak, and nobody to have studied with.

       The two ways a focus block can end are treated the way the timer engine
       treats them, so a follower's history matches the leader's: finishing or
       skipping into a break always counts, while stopping outright is only kept
       if enough of it happened. */
    if(wasMode === 'focus' && m.mode !== 'focus'){
      const ran = Math.max(0, Math.min(wasTotal, wasTotal - wasRemaining));
      const stopped = m.mode === 'setup';
      if(!stopped || ran >= 30){
        S.sessionsToday++; S.cycle++;
        // the same test the engine makes: the clock ran out rather than
        // somebody reaching for Skip
        logSession(ran, !stopped && wasRemaining <= 2);
        tasksFlushToNote();
      }else{
        /* Too little to keep — but the ticks that ran while it lasted opened a
           record, so it has to be taken back rather than left dangling for the
           next load to tidy up. */
        try{ logDrop(); }catch(e){}
      }
    }

    if(m.mode === 'setup'){
      if(!wasSetup){ clearInterval(loop); loop=null; S.running=false; releaseWake(); Quote.stop(); }
      swapView(); render();
      return;
    }
    if(wasSetup) swapView();

    if(m.running){
      // rebuild the local deadline from the leader's remaining time
      S.running = true;
      S.endAt = Date.now() + m.remaining*1000;
      acquireWake();
      clearInterval(loop);
      loop = setInterval(tick, 250);
      ambStart();
    }else{
      S.running = false;
      clearInterval(loop); loop=null;
      releaseWake();
      ambStop();
    }
    render();
  }

  function syncSend(conn, msg){ try{ conn.send(msg); }catch(e){} }
  /** **Nothing reaches somebody still at the door.** They are connected, which
      is the only way they could have asked, and that is all: no roster, no
      state, no chat. Skipping them here makes that true for every kind of
      message at once, rather than each caller having to remember. */
  function syncBroadcast(msg, exceptId){
    for(const id in SYNC.conns){
      if(id === exceptId || SYNC.waiting[id]) continue;
      syncSend(SYNC.conns[id], msg);
    }
  }

  /** Called by the timer engine on every change. No-op unless we hold the timer. */
  function syncBroadcastState(){
    if(!syncIsLeader()) return;
    const m = syncStateMsg();
    if(syncIsHost()) SYNC.lastState = m;
    syncBroadcast(m);
  }

  /** Which game this device has open, or '' for none. */
  function syncMyGame(){
    try{ return (Arcade.open && Arcade.active) ? String(Arcade.active) : ''; }catch(e){ return ''; }
  }
  function syncRosterMsg(){
    const list = [{id:SYNC.selfId, name:SYNC.name || 'Host', code:SYNC.myCode,
      buddy:budSaved(), anim:budAnimSaved(), g:syncMyGame()}];
    for(const id in SYNC.roster) list.push({id, name:SYNC.roster[id], code:SYNC.codes[id] || '',
      buddy:SYNC.buddies[id] || null, anim:(SYNC.anims[id] | 0), g:SYNC.games[id] || ''});
    return {t:'roster', leaderId:SYNC.leaderId, list};
  }

  /** Offer my quote bank to the room, if I've opted in. A no-op if I haven't. */
  function quotesBroadcast(){
    if(!syncActive()) return;
    const list = myShareableQuotes();
    syncBroadcast({t:'quotes', name:SYNC.name || 'Someone', list});
  }

  /** Names of everyone else in the room right now. Used to stamp session records. */
  function syncCompanions(){
    if(!syncActive()) return [];
    return syncPeople().filter(p=>!p.me).map(p=>p.name).filter(Boolean);
  }

  /* ---- who is still actually there ----
     `conn.on('close')` is not enough. A laptop that sleeps, a phone that walks
     out of wifi and a tab that is force-quit all leave the connection looking
     open forever, and the room fills up with people who left. So everybody
     speaks every couple of seconds and the host drops whoever goes quiet.
     Followers watch the host the same way. */

  function syncTouch(id){
    if(syncIsHost()) SYNC.seen[id] = Date.now();
    else SYNC.hostSeen = Date.now();
  }

  function syncSweep(){
    if(!syncActive()) return;
    const now = Date.now();

    if(syncIsHost()){
      for(const id in SYNC.conns){
        const last = SYNC.seen[id] || 0;
        if(now - last > SYNC_GONE){
          const name = SYNC.roster[id] || 'Someone';
          syncDrop(id);
          syncSetStatus(name + ' dropped out');
        }
      }
      return;
    }

    // A follower only ever hears from the host, so the host going quiet means
    // the room is gone — better to say so than to sit on a frozen clock.
    if(SYNC.hostSeen && now - SYNC.hostSeen > SYNC_GONE){
      const code = SYNC.code;
      syncLeave(true, true);
      syncRetry(code);
    }
  }

  /** Remove someone who is gone, without trying to tell them. */
  function syncDrop(id){
    const conn = SYNC.conns[id];
    if(conn) try{ conn.close(); }catch(e){}
    const wasLeader = SYNC.leaderId === id;
    delete SYNC.conns[id]; delete SYNC.roster[id]; delete SYNC.waiting[id];
    delete SYNC.games[id];
    delete SYNC.codes[id]; delete SYNC.seen[id];
    delete SYNC.buddies[id]; delete SYNC.anims[id];
    if(wasLeader) SYNC.leaderId = SYNC.selfId;
    syncBroadcast(syncRosterMsg());
    if(wasLeader) syncBroadcastState();
    syncGameRosterChanged();
    syncRender();
  }

  function syncHeartbeat(){
    if(!syncActive()) return;
    if(syncIsLeader()) syncBroadcastState();
    // The ping carries who we are as well as the fact that we're alive. A `hello`
    // that goes missing would otherwise leave us anonymous for the whole session.
    else syncBroadcast({t:'ping', name:SYNC.name, code:SYNC.myCode, g:syncMyGame()});
    syncSweep();
  }

  /* ---- moving the room ----
     A room *is* a peer id, and that peer id is the host's code. So handing the
     timer to somebody else used to leave the two halves in different places:
     their start and pause drove the clock, but the room still lived on the old
     host's machine. Close that window — the obvious thing to do once you've
     handed it over — and everyone went with it.

     So the lead and the room travel together now. The host announces the new
     code, then everybody dials it, the new leader opens it, and the old host
     becomes an ordinary follower (or leaves, if that's why it did this). The
     code you are all in is always the code of whoever holds the timer, which is
     also what makes "join Sara" the right thing to tell somebody afterwards.

     Shared games don't survive the move, and can't: the host owns their boards
     and the new host has never seen them. Chess is the exception, because a
     chess game is a list of moves both players keep — it is offered back on the
     new host's lobby. The others simply start their next round. */
  function syncMigrate(id){
    if(!syncIsHost() || id === SYNC.selfId) return false;
    const code = syncNormalise(SYNC.codes[id] || '');
    if(code.length < 4) return false;           // no code of theirs, nowhere to move to
    const name = SYNC.roster[id] || 'them';
    const leaving = SYNC.leaveAfterMove;
    SYNC.leaveAfterMove = false;

    /* The boards, first and to them alone — everybody else is about to be told
       to move, and none of them can do anything with a Scrabble bag. Same
       reliable channel, sent first, so it lands before the announcement. */
    const snap = syncRekey(syncGamesSnapshot(), {
      [SYNC.selfId]: SYNC_NSU + (SYNC.myCode || '').toLowerCase(),   // we become a follower
      [id]: SYNC_NS + code.toLowerCase(),                            // they become the room
    });
    const room = [{id:SYNC_NSU + (SYNC.myCode || '').toLowerCase(), name:SYNC.name || 'Someone'}];
    for(const other in SYNC.conns){
      if(other === id) continue;                                   // they become the room
      room.push({id:other, name:SYNC.roster[other] || 'Someone'}); // everyone else keeps their id
    }
    if(SYNC.conns[id]) syncSend(SYNC.conns[id], {t:'handoff', games:snap, room});
    syncBroadcast({t:'migrate', code, leader:id, to:name});
    syncSetStatus('Handing the room to ' + name + '…');
    /* A beat, so the announcement is off the wire before this peer is torn
       down. Both messages are on the same reliable channel, so `migrate`
       arrives before any goodbye — but only if it was sent first. */
    setTimeout(()=>{
      if(leaving){
        syncLeave(true);
        syncSetStatus(name + ' has the room now');
        toast('Handed to ' + name);
      }else{
        syncFollow(code, name);
      }
    }, 220);
    return true;
  }

  /** Dial a room we've just been told to move to, and keep trying: the new host
      needs a moment to open its own peer, and refusing once is not an answer. */
  function syncFollow(code, name){
    syncStopRetrying();
    SYNC.moving = name || '';
    SYNC.rejoinCode = code;
    SYNC.rejoinTries = 0;
    // The new host has to open its peer before anyone can dial it. Retrying
    // covers us either way, but arriving a moment late beats a failed call.
    setTimeout(()=>{ if(SYNC.rejoinCode === code) syncJoin(code, true); }, SYNC_OPENING);
  }

  /** It's our room now: host it on our own code, boards and all. */
  async function syncTakeRoom(){
    syncStopRetrying();
    SYNC.moving = '';
    const games = SYNC.pendingGames;
    const expect = SYNC.expect;
    SYNC.pendingGames = null;
    await syncHost(true);
    if(!syncIsHost()) return;
    SYNC.expect = expect || [];
    SYNC.expectUntil = Date.now() + SYNC_SETTLE;
    syncGamesAdopt(games);
    syncSetStatus('The room moved to your code — you hold the timer');
    syncRender();
  }

  /** Host only: change who holds the timer. The room goes with it. */
  function syncSetLeader(id){
    if(!syncIsHost()) return;
    if(id !== SYNC.selfId && !SYNC.conns[id]) return;
    if(id !== SYNC.selfId && syncMigrate(id)) return;
    /* Only reachable if we don't know their code, so the room can't follow
       them. Whoever asked for this may have been on their way out — tell them
       it didn't happen rather than dropping them out of a room that stayed. */
    if(SYNC.leaveAfterMove){
      SYNC.leaveAfterMove = false;
      toast('They haven’t sent their code yet — the room can’t move');
    }
    SYNC.leaderId = id;
    syncBroadcast(syncRosterMsg());
    if(syncIsLeader()) syncBroadcastState();     // took it back: re-assert at once
    syncSetStatus(id === SYNC.selfId ? 'You hold the timer'
      : 'Timer handed over — they haven’t told us their code, so the room stays here');
  }

  /** Host only: drop someone from the room. */
  function syncRemove(id){
    if(!syncIsHost() || !SYNC.conns[id]) return;
    syncSend(SYNC.conns[id], {t:'kicked'});
    const conn = SYNC.conns[id];
    const wasLeader = SYNC.leaderId === id;
    setTimeout(()=>{ try{ conn.close(); }catch(e){} }, 60);
    delete SYNC.conns[id]; delete SYNC.roster[id]; delete SYNC.waiting[id];
    delete SYNC.games[id];
    if(wasLeader) SYNC.leaderId = SYNC.selfId;   // never leave the room leaderless
    syncBroadcast(syncRosterMsg());
    if(wasLeader) syncBroadcastState();
    syncSetStatus('Removed from the room');
    syncRender();
  }

  /* What the buttons call. If we're the host we act directly; if not, we ask the
     host to do it. Either way the host is the single point of authority. */
  function syncHandOver(id){
    if(syncIsHost()) syncSetLeader(id);
    else if(syncIsLeader()) syncBroadcast({t:'setleader', id});
  }
  function syncKick(id){
    if(syncIsHost()) syncRemove(id);
    else if(syncIsLeader()) syncBroadcast({t:'kick', id});
  }

  function syncWire(conn, isIncoming){
    // An online check opens a connection and drops it again. Answering it as if
    // somebody joined would put a ghost in the roster and toast at everyone.
    if(isIncoming && conn.metadata && conn.metadata.probe){
      conn.on('open', ()=>{ setTimeout(()=>{ try{ conn.close(); }catch(e){} }, 30); });
      /* A call that never connects at all — the room isn't open yet, most likely
       because it has just moved and its new host is still starting up. Left
       alone this waited on the eight-second timeout in syncJoin, which is a
       very long time to look disconnected. */
    conn.on('error', ()=>{
      if(SYNC.mode === 'joined' && SYNC.rejoinCode && !Object.keys(SYNC.conns).length){
        syncRetry(SYNC.rejoinCode);
      }
    });
      return;
    }

    conn.on('open', ()=>{
      /* Somebody who dropped without the socket closing comes back on a second
         connection while the first is still sitting there looking open. Replace
         it — but tag it first, because its `close` arrives later and used to
         delete this peer's entries by id, taking the *live* connection's roster
         line, code and heartbeat with it. That is the ghost: still connected,
         invisible to the host, and skipped by every broadcast because
         SYNC.conns no longer held them. */
      const prev = SYNC.conns[conn.peer];
      if(prev && prev !== conn){
        prev.__superseded = true;
        try{ prev.close(); }catch(e){}
      }
      SYNC.conns[conn.peer] = conn;
      syncTouch(conn.peer);
      const wasRejoining = SYNC.rejoinTries > 0;
      if(wasRejoining) syncStopRetrying();
      /* The card goes with the greeting. Being in a room with somebody is the
         moment their profile is worth refreshing, and it costs one small object
         on a connection that is already open. See 29a-friends.js. */
      syncSend(conn, {t:'hello', name:SYNC.name, code:SYNC.myCode, g:syncMyGame(),
        buddy:budSaved(), anim:budAnimSaved(), card:(function(){
          try{ return friendCard(); }catch(e){ return null; } })()});
      quotesBroadcast();
      // somebody just came within reach; anything queued for them can go now
      try{ syncMailRun(); }catch(e){}
      /* **Nothing about the room goes out here.**

         The roster and the timer state used to be sent the moment a socket
         opened — which is before `hello`, and therefore before the host has any
         idea who this is. Somebody held at the door got the whole room anyway:
         who was in it, and what the timer was doing. It is sent on `hello`
         now, to peers who are actually let in. See `syncGreet`. */
      const moved = SYNC.moving;
      SYNC.moving = '';
      syncSetStatus(moved ? 'Now in ' + moved + '’s room'
                  : wasRejoining ? 'Back in the room'
                  : isIncoming ? 'Someone joined' : 'Connected');
    });

    conn.on('data', (m)=>{
      if(!m || typeof m !== 'object') return;
      syncTouch(conn.peer);

      if(m.t === 'ping'){
        const named = SYNC.roster[conn.peer];
        if(m.name || m.code){
          SYNC.roster[conn.peer] = m.name || SYNC.roster[conn.peer] || 'Someone';
          if(m.code) SYNC.codes[conn.peer] = syncNormalise(m.code);
        }
        /* What they have open. A heartbeat is the only regular thing a guest
           sends, so it is where this belongs — a message of its own for
           something that changes a few times a break would be a message of its
           own for nothing. */
        const wasIn = SYNC.games[conn.peer] || '';
        const nowIn = typeof m.g === 'string' ? m.g.slice(0, 16) : '';
        SYNC.games[conn.peer] = nowIn;
        if(syncIsHost() && wasIn !== nowIn){ syncBroadcast(syncRosterMsg()); syncRender(); }
        // only tell the room when this actually told us something new
        if(syncIsHost() && !named && SYNC.roster[conn.peer]){
          syncBroadcast(syncRosterMsg());
          syncGameRosterChanged();
          syncRender();
        }
        return;
      }

      if(m.t === 'hello'){
        const code = typeof m.code === 'string' ? syncNormalise(m.code) : '';
        try{ if(m.card && code) friendSawCard(code, m.card); }catch(e){}
        /* **Somebody we do not know waits outside.** Not in the roster, so no
           broadcast reaches them and nothing about them reaches the room except
           that they are there. See `syncNeedsLetIn`. */
        if(syncIsHost() && !SYNC.roster[conn.peer] && syncNeedsLetIn(code)){
          if(!SYNC.waiting[conn.peer]){
            SYNC.waiting[conn.peer] = {
              name:(m.name || 'Someone'), code,
              buddy:(m.buddy ? budClean(m.buddy) : null), anim:(m.anim | 0),
              at:Date.now(),
            };
            try{ chatNote((m.name || 'Someone') + ' is waiting to be let in'); }catch(e){}
            try{ if(!chatQuietHours()){ blip(); buzz(14); } }catch(e){}
          }
          try{ syncSend(conn, {t:'wait'}); }catch(e){}
          syncRender();
          return;
        }
        SYNC.roster[conn.peer] = m.name || 'Someone';
        if(code) SYNC.codes[conn.peer] = code;
        // who they look like, kept beside who they are
        if(m.buddy) SYNC.buddies[conn.peer] = budClean(m.buddy);
        SYNC.anims[conn.peer] = m.anim | 0;
        if(typeof m.g === 'string') SYNC.games[conn.peer] = m.g.slice(0, 16);
        if(syncIsHost()){
          syncGreet(conn);
          syncBroadcast(syncRosterMsg());
          syncGameRosterChanged();
        }
        syncRender();
      }

      /* ---- the door, from both sides ---- */
      else if(m.t === 'wait'){
        /* We are the one outside. Nothing is wrong and nothing is broken; say
           so plainly rather than leaving "Connecting..." up for a minute. */
        SYNC.held = true;
        syncSetStatus('Waiting to be let in\u2026');
        syncRender();
      }
      else if(m.t === 'letin'){
        /* From the host to us: we are in. From the leader to the host: let that
           person in. `m.id` is what tells the two apart. */
        if(m.id){ if(syncIsHost()) syncAdmit(m.id); return; }
        SYNC.held = false;
        syncSetStatus('You were let in');
        syncRender();
      }
      else if(m.t === 'refuse'){
        if(syncIsHost() && m.id) syncRefuse(m.id);
      }
      else if(m.t === 'refused'){
        SYNC.held = false;
        syncLeave(true);
        syncSetStatus('They did not let you in');
      }

      /* Somebody redressed their buddy mid-session. Relayed by the host for
         the same reason chat is: in a star topology two guests cannot see each
         other directly. */
      else if(m.t === 'buddy'){
        SYNC.buddies[conn.peer] = budClean(m.buddy);
        /* The antic rides along, so changing only the antic is still a `buddy`
           message — there is no second kind, and adding one would be a second
           thing for the host to relay and forget to relay. */
        if('anim' in m) SYNC.anims[conn.peer] = m.anim | 0;
        if(syncIsHost()){ syncBroadcast(m, conn.peer); syncBroadcast(syncRosterMsg()); }
        syncRender();
      }

      else if(m.t === 'roster'){
        SYNC.remoteList = m.list || [];
        // the host is always first in the list it sends, so this is whose room
        // we are in — worth knowing when you've joined by a code from a friend
        if(m.list && m.list[0]){
          SYNC.hostName = m.list[0].name || '';
          if(m.list[0].code) SYNC.hostCode = syncNormalise(m.list[0].code);
        }
        SYNC.leaderId = m.leaderId || null;
        if(syncIsLeader()) syncBroadcastState();   // just been handed the timer
        syncRender();
      }

      else if(m.t === 'state'){
        // The host is the referee: only the current leader's state is honoured,
        // and the host is what carries it to everyone else.
        if(syncIsHost()){
          if(conn.peer !== SYNC.leaderId) return;
          SYNC.lastState = m;               // for whoever joins next
          syncBroadcast(m, conn.peer);
        }
        syncApplyState(m);
      }

      /* The room is moving. Only the host of the room we are actually in may
         say so — otherwise anyone who could reach us could walk us into a room
         of their choosing. */
      /* The boards, arriving just ahead of the instruction to take the room. */
      else if(m.t === 'handoff'){
        if(SYNC.mode !== 'joined' || conn.peer !== SYNC.hostId) return;
        SYNC.pendingGames = m.games || null;
        SYNC.expect = Array.isArray(m.room) ? m.room : [];
      }

      else if(m.t === 'migrate'){
        if(SYNC.mode !== 'joined' || conn.peer !== SYNC.hostId) return;
        const code = syncNormalise(m.code || '');
        if(code.length < 4) return;
        if(m.leader === SYNC.selfId) syncTakeRoom();
        else syncFollow(code, m.to || '');
      }

      else if(m.t === 'setleader'){
        if(syncIsHost() && conn.peer === SYNC.leaderId) syncSetLeader(m.id);
      }
      else if(m.t === 'kick'){
        if(syncIsHost() && conn.peer === SYNC.leaderId) syncRemove(m.id);
      }
      // Game traffic. Intents only ever travel inward to the host; state only
      // ever travels outward from it. Nothing else is honoured in either
      // direction, which is the same rule the timer already follows.
      else if(m.t === 'gmove'){
        if(syncIsHost()) syncGameIntent(m.g, conn.peer, m.m);
      }
      else if(m.t === 'gstate'){
        if(!syncIsHost() && conn.peer === SYNC.hostId) syncGameApply(m.g, m.s);
      }

      /* Chat. Unlike a game intent this needs no adjudicating — there is no
         state to get wrong — so the host just passes it on and everybody keeps
         their own copy. The sender's own line is shown locally the moment they
         send it, so it never waits on a round trip. */
      else if(m.t === 'say'){
        // A direct message is addressed; the host passes it to that one person
        // rather than the room. It is still relayed, because in a star topology
        // two guests have no other way to reach each other.
        if(syncIsHost()){
          if(m.to && m.to !== SYNC.selfId){
            if(SYNC.conns[m.to]) syncSend(SYNC.conns[m.to], m);
            if(m.from !== SYNC.selfId) return;   // not addressed to us; don't show it
            return;
          }
          if(!m.to) syncBroadcast(m, conn.peer);
        }
        chatReceive(m);
      }

      else if(m.t === 'quotes'){
        if(syncIsHost()) syncBroadcast(m, conn.peer);
        quotesReceive(SYNC.roster[conn.peer] || (m.name || 'Someone'), m.list);
      }

      else if(m.t === 'kicked'){
        syncLeave(true);
        syncSetStatus('You were removed from the room');
      }
      else if(m.t === 'bye'){
        /* A goodbye is not a drop. Without this the follower treats the close
           that follows as a lost connection and spends the next minute dialling
           a room that was deliberately shut — and reconnecting with a new peer
           id while it does. */
        conn.__saidBye = true;
        /* Unless we're in the middle of moving — the old host says goodbye
           immediately after handing the room on, and stopping the retries here
           would strand everyone one hop short of the new room. */
        if(!SYNC.moving) syncStopRetrying();
        try{ conn.close(); }catch(e){}
      }
    });

    conn.on('close', ()=>{
      /* Only tear down if this is still the connection we are using. A socket
         that was superseded by a reconnection, or one syncDrop/syncLeave has
         already accounted for, must not clear entries that now belong to a
         live connection — and must not take the follower down the "lost the
         host" path either, which had people retrying a room they were in. */
      /* `SYNC.leaving` is the third case, and the one that made Leave useless:
         a socket closing *because we are leaving* must not be read as the host
         disappearing. See syncLeave(). */
      if(SYNC.leaving || conn.__superseded || SYNC.conns[conn.peer] !== conn){ syncRender(); return; }
      delete SYNC.conns[conn.peer];
      delete SYNC.roster[conn.peer]; delete SYNC.waiting[conn.peer];
      delete SYNC.codes[conn.peer];
      delete SYNC.seen[conn.peer];
      if(syncIsHost()){
        // if the person holding the timer drops, the host takes it back
        if(SYNC.leaderId === conn.peer){ SYNC.leaderId = SYNC.selfId; syncBroadcastState(); }
        syncBroadcast(syncRosterMsg());
        syncGameRosterChanged();
      }else if(SYNC.mode === 'joined' && SYNC.moving){
        // we are already dialling somewhere else; this is the old room letting go
      }else if(SYNC.mode === 'joined'){
        const said = conn.__saidBye;
        const code = SYNC.code;
        syncLeave(true, !said);
        if(said) syncSetStatus('The host closed the room');
        else syncRetry(code);
      }
      syncRender();
    });
    /* A call that never connects at all — the room isn't open yet, most likely
       because it has just moved and its new host is still starting up. Left
       alone this waited on the eight-second timeout in syncJoin, which is a
       very long time to look disconnected. */
    conn.on('error', ()=>{
      if(SYNC.mode === 'joined' && SYNC.rejoinCode && !Object.keys(SYNC.conns).length){
        syncRetry(SYNC.rejoinCode);
      }
    });
  }

  async function syncOpenPeer(id, mayFallBack){
    try{
      return await syncOpenPeerAt(id);
    }catch(err){
      if(mayFallBack && err && err.type === 'unavailable-id') return await syncOpenPeerAt(undefined);
      throw err;
    }
  }
  async function syncOpenPeerAt(id){
    const Peer = await syncLoadLib();
    return new Promise((resolve, reject)=>{
      const peer = new Peer(id, {debug:0});
      let settled = false;
      peer.on('open', (realId)=>{
        settled = true;
        SYNC.selfId = realId || id;
        resolve({peer, id:SYNC.selfId});
      });
      peer.on('error', (err)=>{
        if(settled) return;
        settled = true;
        reject(err || new Error('connection failed'));
      });
      peer.on('connection', (conn)=>syncWire(conn, true));
    });
  }

  /* Your own code is one id at the broker, and the broker keeps it reserved
     until it notices the last socket holding it is dead. A tab that was killed
     or a laptop that slept leaves it held for a little while — so the very
     person it belongs to is refused it, and "that code is already in use" is
     both true and useless, because the one using it is them. Waiting works.
     Only for your own code: a one-off room can just take a different one. */
  const SYNC_HOST_RETRY = 2200;
  const SYNC_HOST_TRIES = 3;

  /** Start hosting. `useMine` reuses your saved friend code; otherwise a fresh room. */
  async function syncHost(useMine, attempt){
    if(syncActive()) syncLeave(true);
    const code = useMine ? (SYNC.myCode || syncCode()) : syncCode();
    const era = SYNC.epoch;
    syncSetStatus(attempt ? 'Your last session is still closing — trying again…' : 'Opening…');
    try{
      const {peer, id} = await syncOpenPeer(SYNC_NS + code.toLowerCase());
      if(era !== SYNC.epoch){ try{ peer.destroy(); }catch(e){} return; }
      SYNC.peer = peer; SYNC.code = code; SYNC.mode = 'hosting';
      SYNC.selfId = id; SYNC.leaderId = id; SYNC.hostId = id;
      SYNC.seen = {}; SYNC.hostSeen = 0;
      if(useMine){ SYNC.myCode = code; syncSave(); }
      clearInterval(SYNC.beat);
      SYNC.beat = setInterval(syncHeartbeat, SYNC_BEAT);
      syncSetStatus('Waiting for others to join');
    }catch(err){
      const held = !!(err && err.type === 'unavailable-id');
      const n = (attempt || 0) + 1;
      if(held && useMine && n < SYNC_HOST_TRIES){
        setTimeout(()=>{ if(SYNC.epoch === era && !syncActive()) syncHost(useMine, n); },
          SYNC_HOST_RETRY);
        syncRender();
        return;
      }
      /* Your own code being held means one of two things, and with an account
         the likely one is the other device you are signed in on — the code is
         the account's now, so both devices ask for the same room. Saying "it
         did not close properly" there sends people looking for a fault that is
         not there. */
      syncSetStatus(!held ? 'Could not connect. Check your internet.'
        : useMine && SYNC.accountCode
          ? 'Your code is in a room on another device. Leave it there, or open a one-off room.'
        : useMine ? 'Your code is still held. Give it a minute, or open a one-off room.'
        : 'That code is already in use — try a new room');
      SYNC.mode = 'off';
    }
    syncRender();
  }

  /** Join someone else's code. */
  async function syncJoin(raw, isRetry){
    const code = syncNormalise(raw);
    if(code.length < 4){ syncSetStatus('That code looks too short'); return; }
    if(!isRetry) syncStopRetrying();
    if(syncActive()) syncLeave(true, true);
    /* Both of these are async, and Leave can land in the middle of one. Without
       an era check the awaited connection finishes afterwards and sets `mode`
       back to 'joined' — you press Leave, nothing appears to happen, and a
       moment later you are in the room again. */
    const era = SYNC.epoch;
    syncSetStatus(SYNC.moving ? 'Moving to '+SYNC.moving+'’s room…'
      : isRetry ? 'Reconnecting to '+code+' (try '+SYNC.rejoinTries+')…'
      : 'Connecting to '+code+'…');
    try{
      const mine = (SYNC.myCode || '').toLowerCase();
      const {peer} = await syncOpenPeer(mine ? SYNC_NSU + mine : undefined, true);
      if(era !== SYNC.epoch){ try{ peer.destroy(); }catch(e){} return; }
      SYNC.peer = peer; SYNC.mode = 'joined'; SYNC.code = code; SYNC.leaderId = null;
      SYNC.hostId = SYNC_NS + code.toLowerCase();
      SYNC.seen = {}; SYNC.hostSeen = Date.now();
      const conn = peer.connect(SYNC.hostId, {reliable:true});
      syncWire(conn, false);
      clearInterval(SYNC.beat);
      SYNC.beat = setInterval(syncHeartbeat, SYNC_BEAT);
      setTimeout(()=>{
        if(SYNC.mode === 'joined' && !Object.keys(SYNC.conns).length){
          if(SYNC.rejoinCode) syncRetry(code);
          else syncSetStatus('No answer — are they hosting right now?');
        }
      }, 8000);
    }catch(err){
      SYNC.mode = 'off';
      if(isRetry || SYNC.rejoinCode) syncRetry(code);
      else syncSetStatus('Could not connect. Check your internet.');
    }
    syncRender();
  }

  /* ---- getting back in ----
     Wifi drops, a phone sleeps, a laptop lid closes. Before this, any of those
     ended the room for the person it happened to and they had to find the code
     and type it again — which, in the middle of a shared block, means they just
     don't bother.

     So a lost connection schedules a rejoin instead of a goodbye. Backoff is
     short at first, because most drops are a couple of seconds of nothing, and
     then lengthens so a genuinely-gone host isn't dialled forever.

     Only joiners retry. A host's peer id is the room, so if its own peer dies
     the room is gone and there is nothing to rejoin. */

  const SYNC_RETRY_MS = [600, 1500, 3000, 6000, 12000];

  function syncRetry(code){
    clearTimeout(SYNC.rejoin);
    const wait = SYNC_RETRY_MS[Math.min(SYNC.rejoinTries, SYNC_RETRY_MS.length - 1)];
    SYNC.rejoinCode = code;
    SYNC.rejoinTries++;
    syncSetStatus('Connection lost — trying again…');
    SYNC.rejoin = setTimeout(()=>{
      SYNC.rejoin = null;
      if(SYNC.rejoinCode) syncJoin(SYNC.rejoinCode, true);
    }, wait);
    syncRender();
  }

  function syncStopRetrying(){
    clearTimeout(SYNC.rejoin);
    SYNC.rejoin = null; SYNC.rejoinCode = null; SYNC.rejoinTries = 0;
  }

  /* **The state has to be true before the sockets are told.**

     This set `mode = 'off'` *after* closing every connection, and closing a
     connection can fire its `close` handler there and then rather than on a
     later tick. That handler read `SYNC.mode`, found 'joined', concluded the
     host had vanished, and called `syncRetry` — so pressing Leave dropped you
     out of the room and immediately dialled straight back into it. From the
     outside the button simply did not work.

     Everything the handlers read is set first, and `SYNC.leaving` covers the
     synchronous case outright: a handler running *during* the teardown has no
     business acting on it at all. */
  function syncLeave(quiet, keepRetry){
    SYNC.epoch++;                 // anything still connecting is now stale
    SYNC.leaving = true;
    const conns = SYNC.conns;
    SYNC.mode = 'off'; SYNC.code = null;
    SYNC.selfId = null; SYNC.leaderId = null; SYNC.hostId = null;
    SYNC.lastState = null;
    if(!keepRetry){
      syncStopRetrying(); SYNC.moving = ''; SYNC.leaveAfterMove = false;
      SYNC.expect = []; SYNC.expectUntil = 0;
    }
    clearInterval(SYNC.beat); SYNC.beat = null;
    for(const id in conns) syncSend(conns[id], {t:'bye'});
    for(const id in conns){ try{ conns[id].close(); }catch(e){} }
    SYNC.conns = {}; SYNC.roster = {}; SYNC.codes = {}; SYNC.buddies = {}; SYNC.remoteList = null;
    SYNC.waiting = {}; SYNC.held = false; SYNC.games = {};
    SYNC.seen = {}; SYNC.hostSeen = 0;
    try{ if(SYNC.peer) SYNC.peer.destroy(); }catch(e){}
    SYNC.peer = null;
    SYNC.hostName = ''; SYNC.hostCode = null;
    for(const g in SYNC_GAMES){
      const h = SYNC_GAMES[g];
      if(h && h.apply) try{ h.apply(null); }catch(e){}   // the room is gone
    }
    try{ chatRoomClosed(); }catch(e){}
    try{ quotesClearShared(); }catch(e){}
    SYNC.leaving = false;
    if(!quiet) syncSetStatus('Left');
    syncRender();
  }

  /* ---- friends ----
     The list itself and the rules about it live in 29a-friends.js; these two
     are the old entry points, kept because the room's "keep" button and a few
     other places call them. Adding from the room now carries the username the
     person sent with their `hello`, so somebody met in a room is saved as
     themselves rather than as a code with a nickname typed over it. */
  function syncAddFriend(raw, name){
    const code = syncNormalise(raw);
    if(code.length < 4) return;
    const card = (function(){ try{ return friendCardOf(code); }catch(e){ return null; } })();
    const user = (card && card.u) || '';
    const had = SYNC.friends.some(f=>f.code === code);
    if(had && !user) return;
    try{
      friendSet(code, {u:user || undefined, name:user || (name||'').trim() || code,
        card:card || undefined, ok:1, at:Date.now()});
    }catch(e){
      if(!had){ SYNC.friends.push({code, name:(name||'').trim() || code}); syncSave(); syncRender(); }
    }
  }
  /* The old entry point, kept because the room's rows and a few other places
     call it. It goes through `friendRemove` in 29a-friends.js now, so removing
     somebody takes you off their list as well — a friendship is one thing. */
  function syncRemoveFriend(code){
    try{ friendRemove(code); return; }catch(e){}
    SYNC.friends = SYNC.friends.filter(f=>f.code !== syncNormalise(code));
    syncSave(); syncRender();
  }

  /* ---- who's about ----
     There is no presence service here — the signalling server introduces two
     peers and steps out. So "is Sam online?" is answered the only way it can be:
     by trying to reach Sam's code and seeing whether anybody answers.

     The probe connection is tagged `{probe:true}` and closed straight away, and
     `syncWire` refuses to treat a tagged connection as a joiner — otherwise
     checking on your friends would put a ghost in their room and toast at them.

     Only runs while the Focus together screen is open. Nobody needs their laptop
     dialling five friends in the background. */

  /* Two different questions, so two different addresses.

       fsimp-<code>   you have the app open        -> "around"
       fsim-<code>    you are hosting a room       -> "has a room open"

     Before this they were the same thing, so a friend sitting in the app with no
     room looked identical to a friend who had gone to bed. The beacon is what
     answers the first question: a peer that exists only to be reachable.

     It is not opened at startup — PeerJS is a CDN fetch and everything else in
     the app works offline. It comes up the first time you open Focus together
     and stays up for the rest of the session, which is exactly the window in
     which anyone would care. */
  async function syncBeacon(){
    if(SYNC.beacon || !SYNC.myCode) return;
    try{
      const Peer = await syncLoadLib();
      const id = SYNC_PNS + SYNC.myCode.toLowerCase();
      const peer = new Peer(id, {debug:0});
      peer.on('open', ()=>{ SYNC.beacon = peer; SYNC.beaconOn = true; syncRender(); });
      peer.on('connection', conn=>{
        /* Two kinds of caller. A presence check wants nothing but an answer. A
           delivery wants to hand over messages — so the beacon is a letterbox
           as well as a doorbell, and that is the whole of offline messaging. */
        conn.on('data', m=>{
          if(!m || m.t !== 'mail') return;
          let ids = [];
          try{
            chatReceiveMail(m.items);
            ids = (m.items || []).map(x=>x && x.id).filter(Boolean);
          }catch(e){}
          syncSend(conn, {t:'mailok', ids});
        });
        conn.on('open', ()=>{
          // a plain knock gets closed; a delivery is given a moment to speak
          const wait = (conn.metadata && conn.metadata.mail) ? SYNC_MAIL_WAIT : 30;
          setTimeout(()=>{ try{ conn.close(); }catch(e){} }, wait);
        });
        /* A call that never connects at all — the room isn't open yet, most likely
       because it has just moved and its new host is still starting up. Left
       alone this waited on the eight-second timeout in syncJoin, which is a
       very long time to look disconnected. */
    conn.on('error', ()=>{
      if(SYNC.mode === 'joined' && SYNC.rejoinCode && !Object.keys(SYNC.conns).length){
        syncRetry(SYNC.rejoinCode);
      }
    });
      });
      peer.on('error', ()=>{ SYNC.beaconOn = false; });
    }catch(e){ SYNC.beaconOn = false; }
  }
  function syncBeaconStop(){
    try{ if(SYNC.beacon) SYNC.beacon.destroy(); }catch(e){}
    SYNC.beacon = null; SYNC.beaconOn = false;
    syncRender();
  }

  /* ---- the post ----
     There is no server here, so there is nothing to leave a message *on*. What
     there is, is the presence beacon: a peer that exists whenever the other
     person has the app open. So a message to somebody who isn't in your room
     waits in an outbox and is posted into their beacon the first moment both
     apps are up.

     Be clear about what this is and isn't. It is real store-and-forward between
     two devices, so you can write at midnight and they read it in the morning —
     provided your app is open at some point while theirs is too. It is not a
     mailbox that holds things while you are closed; that needs a relay, and a
     relay needs a backend this app deliberately doesn't have.

     Delivery is idempotent: the receiver drops any id it already has, and the
     sender only clears what was acknowledged. A failed post costs a retry, never
     a lost or duplicated message. */

  var SYNC_MAIL_EVERY = 90000;      // how often to try, while the app is open
  var SYNC_MAIL_WAIT = 6000;        // how long to give one peer delivery
  var SYNC_HTTP_WAIT = 8000;        // and one request to the mailbox

  function syncMailPost(peer, code, items){
    return new Promise(done=>{
      let settled = false;
      const finish = (ids)=>{ if(!settled){ settled = true; done(ids); } };
      let conn;
      try{ conn = peer.connect(SYNC_PNS + code.toLowerCase(), {metadata:{mail:true}}); }
      catch(e){ return finish(null); }
      const t = setTimeout(()=>{ try{ conn.close(); }catch(e){} finish(null); }, SYNC_MAIL_WAIT);
      conn.on('open', ()=>{ syncSend(conn, {t:'mail', items}); });
      conn.on('data', m=>{
        if(m && m.t === 'mailok'){
          clearTimeout(t);
          setTimeout(()=>{ try{ conn.close(); }catch(e){} }, 20);
          finish(m.ids || []);
        }
      });
      conn.on('error', ()=>{ clearTimeout(t); finish(null); });
    });
  }

  /* ---- the mailbox ----
     Optional, and off unless a URL is set. See server/mailbox.js.

     The peer path stays the fast one and is always tried first: it is direct,
     instant, and nothing but the two devices ever sees the message. The server
     is the fallback for the case peers cannot cover — the recipient being closed
     — and it only ever holds what could not be handed over.

     Identity is a code plus a device token. The code is public (it is how people
     join your room), so the token is what actually proves the mailbox is yours;
     it is generated once, kept locally, and never leaves except to this server. */

  function syncHttp(path, body){
    const base = String(SYNC_MAILBOX||'').replace(/\/+$/, '');
    if(!base) return Promise.resolve(null);
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = ctl ? setTimeout(()=>ctl.abort(), SYNC_HTTP_WAIT) : null;
    return fetch(base + path, {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(body),
      signal:ctl ? ctl.signal : undefined,
    }).then(r=>r.json()).then(j=>{ clearTimeout(t); return j; })
      .catch(()=>{ clearTimeout(t); return null; });
  }

  /** Collect anything the server is holding for us, then tell it we have it. */
  async function syncMailFetch(){
    if(SYNC.fetching || !SYNC_MAILBOX || !SYNC.myCode || !SYNC.token) return;
    SYNC.fetching = true;
    try{
      const r = await syncHttp('/inbox', {code:SYNC.myCode, token:SYNC.token});
      if(r && r.ok && r.items && r.items.length){
        let taken = [];
        try{ chatReceiveMail(r.items); taken = r.items.map(x=>x.id).filter(Boolean); }catch(e){}
        // Only acknowledge what we actually stored. Acking first would be faster
        // and would lose messages the moment anything threw.
        if(taken.length) await syncHttp('/ack', {code:SYNC.myCode, token:SYNC.token, ids:taken});
      }else if(r && !r.ok && /another device/.test(r.error||'')){
        syncSetStatus('That mailbox is claimed by another device');
      }
    }catch(e){}
    SYNC.fetching = false;
  }

  async function syncMailRun(){
    if(SYNC.posting) return;
    let codes = [];
    try{ codes = chatPendingCodes(); }catch(e){ return; }
    if(!codes.length){ syncMailFetch(); return; }

    SYNC.posting = true;
    try{
      const Peer = await syncLoadLib();
      let peer = SYNC.peer, temp = null;
      if(!peer){
        temp = await new Promise((resolve, reject)=>{
          const p = new Peer(undefined, {debug:0});
          const t = setTimeout(()=>reject(new Error('slow')), SYNC_PROBE_MS);
          p.on('open', ()=>{ clearTimeout(t); resolve(p); });
          p.on('error', (e)=>{ clearTimeout(t); reject(e); });
        });
        peer = temp;
      }
      for(const code of codes){
        const items = chatPending(code);
        if(!items.length) continue;
        const ids = await syncMailPost(peer, code, items);
        if(ids && ids.length) chatDelivered(code, ids);
      }
      if(temp){ try{ temp.destroy(); }catch(e){} }
    }catch(e){ /* offline; the outbox keeps */ }

    // Whatever the peers could not take, hand to the server if there is one.
    if(SYNC_MAILBOX){
      for(const code of chatPendingCodes()){
        for(const m of chatPending(code).slice()){
          const r = await syncHttp('/send', {
            to:code, from:SYNC.myCode, id:m.id, name:m.name, text:m.text, at:m.at,
          });
          if(r && r.ok) chatDelivered(code, [m.id]);
        }
      }
    }

    SYNC.posting = false;
    syncMailFetch();
  }

  /** Knock on one address. Resolves true if anybody answers. */
  function syncKnock(peer, id){
    return new Promise(done=>{
      let settled = false;
      const finish = (up)=>{ if(!settled){ settled = true; done(up); } };
      let conn;
      try{ conn = peer.connect(id, {metadata:{probe:true}}); }
      catch(e){ return finish(false); }
      const t = setTimeout(()=>{ try{ conn.close(); }catch(e){} finish(false); }, SYNC_PROBE_MS);
      conn.on('open', ()=>{
        clearTimeout(t);
        setTimeout(()=>{ try{ conn.close(); }catch(e){} }, 20);
        finish(true);
      });
      conn.on('error', ()=>{ clearTimeout(t); finish(false); });
    });
  }

  async function syncCheckOnline(){
    if(SYNC.probing || !SYNC.friends.length) return;
    SYNC.probing = true;
    syncRender();
    try{
      const Peer = await syncLoadLib();
      // Reuse the room's peer if we're in one; otherwise a throwaway.
      let peer = SYNC.peer, temp = null;
      if(!peer){
        temp = await new Promise((resolve, reject)=>{
          const p = new Peer(undefined, {debug:0});
          const t = setTimeout(()=>reject(new Error('slow')), SYNC_PROBE_MS);
          p.on('open', ()=>{ clearTimeout(t); resolve(p); });
          p.on('error', (e)=>{ clearTimeout(t); reject(e); });
        });
        peer = temp;
        SYNC.probePeer = temp;
      }

      await Promise.all(SYNC.friends.map(async f=>{
        const code = f.code.toLowerCase();
        const [around, room] = await Promise.all([
          syncKnock(peer, SYNC_PNS + code),
          syncKnock(peer, SYNC_NS + code),
        ]);
        SYNC.online[f.code] = around || room;   // a room open means around too
        SYNC.inRoom[f.code] = room;
      }));

      if(temp){ try{ temp.destroy(); }catch(e){} SYNC.probePeer = null; }
    }catch(e){
      // offline, or the signalling server is unreachable — say nothing rather
      // than claim everybody is offline
      SYNC.online = {}; SYNC.inRoom = {};
    }
    SYNC.probing = false;
    syncRender();
  }

  function syncSave(){
    try{
      KV.set('focus_sync', JSON.stringify({
        myCode:SYNC.myCode, accountCode:SYNC.accountCode,
        name:SYNC.name, friends:SYNC.friends, asks:SYNC.asks,
        token:SYNC.token,
      }));
    }catch(e){}
  }
  async function syncLoad(){
    try{
      const r = await KV.get('focus_sync');
      if(r && r.value){
        const d = JSON.parse(r.value);
        if(d && typeof d.myCode === 'string') SYNC.myCode = d.myCode;
        SYNC.accountCode = !!(d && d.accountCode);
        if(d && typeof d.name === 'string') SYNC.name = d.name;
        if(d && Array.isArray(d.friends)) SYNC.friends = d.friends;
        if(d && d.asks && typeof d.asks === 'object') SYNC.asks = d.asks;
        if(d && typeof d.token === 'string') SYNC.token = d.token;
      }
    }catch(e){}
    if(!SYNC.myCode){ SYNC.myCode = syncCode(); syncSave(); }
    /* Long and random. This is the only thing standing between your mail and
       anybody who knows your code, which is everybody you have played with. */
    if(!SYNC.token){
      SYNC.token = syncCode(16).toLowerCase() + Math.random().toString(36).slice(2, 14)
                 + Date.now().toString(36);
      syncSave();
    }
    syncRender();
    syncStartBackground();
  }

  /* ---- screen ---- */
  function syncPeople(){
    if(syncIsHost()){
      /* Built from the connections, not from the roster of names. Those are
         different questions: the roster is filled by `hello`, and a `hello` can
         be lost — a peer that reconnected while its own sends were failing came
         back connected but nameless, and vanished from the list while being very
         much in the room. Who is here is who is connected. */
      const list = [{id:SYNC.selfId, name:SYNC.name || 'You', code:SYNC.myCode, me:true,
        buddy:budSaved(), anim:budAnimSaved(), g:syncMyGame()}];
      for(const id in SYNC.conns){
        if(id === SYNC.selfId) continue;
        if(SYNC.waiting[id]) continue;         // still at the door; not in the room
        list.push({id, name:SYNC.roster[id] || 'Someone', code:SYNC.codes[id]||'', me:false,
          buddy:SYNC.buddies[id] || null, anim:(SYNC.anims[id] | 0), g:SYNC.games[id] || ''});
      }
      return list.map(p=>Object.assign(p, {leader:p.id === SYNC.leaderId}));
    }
    if(SYNC.remoteList){
      return SYNC.remoteList.map(p=>({
        id:p.id, name:p.name || 'Someone', code:p.code || '', buddy:p.buddy || null,
        anim:(p.anim | 0), g:p.g || '',
        /* Our own row comes from the roster like everybody else's, but the host
           only hears what we are playing on the next heartbeat — so read it
           locally rather than waiting a beat to see ourselves move. */
        leader:p.id === SYNC.leaderId, me:p.id === SYNC.selfId,
      })).map(p=>p.me ? Object.assign(p, {g:syncMyGame()}) : p);
    }
    return [];
  }

  function syncIsFriend(code){ return !!code && SYNC.friends.some(f=>f.code === code); }

  /* **Who is playing what belongs on the game, not on the person.**

     This was a glyph beside each name in the room list, which answered the
     question backwards: you do not look down a list of people wondering what
     each is doing, you look at the shelf wondering whether anyone is on
     something. So it moved to the picker — their faces on the card — and the
     list went back to being a list of people. `syncInGame` is what the arcade
     asks; the wire is unchanged. See `Arcade._faces` in 09-arcade-core.js. */
  function syncInGame(id){
    if(!syncActive()) return [];
    return syncPeople().filter(p=>!p.me && p.g === id);
  }

  /* ================= THE WAITING ROOM =================

     **A code is not an introduction.**

     A room code is six characters and it gets passed around: read out, put in a
     message, forwarded by somebody you told it to. That is fine for a friend
     and it is the whole problem for a stranger, who arrived in the room and was
     simply *there* — named in the roster, in the chat, watching the timer.

     So somebody the host does not know is held at the door. They are connected
     (there is no other way to ask) but they are not in the roster, they get no
     state and no chat, and the room is told that somebody is waiting. The
     leader lets them in or does not.

     **Friends are not held.** Being on the host's friends list *is* the
     introduction, and making people knock every time they join a friend's room
     would be friction for the case that does not need it. `syncNeedsLetIn`
     below is the whole rule.

     The host decides, because the host holds the connections. The *leader*
     presses the button, because the leader is whoever is running the room at
     that moment; when they are not the same person the host relays it. */
  function syncNeedsLetIn(code){
    if(!syncIsHost()) return false;
    const f = SYNC.friends.find(x=>x.code === syncNormalise(code || ''));
    return !(f && f.ok);
  }
  function syncWaitingList(){
    return Object.keys(SYNC.waiting).map(id=>Object.assign({id}, SYNC.waiting[id]));
  }
  /** **What a new arrival is told, once they are actually in.**

      Who is here, and what the timer is doing. The state matters and is easy to
      get wrong: it used to be sent only when the host *was* the leader, so after
      a hand-over a new arrival got a roster and nothing else, and sat on
      whatever screen they were already on while the room was somewhere else.
      The host relays every state it sees, so keeping the last one answers the
      question for whoever turns up next. Without it a joiner never hears
      "setup" and is left running a timer nobody else is on. */
  function syncGreet(conn){
    if(!conn || !syncIsHost()) return;
    syncSend(conn, syncRosterMsg());
    const first = syncIsLeader() ? syncStateMsg() : SYNC.lastState;
    if(first) syncSend(conn, first);
  }

  /** Let somebody in: they join the roster, hear the room, and are announced. */
  function syncAdmit(id){
    if(!SYNC.waiting[id]) return;
    const who = SYNC.waiting[id];
    delete SYNC.waiting[id];
    if(!syncIsHost()){
      /* The leader is not the host, so the host is the one holding the socket.
         Ask it to do the letting in. */
      syncBroadcast({t:'letin', id});
      return;
    }
    SYNC.roster[id] = who.name || 'Someone';
    if(who.code) SYNC.codes[id] = who.code;
    if(who.buddy) SYNC.buddies[id] = who.buddy;
    SYNC.anims[id] = who.anim | 0;
    const conn = SYNC.conns[id];
    if(conn){
      syncSend(conn, {t:'letin'});
      syncGreet(conn);
    }
    syncBroadcast(syncRosterMsg());
    syncGameRosterChanged();
    try{ chatNote((who.name || 'Someone') + ' was let in'); }catch(e){}
    syncRender();
  }
  /** Turn somebody away. The connection goes; the code still works, so this is
      "not now" rather than a ban — which is the honest strength for a thing with
      no accounts behind it. */
  function syncRefuse(id){
    const who = SYNC.waiting[id];
    delete SYNC.waiting[id];
    if(!syncIsHost()){ syncBroadcast({t:'refuse', id}); syncRender(); return; }
    const conn = SYNC.conns[id];
    if(conn){
      try{ syncSend(conn, {t:'refused'}); }catch(e){}
      setTimeout(()=>{ try{ conn.close(); }catch(e){} }, 120);
    }
    try{ chatNote((who && who.name ? who.name : 'Someone') + ' was not let in'); }catch(e){}
    syncRender();
  }

  function syncRender(){
    /* The shelf shows who is on what, so it has to hear about the room even
       when Focus together is not the screen you are looking at. Cheap and
       idempotent; it does nothing at all when the picker is closed. */
    try{ if(Arcade.open && !Arcade.active) Arcade._faces(); }catch(e){}
    if(!$('sync-body')) return;

    const codeEl = $('sync-mycode');
    if(codeEl) codeEl.textContent = SYNC.myCode || '——————';

    const nameEl = $('sync-name');
    if(nameEl && document.activeElement !== nameEl) nameEl.value = SYNC.name;

    const st = $('sync-state');
    if(st){
      // Say whose room it is, not just its code — a code is not a person.
      const whose = SYNC.hostName ? SYNC.hostName + '’s room' : (SYNC.code || '');
      /* Waiting at the door is its own state, and saying "In Sam's room" while
         you are demonstrably not is worse than saying nothing. */
      st.textContent = SYNC.held ? 'Waiting to be let in'
        : SYNC.mode === 'hosting'
        ? 'Hosting '+(SYNC.code||'')
        : SYNC.mode === 'joined' ? 'In '+whose+' · '+(SYNC.code||'') : 'Not connected';
      st.className = 'sync-state' + (SYNC.held ? ' wait' : syncActive() ? ' on' : '');
    }

    const people2 = syncPeople();
    $('sync-leave').classList.toggle('hide', !syncActive());
    const lsub = $('sync-leave-sub');
    if(lsub){
      const others = people2.length - 1;
      lsub.textContent = !syncIsHost()
        ? (SYNC.hostName ? 'Stop following ' + SYNC.hostName + '’s timer' : 'Stop sharing this timer')
        : others > 0 ? 'Hand it on, or close it for everyone'
        : 'Nobody else is here, so it closes';
    }
    $('sync-host').classList.toggle('hide', syncActive());
    $('sync-room').classList.toggle('hide', syncActive());

    const people = syncPeople();
    const canManage = syncIsLeader();
    /* ---- anybody at the door ----

       **Whoever runs the room answers the door.** Only they get this panel,
       because only the host is holding the connection and only the leader has
       any business deciding. Everybody else in the room hears about it in the
       room chat, which is where the room's news goes and is enough: a follower
       being shown a decision they cannot take is a worse kind of nothing than
       not being shown it. */
    const dbox = $('sync-door');
    if(dbox){
      const at = (syncActive() && syncIsLeader()) ? syncWaitingList() : [];
      dbox.classList.toggle('hide', !at.length);
      dbox.innerHTML = at.map(w=>
        '<div class="ft-wait"><b>' + esc(w.name || 'Someone') + '</b>'
        + '<span>wants to come in</span>'
        + '<button class="mini-btn" data-letin="' + esc(w.id) + '">Let in</button>'
        + '<button class="sync-x" data-refuse="' + esc(w.id) + '" aria-label="Not now">×</button>'
        + '</div>').join('');
      dbox.querySelectorAll('[data-letin]').forEach(b=>{
        b.onclick = ()=>syncAdmit(b.dataset.letin);
      });
      dbox.querySelectorAll('[data-refuse]').forEach(b=>{
        b.onclick = ()=>syncRefuse(b.dataset.refuse);
      });
    }

    const pbox = $('sync-people');
    if(pbox){
      pbox.classList.toggle('hide', !syncActive());
      pbox.innerHTML = people.length
        ? '<p class="q-sec">In this room</p>' + people.map(p=>{
            /* **Only the leader gets a tag.** "Following" appeared on every
               other row, said the same thing each time, and was the first
               thing to squeeze a name to "S..." once the game mark arrived.
               Who holds the timer is the fact worth a label; everybody else
               not holding it is what the absence of one means. */
            const tag = p.leader ? '<em>holds the timer</em>' : '';
            // Only the timer holder gets the controls, and never against itself.
            const acts = (canManage && !p.me)
              ? '<button class="mini-btn" data-lead="'+esc(p.id)+'">Give timer</button>'
                + '<button class="sync-x" data-kick="'+esc(p.id)+'" aria-label="Remove">×</button>'
              : '';
            // Anyone in the room can be kept, because `hello` carries their own
            // code — the peer id most of them are using is a throwaway.
            const keep = (!p.me && p.code && !syncIsFriend(p.code))
              ? '<button class="mini-btn" data-keep="'+esc(p.code)+'" data-name="'+esc(p.name)+'">+ Friend</button>'
              : (!p.me && syncIsFriend(p.code) ? '<span class="sync-kept">friend</span>' : '');
            /* **Their buddy does their antic, not yours.** The one you picked
               says nothing about them, and a room of four identical swimmers
               is worse than four still figures.

               And the switch is *yours*: turning buddies off empties the whole
               column for you and changes nothing for anybody else. It is a
               preference about your screen, not an instruction to the room. */
            const pose = Buddy.shown() ? budAnimKey(p.anim) : '';
            return '<div class="sync-person'+(p.leader?' lead':'')+'">'
              + (Buddy.shown() ? '<span class="sync-bud bud-mini-'+pose+'">' + budSvg(p.buddy, 30) + '</span>' : '')
              + '<span class="sync-who">'+esc(p.name)+(p.me?' <i>(you)</i>':'')+'</span>'
              + tag + keep + acts + '</div>';
          }).join('')
        : '<p class="cal-empty">Nobody else yet. Share your code.</p>';

      // Handing the clock over and removing someone are both hard to undo in a
      // room of three — ask first.
      pbox.querySelectorAll('[data-lead]').forEach(b=>{
        const who = (people.find(p=>p.id === b.dataset.lead) || {}).name || 'them';
        b.onclick = ()=>askConfirm('Give the timer to ' + who + '?',
          'Their start, pause and skip will drive everyone’s clock, including yours — '
          + 'and the room moves to their code, so everybody follows them from now on.',
          'Give timer', ()=>syncHandOver(b.dataset.lead));
      });
      pbox.querySelectorAll('[data-kick]').forEach(b=>{
        const who = (people.find(p=>p.id === b.dataset.kick) || {}).name || 'them';
        b.onclick = ()=>askConfirm('Remove ' + who + '?',
          'They’ll be disconnected from the room. They can rejoin with the code.',
          'Remove', ()=>syncKick(b.dataset.kick));
      });
      pbox.querySelectorAll('[data-keep]').forEach(b=>{
        b.onclick = ()=>{ syncAddFriend(b.dataset.keep, b.dataset.name); toast('Saved to friends'); };
      });
    }

    const me = $('sync-me');
    if(me){
      me.textContent = SYNC.beaconOn
        ? (syncIsHost() ? 'Friends can see you’re around, with a room open'
                        : 'Friends can see you’re around')
        : '';
    }

    const chk = $('sync-check');
    if(chk){
      chk.disabled = SYNC.probing || !SYNC.friends.length;
      chk.textContent = SYNC.probing ? 'Checking…' : 'Who’s around';
    }

    /* ---- you, at the top ----
       What a friend sees when they open your profile, shown to you first, so
       the page opens on a person rather than on a string to copy out. */
    const mebox = $('ft-me');
    if(mebox){
      const who = friendMe();
      const card = friendCard();
      mebox.innerHTML = '<div class="ft-me-top">'
        + (Buddy.shown() && card.buddy ? '<span class="ft-face">' + budSvg(card.buddy, 46) + '</span>' : '')
        + '<div class="ft-me-who"><b>' + esc(who || SYNC.name || 'Not signed in') + '</b>'
        + '<span>' + esc(who ? 'Friends find you by this' : 'Sign in to be findable by name') + '</span></div>'
        + '</div>'
        + friendStatsHtml(card);
    }

    /* ---- anybody waiting on an answer ---- */
    const abox = $('ft-asks');
    if(abox){
      const asks = Object.keys(SYNC.asks || {}).map(k=>SYNC.asks[k]).filter(Boolean);
      abox.classList.toggle('hide', !asks.length);
      abox.innerHTML = asks.map(a=>
        '<div class="ft-ask"><b>' + esc(a.u || a.code) + '</b>'
        + '<span>wants to be friends</span>'
        + '<button class="mini-btn" data-yes="' + esc(a.code) + '">Accept</button>'
        + '<button class="sync-x" data-no="' + esc(a.code) + '" aria-label="Ignore">×</button></div>').join('');
      abox.querySelectorAll('[data-yes]').forEach(b=>{ b.onclick = ()=>friendAccept(b.dataset.yes); });
      abox.querySelectorAll('[data-no]').forEach(b=>{ b.onclick = ()=>friendDecline(b.dataset.no); });
    }

    /* ---- the room, hidden entirely when there is not one ---- */
    const rbox = $('ft-room');
    if(rbox) rbox.classList.toggle('hide', !syncActive());

    const fbox = $('sync-friends');
    if(fbox){
      fbox.innerHTML = SYNC.friends.length
        ? SYNC.friends.map(f=>{
            const up = SYNC.online[f.code], room = SYNC.inRoom[f.code];
            const here = syncActive() && (f.code === SYNC.hostCode || f.code === SYNC.code);
            // Around and hosting are separate facts, so they get separate marks.
            const dot = up === true ? '<i class="sync-dot on" title="Around"></i>'
                      : up === false ? '<i class="sync-dot" title="Not answering"></i>'
                      : '';
            const tag = here ? '<span class="sync-tag">joined</span>'
                      : room ? '<span class="sync-tag">room open</span>'
                      : f.ok === undefined && f.asked ? '<span class="sync-tag quiet">asked</span>'
                      : up === true ? '<span class="sync-tag quiet">around</span>' : '';
            /* **The row is the profile.** Their name opens what they last told
               you about themselves; the buttons beside it are the two things
               you would do without looking. */
            return '<div class="sync-friend'+(here?' here':'')+'">'
              + dot
              + '<button class="ft-who" data-who="'+esc(f.code)+'">'
                + '<b>'+esc(friendLabel(f))+'</b>'
                + (f.u ? '' : '<code>'+esc(f.code)+'</code>')
              + '</button>'
              + tag
              + (here ? '' : '<button class="mini-btn" data-join="'+esc(f.code)+'">Join</button>')
              + '<button class="sync-x" data-drop="'+esc(f.code)+'" aria-label="Remove">×</button></div>';
          }).join('')
        : '<p class="cal-empty">Nobody yet. Add someone by their username.</p>';
      fbox.querySelectorAll('[data-join]').forEach(b=>{ b.onclick = ()=>syncJoin(b.dataset.join); });
      fbox.querySelectorAll('[data-who]').forEach(b=>{ b.onclick = ()=>profOpen(b.dataset.who); });
      fbox.querySelectorAll('[data-drop]').forEach(b=>{
        const f = friendFind(b.dataset.drop);
        b.onclick = ()=>askConfirm('Remove ' + friendLabel(f) + '?',
          'They stay on your messages; only the friends list changes.',
          'Remove', ()=>syncRemoveFriend(b.dataset.drop));
      });
    }

    const band = $('sync-band');
    if(band){
      const show = syncActive() && Object.keys(SYNC.conns).length > 0;
      band.classList.toggle('hide', !show);
      if(show){
        const host = people.find(p=>p.leader);
        /* Tappable. It is the only thing on the timer screen that knows there
           are other people, so it is the obvious place to press to see them —
           and it was inert, which made it look like a status bar rather than a
           way in. */
        /* **Everyone in the room, on the screen you are actually looking at.**
           Their buddies were only ever in Focus together, which is a page you
           open once and leave — so the people you were sitting with were
           invisible for the whole of the block. Each does their *own* antic,
           small enough to live in a band above the dial.

           Your own switch governs the whole strip: turning buddies off is a
           statement about your screen, not an instruction to the room. */
        const others = people.filter(p=>!p.me);
        const crowd = (Buddy.shown() && others.length)
          ? '<span class="sync-band-buds">' + others.slice(0, 6).map(p=>
              '<span class="sync-bud bud-mini-' + budAnimKey(p.anim) + '"'
              + ' title="' + esc(p.name) + '">' + budSvg(p.buddy, 26) + '</span>').join('')
            + '</span>'
          : '';
        band.innerHTML = crowd + '<span class="sync-band-txt">' + esc(syncIsLeader()
          ? 'You hold the timer · '+people.length+' here'
          : 'Following '+((host && host.name) || 'the host')) + ' ›</span>';
        band.setAttribute('role', 'button');
        band.setAttribute('tabindex', '0');
        band.onclick = ()=>{ try{ closeDrawer(); }catch(e){} $('sync-overlay').classList.remove('hide'); syncRender(); };
      }
    }

    /* Who is in the room changed, so the crowd on the timer screen did too —
       and that screen is behind this one, not in it. `stage()` is signature-
       guarded, so calling it when nothing moved costs a string compare. */
    try{ Buddy.stage(); }catch(e){}

    // the shared games' picker cards say whether there's a room to play in
    try{ if(Arcade.open && !Arcade.active) Arcade._refresh(); }catch(e){}
    try{ chatRoomChanged(); }catch(e){}

    // whoever isn't holding the timer doesn't drive it — including cutting the
    // break short from the arcade, which ends it for everybody
    const lock = syncActive() && !syncIsLeader();
    ['toggle-run','skip','stop','begin','ov-focus'].forEach(id=>{
      const b = $(id); if(b) b.disabled = lock;
    });
  }

  function syncOpen(){
    $('sync-overlay').classList.remove('hide');
    syncRender();
    syncBeacon();               // from here on, friends can see you're around
    syncCheckOnline();
    syncMailRun();
    /* Anybody still showing as a bare code gets a name put to them, once. The
       list re-renders itself as each answer lands; see friendResolveAll. */
    try{ friendResolveAll(); }catch(e){}
  }

  /* Once you have friends, the beacon comes up at startup rather than waiting
     for the Focus together screen — it is what lets a message reach you, and a
     letterbox that only exists while you are looking at it is no letterbox.

     Only for people who have actually saved a friend. Everyone else never
     touches the network, which is the offline-first promise this file otherwise
     keeps. */
  function syncStartBackground(){
    if(!SYNC.friends.length && !SYNC_MAILBOX) return;
    syncBeacon();
    syncMailRun();
    clearInterval(SYNC.mailTimer);
    SYNC.mailTimer = setInterval(syncMailRun, SYNC_MAIL_EVERY);
  }
  function syncClose(){ $('sync-overlay').classList.add('hide'); }

  /* **Nothing online without an account.** Rooms, friends and the mailbox all
     hang off a code that is the account's, and everything they earn syncs to
     it — a room joined by somebody with nowhere to keep the result is an
     evening that vanishes when they close the tab. So the door is shut rather
     than the disappointment being delivered later.

     In a build with no account server at all there is nothing to sign into and
     this is exactly as it always was. */
  $('d-sync').onclick = ()=>{
    closeDrawer();
    let need = false;
    try{ need = accConfigured() && !Account.token; }catch(e){}
    if(need){
      askConfirm('Sign in to focus together',
        'Rooms, friends and shared games all hang off your account — it is what '
        + 'your code and your buddy belong to, and what keeps the hours you put '
        + 'in together. Signing in takes a moment.',
        'Take me there', ()=>{ try{ AcctPage.open(); }catch(e){} });
      return;
    }
    syncOpen();
  };
  $('sync-close').onclick = syncClose;
  $('sync-host').onclick = ()=>syncHost(true);
  $('sync-room').onclick = ()=>syncHost(false);
  /* ---- leaving, when you're the one hosting ----
     Leaving used to mean closing: the room was your peer, so your going ended
     everyone's session. That is a bad reason to stay in a room, and a worse one
     to be asked about with a yes/no. So a host with company is offered the
     choice that actually exists — hand it to somebody and go, or close it — and
     whoever holds the timer is offered first, because if the clock is already
     in their hands, ending the room is plainly the wrong answer. */
  function syncLeaveFlow(){
    const others = syncPeople().filter(p=>!p.me);
    if(!syncIsHost() || !others.length){
      const whose = SYNC.hostName ? SYNC.hostName + '’s room' : 'this room';
      askConfirm('Leave ' + whose + '?',
        syncIsHost() ? 'Nobody else is here, so the room closes.'
                     : 'Your timer goes back to being your own.',
        'Leave', ()=>{ syncLeave(); toast('Left the room'); });
      return;
    }

    const holder = others.filter(p=>p.leader).concat(others.filter(p=>!p.leader));
    const items = holder.map(p=>({
      label:'Hand it to ' + p.name + ' and leave',
      run(){
        askConfirm('Hand the room to ' + p.name + '?',
          'They get the timer, and the room moves to their code — everyone else '
          + 'moves across with it. You drop out.',
          'Hand over', ()=>{ SYNC.leaveAfterMove = true; syncHandOver(p.id); });
      },
    }));
    items.push({
      label:'Close the room for everyone', danger:true,
      run(){
        askConfirm('Close the room?',
          others.length + (others.length === 1 ? ' other person is' : ' other people are')
          + ' in here. They’ll be disconnected and their timers go back to being their own.',
          'Close it', ()=>{ syncLeave(); toast('Room closed'); });
      },
    });

    const r = $('sync-leave').getBoundingClientRect();
    openMenu(r.left, r.bottom + 6, items);
  }
  $('sync-leave').onclick = syncLeaveFlow;
  $('sync-join').onclick = ()=>syncJoin($('sync-code').value);
  /* Adding somebody is typing their username — the code is a hash of it, so
     there is nothing to look up. See `friendAsk` in 29a-friends.js. */
  const askGo = ()=>{
    friendAsk($('ft-user').value);
    $('ft-user').value = '';
    friendCodeHint('');
  };
  /* Typing a name shows the code it makes. Only here, only while adding
     somebody — see `friendCodeHint` in 29a-friends.js for why that limit is
     the whole point. */
  if($('ft-user')) $('ft-user').addEventListener('input', ()=>{
    friendCodeHint($('ft-user').value);
  });
  if($('sync-add-legacy')) $('sync-add-legacy').onclick = ()=>{
    syncAddFriend($('sync-code').value);
    $('sync-code').value = '';
  };
  if($('ft-ask')) $('ft-ask').onclick = askGo;
  if($('ft-user')) $('ft-user').addEventListener('keydown', e=>{
    if(e.key === 'Enter'){ e.preventDefault(); askGo(); }
  });
  $('sync-name').addEventListener('input', ()=>{ SYNC.name = $('sync-name').value.slice(0,24); syncSave(); });
  $('sync-check').onclick = ()=>syncCheckOnline();
  $('sync-copy').onclick = ()=>{
    try{ navigator.clipboard.writeText(SYNC.myCode||''); toast('Code copied'); }
    catch(e){ toast(SYNC.myCode||''); }
  };
