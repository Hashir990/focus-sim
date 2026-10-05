  /* ---------------- EMBERS ----------------
     Something to show for the time, that isn't a number going up.

     The rule is deliberately dull: **one ember for every ten minutes of focus
     you actually finish**, never fewer than one, and only ever for finished
     blocks. Nothing is awarded for opening the app, for streaks, for logging in
     on a Tuesday. A currency that can be farmed stops meaning anything, and
     this one is meant to be a record of hours rather than a score.

     They are spent on two kinds of thing, on one shelf:

       **Lights** — the colour the focus screen burns, and the weather behind
       it. The one it ships with is free and yours.

       **Sounds** — the ambience tracks, which bring their own colours and their
       own weather as well as filling the room. Rain and Café are free; the
       other three are bought.

     **One at a time.** Choosing a light stops the track; choosing a track puts
     the light out. They both want the palette and both want the pane behind the
     timer, and two of them at once was a mess — a green field under a rainstorm
     with the room lit amber. `Embers.look` is whichever one is on.

     That is the whole economy: no consumables, no upgrades, nothing to lose by
     not spending. You end up with a shelf and a rough sense of how long each
     thing on it took.

     Storage is one small record under `focus_embers`. It survives everything
     except Reset progress, which says plainly that it takes them with it. */

  const EMB_PER = 600;              // seconds of focus per ember
  /** **The mark, wherever a number of embers is stated.**

      A bare "42" on a shelf is a number with no unit; the diamond in the top bar
      is what the currency looks like everywhere else in the app, and a price is
      the one place it most needs to be recognisable. Same shape, same accent,
      same rotated square — one class rather than a glyph, so it dyes with the
      look like the chip does. Decorative, so it is hidden from a screen reader,
      which reads the number and the word instead. */
  function embMark(){ return '<i class="emb-mark" aria-hidden="true"></i>'; }
  /** A price, as it is written on a shelf: the mark and the number. */
  function embPrice(n){ return embMark() + '<span>' + (n | 0) + '</span>'; }
  /** A shelf tile's first column, where the thing for sale is not a colour.
      Takes the 24-unit drawing an item carries and puts it where the dot goes;
      `currentColor` so it dyes with `--lit` like the dot does. */
  function embIcon(ic){
    return '<svg class="emb-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
      + (ic || '') + '</svg>';
  }

  const EMB_KEY = 'focus_embers';

  /* Each light is a palette for the focus phase only — rest keeps its warm
     amber, because the point of rest is that it doesn't look like work. The
     first is free and always owned. Prices climb steeply on purpose: the last
     one is somewhere around forty hours of focus, which is a term's worth of
     mornings and ought to feel like it. */
  /* Each one's palette is its effect's colour: green spores under a green
     room, blossom under a pink one. They were amber-with-green-spores and so on
     before, which read as two effects fighting rather than as one place. */
  const EMB_LIGHTS = [
    {id:'seaglass', name:'Sea glass', note:'Blue and teal, rising', cost:0,
     accent:'#4fe0c8', fx:'sparks', fxc:'#5ee6d0', fxc2:'#6fb6f5', fxm:1},
    /* `fxo` holds the wash down. Four shapes the size of the screen at the
       kind's own opacity added up to a flat ochre field with the quote and the
       byline sitting on it at almost no contrast — the only look in the shop
       where the weather beat the words. Lower, and it is light falling across
       the room again rather than a coat of paint over it. */
    {id:'latesun', name:'Late sun', note:'Yellow into orange, in waves', cost:36,
     accent:'#f7bd52', fx:'sun', fxc:'#ffe07a', fxc2:'#ff9a3c', fxm:1, fxo:.6},
    {id:'dusk', name:'Dusk', note:'Smoke, white through to blue-black', cost:52,
     accent:'#c3cede', fx:'smoke', fxc:'#eef3fb', fxc2:'#55637a', fxm:1},
    /* Bubblegum is the quiet one of the pair: the same purple night, pink
       lights swelling and going out instead of anything going bang. */
    {id:'frost', name:'First frost', note:'Snow, white and grey', cost:68,
     accent:'#e4ecf2', fx:'snow', fxc:'#ffffff', fxc2:'#9aa8b4', fxm:1},
    {id:'hearth', name:'Hearth', note:'Spores, every shade of green', cost:168,
     accent:'#8fd977', fx:'spores', fxc:'#c8f0a0', fxc2:'#4f9e58', fxm:1},
    /* Dusk's smoke, lit from underneath and three times as thick — smoke coming
       off a fire is not weather drifting past, and eight shapes read as the
       latter however you colour them (`fxn`, see vfxCount in 38-vfx.js). The
       pair runs ember-red to a near-black burnt red rather than through orange:
       an orange-to-black ramp goes brown in the middle, which is smoke off wet
       wood, not off a fire. */
    /* Lava rather than smoke off a fire: many small shapes instead of a few
       cloud-sized ones (`fxs` shrinks them, `fxn` multiplies them), and discrete
       colours taken in turn rather than blended, because what makes molten rock
       read as molten is bright orange *between* dark crust. A blend of orange
       and near-black is an unbroken brown, which is mud. */
    {id:'magma', name:'Magma', note:'Lava, cracking orange through black', cost:200,
     accent:'#ff6a30', fx:'smoke', fxc:'#ff4a1e', fxc2:'#3a0602', fxm:1,
     /* `fxn` still asks for plenty; the kind's `cap` is what actually decides,
        and it is there because these carry a blur each. Thickness past that
        comes from opacity, which is free. */
     /* **Bigger, and more of them.** At four tenths these were specks crossing
        an empty screen — the look read as pellets drifting through the dark
        rather than as lava, which is bright cracks in a crust and is therefore
        mostly *bright*. Nine of them at nine tenths, with a floor in the CSS
        that ties the size to the screen; see the magma rule in 31-vfx.css. */
     fxn:11, fxo:2.3, fxs:.9,
     /* One black in ten. The rest is orange taken across its whole range —
        yellow-hot through to a deep burnt red — because what carries the look is
        the *variation* within the orange, not the contrast against black. A
        single dark speck is enough to read as a piece of cooled crust; two were
        already starting to pull it back towards smoke. */
     fxpal:['#ff7a1e', '#ff3b0f', '#ffab3d', '#c21f07', '#ffd27a',
            '#ff5c14', '#ff9326', '#8f2a05', '#ffc266', '#1c0402']},
    /* **A city, and it is only its windows.** The towers are one colour —
       near enough the sky's — and everything that makes them read as buildings
       is the grid of lit windows in them and the way they slide past each
       other. So the look gives the weather a silhouette in `fxc` and no second
       colour at all: the windows are drawn from --accent in the CSS, which
       means the one warm thing on the screen is also the colour of every
       button, and the whole interface reads as being lit by the city. */
    {id:'skyline', name:'Skyline', note:'Towers after dark, windows lit', cost:240,
     accent:'#ffc46b', fx:'towers', fxm:1, fxc:'#04060e'},
    {id:'bubblegum', name:'Bubblegum', note:'Pink lights on a purple night', cost:290,
     accent:'#ff8fd0', fx:'bokeh', fxc:'#ffa6dc', fxc2:'#ff62b4', fxm:1},
    {id:'peony', name:'Peony', note:'Blossom, pink on pink', cost:350,
     accent:'#f28cae', fx:'petals', fxc:'#ffd3e0', fxc2:'#e8608f', fxm:1},
    /* **A sunset, and it used to be daylight.** This was the one light look on
       the shelf, which meant --card, --line and --track had to be inverted for
       it alone and every rule reaching past the tokens needed a beach-shaped
       exception beside it. A focus app is mostly used in the evening anyway.
       Now it is dark like the rest, the exceptions are gone, and the motes are
       the warm glare coming off water under a low sun. See 30-embers.css. */
    {id:'beach', name:'Beach', note:'A sunset, and a tide coming in', cost:350,
     accent:'#ff9d4d', fx:'bokeh', fxc:'#ffb36b', fxc2:'#e28cb4', fxm:1},
    {id:'fireworks', name:'Fireworks', note:'Rockets, bursts, embers coming down', cost:425,
     accent:'#ff7ab8', fx:'fw', fxc:'#ffe066', fxc2:'#ff7ab8', fxm:1,
     // weighted towards the yellows, with the pinks and blues between them
     fxpal:['#ffe066', '#ff7ab8', '#fff2a8', '#7ac8ff', '#ffd166', '#b78cff',
            '#ffe89a', '#8ef2b0']},
    /* The dearest one, and the only light that brings a shape with it: a web
       behind the dial, drawn as inline SVG in the timer markup and shown by
       this id alone. Kept faint on purpose — it is behind a countdown, and a
       mark you can read at a glance is a mark that competes with the numbers. */
    {id:'spiderman', name:'Spider-Man', note:'The suit, with webs in the corners', cost:350,
     accent:'#e01b24', fx:'motes', fxc:'#e01b24', fxc2:'#2438a8', fxm:1},
    /* **Stars are not white.** A field of identical white dots reads as dirt on
       the screen; what makes a sky read as a sky is that the colours are
       *discrete* and mostly-but-not-quite white — a blue one, a warm one, and
       eight plain ones between them. So this takes a palette rather than a
       blend, for the same reason Magma does and the opposite effect: there the
       gap between the colours is the lava, here it is the sameness with a few
       exceptions in it. The cloud behind them is painted, not thrown; see the
       nebula note in 31-vfx.css. */
    {id:'space', name:'Deep space', note:'Stars, and a nebula drifting through', cost:450,
     accent:'#9fc4ff', fx:'stars', fxc:'#ffffff', fxc2:'#cfe3ff', fxm:1,
     /* Mostly white, because stars are, with two blues and two warm ones in
        eleven. **The accent stays blue-white on purpose**: the room it is seen
        against is crimson now, and blue-white on crimson is the contrast the
        photographs have — hot young stars in front of hydrogen. A red accent
        would vanish into it. */
     fxpal:['#ffffff', '#cfe3ff', '#ffffff', '#ffe6bd', '#b7d2ff', '#ffffff',
            '#ffd3a0', '#e6efff', '#ffffff', '#9fc4ff', '#fff4e2']},
  ];
