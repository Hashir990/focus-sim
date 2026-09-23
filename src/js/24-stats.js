  /* --- stats dashboard ---
     Reads the same LOG array the calendar uses (focus_log). Adds no new storage. */
  const Stats = {
    /* The buddy and the account panel moved to their own page, so this no
       longer paints them — it is the totals and the shelf, and nothing else. */
    open(){ $('stats-overlay').classList.remove('hide'); this.render(); Embers.render(); },
    close(){ $('stats-overlay').classList.add('hide'); },

    _compute(){
      const totalSecs = LOG.reduce((n,r)=>n + (r.secs||0), 0);
      const sessions = LOG.length;

      // sessions and seconds per calendar day
      const byDay = {};
      for(const r of LOG){
        const k = r.day || dayKey(r.ts);
        if(!byDay[k]) byDay[k] = {secs:0, n:0};
        byDay[k].secs += r.secs||0;
        byDay[k].n++;
      }

      // current streak: consecutive days ending today (or yesterday, if today is
      // still empty — you shouldn't lose a streak just because it's morning)
      const d = new Date();
      let cursor = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      let streak = 0;
      if(!byDay[dayKey(cursor.getTime())]) cursor.setDate(cursor.getDate()-1);
      while(byDay[dayKey(cursor.getTime())]){
        streak++;
        cursor.setDate(cursor.getDate()-1);
      }

      // best single day
      let bestDay = null, bestSecs = 0;
      for(const k in byDay) if(byDay[k].secs > bestSecs){ bestSecs = byDay[k].secs; bestDay = k; }

      /* What a day of yours looks like, averaged over the days you actually
         did something. Divided by active days rather than by days since you
         started: a fortnight off shouldn't rewrite what your working day looks
         like, and "an hour a day" is a claim about the days you sat down. */
      const activeDays = Object.keys(byDay).length;
      const perDay = activeDays ? Math.round(totalSecs / activeDays) : 0;

      // last 14 days, oldest first
      const recent = [];
      for(let i=13;i>=0;i--){
        const dt = new Date(); dt.setDate(dt.getDate()-i);
        const k = dayKey(dt.getTime());
        recent.push({key:k, label:String(dt.getDate()), secs:(byDay[k]||{}).secs||0});
      }

      // Time shared with other people. A session with two others counts fully
      // for both — you really did focus alongside each of them — so these don't
      // sum to `totalSecs` and aren't meant to.
      const withWho = {};
      let sharedSecs = 0;
      for(const r of LOG){
        if(!r.with || !r.with.length) continue;
        sharedSecs += r.secs||0;
        for(const name of r.with){
          if(!withWho[name]) withWho[name] = {secs:0, n:0};
          withWho[name].secs += r.secs||0;
          withWho[name].n++;
        }
      }
      const company = Object.keys(withWho)
        .map(name=>({name, secs:withWho[name].secs, n:withWho[name].n}))
        .sort((a,b)=>b.secs - a.secs);

      return {totalSecs, sessions, streak, bestDay, bestSecs, perDay, recent,
              days:activeDays, company, sharedSecs};
    },

    render(){
      const s = this._compute();
      const body = $('stats-body');

      if(!s.sessions){
        body.innerHTML = '<p class="q-empty">No finished sessions yet. Complete a focus block '
          + 'and this fills in — total time, streaks, and your best hours.</p>'
          + this._arcade();
        return;
      }

      const max = Math.max.apply(null, s.recent.map(r=>r.secs).concat([1]));
      /* Each bar carries its own day and total in data attributes, so pointing
         at one can say what it is. `title` alone was no use on a phone, which
         is where most of these are read. */
      const bars = s.recent.map(r=>{
        const h = r.secs ? Math.max(4, Math.round(r.secs/max*100)) : 0;
        const when = new Date(r.key+'T00:00:00')
          .toLocaleDateString(langLocale(),{weekday:'short', month:'short', day:'numeric'});
        const much = r.secs ? fmtDur(r.secs) : T('nothing');
        return '<button type="button" class="sbar" data-when="'+esc(when)+'" data-much="'+esc(much)+'"'
          + ' title="'+esc(when+' · '+much)+'">'
          + '<div class="sbar-track"><div class="sbar-fill'+(r.secs?'':' empty')+'" style="height:'+h+'%"></div></div>'
          + '<span>'+esc(r.label)+'</span></button>';
      }).join('');

      body.innerHTML =
        '<div class="stat-grid">'
        + this._card(fmtDur(s.totalSecs), 'total focused')
        /* The label under a number agrees with it — "1 session", "5 сессий" —
           so it is counted like any other string, without the number in it. */
        + this._card(String(s.sessions), Tn('session', 'sessions', s.sessions))
        + this._card(Tn('{n} day', '{n} days', s.streak), 'current streak')
        + this._card(String(s.days), Tn('active day', 'active days', s.days))
        + '</div>'
        + '<p class="q-sec">Last 14 days</p>'
        + '<div class="sbars">'+bars+'</div>'
        + '<p class="sbar-read" id="sbar-read">Tap a bar for that day</p>'
        + '<div class="stat-lines">'
        + '<div><span>Best day</span><b>'+(s.bestDay?esc(s.bestDay)+' · '+fmtDur(s.bestSecs):'—')+'</b></div>'
        + '<div><span>Average day</span><b>'+fmtDur(s.perDay)+'</b></div>'
        + '<div><span>Average session</span><b>'+fmtDur(Math.round(s.totalSecs/s.sessions))+'</b></div>'
        + '</div>'
        + this._company(s)
        + this._arcade();

      this._wireBars();
    },

    /* One line under the chart that says what you are pointing at. A tooltip
       does this on a desktop and does nothing at all on a phone, which is
       where most of this is read — so the readout is part of the page, and
       hovering and tapping both drive it. */
    _wireBars(){
      const read = $('sbar-read');
      if(!read) return;
      const say = (b)=>{
        read.textContent = b ? (b.dataset.when + ' · ' + b.dataset.much) : T('Tap a bar for that day');
        read.classList.toggle('on', !!b);
      };
      $('stats-body').querySelectorAll('.sbar').forEach(b=>{
        b.onmouseenter = ()=>say(b);
        b.onmouseleave = ()=>{ if(!b.classList.contains('on')) say(null); };
        b.onclick = ()=>{
          const was = b.classList.contains('on');
          $('stats-body').querySelectorAll('.sbar.on').forEach(x=>x.classList.remove('on'));
          if(was){ say(null); return; }
          b.classList.add('on');
          say(b);
        };
      });
    },

    /** Who you've focused alongside, longest first. Absent until it has content. */
    _company(s){
      if(!s.company.length) return '';
      const top = s.company[0];
      const max = top.secs || 1;
      return '<p class="q-sec">Focused alongside</p>'
        + '<p class="stat-note">'+esc(T('{d} of your total was shared with somebody.', {d:fmtDur(s.sharedSecs)}))+'</p>'
        + '<div class="stat-company">'
        + s.company.slice(0,6).map(c=>
            '<div class="scomp">'
            + '<span class="scomp-name" translate="no">'+esc(c.name)+'</span>'
            + '<span class="scomp-bar"><i style="width:'+Math.max(4, Math.round(c.secs/max*100))+'%"></i></span>'
            + '<b>'+fmtDur(c.secs)+'</b>'
            + '</div>').join('')
        + '</div>';
    },

    /** Time in the rest arcade, longest game first, in the same rows as the
        people above it. Absent until there is a minute of it: a heading over
        nothing reads as a section that failed to load. The clock and what it
        refuses to count are in 09c-playtime.js. */
    _arcade(){
      let games = [];
      try{ games = playTotals(); }catch(e){}
      const total = games.reduce((n, g)=>n + g.secs, 0);
      if(total < 60) return '';
      const shown = games.filter(g=>g.secs >= 30);
      const max = (shown[0] && shown[0].secs) || 1;
      return '<p class="q-sec">In the arcade</p>'
        + '<p class="stat-note">' + esc(T('{d} playing, in all.', {d:fmtDur(total)})) + '</p>'
        + '<div class="stat-company stat-games">'
        + shown.slice(0, 8).map(g=>
            '<div class="scomp" data-game="' + esc(g.id) + '">'
            + '<span class="scomp-name">' + esc(g.name) + '</span>'
            + '<span class="scomp-bar"><i style="width:' + Math.max(4, Math.round(g.secs/max*100)) + '%"></i></span>'
            + '<b>' + fmtDur(g.secs) + '</b>'
            + '</div>').join('')
        + '</div>';
    },

    _card(value, label){
      return '<div class="stat-card"><b>'+esc(value)+'</b><span>'+esc(label)+'</span></div>';
    }
  };

  $('d-stats').onclick = ()=>{ closeDrawer(); Stats.open(); };
  /* Shop opens the same page, then scrolls it to the shelf. The stats above it
     are a page and a half on a phone, and landing at the top of them after
     tapping something called Shop is landing in the wrong place — so it jumps
     to the ember count, which is the first line of the shelf and answers "how
     many do I have" on the way past.

     After a frame, because the page has just been written and has no scroll
     height yet; `scrollIntoView` against a zero-height box does nothing. */
  /* Not every environment that runs this file has `scrollIntoView` — jsdom does
     not, which is where the tests live, and an unguarded call there throws
     inside a rAF callback where nothing catches it. Landing at the top of the
     page is a worse page, not a broken one, so it degrades rather than guards
     the whole handler. */
  function scrollTo_(el, block){
    if(el && typeof el.scrollIntoView === 'function'){
      el.scrollIntoView({block:block || 'start', behavior:'smooth'});
    }
  }

  /* Shop is its own page now, so this opens it rather than opening Your focus
     and jumping to the middle of it. The jump was the tell: a page that needs
     a shortcut to its own halfway point is two pages. */
  const shopOpen = (tab)=>{
    closeDrawer();
    const ov = $('shop-overlay');
    if(!ov) return;
    /* Opened from the wardrobe's own button, it opens *on* the wardrobe. A shop
       with five shelves that always opens on the first one is a shop you have
       to navigate twice. */
    if(tab){ try{ Embers.tab = tab; }catch(e){} }
    ov.classList.remove('hide');
    try{ Embers.render(); }catch(e){}
    try{ faceRender(); }catch(e){}
  };
  if($('emb-spend-row')) $('emb-spend-row').onclick = shopOpen;
  if($('emb-chip')) $('emb-chip').onclick = shopOpen;
  /* Leaving the shop takes off whatever was being tried but not bought: it
     was never his, and finding it still on him on the next screen would read as
     having bought it by accident. */
  if($('shop-close')) $('shop-close').onclick = ()=>{
    const o = $('shop-overlay'); if(o) o.classList.add('hide');
    try{ if(Buddy.tryOn){ Buddy.tryOn = null; Buddy.render(); Buddy.stage(); } }catch(e){}
  };
  /* The corner button is wired in 48-account.js, with the page it opens. */
  $('stats-close').onclick = ()=>Stats.close();

