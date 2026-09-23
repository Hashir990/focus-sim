  /* ---------------- ACHIEVEMENTS ----------------
     One-off marks, each worth embers, most of them a long way off.

     They were tiered bars first — six rungs a row, always something ticking
     over. That reads as a progress dashboard rather than as an achievement, and
     a bar that never fills isn't a thing you can be pleased about. These are
     boxes: either you have done it or you haven't, and doing it pays once.

     Everything is still *derived*. Nothing keeps a private tally that could
     drift or be poked; the hours come from the session log, the games from each
     game's own save, the shelf from what you own. The only thing written down
     is which marks have been paid for — `Embers.claimed` — because paying
     twice for the same thing is the one mistake the numbers can't catch.

     They are checked whenever a block finishes and whenever the page is opened,
     which between them covers every way a condition can come true. */

  /* What counts as a block, for the marks that count blocks.

     Two tests, and a record has to pass both. It has to have **run its clock
     out** — `full`, set in logSession — because otherwise "two hundred blocks"
     is two hundred taps on Skip; letting it play out is the whole thing being
     counted. And it has to be at least five minutes long, which is the shortest
     focus the app will let you set, so that a block from before `full` existed
     is still judged on something.

     History is untouched by either test. A block you cut short is yours, it is
     in the calendar and in the hours and it earned its embers by the minute —
     it just isn't one of the two hundred. */
  const ACH_MIN = 300;
  function achReal(r){
    return (r.secs || 0) >= ACH_MIN
      // absent on records written before this existed: read as whole, so that
      // nobody's history is quietly demoted by an update
      && r.full !== false;
  }

  /** Longest run of consecutive days with a real block in them. */
  function achStreak(){
    const days = {};
    for(const r of LOG) if(achReal(r)) days[r.day || dayKey(r.ts)] = 1;
    const d = new Date();
    let cur = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    let n = 0;
    if(!days[dayKey(cur.getTime())]) cur.setDate(cur.getDate() - 1);
    while(days[dayKey(cur.getTime())]){ n++; cur.setDate(cur.getDate() - 1); }
    return n;
  }

  /** Everything the marks are read from, worked out once. */
  function achFacts(){
    const secs = LOG.reduce((n, r)=>n + (r.secs || 0), 0);
    const real = LOG.filter(achReal);
    const shared = LOG.filter(r=>r.with && r.with.length);
    const people = {};
    for(const r of shared) for(const w of r.with) people[w] = 1;

    let crossword = 0, cross9 = 0;
    try{
      for(const k in Cross.progress){
        if(!Cross.progress[k] || !Cross.progress[k].done) continue;
        crossword++;
        /* Progress is keyed by crossKey() — a hash, not a position — so there is
           nothing to look up in CROSS_GRIDS with it. The size is on the front of
           the name for exactly this: `9-abc123`. (A bare number is a save from
           before that change and is read the old way, though `Cross._migrate()`
           will have converted it the first time the game was opened.) */
        const n = /^\d+$/.test(k)
          ? ((CROSS_GRIDS[k] && crossRows(CROSS_GRIDS[k]).length) || 0)
          : parseInt(k, 10);
        if(n >= 9) cross9++;
      }
    }catch(e){}

    /* **A run on one size, not a run on the crossword.** The streak the game
       screen shows counts a day as kept if every grid published that day is
       filled in, which is the right number for "do you keep up". It is the
       wrong number for "are you good at the big one": a month of 5×5s reads the
       same as a month of 9×9s. These count each size's own editions, so a 9×9
       streak of nine is nine consecutive Mondays-Wednesdays-Fridays — three
       weeks — and cannot be had by doing the small one. */
    let cwRun5 = 0, cwRun7 = 0, cwRun9 = 0;
    try{
      cwRun5 = dailyStreak('crossword', ['5'], (day)=>crossReleases(5, day));
      cwRun7 = dailyStreak('crossword', ['7'], (day)=>crossReleases(7, day));
      cwRun9 = dailyStreak('crossword', ['9'], (day)=>crossReleases(9, day));
    }catch(e){}

    /* Read off the daily record rather than kept as a tally: `w` is whether the
       word was got and `g` is how many guesses it took, both written once when
       the board is finished and never rewritten. */
    let wordle = 0, wordleBest = 99, wordleRun = 0;
    try{
      const rec = DAILY[dailyId('wordle', '')] || {};
      for(const k in rec){
        const r = dailyRec(rec[k]);
        if(!r || r.s !== DAILY_DONE || !r.w) continue;
        wordle++;
        if((r.g | 0) > 0) wordleBest = Math.min(wordleBest, r.g | 0);
      }
      wordleRun = dailyStreakOf('wordle');
    }catch(e){}

    let tetris = 0, tetrisLines = 0;
    try{ tetris = Tetris.best | 0; tetrisLines = Tetris.lines | 0; }catch(e){}

    /* The two shelves that had nothing to earn on them. Antics have no free
       index 0, so owning all of them means all of them. */
    let antics = 0, faces = 0;
    try{ for(let i = 0; i < BUD_ANIMS.length; i++) if(budOwns('an', i)) antics++; }catch(e){}
    try{ faces = FACES.filter(f=>faceHas(f.id)).length; }catch(e){}

    let moods = 0;
    try{ for(const k in MOOD) if(MOOD[k]) moods++; }catch(e){}

    let chessWon = 0, chessDone = 0;
    try{
      for(const k in Chess.saved){
        const g = Chess.saved[k];
        if(!g || !g.over) continue;
        chessDone++;
        if(g.over.by && g.over.by === g.me) chessWon++;
      }
    }catch(e){}

    return {
      hours: secs / 3600,
      blocks: real.length,
      shared: shared.reduce((n, r)=>n + (r.secs || 0), 0) / 3600,
      people: Object.keys(people).length,
      streak: achStreak(),
      embers: Embers.earned,
      lights: EMB_LIGHTS.filter(l=>Embers.own.indexOf(l.id) >= 0).length,
      sounds: EMB_SOUNDS.filter(s=>embHasSound(s.id)).length,
      crossword, cross9, chessWon, chessDone,
      cwRun5, cwRun7, cwRun9,
      wordle, wordleBest, wordleRun, tetris, tetrisLines,
      antics, faces, moods,
      best2048: (typeof G2048 === 'object' && G2048.best) || 0,
      // the moments nothing else remembers — see Embers.feats
      feat: (n)=>(Embers.feats && Embers.feats[n]) || 0,
    };
  }

  /* The marks. `want` is what it takes; `pays` is what it is worth.

     Deliberately steep — a mark you trip over on your second afternoon is not
     worth having, so most of these are weeks away and a few are months.

     And deliberately small. Everything here together comes to a little under
     what the shelf costs, so the marks are a bonus on top of the hours rather
     than a way around them: the ten minutes of focus is still where embers come
     from, and no achievement pays more than a decent morning's work. */
  /* `in` is the group it belongs to. The list was one long run of twenty-one
     lines and read as a spreadsheet; sorted into what you did to earn them, it
     reads as four short lists you can actually take in. */
  /* Which game a mark belongs to, drawn as the same glyph the arcade card uses
     — the arcade group is fifteen lines long now and reads as one list until
     you notice that four of them are the crossword. The glyph is quicker to
     scan than the wording is, and it is the mark people already associate with
     the game because it is what they tapped to open it. */
  const ACH_ICONS = {
    sudoku:['▦','Sudoku'], wordle:['◐','Word guess'], g2048:['◈','2048'],
    crossword:['▤','Crossword'], hangman:['⌇','Hangman'], scrabble:['▩','Scrabble'],
    tetris:['▟','Tetris'],
    chess:['♞','Chess'], pictionary:['✎','Pictionary'], memory:['❖','Memory'],
  };

  const ACH_GROUPS = [
    ['focus',  'At the desk',   'Finished blocks, hours and days in a row'],
    ['shared', 'With somebody', 'Rooms shared with other people'],
    ['games',  'In the arcade', 'The games in the rest arcade'],
    ['shelf',  'On the shelf',  'Embers, lights and sounds'],
  ];

  const ACH_LIST = [
    {id:'first', in:'focus',   name:'The first one',        pays:1,
     want:'Finish a focus block',                    got:f=>f.blocks >= 1},
    {id:'ten', in:'focus',     name:'Ten blocks in',         pays:2,
     want:'Finish ten blocks',                       got:f=>f.blocks >= 10},
    {id:'week', in:'focus',    name:'Seven days running',    pays:6,
     want:'A block a day, seven days in a row',      got:f=>f.streak >= 7},
    {id:'month', in:'focus',   name:'Thirty days running',   pays:20,
     want:'A block a day for a month',               got:f=>f.streak >= 30},
    {id:'h10', in:'focus',     name:'Ten hours',             pays:4,
     want:'Ten hours of finished focus',             got:f=>f.hours >= 10},
    {id:'h50', in:'focus',     name:'Fifty hours',           pays:10,
     want:'Fifty hours of finished focus',           got:f=>f.hours >= 50},
    {id:'h150', in:'focus',    name:'A hundred and fifty',   pays:25,
     want:'A hundred and fifty hours',               got:f=>f.hours >= 150},
    {id:'b200', in:'focus',    name:'Two hundred blocks',    pays:12,
     want:'Two hundred finished blocks',             got:f=>f.blocks >= 200},
    {id:'share5', in:'shared',  name:'Five hours together',   pays:5,
     want:'Five hours in a shared room',             got:f=>f.shared >= 5},
    {id:'share25', in:'shared', name:'Twenty-five together',  pays:15,
     want:'Twenty-five hours in a shared room',      got:f=>f.shared >= 25},
    {id:'people4', in:'shared', name:'Good company',          pays:6,
     want:'Share a session with four different people', got:f=>f.people >= 4},
    {id:'cw1', in:'games', of:'crossword',     name:'First grid',            pays:3,
     want:'Fill in a crossword',                     got:f=>f.crossword >= 1},
    {id:'cw9', in:'games', of:'crossword',     name:'The big one',           pays:6,
     want:'Fill in a nine-by-nine',                  got:f=>f.cross9 >= 1},
    {id:'cw10', in:'games', of:'crossword',    name:'Ten grids',             pays:12,
     want:'Fill in ten crosswords',                  got:f=>f.crossword >= 10},
    {id:'cwall', in:'games', of:'crossword',   name:'The whole bank',        pays:35,
     want:'Fill in every crossword there is',        got:f=>f.crossword >= 31},
    /* One per size, each asking for its own number, which is also roughly its
       own difficulty: five 5×5s is a fortnight of Tuesdays, Thursdays and
       Saturdays; nine 9×9s is three weeks of not missing one. */
    {id:'cwr5', in:'games', of:'crossword',    name:'Five fives',            pays:6,
     want:'Fill in five 5×5s in a row',              got:f=>f.cwRun5 >= 5},
    {id:'cwr7', in:'games', of:'crossword',    name:'Seven sevens',          pays:9,
     want:'Fill in seven 7×7s in a row',             got:f=>f.cwRun7 >= 7},
    {id:'cwr9', in:'games', of:'crossword',    name:'Nine nines',            pays:16,
     want:'Fill in nine 9×9s in a row',              got:f=>f.cwRun9 >= 9},
    {id:'wdl1', in:'games', of:'wordle',       name:'Got it',                pays:2,
     want:'Guess the word of the day',               got:f=>f.wordle >= 1},
    {id:'wdl10', in:'games', of:'wordle',      name:'Ten words',             pays:6,
     want:'Guess ten words of the day',              got:f=>f.wordle >= 10},
    {id:'wdlrun', in:'games', of:'wordle',     name:'A word a day',          pays:10,
     want:'Guess the word seven days running',       got:f=>f.wordleRun >= 7},
    {id:'wdl2', in:'games', of:'wordle',       name:'In two',                pays:8,
     want:'Guess the word in two',                   got:f=>f.wordleBest <= 2},
    {id:'tet5k', in:'games', of:'tetris',      name:'Five thousand',         pays:5,
     want:'Score five thousand at Tetris',           got:f=>f.tetris >= 5000},
    {id:'tet20k', in:'games', of:'tetris',     name:'Twenty thousand',       pays:12,
     want:'Score twenty thousand at Tetris',         got:f=>f.tetris >= 20000},
    {id:'chess1', in:'games', of:'chess',  name:'Checkmate',             pays:3,
     want:'Win a game of chess',                     got:f=>f.chessWon >= 1},
    {id:'chess10', in:'games', of:'chess', name:'Ten wins',              pays:12,
     want:'Win ten games of chess',                  got:f=>f.chessWon >= 10},
    {id:'promo', in:'games', of:'chess',   name:'All the way across',    pays:2,
     want:'Promote a pawn',                          got:f=>f.feat('promo') >= 1},
    {id:'sdk1', in:'games', of:'sudoku',    name:'Filled in',             pays:2,
     want:'Finish a sudoku',                         got:f=>f.feat('sudoku') >= 1},
    {id:'sdk10', in:'games', of:'sudoku',   name:'Ten sudokus',           pays:5,
     want:'Finish ten sudokus',                      got:f=>f.feat('sudoku') >= 10},
    {id:'hm40', in:'games', of:'hangman',    name:'Forty at hangman',      pays:4,
     want:'Reach forty points in a game of hangman', got:f=>f.feat('hm40') >= 1},
    {id:'sbSweep', in:'games', of:'scrabble', name:'Sweep',                 pays:5,
     want:'Lay all seven of your tiles in one turn', got:f=>f.feat('sweep') >= 1},
    {id:'sbTens', in:'games', of:'scrabble',  name:'Both tens',             pays:7,
     want:'Two ten-point letters in one word',       got:f=>f.feat('tens') >= 1},
    {id:'picQuick', in:'games', of:'pictionary', name:'Read in seconds',      pays:3,
     want:'Have somebody get your hard word inside fifteen seconds',
     got:f=>f.feat('picquick') >= 1},
    {id:'g2048', in:'games', of:'g2048',   name:'Ten thousand',          pays:8,
     want:'Score ten thousand at 2048',              got:f=>f.best2048 >= 10000},
    {id:'tile2048', in:'games', of:'g2048', name:'Two thousand and forty-eight', pays:4,
     want:'Make the 2048 tile',                      got:f=>f.feat('t2048') >= 1},
    {id:'sounds', in:'shelf',  name:'Every sound',           pays:12,
     want:'Unlock all five ambience tracks',         got:f=>f.sounds >= EMB_SOUNDS.length},
    {id:'lights', in:'shelf',  name:'Every light',           pays:25,
     want:'Own every light on the shelf',            got:f=>f.lights >= EMB_LIGHTS.length},
    {id:'rich', in:'shelf',    name:'A thousand embers',     pays:18,
     want:'Earn a thousand embers in all',           got:f=>f.embers >= 1000},
    /* The wardrobe's two dearest shelves and the clock. Nothing on any of them
       is free, so each of these is a long way down the line — which is what an
       achievement about a shop should be. */
    {id:'antics', in:'shelf',  name:'Every antic',           pays:30,
     want:'Own every antic he can do',               got:f=>f.antics >= BUD_ANIMS.length},
    {id:'faces', in:'shelf',   name:'Every clock face',      pays:20,
     want:'Own every way of drawing the time',       got:f=>f.faces >= FACES.length},
    /* The one mark that is not about doing more. Answering the prompt costs
       nothing and is the only record the app keeps of how the work felt. */
    {id:'mood30', in:'focus',  name:'Thirty days noted',     pays:8,
     want:'Say how the day went, thirty times',      got:f=>f.moods >= 30},
  ];

  /** Pay for anything newly true. Safe to call as often as you like. */
  function achCheck(quiet){
    if(!Embers.loaded) return 0;
    const f = achFacts();
    let paid = 0, last = null;
    for(const a of ACH_LIST){
      if(Embers.claimed.indexOf(a.id) >= 0) continue;
      let ok = false;
      try{ ok = !!a.got(f); }catch(e){}
      if(!ok) continue;
      Embers.claimed.push(a.id);
      paid += a.pays;
      last = a;
    }
    if(!paid) return 0;
    Embers.save();
    /* One line for the lot rather than five in a row: finishing a block can
       tick two or three marks at once, and a stack of toasts is a worse way to
       be told than a single number. */
    Embers.credit(paid, paid + ' · ' + (last && paid === last.pays ? T(last.name) : T('achievements')));
    if(!quiet){ try{ chime(false); }catch(e){} }
    try{ Achievements.render(); }catch(e){}
    return paid;
  }

  const Achievements = {
    open(){ $('ach-overlay').classList.remove('hide'); achCheck(true); this.render(); },
    close(){ $('ach-overlay').classList.add('hide'); },

    render(){
      const box = $('ach-body');
      if(!box) return;
      const f = achFacts();
      const done = ACH_LIST.filter(a=>Embers.claimed.indexOf(a.id) >= 0);
      const owed = ACH_LIST.filter(a=>Embers.claimed.indexOf(a.id) < 0)
        .reduce((n, a)=>n + a.pays, 0);

      box.dataset.done = String(done.length);
      box.innerHTML =
        '<div class="ach-top"><b>' + done.length + '</b><span>' + esc(T('of {n}', {n:ACH_LIST.length})) + '</span></div>'
        + '<p class="ach-lede"><span>Each one pays once, in embers.</span>'
        + (owed ? ' ' + Tn('{n} embers still out there.', '{n} embers still out there.', owed,
            {n:'<b>' + owed + '</b>'}) : '')
        + '</p>'
        + ACH_GROUPS.map(g=>{
            const rows = ACH_LIST.filter(a=>a.in === g[0]).sort((a, b)=>a.pays - b.pays);
            if(!rows.length) return '';
            const n = rows.filter(a=>Embers.claimed.indexOf(a.id) >= 0).length;
            return '<div class="ach-group"><b>' + esc(g[1]) + '</b>'
              + '<em>' + esc(g[2]) + '</em>'
              + '<span>' + n + '/' + rows.length + '</span></div>'
              + rows.map(a=>{
                  const got = Embers.claimed.indexOf(a.id) >= 0;
                  const ic = a.of && ACH_ICONS[a.of];
                  return '<div class="ach' + (got ? ' got' : '') + '" data-ach="' + esc(a.id) + '"'
                    + (a.of ? ' data-of="' + esc(a.of) + '"' : '') + '>'
                    + '<span class="ach-box">' + (got ? '✓' : '') + '</span>'
                    + (ic ? '<span class="ach-icon" title="' + esc(ic[1]) + '"'
                          + ' aria-label="' + esc(ic[1]) + '">' + ic[0] + '</span>' : '')
                    + '<span class="ach-what"><b>' + esc(a.name) + '</b>'
                    + '<em>' + esc(a.want) + '</em></span>'
                    + '<span class="ach-pays">' + a.pays + '</span>'
                    + '</div>';
                }).join('');
          }).join('');
    },
  };

  if($('ach-close')) $('ach-close').onclick = ()=>Achievements.close();
  if($('d-ach')) $('d-ach').onclick = ()=>{ closeDrawer(); Achievements.open(); };
