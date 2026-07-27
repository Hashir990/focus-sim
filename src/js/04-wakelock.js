  /* ---------- screen wake lock ---------- */
  async function acquireWake(){
    try{ if('wakeLock' in navigator && !wake){ wake = await navigator.wakeLock.request('screen'); } }catch(e){}
  }
  function releaseWake(){ try{ wake && wake.release(); wake=null; }catch(e){} }
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible' && S.running) acquireWake(); });

