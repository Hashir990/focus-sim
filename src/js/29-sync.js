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
  var SYNC_NS = 'fsim-';                     // namespace on the shared PeerJS server
  var SYNC_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  var SYNC_BEAT = 2000;                      // ms between leader heartbeats

  var SYNC = {
    lib:null, peer:null, code:null, mode:'off',   // 'off' | 'hosting' | 'joined'
    selfId:null, leaderId:null,
    conns:{}, roster:{}, remoteList:null,
    name:'', myCode:null, friends:[],
    beat:null, lastApplied:0, status:'',
  };

  function syncCode(n){
    let s = '';
    for(let i=0;i<(n||6);i++) s += SYNC_ALPHABET[Math.random()*SYNC_ALPHABET.length|0];
    return s;
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

       hello      {name}                greeting, both directions
       roster     {leaderId, list}      host -> everyone, who is here and who leads
       state      {timer fields}        leader -> everyone (relayed by the host)
       setleader  {id}                  leader -> host, hand the timer over
       kick       {id}                  leader -> host, remove someone
       kicked     {}                    host -> the removed person
       bye        {}                    polite disconnect
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
    S.focusMin = m.focusMin; S.breakMin = m.breakMin;
    S.repeat = m.repeat; S.runCount = m.runCount;
    S.cycle = m.cycle; S.restIsLong = m.restIsLong;
    S.mode = m.mode; S.total = m.total;
    S.remaining = m.remaining;

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
  function syncBroadcast(msg, exceptId){
    for(const id in SYNC.conns) if(id !== exceptId) syncSend(SYNC.conns[id], msg);
  }

  /** Called by the timer engine on every change. No-op unless we hold the timer. */
  function syncBroadcastState(){
    if(!syncIsLeader()) return;
    syncBroadcast(syncStateMsg());
  }

  function syncRosterMsg(){
    const list = [{id:SYNC.selfId, name:SYNC.name || 'Host'}];
    for(const id in SYNC.roster) list.push({id, name:SYNC.roster[id]});
    return {t:'roster', leaderId:SYNC.leaderId, list};
  }

  /** Host only: change who holds the timer and tell everyone. */
  function syncSetLeader(id){
    if(!syncIsHost()) return;
    if(id !== SYNC.selfId && !SYNC.conns[id]) return;
    SYNC.leaderId = id;
    syncBroadcast(syncRosterMsg());
    if(syncIsLeader()) syncBroadcastState();     // took it back: re-assert at once
    syncSetStatus(id === SYNC.selfId ? 'You hold the timer' : 'Timer handed over');
  }

  /** Host only: drop someone from the room. */
  function syncRemove(id){
    if(!syncIsHost() || !SYNC.conns[id]) return;
    syncSend(SYNC.conns[id], {t:'kicked'});
    const conn = SYNC.conns[id];
    const wasLeader = SYNC.leaderId === id;
    setTimeout(()=>{ try{ conn.close(); }catch(e){} }, 60);
    delete SYNC.conns[id]; delete SYNC.roster[id];
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
    conn.on('open', ()=>{
      SYNC.conns[conn.peer] = conn;
      syncSend(conn, {t:'hello', name:SYNC.name});
      if(syncIsHost()){
        syncSend(conn, syncRosterMsg());
        if(syncIsLeader()) syncSend(conn, syncStateMsg());
      }
      syncSetStatus(isIncoming ? 'Someone joined' : 'Connected');
    });

    conn.on('data', (m)=>{
      if(!m || typeof m !== 'object') return;

      if(m.t === 'hello'){
        SYNC.roster[conn.peer] = m.name || 'Someone';
        if(syncIsHost()) syncBroadcast(syncRosterMsg());
        syncRender();
      }

      else if(m.t === 'roster'){
        SYNC.remoteList = m.list || [];
        SYNC.leaderId = m.leaderId || null;
        if(syncIsLeader()) syncBroadcastState();   // just been handed the timer
        syncRender();
      }

      else if(m.t === 'state'){
        // The host is the referee: only the current leader's state is honoured,
        // and the host is what carries it to everyone else.
        if(syncIsHost()){
          if(conn.peer !== SYNC.leaderId) return;
          syncBroadcast(m, conn.peer);
        }
        syncApplyState(m);
      }

      else if(m.t === 'setleader'){
        if(syncIsHost() && conn.peer === SYNC.leaderId) syncSetLeader(m.id);
      }
      else if(m.t === 'kick'){
        if(syncIsHost() && conn.peer === SYNC.leaderId) syncRemove(m.id);
      }
      else if(m.t === 'kicked'){
        syncLeave(true);
        syncSetStatus('You were removed from the room');
      }
      else if(m.t === 'bye'){ try{ conn.close(); }catch(e){} }
    });

    conn.on('close', ()=>{
      delete SYNC.conns[conn.peer];
      delete SYNC.roster[conn.peer];
      if(syncIsHost()){
        // if the person holding the timer drops, the host takes it back
        if(SYNC.leaderId === conn.peer){ SYNC.leaderId = SYNC.selfId; syncBroadcastState(); }
        syncBroadcast(syncRosterMsg());
      }else if(SYNC.mode === 'joined'){
        syncSetStatus('Host disconnected');
        syncLeave(true);
      }
      syncRender();
    });
    conn.on('error', ()=>{});
  }

  async function syncOpenPeer(id){
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

  /** Start hosting. `useMine` reuses your saved friend code; otherwise a fresh room. */
  async function syncHost(useMine){
    if(syncActive()) syncLeave(true);
    const code = useMine ? (SYNC.myCode || syncCode()) : syncCode();
    syncSetStatus('Opening…');
    try{
      const {peer, id} = await syncOpenPeer(SYNC_NS + code.toLowerCase());
      SYNC.peer = peer; SYNC.code = code; SYNC.mode = 'hosting';
      SYNC.selfId = id; SYNC.leaderId = id;
      if(useMine){ SYNC.myCode = code; syncSave(); }
      clearInterval(SYNC.beat);
      SYNC.beat = setInterval(syncBroadcastState, SYNC_BEAT);
      syncSetStatus('Waiting for others to join');
    }catch(err){
      syncSetStatus(err && err.type === 'unavailable-id'
        ? 'That code is already in use — try a new room'
        : 'Could not connect. Check your internet.');
      SYNC.mode = 'off';
    }
    syncRender();
  }

  /** Join someone else's code. */
  async function syncJoin(raw){
    const code = syncNormalise(raw);
    if(code.length < 4){ syncSetStatus('That code looks too short'); return; }
    if(syncActive()) syncLeave(true);
    syncSetStatus('Connecting to '+code+'…');
    try{
      const {peer} = await syncOpenPeer(undefined);
      SYNC.peer = peer; SYNC.mode = 'joined'; SYNC.code = code; SYNC.leaderId = null;
      const conn = peer.connect(SYNC_NS + code.toLowerCase(), {reliable:true});
      syncWire(conn, false);
      clearInterval(SYNC.beat);
      SYNC.beat = setInterval(syncBroadcastState, SYNC_BEAT);   // idle unless we lead
      setTimeout(()=>{
        if(SYNC.mode === 'joined' && !Object.keys(SYNC.conns).length){
          syncSetStatus('No answer — are they hosting right now?');
        }
      }, 8000);
    }catch(err){
      syncSetStatus('Could not connect. Check your internet.');
      SYNC.mode = 'off';
    }
    syncRender();
  }

  function syncLeave(quiet){
    clearInterval(SYNC.beat); SYNC.beat = null;
    syncBroadcast({t:'bye'});
    for(const id in SYNC.conns){ try{ SYNC.conns[id].close(); }catch(e){} }
    SYNC.conns = {}; SYNC.roster = {}; SYNC.remoteList = null;
    try{ if(SYNC.peer) SYNC.peer.destroy(); }catch(e){}
    SYNC.peer = null; SYNC.mode = 'off'; SYNC.code = null;
    SYNC.selfId = null; SYNC.leaderId = null;
    if(!quiet) syncSetStatus('Left');
    syncRender();
  }

  /* ---- friends ---- */
  function syncAddFriend(raw, name){
    const code = syncNormalise(raw);
    if(code.length < 4) return;
    if(SYNC.friends.some(f=>f.code === code)) return;
    SYNC.friends.push({code, name:(name||'').trim() || code});
    syncSave(); syncRender();
  }
  function syncRemoveFriend(code){
    SYNC.friends = SYNC.friends.filter(f=>f.code !== code);
    syncSave(); syncRender();
  }

  function syncSave(){
    try{
      KV.set('focus_sync', JSON.stringify({
        myCode:SYNC.myCode, name:SYNC.name, friends:SYNC.friends
      }));
    }catch(e){}
  }
  async function syncLoad(){
    try{
      const r = await KV.get('focus_sync');
      if(r && r.value){
        const d = JSON.parse(r.value);
        if(d && typeof d.myCode === 'string') SYNC.myCode = d.myCode;
        if(d && typeof d.name === 'string') SYNC.name = d.name;
        if(d && Array.isArray(d.friends)) SYNC.friends = d.friends;
      }
    }catch(e){}
    if(!SYNC.myCode){ SYNC.myCode = syncCode(); syncSave(); }
    syncRender();
  }

  /* ---- screen ---- */
  function syncPeople(){
    if(syncIsHost()){
      const list = [{id:SYNC.selfId, name:SYNC.name || 'You', me:true}];
      for(const id in SYNC.roster) list.push({id, name:SYNC.roster[id], me:false});
      return list.map(p=>Object.assign(p, {leader:p.id === SYNC.leaderId}));
    }
    if(SYNC.remoteList){
      return SYNC.remoteList.map(p=>({
        id:p.id, name:p.name || 'Someone',
        leader:p.id === SYNC.leaderId, me:p.id === SYNC.selfId,
      }));
    }
    return [];
  }

  function syncRender(){
    if(!$('sync-body')) return;

    const codeEl = $('sync-mycode');
    if(codeEl) codeEl.textContent = SYNC.myCode || '——————';

    const nameEl = $('sync-name');
    if(nameEl && document.activeElement !== nameEl) nameEl.value = SYNC.name;

    const st = $('sync-state');
    if(st){
      st.textContent = SYNC.mode === 'hosting'
        ? 'Hosting '+(SYNC.code||'')
        : SYNC.mode === 'joined' ? 'Joined '+(SYNC.code||'') : 'Not connected';
      st.className = 'sync-state' + (syncActive() ? ' on' : '');
    }

    $('sync-leave').classList.toggle('hide', !syncActive());
    $('sync-host').classList.toggle('hide', syncActive());
    $('sync-room').classList.toggle('hide', syncActive());

    const people = syncPeople();
    const canManage = syncIsLeader();
    const pbox = $('sync-people');
    if(pbox){
      pbox.classList.toggle('hide', !syncActive());
      pbox.innerHTML = people.length
        ? '<p class="q-sec">In this room</p>' + people.map(p=>{
            const tag = p.leader ? '<em>holds the timer</em>' : '<em>following</em>';
            // Only the timer holder gets the controls, and never against itself.
            const acts = (canManage && !p.me)
              ? '<button class="mini-btn" data-lead="'+esc(p.id)+'">Give timer</button>'
                + '<button class="sync-x" data-kick="'+esc(p.id)+'" aria-label="Remove">×</button>'
              : '';
            return '<div class="sync-person'+(p.leader?' lead':'')+'">'
              + '<span>'+esc(p.name)+(p.me?' <i>(you)</i>':'')+'</span>'
              + tag + acts + '</div>';
          }).join('')
        : '<p class="cal-empty">Nobody else yet. Share your code.</p>';
      pbox.querySelectorAll('[data-lead]').forEach(b=>{ b.onclick = ()=>syncHandOver(b.dataset.lead); });
      pbox.querySelectorAll('[data-kick]').forEach(b=>{ b.onclick = ()=>syncKick(b.dataset.kick); });
    }

    const fbox = $('sync-friends');
    if(fbox){
      fbox.innerHTML = SYNC.friends.length
        ? SYNC.friends.map(f=>
            '<div class="sync-friend"><b>'+esc(f.name)+'</b><code>'+esc(f.code)+'</code>'
            + '<button class="mini-btn" data-join="'+esc(f.code)+'">Join</button>'
            + '<button class="sync-x" data-drop="'+esc(f.code)+'" aria-label="Remove">×</button></div>').join('')
        : '<p class="cal-empty">No friends saved yet. Add someone’s code above.</p>';
      fbox.querySelectorAll('[data-join]').forEach(b=>{ b.onclick = ()=>syncJoin(b.dataset.join); });
      fbox.querySelectorAll('[data-drop]').forEach(b=>{ b.onclick = ()=>syncRemoveFriend(b.dataset.drop); });
    }

    const band = $('sync-band');
    if(band){
      const show = syncActive() && Object.keys(SYNC.conns).length > 0;
      band.classList.toggle('hide', !show);
      if(show){
        const host = people.find(p=>p.leader);
        band.textContent = syncIsLeader()
          ? 'You hold the timer · '+people.length+' here'
          : 'Following '+((host && host.name) || 'the host');
      }
    }

    // whoever isn't holding the timer doesn't drive it
    const lock = syncActive() && !syncIsLeader();
    ['toggle-run','skip','stop','begin'].forEach(id=>{
      const b = $(id); if(b) b.disabled = lock;
    });
  }

  function syncOpen(){ $('sync-overlay').classList.remove('hide'); syncRender(); }
  function syncClose(){ $('sync-overlay').classList.add('hide'); }

  $('d-sync').onclick = ()=>{ closeDrawer(); syncOpen(); };
  $('sync-close').onclick = syncClose;
  $('sync-host').onclick = ()=>syncHost(true);
  $('sync-room').onclick = ()=>syncHost(false);
  $('sync-leave').onclick = ()=>syncLeave();
  $('sync-join').onclick = ()=>syncJoin($('sync-code').value);
  $('sync-add').onclick = ()=>{ syncAddFriend($('sync-code').value, $('sync-friend-name').value); $('sync-code').value=''; $('sync-friend-name').value=''; };
  $('sync-name').addEventListener('input', ()=>{ SYNC.name = $('sync-name').value.slice(0,24); syncSave(); });
  $('sync-copy').onclick = ()=>{
    try{ navigator.clipboard.writeText(SYNC.myCode||''); toast('Code copied'); }
    catch(e){ toast(SYNC.myCode||''); }
  };
