  /* ---------- storage: localStorage for standalone, window.storage fallback inside Claude ---------- */
  const _ws = (typeof window!=='undefined' && window.storage) ? window.storage : null;
  const KV = {
    async get(k){ try{ const v=localStorage.getItem(k); return v==null?null:{value:v}; }catch(e){}
      if(_ws){ try{ return await _ws.get(k); }catch(e){} } return null; },
    async set(k,v){ try{ localStorage.setItem(k,v); return; }catch(e){}
      if(_ws){ try{ await _ws.set(k,v); }catch(e){} } },
    async del(k){ try{ localStorage.removeItem(k); return; }catch(e){}
      if(_ws){ try{ await _ws.delete(k); }catch(e){} } }
  };

