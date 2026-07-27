  /* ================================================================
     QUOTES · SESSION LOG · CALENDAR   (v3)
     ================================================================ */
  const esc = s => String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const fmtDur = secs => { const m=Math.round(secs/60); if(m<60) return m+' min'; const h=Math.floor(m/60), r=m%60; return r? h+'h '+r+'m' : h+'h'; };
  const dayKey = ts => { const d=new Date(ts); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); };

