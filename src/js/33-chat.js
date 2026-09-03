  /* ---------------- MESSAGES ----------------
     A chat for whoever is in the room. It rides the same peer connections as
     the timer and the games — one wire message, `say` — so there is nothing new
     to connect and nothing new to trust.

     Two decisions shape the rest of this file:

     **It is a sheet, not a screen.** Everything else in this app is a full-page
     overlay you leave to get anywhere. Chat can't be: half the point is saying
     "nice word" during a Scrabble turn or "back in five" mid-block. So it slides
     over whatever you were doing at a z-index above every overlay, and the
     button that opens it floats in the corner from any screen. You never lose
     your place to talk.

     **It is not adjudicated.** Games go through the host because game state can
     be wrong; a sentence can't. The host relays and everybody keeps their own
     copy, so a message shows the instant you send it rather than after a round
     trip.

     A message arriving announces itself with a pop-out — who and what, for a
     few seconds, tappable to open that thread — and leaves a plain dot on the
     button until you've looked. Not a count: a number on a 32px button in a
     header row reads as a defect at that size, and the pop-out already told you
     what you actually wanted to know.

     During a focus block none of it happens. No sound, no pop-out, no dot. The
     whole app exists to stop you being interrupted, and a number ticking up in
     the corner is an interruption that just takes longer to work.

     **Two kinds of thread, treated differently.** The room thread is everyone at
     once and is gone when the room is — it belongs to the room. A direct message
     is to one person, and those *are* kept, under `focus_dm`, keyed by that
     person's own friend code rather than their peer id: peer ids are per
     connection, so keying by them would lose the history every time somebody
     reconnected. Rooms are places; friends are people.

     **Messages wait.** You can write to a friend who isn't there. It goes into an
     outbox (`focus_dm_out`) and is delivered the first moment both apps are open
     — see `syncMailRun()` in 29-sync.js, which posts it into their presence
     beacon. Until then it shows with a clock beside it, and it is honest about
     what that means: there is no server here, so a message cannot arrive while
     the sender is closed. What it does buy is the ordinary case — you write at
     midnight, they read it in the morning while you happen to have the app up. */

  const CHAT_MAX = 200;              // lines kept per thread
  const CHAT_KEEP = 300;             // direct-message lines kept on disk, per person
  const CHAT_OUT_MAX = 60;           // messages queued for one person
  const CHAT_QUICK = ['👍', 'Nice one', 'Back in 5', 'Good luck', 'Well played'];

  const Chat = {
    log:[],                          // the room thread, this room only
    dm:{},                           // friend code -> [lines], saved
    out:{},                          // friend code -> [messages not yet delivered]
    unread:0, dmUnread:{},
    popT:null, popOutT:null,          // the pop-out's own timers
    open:false, built:false,
    thread:'room',                   // 'room', or a friend code

    async load(){
      try{
        const r = await KV.get('focus_dm');
        if(r && r.value) this.dm = JSON.parse(r.value) || {};
      }catch(e){ this.dm = {}; }
      try{
        const r = await KV.get('focus_dm_out');
        if(r && r.value) this.out = JSON.parse(r.value) || {};
      }catch(e){ this.out = {}; }
      this.render();
    },
    save(){
      try{ KV.set('focus_dm', JSON.stringify(this.dm)); }catch(e){}
    },
    saveOut(){
      try{ KV.set('focus_dm_out', JSON.stringify(this.out)); }catch(e){}
    },

    /* ---- the outbox ----
       Everything still waiting to be handed over, oldest first. `syncMailRun()`
       asks for this, posts it, and calls `mailSent()` with the ids that landed. */
    pending(code){ return this.out[code] || []; },
    pendingTotal(){
      let n = 0;
      for(const k in this.out) n += this.out[k].length;
      return n;
    },
    queue(code, msg){
      if(!this.out[code]) this.out[code] = [];
      this.out[code].push(msg);
      if(this.out[code].length > CHAT_OUT_MAX) this.out[code].shift();
      this.saveOut();
    },
    /** Called once a batch has actually reached the other device. */
    delivered(code, ids){
      if(!this.out[code]) return;
      const set = {};
      for(const id of ids || []) set[id] = 1;
      this.out[code] = this.out[code].filter(m=>!set[m.id]);
      if(!this.out[code].length) delete this.out[code];
      this.saveOut();
      // the clock beside those lines can come off now
      const lines = this.dm[code] || [];
      let touched = false;
      for(const l of lines) if(set[l.id] && l.waiting){ delete l.waiting; touched = true; }
      if(touched) this.save();
      this.render();
    },
    /** Everything that arrived while we were closed, or from a friend's outbox. */
    receiveMail(items){
      let got = 0, last = null;
      const got0 = [];
      for(const m of items || []){
        if(!m || typeof m.text !== 'string') continue;
        const code = syncNormalise(m.fromCode || '');
        if(!code) continue;
        /* Friend requests arrive by post like everything else. Taken out here,
           and still acknowledged to the server — the id has to go back in the
           `taken` list or the mailbox hands it over again for ever. */
        try{ if(friendTake({text:m.text, fromCode:code})){ got0.push(m.id); continue; } }catch(e){}
        const into = this.dm[code] || [];
        if(into.some(x=>x.id === m.id)) continue;
        this._add(code, m, false);
        this.dmUnread[code] = (this.dmUnread[code] || 0) + 1;
        last = {code, name:m.name, text:m.text};
        got++;
      }
      if(!got) return got0.length ? got0.length : 0;
      if(got){
        if(!chatQuietHours()){
          blip(); buzz(14);
          // one pop-out for the batch; a stack of them on opening the app would
          // be worse than the number ever was
          this._pop(last.code, {name:last.name, text:got > 1
            ? got + ' messages while you were away' : last.text});
        }
        this.render();
      }
      return got;
    },

    build(){
      if(this.built) return;
      // one handler per header instance; see the note in 27-chat.css
      this._buttons().forEach(b=>{ b.onclick = ()=>Chat.show(); });
      $('chat-close').onclick = ()=>Chat.hide();
      $('chat').addEventListener('click', e=>{ if(e.target === $('chat')) Chat.hide(); });
      $('chat-form').addEventListener('submit', e=>{ e.preventDefault(); Chat.send($('chat-input').value); });

      $('chat-tabs').onclick = e=>{
        const b = e.target.closest('[data-thread]');
        if(b) Chat.openThread(b.dataset.thread);
      };

      $('chat-pop').onclick = ()=>{
        const key = $('chat-pop').dataset.thread;
        this._popHide(true);
        if(key) this.thread = key;
        this.show();
      };

      $('chat-quick').innerHTML = CHAT_QUICK.map(q=>
        '<button type="button" class="chat-q" data-q="'+esc(q)+'">'+esc(q)+'</button>').join('');
      $('chat-quick').onclick = e=>{
        const b = e.target.closest('[data-q]');
        if(b) Chat.send(b.dataset.q);
      };
      this.built = true;
    },

    /* ---- threads ----
       'room' is everyone; anything else is a friend code. Keyed by code, not by
       peer id, so a thread survives the other person reconnecting under a new
       address — which they do every single time. */
    openThread(key){
      this.thread = key;
      if(key === 'room') this.unread = 0;
      else delete this.dmUnread[key];
      this.render();
      this._toBottom();
    },
    _lines(){
      return this.thread === 'room' ? this.log : (this.dm[this.thread] || []);
    },
    /** Everyone here we could message directly, i.e. everyone who has a code. */
    _people(){
      return syncPeople().filter(p=>!p.me && p.code);
    },
    _nameFor(code){
      const here = this._people().find(p=>p.code === code);
      if(here) return here.name;
      const friend = SYNC.friends.find(f=>f.code === code);
      return friend ? friend.name : code;
    },
    _idFor(code){
      const p = this._people().find(x=>x.code === code);
      return p ? p.id : null;
    },

    show(){
      this.build();
      this._popHide(true);
      this.open = true;
      if(this.thread === 'room') this.unread = 0;
      else delete this.dmUnread[this.thread];
      $('chat').classList.remove('hide');
      this.render();
      // focusing the field on a phone throws the keyboard up over the log, so
      // only do it where there's a real one
      if(window.matchMedia && window.matchMedia('(pointer:fine)').matches) $('chat-input').focus();
      this._toBottom();
    },
    hide(){
      this.open = false;
      $('chat').classList.add('hide');
      this.render();
    },
    toggle(){ this.open ? this.hide() : this.show(); },

    send(raw){
      const text = String(raw||'').trim().slice(0, 300);
      if(!text) return;
      const dm = this.thread !== 'room';
      if(!dm && !syncActive()) return;         // the room thread needs a room

      const msg = {
        t:'say',
        id:'m' + Date.now() + '_' + (Math.random()*1e4|0),
        name:SYNC.name || 'Someone',
        from:SYNC.selfId,
        fromCode:SYNC.myCode,
        to:dm ? this._idFor(this.thread) : null,
        text, at:Date.now(),
      };

      /* A direct message to somebody in the room goes straight over the wire.
         To somebody who isn't, it waits in the outbox — writing to a friend who
         happens to be asleep should not be a thing the app refuses to do. */
      const here = dm && !!msg.to && syncActive();
      if(dm && !here) msg.waiting = true;

      this._add(dm ? this.thread : 'room', msg, true);
      if(!dm || here) syncBroadcast(msg);
      else{
        this.queue(this.thread, {
          id:msg.id, name:msg.name, fromCode:msg.fromCode, text:msg.text, at:msg.at,
        });
        syncMailRun();                         // try now, in case they're around
      }

      $('chat-input').value = '';
      this.render();
      this._toBottom();
    },

    /* **The friend system's wire, not a message.** A request and its answer
       travel the same path a message does — straight over the peer if they are
       reachable, into the mailbox if they are not — because building a second
       delivery system for two small events would be building the same thing
       twice. Nothing here reaches the conversation: it is queued, sent, and
       lifted out on the far side by `friendTake`. See 29a-friends.js. */
    sendRaw(code, text){
      const to = syncNormalise(code);
      if(!to || typeof text !== 'string' || !text) return;
      const msg = {
        t:'say',
        id:'w' + Date.now() + '_' + (Math.random()*1e4|0),
        name:SYNC.name || 'Someone',
        from:SYNC.selfId,
        fromCode:SYNC.myCode,
        to:this._idFor(to),
        text, at:Date.now(),
      };
      if(msg.to && syncActive()){ syncBroadcast(msg); return; }
      this.queue(to, {id:msg.id, name:msg.name, fromCode:msg.fromCode, text:msg.text, at:msg.at});
      syncMailRun();
    },

    receive(m){
      if(!m || typeof m.text !== 'string') return;
      // machinery never becomes a line in a conversation
      try{ if(friendTake({text:m.text, fromCode:m.fromCode})) return; }catch(e){}
      const key = m.to ? syncNormalise(m.fromCode || '') : 'room';
      if(m.to && !key) return;      // a direct message with no return address
      const into = key === 'room' ? this.log : (this.dm[key] || []);
      if(into.some(x=>x.id === m.id)) return;    // relayed back to us

      this._add(key, m, false);
      if(!this.open || this.thread !== key){
        if(key === 'room') this.unread++;
        else this.dmUnread[key] = (this.dmUnread[key] || 0) + 1;
        /* Outside a focus block a message gets a small sound, because you want
           to know. Inside one it gets nothing at all — not a chime, not a buzz,
           and not even a count on the button. The whole app exists to stop you
           being interrupted, and a number ticking up in the corner is an
           interruption; it just takes longer to work. It's all still there when
           the block ends. */
        if(!chatQuietHours()){ blip(); buzz(14); this._pop(key, m); }
      }
      this.render();
      if(this.open && this.thread === key) this._toBottom();
    },

    /* ---- the pop-out ---- */
    _pop(key, m){
      const el = $('chat-pop');
      if(!el || this.open) return;              // no need to announce what's on screen
      $('chat-pop-who').textContent = key === 'room'
        ? (m.name || 'Someone') + ' · room'
        : (m.name || this._nameFor(key));
      $('chat-pop-text').textContent = String(m.text || '');
      el.dataset.thread = key;
      clearTimeout(this.popT); clearTimeout(this.popOutT);
      el.classList.remove('hide', 'out');
      void el.offsetWidth;                      // restart the slide-in
      this.popT = setTimeout(()=>this._popHide(), 4200);
    },
    _popHide(now){
      const el = $('chat-pop');
      if(!el) return;
      clearTimeout(this.popT); clearTimeout(this.popOutT);
      if(now){ el.classList.add('hide'); el.classList.remove('out'); return; }
      el.classList.add('out');
      this.popOutT = setTimeout(()=>{ el.classList.add('hide'); el.classList.remove('out'); }, 220);
    },

    _add(key, m, mine){
      const line = {
        id:m.id, name:m.name || 'Someone', text:String(m.text).slice(0, 300),
        at:m.at || Date.now(), mine:!!mine,
      };
      if(key === 'room'){
        this.log.push(line);
        if(this.log.length > CHAT_MAX) this.log.splice(0, this.log.length - CHAT_MAX);
        return;
      }
      if(m.waiting) line.waiting = true;
      if(!this.dm[key]) this.dm[key] = [];
      this.dm[key].push(line);
      if(this.dm[key].length > CHAT_KEEP) this.dm[key].splice(0, this.dm[key].length - CHAT_KEEP);
      this.save();
    },

    /** The room went away — and with it the room thread. Direct messages stay. */
    clear(){
      this.log = []; this.unread = 0;
      this.thread = 'room';
      this._popHide(true);
      if(this.open) this.hide();
      this.render();
    },

    _toBottom(){
      const box = $('chat-log');
      if(box) box.scrollTop = box.scrollHeight;
    },

    _totalUnread(){
      let n = this.unread;
      for(const k in this.dmUnread) n += this.dmUnread[k];
      return n;
    },

    _buttons(){
      return ['chat-btn','chat-btn-ov'].map(id=>$(id)).filter(Boolean);
    },
    _dots(){
      return ['chat-dot','chat-dot-ov'].map(id=>$(id)).filter(Boolean);
    },

    render(){
      const btns = this._buttons();
      if(!btns.length) return;
      const room = syncActive();
      const quiet = chatQuietHours();
      const total = quiet ? 0 : this._totalUnread();

      /* The button is always here. It used to appear only once you had somebody
         to write to, which read as the button randomly coming and going, and
         meant a new user never saw that the app had messages in it at all. An
         empty inbox is a normal thing for an app to show; a control that hides
         itself is not. */
      for(const b of btns){
        b.classList.remove('hide');
        b.classList.toggle('lit', total > 0);
        b.classList.toggle('quiet', quiet);
      }
      for(const d of this._dots()) d.classList.toggle('hide', !total);
      if(quiet) this._popHide(true);

      if(!this.open) return;

      const people = syncPeople();

      // Tabs: the room, then one per person here. A person you have history with
      // keeps their tab even after they leave, so you can read it back.
      /* Everyone you could write to: whoever is here, then every friend you've
         saved, then anyone you have history with. A thread you can only open
         while its owner is online is not much use for leaving a message. */
      const codes = this._people().map(p=>p.code);
      for(const f of (SYNC.friends || [])) if(codes.indexOf(f.code) < 0) codes.push(f.code);
      for(const c of Object.keys(this.dm)) if(codes.indexOf(c) < 0) codes.push(c);
      $('chat-tabs').innerHTML =
        ['room'].concat(codes).map(k=>{
          const n = k === 'room' ? this.unread : (this.dmUnread[k] || 0);
          const label = k === 'room' ? 'Room' : this._nameFor(k);
          const gone = k !== 'room' && !this._idFor(k);
          return '<button class="chat-tab'+(this.thread===k?' on':'')+(gone?' gone':'')
            + '" data-thread="'+esc(k)+'">'+esc(label)
            + (n ? '<i>'+(n>9?'9+':n)+'</i>' : '') + '</button>';
        }).join('');

      const dm = this.thread !== 'room';
      const waiting = dm ? this.pending(this.thread).length : 0;
      $('chat-who').textContent = dm
        ? (this._idFor(this.thread) ? 'Just you and ' + this._nameFor(this.thread)
           : waiting ? waiting + (waiting === 1 ? ' message' : ' messages')
                       + ' waiting to reach ' + this._nameFor(this.thread)
           : this._nameFor(this.thread) + ' isn’t here — they’ll get it when they’re back')
        : people.length > 1
          ? people.filter(p=>!p.me).map(p=>p.name).join(', ')
          : 'Nobody else is here yet';

      const lines = this._lines();
      const box = $('chat-log');
      if(!lines.length){
        const nobody = !room && !(SYNC.friends && SYNC.friends.length);
        /* One sentence each. These used to explain how offline delivery works,
           how to add a friend and what happens to a room thread — three
           paragraphs on an empty screen, which reads as an apology. */
        box.innerHTML = '<p class="chat-empty">' + (dm
          ? 'Nothing yet. Write anyway — it waits for them.'
          : nobody
            ? 'Nobody to write to yet. Add someone by username in <b>Focus together</b>.'
            : !room
              ? 'No room open. Pick a friend above.'
              : 'Nothing said yet.')
          + '</p>';
      }else{
        let last = '';
        box.innerHTML = lines.map(m=>{
          const time = new Date(m.at).toLocaleTimeString(undefined, {hour:'numeric', minute:'2-digit'});
          // Only name a line when the speaker changes; a wall of repeated names
          // is harder to read than the messages themselves.
          const head = (m.mine || m.name === last) ? ''
            : '<span class="chat-name">'+esc(m.name)+'</span>';
          last = m.name;
          return '<div class="chat-line'+(m.mine?' mine':'')+(m.waiting?' waiting':'')+'">'
            + head
            + '<span class="chat-bubble">'+esc(m.text)+'</span>'
            + '<span class="chat-time">'+esc(time)
            + (m.waiting ? ' · waiting to send' : '') + '</span></div>';
        }).join('');
      }

      // You can always write to a person; only the room thread needs a room.
      const canSend = this.thread === 'room' ? room : true;
      $('chat-input').disabled = !canSend;
      $('chat-send').disabled = !canSend;
      $('chat-input').placeholder = this.thread === 'room'
        ? (room ? 'Say something…' : 'No room open')
        : 'Message ' + this._nameFor(this.thread) + '…';
    },
  };

  /** True while a focus block is actually running: no sound, no count. */
  function chatQuietHours(){ return !!(S.running && S.mode === 'focus'); }

  /* Called from 29-sync.js on an incoming `say`. A function declaration, so the
     earlier file can reach it. */
  function chatReceive(m){ Chat.receive(m); }
  function chatPending(code){ return Chat.pending(code); }
  function chatPendingCodes(){ return Object.keys(Chat.out); }
  function chatDelivered(code, ids){ Chat.delivered(code, ids); }
  function chatReceiveMail(items){ return Chat.receiveMail(items); }
  function chatSendRaw(code, text){ return Chat.sendRaw(code, text); }
  /** Open the sheet on one person's thread — what a profile's Message goes to. */
  function chatOpenWith(code){
    const c = syncNormalise(code);
    if(!c) return;
    Chat.build();
    Chat.thread = c;
    Chat.show();
  }
  function chatRoomChanged(){ Chat.build(); Chat.render(); }
  function chatRoomClosed(){ Chat.clear(); }

  document.addEventListener('keydown', e=>{
    if(e.key === 'Escape' && Chat.open){ Chat.hide(); return; }
    // A shortcut worth having on a desktop, where the button is a long way from
    // the keyboard. Not while you're typing into something else.
    if(e.key !== 'm' || e.metaKey || e.ctrlKey || e.altKey) return;
    const el = document.activeElement;
    if(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
    if(!syncActive()) return;
    e.preventDefault();
    Chat.toggle();
  });

  Chat.build();
  Chat.load();
  Chat.render();

