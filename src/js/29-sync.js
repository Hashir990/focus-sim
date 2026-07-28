  /* ---------------- FOCUS TOGETHER ----------------
     Peer-to-peer sync over WebRTC, using PeerJS's public signalling server. No
     account, no backend of ours, no data stored anywhere but on the devices.

     Shape: a star, not a mesh. Whoever creates the room is the host, and the host
     is the leader — their timer drives everyone's. Followers send nothing but a
     greeting; they never broadcast, which is what stops two clocks fighting.

     PeerJS is fetched from a CDN the first time you open this screen, not at
     startup. Everything else in the app works offline; this obviously can't, so
     there's no reason to make every launch pay for it.

     Codes are 6 characters from an alphabet with no confusable pairs (no O/0,
     no I/1). Your own code is saved and reusable — that's a "friend". A room code
     is generated fresh and thrown away — that's a "room". Same mechanism, and the
     only difference is whether we keep it. */

  var SYNC_CDN = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  var SYNC_NS = 'fsim-';                     // namespace on the shared PeerJS server
  var SYNC_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  var SYNC_BEAT = 2000;                      // ms between leader heartbeats

  var SYNC = {
    lib:null, peer:null, code:null, mode:'off',   // 'off' | 'hosting' | 'joined'
    conns:{}, roster:{}, name:'', myCode:null, friends:[],
    leader:null, beat:null, lastApplied:0, status:'',
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
  function syncIsLeader(){ return SYNC.mode === 'hosting'; }
  function syncActive(){ return SYNC.mode !== 'off'; }

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
     Deliberately small. Everything is a plain object with a `t` tag. */

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
  function syncBroadcast(msg){
    for(const id in SYNC.conns) syncSend(SYNC.conns[id], msg);
  }

  /** Called by the timer engine whenever anything changes. No-op unless leading. */
  function syncBroadcastState(){
    if(!syncIsLeader()) return;
    syncBroadcast(syncStateMsg());
  }

  function syncRosterMsg(){
    const list = [{code:SYNC.code, name:SYNC.name, leader:true}];
    for(const id in SYNC.roster) list.push({code:id, name:SYNC.roster[id], leader:false});
    return {t:'roster', list};
  }

  function syncWire(conn, isIncoming){
    conn.on('open', ()=>{
      SYNC.conns[conn.peer] = conn;
      syncSend(conn, {t:'hello', name:SYNC.name, code:SYNC.code});
      if(syncIsLeader()){
        syncSend(conn, syncStateMsg());
        syncBroadcast(syncRosterMsg());
      }
      syncSetStatus(isIncoming ? 'Someone joined' : 'Connected');
    });
    conn.on('data', (m)=>{
      if(!m || typeof m !== 'object') return;
      if(m.t === 'hello'){
        SYNC.roster[conn.peer] = m.name || 'Someone';
        if(syncIsLeader()) syncBroadcast(syncRosterMsg());
        syncRender();
      }
      else if(m.t === 'state') syncApplyState(m);
      else if(m.t === 'roster'){ SYNC.remoteList = m.list || []; syncRender(); }
      else if(m.t === 'bye'){ try{ conn.close(); }catch(e){} }
    });
    conn.on('close', ()=>{
      delete SYNC.conns[conn.peer];
      delete SYNC.roster[conn.peer];
      if(syncIsLeader()) syncBroadcast(syncRosterMsg());
      else if(SYNC.mode === 'joined'){ syncSetStatus('Host disconnected'); syncLeave(true); }
      syncRender();
    });
    conn.on('error', ()=>{});
  }

  async function syncOpenPeer(id){
    const Peer = await syncLoadLib();
    return new Promise((resolve, reject)=>{
      const peer = new Peer(id, {debug:0});
      let settled = false;
      peer.on('open', (realId)=>{ settled = true; resolve({peer, id:realId}); });
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
      const {peer} = await syncOpenPeer(SYNC_NS + code.toLowerCase());
      SYNC.peer = peer; SYNC.code = code; SYNC.mode = 'hosting';
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
      SYNC.peer = peer; SYNC.mode = 'joined'; SYNC.code = code;
      const conn = peer.connect(SYNC_NS + code.toLowerCase(), {reliable:true});
      syncWire(conn, false);
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
    if(syncIsLeader()){
      const list = [{code:SYNC.code, name:SYNC.name||'You', leader:true, me:true}];
      for(const id in SYNC.roster) list.push({code:id, name:SYNC.roster[id], leader:false});
      return list;
    }
    if(SYNC.remoteList){
      return SYNC.remoteList.map(p=>({
        code:p.code, name:p.name || (p.leader?'Host':'Someone'),
        leader:!!p.leader, me:false
      }));
    }
    return [];
  }

  function syncRender(){
    const box = $('sync-body');
    if(!box) return;

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

    // who's here
    const people = syncPeople();
    const pbox = $('sync-people');
    if(pbox){
      pbox.classList.toggle('hide', !syncActive());
      pbox.innerHTML = people.length
        ? '<p class="q-sec">In this room</p>' + people.map(p=>
            '<div class="sync-person'+(p.leader?' lead':'')+'">'
            + '<span>'+esc(p.name || 'Someone')+'</span>'
            + (p.leader ? '<em>leads the timer</em>' : '<em>following</em>')
            + '</div>').join('')
        : '<p class="cal-empty">Nobody else yet. Share your code.</p>';
    }

    // friends
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

    // the follower banner on the timer screen
    const band = $('sync-band');
    if(band){
      const leading = syncIsLeader();
      const show = syncActive() && Object.keys(SYNC.conns).length > 0;
      band.classList.toggle('hide', !show);
      if(show){
        const host = people.find(p=>p.leader);
        band.textContent = leading
          ? 'You lead · '+people.length+' here'
          : 'Following '+esc((host && host.name) || 'the host');
      }
    }
    // followers don't drive the clock
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
