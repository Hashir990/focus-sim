  /* ---------------- THE DEVELOPER HOOK ----------------
     One function, and it only exists in the developer build.

     Everything in this app lives inside a single closure, which is deliberate:
     nothing on the page can reach into the timer or the games, so nothing on the
     page can put them into a state they could not reach by being played. That is
     also what makes the dev bar in `dist/dev-unlocked.html` awkward — it is a
     script on the page, so it can click buttons and read the DOM and that is
     all. Filling a sudoku by clicking eighty-one squares is not a debugging
     tool, it is a second implementation of sudoku.

     So the closure offers one door, and only when the page says it is the
     developer copy. `tools/dev-build.mjs` sets `data-dev="1"` on <html>; the
     shipped `index.html` never has it, so `window.devFill` is not defined there
     and there is nothing to find.

     What it does is finish whichever board is open — the point being to reach
     the end of a game without playing it, so the win banner, the achievement it
     pays and the progress line on the card can all be looked at in the ten
     seconds after changing them, rather than the forty minutes.

     The shared games are not here. Their state belongs to whoever is hosting
     and arrives over the wire; a local override would be a lie the host would
     immediately correct. */

  function devFill(){
    if(!Arcade.open) return 'No game is open.';
    const which = Arcade.active;

    if(which === 'sudoku'){
      Sudoku.grid = Sudoku.sol.slice();
      Sudoku.notes = Sudoku.notes.map(()=>[]);
      Sudoku.render();
      Sudoku.checkDone();
      return 'Sudoku solved.';
    }

    if(which === 'crossword'){
      /* Straight from the grid's own answers, then the ordinary completion
         path — so it counts, banners, and saves exactly as a solved one does. */
      for(let i = 0; i < Cross.user.length; i++){
        const sol = Cross._solAt(i);
        if(sol) Cross.user[i] = sol;
      }
      Cross.render();
      Cross.checkDone();
      return 'Crossword filled in.';
    }

    if(which === 'wordle'){
      Wordle.cur = Wordle.answer;
      Wordle.submit();
      return 'Word guessed: ' + Wordle.answer.toUpperCase();
    }

    if(which === 'memory'){
      Memory.matched = Memory.matched.map(()=>true);
      Memory.flipped = [];
      Memory.done = true;
      Memory.stop();
      Memory.persist();
      Memory.render();
      try{ showBanner('mem-banner', 'All matched.', Memory._summary()); }catch(e){}
      return 'Memory cleared.';
    }

    if(which === 'g2048'){
      /* A board one move from 2048, rather than a board *with* 2048 on it: the
         tile has to be made by a merge for the mark to fire, and watching it
         merge is usually the thing being checked anyway. */
      G2048.board = [1024, 1024, 512, 256,
                     256, 128, 64, 32,
                     32, 16, 8, 4,
                     4, 2, 0, 0];
      G2048.score = Math.max(G2048.score, 9000);
      G2048._tilesFromBoard();
      G2048.persist();
      G2048.render();
      return 'Board set — one move left will make 2048.';
    }

    return 'Nothing to fill in ' + which + ' on your own; it needs a room.';
  }

  /* The door, and only in the developer copy. */
  try{
    if(document.documentElement.getAttribute('data-dev') === '1'){
      window.devFill = devFill;
    }
  }catch(e){}

  /* ---------------- storage, in numbers ----------------

     **A store that has stopped accepting writes looks exactly like one that is
     working.** Nothing throws where anyone can see it: `localStorage.setItem`
     raises, `KV.set` caught it, `writeGame` caught it again, and the only sign
     was a board coming back empty an hour later. Three separate puzzle bugs
     were chased before that was the answer — boards not surviving a difficulty
     switch, a crossword losing its letters on close, a sudoku opening with no
     clues in it. All one cause, and none of them a puzzle bug.

     So: how much is in there, what the biggest few keys are, and whether the
     last write actually landed. Anybody can read it, because anybody can be the
     one it is happening to. */
  function storageBytes(n){
    if(n < 1024) return n + ' B';
    if(n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    return (n / 1048576).toFixed(1) + ' MB';
  }
  function storageLine(){
    const el = $('storage-note');
    if(!el) return;
    let r = null;
    try{ r = KV.report(); }catch(e){}
    if(!r){ el.textContent = ''; return; }
    /* A live probe, not a guess: write a byte and read it back. A full store
       fails here and nowhere else the user can see. */
    let writable = false;
    try{
      localStorage.setItem('focus_probe', String(Date.now()));
      writable = !!localStorage.getItem('focus_probe');
      localStorage.removeItem('focus_probe');
    }catch(e){ writable = false; }
    const top = r.rows.slice(0, 3)
      .map(x=>x.k.replace(/^focus_|^arcade_/, '') + ' ' + storageBytes(x.n)).join(' · ');
    el.textContent = (writable ? 'Saving normally' : 'NOT SAVING — this device’s store is full or blocked')
      + ' · ' + storageBytes(r.total) + ' used'
      + (top ? ' · ' + top : '')
      + (r.err ? ' · last error ' + r.err : '');
    el.classList.toggle('bad', !writable);
  }
  try{
    const b = $('d-storage');
    if(b) b.onclick = ()=>{ storageLine(); };
    /* Filled once on load too, so somebody who opens the menu to find out why
       their game vanished does not have to know to press anything. */
    setTimeout(()=>{ try{ storageLine(); }catch(e){} }, 1200);
  }catch(e){}
