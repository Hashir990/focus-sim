  /* ---------- arcade wiring ---------- */
  $('arcade-open').onclick = ()=>Arcade.show();
  $('ov-back').onclick = ()=>Arcade.back();
  document.querySelectorAll('.pcard').forEach(c=>{
    c.onclick = ()=>Arcade.pick(c.dataset.game);
    // hold or right-click a card to start that game over without opening it
    holdMenu(c, ()=>arcadeResetItems(c.dataset.game));
  });
  $('sdk-again').onclick = ()=>Sudoku.newGame(Sudoku.diff);
  $('wdl-new').onclick = ()=>Wordle.newGame();
  $('wdl-again').onclick = ()=>Wordle.newGame();
  $('g2048-new').onclick = ()=>G2048.newGame();
  $('g2048-again').onclick = ()=>G2048.newGame();
  $('cw-check').onclick = ()=>Cross.check();
  $('cw-dir').onclick = ()=>Cross.toggleDir();
  $('cw-again').onclick = ()=>Cross.nextPuzzle();
  $('cw-hint').onclick = ()=>Cross.hint();
  $('cw-list').onclick = ()=>Cross.openPicker();
  $('cw-picker-close').onclick = ()=>Cross._closePicker();
  $('mem-new').onclick = ()=>Memory.newGame();
  $('mem-again').onclick = ()=>Memory.newGame();

