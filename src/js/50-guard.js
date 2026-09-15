  /* ---------------- APP BLOCKING, AND THE NOTIFICATION YOU CAN DRIVE --------

     Two features, one Android plugin (`native/focus-guard`), one module.

     **They are one module because they are one fact.** Both need to know
     whether a block is running and how long is left, and both need to know it
     when the web view is frozen — which is precisely when nothing in this file
     is being given any time. So the clock is *mirrored* down to the native side
     on every change, and everything that has to work while we are away works
     from the mirror rather than from `S`.

     **Feature-detected, like everything else that needs a platform.** With no
     plugin — the desktop app, a browser, the test harness — `guardHasPlugin()`
     is false, the menu row is not drawn, no request is made, and the app is
     exactly what it was before. Same rule the update check and the account
     follow.

     **The settings do not ride in the account.** A blocklist is a list of
     package names on one phone; carrying it to a laptop that has none of them,
     and to a second phone that has different ones, is a synchronised list of
     things that do not exist. So this is the one thing a person sets up that is
     deliberately *not* in `Account.snapshot()` (see HANDOFF §7), and that is
     also why 47-merge.js and server/accounts.js did not have to change with it.

     **What it does is ScreenZen's**, feature for feature where Android allows:
     rules that group apps and websites under one set of settings; in force
     during focus, during any session, always, or on a schedule; a pause that
     grows with each open; your own question; an optional small task; a choice
     of how long to go in; daily limits on opens and on minutes that block or
     keep pausing; a cooldown; unlock odds; quick looks; your own tasks offered
     instead; a lock that makes every change wait; uninstall protection;
     grayscale; and a history to see it by. The decisions are made natively, in
     GuardRules.java, and tested there. */

  const GUARD_KEY = 'focus_guard';

  /* One rule. Every field is a ScreenZen setting, and each default is an
     opinion:

     `pause` 10s — long enough to interrupt a reflex, short enough that you do
     not learn to put the phone down and come back for it in a minute.
     `open` [5] — an allowance should run out while you are still in the app, or
     it is not an allowance, it is a door.
     `after` 'block' — a limit that only asks politely at the limit is the one
     people stop reading. */
  const GUARD_RULE = {
    id:'', name:'', off:false,
    apps:[], sites:[],
    when:'focus', days:'12345', from:'09:00', to:'17:00',
    pause:10, step:0, prompt:'', task:'none',
    open:[5], opens:0, minutes:0, after:'block',
    cooldown:0, odds:100, quick:false, hard:false,
  };
  const GUARD_DEFAULTS = {on:false, rules:[], lock:{on:false, delay:10}, pending:null, gray:false, excl:[]};
  const GUARD_OPEN_CHOICES = [1, 5, 10, 15, 30];
  const GUARD_LOCK_DELAYS = [5, 10, 30, 60, 240];
  const GUARD_ODDS = [100, 75, 50, 25];

  /* How long the clock is held on the way back in while the phone is asked what
     it did while we were gone. A ceiling, not a wait: released the moment the
     answer arrives, and released anyway if it never does. */
  const GUARD_HOLD_MS = 3000;

  /** The plugin, or null everywhere it does not exist. Self-contained on
      purpose — 45-notify.js calls this at load time, from a file that sorts
      before this one, so it may not read anything declared here. */
  function guardHasPlugin(){
    try{
      const C = window.Capacitor;
      return !!(C && C.Plugins && C.Plugins.FocusGuard);
    }catch(e){ return false; }
  }
  function guardApi(){
    try{ return window.Capacitor.Plugins.FocusGuard; }catch(e){ return null; }
  }

  /* **The clock is held while the phone is answering.**

     Pause from the notification, put the phone in a pocket, come back twenty
     minutes later: as far as this page is concerned the block never stopped,
     and the 250ms loop starts ticking the moment the web view thaws. That is
     twenty phantom minutes in the log and the ember count before the answer to
     `takeCommand()` has even arrived — the same shape of fault as the one
     `tick()`'s own running check was written for, arriving from the other side.

     So `tick()` asks this first. It is a function rather than a variable so an
     earlier file can call it: declarations hoist across the whole bundle,
     `let` does not (HANDOFF §2). */
  let GUARD_HOLD = false;
  function guardHolding(){ return GUARD_HOLD; }

  const Guard = {
    on:false,                 // does the plugin exist
    cfg:null,                 // set just below, once guardClean exists
    status:{notifications:false, overlay:false, accessibility:false, admin:false, gray:false},
    apps:[],                  // what is installed, once it has been asked for
    appsAsked:false,
    appsBusy:false,
    usage:{},                 // date → target → {secs, shown, through, closed, quick}
    day:'',                   // the day the phone is counting as today
    key:'',                   // the last timer state pushed down, unchanged = no push
    filter:'',
    editing:'',               // the id of the rule open in the editor

    async load(){
      this.on = guardHasPlugin();
      try{
        const r = await KV.get(GUARD_KEY);
        if(r && r.value) this.cfg = guardClean(JSON.parse(r.value));
      }catch(e){}
      guardPromote();
      if(!this.on) return;
      /* The stored config is the authority and it is pushed down rather than
         read up. The native copy exists so the accessibility service can make
         a decision without us; it is a cache of this, not a second opinion —
         except about the lock, which it enforces (see `push`). */
      await this.push();
      await this.refresh();
      this.listen();
      guardPushTasks();
    },

    save(){
      try{ KV.set(GUARD_KEY, JSON.stringify(this.cfg)); }catch(e){}
      this.push();
      guardPaint();
    },

    /* **What the phone kept is the truth.** The lock is enforced natively
       (GuardRules.accept), so a save that tried to loosen something directly —
       a stale page, a bug — comes back without the loosening. Compared with
       what *was sent*, not with what is here now: a second change made while
       the first was on its way must not be overwritten by the first one's
       echo. */
    async push(){
      const api = guardApi();
      if(!api) return;
      const sent = JSON.stringify(this.cfg);
      try{
        const kept = await api.setConfig(JSON.parse(sent));
        if(!kept || !Array.isArray(kept.rules)) return;
        const k = guardClean(kept);
        if(JSON.stringify(k) === JSON.stringify(guardClean(JSON.parse(sent)))) return;
        this.cfg = k;
        try{ KV.set(GUARD_KEY, JSON.stringify(k)); }catch(e){}
        guardPaint();
      }catch(e){}
    },

    /** What Android will actually let us do, and what has happened. */
    async refresh(){
      const api = guardApi();
      if(!api) return;
      guardPromote();
      try{ this.status = Object.assign({}, this.status, await api.status()); }catch(e){}
      try{
        const s = await api.getStats();
        this.usage = (s && s.usage && typeof s.usage === 'object') ? s.usage : {};
        this.day = (s && s.day) || '';
      }catch(e){}
      /* Device admin exists for the lock and for nothing else, so once the lock
         has actually come off it goes too — nobody should be left with a
         device admin they only granted for a setting they have since turned
         off. */
      if(this.status.admin && !guardLocked(this.cfg) && api.releaseAdmin){
        try{ await api.releaseAdmin(); this.status.admin = false; }catch(e){}
      }
      guardPaint();
    },

    /* The live route. A button pressed while the app happens to be running does
       not have to wait to be picked up on the next resume, and the listener is
       the only difference between a live app and a dead one from the outside. */
    listen(){
      const api = guardApi();
      if(!api || !api.addListener) return;
      try{
        api.addListener('guardCommand', (e)=>{
          if(!e || !e.cmd) return;
          guardApply(e.cmd, null);
        });
      }catch(e){}
    },
  };

  /* ---------------- what a config is allowed to be ----------------
     Everything is cleaned on the way in, because it all reaches the native side
     and drives a countdown, a limit and a lock: a nonsense number out of an
     edited backup would be a shield nobody can get past or one nobody notices. */

  function guardClamp(v, lo, hi, dflt){
    const n = Math.round(Number(v));
    if(!isFinite(n)) return dflt;
    return Math.max(lo, Math.min(hi, n));
  }
  function guardNewId(){
    return 'r' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  }
  function guardTime(v, dflt){
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || '').trim());
    if(!m || +m[1] > 23 || +m[2] > 59) return dflt;
    return String(m[1]).padStart(2, '0') + ':' + m[2];
  }
  /** A site as the person typed it, reduced to the host the phone will compare
      it with — the same reduction GuardRules.host makes on an address bar. */
  function guardSite(s){
    let h = String(s || '').trim().toLowerCase();
    const i = h.indexOf('://');
    if(i >= 0) h = h.slice(i + 3);
    h = h.split(/[\/?#\s:]/)[0];
    if(h.indexOf('www.') === 0) h = h.slice(4);
    if(h.indexOf('.') <= 0 || h.slice(-1) === '.' || !/^[a-z0-9.-]+$/.test(h)) return '';
    return h;
  }
  function guardList(v, most, ok){
    if(!Array.isArray(v)) return [];
    const out = [];
    for(const x of v){
      if(typeof x !== 'string' || !x || !ok(x) || out.indexOf(x) >= 0) continue;
      out.push(x);
      if(out.length >= most) break;
    }
    return out;
  }

  function guardRuleClean(r){
    if(!r || typeof r !== 'object') return null;
    const d = GUARD_RULE;
    const open = (Array.isArray(r.open) ? r.open : d.open).map(n=>guardClamp(n, 1, 120, 5));
    const out = {
      id: (typeof r.id === 'string' && /^[\w-]{1,40}$/.test(r.id)) ? r.id : guardNewId(),
      name: String(r.name || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      off: !!r.off,
      apps: guardList(r.apps, 200, s=>/^[\w.]+$/.test(s)),
      sites: guardList((Array.isArray(r.sites) ? r.sites : []).map(guardSite), 100, s=>!!s),
      when: ['focus', 'session', 'always', 'schedule'].indexOf(r.when) >= 0 ? r.when : d.when,
      days: typeof r.days === 'string'
        ? Array.from(new Set(r.days.replace(/[^0-6]/g, '').split(''))).sort().join('')
        : d.days,
      from: guardTime(r.from, d.from),
      to: guardTime(r.to, d.to),
      pause: guardClamp(r.pause, 0, 120, d.pause),
      step: guardClamp(r.step, 0, 60, 0),
      prompt: String(r.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      task: ['none', 'reason', 'sum'].indexOf(r.task) >= 0 ? r.task : 'none',
      open: Array.from(new Set(open)).sort((a, b)=>a - b).slice(0, 4),
      opens: guardClamp(r.opens, 0, 50, 0),
      minutes: guardClamp(r.minutes, 0, 1440, 0),
      after: r.after === 'pause' ? 'pause' : 'block',
      cooldown: guardClamp(r.cooldown, 0, 240, 0),
      odds: guardClamp(r.odds, 1, 100, 100),
      quick: !!r.quick,
      hard: !!r.hard,
    };
    if(!out.open.length) out.open = [5];
    return out;
  }

  function guardClean(v){
    const out = JSON.parse(JSON.stringify(GUARD_DEFAULTS));
    if(!v || typeof v !== 'object') return out;
    out.on = !!v.on;
    if(Array.isArray(v.rules)){
      const seen = {};
      out.rules = v.rules.map(guardRuleClean).filter(r=>{
        if(!r || seen[r.id]) return false;
        return (seen[r.id] = true);
      }).slice(0, 30);
    }else if(Array.isArray(v.apps) && v.apps.length){
      /* **The first version had one set of settings for every app.** It becomes
         one rule with the same apps and the same numbers, so updating changes
         nothing about what is blocked. Its `opens` of zero meant no way through
         at all, which is a rule that blocks outright now; any other number was
         a daily limit that closed the way when it ran out. */
      const opens = guardClamp(v.opens, 0, 20, 3);
      out.rules = [guardRuleClean({
        id:'r1', apps:v.apps, when:v.when,
        pause:v.pause, open:[guardClamp(v.allow, 1, 60, 5)],
        opens: opens || 0, hard: opens === 0, after:'block',
      })];
    }
    const lock = v.lock && typeof v.lock === 'object' ? v.lock : {};
    out.lock = {on:!!lock.on, delay:guardClamp(lock.delay, 1, 1440, 10)};
    out.gray = !!v.gray;
    out.excl = guardList(v.excl, 200, s=>/^[\w.:-]+$/.test(s));
    const p = v.pending;
    if(p && typeof p === 'object' && p.cfg && typeof p.cfg === 'object' && Number(p.at) > 0){
      out.pending = {at:String(Math.round(Number(p.at))), cfg:guardClean(Object.assign({}, p.cfg, {pending:null}))};
    }
    return out;
  }
  Guard.cfg = guardClean(null);

  /* ---------------- the lock ----------------
     While it is on, every change waits out its delay before it happens — the
     friction ScreenZen calls lock mode. A change made while one is already
     waiting replaces it and starts the wait again; changing things back to how
     they are cancels it. */

  function guardLocked(cfg){
    return !!(cfg && cfg.on && cfg.lock && cfg.lock.on);
  }
  /** The config being edited: the waiting one, if there is one, so a second
      edit builds on the first rather than silently undoing it. */
  function guardWorking(){
    return (Guard.cfg.pending && Guard.cfg.pending.cfg) || Guard.cfg;
  }
  /** Every edit goes through here, and this is where the lock bites. */
  function guardChange(fn){
    const base = JSON.parse(JSON.stringify(guardWorking()));
    base.pending = null;
    fn(base);
    const next = guardClean(base);
    next.pending = null;
    if(guardLocked(Guard.cfg)){
      const now = JSON.parse(JSON.stringify(Guard.cfg));
      now.pending = null;
      Guard.cfg.pending = JSON.stringify(next) === JSON.stringify(guardClean(now))
        ? null
        : {at:String(Date.now() + Guard.cfg.lock.delay * 60000), cfg:next};
    }else{
      Guard.cfg = next;
    }
    Guard.save();
  }
  function guardCancelPending(){
    if(!Guard.cfg.pending) return;
    Guard.cfg.pending = null;
    Guard.save();
  }
  /** A waiting change whose time has come, applied. The phone does the same the
      first time it looks, so neither side has to be running at the moment. */
  function guardPromote(){
    const p = Guard.cfg.pending;
    if(!p || Number(p.at) > Date.now()) return false;
    Guard.cfg = guardClean(Object.assign({}, p.cfg, {pending:null}));
    try{ KV.set(GUARD_KEY, JSON.stringify(Guard.cfg)); }catch(e){}
    return true;
  }

  /* ---------------- your tasks, mirrored ----------------
     The shield offers your own open tasks as something to do instead of the
     app, and it cannot ask this page for them — so, like the clock, they are
     pushed down. Called from `saveTasks`, which every change to the list goes
     through. */
  function guardPushTasks(){
    if(!Guard.on) return;
    const api = guardApi();
    if(!api || !api.setTasks) return;
    let list = [];
    try{
      list = TASKS.filter(t=>t && !t.done && String(t.text || '').trim())
        .slice(0, 10).map(t=>({id:String(t.id), text:String(t.text).trim().slice(0, 80)}));
    }catch(e){}
    try{ api.setTasks({tasks:list}); }catch(e){}
  }

  /* ---- the clock, mirrored down ----
     Called from render(), which runs on every state change and once a second
     while a block lasts. Keyed so the common case — the same second arriving
     again with nothing changed — costs one string comparison, the same shape
     `Notify.sync` and `vfxSet` use. */
  function guardPushTimer(){
    if(!Guard.on) return;
    const live = S.mode !== 'setup';
    const running = !!S.running && live;
    const key = live ? (S.mode + '|' + (running ? 1 : 0) + '|' + S.endAt + '|' + S.remaining) : '';
    if(key === Guard.key) return;
    Guard.key = key;
    const api = guardApi();
    if(!api) return;
    try{
      api.setTimer({
        live, running,
        mode: S.mode,
        /* **Instants cross as strings.** An epoch in milliseconds does not fit
           an int, and what a JavaScript number becomes on the other side of the
           bridge is the bridge's business rather than ours. A string is the one
           shape that cannot be quietly rounded. */
        endAt: String(running ? S.endAt : 0),
        remainingMs: String(Math.max(0, Math.round(S.remaining * 1000))),
      });
    }catch(e){}
  }

  /* ---- a button on the notification ----
     `mirror` is the native side's copy of the clock at the moment the button was
     pressed, and it is what the command has to be applied against. "Continue"
     an hour ago means the block has been running for an hour; working the end
     time out from *now* would silently give back the hour. */
  function guardApply(cmd, mirror){
    try{
      if(cmd === 'stop'){
        if(S.mode !== 'setup') stop();
        return;
      }
      if(cmd === 'pause'){
        if(!S.running) return;
        if(mirror && mirror.remainingMs != null){
          S.endAt = Date.now() + Math.max(0, Number(mirror.remainingMs));
        }
        pause();
        return;
      }
      if(cmd === 'resume'){
        if(S.running || S.mode === 'setup') return;
        if(mirror && mirror.endAt){
          S.remaining = Math.max(0, Math.round((Number(mirror.endAt) - Date.now()) / 1000));
        }
        start();
      }
    }catch(e){}
  }

  /* ---- leaving, and coming back ----
     The notification is posted when the app goes away and taken down when it
     comes back, which is what "only when you click out of it" means. It is not
     posted while the app is on screen at all: a permanent notification for a
     timer you are looking at is clutter with a countdown in it. */
  document.addEventListener('visibilitychange', ()=>{
    if(!Guard.on) return;
    const api = guardApi();
    if(!api) return;
    if(document.visibilityState === 'hidden'){
      /* Push before showing. The notice is drawn from the mirror, and the
         mirror has to be this second's rather than last render's — otherwise a
         block started and immediately backgrounded posts the previous state. */
      guardPushTimer();
      try{ if(S.mode !== 'setup') api.showNotice(); else api.hideNotice(); }catch(e){}
      return;
    }
    guardResume();
  });

  function guardResume(){
    const api = guardApi();
    if(!api) return;
    try{ api.hideNotice(); }catch(e){}
    GUARD_HOLD = true;
    /* Released on a timer as well as on the answer. A promise that never
       settles would otherwise leave the clock stopped for the rest of the
       session, which is a far worse failure than a phantom minute. */
    const release = ()=>{
      if(!GUARD_HOLD) return;
      GUARD_HOLD = false;
      try{ if(S.running) tick(); }catch(e){}
      try{ Guard.refresh(); }catch(e){}
    };
    const bail = setTimeout(release, GUARD_HOLD_MS);
    api.takeCommand().then((r)=>{
      clearTimeout(bail);
      if(r && r.cmd) guardApply(r.cmd, r.timer);
      release();
      render();
    }).catch(()=>{ clearTimeout(bail); release(); });
  }
