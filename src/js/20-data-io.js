  /* ---------- moving your data ----------

     **There used to be Export and Import buttons here, and there is an account
     instead.** They existed because every packaged build has its own private
     storage — a phone app cannot read what a browser tab wrote — so the only
     bridge between two copies was a file you carried by hand. Signing in does
     that now, continuously and in both directions, which is the same job done
     without asking anybody to remember to do it. Two buttons that most people
     pressed by accident, and a file format to keep working, for a problem that
     is solved.

     `resetProgress` stays: it is not a backup feature, it is the way out. */
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
      + 'saved game go. Settings, friends and quotes stay. There is no undo. '
      + 'If you are signed in, this device is emptied and the account is not.',
      'Reset it all', resetProgress);
  };

