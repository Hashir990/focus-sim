  /* --- calendar --- */
  const Cal={
    y:0, m:0, sel:null,
    open(){
      const d=new Date(); this.y=d.getFullYear(); this.m=d.getMonth(); this.sel=null;
      $('cal-overlay').classList.remove('hide');
      this._bindScroll();
      this.render();
      const body=this._body(); if(body) body.scrollTop=0;
    },
    _body(){ const ov=$('cal-overlay'); return ov ? ov.querySelector('.ov-body') : null; },

    /* ---- scroll-driven zoom ----
       Scrolling down shrinks the month grid so the notes come up to meet you.
       The height the grid gives up is added as padding under the notes, which
       keeps the total scrollable height fixed. Without that the page would get
       shorter as you scrolled, the browser would clamp scrollTop, that would
       change the zoom, and the whole thing would oscillate. */
    _bindScroll(){
      if(this._bound) return;
      const body=this._body(); if(!body) return;
      let raf=0;
      body.addEventListener('scroll', ()=>{
        if(raf) return;
        raf=requestAnimationFrame(()=>{ raf=0; this.zoom(); });
      }, {passive:true});
      this._bound=true;
    },
    zoom(){
      const body=this._body(), wrap=$('cal-zoom'), inner=$('cal-zoom-in'), detail=$('cal-detail');
      if(!body || !wrap || !inner) return;
      if(!this._natH){
        inner.style.transform='none'; wrap.style.height='auto';
        this._natH = inner.offsetHeight || 0;
        if(!this._natH) return;
      }
      const MIN=0.55, RANGE=260;
      const z = Math.max(MIN, Math.min(1, 1 - (body.scrollTop/RANGE)*(1-MIN)));
      const shrink = this._natH * (1 - z);
      inner.style.transform = 'scale('+z.toFixed(4)+')';
      wrap.style.height = (this._natH - shrink).toFixed(1)+'px';
      if(detail) detail.style.paddingBottom = shrink.toFixed(1)+'px';
      wrap.dataset.z = z.toFixed(2);
    },
    close(){ $('cal-overlay').classList.add('hide'); },
    step(n){ this.m+=n; if(this.m<0){this.m=11;this.y--;} if(this.m>11){this.m=0;this.y++;} this.sel=null; this.render(); },
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
      $('cal-month').textContent=months[this.m]+' '+this.y;
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
          if(key===this.sel) cell.classList.add('sel');
          cell.onclick=()=>{ this.sel=(this.sel===key?null:key); this.render(); };
        }
        grid.appendChild(cell);
      }
      $('cal-sessions').textContent=mSessions;
      $('cal-time').textContent=mSecs?fmtDur(mSecs):'0m';
      this.detail(map);
      this._natH=0;      // row count changes between months, so re-measure
      this.zoom();
    },
    /** Textareas grow to fit what's in them, so a long note isn't a 2-line peephole. */
    _grow(ta){
      ta.style.height='auto';
      ta.style.height=Math.min(ta.scrollHeight+2, 240)+'px';
    },
    detail(map){
      const box=$('cal-detail');
      const ov=$('cal-overlay');
      if(!this.sel || !map[this.sel]){ box.innerHTML=''; ov.dataset.dense='0'; return; }
      const recs=map[this.sel].recs.slice().sort((a,b)=>a.ts-b.ts);
      // The more there is to read, the more the month grid gives way to it.
      ov.dataset.dense = recs.length>=6 ? '2' : recs.length>=3 ? '1' : '0';
      const label=new Date(this.sel+'T00:00:00').toLocaleDateString(undefined,{weekday:'long', month:'long', day:'numeric'});
      box.innerHTML='<h4>'+esc(label)+'</h4>';
      recs.forEach(r=>{
        const wrap=document.createElement('div'); wrap.className='cal-rec';
        const tm=new Date(r.ts).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
        const head=document.createElement('div'); head.className='rechead';
        head.innerHTML='<span class="rectime">'+esc(tm)+'</span><span class="recdur">'+fmtDur(r.secs)+'</span>';
        const del=document.createElement('button'); del.className='recdel'; del.textContent='Delete';
        del.onclick=()=>{ const i=LOG.findIndex(x=>x.id===r.id); if(i>=0){ LOG.splice(i,1); saveLog(); this.render(); } };
        head.appendChild(del);
        const ta=document.createElement('textarea'); ta.rows=1; ta.placeholder='What did you work on?'; ta.value=r.note||'';
        ta.oninput=()=>{ r.note=ta.value; saveLog(); this._grow(ta); };
        wrap.appendChild(head); wrap.appendChild(ta); box.appendChild(wrap);
        this._grow(ta);          // must happen after it's in the document
      });
    }
  };

