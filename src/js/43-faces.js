  /* ---------------- clock faces ----------------
     Digital, analog, flip and hourglass. All four read the same two numbers —
     this file is only about *drawing* them, and it never touches the clock
     itself: `paint()` in 06-render.js still owns the arithmetic and calls
     `facePaint` with what it already worked out.

     **Only the face on screen is written to.** `paint()` runs once a second for
     the whole of a session, so three idle faces quietly updating would be three
     quarters of that work thrown away. The switch at the top of `facePaint` is
     the whole optimisation and it is worth keeping.

     The choice lives in `S.face` and rides along in the same record as the
     other settings (02-persistence.js). It is a preference, not progress, so
     Reset progress leaves it alone. */

  /* Faces are bought, like lights and sounds. Digital is free and always owned —
     an app that will not show you the time until you have earned it is a joke —
     and the other three are cheap, because a clock face is a smaller thing than
     a whole palette and weather system. Owned under a `face-` prefix in the same
     `Embers.own` list, exactly as sounds use `snd-`. */
  /* `ic` is the face drawn small, for the shelf. Every tile there used to be
     the same accent circle, which told you a face costs embers and nothing
     else — four identical dots under four different names. Drawn at 24, in
     `currentColor`, like the antics' icons and the wardrobe's. */
  const FACES = [
    {id:'digital', name:'Digital',   note:'The numbers, plainly',        cost:0,
     ic:'<rect x="1.4" y="6.6" width="8.2" height="10.8" rx="1.8" fill="currentColor"/>'
        + '<rect x="14.4" y="6.6" width="8.2" height="10.8" rx="1.8" fill="currentColor"/>'
        + '<circle cx="12" cy="9.8" r="1.15" fill="currentColor"/>'
        + '<circle cx="12" cy="14.2" r="1.15" fill="currentColor"/>'},
    {id:'analog',  name:'Analog',    note:'Hands, sweeping down',        cost:280,
     ic:'<circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" stroke-width="1.8"/>'
        + '<path d="M12 6.2V12l4.4 2.8" fill="none" stroke="currentColor" stroke-width="1.8"'
        + ' stroke-linecap="round" stroke-linejoin="round"/>'},
    {id:'flip',    name:'Flip',      note:'Cards turning, one a digit',  cost:80,
     /* The card mid-turn: the hinge bright across the middle, the leaf above it
        foreshortened as it falls. A card drawn square is a rectangle, and the
        fold is the only part that says flip clock. */
     ic:'<rect x="3" y="4" width="18" height="16" rx="2.4" fill="currentColor" opacity=".38"/>'
        + '<path d="M4.6 11.1H19.4L18.2 7.2Q17.8 6 16.4 6H7.6Q6.2 6 5.8 7.2Z" fill="currentColor"/>'
        + '<path d="M3 12h18" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>'
        + '<circle cx="2.2" cy="12" r="1.2" fill="currentColor"/>'
        + '<circle cx="21.8" cy="12" r="1.2" fill="currentColor"/>'},
    {id:'glass',   name:'Hourglass', note:'Sand running through',        cost:500,
     ic:'<path d="M5.6 2.8h12.8M5.6 21.2h12.8" stroke="currentColor" stroke-width="1.8"'
        + ' stroke-linecap="round" fill="none"/>'
        + '<path d="M7.4 4.2h9.2L12 12l4.6 7.8H7.4L12 12Z" fill="currentColor" opacity=".55"/>'
        + '<path d="M12 12 8.6 18.4h6.8Z" fill="currentColor"/>'},
  ];
  const EMB_FACE = 'face-';
  function faceDef(id){ return FACES.find(f=>f.id === id) || FACES[0]; }
  function faceHas(id){
    const f = FACES.find(x=>x.id === id);
    if(!f) return false;
    if(f.cost === 0) return true;
    try{ return Embers.own.indexOf(EMB_FACE + id) >= 0; }catch(e){ return false; }
  }
  /* Valid *and* owned. A face you no longer own — after a reset — falls back to
     digital rather than leaving the dial empty. */
  function faceOk(id){ return faceHas(id) ? id : 'digital'; }

  /* The tick marks, built once. Twelve of them, four long — drawing sixty would
     be a watchmaker's dial at a size where they would merge into a grey ring. */
  function faceTicks(){
    const g = $('fa-ticks');
    if(!g || g.childNodes.length) return;
    let out = '';
    for(let i = 0; i < 12; i++){
      const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
      const r1 = i % 3 === 0 ? 37 : 41, r2 = 45;
      out += '<line class="' + (i % 3 === 0 ? 'q' : '') + '"'
        + ' x1="' + (50 + Math.cos(a) * r1).toFixed(1) + '" y1="' + (50 + Math.sin(a) * r1).toFixed(1) + '"'
        + ' x2="' + (50 + Math.cos(a) * r2).toFixed(1) + '" y2="' + (50 + Math.sin(a) * r2).toFixed(1) + '"/>';
    }
    g.innerHTML = out;
  }

  /* The grains, built once. A dozen circles on a dozen different clocks — the
     illusion is entirely in their being out of step, so the delays are spread
     across the fall time rather than evenly, and each gets its own speed and a
     little sideways drift. Two pixels each; together they are a stream. */
  function faceGrains(){
    const g = $('hg-grains');
    if(!g || g.childNodes.length) return;
    let out = '';
    for(let i = 0; i < 12; i++){
      const dur = 0.62 + (i % 5) * 0.09;                 // 0.62s .. 0.98s
      const delay = -(i * 0.081 + (i % 3) * 0.037);      // negative: already falling
      const x = 50 + ((i % 4) - 1.5) * 0.9;              // a hair off centre
      out += '<circle class="hg-grain" cx="' + x.toFixed(2) + '" cy="0" r="'
        + (0.85 + (i % 3) * 0.22).toFixed(2) + '"'
        + ' style="animation-duration:' + dur.toFixed(2) + 's;animation-delay:'
        + delay.toFixed(3) + 's"/>';
    }
    g.innerHTML = out;
  }

  function faceApply(){
    const app = $('app');
    if(app) app.setAttribute('data-face', faceOk(S.face));
    faceTicks();
    faceGrains();
    faceRender();
    /* Repaint at once rather than waiting up to a second for the next tick —
       switching face and watching an empty dial is the sort of thing that reads
       as the setting not having worked. */
    try{ paint(); }catch(e){}
  }

  /* Choosing one you own switches to it; choosing one you do not asks to buy it,
     the same shape of question the lights and the sounds ask. */
  function faceSet(id){
    const f = faceDef(id);
    if(faceHas(f.id)){ S.face = f.id; save(); faceApply(); return; }
    const fn = LANG === 'en' ? f.name.toLowerCase() : T(f.name);
    if(Embers.have < f.cost){ toast(T('{n} embers for the {face} face', {n:f.cost, face:fn})); return; }
    askConfirm(T('Unlock the {face} face?', {face:fn}),
      T('{n} embers, and it is yours for good. You can switch between any face you have whenever you like.', {n:f.cost}),
      T('Spend {n}', {n:f.cost}), ()=>{
        if(Embers.have < f.cost) return;
        Embers.have -= f.cost;
        Embers.own.push(EMB_FACE + f.id);
        Embers.save(); Embers.render();
        S.face = f.id; save(); faceApply();
        toast(T('The {face} face is yours', {face:fn}));
      });
  }

  let FACE_LAST = ['', '', '', ''];
  let FACE_CARDS = [];

  /** Called every tick from paint(), with the numbers it already has. */
  function facePaint(m, s, frac){
    const f = faceOk(S.face);
    if(f === 'digital') return;          // the digits are painted by paint()

    if(f === 'analog'){
      /* Minutes remaining round the face, seconds round it once a minute. The
         second hand is put back to the top without a transition on the tick it
         wraps, or it unwinds the long way round through fifty-nine seconds. */
      const min = $('fa-min'), sec = $('fa-sec');
      if(min) min.style.transform = 'rotate(' + ((m % 60) * 6).toFixed(2) + 'deg)';
      if(sec){
        const wrapped = s === 0;
        sec.classList.toggle('jump', wrapped);
        sec.style.transform = 'rotate(' + (s * 6).toFixed(2) + 'deg)';
      }
      return;
    }

    if(f === 'flip'){
      /* Digit by digit. Comparing whole numbers turned both cards whenever
         either changed, which is not what a flip clock does — the tens of
         minutes is still for ten minutes at a time. Each card is compared,
         written and sounded on its own, so a normal second is one quiet tick
         and 09:59 → 10:00 is the four-card clatter it ought to be. */
      const digits = (pad(m) + pad(s)).split('');
      const cards = FACE_CARDS.length ? FACE_CARDS
        : (FACE_CARDS = [...document.querySelectorAll('#face-flip .ff-card')]);
      for(let i = 0; i < cards.length && i < 4; i++){
        if(digits[i] === FACE_LAST[i]) continue;
        cards[i].textContent = digits[i];
        faceTurn(cards[i]);
        FACE_LAST[i] = digits[i];
        try{ paper(); }catch(e){}
      }
      return;
    }

    if(f === 'glass'){
      /* `frac` is how much is *left*. The bulbs are 52 units deep between the
         cap and the neck, and the upper one drains from its own top edge
         downward, which is why its `y` moves as well as its height.

         **The break turns the glass over**, and the CSS rotates the whole face
         to say so — so the two bulbs swap roles. Rotating without swapping
         would leave the sand climbing upwards, which is not something an
         hourglass does whichever way up it is. */
      const left = Math.max(0, Math.min(1, frac));
      const over = (typeof S === 'object' && S.mode === 'rest');
      const upper = over ? 1 - left : left;
      /* Each bulb is one path: a curved surface, then straight down to the
         neck or the base. Both are drawn wider than the glass and clipped to
         it, so the sides never need working out.

         This was a rectangle with an ellipse laid over it for the curve — the
         upper one filled with `--bg` to dish the surface, the lower one with
         the sand colour to heap it. Two fills for one material, and the dished
         one could never match what was behind it, so the top surface read as a
         grey lens sitting on the sand.

         The curve is one quadratic and deliberately shallow: sand at this size
         is very nearly flat, and what sells it is a slight dish where it runs
         out and a slight heap where it lands, not a pair of domes. It flattens
         towards empty and towards full as well, because a heap standing proud
         of a bulb holding almost nothing is a bump floating in a glass. */
      const top = $('hg-sand-top'), bot = $('hg-sand-bot');
      const sag = (x)=> 3.4 * Math.sin(Math.PI * Math.max(0, Math.min(1, x)));

      /* **Sand lies on the low edge, and turning the glass over moves it.**

         Swapping which bulb fills was only half of it. Each bulb's sand was
         drawn as a band held against a fixed edge - the upper one against the
         neck, the lower one against the base - which is right way up and
         upside down when the stylesheet turns the face through 180 degrees:
         the neck and the base are then the *high* edges of their bulbs, so the
         sand hung off the ceiling of one and dangled from the neck of the
         other. That is the "sand collecting at the top" during a break, and no
         amount of swapping fixes it, because the amounts were never the wrong
         way round - the gravity was.

         So each bulb is told which edge the sand rests on and which way its
         surface grows from there, and both flip when the glass does:

           upright   upper bulb rests on the neck, lower bulb on the base
           turned    the cap and the neck are the low edges instead

         `dish` is the shape of the free surface - hollow in the bulb that is
         draining, heaped in the one that is filling - and it is expressed
         relative to `dir`, so it turns over with everything else rather than
         needing its own case. The band always stands 2 units proud of its
         edge, which is what keeps a nearly-empty bulb from vanishing. */
      const bulb = (el, edge, dir, amount, heap)=>{
        if(!el) return;
        const a = Math.max(0, Math.min(1, amount));
        const y = edge + dir * (2 + 52 * a);
        const c = y + dir * 2 * sag(a) * (heap ? 1 : -1);
        el.setAttribute('d', 'M18 ' + y.toFixed(2)
          + 'Q50 ' + c.toFixed(2) + ' 82 ' + y.toFixed(2)
          + 'L82 ' + edge + 'L18 ' + edge + 'Z');
      };
      if(over){
        bulb(top, 12, 1, upper, true);          // now the lower bulb: heaped on the cap
        bulb(bot, 66, 1, 1 - upper, false);     // now the upper bulb: dished at the neck
      }else{
        bulb(top, 66, -1, upper, false);        // draining into the neck
        bulb(bot, 118, -1, 1 - upper, true);    // heaping on the base
      }
      /* **Sand that has landed goes over sand that is still falling.**
         SVG paints in document order and has no z-index, so the only way to put
         the stream behind the heap is to move it — and which bulb is the heap
         depends on which way up the glass is. Two `insertBefore`s, and only when
         it is actually on the wrong side, because this runs once a second. */
      const grains = $('hg-grains');
      if(grains && top && bot){
        const want = over ? top : bot;
        if(grains.nextSibling !== want) want.parentNode.insertBefore(grains, want);
      }
      /* Grains only fall while the clock is going. Written on #app rather than
         toggled per element so the CSS can decide what else it means. */
      const app = $('app');
      if(app) app.setAttribute('data-run', S.running ? '1' : '0');
    }
  }

  function faceTurn(el){
    el.classList.remove('turn');
    void el.offsetWidth;                 // restart the animation
    el.classList.add('turn');
  }

  /** The picker in the menu. */
  function faceRender(){
    const box = $('face-pick');
    if(!box) return;
    const on = faceOk(S.face);
    /* The same chip the ambience picker uses, for the same reason: these are
       one-of-N choices where some are still to be bought, which is exactly what
       that control already says. `data-cost` becomes the second line through
       `.amb-btn.locked::after`, so a price appears where the name's second line
       would be — nothing here needs its own idea of what "locked" looks like. */
    box.innerHTML = FACES.map(f=>{
      const mine = faceHas(f.id);
      let cls = 'amb-btn';
      if(f.id === on) cls += ' on';
      if(!mine) cls += ' locked';
      return '<button class="' + cls + '" data-face-pick="' + f.id + '"'
        + (mine ? '' : ' data-cost="' + f.cost + ' embers"')
        + ' title="' + esc(f.note) + '">' + f.name + '</button>';
    }).join('');
  }

  document.addEventListener('click', (e)=>{
    const b = e.target.closest && e.target.closest('[data-face-pick]');
    if(b) faceSet(b.getAttribute('data-face-pick'));
  });
