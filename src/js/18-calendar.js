  /* --- calendar --- */
  const Cal={
    y:0, m:0, sel:null,
    adding:null,        // the day whose add-form is open, if any
    draft:null,         // what has been typed into it so far
    open(){
      const d=new Date(); this.y=d.getFullYear(); this.m=d.getMonth();
      /* Today is picked so the month opens with it marked, but its page is not
         opened: the calendar is for looking across the month first, and a day
         in front of it on arrival is a page to close before you can see it. */
      this.sel=dayKey(Date.now()); this.adding=null; this.draft=null;
      $('cal-overlay').classList.remove('hide');
      this.closeDay(true);
      this.render();
      const body=this._body(); if(body) body.scrollTop=0;
    },
    _body(){ const ov=$('cal-overlay'); return ov ? ov.querySelector('.ov-body') : null; },
    close(){ this.closeDay(true); $('cal-overlay').classList.add('hide'); },

    /* ---- one day, on its own page ----
       See the note on #day-overlay in 11-calendar-overlay.html: the day used to
       share a column with the month and both were squeezed for it. */
    dayOpen(){ const el=$('day-overlay'); return !!el && !el.classList.contains('hide'); },
    openDay(key){
      if(key) this.sel=key;
      this.adding=null; this.draft=null;
      const el=$('day-overlay');
      if(el) el.classList.remove('hide');
      this.render();
      const body=el && el.querySelector('.ov-body'); if(body) body.scrollTop=0;
    },
    /** `quiet` skips the redraw, for the callers that are about to draw anyway. */
    closeDay(quiet){
      const el=$('day-overlay');
      if(el) el.classList.add('hide');
      this.adding=null; this.draft=null;
      if(!quiet) this.render();
    },
    /** The day either side, carrying the month with it when it crosses one —
        otherwise the grid behind would be showing a month the page is not in. */
    dayStep(n){
      if(!this.sel) return;
      const d=new Date(this.sel+'T12:00:00');
      d.setDate(d.getDate()+n);
      this.y=d.getFullYear(); this.m=d.getMonth();
      this.openDay(dayKey(d.getTime()));
    },
    step(n){
      this.m+=n; if(this.m<0){this.m=11;this.y--;} if(this.m>11){this.m=0;this.y++;}
      this.sel=null; this.adding=null; this.draft=null;
      this.render();
    },
    byDay(){
      const map={};
      for(const r of LOG){
        (map[r.day]=map[r.day]||{secs:0,recs:[],notes:0});
        map[r.day].secs+=r.secs; map[r.day].recs.push(r);
        if(r.note && r.note.trim()) map[r.day].notes++;
      }
      return map;
    },
    render(){
      const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
      $('cal-month').textContent = LANG === 'en' ? months[this.m]+' '+this.y
        : new Date(this.y, this.m, 1).toLocaleDateString(langLocale(), {month:'long', year:'numeric'});
      const map=this.byDay();
      const first=new Date(this.y,this.m,1), days=new Date(this.y,this.m+1,0).getDate();
      const startW=(first.getDay()+6)%7; // Monday=0
      const grid=$('cal-grid'); grid.innerHTML='';
      for(let i=0;i<startW;i++){ const b=document.createElement('div'); b.className='cal-cell blank'; grid.appendChild(b); }
      const todayK=dayKey(Date.now());
      let mSecs=0, mSessions=0;
      for(let d=1;d<=days;d++){
        const key=this.y+'-'+pad(this.m+1)+'-'+pad(d);
        const info=map[key];
        const cell=document.createElement('div'); cell.className='cal-cell'; cell.textContent=d;
        if(key===todayK) cell.classList.add('today');
        // Every day is selectable, whether or not it has sessions — otherwise you
        // can get stuck on one day with no way to move to a neighbouring one.
        if(key===this.sel) cell.classList.add('sel');
        /* Every day opens its page, whether or not anything happened on it:
           there is always something to show — what is planned for it, how it
           went — and a day in the future is where you plan it. */
        cell.onclick=()=>this.openDay(key);
        if(info){
          cell.classList.add('has');
          const mins=info.secs/60, lvl = mins>=120?4 : mins>=60?3 : mins>=25?2 : 1;
          cell.classList.add('l'+lvl);
          const bar=document.createElement('div'); bar.className='lvl'; cell.appendChild(bar);
          // a dot marks days that actually have something written on them, so you
          // can find your notes without opening every day
          if(info.notes){
            cell.classList.add('noted');
            const dot=document.createElement('span'); dot.className='note-dot';
            if(info.notes>1) dot.classList.add('many');
            cell.appendChild(dot);
          }
          mSecs+=info.secs; mSessions+=info.recs.length;
        }
        /* What is *going* to happen, as opposed to what did. Two marks, two
           colours: an event is a fact about the day and a task is something
           still waiting on you, and they are the two things you scan a month
           for. A task that has been ticked off stops glowing — the mark is a
           reminder, and a reminder you have dealt with is noise. */
        try{
          const c = planCounts(key);
          if(c.events){ cell.classList.add('ev'); const e=document.createElement('span'); e.className='ev-dot'; cell.appendChild(e); }
          if(c.left){ cell.classList.add('todo'); const t=document.createElement('span'); t.className='todo-dot'; cell.appendChild(t); }
        }catch(e){}
        /* **How the day went, bottom right.** The marks above are things to
           count and share the top-left; this is the one thing on the square you
           *read*, so it gets the far corner and the date moves aside for it.
           See 17b-mood.js. */
        try{
          const face = moodOf(key);
          if(face){
            cell.classList.add('has-mood');
            const m = document.createElement('span');
            m.className = 'mood';
            /* Drawn, not typed — the same face the picker showed, at 15px.
               A character here was a different picture on every platform and a
               monochrome outline on some of them. See 17c-emoji.js. */
            m.innerHTML = emoFace(face);
            m.title = moodName(face);
            cell.appendChild(m);
          }
        }catch(e){}
        grid.appendChild(cell);
      }
      $('cal-sessions').textContent=mSessions;
      $('cal-time').textContent=mSecs?fmtDur(mSecs):'0m';
      this.detail(map);
    },
    /** Textareas grow to fit what's in them, so a long note isn't a 2-line peephole. */
    _grow(ta){
      ta.style.height='auto';
      ta.style.height=Math.min(ta.scrollHeight+2, 240)+'px';
    },
    detail(map){
      const box=$('cal-detail');
      box.style.paddingBottom='';
      if(!this.sel){ box.innerHTML=''; return; }
      const label=new Date(this.sel+'T00:00:00').toLocaleDateString(langLocale(),{weekday:'long', month:'long', day:'numeric'});
      const recs=map[this.sel] ? map[this.sel].recs.slice().sort((a,b)=>a.ts-b.ts) : [];
      /* The day's name is the page's title now rather than a heading inside
         it. The month used to give way as a day filled up — a threshold on how
         many sessions and plans it held — and none of that is needed once the
         day has a page of its own to fill. */
      if($('day-title')) $('day-title').textContent = label;
      box.innerHTML='';
      /* **Changing your mind is a tap.** The prompt asks once; this is the way
         back, and the only way to clear a day (tap the face that is already on
         it). Not offered for a day that has not happened: a mood is a report,
         not a plan. */
      try{
        if(this.sel <= dayKey(Date.now())){
          const mw = document.createElement('div');
          mw.className = 'cal-mood';
          mw.innerHTML = '<p class="q-sec">How it went</p>' + moodRow(this.sel);
          box.appendChild(mw);
          moodWire(mw, ()=>Cal.render());
        }
      }catch(e){}
      /* What is planned comes first, whether or not anything was done. A day in
         the future has nothing else on it, and a day in the past reads better
         as "this is what it was for" before "this is what happened". */
      this.plan(box);
      if(!recs.length){
        const p=document.createElement('p'); p.className='cal-empty';
        p.textContent = this.sel > dayKey(Date.now())
          ? 'No sessions on this day — it hasn’t happened yet.'
          : 'No sessions on this day.';
        box.appendChild(p);
      }
      recs.forEach(r=>{
        const wrap=document.createElement('div'); wrap.className='cal-rec';
        const tm=new Date(r.ts).toLocaleTimeString(langLocale(),{hour:'numeric',minute:'2-digit'});
        const head=document.createElement('div'); head.className='rechead';
        head.innerHTML='<span class="rectime">'+esc(tm)+'</span><span class="recdur">'+fmtDur(r.secs)+'</span>';
        const del=document.createElement('button'); del.className='recdel'; del.textContent='Delete';
        del.onclick=()=>{ const i=LOG.findIndex(x=>x.id===r.id); if(i>=0){ LOG.splice(i,1); saveLog(); this.render(); } };
        head.appendChild(del);
        const ta=document.createElement('textarea'); ta.rows=1; ta.placeholder='What did you work on?'; ta.value=r.note||'';
        ta.oninput=()=>{ r.note=ta.value; saveLog(); this._grow(ta); };
        wrap.appendChild(head);
        if(r.with && r.with.length){
          const who=document.createElement('p'); who.className='recwith';
          who.textContent=T('Studied with {names}', {names:namesList(r.with)});
          wrap.appendChild(who);
        }
        wrap.appendChild(ta); box.appendChild(wrap);
        this._grow(ta);          // must happen after it's in the document
      });
    },

    /* ---- what is planned for the selected day ----
       Built as elements rather than as a string of HTML, because every row here
       has a handler on it and wiring by query afterwards is how you end up with
       a delete button that quietly deletes the wrong entry. */
    plan(box){
      const key = this.sel;
      const rows = planOn(key);
      const wrap = document.createElement('div');
      wrap.className = 'cal-plan';
      wrap.dataset.count = String(rows.length);

      const head = document.createElement('div');
      head.className = 'cal-plan-head';
      head.innerHTML = '<b>Planned</b>';
      const add = document.createElement('button');
      add.className = 'cal-plan-add';
      add.textContent = this.adding === key ? 'Close' : 'Add';
      add.onclick = ()=>{ this.adding = this.adding === key ? null : key; this.render(); };
      head.appendChild(add);
      wrap.appendChild(head);

      rows.forEach(p=>{
        const done = !!(p.done && p.done[key]);
        const row = document.createElement('div');
        row.className = 'plan-row ' + p.kind + (done ? ' done' : '');

        if(p.kind === 'task'){
          const tick = document.createElement('button');
          tick.className = 'plan-tick' + (done ? ' on' : '');
          tick.setAttribute('aria-label', done ? 'Not done' : 'Done');
          tick.textContent = done ? '✓' : '';
          tick.onclick = ()=>{
            planTick(p.id, key, !done);
            /* The same entry may be sitting in today's checklist. Keep the two
               in step rather than letting one of them go stale. */
            try{
              const t = TASKS.find(x=>x.from === p.id && x.on === key);
              if(t){ t.done = !done; saveTasks(); tasksRender(); tasksRefresh(); }
            }catch(e){}
            this.render();
          };
          row.appendChild(tick);
        }else{
          const dot = document.createElement('span');
          dot.className = 'plan-bullet';
          row.appendChild(dot);
        }

        const mid = document.createElement('div');
        mid.className = 'plan-mid';
        const t = document.createElement('b');
        t.textContent = p.text;
        mid.appendChild(t);
        const bits = [];
        if(p.time) bits.push(p.time);
        if(p.rep) bits.push(planRepeatLabel(p));
        if(bits.length){
          const sub = document.createElement('em');
          sub.textContent = bits.join(' · ');
          mid.appendChild(sub);
        }
        row.appendChild(mid);

        const del = document.createElement('button');
        del.className = 'plan-x';
        del.setAttribute('aria-label', 'Remove');
        del.textContent = '×';
        del.onclick = ()=>{
          /* Deleting a repeat deletes every one of it, which is the only honest
             thing a single × can do — asking "this one or all of them?" on a
             tap that small is worse than saying so plainly, and saying so is
             what the confirm is for. */
          const go = ()=>{ planRemove(p.id); this.render(); };
          if(p.rep) askConfirm(T('Remove “{what}”?', {what:p.text}), T('{rule}. Removing it removes every one of them.', {rule:planRepeatLabel(p)}), 'Remove', go);
          else go();
        };
        row.appendChild(del);
        wrap.appendChild(row);
      });

      if(!rows.length && this.adding !== key){
        const none = document.createElement('p');
        none.className = 'plan-none';
        none.textContent = 'Nothing planned. Add a task and it turns up on your list that morning.';
        wrap.appendChild(none);
      }

      if(this.adding === key) wrap.appendChild(this.form(key));
      box.appendChild(wrap);
      /* The form used to open below a month grid that was most of a screen on
         its own, and the month shrank to a strip to make room for it. On the
         day's own page there is no month to push aside; bringing the form into
         view is all that is left to do. */
      if(this.adding === key){
        const f = wrap.querySelector('.plan-form');
        // jsdom has no scrollIntoView, and neither do some older engines
        if(f && f.scrollIntoView) try{ f.scrollIntoView({block:'nearest'}); }catch(e){}
      }
    },

    /* The one form for both kinds. Kind, words, time, repeat, in that order,
       because that is the order they are decided in. */
    form(key){
      const f = document.createElement('div');
      f.className = 'plan-form';
      const st = this.draft = this.draft && this.draft.key === key ? this.draft : {
        key, kind:'task', text:'', time:'', every:'', n:1, days:[], endMode:'never', endOn:'', endAfter:12,
      };

      const kinds = document.createElement('div');
      kinds.className = 'plan-kinds';
      [['task','Task','turns up on your list that day'],
       ['event','Event','something that happens, at a time']].forEach(k=>{
        const b = document.createElement('button');
        b.className = 'plan-kind' + (st.kind === k[0] ? ' on' : '');
        b.innerHTML = '<b>' + k[1] + '</b><em>' + k[2] + '</em>';
        b.onclick = ()=>{ st.kind = k[0]; this.render(); };
        kinds.appendChild(b);
      });
      f.appendChild(kinds);

      const line = document.createElement('div');
      line.className = 'plan-line';
      const text = document.createElement('input');
      text.type = 'text'; text.className = 'plan-text'; text.maxLength = 90;
      text.placeholder = st.kind === 'event' ? 'What is happening?' : 'What needs doing?';
      text.value = st.text;
      text.oninput = ()=>{ st.text = text.value; };
      const time = document.createElement('input');
      time.type = 'time'; time.className = 'plan-time'; time.value = st.time;
      time.onchange = ()=>{ st.time = time.value; };
      line.appendChild(text); line.appendChild(time);
      f.appendChild(line);

      /* Repeats. Every option is a plain sentence about when it happens, which
         is the way people actually hold the rule in their head. */
      const rep = document.createElement('div');
      rep.className = 'plan-reps';
      [['', 'Once'], ['day', 'Daily'], ['wk', 'Weekly'], ['month', 'Monthly'], ['year', 'Yearly']]
        .forEach(o=>{
          const b = document.createElement('button');
          b.className = 'plan-rep' + (st.every === o[0] ? ' on' : '');
          b.textContent = o[1];
          b.onclick = ()=>{
            st.every = o[0];
            if(o[0] === 'wk' && !st.days.length) st.days = [planDate(key).getDay()];
            this.render();
          };
          rep.appendChild(b);
        });
      f.appendChild(rep);

      if(st.every){
        const every = document.createElement('div');
        every.className = 'plan-every';
        const unit = st.every === 'day' ? 'day' : st.every === 'wk' ? 'week' : st.every === 'month' ? 'month' : 'year';
        every.innerHTML = '<span>Every</span>';
        const n = document.createElement('input');
        n.type = 'number'; n.min = '1'; n.max = '99'; n.value = String(st.n);
        n.className = 'plan-n';
        n.oninput = ()=>{ st.n = Math.max(1, Math.min(99, +n.value || 1)); };
        every.appendChild(n);
        const u = document.createElement('span');
        u.textContent = unit + 's';
        every.appendChild(u);
        f.appendChild(every);

        if(st.every === 'wk'){
          const dows = document.createElement('div');
          dows.className = 'plan-dows';
          (LANG === 'en' ? ['S','M','T','W','T','F','S'] : [0,1,2,3,4,5,6].map(langDayHead)).forEach((d, i)=>{
            const b = document.createElement('button');
            b.className = 'plan-dow' + (st.days.indexOf(i) >= 0 ? ' on' : '');
            b.textContent = d;
            b.onclick = ()=>{
              const at = st.days.indexOf(i);
              if(at >= 0) st.days.splice(at, 1); else st.days.push(i);
              this.render();
            };
            dows.appendChild(b);
          });
          f.appendChild(dows);
        }

        const ends = document.createElement('div');
        ends.className = 'plan-ends';
        [['never', 'No end'], ['on', 'Until'], ['after', 'For']].forEach(o=>{
          const b = document.createElement('button');
          b.className = 'plan-end' + (st.endMode === o[0] ? ' on' : '');
          b.textContent = o[1];
          b.onclick = ()=>{ st.endMode = o[0]; this.render(); };
          ends.appendChild(b);
        });
        if(st.endMode === 'on'){
          const d = document.createElement('input');
          d.type = 'date'; d.className = 'plan-until'; d.value = st.endOn || '';
          d.min = key;
          d.onchange = ()=>{ st.endOn = d.value; };
          ends.appendChild(d);
        }
        if(st.endMode === 'after'){
          const a = document.createElement('input');
          a.type = 'number'; a.min = '1'; a.max = '999'; a.className = 'plan-n';
          a.value = String(st.endAfter);
          a.oninput = ()=>{ st.endAfter = Math.max(1, Math.min(999, +a.value || 1)); };
          ends.appendChild(a);
          const s = document.createElement('span');
          s.textContent = 'times';
          ends.appendChild(s);
        }
        f.appendChild(ends);
      }

      const go = document.createElement('button');
      go.className = 'plan-save';
      go.textContent = st.kind === 'event' ? 'Add event' : 'Add task';
      go.onclick = ()=>{
        const words = (st.text || '').trim();
        if(!words){ toast('Give it a name first'); return; }
        const p = planItem(st.kind, key, words);
        p.time = st.time || '';
        if(st.every){
          p.rep = planRepeat(
            st.every === 'wk' ? 'week' : st.every,
            st.n,
            st.every === 'wk' ? st.days : [],
            st.endMode === 'on' ? st.endOn : '',
            st.endMode === 'after' ? st.endAfter : 0
          );
          if(st.every === 'wk' && !p.rep.days.length) p.rep.days = [planDate(key).getDay()];
        }
        PLAN.push(p);
        savePlan();
        this.draft = null;
        this.adding = null;
        // planned for today? then it belongs on today's list this second
        try{ planSpawnDue(); }catch(e){}
        this.render();
        toast(st.kind === 'event' ? 'Event added' : 'Task planned');
      };
      f.appendChild(go);
      return f;
    },
  };

