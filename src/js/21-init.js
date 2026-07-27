  /* ---------- init ---------- */
  buildPresets();
  Promise.all([load(), loadQuotes(), loadLog()]).then(()=>{ document.querySelector('.ring-prog').setAttribute('stroke-dasharray',C); render(); });
