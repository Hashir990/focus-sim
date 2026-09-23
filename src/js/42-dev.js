  /* ---------------- THE DEVELOPER HOOK ----------------
     One function, and it only exists in the developer build.

     Everything in this app lives inside a single closure, which is deliberate:
     nothing on the page can reach into the timer or the games, so nothing on the
     page can put them into a state they could not reach by being played. That is
     also what makes the dev bar in `dist/dev-unlocked.html` awkward — it is a
     script on the page, so it can click buttons and read the DOM and that is
     all. Filling a sudoku by clicking eighty-one squares is not a debugging
     tool, it is a second implementation of sudoku.

     So the closure offers one door, and only when the page says it is the
     developer copy. `tools/dev-build.mjs` sets `data-dev="1"` on <html>; the
     shipped `index.html` never has it, so `window.devFill` is not defined there
     and there is nothing to find.

     What it does is finish whichever board is open — the point being to reach
     the end of a game without playing it, so the win banner, the achievement it
     pays and the progress line on the card can all be looked at in the ten
     seconds after changing them, rather than the forty minutes.

     The shared games are not here. Their state belongs to whoever is hosting
     and arrives over the wire; a local override would be a lie the host would
     immediately correct. */

  function devFill(){
    if(!Arcade.open) return 'No game is open.';
    const which = Arcade.active;

    if(which === 'sudoku'){
      Sudoku.grid = Sudoku.sol.slice();
      Sudoku.notes = Sudoku.notes.map(()=>[]);
      Sudoku.render();
      Sudoku.checkDone();
      return 'Sudoku solved.';
    }

    if(which === 'crossword'){
      /* Straight from the grid's own answers, then the ordinary completion
         path — so it counts, banners, and saves exactly as a solved one does. */
      for(let i = 0; i < Cross.user.length; i++){
        const sol = Cross._solAt(i);
        if(sol) Cross.user[i] = sol;
      }
      Cross.render();
      Cross.checkDone();
      return 'Crossword filled in.';
    }

    if(which === 'wordle'){
      Wordle.cur = Wordle.answer;
      Wordle.submit();
      return 'Word guessed: ' + Wordle.answer.toUpperCase();
    }

    if(which === 'memory'){
      Memory.matched = Memory.matched.map(()=>true);
      Memory.flipped = [];
      Memory.done = true;
      Memory.stop();
      Memory.persist();
      Memory.render();
      try{ showBanner('mem-banner', 'All matched.', Memory._summary()); }catch(e){}
      return 'Memory cleared.';
    }

    if(which === 'g2048'){
      /* A board one move from 2048, rather than a board *with* 2048 on it: the
         tile has to be made by a merge for the mark to fire, and watching it
         merge is usually the thing being checked anyway. */
      G2048.board = [1024, 1024, 512, 256,
                     256, 128, 64, 32,
                     32, 16, 8, 4,
                     4, 2, 0, 0];
      G2048.score = Math.max(G2048.score, 9000);
      G2048._tilesFromBoard();
      G2048.persist();
      G2048.render();
      return 'Board set — one move left will make 2048.';
    }

    return 'Nothing to fill in ' + which + ' on your own; it needs a room.';
  }

  /* ---------------- THE DEVELOPER PAGE ----------------

     `devFill` above is one function reachable from the console. This is the
     rest of it, as a page in the app, because the console is not where any of
     this is wanted: half of it is needed on the phone, where there is no
     console at all, and the other half is wanted mid-session without reaching
     for a keyboard.

     **Only on a build stamped by this machine.** `data-dev="1"` comes from
     `.env.local`, which is in .gitignore and travels nowhere, and
     tools/ship-release.ps1 sets FOCUS_RELEASE=1 so nothing published can carry
     it. Without the stamp the row is hidden, the page is never wired, and
     `window.devFill` does not exist. */

  /* ---- who is allowed in ----

     The stamp says the build was made on the developer's machine. It does not
     say *who is holding it*: a phone handed to somebody, a debug APK passed on,
     a copied folder all carry it. So the stamp is only the first of three
     things, and none of them is in the repository:

       data-dev      the build came from a machine with .env.local
       data-dev-key  the hash of a key only that machine knows; typed once per
                     device, then remembered on that device alone
       data-dev-who  optional, and the strongest: the hash of the account name
                     this build belongs to. Signed out, or signed in as anybody
                     else, and there is no developer page.

     All of it is a lock on a door, not a vault: anyone who can edit the HTML
     they are running can let themselves in, and no client-side check can
     prevent that. What it does guarantee is that nothing published carries the
     page at all, and that a build of mine in someone else's hands does not
     open it. */
  const DEV_UNLOCK = 'focus_dev_unlock';       // this device only; never synced

  function devStamp(name){
    try{ return document.documentElement.getAttribute(name) || ''; }
    catch(e){ return ''; }
  }
  /** A stamped build with a key to check against. Without one there is no door. */
  function devOn(){
    return devStamp('data-dev') === '1' && !!devStamp('data-dev-key');
  }
  /** And, when a build names its owner, the account signed in has to be theirs. */
  function devWhoOk(){
    const who = devStamp('data-dev-who');
    if(!who) return true;
    try{
      if(!Account.token || !Account.username) return false;
      return devHash(String(Account.username).trim().toLowerCase()) === who;
    }catch(e){ return false; }
  }
  function devUnlocked(){
    if(!devOn() || !devWhoOk()) return false;
    try{ return localStorage.getItem(DEV_UNLOCK) === devStamp('data-dev-key'); }
    catch(e){ return false; }
  }
  /** Try a typed key. Right one: remembered on this device, and the page opens.
      The account is checked here too and not only at paint time — otherwise the
      key alone would hand out `window.devFill` on a build that belongs to
      somebody else's account. */
  function devTry(text){
    const want = devStamp('data-dev-key');
    if(!want || !devWhoOk()) return false;
    if(devHash(String(text || '').trim()) !== want) return false;
    try{ localStorage.setItem(DEV_UNLOCK, want); }catch(e){}
    try{ window.devFill = devFill; }catch(e){}
    return true;
  }
  function devLock(){
    try{ localStorage.removeItem(DEV_UNLOCK); }catch(e){}
    try{ delete window.devFill; }catch(e){}
  }

  /* SHA-256, written out rather than asked of `crypto.subtle`, which is
     undefined on Electron's file:// pages because they are not a secure
     context. tools/build.mjs hashes with node's own crypto, and the two have to
     agree — there is a check in the suite that they do. */
  function devHash(text){
    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
               0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    let b;
    try{ b = Array.from(new TextEncoder().encode(String(text))); }
    catch(e){
      b = [];
      const s = String(text);
      for(let i = 0; i < s.length; i++) b.push(s.charCodeAt(i) & 255);
    }
    const bits = b.length * 8;
    b.push(0x80);
    while(b.length % 64 !== 56) b.push(0);
    for(let i = 7; i >= 0; i--) b.push(Math.floor(bits / Math.pow(2, i * 8)) & 255);
    const w = new Array(64);
    const rr = (x, n)=> ((x >>> n) | (x << (32 - n))) >>> 0;
    for(let p = 0; p < b.length; p += 64){
      for(let i = 0; i < 16; i++){
        w[i] = ((b[p + i * 4] << 24) | (b[p + i * 4 + 1] << 16)
              | (b[p + i * 4 + 2] << 8) | b[p + i * 4 + 3]) >>> 0;
      }
      for(let i = 16; i < 64; i++){
        const s0 = (rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
        const s1 = (rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for(let i = 0; i < 64; i++){
        const S1 = (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) >>> 0;
        const ch = ((e & f) ^ (~e & g)) >>> 0;
        const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        const S0 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) >>> 0;
        const mj = ((a & bb) ^ (a & c) ^ (bb & c)) >>> 0;
        const t2 = (S0 + mj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + bb) >>> 0; H[2] = (H[2] + c) >>> 0;
      H[3] = (H[3] + d) >>> 0; H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map(x=>('0000000' + x.toString(16)).slice(-8)).join('');
  }

  function devOpen(){
    const el = $('dev-overlay');
    if(!el) return;
    el.classList.remove('hide');
    devPaint();
  }
  function devClose(){
    const el = $('dev-overlay');
    if(el) el.classList.add('hide');
  }

  /** Where this build came from and what it is running on. */
  function devFacts(){
    const rows = [];
    rows.push(['Version', 'v__VERSION__']);
    rows.push(['Build', '__BUILD__']);
    let where = 'browser';
    try{ if(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) where = 'Android'; }catch(e){}
    try{ if(navigator.userAgent.indexOf('Electron') >= 0) where = 'Electron'; }catch(e){}
    rows.push(['Running on', where]);
    rows.push(['Blocking plugin', guardHasPlugin() ? 'yes' : 'no']);
    let kb = 0;
    try{
      for(let i = 0; i < localStorage.length; i++){
        const k = localStorage.key(i);
        kb += (k.length + String(localStorage.getItem(k) || '').length);
      }
      rows.push(['Local storage', Math.round(kb / 1024) + ' KB in ' + localStorage.length + ' keys']);
    }catch(e){}
    return '<div class="dev-facts">' + rows.map(r=>
      '<b>' + esc(r[0]) + '</b><span>' + esc(String(r[1])) + '</span>').join('') + '</div>';
  }

  /* Locked: the page is a key field and nothing else — no facts about the
     build, no tools, and `window.devFill` still undefined. The reason is said
     plainly, because the commonest way to see this is signing out. */
  function devAsk(box){
    const who = devStamp('data-dev-who');
    const wrong = who && !devWhoOk();
    box.innerHTML = '<p class="q-sec">Locked</p>'
      + (wrong
        ? '<p class="dev-note">This build belongs to one account. Sign in as that'
          + ' account and come back.</p>'
        : '<form class="dev-key" id="dev-keyform">'
          + '<input id="dev-key" type="password" autocomplete="off" spellcheck="false"'
          + ' placeholder="Developer key" aria-label="Developer key" />'
          + '<button class="dev-btn" type="submit">Unlock</button>'
          + '</form>'
          + '<p class="dev-note" id="dev-keymsg">Asked once on each device. The key is in'
          + ' <code>.env.local</code> on the machine that built this; the build carries'
          + ' only a hash of it.</p>');
    const form = box.querySelector('#dev-keyform');
    if(form) form.onsubmit = (e)=>{
      e.preventDefault();
      const field = box.querySelector('#dev-key');
      if(devTry(field && field.value)){ devPaint(); return; }
      const msg = box.querySelector('#dev-keymsg');
      if(msg) msg.textContent = 'Not that.';
      if(field){ field.value = ''; field.focus(); }
    };
  }

  function devPaint(){
    const box = $('dev-body');
    if(!box) return;
    if(!devUnlocked()){ devAsk(box); return; }
    const shift = dailyShift();
    box.innerHTML = devFacts()
      + '<p class="dev-note">None of this is in a build anybody else gets. It is stamped'
      + ' in from <code>.env.local</code> and forced off for releases.</p>'

      + '<p class="q-sec">The day</p>'
      + '<div class="dev-day' + (shift ? ' off' : '') + '">'
      + '<span><b>' + esc(pktNow()) + '</b><small>'
      + (shift ? (shift > 0 ? shift + ' day' + (shift === 1 ? '' : 's') + ' ahead' : (-shift) + ' day' + (shift === -1 ? '' : 's') + ' back')
               : 'the real one') + '</small></span>'
      + '<span class="blk-pm">'
      + '<button data-day="-1" aria-label="A day back">&minus;</button>'
      + '<b>' + (shift > 0 ? '+' : '') + shift + '</b>'
      + '<button data-day="1" aria-label="A day on">+</button>'
      + '</span></div>'
      + '<div class="dev-row">'
      + '<button class="dev-btn" data-day="0">Back to today</button>'
      + '</div>'
      + '<p class="dev-note">Moves what the whole app calls today, so a daily puzzle,'
      + ' its calendar and its streak all move together. It is not written down:'
      + ' reopening the app puts it back.</p>'

      + '<p class="q-sec">The open game</p>'
      + '<div class="dev-row"><button class="dev-btn" id="dev-fill">Finish it</button></div>'

      + '<p class="q-sec">The block</p>'
      + '<div class="dev-row">'
      + '<button class="dev-btn" id="dev-end">End it now</button>'
      + '</div>'

      + '<p class="q-sec">The shelf</p>'
      + '<div class="dev-row">'
      + '<button class="dev-btn" data-embers="100">+100 embers</button>'
      + '<button class="dev-btn" data-embers="1000">+1000</button>'
      + '</div>'
      + '<div class="dev-row">'
      + '<button class="dev-btn" id="dev-own">Own everything</button>'
      + '<button class="dev-btn warn" id="dev-disown">Own nothing</button>'
      + '</div>'
      + '<div class="dev-row">'
      + '<button class="dev-btn" id="dev-settle">Put the balance right</button>'
      + '</div>'
      + '<p class="dev-note">The balance is worked out from focus time and what has'
      + ' been bought, so anything handed over here is written down as carried'
      + ' history — otherwise it is gone by the next start. Putting it right'
      + ' writes off spending nothing paid for, which is what makes embers look'
      + ' stuck at zero after owning everything.</p>'

      + '<p class="q-sec">Updates</p>'
      + '<div class="dev-row"><button class="dev-btn" id="dev-upd">Check now</button></div>';
    devWire();
  }

  function devWire(){
    const box = $('dev-body');
    if(!box) return;
    const say = (m)=>{ try{ toast(m); }catch(e){} };

    box.querySelectorAll('[data-day]').forEach(b=>{
      b.onclick = ()=>{
        const by = Number(b.dataset.day);
        dailyShift(by === 0 ? 0 : dailyShift() + by);
        /* Everything that reads the day, told to read it again. */
        try{ render(); }catch(e){}
        try{ moodAsk(); }catch(e){}
        try{ if(Arcade.open) Arcade._refresh(); }catch(e){}
        devPaint();
      };
    });
    const fill = box.querySelector('#dev-fill');
    if(fill) fill.onclick = ()=>say(devFill());
    const end = box.querySelector('#dev-end');
    if(end) end.onclick = ()=>{
      if(S.mode === 'setup'){ say('No block is running.'); return; }
      /* Two seconds rather than zero: the end of a block is a path through
         tick(), and jumping straight to it skips the part being tested. */
      S.endAt = Date.now() + 2000;
      S.remaining = 2;
      try{ render(); }catch(e){}
      say('Ending in two seconds.');
    };
    /* `grant` and not `credit`: see 37-embers.js. A credit is a running total
       and the next reload derives it away; a grant is written into the one
       input the derivation honours, so it is still there tomorrow. */
    box.querySelectorAll('[data-embers]').forEach(b=>{
      b.onclick = ()=>{
        try{ Embers.grant(Number(b.dataset.embers), 'developer'); }catch(e){}
        devPaint();
      };
    });
    const settle = box.querySelector('#dev-settle');
    if(settle) settle.onclick = ()=>{
      try{
        const wrote = Embers.settle();
        say(wrote > 0 ? 'Wrote off ' + wrote + ' nothing had paid for.'
                      : 'Nothing to write off — the balance already adds up.');
      }catch(e){ say('Could not: ' + e.message); }
      devPaint();
    };
    const own = box.querySelector('#dev-own');
    if(own) own.onclick = ()=>{
      try{
        const ids = [];
        for(const l of EMB_LIGHTS) ids.push(l.id);
        /* The prefixes come from the modules that own them, so a rename there
           does not leave this quietly buying nothing. */
        for(const sd of EMB_SOUNDS) ids.push(EMB_SND + sd.id);
        for(const f of FACES) ids.push(EMB_FACE + f.id);
        for(const row in BUD_COST){
          for(let i = 0; i < BUD_COST[row].length; i++) ids.push(budItemId(row, i));
        }
        /* **What it would have cost is granted at the same moment.** The
           balance is earned minus spent, so adding the shelf to `own` without
           paying for it put the balance about fourteen thousand in the hole:
           it read zero, and every ember earned afterwards vanished into the
           gap. A developer grant changes what you own, not what you have. */
        let bill = 0;
        for(const id of ids){
          if(Embers.own.indexOf(id) < 0){ Embers.own.push(id); bill += Embers.paidFor(id); }
        }
        Embers.grant(bill);
        Embers.save();
        Embers.render();
        say(ids.length + ' things owned' + (bill ? ', worth ' + bill : '') + '.');
      }catch(e){ say('Could not: ' + e.message); }
      devPaint();
    };
    const dis = box.querySelector('#dev-disown');
    if(dis) dis.onclick = ()=>{
      askConfirm('Own nothing?', 'Everything bought goes back, on this device.', 'Do it', ()=>{
        try{
          /* The other half of the grant above: handing the shelf back takes
             the granted embers with it, so a round trip through these two
             buttons leaves the balance where it started rather than paying
             out the whole shelf in cash. */
          let back = 0;
          for(const id of Embers.own) if(id !== 'seaglass') back += Embers.paidFor(id);
          Embers.own = ['seaglass'];
          Embers.grant(-Math.min(back, Embers.adjust));
          Embers.save();
          Embers.render();
        }catch(e){}
        devPaint();
      });
    };
    const upd = box.querySelector('#dev-upd');
    if(upd) upd.onclick = ()=>{
      try{ Update.check(); say('Checking…'); }catch(e){ say('No update server set.'); }
    };
  }

  /* The door, and only in the developer copy.

     The row appears on a stamped build so there is somewhere to type the key,
     and that is all it does: `devFill` is handed to the page by `devTry` after
     the key is right, never before, so a stamped build in anybody else's hands
     has a locked page and no console hook either. */
  try{
    if(devOn()){
      if(devUnlocked()) window.devFill = devFill;
      const row = $('d-dev');
      if(row){
        row.classList.remove('hide');
        row.onclick = ()=>{ closeDrawer(); devOpen(); };
      }
      if($('dev-close')) $('dev-close').onclick = ()=>devClose();
    }
  }catch(e){}

