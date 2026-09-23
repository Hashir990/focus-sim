  /* ---------------- accounts, the client half ----------------
     Signing in, and carrying your history between devices. The server is
     `server/accounts.js`; the rules that decide what survives a merge are
     `47-merge.js`, and both ends run them.

     **Opt-in by hosting, exactly like the update check.** `ACC_URL` is stamped
     at build time. With nothing there — which is how this repo ships — there is
     no sign-in in the menu, no request, and no mention of an account anywhere.
     A copy handed over on a USB stick does not grow a login screen.

     **What sync is here.** Pull the vault, merge it into what this device knows,
     push the result back. Not a live connection, not a subscription: it runs
     when you sign in, when the app opens, and after a block ends. Nothing waits
     on it and nothing breaks without it — the app has always worked offline and
     still does, which is why every failure below is quiet.

     **Why merging locally as well as on the server.** The server merges to stop
     two devices overwriting each other. This end merges so that what you are
     looking at is the union the moment you sign in, rather than after a round
     trip. Same function, so the two cannot disagree. */

  const ACC_URL = '__ACCOUNT_URL__';
  const ACC_KEY = 'focus_account';

  function accConfigured(){
    return !!ACC_URL && /^https?:\/\//.test(ACC_URL) && ACC_URL.indexOf('OWNER') < 0;
  }

  const Account = {
    token:'', username:'', rev:0, busy:false, note:'', _wasLocked:null,

    async load(){
      if(!accConfigured()) return;
      try{
        const r = await KV.get(ACC_KEY);
        if(r && r.value){
          const d = JSON.parse(r.value) || {};
          this.token = typeof d.token === 'string' ? d.token : '';
          this.username = typeof d.username === 'string' ? d.username : '';
          this.rev = d.rev | 0;
        }
      }catch(e){}
    },
    save(){
      try{ KV.set(ACC_KEY, JSON.stringify({token:this.token, username:this.username, rev:this.rev})); }
      catch(e){}
    },

    async _post(path, body){
      const res = await fetch(ACC_URL.replace(/\/+$/, '') + path, {
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify(body || {}),
      });
      let out = {};
      try{ out = await res.json(); }catch(e){}
      if(!out || out.ok !== true) throw new Error((out && out.error) || 'that did not work');
      return out;
    },

    /* ---- what this device knows, in the shape the merge understands ---- */
    /* **Everything, or the account is not a profile.**

       This carried the log, the embers and five settings. Everything else — the
       calendar, the checklist, which light is on, what the buddy looks like and
       which antic he does — stayed on the device it was made on, so signing in
       on a new laptop gave you your hours back and none of your things. An
       account you have to set up again on every machine is a backup, not a
       profile.

       Two shapes in here, and they merge by different rules. `plan` and `tasks`
       are lists with ids: unioned, minus `gone`. Everything in `sim` is a single
       value settled on `S.at`, which is why anything that writes one of them has
       to call `save()` — see the note in `Embers.use()`. */
    snapshot(){
      return {
        log: LOG,
        own: Embers.own,
        // what was owned before the price rise, priced from the old list; see EMB_WAS
        grand: Embers.grand || [],
        claimed: Embers.claimed,
        feats: Embers.feats,
        adjust: Embers.adjust,
        plan: PLAN,
        tasks: TASKS,
        gone: GONE,
        /* Your own quotes, and the arcade. Both were device-only, which is why
           a quote written on a phone never reached a laptop and why signing in
           somewhere new handed you your hours back beside an empty crossword.
           See `quoteId` in 15-quotes-data.js for how a quote came to have an id
           to travel under, and `gamesSnapshot` in 09-arcade-core.js. */
        quotes: CUSTOM_QUOTES,
        games: gamesSnapshot(),
        // which dated puzzle you played, and how far — see 09b-daily.js
        daily: dailySnapshot(),
        /* Who you know. Identity only, never their cards — see `mergeFriends`
           in 47-merge.js for why. Signing in on a new phone used to hand you
           your hours back beside an empty friends list. */
        friends: friendsSnapshot(),
        // one emoji a day — see 17b-mood.js
        mood: moodSnapshot(),
        sim: {
          focusMin:S.focusMin, breakMin:S.breakMin, autoContinue:S.autoContinue,
          sound:S.sound, repeat:S.repeat, face:S.face,
          buddy:S.buddy, budAnim:S.budAnim | 0, budShow:S.budShow !== false,
          light:Embers.light, amb:AMB.id, ambVol:AMB.vol,
          at:S.at || 0,
        },
      };
    },

    /* Take a merged snapshot and become it. Ember totals are deliberately not
       in here — `reconcile()` derives them from the result, so two devices
       cannot end up with different balances for the same history. */
    adopt(snap){
      if(!snap) return;
      if(Array.isArray(snap.log)){ LOG.length = 0; for(const r of snap.log) LOG.push(r); saveLog(); }
      if(Array.isArray(snap.own)) Embers.own = snap.own.slice();
      if(Array.isArray(snap.grand)) Embers.grand = snap.grand.slice();
      if(Array.isArray(snap.claimed)) Embers.claimed = snap.claimed.slice();
      if(snap.feats) Embers.feats = Object.assign({}, snap.feats);
      if(snap.adjust != null) Embers.adjust = Math.max(0, snap.adjust | 0);
      if(Array.isArray(snap.gone)){ GONE = snap.gone.slice(); saveGone(); }
      if(Array.isArray(snap.plan)){ PLAN = snap.plan.slice(); savePlan(); }
      if(Array.isArray(snap.tasks)){ TASKS = snap.tasks.slice(); saveTasks(); }
      /* After `gone`, which both of these are filtered against. */
      try{ quotesAdopt(snap.quotes); }catch(e){}
      try{ gamesAdopt(snap.games); }catch(e){}
      try{ dailyAdopt(snap.daily); }catch(e){}
      try{ friendsAdopt(snap.friends); }catch(e){}
      try{ moodAdopt(snap.mood); }catch(e){}
      const sim = snap.sim || {};
      /* Only if it is genuinely newer than what this device last wrote, which
         is the same test the server makes. Otherwise signing in on an old phone
         would drag everybody's settings backwards. */
      if((sim.at || 0) > (S.at || 0)){
        for(const k of ['focusMin','breakMin','autoContinue','sound','repeat','face',
                        'buddy','budAnim','budShow']){
          if(sim[k] !== undefined) S[k] = sim[k];
        }
        /* **A light you do not own is not a light.** `own` has already been
           merged above, so this is checked against the union rather than
           against what this device happened to have — but it is still checked.
           A snapshot is data off a wire and the shop is the only thing that
           grants a theme. */
        if(sim.light && Embers.own.indexOf(sim.light) >= 0 && Embers.light !== sim.light){
          Embers.light = sim.light;
          try{ Embers.save(); }catch(e){}
        }
        S.at = sim.at;
        save();
        /* Ambience last and guarded: it touches an `<audio>` element, and
           browsers refuse to start one outside a user gesture. Setting it is
           worth doing anyway — it is right when the person next presses play. */
        try{
          if(sim.ambVol != null) ambSetVolume(sim.ambVol);
          if(sim.amb && sim.amb !== AMB.id) ambSet(sim.amb);
        }catch(e){}
      }
      try{ Embers.reconcile(); Embers.save(); Embers.paint(); Embers.render(); }catch(e){}
      /* The account decides what is owned, so it also decides what he can be
         wearing — signing into one that has bought less than this device had
         takes those things off him. */
      try{ budStrip(); }catch(e){}
      try{ faceApply(); }catch(e){}
      try{ tasksRender(); tasksRefresh(); }catch(e){}
      /* The antic may have changed under him, and `stage()` skips work when the
         signature matches — so the slots have to be emptied, not just redrawn. */
      try{ Buddy.clearSlots(); Buddy.render(); Buddy.stage(); }catch(e){}
      try{ Stats.render && $('stats-overlay') && !$('stats-overlay').classList.contains('hide') && Stats.render(); }catch(e){}
      try{ Cal.render && Cal.render(); }catch(e){}
      try{ render(); }catch(e){}
    },

    /** Pull, merge, push. The whole of sync. */
    async sync(quiet){
      if(!accConfigured() || !this.token || this.busy) return;
      this.busy = true; this.render();
      try{
        const got = await this._post('/vault/get', {token:this.token});
        const merged = mergeSnapshots(this.snapshot(), got.snapshot);
        this.adopt(merged);
        const put = await this._post('/vault/put', {token:this.token, rev:got.rev, snapshot:merged});
        /* The server may have merged in a third device between our get and our
           put, so what comes back is the truth, not what we sent. */
        this.rev = put.rev | 0;
        this.adopt(put.snapshot);
        this.save();
        this.note = 'Synced';
      }catch(e){
        /* Offline, mid-deploy, a token that has been signed out elsewhere: all
           normal, and none of it stops the app working. */
        /* **"Could not reach the server" was the answer to every question.**
           `_post` throws the server's own words when it answers `ok:false` —
           rate limited, snapshot rejected, database unbound, a route that moved
           — and all of it came out as a network problem, which sent us looking
           at the network. A request that never arrived is the only thing that
           deserves that sentence: in a browser that is a `TypeError` from
           `fetch` itself, and nothing the server says can be one. */
        const why = (e && e.message) || '';
        const never = (e instanceof TypeError)
          || /failed to fetch|networkerror|load failed|network request failed/i.test(why);
        this.note = /signed in/i.test(e.message) ? ''
          : never ? ((typeof navigator === 'object' && navigator.onLine === false) ? 'This device is offline' : 'Could not reach the server')
          : why;
        if(/signed in/i.test(e.message)){ this.token = ''; this.username = ''; this.save(); }
        if(!quiet) toast(this.note || 'Signed out on this device');
      }
      this.busy = false; this.render();
    },

    /* **Making an account keeps what is here; signing in does not.**

       The difference is not a nicety, it is the whole of who the data belongs
       to. A new account has never held anything, so the hours on this device are
       yours and the sign-up is the moment they become the account's — throwing
       them away would be destroying the only copy. An account that already
       exists has its own history, and whatever is sitting on this device came
       from somewhere else: a different person's session, a shared laptop, or
       your own unsaved afternoon. Merging it in is how one login quietly
       collects everybody's hours, which is the same hole that closing the
       sign-out wipe was meant to shut.

       So: `signUp` syncs straight away and the local data goes up with it.
       `signIn` empties the device first, then pulls. */
    async signUp(email, username, password){
      const out = await this._post('/account/new', {email, username, password});
      this.token = out.token; this.username = out.username; this.rev = 0;
      this.save();
      // no wipe: the first sync carries this device's work into the new account
      await this.sync(true);
      toast(T('Signed in as {name}', {name:this.username}));
    },

    /* Ask, then sign in, then empty, then pull — in that order.

       The warning comes first so nothing is touched if they say no, but the
       *wipe* comes after the password has been accepted, so a typo cannot cost
       anybody their afternoon. Between the two, the only thing that has
       happened is a request. */
    signInAsk(email, password, done){
      const bits = this._localWork();
      if(!bits.length) return this._signIn(email, password, done);
      askConfirm(
        'Sign in and clear this device?',
        /* **"1 session that is" but "3 sessions that are".** `listPhrase` can
           return either, so the verb has to follow it. A dialog warning you
           about losing your work is the last place to get grammar wrong: it
           reads as machine-written, and machine-written reads as ignorable. */
        T(bits.length === 1 && /^1 /.test(bits[0])
          ? 'This device has {list} that is not saved to any account. Signing in replaces all of it with what is in {acct}, and there is no way back. To keep it, make a new account instead — that carries this device across.'
          : 'This device has {list} that are not saved to any account. Signing in replaces all of it with what is in {acct}, and there is no way back. To keep it, make a new account instead — that carries this device across.',
          {list:listPhrase(bits), acct:email || T('that account')}),
        'Clear and sign in',
        ()=>Account._signIn(email, password, done));
      return undefined;
    },

    async _signIn(email, password, done){
      let out;
      try{
        out = await this._post('/account/in', {email, password});
      }catch(e){
        if(done) done(e);
        return;
      }
      this.token = out.token; this.username = out.username; this.rev = 0;
      this.save();
      /* Everything local goes before anything of theirs arrives. `sync()` merges
         what it finds with what is here, so leaving this out is precisely the
         "borrow a login and keep the themes" hole. */
      this.wipe();
      await this.sync(true);
      toast(T('Signed in as {name}', {name:this.username}));
      if(done) done(null);
    },

    /* Kept for the tests and for anything that already calls it. */
    async signIn(email, password){
      return new Promise((ok, no)=>this._signIn(email, password, (e)=>e ? no(e) : ok()));
    },
    /* **Signing out empties the device, and it has to.**

       It used to leave everything where it was, which was kind and wrong. The
       history, the embers and the shelf that arrive when you sign in are *the
       account's*, and leaving them behind means signing into somebody else's
       account, syncing their hours and their purchases, signing out, and
       keeping the lot. Every theme in the shop was then free to anyone who
       could borrow a login once.

       So the account is the only home for progress once there is an account:
       signing in brings it, signing out takes it away, signing back in brings
       it again. That is a real cost to the honest case, which is why it is
       asked first and why the wording says where the history is going rather
       than that it is safe. */
    signOut(){
      askConfirm(
        T('Sign out of {name}?', {name:this.username}),
        'Your history stays in the account and is cleared from this device.',
        'Sign out',
        ()=>Account._signOut());
    },

    async _signOut(){
      const t = this.token;
      /* Pushed before anything local is thrown away, so a block finished in the
         last few minutes is not lost by signing out straight after it. If the
         network is down this quietly does nothing and that history is already
         on the server from the last sync. */
      try{ await this.sync(true); }catch(e){}

      this.token = ''; this.username = ''; this.rev = 0; this.note = '';
      this.save();
      this.wipe();
      try{ await this._post('/account/out', {token:t}); }catch(e){}
      this.render();
      toast('Signed out. Your history is in your account.');
    },

    /* ---- changing the password from inside ----
       The current one is asked for as well, because a signed-in device left
       unlocked is the ordinary way accounts get taken: without it, thirty
       seconds alone with somebody's laptop is enough to lock them out of their
       own account for good. */
    passwordForm(){
      const box = $('acc-pass-box');
      if(!box) return;
      if(box.dataset.open === '1'){ box.dataset.open = ''; box.innerHTML = ''; return; }
      box.dataset.open = '1';
      box.innerHTML = '<div class="acc-form">'
        + '<input id="acc-old" type="password" placeholder="Current password" autocomplete="current-password" />'
        + '<input id="acc-new2" type="password" placeholder="New password" autocomplete="new-password" />'
        + '<div class="acc-acts"><button class="mini-btn" id="acc-pass-go">Change it</button></div>'
        + '<p class="acc-note" id="acc-pass-msg"></p></div>';
      const msg = (t)=>{ const m = $('acc-pass-msg'); if(m) m.textContent = t; };
      $('acc-pass-go').onclick = async ()=>{
        const now = $('acc-old').value, next = $('acc-new2').value;
        if(next.length < 8) return msg('a password needs at least 8 characters');
        msg('One moment…');
        try{
          await Account._post('/account/password', {token:Account.token, password:now, next});
          box.dataset.open = ''; box.innerHTML = '';
          toast('Password changed. Other devices stay signed in.');
        }catch(e){ msg(e.message || 'that did not work'); }
      };
    },

    /** Put this device back to how it was before anybody signed in. */
    wipe(){
      LOG.length = 0;
      try{ saveLog(); }catch(e){}
      Embers.own = []; Embers.claimed = []; Embers.feats = {};
      /* **`adjust` and the totals have to go to zero before reconciling.**
         `reconcile()` guards against a shrinking log by inventing an `adjust`
         to hold the old balance — which is right when history is lost by
         accident and exactly wrong here, where losing it is the point. Left
         alone it hands every ember straight back and the wipe does nothing. */
      Embers.adjust = 0; Embers.earned = 0; Embers.have = 0; Embers.bank = 0;
      try{ Embers.reconcile(); Embers.save(); Embers.paint(); Embers.render(); }catch(e){}
      /* The buddy goes too: he is part of the account, and leaving somebody
         else's face on the screen after signing out of their account is the
         same mistake in miniature. */
      S.buddy = budDefault();
      S.budAnim = 0; S.budShow = true;
      /* Everything he was wearing was bought with the account's embers, so it
         goes with them. `own` is emptied above; this is the wardrobe following
         it rather than a second list to keep in step. */
      try{ Buddy.draft = null; Buddy.anim = null; Buddy.tryOn = null; }catch(e){}
      /* **The rest of the profile goes with it.** The calendar, the checklist
         and the tombstones are as much "what this person has" as the hours are,
         and now that they ride on the account they have to leave with it. The
         list here is the same list `snapshot()` carries; if one grows the other
         must, or signing out leaves something of a stranger's behind. */
      PLAN = []; try{ savePlan(); }catch(e){}
      TASKS = []; try{ saveTasks(); }catch(e){}
      GONE = []; try{ saveGone(); }catch(e){}
      CUSTOM_QUOTES = []; try{ saveQuotes(); }catch(e){}
      try{ gamesWipe(); }catch(e){}
      // and the record of which dated puzzles were played with them
      try{ dailyWipe(); }catch(e){}
      try{ renderQuotesList(); }catch(e){}
      /* `own` is empty now, so no bought light is valid any more. */
      Embers.light = 'seaglass';
      try{ Embers.save(); }catch(e){}
      try{ ambSet('off'); }catch(e){}
      /* **Stamped 0, and it must be the last settings write here.**
         `ambSet` calls `save()` on the way past, which stamps the clock with
         now. A device that has just been emptied has no settings of its own and
         must not out-rank the account it is about to pull — see the note on
         `save()` in 02-persistence.js. */
      try{ save(0); }catch(e){}
      try{ faceApply(); }catch(e){}
      try{ Buddy.render(); Buddy.stage(); }catch(e){}
      try{ tasksRender(); tasksRefresh(); }catch(e){}
      try{ Cal.render && Cal.render(); }catch(e){}
      try{ render(); }catch(e){}
    },

    /* Is there anything on this device that signing in would throw away?

       Only asked so the warning can be skipped when there is nothing to warn
       about — a fresh install signing in should not be made to read a paragraph
       about losing work it does not have. Settings are not counted: a clock face
       is not something anybody minds losing, and counting it would mean the
       warning appeared every single time. */
    _localWork(){
      const bits = [];
      if(LOG.length) bits.push(Tn('{n} session', '{n} sessions', LOG.length));
      if(PLAN.length) bits.push(Tn('{n} calendar entry', '{n} calendar entries', PLAN.length));
      if(TASKS.length) bits.push(Tn('{n} task', '{n} tasks', TASKS.length));
      if(CUSTOM_QUOTES.length) bits.push(Tn('{n} quote you wrote', '{n} quotes you wrote', CUSTOM_QUOTES.length));
      const bought = (Embers.own || []).filter(id=>id !== 'seaglass').length;
      if(bought) bits.push(Tn('{n} thing you have bought', '{n} things you have bought', bought));
      return bits;
    },

    /* The footer in the menu. It said "your data stays on this device" from the
       first build, and that was true right up until somebody signs in. Saying
       it anyway would be the one dishonest sentence in the app, so it is
       written from what is actually the case. */
    _where(){
      const el = $('acc-where');
      if(!el) return;
      el.textContent = this.token
        ? T('Focus Simulator · synced to your account as {name}', {name:this.username})
        : 'Focus Simulator · your data stays on this device';
    },

    /* The corner button, and the date it stands in front of.

       Only one of the two is ever on screen. In a build with no account server
       the button does not exist and the date keeps the corner it always had. */
    _chip(){
      const chip = $('acc-chip'), day = $('today-wrap');
      if(!chip) return;
      const on = accConfigured();
      chip.classList.toggle('hide', !on);
      if(day) day.classList.toggle('hide', on);
      if(!on) return;
      chip.classList.toggle('out', !this.token);
      chip.classList.toggle('busy', !!this.busy);
      chip.innerHTML = this.token
        ? '<i></i><span translate="no">' + esc(this.username) + '</span>'
        : '<span>Sign in</span>';
      chip.setAttribute('aria-label', this.token ? T('Account — {name}', {name:this.username}) : T('Sign in'));
    },

    /* ---- the panel, in Your focus ---- */
    render(){
      this._where();
      this._chip();
      /* The buddy is locked until there is an account, so signing in or out
         changes what his panel should say — and nothing else was telling him.
         Only on the flip: this runs on every sync tick, and rebuilding the
         picker underneath somebody mid-choice would be its own bug. */
      const locked = accConfigured() && !this.token;
      if(this._wasLocked !== locked){
        this._wasLocked = locked;
        try{ Buddy.render(); Buddy.stage(); }catch(e){}
        /* Your friend code belongs to the account, not to the machine — so it
           follows you on, and stays behind when you go. */
        try{ syncAdoptAccount(this.token ? this.username : ''); }catch(e){}
      }
      const box = $('acc-box');
      if(!box) return;
      box.classList.toggle('hide', !accConfigured());
      if(!accConfigured()) return;
      if(this.token){
        /* **Say what the button does.** "Sync now" next to a spinner is a
           button people press to find out, and the thing they are afraid of is
           that it overwrites — that signing in on a fresh phone will wipe the
           months on the laptop. It cannot: the two histories are merged, and
           the fuller record of any block wins. Saying so is worth four lines,
           and it is also why nobody ever needs to press this. */
        box.innerHTML = '<p class="emb-head">Account <em>your history follows you</em></p>'
          + '<div class="acc-in"><b translate="no">' + esc(this.username) + '</b>'
          + '<span>' + esc(this.busy ? T('Syncing…') : (this.note || T('Up to date'))) + '</span>'
          + '<button class="mini-btn" id="acc-sync"' + (this.busy ? ' disabled' : '') + '>Sync now</button>'
          + '<button class="mini-btn" id="acc-pass">Change password</button>'
          + '<button class="mini-btn" id="acc-out">Sign out</button></div>'
          /* **Say what "nothing is replaced" means, or it is only a promise.**
             The fear is specific — that signing in on a new phone wipes the
             months on the laptop — and "nothing is replaced" does not answer
             it. Two lines do: the histories are put together, and where they
             disagree about one session the fuller record wins. */
          + '<p class="acc-hint">This device and your others are merged, never '
          + 'replaced — where they disagree about a session, the fuller record '
          + 'wins. It runs on its own; the button is only for not waiting.</p>'
          + '<div id="acc-pass-box"></div>';
        const a = $('acc-sync'); if(a) a.onclick = ()=>Account.sync(false);
        const b = $('acc-out'); if(b) b.onclick = ()=>Account.signOut();
        const p = $('acc-pass'); if(p) p.onclick = ()=>Account.passwordForm();
        return;
      }
      box.innerHTML = '<p class="emb-head">Account <em>optional — carry your history between devices</em></p>'
        + '<div class="acc-form">'
        + '<input id="acc-email" type="email" placeholder="Email" autocomplete="email" />'
        + '<input id="acc-user" class="hide" type="text" placeholder="Username" autocomplete="username" maxlength="20" />'
        + '<input id="acc-pass" type="password" placeholder="Password" autocomplete="current-password" />'
        + '<div class="acc-acts">'
        + '<button class="mini-btn" id="acc-in">Sign in</button>'
        + '<button class="mini-btn" id="acc-new">Make an account</button>'
        + '</div>'
        + '<button type="button" class="acc-forgot" id="acc-forgot">Forgotten your password?</button>'
        + '<p class="acc-note" id="acc-msg">' + esc(this.note) + '</p></div>';
      const msg = (t)=>{ this.note = t; const m = $('acc-msg'); if(m) m.textContent = t; };
      const go = async (fn)=>{
        msg('One moment…');
        try{ await fn(); }
        catch(e){ msg(e.message || 'that did not work'); return; }
        this.note = ''; this.render();
      };
      /* `signInAsk` may put a dialog up and return before anything happens, so
         this cannot be wrapped in `go()` — that would sit on "One moment…"
         while the person reads the warning, and clear it if they cancel. It
         reports through the callback instead. */
      $('acc-in').onclick = ()=>{
        msg('');
        Account.signInAsk($('acc-email').value, $('acc-pass').value, (err)=>{
          if(err){ msg(err.message || 'that did not work'); return; }
          this.note = ''; this.render();
        });
      };
      $('acc-new').onclick = ()=>{
        const u = $('acc-user');
        /* The username field only appears when it is wanted. Two buttons and
           three boxes reads as a form to fill in; one box you have not been
           shown yet reads as a choice you have not made. */
        if(u.classList.contains('hide')){
          u.classList.remove('hide');
          msg('Pick a username — it is what other people see.');
          u.focus();
          return;
        }
        go(()=>Account.signUp($('acc-email').value, u.value, $('acc-pass').value));
      };
      /* The reply is the same whether or not that address has an account —
         "we have sent you one" for an unknown email is how you stop this being
         a way to ask which addresses are registered here. */
      $('acc-forgot').onclick = async ()=>{
        const email = $('acc-email').value;
        if(!email) return msg('Put your email in the box first.');
        msg('One moment…');
        try{ await Account._post('/account/forgot', {email}); }
        catch(e){ return msg(e.message || 'that did not work'); }
        msg('If there is an account for that address, a new password is on its way. '
          + 'Nothing changes until it actually sends.');
      };
    },
  };

  /* ---------- the page the two of them live on ----------
     Sign-in and your buddy were both buried in the middle of Your focus, which
     is a page of totals you read. These are the two things on it you *change*,
     and being asked for a password halfway down a wall of statistics is the
     wrong place to be asked. */
  const AcctPage = {
    open(){
      const ov = $('acct-overlay');
      if(!ov) return;
      ov.classList.remove('hide');
      Account.render();
      try{ Buddy.render(); }catch(e){}
    },
    /* Ask before the page goes, not after — an unsaved buddy is the only thing
       on it that is lost by leaving. */
    close(){
      const shut = ()=>{ const ov = $('acct-overlay'); if(ov) ov.classList.add('hide'); };
      try{ Buddy.leaving(shut); }catch(e){ shut(); }
    },
  };

  /* Two ways in, because they answer different questions: the corner is "am I
     signed in", the menu row is "where do I change my buddy". Both land here. */
  if($('d-account')) $('d-account').onclick = ()=>{ closeDrawer(); AcctPage.open(); };
  if($('acct-close')) $('acct-close').onclick = ()=>AcctPage.close();
  if($('acc-chip')) $('acc-chip').onclick = ()=>{ closeDrawer(); AcctPage.open(); };
