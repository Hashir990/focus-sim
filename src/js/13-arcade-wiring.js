  /* ---------- arcade wiring ---------- */
  $('arcade-open').onclick = ()=>Arcade.show();
  $('ov-back').onclick = ()=>Arcade.back();
  document.querySelectorAll('.pcard').forEach(c=>c.onclick=()=>Arcade.pick(c.dataset.game));
  $('sdk-again').onclick = ()=>Sudoku.newGame(Sudoku.diff);
  $('wdl-new').onclick = ()=>Wordle.newGame();
  $('wdl-again').onclick = ()=>Wordle.newGame();
  $('g2048-new').onclick = ()=>G2048.newGame();
  $('g2048-again').onclick = ()=>G2048.newGame();
  $('cw-check').onclick = ()=>Cross.check();
  $('cw-again').onclick = ()=>Cross.newGame(Cross.diff);
  $('mem-new').onclick = ()=>Memory.newGame();
  $('mem-again').onclick = ()=>Memory.newGame();

