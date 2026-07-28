  /* ---------- data backup: export / import ----------
     Every packaged build (browser, Android, iOS, Electron, Tauri) has its own
     private storage — a Capacitor app cannot read the localStorage your browser
     tab wrote. These two buttons are the bridge: export from the old one,
     import into the new one, and nothing is lost. */
  const DATA_KEYS = ['focus_sim', 'focus_log', 'focus_quotes', 'focus_tasks', 'focus_amb', 'focus_sync'];

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

  $('d-export').onclick = exportData;
  $('d-import').onclick = ()=> $('import-file').click();
  $('import-file').addEventListener('change', e=>{
    const f = e.target.files && e.target.files[0];
    if(f) importData(f);
    e.target.value = '';
  });