;


  /* The ambience tracks, as things you own. Two are free, because an app that
     ships with no sound at all until you have earned some is a worse app. Each
     brings its own weather as well as its own tint. */
  const EMB_SOUNDS = [
    {id:'cafe', name:'Café', note:'A room, out of focus', cost:36,
     accent:'#d9a774', fx:'bokeh', fxc:'#e8c398', fxm:1},
    {id:'rain', name:'Rain', note:'Lines down the glass', cost:136,
     accent:'#7fb2d9', fx:'rain', fxc:'#a8d6f5', fxm:1},
    {id:'office', name:'Office', note:'Somebody typing next door', cost:210,
     accent:'#9fb4cc', fx:'keys', fxc:'#bcd0e6', fxc2:'#7f97b3', fxm:1},
    {id:'forest', name:'Forest', note:'Leaves letting go', cost:310,
     accent:'#7fc98a', fx:'leaves', fxc:'#cbe8a8', fxc2:'#5f9c6b', fxm:1.2},
    {id:'campfire', name:'Campfire', note:'Sparks thrown off the top', cost:310,
     accent:'#f0a05a', fx:'sparks', fxc:'#ffc083', fxc2:'#ff8f4d', fxm:.6, fxw:2.6,
     fxflick:1},
  ];
;
  const EMB_SND = 'snd-';                       // how a sound is filed in `own`

  /* ---------------- what these used to cost ----------------

     **A price is not a number you can just change here.** The balance is
     derived and never stored: `have = earned - SUM(price(id) for id in own)`.
     Put a price up and that sum is recomputed over things people bought years
     ago at the old one — so raising eleven lights, five tracks and three clock
     faces at once took several hundred embers off everybody who owned them,
     all at once, for nothing. That is the "embers automatically going to 0"
     report, and it is not a rounding error: it is what a derived balance does
     when you rewrite its history.

     So the shop's price and the price you *paid* are two different things.
     This is the second one, frozen: what each of these cost before the rise.
     Anything a device already owned when it first ran this build is written
     into `Embers.grand` and priced from this table forever; anything bought
     afterwards pays what the shelf says. `grand` is unioned across devices
     like `own` is, so two devices updating weeks apart agree.

     **Never edit these numbers.** They are a receipt, not a price list. If
     something goes up again, the way to do it is another table beside this
     one and another list beside `grand` — not a change here. */
  const EMB_WAS = {
    seaglass:0, latesun:5, dusk:10, frost:15, hearth:20, magma:25,
    bubblegum:30, peony:40, beach:40, fireworks:50, spiderman:40,
    'snd-cafe':5, 'snd-rain':15, 'snd-office':20, 'snd-forest':35, 'snd-campfire':35,
    'face-digital':0, 'face-analog':40, 'face-flip':20, 'face-glass':60,
  };

  /* **The wardrobe went up in the same release and was left out of the table
     above.** Every buddy price rose two to five times in 1.3.5 while `grand`
     only knew about lights, sounds and faces, so a shelf of coats and antics
     bought at the old prices was re-charged at the new ones: one device holding
     twenty-six of them was charged 4877 against 1612 earned, where what it had
     actually paid came to 1529. The balance sat at zero, and every ember earned
     afterwards fell into the hole — "embers keep resetting to 0".

     These are the rows as they were on sale from 6 to 15 September, frozen the
     same way and for the same reason: a receipt, not a price list. Rows are
     indexed exactly like BUD_COST in 46-buddy.js. */
  const EMB_WAS_BUD = {
    e:  [0, 12, 14, 12, 16, 18, 16, 20, 22, 26, 24, 28, 26],
    r:  [0, 16, 22, 24, 20, 28, 18, 32, 30, 34, 26],
    h:  [0, 18, 16, 24, 30, 34, 20, 32, 38, 30, 26, 22, 44],
    f:  [0, 26, 22, 28, 48, 30, 34, 20, 24, 38],
    a:  [0, 14, 16, 20, 24, 22, 26, 22, 28],
    o:  [0, 45, 50, 55, 80, 40, 60, 45, 35, 50, 42, 48, 62, 52, 38],
    an: [100, 35, 60, 70, 85, 55, 45, 30],
  };
  /* **Which devices have met the wardrobe's rise**, written into `grand`
     itself rather than into a new list beside it. `grand` already travels —
     unioned by 47-merge.js and by the server's copy of it — so the buddy's old
     prices reach every device on the account without the server having to
     learn a new key first, which is the step that silently drops things. It is
     never in `own`, so it is never priced. */
  const EMB_BUD_MET = '@bud-rise';

  /** What a thing cost before the rise, or null if it was not on sale then. */
  function embWas(id){
    if(EMB_WAS[id] != null) return EMB_WAS[id];
    const m = /^bud-(an|[a-z])(\d+)$/.exec(String(id || ''));
    const row = m && EMB_WAS_BUD[m[1]];
    const v = row ? row[parseInt(m[2], 10)] : undefined;
    return v != null ? v : null;
  }

  /* **What a look is actually made of, read back out of the stylesheet.**

     The catalogue carries a look's accent and its weather colours, but not its
     sky: that lives in 30-embers.css as --bg and --bg2 on a rule scoped to
     body[data-light="id"]. Nothing in JS has ever needed it, because the way
     you see a look is by wearing it.

     A confirmation cannot wear it -- putting the palette on the body to show a
     swatch would repaint the whole app behind the dialog for something you
     might be about to cancel. So the rule is found and read instead. Read-only,
     and wrapped, because a stylesheet from another origin throws on .cssRules
     rather than returning nothing, and one unreadable sheet must not take the
     shop with it. */
  function embPalette(id){
    const want = '[data-light="' + id + '"]';
    const alt = '[data-amb="' + id + '"]';
    try{
      for(const sheet of document.styleSheets){
        let rules;
        try{ rules = sheet.cssRules; }catch(e){ continue; }
        if(!rules) continue;
        for(const r of rules){
          const sel = r.selectorText;
          if(!sel || (sel.indexOf(want) < 0 && sel.indexOf(alt) < 0)) continue;
          const get = (k)=>(r.style.getPropertyValue(k) || '').trim();
          const bg = get('--bg');
          if(!bg) continue;
          return {accent:get('--accent'), bg, bg2:get('--bg2') || bg};
        }
      }
    }catch(e){}
    return null;
  }
  /** What the confirm dialog needs to draw one of these. */
  function embShow(item){
    const p = embPalette(item.id) || {};
    return {
      accent:p.accent || item.accent,
      c1:p.bg || item.accent,
      c2:p.bg2 || item.fxc || item.accent,
      /* No name: the dialog's own title is the name, and the two sat one
         above the other saying the same word. */
      note:item.note ? T(item.note) : '',
    };
  }

  function embLight(id){ return EMB_LIGHTS.find(l=>l.id === id) || EMB_LIGHTS[0]; }
  function embSound(id){ return EMB_SOUNDS.find(s=>s.id === id) || null; }
  /** Free, or bought. Asked by the ambience picker before it plays anything. */
  function embHasSound(id){
    const s = embSound(id);
    if(!s) return id === 'off';
    return s.cost === 0 || Embers.own.indexOf(EMB_SND + id) >= 0;
  }

  /** A shelf, cheapest first. Ties hold their catalogue order so nothing
      reshuffles between two things that cost the same, and so the free one — a
      shelf's starting look, its starting face — stays at the front where it
      belongs. Written as a copy: these catalogues are read from elsewhere and
      sorting one in place would reorder the thing itself. */
  function embByPrice(list){
    return list.slice().map((x, i)=>[x, i])
      .sort((a, b)=>((a[0].cost || 0) - (b[0].cost || 0)) || (a[1] - b[1]))
      .map(x=>x[0]);
  }

  const Embers = {
    have:0,             // unspent
    adjust:0,           // embers from before any of this was derivable; see reconcile()
    earned:0,           // ever, which is the number that is really a record
    bank:0,             // seconds of focus not yet worth a whole ember
    own:['seaglass'],
    /* Everything owned when the prices went up, priced from `EMB_WAS` for
       good. `null` means "this device has not met the rise yet" and is what
       `load()` looks for; an empty array is a device that met it owning
       nothing, which is a different thing and must not migrate twice. */
    grand:null,
    claimed:[],         // achievements already paid out; see 40-achievements.js
    light:'seaglass',
    /* `loaded` is the re-entrancy latch and goes up *before* the await, so it
       is true throughout a load that has not finished. `ready` goes up after,
       and is the only honest answer to "is `own` the real list yet" — see
       `budStrip` in 46-buddy.js, which takes things off him for good and must
       never do it against the default. */
    loaded:false,
    ready:false,

    /* Things that happened once and left no trace.
       Nearly every achievement is *derived* — the hours come from the log, the
       crosswords from the crossword's own save — and that is deliberate, because
       a derived number cannot drift. But some of them are moments, not states:
       a pawn promoted, seven tiles laid down at once, a hard word read inside
       fifteen seconds. Nothing about the board afterwards remembers that it
       happened, so these are the one kind that has to be written down when it
       does. Values are counts, so "ten sudokus" works the same way as "a pawn". */
    feats:{},

    async load(){
      if(this.loaded) return;
      this.loaded = true;
      const r = await KV.get(EMB_KEY);
      if(r && r.value){
        try{
          const d = JSON.parse(r.value) || {};
          this.adjust = Math.max(0, d.adjust|0);
          this.have = Math.max(0, d.have|0);
          this.earned = Math.max(0, d.earned|0);
          this.bank = Math.max(0, Math.min(EMB_PER - 1, d.bank|0));
          this.own = Array.isArray(d.own) && d.own.length ? d.own : ['seaglass'];
          this.grand = Array.isArray(d.grand) ? d.grand : null;
          // Meadow became Fireworks; anybody who bought the one has the other
          if(this.own.indexOf('meadow') >= 0 && this.own.indexOf('fireworks') < 0){
            this.own.push('fireworks');
          }
          if(d.light === 'meadow') d.light = 'fireworks';
          if(this.own.indexOf('seaglass') < 0) this.own.unshift('seaglass');
          this.claimed = Array.isArray(d.claimed) ? d.claimed : [];
          this.feats = (d.feats && typeof d.feats === 'object') ? d.feats : {};
          this.light = this.own.indexOf(d.light) >= 0 ? d.light : 'seaglass';
        }catch(e){}
      }
      /* Everything the balance is written into, not only the palette.
         `paint()` sets the colours; the chip in the top bar and the shelf's own
         rows are drawn by `_mark()` and `render()`, and neither of them ran
         here — so on a cold start the counter said 0 and the shelf showed
         nothing owned until something else happened to redraw them. Which is
         why a purchase from a previous session only appeared after finishing a
         block or opening the page twice. */
      /* The one moment at which "owned" means "owned before the rise". After
         the record has been read, before anything can be bought. A device with
         no record at all is a fresh install and grandfathers nothing, which is
         also the right answer — it never paid the old price. */
      if(this.grand == null){
        this.grand = (this.own || []).filter(id=>EMB_WAS[id] != null);
        try{ this.save(); }catch(e){}
      }
      /* The same moment for the wardrobe, once. Only `bud-` ids: a light
         bought at its new price after the first rise must not be swept in here
         and handed its old one. Everything the device holds is taken — after
         1.3.5 the re-priced wardrobe left every such device at zero, so almost
         nothing can have been bought at the new prices, and the error in the
         other direction would be charging somebody twice. */
      if(this.grand.indexOf(EMB_BUD_MET) < 0){
        const had = this.grand;
        this.grand = had.concat((this.own || []).filter(id=>
          typeof id === 'string' && id.indexOf('bud-') === 0
          && embWas(id) != null && had.indexOf(id) < 0), [EMB_BUD_MET]);
        try{ this.save(); }catch(e){}
      }
      this.ready = true;
      this.paint();
      this._mark();
      try{ this.render(); }catch(e){}
    },
    save(){
      KV.set(EMB_KEY, JSON.stringify({
        adjust:this.adjust,
        have:this.have, earned:this.earned, bank:this.bank, own:this.own,
        grand:this.grand || [],
        claimed:this.claimed, feats:this.feats, light:this.light,
      }));
    },

    /* A focus block finished. Called from logSession, so followers earn too.

       **Seconds are banked, not rounded.** It used to pay `max(1, secs/600)`,
       which meant every block was worth at least one ember however short it
       was — so starting a block and skipping it immediately, over and over,
       paid better than working. The remainder carries instead: ten minutes of
       focus is worth one ember whether you did it in one sitting or five, and
       a one-second block is worth one second. There is nothing to farm,
       because the only thing being counted is time that actually passed. */
    earn(secs){
      this.bank += Math.max(0, Math.round(secs || 0));
      const n = Math.floor(this.bank / EMB_PER);
      if(n > 0){
        this.bank -= n * EMB_PER;
        this.credit(n, n + (n === 1 ? ' ember' : ' embers'));
      }else{
        this.save();
        this._mark();
      }
      try{ achCheck(); }catch(e){}
      return n;
    },

    /* ---- the balance, recomputed from where it came from ----
       `earn` and `credit` keep a running total because that is what makes an
       ember land on screen the second it is earned. A running total is also the
       one thing that cannot survive two devices: whichever of them is behind
       stays behind for ever, and nothing ever notices.

       So the total is also *derivable*, and this is the derivation. Focus time
       comes out of the log, achievements out of what has been claimed, spending
       out of what is owned — all three of which merge cleanly (47-merge.js).
       Called on load, and after any merge. If the two ever disagree, the
       derived answer is the true one and the stored one was drift.

       `adjust` is the exception, and it is the honest kind: a copy that has
       been running since before this existed has embers that were never in a
       log. Rather than take them away, the difference is written down once, on
       the first load that notices, and carried from then on. */
    /* **What it costs on the shelf.** Not necessarily what you were charged —
       see `paidFor` below and `EMB_WAS` above. */
    priceOf(id){
      if(typeof id !== 'string') return 0;
      if(id.indexOf(EMB_SND) === 0){ const s = embSound(id.slice(EMB_SND.length)); return s ? s.cost : 0; }
      if(id.indexOf('face-') === 0){ try{ return faceDef(id.slice(5)).cost || 0; }catch(e){ return 0; } }
      /* Everything the buddy wears, and every antic he does. **Anything that
         can appear in `own` has to be priceable here or the balance drifts** —
         `embersFrom` derives what has been spent by pricing the list, so an id
         this does not recognise is a thing that was bought for nothing. See
         `budPriceOf` in 46-buddy.js for how one is parsed. */
      if(id.indexOf(BUD_ITEM) === 0){ try{ return budPriceOf(id); }catch(e){ return 0; } }
      /* Quote packs, for the same reason and it is not a formality: without
         this line a pack costs its price once and then refunds itself on the
         next reconcile, because a list priced at zero looks like nothing was
         ever spent. That is the shape of the bug that put somebody's balance
         on zero in 1.3.5, running the other way. */
      if(id.indexOf(EMB_QP) === 0){ const p = qpack(id.slice(EMB_QP.length)); return p ? p.cost : 0; }
      const l = EMB_LIGHTS.find(x=>x.id === id);
      return l ? l.cost : 0;
    },
    /* **What you were actually charged**, which is the only honest input to a
       derived balance. The shelf price for anything bought after the rise; the
       frozen one for anything held before it. This is what `reconcile()` and
       the achievements page price the owned list with — `priceOf` is for
       what to write on a tile. */
    paidFor(id){
      const was = embWas(id);
      if(this.grand && was != null && this.grand.indexOf(id) >= 0) return was;
      return this.priceOf(id);
    },
    /* **`ACH_LIST`, and it said `ACH`.** There has never been an `ACH`: the
       lookup threw, the catch returned 0, and every achievement was worth
       nothing to the derivation. Claiming one still flashed "+6" through
       `credit()`, and the next reconcile took it away again. */
    payout(id){
      try{ const a = ACH_LIST.find(x=>x.id === id); return a ? (a.pays || 0) : 0; }catch(e){ return 0; }
    },

    reconcile(){
      const self = this;
      const d = embersFrom(LOG, this.own, this.claimed, this.feats, this.adjust,
        (id)=>self.paidFor(id), (id)=>self.payout(id));
      /* First run after the derivation existed: whatever the old stored number
         was above what can be explained is written down as carried history. */
      if(!this.adjust && this.earned > d.earned){
        this.adjust = this.earned - d.earned;
        return this.reconcile();
      }
      this.earned = d.earned;
      this.have = d.have;
      this.bank = d.bank;
      return d;
    },

    /* ---- grants, which are not payments ----

       **A running total does not survive a reload; `adjust` does.** `credit()`
       raises `have` and `earned` in memory, and the next `reconcile()` throws
       both away and works the balance out again from the log, the claimed
       achievements and `adjust`. That is right for everything that pays —
       focus time and achievements are *in* those inputs — and wrong for
       anything handed over from outside them, which is what the developer page
       does. Its +1000 looked like it worked and was gone by the next start.

       So a grant goes into `adjust`, the one input that means "embers that were
       never in a log", and then the derivation is re-run rather than bypassed:
       what you see afterwards is what you will still have tomorrow. */
    grant(n, what){
      const add = Math.round(Number(n) || 0);
      if(!add) return this.have;
      this.adjust = Math.max(0, this.adjust + add);
      this.reconcile();
      this.save();
      this.paint();
      this._mark();
      try{ this.render(); }catch(e){}
      if(add > 0) this.flash('+' + (what || add));
      return this.have;
    },

    /* **Write off a spend that nothing can explain.**

       The balance is `earned - spent`, floored at zero, and the developer page
       can put things in `own` without anything having paid for them. Owning the
       whole shelf that way is about fourteen thousand embers of spending
       against an honest few hundred earned — so the balance sits at zero and
       every ember earned afterwards disappears into the hole, which reads
       exactly like earning being broken.

       This does not invent a balance: it raises `adjust` to cover the part of
       the spend that has no source, leaving `have` at zero and the *next*
       ember earned worth one ember again. Returns what it had to write off. */
    settle(){
      const self = this;
      const d = embersFrom(LOG, this.own, this.claimed, this.feats, this.adjust,
        (id)=>self.paidFor(id), (id)=>self.payout(id));
      const hole = Math.max(0, d.spent - d.earned);
      if(hole > 0){
        this.adjust += hole;
        this.reconcile();
        this.save();
        this.paint();
        this._mark();
        try{ this.render(); }catch(e){}
      }
      return hole;
    },

    /** Add to the pile and say so on screen. Everything that pays goes here. */
    credit(n, what){
      if(!(n > 0)) return;
      this.have += n;
      this.earned += n;
      this.save();
      this.render();
      this._mark();
      this.flash('+' + (what || n));
    },

    /* A thing arriving should be visible where it lands, not only two screens
       away in Your focus. The chip beats once and a small line says what it
       was; both are gone in a couple of seconds. */
    flash(text){
      const g = $('emb-gain');
      if(g){
        g.textContent = text;
        g.classList.remove('hide');
        void g.offsetWidth;                       // restart the animation
        clearTimeout(this._gt);
        this._gt = setTimeout(()=>g.classList.add('hide'), 2400);
      }
      const chip = $('emb-chip');
      if(chip){
        chip.classList.add('lit');
        clearTimeout(this._ct);
        this._ct = setTimeout(()=>chip.classList.remove('lit'), 700);
      }
    },

    buy(id){
      const l = embLight(id);
      if(this.own.indexOf(l.id) >= 0){ this.use(l.id); return; }
      if(this.have < l.cost){ toast('Not enough embers yet'); return; }
      /* **The thing, not a sentence about the thing.** This asked "Light the
         seaglass?" -- an article bolted onto a proper noun, which reads as a
         typo in English and does not survive translation at all, since half
         these languages have no article to bolt on. And it was the only
         description you got: a name, a price, and no sight of what you were
         spending on, in a shop whose entire stock is how something looks.

         So the name is the question and the look is the answer. */
      /* **No line of prose under the name.** It read "136 embers, yours for
         good" directly above a button saying "Spend 136", which is the price
         twice and a reassurance nobody asked for -- nothing in this shop has
         ever been rented. The swatch says what it looks like, the title says
         what it is called, the button says what it costs. */
      askConfirm(T(l.name), '',
        T('Spend {n}', {n:l.cost}), ()=>{
          if(Embers.have < l.cost) return;
          Embers.have -= l.cost;
          Embers.own.push(l.id);
          Embers.light = l.id;
          Embers.save(); Embers.paint(); Embers.render();
          chime(false);
          toast(T('{name} is yours', {name:T(l.name)}));
        }, {show:embShow(l)});
    },

    /** A sound. Bought the same way, then handed to the ambience engine. */
    buySound(id, then){
      const s = embSound(id);
      if(!s) return;
      if(embHasSound(id)){ if(then) then(); return; }
      if(this.have < s.cost){
        toast(T('{n} embers for {name}', {n:s.cost, name:T(s.name)}));
        return;
      }
      /* The one thing the swatch cannot show: a track brings a palette and a
         weather with it, which is most of what you are buying and is not
         guessable from a name like Campfire. */
      askConfirm(T(s.name), T('Sound, colours and weather.'),
        T('Spend {n}', {n:s.cost}), ()=>{
          if(Embers.have < s.cost) return;
          Embers.have -= s.cost;
          Embers.own.push(EMB_SND + id);
          Embers.save(); Embers.render();
          chime(false);
          toast(T('{name} is yours', {name:T(s.name)}));
          if(then) then();
        }, {show:embShow(s)});
    },

    /** A quote pack. Bought once, then switched on and off for nothing —
        tapping an owned pack toggles it rather than asking again, because the
        only thing left to decide after buying is whether it is in the rotation
        this week. */
    buyPack(id){
      const p = qpack(id);
      if(!p) return;
      if(qpackOwned(id)){
        qpackSet(id, !qpackOn(id));
        this.render();
        try{ renderQuotesList(); }catch(e){}
        return;
      }
      if(this.have < p.cost){ toast(T('{n} embers for {name}', {n:p.cost, name:T(p.name)})); return; }
      askConfirm(T(p.name), '',
        T('Spend {n}', {n:p.cost}), ()=>{
          if(Embers.have < p.cost) return;
          Embers.have -= p.cost;
          Embers.own.push(EMB_QP + id);
          /* Owning one already puts it in the rotation, so this is only for the
             case where it was switched off before — after a reset, say, and
             then bought again. Nobody spends embers on something and then goes
             looking for the switch that makes it do anything. */
          qpackSet(id, true);
          Embers.save(); Embers.render();
          try{ renderQuotesList(); }catch(e){}
          chime(false);
          toast(T('{name} is yours', {name:T(p.name)}));
        });
    },

    use(id){
      if(this.own.indexOf(id) < 0) return;
      this.light = id;
      this.save();
      /* **Stamp the settings clock as well.** Which light is on rides to the
         account inside `sim`, and `sim` is settled by `S.at` — so a theme
         changed without touching `S` looks older than it is and the next sync
         quietly puts the old one back. `save()` is what writes that stamp. */
      try{ save(); }catch(e){}
      // a light and a track are alternatives, so this puts the track out
      try{ if(AMB.id !== 'off') ambSet('off'); }catch(e){}
      this.paint(); this.render();
    },

    /** Whichever of the two is on: the track if one is playing, else the light. */
    look(){
      try{
        if(typeof AMB === 'object' && AMB.id && AMB.id !== 'off'){
          const sd = embSound(AMB.id);
          if(sd) return sd;
        }
      }catch(e){}
      return embLight(this.light);
    },

    /** The chosen look, on the body, where the phase palettes can pick it up —
        and its weather on the pane behind everything. */
    paint(){
      /* A track playing owns the colours, so the light gets out of its way —
         otherwise the focus-screen rule here would beat the ambience one and
         you would hear rain while looking at a meadow. */
      let on = 'none';
      try{ on = (AMB.id && AMB.id !== 'off') ? 'none' : (this.light || 'seaglass'); }
      catch(e){ on = this.light || 'seaglass'; }
      /* On #app as well as body. #app carries data-phase and defines --accent
         for itself, so a palette set only on body is shadowed for everything
         inside it — which is everything you can see. */
      document.body.setAttribute('data-light', on);
      const app = $('app');
      if(app) app.setAttribute('data-light', on);
      vfxApply();
      this._mark();
    },
    _mark(){
      const box = $('emb-box');
      if(box){ box.dataset.have = String(this.have); box.dataset.earned = String(this.earned); }
      if(box) box.dataset.bank = String(this.bank);
      const n = $('emb-chip-n');
      if(n) n.textContent = String(this.have);
      // and the row in the menu that says what they are for
      const sn = $('emb-spend-n');
      if(sn) sn.textContent = String(this.have);
    },

    reset(){
      this.have = 0; this.earned = 0; this.bank = 0;
      /* The marker stays: without it the next load would grandfather anything
         bought between now and then at the old wardrobe prices. */
      this.own = ['seaglass']; this.grand = ['seaglass', EMB_BUD_MET]; this.light = 'seaglass';
      this.claimed = []; this.feats = {};
      this.save(); this.paint(); this.render();
      // a track you no longer own cannot keep playing
      try{ if(!embHasSound(AMB.id)) ambSet('off'); else ambVfx(); }catch(e){}
      /* and a hat you no longer own cannot stay on his head. The wardrobe is
         bought with the same embers as everything else, so it goes when they
         do — see `budStrip` in 46-buddy.js. */
      try{ budStrip(); Buddy.render(); Buddy.clearSlots(); Buddy.stage(); }catch(e){}
    },

    /* Which shelf is open. The shop was one long page of lights, sounds and
       faces, and the buddy would have made it three times longer — so it is
       tabbed, and the tab is remembered while the app is open so coming back
       from a purchase does not put you at the top of the wrong shelf. */
    tab:'looks',
    TABS:[['looks', 'Looks'], ['sounds', 'Sounds'], ['faces', 'Clock faces'],
          ['quotes', 'Quotes'], ['buddy', 'Buddy'], ['antics', 'Antics']],

    /** The block at the top of Your focus. */
    html(){
      const next = EMB_LIGHTS.filter(l=>this.own.indexOf(l.id) < 0)
        .concat(EMB_SOUNDS.filter(sd=>!embHasSound(sd.id)))
        .sort((a, b)=>a.cost - b.cost)[0];
      const hours = Math.floor(this.earned * EMB_PER / 3600);
      const tab = this.TABS.some(t=>t[0] === this.tab) ? this.tab : 'looks';
      const pane = (id, body)=>tab === id ? body : '';
      return '<div class="emb">'
        + '<div class="emb-count"><b>' + this.have + '</b>'
        + '<span>' + esc(Tn('ember unspent', 'embers unspent', this.have)) + '</span></div>'
        /* **Two lines: the rate, and the thing nobody can work out.** This was
           five, then it was one, and one was too few — the leftover-minutes
           rule is the whole reason a short session is worth sitting through,
           and there is nowhere else in the app it could be inferred from. What
           was cut and stays cut is the paragraph about where bonus embers come
           from, which the achievements screen already says. */
        + '<p class="emb-sub">' + embMark() + ' ' + esc(T('{n} earned in all', {n:this.earned}))
        + (hours ? ' · ' + esc(Tn('about {n} hour of focus', 'about {n} hours of focus', hours)) : '')
        + '</p>'
        + '<p class="emb-sub">One ember per ten minutes of focus. Minutes left '
        + 'over are kept and count towards the next one.</p>'
        + '<div class="shop-tabs">' + this.TABS.map(([id, name])=>
            '<button class="shop-tab' + (tab === id ? ' on' : '') + '" data-tab="' + id + '">'
            + esc(name) + '</button>').join('') + '</div>'
        /* "puts it out" belongs to the same retired metaphor as "burning". A
           sound replaces the look rather than extinguishing it, and that is
           also plainer about what actually happens. */
        + pane('looks', '<p class="emb-head">Looks <em>one at a time</em></p>'
        + '<div class="emb-lights">' + embByPrice(EMB_LIGHTS).map(l=>{
            const mine = this.own.indexOf(l.id) >= 0;
            let on = this.light === l.id;
            try{ if(AMB.id !== 'off') on = false; }catch(e){}
            const afford = this.have >= l.cost;
            return '<button class="emb-light' + (mine ? ' mine' : '') + (on ? ' on' : '')
              + (!mine && !afford ? ' far' : '') + '" data-light="' + esc(l.id) + '"'
              + ' style="--lit:' + l.accent + '">'
              + '<i class="emb-dot"></i>'
              + '<b>' + esc(l.name) + '</b>'
              /* "burning" made sense when the shelf was only lights. It stopped
                 the moment one of them was a beach and another was a person in
                 a mask — "Spider-Man, burning" reads as an accident. "in use"
                 says the same thing about every look on the shelf. */
              + '<em>' + (mine ? (on ? 'in use' : 'owned') : embPrice(l.cost)) + '</em>'
              + '<span>' + esc(l.note) + '</span></button>';
          }).join('') + '</div>')
        + pane('sounds', '<p class="emb-head">Sounds <em>with their own colours</em></p>'
        + '<div class="emb-lights">' + embByPrice(EMB_SOUNDS).map(sd=>{
            const mine = embHasSound(sd.id);
            let on = false;
            try{ on = mine && AMB.id === sd.id; }catch(e){}
            const afford = this.have >= sd.cost;
            return '<button class="emb-light' + (mine ? ' mine' : '') + (on ? ' on' : '')
              + (!mine && !afford ? ' far' : '') + '" data-sound="' + esc(sd.id) + '"'
              + ' style="--lit:' + sd.accent + '">'
              + '<i class="emb-dot"></i>'
              + '<b>' + esc(sd.name) + '</b>'
              + '<em>' + (mine ? (on ? 'playing' : (sd.cost ? 'owned' : 'free')) : embPrice(sd.cost)) + '</em>'
              + '<span>' + esc(sd.note) + '</span></button>';
          }).join('') + '</div>')
        /* The clock faces belong on the shelf too — they cost embers like
           everything else, and a thing you can buy that is not where the buying
           happens is a thing nobody finds. The catalogue lives in 43-faces.js;
           this only draws it, and the tiles carry `data-face-pick` so the same
           click handler serves the shelf and the menu. */
        + pane('faces', '<p class="emb-head">Clock faces <em>how the time itself is drawn</em></p>'
        + '<div class="emb-lights">' + embByPrice(FACES).map(f=>{
            const mine = faceHas(f.id);
            const on = mine && faceOk(S.face) === f.id;
            const afford = this.have >= f.cost;
            return '<button class="emb-light' + (mine ? ' mine' : '') + (on ? ' on' : '')
              + (!mine && !afford ? ' far' : '') + '" data-face-pick="' + esc(f.id) + '"'
              + ' style="--lit:var(--accent)">'
              + embIcon(f.ic)
              + '<b>' + esc(f.name) + '</b>'
              + '<em>' + (mine ? (on ? 'in use' : (f.cost ? 'owned' : 'free')) : embPrice(f.cost)) + '</em>'
              + '<span>' + esc(f.note) + '</span></button>';
          }).join('') + '</div>')
        /* Quote packs. Bought here; switched on and off, line by line, in the
           quote bank — see 16-quotes-ui.js. This pane is only the shop half,
           and it says where the other half is rather than growing a second
           copy of it. */
        + pane('quotes', '<p class="emb-head">' + esc(T('Quotes'))
        + ' <em>' + esc(T('as many as you like, at once')) + '</em></p>'
        + '<div class="emb-lights">' + embByPrice(QPACKS).map(p=>{
            const mine = qpackOwned(p.id);
            const on = qpackOn(p.id);
            const afford = this.have >= p.cost;
            return '<button class="emb-light' + (mine ? ' mine' : '') + (on ? ' on' : '')
              + (!mine && !afford ? ' far' : '') + '" data-qpack="' + esc(p.id) + '"'
              + ' style="--lit:var(--accent)">'
              + '<i class="emb-dot"></i>'
              + '<b>' + esc(T(p.name)) + '</b>'
              /* "owned" either way, because it is: the switch decides whether
                 it is in the rotation, never whether you still have it. Same
                 two words the lights and the faces use. */
              + '<em>' + (mine ? (on ? 'showing' : 'owned') : embPrice(p.cost)) + '</em>'
              + '<span>' + esc(T(p.note)) + ' · '
              + esc(Tn('{n} quote', '{n} quotes', p.quotes.length)) + '</span></button>';
          }).join('') + '</div>'
        + '<p class="emb-note">' + esc(T('Turn single lines off in the quote bank.')) + '</p>')
        /* The wardrobe and the antics. Both are drawn by 46-buddy.js, next to
           the parts and the prices they are about — see `budShopHtml`. */
        + pane('buddy', (()=>{ try{ return budShopHtml(); }catch(e){ return ''; } })())
        + pane('antics', (()=>{ try{ return budAnticShopHtml(); }catch(e){ return ''; } })())
        + (next ? '<p class="emb-next">' + (this.have >= next.cost
            ? esc(T('You can afford {name}.', {name:LANG === 'en' ? next.name.toLowerCase() : T(next.name)}))
            : embPrice(next.cost - this.have) + ' ' + esc(T('more for {name}, about {h} hours.',
                {name:LANG === 'en' ? next.name.toLowerCase() : T(next.name),
                 h:Math.ceil((next.cost - this.have) * EMB_PER / 3600 * 10) / 10}))) + '</p>'
           : '<p class="emb-next">Every light is yours. That was a lot of hours.</p>')
        + '</div>';
    },

    render(){
      const box = $('emb-box');
      if(!box) return;
      /* The balance in the DOM as well as on screen. Same reason the Pictionary
         canvas carries a point count: there is otherwise nothing to assert on
         and nothing to look at when it goes wrong. */
      box.dataset.have = String(this.have);
      box.dataset.earned = String(this.earned);
      box.dataset.own = this.own.join(' ');
      box.innerHTML = this.html();
      box.querySelectorAll('[data-light]').forEach(b=>{
        b.onclick = ()=>Embers.buy(b.dataset.light);
      });
      box.querySelectorAll('[data-qpack]').forEach(b=>{
        b.onclick = ()=>Embers.buyPack(b.dataset.qpack);
      });
      box.querySelectorAll('[data-tab]').forEach(b=>{
        b.onclick = ()=>{ Embers.tab = b.dataset.tab; Embers.render(); };
      });
      try{ budShopWire(box); }catch(e){}
      box.querySelectorAll('[data-sound]').forEach(b=>{
        b.onclick = ()=>{
          const id = b.dataset.sound;
          if(!embHasSound(id)){ Embers.buySound(id, ()=>ambSet(id)); return; }
          ambSet(AMB.id === id ? 'off' : id);
          Embers.render();
        };
      });
    },
  };

  /* Write down that something happened, and see whether it was worth anything.

     A function declaration rather than a method, because the games that call it
     live in lower-numbered files and function declarations hoist across the
     whole script where a `const` would not. Safe to call as often as you like:
     a mark that is already set costs one comparison, and the save only happens
     when the number actually moved. `most` caps a counter that only ever needs
     to reach a certain figure, so a long streak of sudokus doesn't grow the
     save file forever. */
  function featBump(id, most){
    try{
      if(!Embers.loaded) return 0;
      const cap = most || 0;
      const now = (Embers.feats[id] || 0) + 1;
      if(cap && (Embers.feats[id] || 0) >= cap) return Embers.feats[id];
      Embers.feats[id] = now;
      Embers.save();
      achCheck();
      return now;
    }catch(e){ return 0; }
  }
  /** Something that either happened or didn't. */
  function featMark(id){ try{ if(!Embers.feats[id]) featBump(id, 1); }catch(e){} }
