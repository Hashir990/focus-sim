  /* --- stats dashboard ---
     Reads the same LOG array the calendar uses (focus_log). Adds no new storage. */
  const Stats = {
    open(){ $('stats-overlay').classList.remove('hide'); this.render(); },
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

      // most productive hour of day
      const hours = new Array(24).fill(0);
      for(const r of LOG) if(r.ts) hours[new Date(r.ts).getHours()] += r.secs||0;
      let bestHour = -1, bestHourSecs = 0;
      hours.forEach((v,h)=>{ if(v > bestHourSecs){ bestHourSecs = v; bestHour = h; } });

      // last 14 days, oldest first
      const recent = [];
      for(let i=13;i>=0;i--){
        const dt = new Date(); dt.setDate(dt.getDate()-i);
        const k = dayKey(dt.getTime());
        recent.push({key:k, label:String(dt.getDate()), secs:(byDay[k]||{}).secs||0});
      }

      return {totalSecs, sessions, streak, bestDay, bestSecs, bestHour, recent, days:Object.keys(byDay).length};
    },

    render(){
      const s = this._compute();
      const body = $('stats-body');

      if(!s.sessions){
        body.innerHTML = '<p class="q-empty">No finished sessions yet. Complete a focus block '
          + 'and this fills in — total time, streaks, and your best hours.</p>';
        return;
      }

      const hourLabel = s.bestHour < 0 ? '—'
        : (s.bestHour === 0 ? '12 AM'
          : s.bestHour < 12 ? s.bestHour+' AM'
          : s.bestHour === 12 ? '12 PM'
          : (s.bestHour-12)+' PM');

      const max = Math.max.apply(null, s.recent.map(r=>r.secs).concat([1]));
      const bars = s.recent.map(r=>{
        const h = r.secs ? Math.max(4, Math.round(r.secs/max*100)) : 0;
        const title = r.key+' · '+(r.secs ? fmtDur(r.secs) : 'nothing');
        return '<div class="sbar" title="'+esc(title)+'">'
          + '<div class="sbar-track"><div class="sbar-fill'+(r.secs?'':' empty')+'" style="height:'+h+'%"></div></div>'
          + '<span>'+esc(r.label)+'</span></div>';
      }).join('');

      body.innerHTML =
        '<div class="stat-grid">'
        + this._card(fmtDur(s.totalSecs), 'total focused')
        + this._card(String(s.sessions), s.sessions===1?'session':'sessions')
        + this._card(s.streak+(s.streak===1?' day':' days'), 'current streak')
        + this._card(String(s.days), s.days===1?'active day':'active days')
        + '</div>'
        + '<p class="q-sec">Last 14 days</p>'
        + '<div class="sbars">'+bars+'</div>'
        + '<div class="stat-lines">'
        + '<div><span>Best day</span><b>'+(s.bestDay?esc(s.bestDay)+' · '+fmtDur(s.bestSecs):'—')+'</b></div>'
        + '<div><span>Best hour</span><b>'+esc(hourLabel)+'</b></div>'
        + '<div><span>Average session</span><b>'+fmtDur(Math.round(s.totalSecs/s.sessions))+'</b></div>'
        + '</div>';
    },

    _card(value, label){
      return '<div class="stat-card"><b>'+esc(value)+'</b><span>'+esc(label)+'</span></div>';
    }
  };

  $('d-stats').onclick = ()=>{ closeDrawer(); Stats.open(); };
  $('stats-close').onclick = ()=>Stats.close();

