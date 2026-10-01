  /* ---------------- THE APP BLOCKING PAGE ----------------

     The mechanism is in 50-guard.js and, for every decision, GuardRules.java;
     these are the screens for it. Split the way the quotes are (15 data / 16
     UI), because the half that has to be right when the app is dead and the half
     that draws a list of toggles have nothing to say to each other.

     **Three screens.** The page, in the order somebody sets it up: the switch,
     the three permissions without which the switch does nothing, the rules, what
     has happened, and then the lock — last, because locking before the rest is
     right is locking yourself into a mistake. A rule has its own screen, because
     a rule is fifteen settings and a card per rule on the page is the only way
     three rules stay readable. And the app picker, which is a screen you scan by
     icon rather than read. */

  /** The three things Android has to be persuaded of, in the order they are asked. */
  const GUARD_PERMS = [
    {
      id:'notifications',
      name:'Notifications',
      why:'So a running block can say so from outside the app.',
      act:'Allow',
    },
    {
      id:'overlay',
      name:'Display over other apps',
      why:'Not for drawing over anything. Android only lets a background app open a screen if it has this, and the blocking screen is a screen.',
      act:'Open settings',
    },
    {
      id:'accessibility',
      name:'App blocking service',
      why:'To know which app is in front. If you block websites it reads the browser\'s address bar; nothing else on your screen.',
      act:'Open settings',
    },
  ];

  /* Short, because they sit two across on a narrow phone; the heading above
     supplies the verb. */
  const GUARD_WHEN = [
    {id:'focus',    n:'Focus blocks'},
    {id:'session',  n:'Any session'},
    {id:'always',   n:'Always'},
    {id:'schedule', n:'On a schedule'},
  ];
  const GUARD_TASKS = [
    {id:'none',   n:'Nothing'},
    {id:'reason', n:'Say why'},
    {id:'sum',    n:'Do a sum'},
  ];
  /* Monday first, because that is how a week is read; stored as 0 = Sunday,
     because that is how GuardRules and Calendar count. */
  const GUARD_DAYS = [[1, 'M'], [2, 'T'], [3, 'W'], [4, 'T'], [5, 'F'], [6, 'S'], [0, 'S']];

  /* Label, key, unit, range and step. The same rows drive the steppers and the
     snapping, and the ranges match guardRuleClean's clamps. */
  const GUARD_RULE_NUMS = [
    {k:'pause',    n:'Pause',              unit:'s',   lo:0, hi:120, by:5,
     why:'Seconds before anything can be pressed.'},
    {k:'step',     n:'Longer each time',   unit:'s',   lo:0, hi:30,  by:5,
     why:'Added to the pause for every open today.'},
    {k:'opens',    n:'Opens a day',        unit:'',    lo:0, hi:20,  by:1,
     why:'Zero is no limit.'},
    {k:'minutes',  n:'Minutes a day',      unit:'min', lo:0, hi:240, by:5,
     why:'Zero is no limit. One budget across everything in this rule.'},
    {k:'cooldown', n:'Wait between opens', unit:'min', lo:0, hi:60,  by:5,
     why:'Counted from when the last one ran out.'},
  ];

  /* ---------------- opening and closing ---------------- */

  function guardOpen(){
    const el = $('block-overlay');
    if(!el) return;
    el.classList.remove('hide');
    guardPaint();
    /* Asked every time the page opens rather than once at start-up. Both are
       cheap native calls and both go stale the moment somebody walks off to
       Settings and comes back, which is exactly what this page tells them to
       do. */
    try{ Guard.refresh(); }catch(e){}
    guardLoadApps();
  }
  function guardClose(){
    for(const id of ['block-overlay', 'block-rule-overlay', 'block-apps-overlay']){
      const el = $(id);
      if(el) el.classList.add('hide');
    }
  }

  /** The installed apps, once. A few hundred kilobytes of icons; not twice. */
  function guardLoadApps(){
    if(!Guard.on || Guard.appsAsked || Guard.appsBusy) return;
    const api = guardApi();
    if(!api) return;
    Guard.appsBusy = true;
    api.listApps().then(r=>{
      Guard.apps = (r && r.apps) || [];
      Guard.appsAsked = true;
      Guard.appsBusy = false;
      guardPaint();
      guardPaintPicker();
    }).catch(()=>{ Guard.appsBusy = false; });
  }

  function guardAppName(id){
    const a = Guard.apps.find(x=>x.id === id);
    return a ? a.name : id;
  }
  function guardAppIcon(id){
    const a = Guard.apps.find(x=>x.id === id);
    return a && a.icon ? a.icon : '';
  }

  /* ---------------- what has happened ---------------- */

  function guardTargets(rule){
    return rule.apps.concat(rule.sites.map(s=>'site:' + s));
  }
  function guardSum(day, rule, field){
    let n = 0;
    for(const t of guardTargets(rule)) n += (day && day[t] && day[t][field]) || 0;
    return n;
  }
  /** One target's counts for a day, with every field present. */
  function guardOne(day, target){
    const x = (day && day[target]) || {};
    return {secs:x.secs || 0, opens:x.opens || 0, shown:x.shown || 0,
            through:x.through || 0, closed:x.closed || 0, quick:x.quick || 0};
  }
  /* Minutes until there are enough of them to be hours. "94 min" is a number
     to work out; "1h 34m" is a length of time. Under a minute says so rather
     than rounding to nought, because nought reads as "this was not counted". */
  /* `{m} min` and `{h}h {r}m` are the shell's own, already carrying all six
     languages and already the shape the rest of the app writes a length of
     time in. A second pair here would be two spellings of the same minute. */
  function guardLen(secs){
    if(secs < 60) return T('under a minute');
    const m = Math.round(secs / 60);
    if(m < 60) return T('{m} min', {m});
    return T('{h}h {r}m', {h:Math.floor(m / 60), r:m % 60});
  }
  /* Busiest first, and the ones that were never touched last: a rule covering
     nine apps is a list you read the top of. */
  function guardRuleUse(day, rule){
    return guardTargets(rule)
      .map(t=>Object.assign({t}, guardOne(day, t)))
      .sort((a, b)=>(b.secs - a.secs) || (b.opens - a.opens));
  }
  /** Today's key as the phone counts it, or this device's date if it has not said. */
  function guardToday(){
    if(Guard.day) return Guard.day;
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function guardShift(key, n){
    const p = key.split('-').map(Number);
    const d = new Date(p[0], p[1] - 1, p[2] + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function guardHasLimits(cfg){
    return cfg.rules.some(r=>!r.off && (r.opens > 0 || r.minutes > 0));
  }
  /** Did a day stay inside every limit? Judged against the rules as they are now. */
  function guardDayOk(day, cfg){
    return cfg.rules.every(r=>r.off
      || ((!r.opens || guardSum(day, r, 'through') <= r.opens)
       && (!r.minutes || guardSum(day, r, 'secs') <= r.minutes * 60)));
  }
  /**
   * Days in a row inside the limits: today if it still is, and every recorded
   * day before it that was. Stops at the first day with no record, so a phone
   * with a week of history cannot have a streak of a year.
   */
  function guardStreak(usage, today, cfg){
    if(!guardHasLimits(cfg)) return 0;
    let n = 0;
    let key = today;
    if(usage[key] && guardDayOk(usage[key], cfg)) n++;
    key = guardShift(key, -1);
    for(let i = 0; i < 400 && usage[key] && guardDayOk(usage[key], cfg); i++){
      n++;
      key = guardShift(key, -1);
    }
    return n;
  }
  /** Seconds in everything a rule covers, for each of the last seven days, oldest first. */
  function guardWeek(usage, today, cfg){
    const out = [];
    const seen = {};
    const targets = [];
    for(const r of cfg.rules) for(const t of guardTargets(r)) if(!seen[t]){ seen[t] = 1; targets.push(t); }
    for(let i = 6; i >= 0; i--){
      const key = guardShift(today, -i);
      const day = usage[key] || {};
      let secs = 0;
      for(const t of targets) secs += (day[t] && day[t].secs) || 0;
      out.push({key, secs});
    }
    return out;
  }

  /* ---------------- saying what a rule does ---------------- */

  function guardDaysText(days){
    if(days === '0123456') return 'Every day';
    if(days === '12345') return 'Weekdays';
    if(days === '06') return 'Weekends';
    if(!days) return 'No days';
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return GUARD_DAYS.filter(d=>days.indexOf(String(d[0])) >= 0).map(d=>names[d[0]]).join(' ');
  }
  function guardWhenText(r){
    if(r.when === 'schedule') return guardDaysText(r.days) + ' ' + r.from + '–' + r.to;
    if(r.when === 'always') return 'Always';
    if(r.when === 'session') return 'During any session';
    return 'During focus';
  }
  function guardRuleTitle(r){
    if(r.name) return r.name;
    const names = r.apps.map(guardAppName).concat(r.sites);
    if(!names.length) return 'New rule';
    return names.slice(0, 2).join(', ') + (names.length > 2 ? ' +' + (names.length - 2) : '');
  }
  function guardRuleLine(r){
    const bits = [guardWhenText(r)];
    if(r.hard) bits.push('blocked outright');
    else{
      bits.push(r.pause + 's pause' + (r.step ? ', +' + r.step + 's each time' : ''));
      if(r.opens) bits.push(r.opens + (r.opens === 1 ? ' open' : ' opens') + ' a day');
      if(r.minutes) bits.push(r.minutes + ' min a day');
    }
    return bits.join(' · ');
  }

  /* ---------------- the page ---------------- */

  let GUARD_DUE_T = 0;

  function guardPaint(){
    const box = $('block-body');
    if(!box) return;
    /* Nothing here is Android's fault; there simply is no way to do any of it in
       a web view or on a desktop. Said plainly, once, rather than drawing a
       page of controls that cannot do anything. */
    if(!Guard.on){
      box.innerHTML = '<p class="blk-note">App blocking needs the Android app.'
        + ' A browser and the desktop app have no way to see which app is in front'
        + ' of you, or to stand in front of it.</p>';
      return;
    }
    const c = Guard.cfg;
    const w = guardWorking();
    let h = '';

    h += '<button class="blk-switch' + (c.on ? ' on' : '') + '" id="blk-on">'
       + '<span class="blk-knob"></span>'
       + '<b>' + (c.on ? 'Blocking is on' : 'Blocking is off') + '</b>'
       + '<small>' + (c.on
            ? 'Your rules stand in front of the apps and sites in them.'
            : 'Nothing is blocked and nothing is watched.') + '</small>'
       + '</button>';

    /* A change waiting out the lock is the first thing said, because every
       control below is showing what it will be, not what it is. */
    if(c.pending){
      const at = new Date(Number(c.pending.at));
      h += '<div class="blk-pending"><span><b>A change is waiting</b><small>It comes through at '
         + esc(at.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}))
         + '. What you see below is what it will be.</small></span>'
         + '<button class="blk-go" id="blk-cancel">Cancel it</button></div>';
      clearTimeout(GUARD_DUE_T);
      GUARD_DUE_T = setTimeout(()=>{ try{ Guard.refresh(); }catch(e){} },
        Math.max(1000, Math.min(2147483000, Number(c.pending.at) - Date.now() + 1000)));
    }

    /* The honest line. Switched on with a permission missing is the state this
       whole page exists to make visible. */
    const missing = GUARD_PERMS.filter(p=>!Guard.status[p.id]);
    if(c.on && missing.length){
      h += '<p class="blk-warn">Nothing is being blocked yet, '
         + esc(missing.map(m=>m.name.toLowerCase()).join(' and ')) + ' still to go.</p>';
    }

    h += '<p class="q-sec">Permissions</p>';
    h += '<div class="blk-perms">' + GUARD_PERMS.map(p=>{
      const ok = !!Guard.status[p.id];
      return '<div class="blk-perm' + (ok ? ' ok' : '') + '">'
        + '<span class="blk-tick">' + (ok ? '&#10003;' : '') + '</span>'
        + '<span class="blk-perm-t"><b>' + esc(p.name) + '</b>'
        + '<small>' + esc(p.why) + '</small></span>'
        + (ok ? '<span class="blk-done">On</span>'
              : '<button class="blk-go" data-perm="' + p.id + '">' + esc(p.act) + '</button>')
        + '</div>';
    }).join('') + '</div>';

    h += '<p class="q-sec">Rules</p>';
    if(!w.rules.length){
      h += '<p class="blk-note">No rules yet. A rule is a group of apps and websites with one set of settings. Make one per app for per-app settings.</p>';
    }else{
      h += '<div class="blk-rules">' + w.rules.map(r=>{
        const icons = r.apps.slice(0, 5).map(id=>guardAppIcon(id)
          ? '<img src="' + esc(guardAppIcon(id)) + '" alt="">' : '<span class="blk-noicon"></span>').join('')
          + (r.sites.length ? '<span class="blk-site-ic">www</span>' : '');
        return '<button class="blk-rule' + (r.off ? ' off' : '') + '" data-rule="' + esc(r.id) + '">'
          + '<span class="blk-rule-ic">' + icons + '</span>'
          + '<span class="blk-rule-t"><b>' + esc(guardRuleTitle(r)) + (r.off ? ' <i>off</i>' : '') + '</b>'
          + '<small>' + esc(guardRuleLine(r)) + '</small></span>'
          + '<span class="blk-rule-go" aria-hidden="true">›</span></button>';
      }).join('') + '</div>';
    }
    h += '<button class="blk-pick" id="blk-add">Add a rule</button>';

    h += guardTodayHtml();
    h += guardLockHtml();
    h += guardGrayHtml();

    box.innerHTML = h;
    guardWire();
    if($('block-rule-overlay') && !$('block-rule-overlay').classList.contains('hide')) guardPaintRule();
  }

  /** Today, this week, and the streak. */
  function guardTodayHtml(){
    const cfg = guardWorking();
    const today = guardToday();
    const day = Guard.usage[today] || {};
    let h = '<p class="q-sec">Today</p>';
    if(!cfg.rules.length) return h + '<p class="blk-note">Nothing to count until there is a rule.</p>';

    let secs = 0, shown = 0, closed = 0, through = 0;
    const seen = {};
    for(const r of cfg.rules){
      for(const t of guardTargets(r)){
        if(seen[t]) continue;
        seen[t] = 1;
        const x = day[t] || {};
        secs += x.secs || 0; shown += x.shown || 0; closed += x.closed || 0; through += x.through || 0;
      }
    }
    h += '<div class="blk-tot">'
       + '<span><b>' + Math.round(secs / 60) + '</b>min in them</span>'
       + '<span><b>' + shown + '</b>stopped</span>'
       + '<span><b>' + closed + '</b>left it</span>'
       + '</div>';

    /* Busiest first. A list in the order the rules were made is a list nobody
       reads past the first line, and the first line is the point. */
    /* **Two different numbers used to share the word "opens".**

       `through` is how many times the way through was taken, which is what a
       daily limit counts against. `opens` is how many times you arrived at
       something the rule covers at all — including the times you were stopped,
       and the times the rule was not in force. The row showed `through` under
       the word "opens", so a rule you reached for thirty times and were
       stopped by every time read as nought, which is the opposite of what
       happened. Both are here now and they are named apart. */
    const rows = cfg.rules.map(r=>({r,
      secs:guardSum(day, r, 'secs'),
      opens:guardSum(day, r, 'opens'),
      through:guardSum(day, r, 'through'),
      left:guardSum(day, r, 'closed')}))
      .filter(x=>x.secs >= 60 || x.opens || x.through || x.left)
      .sort((a, b)=>(b.secs - a.secs) || (b.opens - a.opens));
    if(rows.length){
      h += '<div class="blk-rows">' + rows.map(x=>{
        const mins = Math.round(x.secs / 60);
        const bits = [x.r.minutes ? T('{n} of {max} min', {n:mins, max:x.r.minutes}) : guardLen(x.secs)];
        if(x.opens) bits.push(Tn('{n} open', '{n} opens', x.opens));
        if(x.r.opens) bits.push(T('{n} of {max} through', {n:x.through, max:x.r.opens}));
        if(x.left) bits.push(T('left it {n}', {n:x.left}));
        return '<div class="blk-row"><span>' + esc(guardRuleTitle(x.r)) + '</span><i>' + esc(bits.join(' · ')) + '</i></div>';
      }).join('') + '</div>';
    }

    const week = guardWeek(Guard.usage, today, cfg);
    const most = Math.max(60, ...week.map(d=>d.secs));
    const names = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    h += '<div class="blk-week" aria-label="The last seven days">' + week.map(d=>{
      const p = d.key.split('-').map(Number);
      const dow = new Date(p[0], p[1] - 1, p[2]).getDay();
      const pct = d.secs ? Math.max(4, Math.round(d.secs / most * 100)) : 0;
      return '<span class="blk-bar' + (d.key === today ? ' now' : '') + '" title="' + esc(d.key + ' · ' + Math.round(d.secs / 60) + ' min') + '">'
        + '<i style="height:' + pct + '%"></i><em>' + names[dow] + '</em></span>';
    }).join('') + '</div>';

    if(guardHasLimits(cfg)){
      const n = guardStreak(Guard.usage, today, cfg);
      h += '<p class="blk-streak">' + (n
        ? '<b>' + n + (n === 1 ? ' day' : ' days') + '</b> in a row inside your limits.'
        : 'No days inside your limits yet.') + '</p>';
    }
    return h;
  }

  /* **The lock.** Offered only once there is something to lock and the
     permissions are done, because while locked, the Settings screens those
     permissions live on are among the ones blocked — locking first would lock
     you out of finishing the setup. */
  function guardLockHtml(){
    const c = Guard.cfg;
    const lock = c.lock;
    const ready = c.on && guardWorking().rules.length && GUARD_PERMS.every(p=>Guard.status[p.id]);
    let h = '<p class="q-sec">Lock</p>';
    h += '<button class="blk-switch' + (lock.on ? ' on' : '') + '" id="blk-lock"' + (ready || lock.on ? '' : ' disabled') + '>'
       + '<span class="blk-knob"></span>'
       + '<b>' + (lock.on ? 'Locked' : 'Lock blocking') + '</b>'
       + '<small>' + (lock.on
            ? 'Every change waits ' + lock.delay + ' min before it happens, and the Settings screens that would switch blocking off are blocked too.'
            : ready
              ? 'Every change, including unlocking, waits before it happens.'
              : 'Turn blocking on, make a rule and finish the permissions first.') + '</small>'
       + '</button>';
    h += '<p class="blk-sub">How long a change waits</p>';
    h += '<div class="blk-chips">' + GUARD_LOCK_DELAYS.map(m=>
      '<button class="blk-opt' + (guardWorking().lock.delay === m ? ' on' : '') + '" data-lockdelay="' + m + '">'
      + (m < 60 ? m + ' min' : (m / 60) + (m === 60 ? ' hour' : ' hours')) + '</button>').join('') + '</div>';
    if(lock.on){
      const admin = !!Guard.status.admin;
      h += '<div class="blk-perms"><div class="blk-perm' + (admin ? ' ok' : '') + '">'
         + '<span class="blk-tick">' + (admin ? '&#10003;' : '') + '</span>'
         + '<span class="blk-perm-t"><b>Uninstall protection</b>'
         + '<small>Makes the app a device admin with no powers, so it cannot be uninstalled while locked. Removed again when the lock comes off.</small></span>'
         + (admin ? '<span class="blk-done">On</span>' : '<button class="blk-go" id="blk-admin">Turn on</button>')
         + '</div></div>';
    }
    return h;
  }

  function guardGrayHtml(){
    let h = '<p class="q-sec">Grayscale</p>';
    if(!Guard.status.gray){
      return h + '<p class="blk-note">Drains the colour out of blocked apps while you are in them. Android only lets'
        + ' an app do this after a one-time grant from a computer:</p>'
        + '<code class="blk-code">adb shell pm grant app.focussimulator.mobile android.permission.WRITE_SECURE_SETTINGS</code>';
    }
    const on = !!guardWorking().gray;
    return h + '<button class="blk-switch' + (on ? ' on' : '') + '" id="blk-gray">'
      + '<span class="blk-knob"></span><b>' + (on ? 'Blocked apps are gray' : 'Gray out blocked apps') + '</b>'
      + '<small>The screen goes black and white while a blocked app or site is in front, and comes back after.</small></button>';
  }

  function guardWire(){
    const box = $('block-body');
    if(!box) return;
    const on = box.querySelector('#blk-on');
    if(on) on.onclick = ()=>{
      guardChange(c=>{ c.on = !c.on; });
      try{ blip(); }catch(e){}
      /* Switching it on is the moment to ask for the one permission that *can*
         be asked for with a prompt. The other two are a walk to Settings and
         are not worth throwing somebody into uninvited. */
      if(guardWorking().on && !Guard.status.notifications){
        const api = guardApi();
        if(api){ try{ api.requestNotifications().then(()=>Guard.refresh()); }catch(e){} }
      }
    };
    const cancel = box.querySelector('#blk-cancel');
    if(cancel) cancel.onclick = ()=>guardCancelPending();
    box.querySelectorAll('[data-perm]').forEach(b=>{
      b.onclick = ()=>{
        const api = guardApi();
        if(!api) return;
        if(b.dataset.perm === 'notifications'){
          try{ api.requestNotifications().then(()=>Guard.refresh()); }catch(e){}
          return;
        }
        try{ api.openSettings({which:b.dataset.perm}); }catch(e){}
      };
    });
    box.querySelectorAll('[data-rule]').forEach(b=>{
      b.onclick = ()=>guardOpenRule(b.dataset.rule);
    });
    const add = box.querySelector('#blk-add');
    if(add) add.onclick = ()=>{
      const r = guardRuleClean({});
      guardChange(c=>{ c.rules.push(r); });
      guardOpenRule(r.id);
    };
    const lock = box.querySelector('#blk-lock');
    if(lock) lock.onclick = ()=>{
      if(lock.disabled) return;
      /* Locking is immediate; unlocking waits, like every other change. So the
         moment of locking is asked about, once. */
      if(!Guard.cfg.lock.on){
        askConfirm('Lock blocking?',
          'From now on every change, including unlocking, waits ' + guardWorking().lock.delay
          + ' min before it happens.', 'Lock it', ()=>guardChange(c=>{ c.lock.on = true; }));
        return;
      }
      guardChange(c=>{ c.lock.on = false; });
    };
    box.querySelectorAll('[data-lockdelay]').forEach(b=>{
      b.onclick = ()=>guardChange(c=>{ c.lock.delay = Number(b.dataset.lockdelay); });
    });
    const admin = box.querySelector('#blk-admin');
    if(admin) admin.onclick = ()=>{
      const api = guardApi();
      if(api && api.requestAdmin){ try{ api.requestAdmin(); }catch(e){} }
    };
    const gray = box.querySelector('#blk-gray');
    if(gray) gray.onclick = ()=>guardChange(c=>{ c.gray = !c.gray; });
  }

  /* ---------------- a rule ---------------- */

  function guardRule(){
    return guardWorking().rules.find(r=>r.id === Guard.editing) || null;
  }
  /** Change the rule being edited, through the lock like everything else. */
  function guardEditRule(fn){
    const id = Guard.editing;
    guardChange(c=>{
      const r = c.rules.find(x=>x.id === id);
      if(r) fn(r, c);
    });
  }

  function guardOpenRule(id){
    Guard.editing = id;
    const el = $('block-rule-overlay');
    if(!el) return;
    el.classList.remove('hide');
    guardLoadApps();
    guardPaintRule();
  }
  function guardCloseRule(){
    const el = $('block-rule-overlay');
    if(el) el.classList.add('hide');
    Guard.editing = '';
    guardPaint();
  }

  function guardToggles(key, list, now){
    return '<div class="drawer-toggles">' + list.map(x=>
      '<button class="toggle' + (now === x.id ? ' on' : '') + '" data-' + key + '="' + x.id + '">'
      + '<span class="dot"></span>' + esc(x.n) + '</button>').join('') + '</div>';
  }
  function guardSwitch(id, on, title, why){
    return '<button class="blk-switch' + (on ? ' on' : '') + '" id="' + id + '">'
      + '<span class="blk-knob"></span><b>' + esc(title) + '</b><small>' + esc(why) + '</small></button>';
  }

  /* **A rule is sixteen settings and it used to be sixteen headings.**

     Name, on or off, apps, websites, when, how hard, the pause, the question
     it asks, what you have to do first, how long it opens for, quick looks,
     two limits, what happens at a limit, the cooldown, the odds, and delete —
     one flat column of them, every one as loud as the next. Everything a rule
     can do was on the screen at once, so nothing was, and the four settings
     that matter were somewhere in the middle of it.

     Four drawers instead. The first three are open because they are what a
     rule *is*: what it covers, when it is in force, and how hard it stops you.
     The rest is how you get past it, which is worth having and is not worth
     reading every time, so it starts shut.

     The same `<details>` the quote packs use, so the page behaves the one way
     throughout rather than inventing a second kind of fold. */
  function guardSec(title, open, body){
    if(!body) return '';
    return '<details class="blk-sec"' + (open ? ' open' : '') + '>'
      + '<summary><b>' + esc(T(title)) + '</b></summary>'
      + '<div class="blk-sec-body">' + body + '</div></details>';
  }

  function guardPaintRule(){
    const box = $('block-rule-body');
    if(!box) return;
    const r = guardRule();
    if(!r){ box.innerHTML = '<p class="blk-note">This rule is gone.</p>'; return; }
    if($('block-rule-title')) $('block-rule-title').textContent = guardRuleTitle(r);
    let h = '';

    if(guardLocked(Guard.cfg)){
      h += '<p class="blk-warn">Blocking is locked. Changes here wait ' + Guard.cfg.lock.delay + ' min before they happen.</p>';
    }

    /* ---- what it covers ---- */
    let cover = '<p class="blk-lab">Name</p>'
      + '<input class="blk-find blk-field" id="blr-name" maxlength="40" placeholder="' + esc(guardRuleTitle(Object.assign({}, r, {name:''}))) + '" value="' + esc(r.name) + '">'
      + guardSwitch('blr-off', !r.off, r.off ? 'This rule is off' : 'This rule is on',
        r.off ? 'Nothing in it is blocked.' : 'Everything in it is blocked when it is in force.')
      + '<p class="blk-lab">Apps</p>';
    if(r.apps.length){
      cover += '<div class="blk-chosen">' + r.apps.map(id=>
        '<button class="blk-chip" data-rdrop-app="' + esc(id) + '" title="Take it out of this rule">'
        + (guardAppIcon(id) ? '<img src="' + esc(guardAppIcon(id)) + '" alt="">' : '')
        + '<span>' + esc(guardAppName(id)) + '</span><i>&times;</i></button>').join('') + '</div>';
    }
    cover += '<button class="blk-pick" id="blr-pick">' + (Guard.appsBusy ? 'Reading your apps…' : 'Choose apps') + '</button>'
      + '<p class="blk-lab">Websites</p>';
    if(r.sites.length){
      cover += '<div class="blk-chosen">' + r.sites.map(s=>
        '<button class="blk-chip" data-rdrop-site="' + esc(s) + '" title="Take it out of this rule">'
        + '<span>' + esc(s) + '</span><i>&times;</i></button>').join('') + '</div>';
    }
    cover += '<div class="blk-addsite"><input class="blk-find blk-field" id="blr-site" placeholder="youtube.com" autocomplete="off" autocapitalize="off" spellcheck="false">'
      + '<button class="blk-go" id="blr-site-add">Add</button></div>'
      + '<p class="blk-sub">Covers the site and everything under it. Works in Chrome, Firefox, Samsung Internet, Edge, Brave, Opera and DuckDuckGo.</p>';
    h += guardSec('What it covers', true, cover);

    /* ---- when ---- */
    let force = guardToggles('rwhen', GUARD_WHEN, r.when);
    if(r.when === 'schedule'){
      force += '<div class="blk-days">' + GUARD_DAYS.map(d=>
        '<button class="blk-day' + (r.days.indexOf(String(d[0])) >= 0 ? ' on' : '') + '" data-rday="' + d[0] + '">' + d[1] + '</button>').join('') + '</div>'
        + '<div class="blk-times"><label>From <input type="time" id="blr-from" value="' + esc(r.from) + '"></label>'
        + '<label>to <input type="time" id="blr-to" value="' + esc(r.to) + '"></label></div>'
        + '<p class="blk-sub">An end earlier than the start runs overnight. The same time twice is all day.</p>';
    }
    h += guardSec('When it is in force', true, force);

    /* ---- how hard ---- */
    let hard = guardSwitch('blr-hard', r.hard, 'Block outright',
      'No way through at all while this rule is in force. Just the screen and Close.');
    if(!r.hard){
      hard += '<p class="blk-lab">The pause</p>' + guardSteps(r, ['pause', 'step'])
        + '<p class="blk-lab">What it asks you</p>'
        + '<input class="blk-find blk-field" id="blr-prompt" maxlength="120" placeholder="Take a breath." value="' + esc(r.prompt) + '">';
    }
    h += guardSec('How hard it stops you', true, hard);

    /* ---- and the rest, which is how you get past it ---- */
    if(!r.hard){
      const through = '<p class="blk-lab">Before it opens</p>' + guardToggles('rtask', GUARD_TASKS, r.task)
        + '<p class="blk-lab">Open it for</p><div class="blk-chips">' + GUARD_OPEN_CHOICES.map(m=>
          '<button class="blk-opt' + (r.open.indexOf(m) >= 0 ? ' on' : '') + '" data-ropen="' + m + '">' + m + ' min</button>').join('') + '</div>'
        + guardSwitch('blr-quick', r.quick, 'Quick looks',
          'Three one-minute looks a day that do not count as opens, for checking one message.')
        + '<p class="blk-lab">Unlock odds</p><div class="blk-chips">' + GUARD_ODDS.map(n=>
          '<button class="blk-opt' + (r.odds === n ? ' on' : '') + '" data-rodds="' + n + '">' + n + '%</button>').join('') + '</div>'
        + '<p class="blk-sub">The chance the way through is offered at all. When it is not, it stays shut for a minute.</p>';
      h += guardSec('Getting through it', false, through);

      const caps = guardSteps(r, ['opens', 'minutes'])
        + '<p class="blk-lab">At a limit</p>'
        + guardToggles('rafter', [{id:'block', n:'Block until tomorrow'}, {id:'pause', n:'Keep pausing'}], r.after)
        + guardSteps(r, ['cooldown']);
      h += guardSec('Daily limits', false, caps);
    }

    /* ---- what this rule actually caught today ----

       The summary on the blocking screen adds every rule together, which
       answers "how is this going" and not "is this rule earning its place".
       One app in a rule of six can be all of its minutes, and until you can
       see which one, the only way to find out is to take apps out one at a
       time for a week.

       Counted whether or not the rule stopped you: arriving at something it
       covers is the thing worth knowing, and the times it was not in force are
       exactly the times a rule's hours are set wrong. */
    {
      const used = guardRuleUse(Guard.usage[guardToday()] || {}, r);
      const any = used.some(u=>u.secs || u.opens || u.shown);
      let seen = '';
      if(!any){
        seen = '<p class="blk-note">' + T('Nothing in this rule has been opened today.') + '</p>';
      }else{
        seen = '<div class="blk-rows">' + used.filter(u=>u.secs || u.opens || u.shown).map(u=>{
          const site = u.t.indexOf('site:') === 0;
          const name = site ? u.t.slice(5) : guardAppName(u.t);
          const bits = [guardLen(u.secs)];
          if(u.opens) bits.push(Tn('{n} open', '{n} opens', u.opens));
          if(u.shown) bits.push(Tn('stopped {n} time', 'stopped {n} times', u.shown));
          return '<div class="blk-row"><span translate="no">' + esc(name) + '</span>'
            + '<i>' + esc(bits.join(' · ')) + '</i></div>';
        }).join('') + '</div>';
        const tot = used.reduce((a, u)=>({secs:a.secs + u.secs, opens:a.opens + u.opens}), {secs:0, opens:0});
        seen += '<p class="blk-sub">' + esc(T('{t} across this rule, {n}.',
          {t:guardLen(tot.secs), n:Tn('{n} open', '{n} opens', tot.opens)})) + '</p>';
      }
      h += guardSec('Today, in this rule', false, seen);
    }

    h += '<button class="blk-delete" id="blr-delete">Delete this rule</button>';
    box.innerHTML = h;
    guardWireRule();
  }

  function guardSteps(r, keys){
    return GUARD_RULE_NUMS.filter(n=>keys.indexOf(n.k) >= 0).map(n=>
      '<div class="blk-step"><span><b>' + esc(n.n) + '</b><small>' + esc(n.why) + '</small></span>'
      + '<span class="blk-pm">'
      + '<button data-rstep="' + n.k + '" data-by="-1" aria-label="Less"' + (r[n.k] <= n.lo ? ' disabled' : '') + '>&minus;</button>'
      + '<b>' + r[n.k] + (n.unit ? '<i>' + n.unit + '</i>' : '') + '</b>'
      + '<button data-rstep="' + n.k + '" data-by="1" aria-label="More"' + (r[n.k] >= n.hi ? ' disabled' : '') + '>+</button>'
      + '</span></div>').join('');
  }

  function guardWireRule(){
    const box = $('block-rule-body');
    if(!box) return;
    const on = (sel, ev, fn)=>{ const el = box.querySelector(sel); if(el) el[ev] = fn; };

    /* Text commits on change rather than on every key: under the lock every
       change restarts the wait, and a wait restarted by each letter of a name
       is a wait that never ends. */
    on('#blr-name', 'onchange', (e)=>guardEditRule(r=>{ r.name = e.target.value; }));
    on('#blr-prompt', 'onchange', (e)=>guardEditRule(r=>{ r.prompt = e.target.value; }));
    on('#blr-from', 'onchange', (e)=>guardEditRule(r=>{ r.from = e.target.value; }));
    on('#blr-to', 'onchange', (e)=>guardEditRule(r=>{ r.to = e.target.value; }));
    on('#blr-off', 'onclick', ()=>guardEditRule(r=>{ r.off = !r.off; }));
    on('#blr-hard', 'onclick', ()=>guardEditRule(r=>{ r.hard = !r.hard; }));
    on('#blr-quick', 'onclick', ()=>guardEditRule(r=>{ r.quick = !r.quick; }));
    on('#blr-pick', 'onclick', ()=>{ guardLoadApps(); guardOpenPicker(); });

    const addSite = ()=>{
      const inp = box.querySelector('#blr-site');
      const s = guardSite(inp && inp.value);
      if(!s){ try{ toast('That is not a website address'); }catch(e){} return; }
      guardEditRule(r=>{ if(r.sites.indexOf(s) < 0) r.sites.push(s); });
    };
    on('#blr-site-add', 'onclick', addSite);
    on('#blr-site', 'onkeydown', (e)=>{ if(e.key === 'Enter'){ e.preventDefault(); addSite(); } });

    box.querySelectorAll('[data-rdrop-app]').forEach(b=>{
      b.onclick = ()=>guardEditRule(r=>{ r.apps = r.apps.filter(x=>x !== b.dataset.rdropApp); });
    });
    box.querySelectorAll('[data-rdrop-site]').forEach(b=>{
      b.onclick = ()=>guardEditRule(r=>{ r.sites = r.sites.filter(x=>x !== b.dataset.rdropSite); });
    });
    box.querySelectorAll('[data-rwhen]').forEach(b=>{
      b.onclick = ()=>guardEditRule(r=>{ r.when = b.dataset.rwhen; });
    });
    box.querySelectorAll('[data-rtask]').forEach(b=>{
      b.onclick = ()=>guardEditRule(r=>{ r.task = b.dataset.rtask; });
    });
    box.querySelectorAll('[data-rafter]').forEach(b=>{
      b.onclick = ()=>guardEditRule(r=>{ r.after = b.dataset.rafter; });
    });
    box.querySelectorAll('[data-rday]').forEach(b=>{
      b.onclick = ()=>guardEditRule(r=>{
        const d = b.dataset.rday;
        r.days = r.days.indexOf(d) >= 0 ? r.days.replace(d, '') : r.days + d;
      });
    });
    box.querySelectorAll('[data-ropen]').forEach(b=>{
      b.onclick = ()=>guardEditRule(r=>{
        const m = Number(b.dataset.ropen);
        const i = r.open.indexOf(m);
        /* At least one choice always stays: a rule with no way to say how long
           is a rule with no way through, and that is what "Block outright" is
           for. */
        if(i >= 0){ if(r.open.length > 1) r.open.splice(i, 1); }
        else r.open.push(m);
      });
    });
    box.querySelectorAll('[data-rodds]').forEach(b=>{
      b.onclick = ()=>guardEditRule(r=>{ r.odds = Number(b.dataset.rodds); });
    });
    box.querySelectorAll('[data-rstep]').forEach(b=>{
      b.onclick = ()=>{
        const row = GUARD_RULE_NUMS.find(n=>n.k === b.dataset.rstep);
        if(!row) return;
        guardEditRule(r=>{
          /* Snapped to the step, so a pause of 3 carried over from the first
             version goes to 5 and 0 rather than to 8 and -2. */
          const next = Math.round((r[row.k] + row.by * Number(b.dataset.by)) / row.by) * row.by;
          r[row.k] = Math.max(row.lo, Math.min(row.hi, next));
        });
      };
    });
    on('#blr-delete', 'onclick', ()=>{
      const r = guardRule();
      if(!r) return;
      askConfirm('Delete “' + guardRuleTitle(r) + '”?',
        'Everything in it stops being blocked' + (guardLocked(Guard.cfg) ? ' once the lock lets the change through.' : '.'),
        'Delete', ()=>{
          const id = r.id;
          guardChange(c=>{ c.rules = c.rules.filter(x=>x.id !== id); });
          guardCloseRule();
        });
    });
  }

  /* ---------------- the picker ----------------
     Its own screen rather than a list under the settings. Eighty apps inline is
     a page whose settings are at the top and whose bottom is unreachable, and
     the whole reason to have icons is that it is a screen you scan rather than
     read. It picks for the rule that is open. */
  function guardOpenPicker(){
    const el = $('block-apps-overlay');
    if(!el) return;
    el.classList.remove('hide');
    guardPaintPicker();
    const f = $('blk-find');
    if(f) f.value = Guard.filter || '';
  }
  function guardClosePicker(){
    const el = $('block-apps-overlay');
    if(el) el.classList.add('hide');
    guardPaint();
  }

  function guardPaintPicker(){
    const box = $('block-apps-list');
    if(!box) return;
    if(Guard.appsBusy && !Guard.apps.length){
      box.innerHTML = '<p class="blk-note">Reading your apps…</p>';
      return;
    }
    if(!Guard.apps.length){
      box.innerHTML = '<p class="blk-note">No apps came back. This is a phone feature.</p>';
      return;
    }
    const rule = guardRule();
    const chosen = rule ? rule.apps : [];
    /* Where an app already sits in another rule, it says which. The first rule
       that names an app is the one that decides for it, so a second one would
       quietly do nothing — which is worth knowing before ticking it. */
    const elsewhere = {};
    for(const r of guardWorking().rules){
      if(rule && r.id === rule.id) continue;
      for(const id of r.apps) if(!elsewhere[id]) elsewhere[id] = guardRuleTitle(r);
    }
    const q = (Guard.filter || '').trim().toLowerCase();
    /* Chosen first, then everything else. A list you have picked six things out
       of is a list where the six are the ones you want to see. */
    const list = Guard.apps.slice().sort((a, b)=>{
      const A = chosen.indexOf(a.id) >= 0 ? 0 : 1;
      const B = chosen.indexOf(b.id) >= 0 ? 0 : 1;
      if(A !== B) return A - B;
      return String(a.name).localeCompare(String(b.name));
    }).filter(a=>!q || String(a.name).toLowerCase().indexOf(q) >= 0);

    if(!list.length){ box.innerHTML = '<p class="blk-note">Nothing matches that.</p>'; return; }
    box.innerHTML = list.map(a=>{
      const on = chosen.indexOf(a.id) >= 0;
      return '<button class="blk-app' + (on ? ' on' : '') + '" data-app="' + esc(a.id) + '">'
        + (a.icon ? '<img src="' + esc(a.icon) + '" alt="">' : '<span class="blk-noicon"></span>')
        + '<span class="blk-app-n">' + esc(a.name)
        + (elsewhere[a.id] ? '<small>Already in ' + esc(elsewhere[a.id]) + '</small>' : '') + '</span>'
        + '<span class="blk-box">' + (on ? '&#10003;' : '') + '</span>'
        + '</button>';
    }).join('');
    box.querySelectorAll('[data-app]').forEach(b=>{
      b.onclick = ()=>{
        const id = b.dataset.app;
        const was = (guardRule() || {apps:[]}).apps.indexOf(id) >= 0;
        guardEditRule(r=>{
          if(was) r.apps = r.apps.filter(x=>x !== id); else r.apps.push(id);
        });
        /* Repaint this row in place rather than the list: re-sorting under a
           thumb moves the next thing you were about to tap. The order settles
           the next time the picker is opened. */
        b.classList.toggle('on', !was);
        b.querySelector('.blk-box').innerHTML = !was ? '&#10003;' : '';
        try{ blip(); }catch(e){}
      };
    });
  }

  if($('block-close')) $('block-close').onclick = ()=>guardClose();
  if($('block-rule-close')) $('block-rule-close').onclick = ()=>guardCloseRule();
  if($('block-apps-close')) $('block-apps-close').onclick = ()=>guardClosePicker();
  if($('blk-find')) $('blk-find').oninput = (e)=>{
    Guard.filter = e.target.value || '';
    guardPaintPicker();
  };
  /* The menu row only exists on a build that can do any of this. Hidden rather
     than absent from the markup, so there is one place the row is written and
     one rule about when it shows.

     **Toggled, not hidden.** It ships hidden — a row for a feature the build
     cannot perform is the menu promising something and then explaining that it
     cannot — and the first version of this line only ever hid it *again*. So it
     was correct on every platform except the one platform it is for, where it
     never appeared at all and the whole feature was unreachable from the menu.
     Nothing failed and nothing logged; the check that found it was passing for
     the wrong reason until the fix was broken on purpose. */
  function guardMenuRow(){
    const row = $('d-block');
    if(!row) return;
    row.classList.toggle('hide', !guardHasPlugin());
  }
  if($('d-block')){
    $('d-block').onclick = ()=>{ closeDrawer(); guardOpen(); };
    guardMenuRow();
  }
