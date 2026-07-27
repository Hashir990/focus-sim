  /* ---------- build presets ---------- */
  function buildPresets(){
    const mk=(host,vals,setter)=>{
      vals.forEach(v=>{
        const b=document.createElement('button');
        b.className='chip'; b.dataset.v=v; b.textContent=v;
        b.onclick=()=>{ setter(v); render(); };
        host.appendChild(b);
      });
    };
    mk($('f-presets'),[20,30,50,90], v=>{S.focusMin=v; if(S.mode==='setup'){S.total=S.remaining=v*60;}});
    mk($('r-presets'),[5,10,15,30], v=>{S.breakMin=v;});
    [2,4,6,8,0].forEach(v=>{
      const b=document.createElement('button'); b.className='chip'; b.dataset.v=v; b.textContent=v===0?'\u221e':v;
      b.onclick=()=>{ S.repeat=v; save(); render(); };
      $('rep-chips').appendChild(b);
    });
  }

