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
    {id:'latesun', name:'Late sun', note:'Yellow into orange, in waves', cost:5,
     accent:'#f7bd52', fx:'sun', fxc:'#ffe07a', fxc2:'#ff9a3c', fxm:1},
    {id:'dusk', name:'Dusk', note:'Smoke, white through to blue-black', cost:10,
     accent:'#c3cede', fx:'smoke', fxc:'#eef3fb', fxc2:'#55637a', fxm:1},
    /* Bubblegum is the quiet one of the pair: the same purple night, pink
       lights swelling and going out instead of anything going bang. */
    {id:'frost', name:'First frost', note:'Snow, white and grey', cost:15,
     accent:'#e4ecf2', fx:'snow', fxc:'#ffffff', fxc2:'#9aa8b4', fxm:1},
    {id:'hearth', name:'Hearth', note:'Spores, every shade of green', cost:20,
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
    {id:'magma', name:'Magma', note:'Lava, cracking orange through black', cost:25,
     accent:'#ff6a30', fx:'smoke', fxc:'#ff4a1e', fxc2:'#3a0602', fxm:1,
     /* `fxn` still asks for plenty; the kind's `cap` is what actually decides,
        and it is there because these carry a blur each. Thickness past that
        comes from opacity, which is free. */
     fxn:6, fxo:2.3, fxs:.4,
     /* One black in ten. The rest is orange taken across its whole range —
        yellow-hot through to a deep burnt red — because what carries the look is
        the *variation* within the orange, not the contrast against black. A
        single dark speck is enough to read as a piece of cooled crust; two were
        already starting to pull it back towards smoke. */
     fxpal:['#ff7a1e', '#ff3b0f', '#ffab3d', '#c21f07', '#ffd27a',
            '#ff5c14', '#ff9326', '#8f2a05', '#ffc266', '#1c0402']},
    {id:'bubblegum', name:'Bubblegum', note:'Pink lights on a purple night', cost:30,
     accent:'#ff8fd0', fx:'bokeh', fxc:'#ffa6dc', fxc2:'#ff62b4', fxm:1},
    {id:'peony', name:'Peony', note:'Blossom, pink on pink', cost:40,
     accent:'#f28cae', fx:'petals', fxc:'#ffd3e0', fxc2:'#e8608f', fxm:1},
    /* The one light look on the shelf, and the only one whose weather has to be
       *darker* than the ground to be seen at all — pale motes on cream are
       nothing. Deep sand and sea blue, drifting like glare off water. See the
       light-mode note in 30-embers.css: this palette carries --card, --line and
       --track as well, because those three assume a dark room everywhere else. */
    {id:'beach', name:'Beach', note:'Sand and sea, with a tide', cost:40,
     accent:'#2f9fd0', fx:'bokeh', fxc:'#2f9fd0', fxc2:'#c98f2b', fxm:1},
    {id:'fireworks', name:'Fireworks', note:'Rockets, bursts, embers coming down', cost:50,
     accent:'#ff7ab8', fx:'fw', fxc:'#ffe066', fxc2:'#ff7ab8', fxm:1,
     // weighted towards the yellows, with the pinks and blues between them
     fxpal:['#ffe066', '#ff7ab8', '#fff2a8', '#7ac8ff', '#ffd166', '#b78cff',
            '#ffe89a', '#8ef2b0']},
    /* The dearest one, and the only light that brings a shape with it: a web
       behind the dial, drawn as inline SVG in the timer markup and shown by
       this id alone. Kept faint on purpose — it is behind a countdown, and a
       mark you can read at a glance is a mark that competes with the numbers. */
    {id:'spiderman', name:'Spider-Man', note:'The suit, with webs in the corners', cost:40,
     accent:'#e01b24', fx:'motes', fxc:'#e01b24', fxc2:'#2438a8', fxm:1},
  ];
;


  /* The ambience tracks, as things you own. Two are free, because an app that
     ships with no sound at all until you have earned some is a worse app. Each
     brings its own weather as well as its own tint. */
  const EMB_SOUNDS = [
    {id:'cafe', name:'Café', note:'A room, out of focus', cost:5,
     accent:'#d9a774', fx:'bokeh', fxc:'#e8c398', fxm:1},
    {id:'rain', name:'Rain', note:'Lines down the glass', cost:15,
     accent:'#7fb2d9', fx:'rain', fxc:'#a8d6f5', fxm:1},
    {id:'office', name:'Office', note:'Somebody typing next door', cost:20,
     accent:'#9fb4cc', fx:'keys', fxc:'#bcd0e6', fxc2:'#7f97b3', fxm:1},
    {id:'forest', name:'Forest', note:'Leaves letting go', cost:35,
     accent:'#7fc98a', fx:'leaves', fxc:'#cbe8a8', fxc2:'#5f9c6b', fxm:1.2},
    {id:'campfire', name:'Campfire', note:'Sparks thrown off the top', cost:35,
     accent:'#f0a05a', fx:'sparks', fxc:'#ffc083', fxc2:'#ff8f4d', fxm:.6, fxw:2.6,
     fxflick:1},
  ];
