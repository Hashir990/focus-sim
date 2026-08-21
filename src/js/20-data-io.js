  /* ---------- data backup: export / import ----------
     Every packaged build (browser, Android, iOS, Electron, Tauri) has its own
     private storage — a Capacitor app cannot read the localStorage your browser
     tab wrote. These two buttons are the bridge: export from the old one,
     import into the new one, and nothing is lost. */
  const DATA_KEYS = ['focus_sim', 'focus_log', 'focus_quotes', 'focus_quotes_share',
                     'focus_tasks', 'focus_amb', 'focus_sync', 'focus_dm', 'focus_embers', 'focus_vfx',
                     /* The calendar was missing from this list, so exporting your data
                        quietly left every event and repeat rule behind, and importing a
                        backup wiped nothing but restored nothing either. `focus_gone`
                        travels with it — without the tombstones an import brings back
                        everything you had ever deleted. */
                     'focus_plan', 'focus_gone'];

  async function collectData(){
    const out = { app:'focus-simulator', version:1, exportedAt:new Date().toISOString(), data:{} };
    for(const k of DATA_KEYS){
      const r = await KV.get(k);
      out.data[k] = (r && r.value!=null) ? r.value : null;
    }
    return out;
  }

  async function exportData(){
    let payload;
    try{ payload = JSON.stringify(await collectData(), null, 2); }
    catch(e){ toast('Export failed'); return; }

    const name = 'focus-backup-'+new Date().toISOString().slice(0,10)+'.json';
    try{
      const blob = new Blob([payload], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
      toast('Backup saved');
    }catch(e){
      try{ await navigator.clipboard.writeText(payload); toast('Backup copied to clipboard'); }
      catch(e2){ toast('Export failed'); }
    }
  }

  async function importData(file){
    try{
      const parsed = JSON.parse(await file.text());
      const data = parsed && parsed.data;
      if(!data || typeof data!=='object') throw new Error('unrecognised file');
      let n = 0;
      for(const k of DATA_KEYS){
        if(typeof data[k] === 'string'){ await KV.set(k, data[k]); n++; }
      }
      if(!n) throw new Error('nothing to restore');
      toast('Restored — reloading');
      setTimeout(()=>location.reload(), 900);
    }catch(e){ toast('Import failed'); }
  }

  /* ---- reset progress ----
     Everything you have *done*: the session log the calendar and stats are
     drawn from, the embers and the lights they bought, and where you had got to
     in every arcade game. Deliberately not your settings, your friends, your
     saved quotes or your messages — those are things you *set up*, and somebody
     starting the year again does not want to type their friends back in.

     Said in full before it happens, because there is no undo and the only
     insurance is the backup button directly above it. */
  const PROGRESS_KEYS = ['focus_log', 'focus_embers', 'focus_sudoku', 'focus_wordle',
                         'focus_2048', 'focus_crossword', 'focus_memory', 'focus_chess'];

  async function resetProgress(){
    for(const k of PROGRESS_KEYS){ try{ await KV.del(k); }catch(e){} }
    /* `logForget` before emptying the log: a block that is still running holds a
       reference to a record in it, and the next tick would find the record gone
       and helpfully write a fresh one — putting a session back into history
       moments after the person asked for all of it to go. */
    try{ logForget(); }catch(e){}
    try{ LOG.length = 0; S.lastLogId = null; }catch(e){}
    try{ Embers.reset(); }catch(e){}
    try{ S.sessionsToday = 0; }catch(e){}
    try{ Chess.saved = {}; Chess.loaded = true; }catch(e){}
    try{ Arcade._refresh(); }catch(e){}
    try{ Stats.render(); }catch(e){}
    try{ Cal.render && Cal.render(); }catch(e){}
    render();
    toast('Progress reset');
  }

  $('d-reset').onclick = ()=>{
    closeDrawer();
    askConfirm('Reset your progress?',
      'Your session history, your embers and the lights they bought, and every '
      + 'saved game go. Settings, friends and quotes stay. There is no undo — '
      + 'export a backup first if you might want it.',
      'Reset it all', resetProgress);
  };

  $('d-export').onclick = exportData;
  $('d-import').onclick = ()=> $('import-file').click();
  $('import-file').addEventListener('change', e=>{
    const f = e.target.files && e.target.files[0];
    if(f) importData(f);
    e.target.value = '';
  });

