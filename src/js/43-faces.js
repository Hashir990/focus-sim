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
  const FACES = [
    {id:'digital', name:'Digital',   note:'The numbers, plainly',        cost:0},
    {id:'analog',  name:'Analog',    note:'Hands, sweeping down',        cost:40},
    {id:'flip',    name:'Flip',      note:'Cards turning, one a digit',  cost:20},
    {id:'glass',   name:'Hourglass', note:'Sand running through',        cost:60},
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
    if(Embers.have < f.cost){ toast(f.cost + ' embers for the ' + f.name.toLowerCase() + ' face'); return; }
    askConfirm('Unlock the ' + f.name.toLowerCase() + ' face?',
      f.cost + ' embers, and it is yours for good. You can switch between any '
      + 'face you have whenever you like.',
      'Spend ' + f.cost, ()=>{
        if(Embers.have < f.cost) return;
        Embers.have -= f.cost;
        Embers.own.push(EMB_FACE + f.id);
        Embers.save(); Embers.render();
        S.face = f.id; save(); faceApply();
        toast('The ' + f.name.toLowerCase() + ' face is yours');
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
      if(top){
        const y = 12 + (52 - 52 * upper), d = sag(upper);
        // dished: the control point sits *below* the rim, twice the sag deep
        top.setAttribute('d', 'M18 ' + y.toFixed(2)
          + 'Q50 ' + (y + d * 2).toFixed(2) + ' 82 ' + y.toFixed(2)
          + 'L82 66L18 66Z');
      }
      if(bot){
        const y = 116 - 52 * (1 - upper), d = sag(1 - upper);
        // heaped: the same curve, the other way up
        bot.setAttribute('d', 'M18 ' + y.toFixed(2)
          + 'Q50 ' + (y - d * 2).toFixed(2) + ' 82 ' + y.toFixed(2)
          + 'L82 118L18 118Z');
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
