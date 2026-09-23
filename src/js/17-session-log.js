  /* --- session log --- */
  let LOG=[];
  async function loadLog(){
    const r=await KV.get('focus_log'); if(r&&r.value){ try{ LOG=JSON.parse(r.value)||[]; }catch(e){} }
    /* A block that was still running when the app last closed. Its seconds are
       real and were already paid for as they happened; the only thing missing is
       an ending, and it was never a whole one or it would have closed itself. */
    let dirty = false;
    const keep = [];
    for(const rec of LOG){
      if(rec && rec.open){
        dirty = true;
        delete rec.open;
        rec.full = false;
        if((rec.secs|0) < 30) continue;      // too little to be worth a row
      }
      keep.push(rec);
    }
    if(dirty){ LOG = keep; saveLog(); }
  }
  function saveLog(){ KV.set('focus_log', JSON.stringify(LOG)); }
  function findLog(id){ return LOG.find(r=>r.id===id); }
  /* `with` is whoever else was in the room when the block finished. Names, not
     ids — ids are per-connection and would be meaningless a week later in the
     calendar. It's absent, not empty, on solo sessions, so old records and new
     solo ones read the same. */
  /* `full` says the block ran its clock all the way down, rather than being
     skipped or stopped part way. Everything is written to history either way —
     twenty minutes you really did are twenty minutes — but the achievements
     only count blocks you let finish, so that "two hundred blocks" means two
     hundred blocks rather than two hundred taps on Skip. See 40-achievements.js.
     Records written before this existed have no `full` at all, and are read as
     whole blocks so that nobody's history is quietly demoted. */
  /* ---- the block being written while it runs ----
     History used to be written once, at the end. That is fine until a block does
     not get one: a follower whose room closes mid-session, an app quit with the
     clock going, a phone that sleeps and never comes back. All of that focus
     really happened and none of it was recorded — which is what "my stats
     sometimes don't update in someone else's room" actually was. A follower only
     writes history when the leader's mode *changes*, so a room that simply ends
     wrote nothing at all.

     So the record is created on the first tick of a focus block and updated as
     it goes; ending it only closes it. Embers accrue with it rather than in one
     lump, which is also what puts the tenth minute's ember on screen while you
     are sat looking at it instead of a quarter of an hour later.

     Paid in five-second chunks: small enough that the ember lands within a
     breath of the ten minutes, large enough that this is not a disk write every
     second. Ten minutes is 120 exact chunks, so a clean run pays on the second. */
  let OPEN = null;          // id of the record currently accruing
  let OPEN_PAID = 0;        // seconds of it already handed to Embers
  let OPEN_SAVED = 0;       // seconds of it already written to disk
  let OPEN_MUTE = false;    // a reset happened mid-block: leave this one alone
  const OPEN_CHUNK = 5;     // how often embers are settled — a tiny object
  /* How often the *log* is written, which is a different question. Saving it
     serialises every session you have ever had, so doing that on the ember
     cadence meant stringifying a growing array twelve times a minute for the
     whole block. Thirty seconds is still far finer than the old behaviour of
     writing once at the end, and the close always writes. */
  const OPEN_SAVE_EVERY = 30;

  function logProgress(secs){
    const now = Math.max(0, Math.round(secs || 0));
    /* A block always starts at zero, so that is where a reset's silence ends —
       the next block is a new one and nobody asked for it to be forgotten. */
    if(now === 0) OPEN_MUTE = false;
    if(OPEN_MUTE && !OPEN) return;
    let rec = OPEN ? findLog(OPEN) : null;
    if(!rec){
      // stamped when the block began, not when we first noticed it
      const ts = Date.now() - now * 1000;
      /* `at` is when this row was last written, as opposed to `ts` which is
         when the block began. Two devices merging need to know which of two
         observations of the same block is the later one — see 47-merge.js. */
      rec = {id:'s'+ts+'_'+(Math.random()*1e4|0), ts, at:Date.now(), day:dayKey(ts), secs:0,
             note:'', full:false, open:true};
      LOG.push(rec); S.lastLogId = rec.id;
      OPEN = rec.id; OPEN_PAID = 0; OPEN_SAVED = 0;
      /* Written straight away, once, rather than waiting for the first throttled
         save. It costs one disk write per block and it is the whole point: if
         the app dies three seconds in, there is a block on disk saying so. */
      saveLog();
    }
    if(now < rec.secs) return;     // a clock that went backwards is not progress
    rec.secs = now;
    rec.at = Date.now();
    /* Re-read every time: people join and leave a room mid-block, and who you
       actually sat with is the set at the end, not the set at the start. */
    const others = syncCompanions();
    if(others.length) rec.with = others; else delete rec.with;

    if(now - OPEN_PAID >= OPEN_CHUNK){
      const delta = now - OPEN_PAID;
      OPEN_PAID = now;
      try{ Embers.earn(delta); }catch(e){}
    }
    if(now - OPEN_SAVED >= OPEN_SAVE_EVERY){ OPEN_SAVED = now; saveLog(); }
  }

  /* Write the open block to disk *now*, ignoring the throttle. For the moment
     the app is about to be put in a pocket or killed: normally the log is saved
     every thirty seconds, which is generous while we are running and useless if
     the next thing that happens is the OS reclaiming us. See 45-notify.js. */
  function logFlush(){
    if(!OPEN) return;
    OPEN_SAVED = 0;
    saveLog();
  }

  /** Give the open block an ending. `full` means its clock ran all the way out. */
  function logClose(full){
    const rec = OPEN ? findLog(OPEN) : null;
    OPEN = null; OPEN_MUTE = false;
    if(!rec) return;
    delete rec.open;
    rec.full = !!full;
    rec.at = Date.now();
    /* Whatever had not reached a whole chunk yet — banked, never rounded up.
       Settled even when it is nothing: `earn(0)` is how the ember record gets
       written at all, and skipping the call on a block too short to pay left the
       bank unsaved. */
    const left = Math.max(0, rec.secs - OPEN_PAID);
    OPEN_PAID = 0; OPEN_SAVED = 0;
    try{ Embers.earn(left); }catch(e){}
    saveLog();
    /* A block just ended, which is the only moment there is something new worth
       carrying to another device. Quiet, and nothing waits on it. */
    try{ Account.sync(true); }catch(e){}
  }

  /* Throw the open block away instead of closing it. Only for the two paths
     that deliberately record nothing — stopping outright inside the first half
     minute, and a follower watching the same thing happen. Everything else
     keeps its row however short it was: a block you skipped after ten seconds
     is still ten seconds you sat there, and it always went into history.

     What it does *not* take back is embers already paid. Those seconds really
     passed, and nothing here can be farmed by a person willing to sit still. */
  /* Let go of the open block without touching the log — for a reset, which is
     about to empty the log itself. Without it the next tick finds its record
     missing and writes a new one, which is history reappearing after somebody
     asked for it to go. `logProgress` will open a fresh block on the next tick
     if focus is still running, and that is correct: that time is still passing. */
  function logForget(){ OPEN = null; OPEN_PAID = 0; OPEN_SAVED = 0; OPEN_MUTE = true; }

  function logDrop(){
    const rec = OPEN ? findLog(OPEN) : null;
    OPEN = null; OPEN_PAID = 0; OPEN_SAVED = 0; OPEN_MUTE = false;
    if(!rec) return;
    LOG = LOG.filter(r=>r !== rec);
    if(S.lastLogId === rec.id) S.lastLogId = null;
    saveLog();
  }

  /* Kept for the three places that end a block — the engine finishing, the
     engine stopping, and a follower watching the leader leave focus. They pass
     the total and the verdict exactly as before; the accrual above has usually
     recorded most of it already, and this settles the remainder and closes. */
  function logSession(secs, full){
    logProgress(secs);
    logClose(full);
  }

  /** "Sam", "Sam and Ali", "Sam, Ali and Jo" — for reading, not for parsing. */
  function namesList(list){
    const n = (list||[]).filter(Boolean);
    if(!n.length) return '';
    if(n.length === 1) return n[0];
    if(LANG !== 'en') return langAnd(n);
    return n.slice(0,-1).join(', ') + ' and ' + n[n.length-1];
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

