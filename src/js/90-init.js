  /* ---------- init ---------- */
  buildPresets();
  Promise.all([load(), loadQuotes(), loadLog(), loadTasks(), ambLoad(), syncLoad()]).then(()=>{ document.querySelector('.ring-prog').setAttribute('stroke-dasharray',C); render(); });
