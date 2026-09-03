  /* ---------------- PICTIONARY (shared) ----------------
     One person draws, everyone else types guesses, sixty seconds a word.

     Same shape as the other two shared games: the host owns the round and
     everybody else sends intents. Two things are particular to this one.

     **The word only ever reaches the drawer.** It is chosen by the host and
     pushed to exactly one person; every other window is told the length and
     nothing else. Same reasoning as hangman's answer — if it went out with the
     rest of the state, the game would be over.

     **Ink travels on its own, not inside the state.** A full state push per
     brush stroke would be absurd, so a stroke goes out as its own small message
     — `{kind:'ink'}` — and clients append it to the canvas they already have.
     The full picture is only ever sent to somebody who has just arrived and
     asks for it. `apply()` therefore switches on `kind`: the shared-game channel
     carries whatever object the host sends, and nothing says that has to be the
     same shape every time.

     Coordinates are 0..1, not pixels. Everyone's canvas is a different size and
     a phone and a laptop have to draw the same picture. */

  const PIC_SECONDS = 60;
  const PIC_INKS = ['#e7ecf6', '#4fe0c8', '#f2a765', '#f07a7a', '#8aa2f0', '#c9a6f0'];
  const PIC_WIDTHS = [2, 5, 11];
  const PIC_MAX_STROKES = 600;        // a picture, not an archive
  const PIC_FLUSH = 90;               // ms between sending pieces of a live line
  const PIC_BATCH = 6;                // ...or this many points, whichever comes first
  const PIC_HINT_AT = 20;             // seconds left when a letter is revealed
  const PIC_REMEMBER = 220;           // words kept out of circulation after use

  /* ---- the bank ----
     Comma-separated, not space-separated, which is the whole reason a clue can
     be more than one word. "hot air balloon" used to be impossible to store and
     came out as "hotairballoon" if you tried.

     Three lists, easiest first. The drawer is offered one from each, so there is
     a real decision at the start of a round: take the easy one and hope to be
     quick, or take the hard one, get half again as long, and be worth more.

     Everything here is drawable. That sounds obvious and the hard list used not
     to be: it was full of things like "bureaucracy" and "nostalgia", which are
     words rather than pictures, and the round just ran out. Hard now means a
     *scene* — several things in a relationship — not an abstraction.

     Roughly seven hundred in total across the three, which is what stops the
     same handful coming round every break. */

  const PIC_EASY = (
    'anchor, apple, arrow, astronaut, axe, backpack, balloon, banana, '
    + 'barn, basket, bat, bed, bee, bell, bicycle, bird, boat, bone, book, '
    + 'boot, bottle, bowl, bracelet, bread, bridge, broom, bucket, bus, '
    + 'butterfly, cactus, cake, camel, camera, candle, car, carrot, '
    + 'castle, cat, chair, cheese, cherry, chicken, church, clock, cloud, '
    + 'clover, coat, coffee, comb, compass, cookie, cow, crab, crayon, '
    + 'crown, cup, dinosaur, dog, dolphin, donut, door, dragon, drum, '
    + 'duck, ear, egg, elephant, envelope, eye, feather, fence, fire, '
    + 'fish, flag, flower, fork, fountain, fox, frog, giraffe, glasses, '
    + 'globe, glove, guitar, hammer, hand, hat, heart, helicopter, honey, '
    + 'horse, hourglass, house, ice, igloo, island, jacket, jellyfish, '
    + 'kangaroo, kettle, key, kite, knife, ladder, lamp, leaf, lemon, '
    + 'lighthouse, lightning, lion, lock, magnet, map, mask, microphone, '
    + 'moon, mountain, mouse, mushroom, nest, needle, octopus, onion, owl, '
    + 'paintbrush, palm, panda, parachute, peach, pencil, penguin, piano, '
    + 'pig, pillow, pineapple, pizza, plane, plug, pot, pumpkin, rabbit, '
    + 'rainbow, rake, ring, robot, rocket, rope, sailboat, sandwich, saw, '
    + 'scissors, shark, sheep, shell, shoe, shovel, skull, snail, snake, '
    + 'snowman, sock, spider, spoon, squirrel, stairs, star, strawberry, '
    + 'sun, sunglasses, sword, table, teapot, telescope, tent, tiger, '
    + 'toast, tooth, torch, tractor, train, tree, trophy, trumpet, turtle, '
    + 'umbrella, violin, volcano, wagon, watch, waterfall, whale, wheel, '
    + 'whistle, window, windmill, worm, yacht, zebra, ice cream, '
    + 'teddy bear, birthday cake, traffic light, paper bag, fire truck, '
    + 'police car, tree house, sand castle, light bulb, wrist watch, '
    + 'park slide, swing set, see saw, hair brush, tooth brush, '
    + 'alarm bell, road sign, stop sign, bus stop, train track, '
    + 'life jacket, sun hat, rain boots, oven mitt, rolling pin, '
    + 'frying pan, ice cube, straw hat, beach ball, water bottle, '
    + 'note book, paper clip, rubber band, safety pin, tape measure, '
    + 'screw driver, tool box, nail file, hair clip, ear ring, neck tie, '
    + 'bow tie, high heel, flip flop, tennis ball').split(',').map(w=>w.trim()).filter(Boolean);

  const PIC_MEDIUM = (
    'acrobat, airport, ambulance, anthill, applause, archer, avalanche, '
    + 'bakery, bandage, barbecue, beehive, binoculars, birdcage, blender, '
    + 'blizzard, bookshelf, bulldozer, cabinet, campfire, canoe, carousel, '
    + 'cathedral, cauldron, chandelier, chessboard, chimney, clothesline, '
    + 'coastline, cobweb, coconut, compost, conductor, confetti, coral, '
    + 'crossroads, crutches, cupcake, curtain, dartboard, desert, '
    + 'dominoes, doorbell, drawbridge, dungeon, earmuffs, easel, eclipse, '
    + 'escalator, fireplace, firework, fishbowl, flamingo, flashlight, '
    + 'flowerpot, footprint, fortress, gargoyle, gearbox, glacier, '
    + 'goalpost, gondola, graveyard, greenhouse, hammock, handcuffs, '
    + 'harbour, harmonica, haystack, headphones, hedgehog, hurdle, '
    + 'iceberg, incense, jackhammer, juggler, kaleidoscope, keyhole, '
    + 'lantern, lasso, lawnmower, lifeboat, lipstick, lobster, locomotive, '
    + 'marionette, metronome, microscope, minefield, mirror, mistletoe, '
    + 'moustache, newsstand, nutcracker, observatory, orchard, origami, '
    + 'paddle, pagoda, pancake, parasol, pavement, pendulum, periscope, '
    + 'pharmacy, pinwheel, pitchfork, playground, plumber, podium, '
    + 'porthole, postbox, pyramid, quicksand, quiver, racetrack, radiator, '
    + 'raincoat, reindeer, roller coaster, rowboat, scarecrow, scoreboard, '
    + 'seahorse, sewing machine, shipwreck, sledge, snorkel, sombrero, '
    + 'spacesuit, spotlight, sprinkler, stagecoach, stapler, steeple, '
    + 'stethoscope, stopwatch, submarine, sundial, surfboard, swamp, '
    + 'thermometer, thimble, tightrope, tollbooth, tornado, trench, '
    + 'tripod, tugboat, turnstile, typewriter, unicycle, '
    + 'vineyard, wardrobe, watermill, weathervane, wheelbarrow, windchime, '
    + 'workbench, wrench, piggy back, double decker, spiral shell, '
    + 'hot chocolate, cheese grater, garlic press, salad bowl, '
    + 'pepper mill, egg timer, tea strainer, cake stand, jam jar, '
    + 'bread knife, soup ladle, mixing bowl, cookie cutter, muffin tray, '
    + 'ice tray, wine glass, beer mug, bottle opener, cork screw, '
    + 'can opener, chopping board, oven glove, dish rack, kitchen sink, '
    + 'tap drip, plug hole, shower head, bath tub, towel rail, soap dish, '
    + 'tooth paste, shaving foam, hair dryer, hand mirror, cotton bud, '
    + 'first aid, plaster strip, thermos flask, lunch box, apple core, '
    + 'banana peel, orange slice, melon wedge, corn cob, pea pod, '
    + 'chilli pepper').split(',').map(w=>w.trim()).filter(Boolean);

  const PIC_HARD = (
    'haunted house, traffic jam, shooting star, message in a bottle, '
    + 'tug of war, brain freeze, breaking the ice, needle in a haystack, '
    + 'pot of gold, hot air balloon, washing machine, vending machine, '
    + 'fire escape, revolving door, ferris wheel, wishing well, '
    + 'water slide, ski lift, zip line, bunk bed, park bench, '
    + 'picket fence, garden gnome, bird bath, lightning rod, '
    + 'satellite dish, solar panel, wind turbine, oil rig, life raft, '
    + 'message board, ice fishing, cable car, tow truck, fire hydrant, '
    + 'manhole cover, speed bump, zebra crossing, roundabout, '
    + 'level crossing, bus shelter, phone box, ticket barrier, '
    + 'luggage carousel, departure board, control tower, runway lights, '
    + 'air traffic, hospital ward, operating theatre, dentist chair, '
    + 'waiting room, lecture hall, science lab, potting shed, '
    + 'greenhouse roof, market stall, fish market, butcher shop, '
    + 'bakery window, ice cream van, food truck, hot dog stand, '
    + 'popcorn machine, coffee grinder, espresso machine, cocktail shaker, '
    + 'wine cellar, beer barrel, cheese board, picnic blanket, tent peg, '
    + 'sleeping bag, walking boots, climbing rope, mountain pass, '
    + 'rope bridge, stepping stones, waterfall pool, rock pool, sand dune, '
    + 'palm island, coral reef, treasure map, pirate flag, ships wheel, '
    + 'life buoy, diving mask, snorkel tube, fishing net, lobster pot, '
    + 'harbour wall, fishing boat, paddle steamer, canal lock, '
    + 'narrow boat, river bank, weeping willow, tree stump, log cabin, '
    + 'wood pile, axe in a log, chopping block, bellows, blacksmith anvil, '
    + 'horse shoe, saddle bag, hay bale, scarecrow hat, tractor tyre, '
    + 'milking stool, sheep dog, chicken coop, pig sty, duck pond, '
    + 'beehive frame, apple orchard, vegetable patch, watering can, '
    + 'garden hose, wheelbarrow load, compost heap, bird feeder, '
    + 'squirrel raid, cat flap, dog kennel, hamster wheel, fish tank, '
    + 'parrot cage, rabbit hutch, vets table, pet carrier, dog lead, '
    + 'cat basket, snow plough, snow globe, icicle roof, frozen lake, '
    + 'ice rink, ski jump, sledge run, snow angel, igloo door, polar bear, '
    + 'penguin huddle, husky team, northern lights, telescope dome, '
    + 'space station, moon landing, rocket launch, satellite orbit, '
    + 'space walk, mission control, launch pad, lunar rover, '
    + 'meteor shower, solar eclipse, hourglass sand, cuckoo clock, '
    + 'grandfather clock, alarm clock, pocket watch, tuning fork, '
    + 'sheet music, music stand, drum kit, grand piano, double bass, '
    + 'brass band, record player, jukebox, karaoke night, concert stage, '
    + 'spotlight beam, curtain call, orchestra pit, ballet shoes, '
    + 'tap shoes, tutu skirt, magic wand, top hat rabbit, playing cards, '
    + 'chess clock, domino run, jigsaw piece, board game, pool table, '
    + 'bowling alley, skittle pins, table tennis, tennis net, golf bunker, '
    + 'cricket bat, hockey stick, ice hockey, rugby scrum, football boots, '
    + 'goal net, running track, high jump, long jump, pole vault, '
    + 'javelin throw, shot put, hurdle race, relay baton, finish tape, '
    + 'podium steps, gold medal, trophy cabinet, referee whistle, '
    + 'red card, penalty spot, crowd wave, stadium lights, team bus, '
    + 'locker room, weight bench, skipping rope, yoga mat, treadmill, '
    + 'exercise bike, punch bag, boxing ring, fencing mask, '
    + 'archery target, dart flight, kite string, paper plane, '
    + 'spinning top, yo yo, marble run, building blocks, toy train, '
    + 'rocking horse, jack in the box, teddy bear picnic, doll house, '
    + 'puppet show, shadow puppet, face paint, party hat, '
    + 'birthday candles, wrapping paper, gift ribbon, greeting card, '
    + 'letter box, postage stamp, air mail, parcel tape, packing crate, '
    + 'removal van, house keys, welcome mat, door knocker, spare room, '
    + 'attic ladder, cellar steps, spiral staircase, banister slide, '
    + 'laundry basket, clothes peg, ironing board, sewing kit, '
    + 'knitting needles, ball of wool, patchwork quilt, rocking chair, '
    + 'reading lamp, book stack, library ladder, card catalogue, '
    + 'magnifying glass, fingerprint, footprint trail, detective board, '
    + 'jail bars, court gavel, witness stand, bank vault, safe deposit, '
    + 'piggy bank, coin stack, cash register, shopping trolley, '
    + 'barcode scanner, price tag, changing room, shop window, mannequin, '
    + 'sale sign').split(',').map(w=>w.trim()).filter(Boolean);

  /* Harder words get longer, because the alternative is that nobody ever takes
     one. A scene needs setting up; sixty seconds is a fair go at a banana and
     not at "needle in a haystack". */
  const PIC_TIERS = [
    {key:'easy',   label:'Easy',     bonus:0, secs:60, words:PIC_EASY},
    {key:'medium', label:'Trickier', bonus:2, secs:75, words:PIC_MEDIUM},
    {key:'hard',   label:'Hard',     bonus:4, secs:90, words:PIC_HARD},
  ];
  function picTier(k){ return PIC_TIERS[k] || PIC_TIERS[0]; }

  /* Letters only, one space between words: what a guess and an answer are
     compared as. Guessing "hotairballoon" counts — you clearly saw it. */
  function picBare(s){ return String(s||'').toLowerCase().replace(/[^a-z]/g, ''); }
  /* The answer with everything you have not worked out yet held back.

     **Kept per guesser, not per room.** A shared board would mean the fastest
     reader hands the word to everybody else by typing, which is the opposite
     of a guessing game — and it would make sitting silently the best strategy.
     Yours fills in from your *own* guesses: every letter you use that is in
     the answer stays on the board for you, wrong words included. A near miss
     is worth something now instead of just being wrong.

     Spaces are shown as gaps, because how many words it is was never secret —
     `picShape()` has always said so in words. */
  function picMask(word, known){
    const have = String(known || '');
    return String(word || '').split('').map(ch=>{
      if(ch === ' ') return ' ';
      return have.indexOf(ch.toLowerCase()) >= 0 ? ch.toLowerCase() : '_';
    }).join('');
  }

  function picShape(w){
    const parts = String(w||'').split(' ').filter(Boolean);
    if(parts.length < 2) return parts.length ? parts[0].length + ' letters' : '';
    return parts.length + ' words — ' + parts.map(p=>p.length).join(' and ') + ' letters';
  }

  const Pictionary = {
    key:'pictionary',
    view:null, state:null, built:false,
    strokes:[],            // what this window has on its canvas
    drawing:null,          // the stroke in progress, drawer only
    inkId:0,               // so a partial stroke can be matched to its line
    fill:false,            // lasso mode: a stroke encloses rather than draws
    ink:PIC_INKS[0], width:PIC_WIDTHS[1],
    word:'',               // the answer — only ever set in the drawer's window

    /* ---- entering and leaving ---- */
    enter(){
      this.build();
      if(syncActive() && !syncIsHost()) syncGameSend(this.key, {a:'look'});
      if(syncIsHost()) this._ensure();
      this.render();
      this._repaint();
    },
    leave(){ this.drawing = null; },

    build(){
      if(this.built) return;
      const cv = $('pic-board');
      this.ctx = cv.getContext('2d');

      $('pic-inks').innerHTML = PIC_INKS.map((c,i)=>
        '<button class="pic-ink'+(i===0?' on':'')+'" data-ink="'+c+'" '
        + 'style="background:'+c+'" aria-label="Colour"></button>').join('');
      $('pic-inks').onclick = e=>{
        const b = e.target.closest('[data-ink]');
        if(!b) return;
        this.ink = b.dataset.ink;
        $('pic-inks').querySelectorAll('.pic-ink').forEach(x=>x.classList.toggle('on', x === b));
      };

      $('pic-sizes').innerHTML = PIC_WIDTHS.map((w,i)=>
        '<button class="pic-size'+(i===1?' on':'')+'" data-w="'+w+'" aria-label="Brush size">'
        + '<i style="width:'+(w+2)+'px;height:'+(w+2)+'px"></i></button>').join('');
      $('pic-sizes').onclick = e=>{
        const b = e.target.closest('[data-w]');
        if(!b) return;
        this.width = +b.dataset.w;
        $('pic-sizes').querySelectorAll('.pic-size').forEach(x=>x.classList.toggle('on', x === b));
      };

      /* Fill is a *mode*, not a separate button you press afterwards: you draw
         a lasso and what it encloses is filled as you go. Keeping it on the
         same stroke machinery means undo, the wire format and the far end all
         work already — it is one flag on a stroke. */
      $('pic-fill').onclick = ()=>{
        this.fill = !this.fill;
        $('pic-fill').classList.toggle('on', this.fill);
        $('pic-fill').setAttribute('aria-pressed', this.fill ? 'true' : 'false');
      };

      $('pic-undo').onclick = ()=>syncGameSend(this.key, {a:'undo'});
      $('pic-clear').onclick = ()=>syncGameSend(this.key, {a:'clear'});
      $('pic-take').onclick = ()=>syncGameSend(this.key, {a:'claim'});
      $('pic-offers').onclick = e=>{
        const b = e.target.closest('[data-k]');
        if(b) syncGameSend(this.key, {a:'pick', k:+b.dataset.k});
      };
      $('pic-next').onclick = ()=>syncGameSend(this.key, {a:'next'});
      $('pic-need-go').onclick = ()=>{ Arcade.close(); syncOpen(); };
      $('pic-form').addEventListener('submit', e=>{
        e.preventDefault();
        const g = $('pic-input').value.trim();
        $('pic-input').value = '';
        if(g) syncGameSend(this.key, {a:'guess', g});
      });

      this._wirePen();
      window.addEventListener('resize', ()=>{
        if(Arcade.open && Arcade.active === 'pictionary') this._repaint();
      });
      this.built = true;
    },

    /* ---- the pen ----
       A stroke goes out *while* it is being drawn, not when it is let go of.
       Waiting for the end was the single worst thing about this game: a long
       line meant everyone else watched an empty canvas for five seconds and
       then had a shape appear, so nobody could guess from how something was
       being drawn — which is most of what makes charades work.

       Points are still batched, because one message per pointermove would put a
       hundred a second on a connection that is also carrying a timer. Every
       PIC_FLUSH ms, or every PIC_BATCH points, whichever comes first: the
       stroke's id goes with them so the far end knows which line to extend. */
    _wirePen(){
      const cv = $('pic-board');
      const at = (e)=>{
        const r = cv.getBoundingClientRect();
        return [ Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
                 Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) ];
      };

      cv.addEventListener('pointerdown', e=>{
        if(!this._amDrawing()) return;
        if(e.pointerType === 'mouse' && e.button !== 0) return;
        cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
        const p = at(e);
        this.drawing = {id:'s' + (++this.inkId), c:this.ink, w:this.width,
                        f:this.fill ? 1 : 0, pts:[p], sent:0};
        this.strokes.push(this.drawing);
        this._count();
        /* A tap is a dot. It used to be a stroke of one point, which draws
           nothing at all — you could not put an eye in a face. */
        this._dot(this.drawing.c, this.drawing.w, p);
        this._flush();
      });
      cv.addEventListener('pointermove', e=>{
        const d = this.drawing;
        if(!d) return;
        e.preventDefault();
        const p = at(e);
        const last = d.pts[d.pts.length-1];
        // skip micro-movements; they cost bandwidth and change nothing
        if(Math.abs(p[0]-last[0]) < 0.004 && Math.abs(p[1]-last[1]) < 0.004) return;
        d.pts.push(p);
        /* A line can be extended by drawing the new segment on top of what is
           already there. A filled shape cannot — the fill changes everywhere as
           the outline moves — so it repaints. That is the whole canvas per
           move, which is why it is only done for the lasso. */
        if(d.f) this._repaint(); else this._segment(d.c, d.w, last, p);
        if(d.pts.length - d.sent >= PIC_BATCH || Date.now() - (d.at||0) > PIC_FLUSH) this._flush();
      });
      const finish = ()=>{
        const d = this.drawing;
        this.drawing = null;
        if(!d) return;
        this._flush(d, true);
      };
      ['pointerup','pointercancel','pointerleave'].forEach(ev=>cv.addEventListener(ev, finish));
    },

    /** Everything of this stroke the far end hasn't been told about yet. */
    _flush(stroke, end){
      const d = stroke || this.drawing;
      if(!d) return;
      const pts = d.pts.slice(Math.max(0, d.sent - 1));   // overlap one, so segments join up
      if(!pts.length && !end) return;
      d.sent = d.pts.length;
      d.at = Date.now();
      syncGameSend(this.key, {a:'ink', id:d.id, c:d.c, w:d.w, f:d.f ? 1 : 0, pts, end:!!end});
    },
    /* How much is on the canvas, in the DOM. Canvas contents are invisible to
       anything but a person looking at them, so without this there is nothing to
       assert on and nothing to debug against. Points as well as strokes, because
       a line arriving in pieces is the whole point of the ink protocol. */
    _count(){
      const cv = $('pic-board');
      if(!cv) return;
      let pts = 0;
      for(const s of this.strokes) pts += (s.pts || []).length;
      cv.dataset.strokes = String(this.strokes.length);
      // how many of them are lassos, which is what the far end is told
      cv.dataset.filled = String(this.strokes.filter(x=>x && x.f).length);
      cv.dataset.points = String(pts);
    },

    _amDrawing(){ const v = this.view; return !!(v && v.iAmDrawer && v.phase === 'drawing'); },

    /* ---- painting ---- */
    _segment(colour, w, a, b){
      const cv = $('pic-board'), ctx = this.ctx;
      if(!ctx) return;
      ctx.strokeStyle = colour;
      ctx.lineWidth = w * (cv.width / 600);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(a[0]*cv.width, a[1]*cv.height);
      ctx.lineTo(b[0]*cv.width, b[1]*cv.height);
      ctx.stroke();
    },
    _dot(colour, w, p){
      const cv = $('pic-board'), ctx = this.ctx;
      if(!ctx) return;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(p[0]*cv.width, p[1]*cv.height, Math.max(0.6, w * (cv.width/600) / 2), 0, Math.PI*2);
      ctx.fill();
    },
    /* A lasso. Everything the path encloses, filled — which is the difference
       between outlining a hat and having a hat.

       Canvas closes a path implicitly when filling, so a half-drawn lasso is
       just a smaller shape: it grows as you go and needs no end marker, which
       is what lets it travel over the same batched `ink` messages as a line
       with one extra flag on it. The outline is stroked as well, so a lasso
       drawn thin still has an edge and a single tap is still a dot. */
    _shape(s){
      const cv = $('pic-board'), ctx = this.ctx;
      if(!ctx) return;
      ctx.fillStyle = s.c;
      ctx.beginPath();
      ctx.moveTo(s.pts[0][0]*cv.width, s.pts[0][1]*cv.height);
      for(let i=1;i<s.pts.length;i++) ctx.lineTo(s.pts[i][0]*cv.width, s.pts[i][1]*cv.height);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = s.c;
      ctx.lineWidth = s.w * (cv.width / 600);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.stroke();
    },
    _drawStroke(s){
      if(!s || !s.pts || !s.pts.length) return;
      if(s.pts.length === 1){ this._dot(s.c, s.w, s.pts[0]); return; }
      if(s.f){ this._shape(s); return; }
      for(let i=1;i<s.pts.length;i++) this._segment(s.c, s.w, s.pts[i-1], s.pts[i]);
    },
    _repaint(){
      const cv = $('pic-board'), ctx = this.ctx;
      if(!cv) return;
      this._count();
      if(!ctx) return;
      ctx.clearRect(0, 0, cv.width, cv.height);
      for(const s of this.strokes) this._drawStroke(s);
    },

    /* ================= host side ================= */

    _blank(){
      return {
        round:0, drawer:null, lastDrawer:null, word:'', tier:0, secs:PIC_SECONDS,
        recent:[],                     // words we've had lately; see _offer()
        offer:[],                      // the three words on offer, drawer's eyes only
        strokes:[], phase:'claim', endsAt:0,
        guesses:[], got:[], scores:{}, over:null,
        /* Letters each guesser has turned up, keyed by peer id. Per person on
           purpose — see picMask(). */
        letters:{},
      };
    },

    /* A word from this tier that we haven't had lately. Three hundred words is
       no use if the same dozen keep coming up, which is what picking at random
       with no memory actually feels like over a week of breaks. */
    _offer(tier){
      const st = this.state;
      const recent = st.recent || (st.recent = []);
      const fresh = tier.words.filter(w=>recent.indexOf(w) < 0);
      const pool = fresh.length ? fresh : tier.words;
      const w = pool[Math.random()*pool.length|0];
      recent.push(w);
      // remember about a third of the bank, so nothing repeats for a long while
      // and the pool never empties
      while(recent.length > PIC_REMEMBER) recent.shift();
      return w;
    },

    _eligible(seats){
      const st = this.state;
      const open = seats.filter(s=>s.id !== st.lastDrawer);
      return open.length ? open : seats;
    },

    _ensure(){
      if(!syncIsHost()) return;
      const seats = syncSeats();
      if(!seats.length) return;
      if(!this.state) this.state = this._blank();
      const st = this.state;
      for(const s of seats) if(!st.scores[s.id]) st.scores[s.id] = 0;
      for(const id in st.scores) if(!seats.some(s=>s.id === id)) delete st.scores[id];

      // the artist walked off; nobody else can finish their drawing
      if(st.drawer && !seats.some(s=>s.id === st.drawer)) this._open();
      // or everybody else did, which is the same round with the other half
      // missing: there is nobody left to read it, so it stops there
      else if(st.drawer && seats.length < 2 && st.phase !== 'claim') this._alone();
      this._push();
      this._tickOn();
    },

    _open(){
      const st = this.state;
      st.drawer = null; st.word = ''; st.tier = 0; st.offer = [];
      st.phase = 'claim';
      st.strokes = []; st.guesses = []; st.got = []; st.over = null; st.endsAt = 0;
      st.letters = {};
      st.quick = false;
      syncGamePushAll(this.key, ()=>({kind:'clear'}));
    },

    /* The round the room emptied out from under. Ended rather than left running,
       so the clock isn't ticking down on a drawing nobody can see and the word
       isn't spent on nobody. Whoever is left keeps whatever was already guessed;
       it is thrown open again the moment somebody else arrives. */
    _alone(){
      const st = this.state;
      if(st.got.length) this._finish('alone');
      else this._open();
    },

    _tickOn(){
      if(this.timer) return;
      this.timer = setInterval(()=>{
        const st = this.state;
        if(!syncIsHost() || !st){ clearInterval(this.timer); this.timer = null; return; }
        if(st.phase !== 'drawing' && st.phase !== 'choosing') return;
        // the roster hook catches people leaving properly; this catches the rest
        // of them — a closed laptop, a dropped connection, a walked-away phone
        if(syncSeats().length < 2){ this._alone(); this._push(); return; }
        if(st.phase !== 'drawing') return;
        const left = Math.max(0, Math.round((st.endsAt - Date.now())/1000));
        if(left <= 0){ this._finish('time'); return; }
        this._push();
      }, 1000);
    },

    _finish(why){
      const st = this.state;
      st.phase = 'over';
      st.over = why;
      /* The drawer scores per person who got there, plus the difficulty bonus
         once — a drawing nobody can read is worth nothing, one everybody reads is
         worth a lot, and taking the hard word is worth taking. */
      if(st.got.length){
        const bonus = (PIC_TIERS[st.tier] || PIC_TIERS[0]).bonus;
        st.scores[st.drawer] = (st.scores[st.drawer]||0) + st.got.length + bonus;
      }
      this._push();
    },

    _next(){
      const st = this.state;
      st.round++;
      st.lastDrawer = st.drawer;
      this._open();
      this._push();
    },

    /** What everyone can see. The word itself is added for the drawer only. */
    _viewFor(id){
      const st = this.state;
      if(!st) return null;
      const seats = syncSeats();
      const name = who => (seats.find(s=>s.id === who) || {}).name || 'Someone';
      const left = st.phase === 'drawing'
        ? Math.max(0, Math.round((st.endsAt - Date.now())/1000)) : 0;
      const v = {
        kind:'state',
        round:st.round, phase:st.phase,
        iAmDrawer: id === st.drawer,
        drawerName: st.drawer ? name(st.drawer) : '',
        canClaim: !st.drawer && this._eligible(seats).some(s=>s.id === id),
        left, total: st.secs || picTier(st.tier).secs,
        length: picBare(st.word).length,
        shape: picShape(st.word),
        tier: st.tier,
        tierName: picTier(st.tier).label,
        bonus: picTier(st.tier).bonus,
        // A letter after two thirds of the time, because a drawing nobody can
        // read is a stalemate and everybody just waits for the clock.
        hint: (st.phase === 'drawing' && left <= PIC_HINT_AT && st.word)
          ? st.word[0] : '',
        /* Built here, in the host's per-player view, so the letters a guesser
           has not earned never reach their machine at all. Sending the answer
           and masking it in the browser would put it in devtools. */
        mask: (st.phase === 'drawing' && id !== st.drawer && st.word)
          ? picMask(st.word, (st.letters[id] || '')
              + (left <= PIC_HINT_AT ? picBare(st.word)[0] : ''))
          : '',
        guesses: st.guesses.slice(-14),
        gotIt: st.got.indexOf(id) >= 0,
        answer: st.phase === 'over' ? st.word : '',
        over: st.over,
        alone: seats.length < 2,
        players: seats.map(s=>({
          id:s.id, name:s.name, pts:st.scores[s.id]||0,
          drawer:s.id === st.drawer, me:s.id === id,
          got:st.got.indexOf(s.id) >= 0,
        })),
      };
      if(id === st.drawer){
        v.word = st.word;
        v.quick = !!st.quick;
        // the three on offer, with what each is worth, and only to them
        v.offer = st.offer.map((w,k)=>({
          w, label:PIC_TIERS[k].label, bonus:PIC_TIERS[k].bonus, secs:PIC_TIERS[k].secs,
        }));
      }
      return v;
    },

    _push(){ syncGamePushAll(this.key, id=>this._viewFor(id)); },

    /** One letter different, or a plural away — worth saying "close". */
    _near(a, b){
      if(Math.abs(a.length - b.length) > 1) return false;
      if(a.length === b.length){
        let diff = 0;
        for(let i=0;i<a.length;i++) if(a[i] !== b[i] && ++diff > 1) return false;
        return diff === 1;
      }
      const [s, l] = a.length < b.length ? [a, b] : [b, a];
      let i = 0, j = 0, skips = 0;
      while(i < s.length && j < l.length){
        if(s[i] === l[j]){ i++; j++; }
        else if(++skips > 1) return false;
        else j++;
      }
      return true;
    },

    _intent(from, m){
      if(!syncIsHost() || !m) return;
      this._ensure();
      const st = this.state;
      if(!st) return;

      if(m.a === 'look'){
        syncGamePush(this.key, from, this._viewFor(from));
        // and the picture so far, so somebody arriving mid-round sees it
        syncGamePush(this.key, from, {kind:'all', strokes:st.strokes});
        return;
      }

      if(m.a === 'claim'){
        if(st.drawer || st.phase !== 'claim') return;
        if(!this._eligible(syncSeats()).some(s=>s.id === from)) return;
        st.drawer = from;
        // One word from each tier. The clock doesn't start until they choose —
        // reading three words shouldn't cost you the round.
        st.offer = PIC_TIERS.map(t=>this._offer(t));
        st.phase = 'choosing';
        st.strokes = []; st.guesses = []; st.got = []; st.letters = {};
        syncGamePushAll(this.key, ()=>({kind:'clear'}));
        this._push();
        return;
      }

      if(m.a === 'pick'){
        if(from !== st.drawer || st.phase !== 'choosing') return;
        const k = m.k|0;
        if(k < 0 || k >= st.offer.length) return;
        st.word = st.offer[k];
        st.tier = k;
        st.offer = [];
        st.phase = 'drawing';
        st.secs = picTier(k).secs;
        st.endsAt = Date.now() + st.secs*1000;
        this._push();
        this._tickOn();
        return;
      }

      /* A piece of a line, most likely one that is still being drawn. The host
         keeps the picture so somebody arriving late can be handed all of it, so
         it has to do the same joining-up the watchers do. Relayed on at once —
         this is the one message in the app where being a beat late is felt. */
      if(m.a === 'ink'){
        if(from !== st.drawer || st.phase !== 'drawing') return;
        if(!Array.isArray(m.pts) || !m.pts.length || m.pts.length > 400) return;
        const last = st.strokes[st.strokes.length-1];
        if(last && last.id === m.id){
          if(last.pts.length < 4000) for(let i=1;i<m.pts.length;i++) last.pts.push(m.pts[i]);
        }else{
          if(st.strokes.length >= PIC_MAX_STROKES) return;
          st.strokes.push({id:m.id, c:m.c, w:m.w, f:m.f ? 1 : 0, pts:m.pts.slice()});
        }
        for(const seat of syncSeats()){
          if(seat.id === from) continue;
          syncGamePush(this.key, seat.id, {kind:'ink', id:m.id, c:m.c, w:m.w, f:m.f ? 1 : 0, pts:m.pts});
        }
        return;
      }

      if(m.a === 'undo' || m.a === 'clear'){
        if(from !== st.drawer || st.phase !== 'drawing') return;
        if(m.a === 'undo') st.strokes.pop(); else st.strokes = [];
        syncGamePushAll(this.key, ()=>({kind:'all', strokes:st.strokes}));
        return;
      }

      if(m.a === 'guess'){
        if(st.phase !== 'drawing' || from === st.drawer) return;
        if(st.got.indexOf(from) >= 0) return;
        const raw = String(m.g||'').toLowerCase().replace(/[^a-z ]/g,'')
          .replace(/\s+/g,' ').trim().slice(0,40);
        if(!raw) return;
        const seats = syncSeats();
        const who = (seats.find(s=>s.id === from) || {}).name || 'Someone';

        // spaces are the drawer's problem, not the guesser's
        if(picBare(raw) === picBare(st.word)){
          st.got.push(from);
          // sooner is worth more, so the race is worth running
          const left = Math.max(0, Math.round((st.endsAt - Date.now())/1000));
          /* A hard word read almost immediately says something about the
             drawing, not about the word — so it belongs to the drawer. Marked
             on the state and carried to them in their own view, because the
             host is not necessarily the person who drew it. */
          if(st.tier === 2 && (st.secs - left) <= 15) st.quick = true;
          const bonus = (PIC_TIERS[st.tier] || PIC_TIERS[0]).bonus;
          st.scores[from] = (st.scores[from]||0) + 2 + Math.round(left / 15) + bonus;
          st.guesses.push({who, text:'got it', got:true});
          if(st.got.length >= seats.length - 1) this._finish('all');
          else this._push();
          return;
        }
        /* Wrong, but not worthless: every letter of it that is in the answer
           is now theirs to see. Only theirs — `st.letters` is keyed by peer. */
        const answer = picBare(st.word);
        let mine = st.letters[from] || '';
        for(const ch of picBare(raw)){
          if(answer.indexOf(ch) >= 0 && mine.indexOf(ch) < 0) mine += ch;
        }
        st.letters[from] = mine;
        st.guesses.push({who, text:raw, close:this._near(picBare(raw), picBare(st.word))});
        this._push();
        return;
      }

      if(m.a === 'next'){
        if(st.phase !== 'over') return;
        this._next();
        return;
      }

      if(m.a === 'reset'){
        if(from !== SYNC.leaderId) return;
        this.state = this._blank();
        this._ensure();
      }
    },

    /* ================= drawing the screen ================= */

    apply(v){
      if(!v){ this.view = null; this.strokes = []; this.word = ''; this._repaint(); this.render(); return; }

      /* Ink arrives on its own, outside the state — see the note at the top —
         and arrives in pieces, while the line is still being drawn. Find the
         stroke it belongs to and carry it on; a piece for a line we haven't
         seen the start of is a new one. */
      if(v.kind === 'ink'){
        const live = this.strokes.length && this.strokes[this.strokes.length-1].id === v.id
          ? this.strokes[this.strokes.length-1] : null;
        const paint = Arcade.open && Arcade.active === 'pictionary';
        if(live){
          for(let i=1;i<v.pts.length;i++) live.pts.push(v.pts[i]);
          /* A growing lasso changes everywhere at once, so it cannot be extended
             by drawing the new segment on top — the whole thing is redrawn. A
             line still is, which is the cheap and much commoner case. */
          if(paint){
            if(live.f) this._repaint();
            else for(let i=1;i<v.pts.length;i++) this._segment(live.c, live.w, v.pts[i-1], v.pts[i]);
          }
        }else{
          const s = {id:v.id, c:v.c, w:v.w, f:v.f ? 1 : 0, pts:v.pts.slice()};
          this.strokes.push(s);
          if(paint) this._drawStroke(s);
        }
        this._count();
        return;
      }
      if(v.kind === 'clear'){ this.strokes = []; this.drawing = null; this._repaint(); return; }
      if(v.kind === 'all'){ this.strokes = v.strokes || []; this._repaint(); return; }

      const before = this.view;
      this.view = v;
      if(v.quick) { try{ featMark('picquick'); }catch(e){} }
      if(v.word) this.word = v.word;
      if(!before || before.round !== v.round){ this.word = v.word || ''; }
      if(Arcade.open && Arcade.active === 'pictionary') this.render();
      if(v.phase === 'over' && (!before || before.phase !== 'over')) this._cheer(v);
      try{ Arcade._refresh(); }catch(e){}
    },

    _cheer(v){
      if(v.gotIt || v.iAmDrawer){
        chime(false);
        showBanner('pic-banner', v.gotIt ? 'Got it.' : 'They saw it.', 'It was “'+v.answer+'”.');
      }
      setTimeout(()=>{ const b=$('pic-banner'); if(b) b.classList.add('hide'); }, 3600);
    },

    render(){
      if(!$('pic-live')) return;
      const v = this.view;
      const inRoom = syncActive();
      $('pic-need').classList.toggle('hide', inRoom);
      $('pic-live').classList.toggle('hide', !inRoom || !v);
      $('pic-next').classList.toggle('hide', !(v && v.phase === 'over'));
      $('pic-meta').textContent = v ? 'Round '+(v.round+1) : '';
      if(!inRoom || !v) return;

      const drawing = v.phase === 'drawing';
      const choosing = v.phase === 'choosing';
      $('pic-role').textContent = v.alone ? 'Nobody else is here yet'
        : v.phase === 'claim' ? (v.canClaim ? 'Up for grabs — first to claim draws'
                                            : 'You drew the last one')
        : choosing ? (v.iAmDrawer ? 'Pick your word' : v.drawerName + ' is picking a word')
        : v.iAmDrawer ? 'You’re drawing' + (v.bonus ? ' · ' + v.tierName + ' (+' + v.bonus + ')' : '')
        : v.drawerName + ' is drawing' + (v.bonus ? ' · ' + v.tierName : '');

      const clock = $('pic-clock');
      clock.textContent = drawing ? v.left + 's' : '';
      clock.classList.toggle('low', drawing && v.left <= 10);

      // the word, for the one person who should see it
      const wordBox = $('pic-word');
      const showWord = drawing && v.iAmDrawer && this.word;
      wordBox.classList.toggle('hide', !showWord);
      if(showWord){
        wordBox.innerHTML = '<small>Draw this'
          + (v.bonus ? ' · ' + esc(v.tierName) + ', +' + v.bonus : '')
          + ' · ' + v.total + 's</small>' + esc(this.word);
      }

      // the three on offer, and only to the person who has to pick
      const offering = choosing && v.iAmDrawer && (v.offer||[]).length;
      $('pic-choose').classList.toggle('hide', !offering);
      if(offering){
        $('pic-offers').innerHTML = v.offer.map((o,k)=>
          '<button class="pic-offer" data-k="'+k+'"><b>'+esc(o.w)+'</b>'
          + '<span>'+esc(o.label)+' · '+o.secs+'s</span>'
          + (o.bonus ? '<em>+'+o.bonus+'</em>' : '') + '</button>').join('');
      }

      $('pic-tools').classList.toggle('hide', !(drawing && v.iAmDrawer));
      $('pic-claim').classList.toggle('hide', !(v.phase === 'claim' && v.canClaim && !v.alone));
      $('pic-form').classList.toggle('hide', !(drawing && !v.iAmDrawer && !v.gotIt));
      $('pic-board').classList.toggle('watching', !this._amDrawing());

      const over = $('pic-over');
      const idle = v.phase !== 'drawing';
      over.classList.toggle('hide', !idle);
      if(idle){
        over.textContent = v.alone
          ? 'Share your code from Focus together and they can join in.'
          : v.phase === 'over'
            ? 'It was “' + v.answer + '”.'
            : choosing
              ? (v.iAmDrawer ? 'Pick one above — the clock starts when you do.'
                             : v.drawerName + ' is choosing a word.')
            : v.canClaim ? 'Claim it and you’ll get three words to choose from.'
                         : 'Waiting for somebody to claim this one.';
      }

      // guesses, most recent last
      $('pic-guesses').innerHTML = (v.guesses||[]).map(g=>
        '<div class="pic-guess'+(g.got?' got':g.close?' close':'')+'">'
        + '<b>'+esc(g.who)+'</b> ' + esc(g.text) + (g.close ? ' — close' : '') + '</div>').join('');
      const gl = $('pic-guesses');
      gl.scrollTop = gl.scrollHeight;

      $('pic-scores').innerHTML = v.players.map(p=>
        '<div class="pic-score'+(p.drawer?' turn':'')+(p.got?' done':'')+'">'
        + '<span>'+esc(p.name)+(p.me?' (you)':'')+'</span><b>'+p.pts+'</b></div>').join('');

      /* Letters spaced out so `_ _ _` reads as three blanks rather than one
         long rule, and the gaps between words stay legible. */
      const maskEl = $('pic-mask');
      if(maskEl){
        maskEl.classList.toggle('hide', !(v.mask && !v.gotIt));
        maskEl.textContent = v.mask ? v.mask.split('').join(' ').replace(/ {3}/g, '   ') : '';
      }

      $('pic-msg').textContent =
        v.alone ? ''
        : v.phase === 'over' ? 'Tap Next round to go again.'
        : !drawing ? ''
        : v.iAmDrawer ? 'No letters, no numbers — draw it.'
        : v.gotIt ? 'You got it. Sit tight.'
        : v.hint ? 'It starts with “' + v.hint + '” — ' + (v.shape || v.length + ' letters') + '.'
        : (v.shape || v.length + ' letters')
          + (v.bonus ? ' · ' + v.tierName + ', worth +' + v.bonus : '') + '.';
    },
  };

  syncGameRegister('pictionary', {
    intent(from, m){ Pictionary._intent(from, m); },
    apply(v){ Pictionary.apply(v); },
    roster(){ Pictionary._ensure(); },
    /* The board travels when the room does — see the handover note in
       29-sync.js. Nothing here needs converting: it is keyed by peer id, and a
       peer id belongs to the person now, not to the room. */
    save(){ return Pictionary.state; },
    load(s){ Pictionary.state = s; Pictionary._ensure(); },
  });

  registerGame('pictionary', {
    el:'game-pictionary', title:'Pictionary', progEl:'prog-pictionary',
    game:()=>Pictionary,
    canReset:()=>syncIsLeader(),
    reset(){ syncGameSend(Pictionary.key, {a:'reset'}); },
    resetNote:'Scores go back to zero for everyone and the round is thrown open.',
    async progress(){
      /* **Nothing.** The group heading above these four already says "needs a
         room", and the card's own chip says how many people — three ways of
         saying the same thing, stacked on top of each other in the same
         corner. An empty status collapses; see `.pcard .prog:empty`. */
      if(!syncActive()) return '';
      const v = Pictionary.view;
      if(!v || v.alone) return 'Ready<span>waiting</span>';
      if(v.phase === 'claim') return 'Open<span>claim to draw</span>';
      if(v.phase === 'choosing') return 'Picking<span>choosing a word</span>';
      if(v.phase === 'over') return 'Done<span>next round</span>';
      return v.left + 's<span>left</span>';
    }
  });

