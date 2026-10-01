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
  function saveTasks(){
    try{ KV.set('focus_tasks', JSON.stringify(TASKS)); }catch(e){}
    // the blocking screen offers open tasks as something to do instead; see 50-guard.js
    try{ guardPushTasks(); }catch(e){}
  }

  function tasksAdd(){
    const inp = $('task-input');
    const text = (inp.value||'').trim();
    if(!text) return;
    TASKS.push({ id:'t'+Date.now()+'_'+(Math.random()*1e4|0), text, done:false });
    inp.value = '';
    saveTasks(); tasksRender();
  }
  function tasksRemove(id){
    const t = TASKS.find(x=>x.id===id);
    TASKS = TASKS.filter(x=>x.id!==id);
    tombstone(id);   // or the merge hands it back; see 14-util.js
    /* A task that came off the calendar is only removed from *today*. The plan
       entry stays, so a repeat comes back tomorrow as it should — deleting the
       rule is a thing you do in History, where the rule is. `sp` already has
       today marked, so it will not respawn this morning either. */
    saveTasks(); tasksRender(); tasksRefresh();
    if(t && t.from) toast('Off today’s list. The plan for it stays in History.');
  }

  /* Rename in place. A task is a line you wrote in a hurry, and the first thing
     you want after writing one is usually to fix it — before this the only way
     was to delete it and type the whole thing again. */
  function tasksEdit(id){
    const t = TASKS.find(x=>x.id===id);
    if(!t) return;
    askPrompt('Rename task', t.text, 'Save', (text)=>{
      const clean = (text || '').trim().slice(0, 90);
      if(!clean) return;
      t.text = clean;
      /* If it came off the calendar, the entry it came from is renamed too —
         otherwise tomorrow's copy comes back with the old wording. */
      if(t.from) try{
        const p = PLAN.find(x=>x.id === t.from);
        if(p){ p.text = clean; savePlan(); }
      }catch(e){}
      saveTasks(); tasksRender(); tasksRefresh();
    });
  }

  /** The hold menu every task row shares, wherever it is drawn. */
  function tasksMenu(id){
    return [
      {label:'Rename', run:()=>tasksEdit(id)},
      {label:'Remove', danger:true, run:()=>tasksRemove(id)},
    ];
  }
  function tasksClearDone(){
    TASKS.filter(t=>t.done).forEach(t=>tombstone(t.id));
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
    } else if(t.done && S.mode==='rest'){
      /* The break screen puts the list and the note one above the other, and
         ticking something off there used to go nowhere — it belonged to no
         block, said the old rule, so it wrote no note. But the block it belongs
         to is the one that just ended and is still on the screen above it:
         crossing a thing off in the minute after finishing it is the same
         statement as crossing it off in the minute before. So it goes into the
         note now, straight away, where it can be read and edited. */
      taskNoteAdd(t.text);
      buzz(30);
    } else if(!t.done){
      const i = TASKS_TICKED.indexOf(t.text);
      if(i !== -1) TASKS_TICKED.splice(i,1);
    }
    /* A task that came off the calendar is ticked in both places, so the day
       reads the same whether you look at it from the timer or from History. */
    if(t.from) try{ planTick(t.from, t.on, t.done); }catch(e){}
    saveTasks(); tasksRender();
    if(t.done && TASKS.length && TASKS.every(x=>x.done)) toast('All tasks done. Nice one');
  }

  /** Write one ticked task into the session note, and into the box showing it.

      The note belongs to the record, not to the textarea — the textarea is only
      how it is shown — so this edits `rec.note` and then puts the result back
      on screen.

      **It only ever adds.** Unticking does not go and delete a line again: by
      then the note is a thing somebody may have typed in and edited around, and
      quietly removing a line from what they wrote is worse than leaving one
      they can cross out themselves. Ticking twice is still only one line.

      Does nothing when there is no session to write to, which is the setup
      screen before the first block of the day. */
  function taskNoteAdd(text){
    const rec = S.lastLogId ? findLog(S.lastLogId) : null;
    if(!rec) return;
    const line = '✓ ' + text;
    const lines = (rec.note || '').split('\n');
    if(lines.indexOf(line) !== -1) return;
    // a note that is empty is one empty line, not no lines
    rec.note = (lines.length === 1 && lines[0] === '') ? line : rec.note + '\n' + line;
    saveLog();
    const inp = $('note-input');
    if(!inp || inp.value === rec.note) return;
    /* Somebody may be typing in it right now — on a phone a tap on a task does
       not always take the keyboard away. Put the caret back where it was rather
       than throwing them to the end of the note mid-sentence. */
    const caret = inp.selectionStart;
    inp.value = rec.note;
    if(document.activeElement === inp && caret != null){
      try{ inp.setSelectionRange(caret, caret); }catch(e){}
    }
  }

  /** Called at the end of a focus block: fold ticked tasks into that session's note. */
  /* Asked by the timer engine before it decides whether a very short block is
     worth a row in the history. Ticking something off is the clearest possible
     statement that the block was not nothing. */
  function tasksTickedCount(){ return TASKS_TICKED.length; }

  function tasksFlushToNote(){
    if(!TASKS_TICKED.length) return;
    /* Through the same one line at a time, rather than pasting the lot on the
       end. Two ways of writing the same line into the same note is how one of
       them ends up unable to find what the other wrote — and this one now has
       to agree with what ticking during the break already put there. */
    for(const text of TASKS_TICKED) taskNoteAdd(text);
    TASKS_TICKED = [];
  }

  function tasksRender(){
    const setup = $('task-list-setup');
    if(setup){
      setup.innerHTML = TASKS.length
        ? TASKS.map(t=>
            '<div class="task-row'+(t.from?' planned':'')+'">'
            + (t.at ? '<span class="task-at">'+esc(t.at)+'</span>' : '')
            + '<span class="task-text'+(t.done?' done':'')+'">'+esc(t.text)+'</span>'
            + '<button class="task-edit" data-id="'+t.id+'" aria-label="Rename task">✎</button>'
            + '<button class="task-x" data-id="'+t.id+'" aria-label="Remove task">×</button></div>'
          ).join('')
        : '<p class="task-empty">Optional. Anything you tick off during a session gets written into that session’s note. Plan one for a future day under History.</p>';
      // rows carry their id for the hold menu as well as for the buttons
      setup.querySelectorAll('.task-row').forEach((r, k)=>{
        if(TASKS[k]) r.dataset.id = TASKS[k].id;
      });
      setup.querySelectorAll('.task-x').forEach(b=>{ b.onclick = ()=>tasksRemove(b.dataset.id); });
      setup.querySelectorAll('.task-edit').forEach(b=>{ b.onclick = ()=>tasksEdit(b.dataset.id); });
      setup.querySelectorAll('.task-row').forEach(r=>{
        try{ holdMenu(r, ()=>tasksMenu(r.dataset.id)); }catch(e){}
      });
    }

    const clear = $('task-clear');
    if(clear) clear.classList.toggle('hide', !TASKS.some(t=>t.done));

    const sum = $('task-summary');
    if(sum){
      const done = TASKS.filter(t=>t.done).length;
      sum.textContent = TASKS.length ? (done+'/'+TASKS.length+' done') : 'None yet';
    }

    /* The rest screen shows what is left rather than the whole list. Ticking
       works the same way it does during focus — the only difference is that a
       task ticked off in a break belongs to no session, so it writes no note. */
    const rest = $('task-list-rest');
    if(rest){
      const left = TASKS.filter(t=>!t.done);
      rest.innerHTML = left.map(t=>
        '<button type="button" class="task-row live'+(t.from?' planned':'')+'" data-id="'+t.id+'">'
        + '<span class="task-check"></span>'
        + '<span class="task-text">'+esc(t.text)+'</span>'
        + (t.at ? '<span class="task-at">'+esc(t.at)+'</span>' : '')
        + '</button>'
      ).join('');
      rest.querySelectorAll('.task-row').forEach(b=>{
        b.onclick = ()=>tasksToggle(b.dataset.id);
        try{ holdMenu(b, ()=>tasksMenu(b.dataset.id)); }catch(e){}
      });
      const lbl = $('rest-task-label');
      if(lbl){
        lbl.innerHTML = left.length
          ? esc(T('Still to do')) + ' · <b>' + left.length + '</b>'
          : (TASKS.length ? 'All done' : 'Nothing on the list');
      }
    }

    const live = $('task-list-live');
    if(live){
      live.innerHTML = TASKS.map(t=>
        '<button type="button" class="task-row live'+(t.done?' done':'')+(t.from?' planned':'')+'" data-id="'+t.id+'">'
        + '<span class="task-check">'+(t.done?'✓':'')+'</span>'
        + '<span class="task-text'+(t.done?' done':'')+'">'+esc(t.text)+'</span>'
        + (t.at ? '<span class="task-at">'+esc(t.at)+'</span>' : '')
        + '</button>'
      ).join('');
      live.querySelectorAll('.task-row').forEach(b=>{
        b.onclick = ()=>tasksToggle(b.dataset.id);
        /* Hold or right-click to rename or remove, on the timer screens as well
           as in setup. Tapping still ticks it — the two gestures do not
           overlap, and ticking is what you are nearly always doing. */
        try{ holdMenu(b, ()=>tasksMenu(b.dataset.id)); }catch(e){}
      });
    }
  }

  /** Show the live checklist only while focusing, and only if there's anything on it. */
  function tasksRefresh(){
    const panel = $('task-live');
    if(panel){
      /* Shown for the whole of a focus block now, list or no list — the plus is
         the reason, the same as on the break screen. */
      const show = S.mode === 'focus';
      panel.classList.toggle('hide', !show);
      if(show) tasksRender();
    }
    /* The rest panel shows even with an empty list, because the plus is the
       point of it: a break is when you think of the next thing, and having to
       end the session to write it down is how it gets forgotten. */
    const box = $('rest-tasks');
    if(box){
      box.classList.toggle('hide', S.mode !== 'rest');
      if(S.mode === 'rest') tasksRender();
    }
  }

  /** Add from the timer screen — either phase. Same list, same store. */
  function tasksAddFrom(inputId){
    const inp = $(inputId);
    if(!inp) return;
    const text = (inp.value || '').trim();
    if(!text) return;
    TASKS.push({ id:'t'+Date.now()+'_'+(Math.random()*1e4|0), text, done:false });
    inp.value = '';
    saveTasks(); tasksRender(); tasksRefresh();
    buzz(20);
  }

  $('task-add').onclick = tasksAdd;
  $('task-clear').onclick = tasksClearDone;
  if($('rest-task-plus')) $('rest-task-plus').onclick = ()=>{
    const row = $('rest-task-add');
    const open = row.classList.contains('hide');
    row.classList.toggle('hide', !open);
    $('rest-task-plus').classList.toggle('on', open);
    if(open) $('rest-task-input').focus();
  };
  if($('rest-task-go')) $('rest-task-go').onclick = ()=>tasksAddFrom('rest-task-input');
  if($('rest-task-input')) $('rest-task-input').addEventListener('keydown', e=>{
    if(e.key === 'Enter'){ e.preventDefault(); tasksAddFrom('rest-task-input'); }
  });

  /* The same pair on the focus screen. Kept shut until asked for: a text field
     under the clock is an invitation to start typing instead of working. */
  if($('live-task-plus')) $('live-task-plus').onclick = ()=>{
    const row = $('live-task-add');
    const open = row.classList.contains('hide');
    row.classList.toggle('hide', !open);
    $('live-task-plus').classList.toggle('on', open);
    if(open) $('live-task-input').focus();
  };
  if($('live-task-go')) $('live-task-go').onclick = ()=>tasksAddFrom('live-task-input');
  if($('live-task-input')) $('live-task-input').addEventListener('keydown', e=>{
    if(e.key === 'Enter'){ e.preventDefault(); tasksAddFrom('live-task-input'); }
  });
  $('task-input').addEventListener('keydown', e=>{
    if(e.key === 'Enter'){ e.preventDefault(); tasksAdd(); }
  });

