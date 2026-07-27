  /* ---------- session tasks ----------
     Written with function declarations rather than a const object, because
     render() (file 06) calls tasksRefresh() and function declarations hoist
     across the whole script while a const would still be in its dead zone. */
  var TASKS = [];        // {id, text, done}
  var TASKS_TICKED = []; // texts ticked during the focus block in progress

  async function loadTasks(){
    try{
      const r = await KV.get('focus_tasks');
      if(r && r.value){
        const parsed = JSON.parse(r.value);
        if(Array.isArray(parsed)) TASKS = parsed;
      }
    }catch(e){}
    tasksRender();
  }
  function saveTasks(){ try{ KV.set('focus_tasks', JSON.stringify(TASKS)); }catch(e){} }

  function tasksAdd(){
    const inp = $('task-input');
    const text = (inp.value||'').trim();
    if(!text) return;
    TASKS.push({ id:'t'+Date.now()+'_'+(Math.random()*1e4|0), text, done:false });
    inp.value = '';
    saveTasks(); tasksRender();
  }
  function tasksRemove(id){
    TASKS = TASKS.filter(t=>t.id!==id);
    saveTasks(); tasksRender();
  }
  function tasksClearDone(){
    TASKS = TASKS.filter(t=>!t.done);
    saveTasks(); tasksRender();
  }
  function tasksToggle(id){
    const t = TASKS.find(x=>x.id===id);
    if(!t) return;
    t.done = !t.done;
    // Only count it if it was ticked while actually focusing — that's what makes
    // it belong to this session's note.
    if(t.done && S.mode==='focus'){
      if(TASKS_TICKED.indexOf(t.text) === -1) TASKS_TICKED.push(t.text);
      buzz(30);
    } else if(!t.done){
      const i = TASKS_TICKED.indexOf(t.text);
      if(i !== -1) TASKS_TICKED.splice(i,1);
    }
    saveTasks(); tasksRender();
    if(t.done && TASKS.length && TASKS.every(x=>x.done)) toast('All tasks done — nice');
  }

  /** Called at the end of a focus block: fold ticked tasks into that session's note. */
  function tasksFlushToNote(){
    if(!TASKS_TICKED.length) return;
    const rec = S.lastLogId ? findLog(S.lastLogId) : null;
    if(rec){
      const lines = TASKS_TICKED.map(t=>'✓ '+t).join('\n');
      rec.note = rec.note ? (rec.note + '\n' + lines) : lines;
      saveLog();
    }
    TASKS_TICKED = [];
  }

  function tasksRender(){
    const setup = $('task-list-setup');
    if(setup){
      setup.innerHTML = TASKS.length
        ? TASKS.map(t=>
            '<div class="task-row"><span class="task-text'+(t.done?' done':'')+'">'+esc(t.text)+'</span>'
            + '<button class="task-x" data-id="'+t.id+'" aria-label="Remove task">×</button></div>'
          ).join('')
        : '<p class="task-empty">Optional. Anything you tick off during a session gets written into that session’s note.</p>';
      setup.querySelectorAll('.task-x').forEach(b=>{ b.onclick = ()=>tasksRemove(b.dataset.id); });
    }

    const clear = $('task-clear');
    if(clear) clear.classList.toggle('hide', !TASKS.some(t=>t.done));

    const sum = $('task-summary');
    if(sum){
      const done = TASKS.filter(t=>t.done).length;
      sum.textContent = TASKS.length ? (done+'/'+TASKS.length+' done') : 'None yet';
    }

    const live = $('task-list-live');
    if(live){
      live.innerHTML = TASKS.map(t=>
        '<button type="button" class="task-row live'+(t.done?' done':'')+'" data-id="'+t.id+'">'
        + '<span class="task-check">'+(t.done?'✓':'')+'</span>'
        + '<span class="task-text'+(t.done?' done':'')+'">'+esc(t.text)+'</span></button>'
      ).join('');
      live.querySelectorAll('.task-row').forEach(b=>{ b.onclick = ()=>tasksToggle(b.dataset.id); });
    }
  }

  /** Show the live checklist only while focusing, and only if there's anything on it. */
  function tasksRefresh(){
    const panel = $('task-live');
    if(!panel) return;
    const show = S.mode === 'focus' && TASKS.length > 0;
    panel.classList.toggle('hide', !show);
    if(show) tasksRender();
  }

  $('task-add').onclick = tasksAdd;
  $('task-clear').onclick = tasksClearDone;
  $('task-input').addEventListener('keydown', e=>{
    if(e.key === 'Enter'){ e.preventDefault(); tasksAdd(); }
  });

