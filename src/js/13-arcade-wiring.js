  /* ---------- arcade wiring ---------- */
  $('arcade-open').onclick = ()=>Arcade.show();
  $('ov-back').onclick = ()=>Arcade.back();
  document.querySelectorAll('.pcard').forEach(c=>{
    c.onclick = ()=>Arcade.pick(c.dataset.game);
    // hold or right-click a card to start that game over without opening it
    holdMenu(c, ()=>arcadeResetItems(c.dataset.game));
  });
  /* **The archive, not another go.** These buttons only ever appear on a
     puzzle you have just finished, and today's edition of it is spent — so
     "New puzzle" was a promise the one-a-day rule would not keep. */
  $('sdk-again').onclick = ()=>dailyCalOpen('sudoku');
  $('wdl-new').onclick = ()=>Wordle.newGame();
  $('wdl-again').onclick = ()=>dailyCalOpen('wordle');
  $('g2048-new').onclick = ()=>G2048.newGame();
  $('g2048-again').onclick = ()=>G2048.newGame();
  $('cw-check').onclick = ()=>Cross.check();
  $('cw-dir').onclick = ()=>Cross.toggleDir();
  $('cw-again').onclick = ()=>Cross.nextPuzzle();
  $('cw-hint').onclick = ()=>Cross.hint();
  /* The same journey Tab and shift-Tab make, for the phones that have neither. */
  $('cw-prev').onclick = ()=>Cross.nextClue(-1);
  $('cw-next').onclick = ()=>Cross.nextClue(1);
  $('cw-list').onclick = ()=>Cross.openPicker();
  $('mem-new').onclick = ()=>Memory.newGame();
  $('mem-again').onclick = ()=>Memory.newGame();

