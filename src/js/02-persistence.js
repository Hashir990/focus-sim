  /* ---------- persistence ---------- */
  async function load(){
    try{
      const r = await KV.get('focus_sim');
      if(r && r.value){
        const d = JSON.parse(r.value);
        const today = new Date().toDateString();
        Object.assign(S,{
          focusMin:d.focusMin??25, breakMin:d.breakMin??5,
          autoContinue:d.autoContinue??true, sound:d.sound??true,
          repeat:d.repeat??4
        });
        if(d.day===today){ S.sessionsToday=d.sessionsToday||0; S.cycle=d.cycle||0; }
        S.day = today;
      }
    }catch(e){/* first run */}
    S.remaining = S.total = S.focusMin*60;
  }
  function save(){
    try{
      KV.set('focus_sim', JSON.stringify({
        focusMin:S.focusMin, breakMin:S.breakMin,
        autoContinue:S.autoContinue, sound:S.sound,
        sessionsToday:S.sessionsToday, cycle:S.cycle, repeat:S.repeat,
        day:new Date().toDateString()
      }));
    }catch(e){}
  }

