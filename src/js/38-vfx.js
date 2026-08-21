  /* ---------------- the weather ----------------
     Builds the particles the pane in 31-vfx.css animates.

     Everything irregular about an effect is decided here — where each speck
     starts, how big it is, how long it takes, how far it drifts, how much it
     turns over, when it began. That is the difference between weather and
     wallpaper: the first attempt used tiled gradients, and a tile repeats, so
     it read as a marching grid of identical dots.

     Particles are rebuilt only when the effect actually changes. Re-rolling the
     random numbers on every render would make the whole field jump each time
     the clock ticked. */

  const VFX_KEY = 'focus_vfx';
  const VFX_ON = {on:true};            // the switch in the menu

  /* ---- how much weather this machine should be asked for ----
     Every speck is an element the compositor animates for as long as the app is
     open, so the count is the one number that decides whether the effect is
     free or expensive. A desktop with eight cores does not notice thirty; a
     two-core laptop with four gigabytes does, and it is exactly the machine
     somebody is most likely to be running this on all afternoon.

     Both hints are advisory and both are missing in some browsers, so the
     default is the full count and the reduction only happens on a machine that
     has *said* it is small. `prefers-reduced-motion` is a stronger statement
     than either, and halves it again. */
  function vfxScale(){
    let f = 1;
    try{
      const cores = navigator.hardwareConcurrency || 8;
      const gb = navigator.deviceMemory || 8;
      if(cores <= 2 || gb <= 2) f = 0.45;
      else if(cores <= 4 || gb <= 4) f = 0.7;
      if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){
        f *= 0.5;
      }
    }catch(e){}
    return f;
  }
  const VFX_SCALE = vfxScale();
  /** How many specks of `spec` this machine gets. Never fewer than three. */
  /* `dens` is a look's own multiplier on top of the kind's count and the
     machine's scale. The kind says what a thing is — smoke is eight big slow
     shapes — and a look sometimes needs more of it without becoming a different
     kind: Magma is Dusk's smoke, thick, because it is coming off a fire rather
     than drifting past. Still floored at 3 and still scaled down on a weak
     machine, so it cannot be used to get round either. */
  /* **`cap` is a ceiling on how many of a kind may ever exist**, and it is not
     the same thing as `n`. `n` is how many look right; `cap` is how many the
     machine can hold up. They only differ for kinds whose specks are expensive:
     smoke carries `filter:blur(26px)`, so every one of them is an offscreen
     buffer the compositor has to keep and recomposite, and a look asking for
     fourteen times the default was asking for a hundred and twelve of them.
     That is the same cliff as the full-screen blur in §6 of HANDOFF, reached
     from the other direction — one enormous blurred layer, or a hundred small
     ones, cost about the same and both drop frames.

     A look may still ask for more than `n` and still be scaled down on a weak
     machine; it simply cannot climb past what the kind says is affordable. */
  function vfxCount(spec, dens){
    const want = Math.round(spec.n * VFX_SCALE * (dens || 1));
    const most = spec.cap ? Math.round(spec.cap * VFX_SCALE) : Infinity;
    return Math.max(3, Math.min(want, most));
  }

  /* Per kind: how many specks, and the range each custom property is drawn
     from. `[min, max, unit]`. Anything a kind doesn't list simply isn't set,
     which is why the CSS only ever reads properties its own kind provides.

     Counts are the main lever on how busy an effect feels — rain at 18 is a
     drizzle you can read a clock through, rain at 60 is a car wash. */
  const VFX_KINDS = {
    rain:   {n:18, v:{s:[16, 34, 'px'], w:[1.4, 2.2, 'px'], t:[1.2, 2.2, 's'],
                      o:[.22, .55], dx:[-1.5, 1.5, 'vw']}},
    // the three x waypoints are the wander on the way up; `wob` scales them
    spores: {n:22, variants:4, wob:['x1', 'x2', 'x3', 'dx'],
             v:{s:[6, 18, 'px'], t:[18, 44, 's'], o:[.22, .55], r:[-420, 420, 'deg'],
                x1:[-5, 5, 'vw'], x2:[-8, 8, 'vw'], x3:[-6, 6, 'vw'], dx:[-10, 10, 'vw']}},
    sparks: {n:30, wob:['x1', 'x2', 'x3', 'dx'],
             v:{s:[2, 5, 'px'], t:[11, 24, 's'], o:[.25, .6],
                x1:[-4, 4, 'vw'], x2:[-7, 7, 'vw'], x3:[-5, 5, 'vw'], dx:[-9, 9, 'vw']}},
    // four cut-outs, and a sway on the way down — see the note in the CSS
    petals: {n:16, variants:4,
             v:{s:[10, 20, 'px'], t:[14, 26, 's'], o:[.3, .7],
                x1:[-14, 14, 'vw'], x2:[-18, 18, 'vw'], x3:[-12, 12, 'vw'],
                dx:[-22, 22, 'vw'], r:[-720, 720, 'deg']}},
    // the same fall, five leaf shapes of its own, and heavier with it
    leaves: {n:15, variants:5,
             v:{s:[11, 22, 'px'], t:[13, 24, 's'], o:[.28, .62],
                x1:[-12, 12, 'vw'], x2:[-16, 16, 'vw'], x3:[-10, 10, 'vw'],
                dx:[-18, 18, 'vw'], r:[-540, 540, 'deg']}},
    snow:   {n:24, v:{s:[5, 13, 'px'], t:[13, 26, 's'], o:[.35, .8],
                      dx:[-14, 14, 'vw'], r:[-180, 180, 'deg']}},
    // y1..y3 are the wander across; smoke that travels in a straight line is a bar
    /* `pal` here is opt-in and does nothing on its own: a look without an
       `fxpal` still gets the two-colour mix, so Dusk is untouched. Magma needs
       it because a blend between orange and near-black is a continuous brown
       ramp, and lava is not a ramp — it is bright cracks between dark crust,
       which means discrete colours taken in turn. */
    smoke:  {n:8, pal:true, cap:26,
                  v:{s:[380, 820, 'px'], t:[24, 48, 's'], o:[.12, .26],
                      y:[-12, 98, '%'], y1:[-16, 16, 'vh'], y2:[-20, 20, 'vh'],
                      y3:[-14, 14, 'vh'], dy:[-10, 10, 'vh']}},
    /* Ridges at fixed depths that slide past each other rather than scrolling
       by — the far ones slowly, the near ones less slowly, which is what makes
       five flat lines read as a landscape. */
    // filled ridges rather than lines this time; `s` is how tall each one stands
    /* Fireworks. One element per rocket: it climbs, bursts, and leaves embers
       falling. Nine of them on nine unrelated clocks, so the sky is never empty
       and never crowded. Colours come from a palette rather than a pair. */
    /* `child` puts the shell inside, `sparks` builds the burst out of real
       elements — see the four-layers note in the CSS. */
    fw:     {n:6, pal:true, child:true, sparks:[13, 19],
             v:{s:[2, 3.6, 'px'], t:[7, 15, 's'], o:[.75, 1],
                x:[12, 88, '%'], y:[18, 54, '%'], up:[34, 68, 'vh'],
                r:[26, 52, 'px'], dx:[-4, 4, 'vw']}},
    /* Yellow and orange taken in turn rather than blended, and set down on
       opposite sides — then walked slowly round the screen. */
    sun:    {n:4, alt:true, ring:true,
             v:{s:[130, 200, 'vh'], t:[52, 96, 's'], o:[.20, .40]}},
    // a loose 6 × 4 grid of keys, each lighting up on its own schedule
    keys:   {n:24, grid:[6, 4], v:{s:[22, 40, 'px'], t:[3.5, 11, 's'], o:[.16, .42],
                                   r:[3, 9, 'px']}},
    // each one arrives, drifts, and goes; nothing sits there for the whole break
    bokeh:  {n:11, v:{s:[80, 260, 'px'], t:[9, 22, 's'], o:[.07, .20],
                      y:[-4, 104, '%'], dx:[-10, 10, 'vw'], dy:[-8, 8, 'vh']}},
    motes:  {n:26, v:{s:[2, 5, 'px'], t:[14, 30, 's'], o:[.10, .30],
                      y:[-4, 104, '%'], dx:[-7, 7, 'vw'], dy:[-6, 6, 'vh']}},
  };

  /* Kinds that fall or rise from a random column. The rest place themselves
     with their own `x` range, or don't need one at all. */
  const VFX_COLUMN = ['rain', 'spores', 'sparks', 'petals', 'leaves', 'snow', 'bokeh', 'motes'];

  function vfxRand(a, b){ return a + Math.random() * (b - a); }

  /* Somewhere between the two colours a look was given, drawn fresh for each
     speck. "Shades of pink" rather than two pinks: with a random mix per petal
     a dozen of them look like a tree in blossom instead of like two sprites. */
  function vfxShade(c1, c2){
    if(!c2 || c2 === c1) return c1;
    return 'color-mix(in srgb, ' + c1 + ' ' + Math.round(vfxRand(6, 94)) + '%, ' + c2 + ')';
  }

  /**
   * Put `kind` on the pane, in `colour` (and `colour2`, for the kinds that use
   * two). `mult` scales every duration, so two lights can share a kind and
   * still feel different — pollen is not embers.
   */
  function vfxSet(kind, colour, colour2, mult, wobble, palette, flick, dens, op, size){
    const pane = $('vfx');
    if(!pane) return;
    const want = kind && VFX_ON.on ? kind : '';
    /* The phase is part of the key, so going from a break back to focusing
       builds the field again from scratch. Nothing is wrong with the old one —
       it is that arriving at a screen mid-animation, with everything already
       halfway through a journey it started while you were doing something else,
       reads as a screen you left running rather than one that just began. */
    const key = [want, colour || '', colour2 || '', mult || 1, wobble || 1,
                 (palette || []).join(','), flick ? 'f' : '', dens || 1, op || 1,
                 size || 1, (typeof S === 'object' ? S.mode : '')].join('|');
    if(pane.dataset.key === key){ pane.classList.toggle('on', !!want); return; }
    pane.dataset.key = key;
    pane.dataset.fx = want;
    /* A look can ask for the whole room to flicker with it. It belongs to the
       look and not to the kind: campfire and Sea glass both throw sparks, and
       only one of them is a fire. */
    if(want && flick) pane.dataset.flick = '1'; else delete pane.dataset.flick;
    pane.classList.toggle('on', !!want);
    /* The menus only pay for their backdrop blur when there is something behind
       them worth blurring — see .overlay in 05-arcade.css. */
    document.body.classList.toggle('vfx-on', !!want);
    if(!want){ pane.innerHTML = ''; return; }

    const spec = VFX_KINDS[want] || VFX_KINDS.motes;
    const speed = mult || 1;
    const two = colour2 && colour2 !== colour;
    let html = '';
    const many = vfxCount(spec, dens);
    for(let i = 0; i < many; i++){
      const bits = [];
      /* Three ways to colour a speck. A palette hands out a different colour to
         each one in turn; `alt` takes two in turn (a blend across three or four
         huge shapes would just give you four of the same in-between colour);
         otherwise every speck is its own mix of the pair. */
      const pal = spec.pal && palette && palette.length ? palette : null;
      bits.push('--c:' + (pal ? pal[i % pal.length]
        : !two ? (colour || 'var(--accent)')
        : spec.alt ? (i % 2 ? colour2 : colour)
        : vfxShade(colour, colour2)));
      /* One --c2 or the other, never both: the pair-mix line used to be pushed
         after the palette line and quietly won, so a palette effect's second
         colour was a blend of the pair rather than the palette colour. */
      if(pal) bits.push('--c2:' + pal[(i + 2) % pal.length]);
      else if(two) bits.push('--c2:' + vfxShade(colour, colour2));
      if(VFX_COLUMN.indexOf(want) >= 0) bits.push('--x:' + vfxRand(-4, 104).toFixed(2) + '%');
      /* Kinds laid out on a grid place themselves rather than scattering: a
         keyboard is a keyboard because the keys are in rows. The jitter keeps it
         from looking like a spreadsheet. */

      /* Set down around a ring rather than scattered: opposite sides get
         opposite colours, which is the whole point of the pairing. */
      if(spec.ring){
        const a = (i / many) * Math.PI * 2 + vfxRand(-.3, .3);
        bits.push('--x:' + (50 + Math.cos(a) * 46).toFixed(1) + '%');
        bits.push('--y:' + (48 + Math.sin(a) * 42).toFixed(1) + '%');
        bits.push('--ox:' + (Math.cos(a + 1.9) * 26).toFixed(1) + 'vw');
        bits.push('--oy:' + (Math.sin(a + 1.9) * 22).toFixed(1) + 'vh');
      }
      if(spec.grid){
        const cols = spec.grid[0], rows = spec.grid[1];
        const gx = (i % cols) / (cols - 1), gy = ((i / cols) | 0) / (rows - 1);
        bits.push('--x:' + (6 + gx * 88 + vfxRand(-3, 3)).toFixed(2) + '%');
        bits.push('--y:' + (12 + gy * 76 + vfxRand(-3, 3)).toFixed(2) + '%');
      }

      let time = 1;
      const wob = wobble || 1;
      for(const name in spec.v){
        const r = spec.v[name];
        let n = vfxRand(r[0], r[1]);
        if(name === 't'){ n *= speed; time = n; }
        /* A look can ask for its weather to be heavier than the kind's default.
           Smoke is written faint because Dusk is a quiet look; Magma is the same
           smoke off a fire and has to actually be seen. Clamped at 1 — past that
           it stops being weather and becomes a coat of paint over the app. */
        else if(name === 'o' && op) n = Math.min(1, n * op);
        /* Same kind at a different scale. Eight cloud-sized shapes and forty
           small ones behave nothing alike even with identical maths: big and
           slow reads as weather, small and many reads as something boiling. */
        else if(name === 's' && size) n *= size;
        // the same kind, more or less all over the place — a campfire throws its
        // sparks about in a way a spore drifting off a fern does not
        else if(spec.wob && spec.wob.indexOf(name) >= 0) n *= wob;
        bits.push('--' + name + ':' + n.toFixed(name === 'o' ? 3 : 1) + (r[2] || ''));
      }
      // negative, so the field is already in mid-flight when you arrive rather
      // than every speck setting off from the same edge at once
      bits.push('--d:' + (-vfxRand(0, time)).toFixed(2) + 's');
      // the cut-out is an attribute rather than a variable: CSS can select on
      // one and not the other, and each variant is its own shape
      const v = spec.variants ? ' data-v="' + (i % spec.variants) + '"' : '';
      html += '<b' + v + ' style="' + bits.join(';') + '">'
        + (spec.child ? '<i></i>' : '')
        + (spec.sparks ? vfxSparks(spec) : '')
        + '</b>';
    }
    pane.innerHTML = html;
  }

  /* A burst, as a dozen or so separate sparks. Each gets an angle, a distance
     along it, how far it falls afterwards, and a few hundredths of a second of
     its own — the last of those is what stops a burst looking like a stamp. */
  function vfxSparks(spec){
    const n = Math.round(vfxRand(spec.sparks[0], spec.sparks[1]));
    let out = '';
    for(let k = 0; k < n; k++){
      // spread around the circle with a wobble, so it is a burst and not a wheel
      const a = (k / n) * Math.PI * 2 + vfxRand(-.28, .28);
      const dist = vfxRand(46, 128);
      out += '<u style="'
        + '--ss:' + vfxRand(1.4, 2.8).toFixed(2) + 'px'
        + ';--a:' + (a * 180 / Math.PI).toFixed(1) + 'deg'
        + ';--tx:' + (Math.cos(a) * dist).toFixed(1) + 'px'
        + ';--ty:' + (Math.sin(a) * dist).toFixed(1) + 'px'
        + ';--fall:' + vfxRand(120, 300).toFixed(0) + 'px'
        + ';--sd:' + vfxRand(0, .16).toFixed(3) + 's'
        + '"></u>';
    }
    return out;
  }

  /** Whatever is currently chosen — a light, or a track. Never both. */
  function vfxApply(){
    try{
      if(S.mode === 'setup'){ vfxSet(''); return; }   // not on the setup screen
      const look = Embers.look();
      vfxSet(look.fx, look.fxc || look.accent, look.fxc2, look.fxm, look.fxw,
             look.fxpal, look.fxflick, look.fxn, look.fxo, look.fxs);
    }catch(e){}
  }

  /* ---- the switch ----
     Kept out of the embers record on purpose: Reset progress clears that, and
     "I don't want things moving behind my timer" is a preference, not progress. */
  async function vfxLoad(){
    try{
      const r = await KV.get(VFX_KEY);
      if(r && r.value) VFX_ON.on = JSON.parse(r.value) !== false;
    }catch(e){}
    vfxRender();
    vfxApply();
  }
  function vfxToggle(){
    VFX_ON.on = !VFX_ON.on;
    KV.set(VFX_KEY, JSON.stringify(VFX_ON.on));
    vfxRender();
    vfxApply();
    toast(VFX_ON.on ? 'Effects on' : 'Effects off');
  }
  function vfxRender(){
    const b = $('t-fx');
    if(b) b.classList.toggle('on', VFX_ON.on);
  }
  if($('t-fx')) $('t-fx').onclick = vfxToggle;
