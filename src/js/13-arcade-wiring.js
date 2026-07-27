  /* ---------- arcade wiring ---------- */
  $('arcade-open').onclick = ()=>Arcade.show();
  $('ov-back').onclick = ()=>Arcade.back();
  document.querySelectorAll('.pcard').forEach(c=>c.onclick=()=>Arcade.pick(c.dataset.game));
  $('sdk-again').onclick = ()=>Sudoku.newGame(Sudoku.diff);
  $('wdl-new').onclick = ()=>Wordle.newGame();
  $('wdl-again').onclick = ()=>Wordle.newGame();

