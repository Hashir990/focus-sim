  /* ---------------- ZOOMING A BOARD ----------------

     Two games put a grid on a phone that does not fit one: a fifteen by fifteen
     scrabble board is about 22 pixels a square, and a thirty-wide picross is
     half that. Both had a zoom and both had the same fault, which is that they
     zoomed in *steps*.

     **A step is not what a pinch asks for.** Spreading two fingers is a
     continuous request, and answering it with "the nearest of four sizes"
     means the board jumps while the fingers are still moving, then jumps again
     when they lift. Scrabble had four fixed square sizes; picross tracked the
     pinch properly and then snapped to the nearest of six the moment a button
     was pressed, so the zoom you had chosen was a number the buttons could not
     express and they threw it away.

     So there are no steps here. A zoom is a number between 1 and a maximum,
     the pinch sets it directly, it stays exactly where the fingers left it,
     and the buttons nudge it by a ratio from wherever it happens to be. That
     is what the crossword app everyone has used does, and the reason it feels
     like moving a piece of paper rather than operating a control.

     This file is the part that is the same for both. What is not the same is
     everything else: scrabble sizes its squares in pixels and lets the wrapper
     scroll, picross does the same but has to hold its clue gutters against the
     edges as the picture moves underneath them. Those live with their games. */

  /** One press of + or -. A fifth either way: small enough that holding the
      button is a smooth ramp, big enough that one press is worth pressing. */
  const ZOOM_NUDGE = 1.2;

  /** What a double tap goes to, when it is not already in. */
  const ZOOM_DOUBLE = 2;

  /** Keep a number inside the range, and round off the floating-point dust so
      "is this the maximum" has a definite answer. */
  function zoomClamp(z, max){
    const n = Math.max(1, Math.min(max, Number(z) || 1));
    return Math.round(n * 1000) / 1000;
  }

  /** **The box is what the zoom really is.**

      A factor is what the fingers ask for; a whole number of pixels is what
      can actually be drawn. This takes the asked-for factor and the size a
      square is when the board just fits, and answers with the box to draw and
      the factor that box honestly represents. Everything else -- the label,
      whether the buttons are spent, what gets stored -- uses the answer rather
      than the question, so the number on screen and the number on the board
      are never two different things. */
  function zoomBox(fit, z, max){
    const base = Math.max(1, fit | 0);
    const cell = Math.max(base, Math.min(Math.round(base * max), Math.round(base * zoomClamp(z, max))));
    return {cell, zoom: Math.round((cell / base) * 1000) / 1000};
  }

  /** One press of a button, guaranteed to do something.

      Nudging by a ratio and then snapping to a whole box can land on the box
      it started from -- at 20px a fifth is 4px, but at the bottom of the range
      a fifth of a small square rounds to nothing. A button that visibly does
      nothing is a broken button, so when the ratio is too small to move the
      box, it is moved by a pixel instead. */
  function zoomStep(fit, z, dir, max){
    const base = Math.max(1, fit | 0);
    const now = zoomBox(base, z, max);
    const want = zoomBox(base, z * (dir > 0 ? ZOOM_NUDGE : 1 / ZOOM_NUDGE), max);
    if(want.cell !== now.cell) return want;
    return zoomBox(base, (now.cell + (dir > 0 ? 1 : -1)) / base, max);
  }

  /** What the label by the buttons says. Fit, rather than 1x, because at the
      bottom of the range the board is not scaled at all -- it is sized to the
      window, and that is a different fact about it. */
  function zoomLabel(z){
    if(z <= 1.001) return T('Fit');
    return (Math.round(z * 10) % 10 ? z.toFixed(1) : String(Math.round(z))) + '×';
  }

  /* **Double tap, which is the other half of what a phone expects.**

     Two taps in the same place within a third of a second: in if it is out,
     out if it is in. Worked out here rather than left to the browser, because
     `dblclick` does not fire reliably after a touch sequence the game has
     already captured, and because both of these boards treat a single tap as a
     move -- so the second tap has to be recognised without the first having
     been swallowed.

     The tolerance is deliberately tight. A double tap is two taps in one
     place; two taps an inch apart are two moves, and on a board of squares
     that distinction is the difference between zooming and playing. */
  function zoomDoubleTap(pane, get, set){
    if(!pane || pane._zoomTap) return;
    pane._zoomTap = true;
    let last = 0, lx = 0, ly = 0;
    pane.addEventListener('pointerup', (e)=>{
      if(e.pointerType === 'mouse') return;
      const now = Date.now();
      const near = Math.abs(e.clientX - lx) < 24 && Math.abs(e.clientY - ly) < 24;
      if(now - last < 320 && near){
        last = 0;
        const r = pane.getBoundingClientRect();
        const at = {x:e.clientX - r.left, y:e.clientY - r.top};
        set(get() > 1.001 ? 1 : ZOOM_DOUBLE, at);
        return;
      }
      last = now; lx = e.clientX; ly = e.clientY;
    }, {passive:true});
  }