;
  const EMB_SND = 'snd-';                       // how a sound is filed in `own`

  function embLight(id){ return EMB_LIGHTS.find(l=>l.id === id) || EMB_LIGHTS[0]; }
  function embSound(id){ return EMB_SOUNDS.find(s=>s.id === id) || null; }
  /** Free, or bought. Asked by the ambience picker before it plays anything. */
  function embHasSound(id){
    const s = embSound(id);
    if(!s) return id === 'off';
    return s.cost === 0 || Embers.own.indexOf(EMB_SND + id) >= 0;
  }

  const Embers = {
    have:0,             // unspent
    adjust:0,           // embers from before any of this was derivable; see reconcile()
    earned:0,           // ever, which is the number that is really a record
    bank:0,             // seconds of focus not yet worth a whole ember
    own:['seaglass'],
    claimed:[],         // achievements already paid out; see 40-achievements.js
    light:'seaglass',
    loaded:false,

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
      this.paint();
      this._mark();
      try{ this.render(); }catch(e){}
    },
    save(){
      KV.set(EMB_KEY, JSON.stringify({
        adjust:this.adjust,
        have:this.have, earned:this.earned, bank:this.bank, own:this.own,
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
    priceOf(id){
      if(typeof id !== 'string') return 0;
      if(id.indexOf(EMB_SND) === 0){ const s = embSound(id.slice(EMB_SND.length)); return s ? s.cost : 0; }
      if(id.indexOf('face-') === 0){ try{ return faceDef(id.slice(5)).cost || 0; }catch(e){ return 0; } }
      const l = EMB_LIGHTS.find(x=>x.id === id);
      return l ? l.cost : 0;
    },
    payout(id){
      try{ const a = ACH.find(x=>x.id === id); return a ? (a.pays || 0) : 0; }catch(e){ return 0; }
    },

    reconcile(){
      const self = this;
      const d = embersFrom(LOG, this.own, this.claimed, this.feats, this.adjust,
        (id)=>self.priceOf(id), (id)=>self.payout(id));
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
      askConfirm('Light the ' + l.name.toLowerCase() + '?',
        l.cost + ' embers, and it is yours for good. You can switch between any '
        + 'you have whenever you like.',
        'Spend ' + l.cost, ()=>{
          if(Embers.have < l.cost) return;
          Embers.have -= l.cost;
          Embers.own.push(l.id);
          Embers.light = l.id;
          Embers.save(); Embers.paint(); Embers.render();
          chime(false);
          toast(l.name + ' is yours');
        });
    },

    /** A sound. Bought the same way, then handed to the ambience engine. */
    buySound(id, then){
      const s = embSound(id);
      if(!s) return;
      if(embHasSound(id)){ if(then) then(); return; }
      if(this.have < s.cost){ toast(s.cost + ' embers for ' + s.name.toLowerCase()); return; }
      askConfirm('Unlock ' + s.name.toLowerCase() + '?',
        s.cost + ' embers, and it is yours for good — the sound, the colours it '
        + 'brings, and the weather with it.',
        'Spend ' + s.cost, ()=>{
          if(Embers.have < s.cost) return;
          Embers.have -= s.cost;
          Embers.own.push(EMB_SND + id);
          Embers.save(); Embers.render();
          chime(false);
          toast(s.name + ' is yours');
          if(then) then();
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
      this.own = ['seaglass']; this.light = 'seaglass';
      this.claimed = []; this.feats = {};
      this.save(); this.paint(); this.render();
      // a track you no longer own cannot keep playing
      try{ if(!embHasSound(AMB.id)) ambSet('off'); else ambVfx(); }catch(e){}
    },

    /** The block at the top of Your focus. */
    html(){
      const next = EMB_LIGHTS.filter(l=>this.own.indexOf(l.id) < 0)
        .concat(EMB_SOUNDS.filter(sd=>!embHasSound(sd.id)))
        .sort((a, b)=>a.cost - b.cost)[0];
      const hours = Math.floor(this.earned * EMB_PER / 3600);
      return '<div class="emb">'
        + '<div class="emb-count"><b>' + this.have + '</b>'
        + '<span>ember' + (this.have === 1 ? '' : 's') + ' unspent</span></div>'
        + '<p class="emb-sub">' + this.earned + ' earned in all'
        + (hours ? ' · about ' + hours + ' hour' + (hours === 1 ? '' : 's') + ' of focus' : '')
        + '. One for every ten minutes you finish — counted by the minute, so '
        + 'part of a block is never wasted and a block you abandon is never '
        + 'worth anything. A few more come from the achievements page.</p>'
        + '<p class="emb-spend">Embers are for spending. Everything below is a '
        + 'theme — pick one and it costs you once, then it is yours to switch '
        + 'back to whenever you like.</p>'
        /* "puts it out" belongs to the same retired metaphor as "burning". A
           sound replaces the look rather than extinguishing it, and that is
           also plainer about what actually happens. */
        + '<p class="emb-head">Looks <em>colour and weather — one at a time, and a sound replaces it</em></p>'
        + '<div class="emb-lights">' + EMB_LIGHTS.map(l=>{
            const mine = this.own.indexOf(l.id) >= 0;
            let on = this.light === l.id;
            try{ if(AMB.id !== 'off') on = false; }catch(e){}
            const afford = this.have >= l.cost;
            return '<button class="emb-light' + (mine ? ' mine' : '') + (on ? ' on' : '')
              + (!mine && !afford ? ' far' : '') + '" data-light="' + esc(l.id) + '"'
              + ' style="--lit:' + l.accent + '">'
              + '<i></i>'
              + '<b>' + esc(l.name) + '</b>'
              /* "burning" made sense when the shelf was only lights. It stopped
                 the moment one of them was a beach and another was a person in
                 a mask — "Spider-Man, burning" reads as an accident. "in use"
                 says the same thing about every look on the shelf. */
              + '<em>' + (mine ? (on ? 'in use' : 'owned') : l.cost + ' embers') + '</em>'
              + '<span>' + esc(l.note) + '</span></button>';
          }).join('') + '</div>'
        + '<p class="emb-head">Sounds <em>and the colours and weather they bring</em></p>'
        + '<div class="emb-lights">' + EMB_SOUNDS.map(sd=>{
            const mine = embHasSound(sd.id);
            let on = false;
            try{ on = mine && AMB.id === sd.id; }catch(e){}
            const afford = this.have >= sd.cost;
            return '<button class="emb-light' + (mine ? ' mine' : '') + (on ? ' on' : '')
              + (!mine && !afford ? ' far' : '') + '" data-sound="' + esc(sd.id) + '"'
              + ' style="--lit:' + sd.accent + '">'
              + '<i></i>'
              + '<b>' + esc(sd.name) + '</b>'
              + '<em>' + (mine ? (on ? 'playing' : (sd.cost ? 'owned' : 'free')) : sd.cost + ' embers') + '</em>'
              + '<span>' + esc(sd.note) + '</span></button>';
          }).join('') + '</div>'
        /* The clock faces belong on the shelf too — they cost embers like
           everything else, and a thing you can buy that is not where the buying
           happens is a thing nobody finds. The catalogue lives in 43-faces.js;
           this only draws it, and the tiles carry `data-face-pick` so the same
           click handler serves the shelf and the menu. */
        + '<p class="emb-head">Clock faces <em>how the time itself is drawn</em></p>'
        + '<div class="emb-lights">' + FACES.map(f=>{
            const mine = faceHas(f.id);
            const on = mine && faceOk(S.face) === f.id;
            const afford = this.have >= f.cost;
            return '<button class="emb-light' + (mine ? ' mine' : '') + (on ? ' on' : '')
              + (!mine && !afford ? ' far' : '') + '" data-face-pick="' + esc(f.id) + '"'
              + ' style="--lit:var(--accent)">'
              + '<i></i>'
              + '<b>' + esc(f.name) + '</b>'
              + '<em>' + (mine ? (on ? 'in use' : (f.cost ? 'owned' : 'free')) : f.cost + ' embers') + '</em>'
              + '<span>' + esc(f.note) + '</span></button>';
          }).join('') + '</div>'
        + (next ? '<p class="emb-next">' + (this.have >= next.cost
            ? 'You can afford ' + next.name.toLowerCase() + '.'
            : (next.cost - this.have) + ' more for ' + next.name.toLowerCase()
              + ' — about ' + Math.ceil((next.cost - this.have) * EMB_PER / 3600 * 10) / 10
              + ' hours.') + '</p>'
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
