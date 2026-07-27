  /* --- calendar --- */
  const Cal={
    y:0, m:0, sel:null,
    open(){ const d=new Date(); this.y=d.getFullYear(); this.m=d.getMonth(); this.sel=null; $('cal-overlay').classList.remove('hide'); this.render(); },
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

