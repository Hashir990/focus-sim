  /* ---------- storage: localStorage for standalone, window.storage fallback inside Claude ---------- */
  const _ws = (typeof window!=='undefined' && window.storage) ? window.storage : null;
  /* **A write that fails has to say so.**

     Every layer above this one caught and discarded storage errors, so a store
     that had stopped accepting writes was indistinguishable from one that was
     working — right up to the moment a board came back empty. That is not a
     puzzle bug however much it looks like one from a chair, and it was chased
     as one three times: boards not surviving a difficulty switch, a crossword
     losing its letters on close, a sudoku opening with no clues in it. One
     cause, in here.

     `localStorage` throws when it is full, which is the common case: the quota
     is a few megabytes per origin and a save that grows for months eventually
     reaches it. So a failed write is not the end of it — `KV.pinch` is handed a
     chance to free room and the write is tried once more before anything is
     declared broken. */
  const KV = {
    broken: false,            // set once a write has actually failed
    lastError: '',
    pinch: null,              // set by 09-arcade-core.js: free room, return true if it did
    async get(k){ try{ const v=localStorage.getItem(k); return v==null?null:{value:v}; }catch(e){}
      if(_ws){ try{ return await _ws.get(k); }catch(e){} } return null; },
    /** True if the value is now stored. */
    async set(k,v){
      if(kvPut(k, v)) return true;
      /* Full, most likely. Throw out what can be regenerated and try once more
         — one retry, because a second failure is a different problem and a loop
         here would run while the user waits. */
      let freed = false;
      try{ freed = !!(this.pinch && this.pinch()); }catch(e){}
      if(freed && kvPut(k, v)) return true;
      if(_ws){ try{ await _ws.set(k,v); return true; }catch(e){ KV.lastError = String(e && e.name || e); } }
      KV.broken = true;
      return false;
    },
    async del(k){ try{ localStorage.removeItem(k); return; }catch(e){}
      if(_ws){ try{ await _ws.delete(k); }catch(e){} } },
    /** What is in here, biggest first — so a report of "it stopped saving" can
        come with the reason attached instead of a guess. */
    report(){
      const rows = [];
      let total = 0;
      try{
        for(let i=0;i<localStorage.length;i++){
          const k = localStorage.key(i);
          const n = ((localStorage.getItem(k) || '').length + k.length) * 2;  // UTF-16
          total += n; rows.push({k, n});
        }
      }catch(e){ return {total:0, rows:[], err:String(e && e.name || e)}; }
      rows.sort((a,b)=>b.n - a.n);
      return {total, rows:rows.slice(0, 8), err:KV.lastError};
    },
  };
  function kvPut(k, v){
    try{ localStorage.setItem(k, v); return true; }
    catch(e){ KV.lastError = String((e && e.name) || e); return false; }
  }

