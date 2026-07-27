  /* --- session log --- */
  let LOG=[];
  async function loadLog(){ const r=await KV.get('focus_log'); if(r&&r.value){ try{ LOG=JSON.parse(r.value)||[]; }catch(e){} } }
  function saveLog(){ KV.set('focus_log', JSON.stringify(LOG)); }
  function findLog(id){ return LOG.find(r=>r.id===id); }
  function logSession(secs){
    const ts=Date.now();
    const rec={id:'s'+ts+'_'+(Math.random()*1e4|0), ts, day:dayKey(ts), secs, note:''};
    LOG.push(rec); S.lastLogId=rec.id; saveLog();
  }
  function refreshNote(){
    const rec=S.lastLogId?findLog(S.lastLogId):null;
    const box=$('note-box');
    if(!rec){ box.style.display='none'; return; }
    box.style.display='';
    $('note-label').innerHTML='Note this session \u00b7 <b>'+fmtDur(rec.secs)+'</b>';
    const inp=$('note-input');
    if(document.activeElement!==inp) inp.value=rec.note||'';
  }

