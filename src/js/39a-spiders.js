  /* ---- the spiders ----

     Something alive in the room. Four things one can be doing: coming down on
     a thread under a top corner, walking an edge, crawling on a corner web, or
     walking the back wall.

     **Nothing walks horizontally.** The back-wall ones used to track sideways
     across the middle of the screen, which does not read as a spider at all --
     it reads as a sticker being dragged. They go up and down now, like
     everything else. The wall behind is a surface, so one on it is not
     floating; it was the direction that was wrong, not the place.

     **Up to eight, usually three, never arriving together.** A hard cap alone
     gives you the cap, so there are two numbers: below SOFT one is always let
     in, and above it each has to win a roll that gets steeper every time, so
     the count drifts back to about three and eight is an occasional event. A
     new one also waits for the last to have settled -- let in on the same tick
     they are one effect fired twice -- and takes a place nobody else is in.
     Twelve places against a ceiling of eight means there is always one free.

     No red. The reference art is a black widow and the hourglass comes with
     it, but a red mark on a dark shape is a warning sign, and the one thing
     this must not be is something that asks to be looked at while somebody is
     working. */
  const SPIDER_GAP = [6000, 14000];
  const SPIDER_SOFT = 3;
  /* Eight places and a ceiling of six, so two are always free: with as many
     places as spiders the last few have no choice left and the variety goes
     exactly when there is most to look at. */
  const SPIDER_MAX = 7;
  const SPIDER_FALLOFF = 0.45;
  const SPIDER_STAGGER = 8000;
  /* **Dark enough to read on a white web.** These were a mid grey and a mid
     brown, chosen against the dark room and never looked at against the one
     light thing on the screen: the corner webs are near-white, and a spider
     crossing one disappeared into it. Near-black reads on the web; what keeps
     it readable against the dark room is the halo in 04-timer.css, not the
     fill. */
  const SPIDER_INKS = ['#1e1f28', '#2b1a0f'];
  const SPIDER_SPOTS = ['drop-l1', 'drop-l2', 'drop-r1', 'drop-r2',
                        'wall-l', 'wall-r', 'web-l', 'web-r',
                        'bg-a', 'bg-b', 'bg-c', 'bg-d',
                        'diag-a', 'diag-b', 'diag-c', 'diag-d'];
  /* **The corner web's spokes, read off the drawing.**

     A spider on a web has to be *on a strand*, and "roughly outward from the
     corner" is not on a strand: it put the animal in a hole between two of
     them with its legs touching nothing, which is what reads as a sticker laid
     over a picture of a web. These are the eight spoke ends from the path in
     01-shell-drawer.html, in its own 120-unit box, so a spider can take one
     and walk along it.

     Copied rather than measured from the DOM because the web is generated from
     a seeded jitter and never changes; if that path is ever redrawn, these
     move with it. */
  const SPIDER_SPOKES = [[153.9, 5.0], [148.5, 39.7], [138.4, 67.5], [114.6, 92.2],
                         [92.1, 111.9], [64.3, 134.9], [37.7, 142.2], [6.5, 151.4]];
  /* The box those numbers are in, and how big the web is drawn: see the
     `.corner-web` rule, width:min(34vw,190px). */
  const SPIDER_WEB_BOX = 120;
  function spiderWebSize(){
    return Math.min(0.34 * (window.innerWidth || 1200), 190);
  }
  /* The animations that mean the visit is over. One per kind of journey; the
     walk cycle runs forever and must not be mistaken for one. */
  const SPIDER_OVER = ['sp-fall', 'sp-walkdown', 'sp-walkup', 'sp-onweb',
                       'sp-wander', 'sp-diag'];

  /* ---- the walk ----

     **The feet are placed, not rotated.** Three goes at a gait made of turning
     the legs about their shoulders all slid, and the last one showed why it
     was never going to work: how far a turn carries a foot depends on where
     that foot sits relative to its shoulder, so one sweep angle cannot suit
     eight legs -- and on a profile drawing, whose legs fan fore and aft, a
     turn lifts the foot off the surface instead of pushing along it. No angle
     fixes that. Measured, the feet were sliding by a factor of nine.

     So the pose is worked out per frame instead. A foot in stance is put at a
     point that moves backwards by exactly what the body moves forwards, so it
     is stationary on the ground by construction rather than by tuning. A foot
     in swing lifts, is carried forward and set down. The leg is then drawn
     from its shoulder to wherever the foot now is, bending away from the body
     so it arches the way the reference silhouettes do.

     Eight frames to a cycle, played with `steps()`. That is how hand-drawn
     animation does it and it is what the reference sheets are: a foot that
     holds for a frame and then moves reads as a step, where a smooth sweep
     reads as a slide. It also costs one animation per spider instead of eight.

     STRIDE is the number everything else comes from: the body has to travel
     exactly this far per cycle or the feet stop being planted, so the journey
     durations are worked out from it rather than picked. */
  const SPIDER_FRAMES = 8;
  const SPIDER_STRIDE = 18;        // shape units travelled per cycle
  /* **A swinging leg lifts; it does not fold up.** The foot used to be drawn
     in towards its shoulder, which shortens the leg and leaves a crumpled
     thing in every other frame -- fine in motion, bad the moment you stop on
     one. Now the knee rises and the foot arcs out past the line it will land
     on, so a paused frame is a spider standing with four legs raised rather
     than a spider with four legs missing. */
  const SPIDER_KNEE = 7;           // extra knee bulge at the top of a swing
  const SPIDER_CLEAR = 2.6;        // how far out a swinging foot arcs
  const SPIDER_CYCLE = 0.38;       // seconds per cycle
  /* 60 shape units are drawn 30px wide, so a unit is half a pixel. */
  const SPIDER_SPEED = SPIDER_STRIDE * 0.5 / SPIDER_CYCLE;

  /* Two plan views, which is what the reference sheets are: a spider seen
     from below, round abdomen, smaller head, eight thin legs arching up and
     out before they drop. `long` is the same animal with more leg and less
     body.

     An alternating tetrapod: four feet down on opposite corners while the
     other four swing, so the second set is the diagonal of the first. Legs
     0-3 are the left side front to back, 4-7 the right. */
  const SPIDER_SHAPES = {
    top: {
      mid: [30, 29], bend: 9,
      shoulders: [[26, 23], [25, 27], [25, 31], [26, 34],
                  [34, 23], [35, 27], [35, 31], [34, 34]],
      feet: [[9, 13], [5, 25], [7, 37], [14, 46],
             [51, 13], [55, 25], [53, 37], [46, 46]],
      body: '<ellipse class="sp-fill" cx="30" cy="33" rx="7.5" ry="9"/>'
          + '<circle class="sp-fill" cx="30" cy="22" r="5"/>',
    },
    long: {
      mid: [30, 29], bend: 11,
      shoulders: [[27, 24], [26, 28], [26, 31], [27, 34],
                  [33, 24], [34, 28], [34, 31], [33, 34]],
      feet: [[6, 9], [2, 24], [4, 39], [12, 47],
             [54, 9], [58, 24], [56, 39], [48, 47]],
      body: '<ellipse class="sp-fill" cx="30" cy="32" rx="5.5" ry="7"/>'
          + '<circle class="sp-fill" cx="30" cy="24" r="4"/>',
    },
    /* **The one on a thread, seen from behind.**

       A hanging spider was being drawn with the same plan view as everything
       else, and a plan view is eight legs of the same length at the same
       angle: at the size these run that is not a spider, it is an asterisk.
       What makes a hanging one read is that the legs are *gathered* -- the
       front pairs reach up towards the thread, the back pairs hang below, and
       the two are different lengths -- over an abdomen that is the biggest
       thing in the drawing because you are looking straight at it.

       It never walks, so it is never anything but its rest pose: see the
       `.sp-drop .sp-strip` rule in 04-timer.css, which parks it there. */
    hang: {
      mid: [30, 30], bend: 13, far: 4,
      shoulders: [[27, 21], [26, 25], [26, 29], [27, 33],
                  [33, 21], [34, 25], [34, 29], [33, 33]],
      feet: [[11, 6], [6, 15], [9, 33], [15, 44],
             [49, 6], [54, 15], [51, 33], [45, 44]],
      body: '<ellipse class="sp-fill" cx="30" cy="38" rx="8.5" ry="10.5"/>'
          + '<ellipse class="sp-fill" cx="30" cy="24" rx="5.5" ry="5"/>',
    },
    /* **The one on a wall, seen from the side.** Drawn facing up the same as
       the others, so a journey still only has to say which way it is pointed
       -- but here that means we are looking along the wall: the surface is
       the left edge, every foot is on it, and the body hangs off to the
       right. Four legs are the far side and go behind the body, which is what
       gives it any depth at all.

       `mid` is off to the left of everything on purpose. The knee is pushed
       away from it, so putting it past the wall makes every leg arch out into
       the room instead of bending into the brickwork. */
    side: {
      mid: [-6, 26], bend: 10, far: 4,
      shoulders: [[31, 16], [32, 22], [32, 30], [31, 36],
                  [35, 17], [36, 23], [36, 31], [35, 37]],
      feet: [[10, 7], [8, 20], [8, 34], [10, 44],
             [13, 5], [11, 18], [11, 36], [13, 46]],
      body: '<ellipse class="sp-fill" cx="41" cy="31" rx="9" ry="11"/>'
          + '<ellipse class="sp-fill" cx="37" cy="18" rx="5.5" ry="5"/>',
    },
  };
  /* Forward is up the drawing for both, so a journey only has to say which way
     it is pointed. */
  const SPIDER_FWD = [0, -1];
  const SPIDER_SET_B = [1, 3, 4, 6];

  function spiderOn(){
    try{
      if(document.body.getAttribute('data-light') !== 'spiderman') return false;
      if(document.body.classList.contains('away')) return false;
      if(typeof VFX_ON !== 'undefined' && VFX_ON && VFX_ON.on === false) return false;
      if(window.matchMedia
         && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
      return true;
    }catch(e){ return false; }
  }

  /** One leg, for one frame, drawn to wherever its foot is by then. */
  function spiderLeg(sh, i, phase, resting){
    const fwd = sh.fwd || SPIDER_FWD;
    if(resting){
      // every foot at home, nothing lifted: the pose for standing still
      const S0 = sh.shoulders[i], H0 = sh.feet[i];
      const mx0 = (S0[0] + H0[0]) / 2, my0 = (S0[1] + H0[1]) / 2;
      const ox0 = mx0 - sh.mid[0], oy0 = my0 - sh.mid[1];
      const od0 = Math.hypot(ox0, oy0) || 1;
      return '<path class="sp-leg" d="M' + S0[0] + ' ' + S0[1]
        + 'Q' + (mx0 + ox0 / od0 * sh.bend).toFixed(1) + ' '
        + (my0 + oy0 / od0 * sh.bend).toFixed(1)
        + ' ' + H0[0] + ' ' + H0[1] + '"/>';
    }
    const q = (phase + (SPIDER_SET_B.indexOf(i) >= 0 ? 0.5 : 0)) % 1;
    let along, lift;
    if(q < 0.5){
      /* Stance. The foot travels backwards by exactly one stride over the half
         cycle it is down for, which is what the body travels forwards, so it
         does not move across the ground at all. */
      along = SPIDER_STRIDE * (0.5 - q / 0.5);
      lift = 0;
    }else{
      // Swing: picked up, carried forward, set down.
      const t = (q - 0.5) / 0.5;
      along = SPIDER_STRIDE * (t - 0.5);
      lift = Math.sin(Math.PI * t);
    }
    const S = sh.shoulders[i], H = sh.feet[i];
    let fx = H[0] + fwd[0] * along;
    let fy = H[1] + fwd[1] * along;
    /* Clear of the ground, outwards: the perpendicular of forward, away from
       the middle of the animal, so the foot arcs round rather than through. */
    const side = (H[0] - sh.mid[0]) < 0 ? -1 : 1;
    fx += -fwd[1] * side * SPIDER_CLEAR * lift;
    fy += fwd[0] * side * SPIDER_CLEAR * lift;
    // the knee bulges away from the body, and rises further while the leg swings
    const bend = sh.bend + SPIDER_KNEE * lift;
    const mx = (S[0] + fx) / 2, my = (S[1] + fy) / 2;
    const ox = mx - sh.mid[0], oy = my - sh.mid[1], od = Math.hypot(ox, oy) || 1;
    return '<path class="sp-leg" d="M' + S[0] + ' ' + S[1]
      + 'Q' + (mx + ox / od * bend).toFixed(1) + ' ' + (my + oy / od * bend).toFixed(1)
      + ' ' + fx.toFixed(1) + ' ' + fy.toFixed(1) + '"/>';
  }

  /** The whole animal, as a strip of frames laid out side by side. */
  function spiderSvg(ink, shape, size){
    const sh = SPIDER_SHAPES[shape] || SPIDER_SHAPES.top;
    const k = (Number(size) > 0 ? Number(size) : 1);
    /* **One frame past the cycle: standing still.**

       A spider that stops has to stop on something, and there is no frame of
       a walk where it is standing: an alternating tetrapod always has four
       legs in the air, so pausing the cycle leaves half of them raised. The
       extra frame is every foot at home with nothing lifted, and it sits
       after the eight so the cycle never reaches it -- `steps(8)` over eight
       frames lands on 0 to 7. Stopping is then just a matter of parking the
       strip one frame further on. */
    let strip = '';
    for(let f = 0; f <= SPIDER_FRAMES; f++){
      const phase = f < SPIDER_FRAMES ? f / SPIDER_FRAMES : -1;
      let legs = '', near = '';
      for(let i = 0; i < 8; i++){
        const path = spiderLeg(sh, i, phase, phase < 0);
        if(sh.far && i >= sh.far) near += path; else legs += path;
      }
      if(sh.far) legs = '<g class="sp-far">' + legs + '</g>';
      /* The body rides the gait, dipping as each set takes the weight, twice a
         cycle. Baked into the frame so there is one moving part per spider. */
      const bob = phase < 0 ? '0' : (Math.sin(phase * Math.PI * 4) * 0.5).toFixed(2);
      strip += '<g transform="translate(' + (60 * f) + ' 0)">' + legs
        + '<g class="sp-trunk" transform="translate(0 ' + bob + ')">' + sh.body + '</g>'
        + near + '</g>';
    }
    return '<svg class="sp-body" viewBox="0 0 60 50"'
      + ' width="' + (30 * k).toFixed(1) + '" height="' + (25 * k).toFixed(1) + '"'
      + ' aria-hidden="true" focusable="false" style="--ink:' + ink + '">'
      + '<g class="sp-strip">' + strip + '</g></svg>';
  }

  /* On a wall you see a spider from the side; hanging or crossing open space
     you see it from below. */
  function spiderShapeFor(kind){
    if(kind === 'wall') return 'side';
    if(kind === 'drop') return 'hang';
    return Math.random() < 0.5 ? 'top' : 'long';
  }

  /* **Stopping, for a moment, somewhere along the way.**

     A thing that crosses the screen at a constant speed from one edge to the
     other is a sprite on a rail. Real ones stop, stand, and go on. So every
     walker pauses once in the middle of its journey: the class is what does
     it, and in 04-timer.css it pauses the journey *and* the legs, because a
     spider standing still with its legs going is worse than one that never
     stopped at all.

     Timers rather than CSS, because a stylesheet has no way to ask how far
     another animation has got, and the pause has to be a hole in the middle of
     a journey whose length is worked out in JS. `from` and `to` are shares of
     the run; the defaults put it somewhere in the middle third and keep it
     there for about a fifth of the trip. */
  function spiderSit(el, dur, from, to){
    const a = from != null ? from : 0.3 + Math.random() * 0.25;
    const b = to != null ? to : a + 0.14 + Math.random() * 0.1;
    setTimeout(()=>{ try{ el.classList.add('sp-still'); }catch(e){} }, dur * 1000 * a);
    setTimeout(()=>{ try{ el.classList.remove('sp-still'); }catch(e){} }, dur * 1000 * b);
  }

  /** One visit, if there is room, a free place, and the last one has settled. */
  function spiderSend(){
    const host = $('spiders');
    if(!host || !spiderOn()) return;
    const here = [...host.children];
    if(here.length >= SPIDER_MAX) return;
    if(here.length >= SPIDER_SOFT
       && Math.random() >= Math.pow(SPIDER_FALLOFF, here.length - SPIDER_SOFT + 1)) return;
    if(here.length){
      const newest = here.reduce((n, c)=>Math.max(n, Number(c.dataset.at) || 0), 0);
      if(Date.now() - newest < SPIDER_STAGGER) return;
    }
    const taken = new Set(here.map(c=>c.dataset.spot));
    const open = SPIDER_SPOTS.filter(x=>!taken.has(x));
    if(!open.length) return;
    const spot = open[Math.random() * open.length | 0];

    const ink = SPIDER_INKS[Math.random() * SPIDER_INKS.length | 0];
    const el = document.createElement('div');
    el.dataset.spot = spot;
    el.dataset.at = String(Date.now());
    const kind = spot.slice(0, spot.indexOf('-'));
    const tag = spot.slice(spot.indexOf('-') + 1);
    /* Not all the same size. A screenful of identical silhouettes is a
       pattern; a quarter either way reads as different animals. */
    const size = 0.75 + Math.random() * 0.5;
    /* Everything travels at the speed its own stride implies, which scales
       with how big it is. The distances are in vh and vw and the window is
       whatever it is, so the durations are worked out here: a duration in the
       stylesheet can only be right at one window size. */
    const speed = SPIDER_SPEED * size;
    const secs = (px)=>Math.max(6, px / speed).toFixed(1) + 's';
    const vh = (n)=>n / 100 * (window.innerHeight || 800);
    const vw = (n)=>n / 100 * (window.innerWidth || 1200);
    const svg = spiderSvg(ink, spiderShapeFor(kind), size);

    if(kind === 'drop'){
      /* **From the top edge, under a corner web.** Not from a point part way
         down, which is a line beginning in mid air. */
      const left = tag[0] === 'l';
      el.className = 'spider sp-drop';
      el.style.left = (left ? 7 + Math.random() * 12 : 81 + Math.random() * 12).toFixed(1) + '%';
      /* How far the thread runs past the top of the drawing to reach the body,
         as a share of the drawing, so it follows its size. */
      el.style.setProperty('--sp-hang', (8.5 * size).toFixed(1) + 'px');
      el.style.setProperty('--sp-drop', (18 + Math.random() * 30).toFixed(1) + 'vh');
      el.innerHTML = '<i class="sp-thread"></i>' + svg;
    }else if(kind === 'wall'){
      const right = tag[0] === 'r';
      const up = Math.random() < 0.5;
      el.className = 'spider sp-wall' + (right ? ' sp-right' : '') + (up ? ' sp-up' : '');
      const dur = Math.max(6, vh(124) / speed);
      el.style.setProperty('--sp-dur', dur.toFixed(1) + 's');
      el.innerHTML = svg;
      spiderSit(el, dur);
    }else if(kind === 'bg'){
      /* **Wandering, not commuting.** These used to run straight up or down
         one of four fixed columns, which is four rails: whatever else a
         spider on a wall is doing, it is not holding a line. Five points and
         four legs between them, the middle three anywhere in the room, and a
         turn at each one -- it stops, turns, and goes on, so the path is a
         path rather than a sweep.

         Both ends are outside the window, so it is never a spider appearing
         out of nothing, and the legs are different lengths, so no two of them
         take the same time to cross. */
      const w = vw(100), h = vh(100);
      const edge = ()=>{
        const side = Math.random() * 4 | 0;
        if(side === 0) return [Math.random() * w, -h * 0.2];
        if(side === 1) return [Math.random() * w, h * 1.2];
        if(side === 2) return [-w * 0.2, Math.random() * h];
        return [w * 1.2, Math.random() * h];
      };
      const pts = [edge()];
      for(let i = 0; i < 3; i++) pts.push([Math.random() * w, Math.random() * h]);
      pts.push(edge());
      let far = 0;
      for(let i = 1; i < pts.length; i++){
        far += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      }
      el.className = 'spider sp-back';
      for(let i = 0; i < pts.length; i++){
        el.style.setProperty('--sp-p' + i + 'x', pts[i][0].toFixed(0) + 'px');
        el.style.setProperty('--sp-p' + i + 'y', pts[i][1].toFixed(0) + 'px');
        if(i === 0) continue;
        const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1];
        el.style.setProperty('--sp-r' + i,
          (Math.atan2(dy, dx) * 180 / Math.PI + 90).toFixed(1) + 'deg');
      }
      const dur = Math.max(18, far / speed);
      el.style.setProperty('--sp-dur', dur.toFixed(1) + 's');
      el.innerHTML = svg;
      spiderSit(el, dur);
    }else if(kind === 'diag'){
      /* **Across the room, at an angle.** Straight across was taken out
         because a spider tracking sideways through open space reads as a
         sticker being dragged; the reason that is true is the *sideways*, not
         the crossing. On a diagonal it is going somewhere, and it is turned to
         face the way it is going, which is the part a horizontal one never
         had.

         Corner to corner, starting and ending outside the window so neither
         end is a spider appearing out of nothing. */
      const down = tag === 'a' || tag === 'b';
      const right = tag === 'a' || tag === 'c';
      const w = vw(100), h = vh(100);
      const x0 = right ? -w * 0.18 : w * 1.18;
      const x1 = right ? w * 1.18 : -w * 0.18;
      const y0 = down ? -h * 0.18 : h * 1.18;
      const y1 = down ? h * 1.18 : -h * 0.18;
      /* A little off true so four of them are not four parallel lines. */
      const skew = (Math.random() - 0.5) * h * 0.5;
      const dx = x1 - x0, dy = (y1 + skew) - y0;
      el.className = 'spider sp-diag';
      el.style.setProperty('--sp-x0', x0.toFixed(0) + 'px');
      el.style.setProperty('--sp-y0', y0.toFixed(0) + 'px');
      el.style.setProperty('--sp-x1', x1.toFixed(0) + 'px');
      el.style.setProperty('--sp-y1', (y1 + skew).toFixed(0) + 'px');
      /* The drawing faces up, so the turn is the heading plus a quarter. */
      el.style.setProperty('--sp-turn',
        (Math.atan2(dy, dx) * 180 / Math.PI + 90).toFixed(1) + 'deg');
      const dur = Math.max(10, Math.hypot(dx, dy) / speed);
      el.style.setProperty('--sp-dur', dur.toFixed(1) + 's');
      el.innerHTML = svg;
      spiderSit(el, dur);
    }else if(kind === 'web'){
      /* **Up and down one strand, and turned to face along it.**

         It used to pick a direction at random out of the corner and keep a
         fixed 135 degrees of rotation whatever direction that was. Both
         halves of that were wrong: the path missed the spokes, so it sat in
         the gaps, and the rotation did not match the path, so even where it
         crossed a strand it crossed it sideways. Now it takes a real spoke,
         walks out along it and back, and points the way it is going. */
      const right = tag[0] === 'r';
      const sgn = right ? -1 : 1;
      el.className = 'spider sp-web' + (right ? ' sp-right' : '');
      const spoke = SPIDER_SPOKES[Math.random() * SPIDER_SPOKES.length | 0];
      const scale = spiderWebSize() / SPIDER_WEB_BOX;
      const len = Math.hypot(spoke[0], spoke[1]);
      const ux = spoke[0] / len, uy = spoke[1] / len;
      /* Far enough out not to be in the knot at the corner, and stopping
         before the mask fades the web away under it. */
      const r0 = len * scale * 0.2;
      const r1 = len * scale * (0.5 + Math.random() * 0.28);
      el.style.setProperty('--sp-x0', (ux * r0 * sgn).toFixed(0) + 'px');
      el.style.setProperty('--sp-y0', (uy * r0).toFixed(0) + 'px');
      el.style.setProperty('--sp-x1', (ux * r1 * sgn).toFixed(0) + 'px');
      el.style.setProperty('--sp-y1', (uy * r1).toFixed(0) + 'px');
      /* Facing out along the strand. The drawing faces up, so the heading is
         the spoke's angle plus a quarter turn. */
      el.style.setProperty('--sp-turn',
        (Math.atan2(uy, ux * sgn) * 180 / Math.PI + 90).toFixed(1) + 'deg');
      const dur = Math.max(6, (r1 - r0) * 5 / speed);
      el.style.setProperty('--sp-dur', dur.toFixed(1) + 's');
      el.innerHTML = svg;
      /* The web one sits for the middle of its run, which its own journey
         already holds still for. */
      spiderSit(el, dur, 0.2, 0.66);
    }

    /* Gone once it is off the screen, and not before: every journey ends
       outside the window, so the end of the journey is the same moment.
       Matched on the animation's name because the walk cycle ends constantly,
       and a hanging one's journey runs on its body rather than on this. */
    el.addEventListener('animationend', (e)=>{
      if(SPIDER_OVER.indexOf(e.animationName) < 0) return;
      try{ el.remove(); }catch(err){}
    });
    host.appendChild(el);
  }

  var spiderTimer = null;
  function spiderNext(){
    if(spiderTimer) clearTimeout(spiderTimer);
    const wait = SPIDER_GAP[0] + Math.random() * (SPIDER_GAP[1] - SPIDER_GAP[0]);
    spiderTimer = setTimeout(()=>{
      spiderTimer = null;
      try{ spiderSend(); }catch(e){}
      spiderNext();
    }, wait);
  }
  function spiderStart(){
    if(!$('spiders')) return;
    spiderNext();
  }
