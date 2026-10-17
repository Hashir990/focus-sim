  /* ---------------- BLOCKING SOMEBODY, AND REPORTING THEM ----------------

     Focus together is people: a room you can be invited into, a chat, a drawing
     board, a word game where somebody types what they want. Anything with that
     in it needs two things that have nothing to do with features, and this file
     is both of them.

     **A block is a door, not a filter.** It is not "hide their messages": a
     blocked person never gets into the room at all. Their code arrives in
     `hello`, which is the first moment anything about them is known and the
     last moment before the room learns they exist, and the connection is
     dropped there. Nothing is broadcast to them, nothing of theirs reaches the
     roster, and their friend requests are read and thrown away. There is no
     server in the middle to enforce it, so the enforcement has to be at the one
     point every stranger passes through, and that point is the greeting.

     **Dropped, never refused.** They are not told. A block that announces itself
     invites the next connection, and the whole value of this one is that it is
     boring: from the other side it looks exactly like somebody whose app is
     shut.

     **The code is the identity**, not the name. A name is typed and can be
     typed again; `syncCodeFor(username)` is derived from the account and is what
     everything else in the room already keys off. So the list is codes, and the
     name beside one in the interface is looked up from whatever card they last
     handed over. That also means blocking survives them renaming themselves.

     It travels with the account (`mergeSet`, exactly like the things you own),
     because a block that only holds on the phone you made it on is not much of
     a block. */

  const BLOCK_KEY = 'focus_blocked';
  let BLOCKED = [];

  function blockClean(v){
    const out = [];
    const seen = Object.create(null);
    for(const x of (Array.isArray(v) ? v : [])){
      if(typeof x !== 'string') continue;
      const c = syncNormalise(x);
      /* Same shape a friend code has to be, for the same reason: this list is
         compared against codes off the wire, and a line of rubbish in it would
         sit there forever matching nothing. */
      if(c.length < 4 || c.length > 8 || seen[c]) continue;
      seen[c] = 1; out.push(c);
    }
    return out.slice(0, 500);
  }

  async function blockLoad(){
    try{
      const r = await KV.get(BLOCK_KEY);
      if(r && r.value) BLOCKED = blockClean(JSON.parse(r.value));
    }catch(e){}
  }
  function blockSave(){
    try{ KV.set(BLOCK_KEY, JSON.stringify(BLOCKED)); }catch(e){}
    try{ Account.sync(true); }catch(e){}
  }
  function blockSnapshot(){ return BLOCKED.slice(); }
  /** Union, like everything else you cannot un-have. Two devices disagreeing
      about whether somebody is blocked land on blocked, which is the only safe
      direction for this one. */
  function blockAdopt(v){
    const inc = blockClean(v);
    if(!inc.length) return;
    const had = BLOCKED.length;
    for(const c of inc) if(BLOCKED.indexOf(c) < 0) BLOCKED.push(c);
    if(BLOCKED.length !== had){ blockSave(); try{ syncRender(); }catch(e){} }
  }
  function blockWipe(){ BLOCKED = []; try{ KV.del(BLOCK_KEY); }catch(e){} }

  /** Asked on every greeting and on every friend request, so it is kept cheap. */
  function blockHas(code){
    if(!code) return false;
    return BLOCKED.indexOf(syncNormalise(code)) >= 0;
  }
  function blockCount(){ return BLOCKED.length; }

  /** Whatever we can call them: their account name if they ever handed a card
      over, their friends-list name, and otherwise the code itself. */
  function blockName(code){
    const c = syncNormalise(code);
    try{
      const f = friendFind(c);
      if(f && (f.u || f.name)) return f.u || f.name;
    }catch(e){}
    try{
      const card = friendCardOf(c);
      if(card && card.u) return card.u;
    }catch(e){}
    return c;
  }

  /* Blocking somebody you are in a room with has to get them out of it as well
     as keep them out of the next one, or the block appears to do nothing until
     everybody leaves. If we are the host we remove them outright; if we are not,
     we close our own connection to them, which is the whole of our side of it. */
  function blockDrop(code){
    const c = syncNormalise(code);
    try{
      for(const id in SYNC.conns){
        if(syncNormalise(SYNC.codes[id] || '') !== c) continue;
        if(syncIsHost()) syncKick(id);
        else try{ SYNC.conns[id].close(); }catch(e){}
      }
    }catch(e){}
  }

  function blockAdd(code){
    const c = syncNormalise(code);
    if(!c || BLOCKED.indexOf(c) >= 0) return;
    BLOCKED.push(c);
    blockSave();
    blockDrop(c);
    try{ syncRender(); }catch(e){}
  }
  function blockRemove(code){
    const c = syncNormalise(code);
    const at = BLOCKED.indexOf(c);
    if(at < 0) return;
    BLOCKED.splice(at, 1);
    blockSave();
    try{ syncRender(); }catch(e){}
  }

  /** The question, then the block. Asked because it ends a conversation, and
      the one thing somebody should not do by accident is this. */
  function blockAsk(code, then){
    const c = syncNormalise(code);
    if(!c) return;
    if(blockHas(c)){
      blockRemove(c);
      toast(T('{name} is unblocked', {name:blockName(c)}));
      if(then) then();
      return;
    }
    askConfirm(T('Block {name}?', {name:blockName(c)}),
      T('They cannot join your room, message you, or ask to be friends. They are not told.'),
      T('Block'), ()=>{
        blockAdd(c);
        toast(T('{name} is blocked', {name:blockName(c)}));
        if(then) then();
      });
  }

  /* **Reporting is a letter, because there is nobody else to send it to.**
     Nothing in this app passes through a server that could receive a report:
     rooms are direct connections between two devices and the account holds a
     snapshot, not a conversation. So a report goes to whoever runs the build,
     by the same route as a bug report, and it carries the one thing that
     identifies a person across names, which is their code. What they said is
     not attached: it is on this device and not ours to send without being
     asked, and the person writing the report can paste whatever matters. */
  function blockReport(code){
    const c = syncNormalise(code);
    if(!c) return;
    const subject = 'focUS simulator: report a person';
    const body = 'Who: ' + blockName(c) + '\nCode: ' + c
      + '\nWhen: ' + new Date().toISOString()
      + '\n\nWhat happened:\n\n\n'
      + '(Paste anything they sent that you want looked at.)\n';
    const url = 'mailto:' + REPORT_TO
      + '?subject=' + encodeURIComponent(subject)
      + '&body=' + encodeURIComponent(body);
    let opened = false;
    try{ location.href = url; opened = true; }catch(e){ opened = false; }
    try{
      navigator.clipboard.writeText(REPORT_TO + '\n\n' + subject + '\n\n' + body);
      toast(opened ? T('Opening your mail. Copied it as well') : T('Copied. Paste it into an email'));
    }catch(e){
      toast(opened ? T('Opening your mail') : T('Could not open mail, write to {addr}', {addr:REPORT_TO}));
    }
    return url;
  }

  /** The two buttons, wherever somebody's profile is open. */
  function blockActs(code){
    const c = syncNormalise(code);
    if(!c) return '';
    return '<button class="mini-btn" data-report="' + esc(c) + '">' + esc(T('Report')) + '</button>'
      + '<button class="mini-btn danger" data-block="' + esc(c) + '">'
      + esc(blockHas(c) ? T('Unblock') : T('Block')) + '</button>';
  }
  function blockWire(root, then){
    if(!root) return;
    root.querySelectorAll('[data-block]').forEach(b=>{
      b.onclick = ()=>blockAsk(b.dataset.block, then);
    });
    root.querySelectorAll('[data-report]').forEach(b=>{
      b.onclick = ()=>blockReport(b.dataset.report);
    });
  }

  /** The list, under the friends, so somebody blocked can be found again.
      Absent when it is empty, which is nearly always. */
  function blockListHtml(){
    if(!BLOCKED.length) return '';
    return '<p class="q-sec">' + esc(Tn('{n} person blocked', '{n} people blocked', BLOCKED.length)) + '</p>'
      + BLOCKED.map(c=>'<div class="sync-friend blocked">'
          + '<b translate="no">' + esc(blockName(c)) + '</b>'
          + '<button class="mini-btn" data-unblock="' + esc(c) + '">' + esc(T('Unblock')) + '</button>'
          + '</div>').join('');
  }
  function blockListWire(root){
    if(!root) return;
    root.querySelectorAll('[data-unblock]').forEach(b=>{
      b.onclick = ()=>{ blockRemove(b.dataset.unblock); try{ syncRender(); }catch(e){} };
    });
  }
