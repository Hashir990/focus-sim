  /* ---------------- QUOTE PACKS ----------------

     Twelve collections you can buy with embers, and turn on and off afterwards.

     **Why packs rather than one longer bank.** The twenty built-in quotes are
     deliberately neutral — patience, work, starting. They are the right thing
     to read at minute three of a focus block and they are nobody's taste in
     particular. Taste is exactly what people want from the line under the
     clock, and taste is the one thing that cannot be shipped as a default: half
     the people who want Marcus Aurelius would not want a film line, and the
     other half feel the reverse. So they are separate, and you choose.

     **Owned is not the same as on.** A pack you have bought and switched off
     still belongs to you; it simply is not in the rotation this month. And
     inside a pack, every single quote has its own switch, because one line you
     are tired of should not cost you the other nine. Those two states live in
     different places on purpose:

       own           Embers.own, as 'qp-<id>'   — bought, permanent, synced
       QP_PACK_OFF   here, pack ids             — sets switched off
       QP_OFF        here, quote ids            — single lines switched off

     Buying is spending and has to survive a reinstall, so it rides with
     everything else you own. What is switched on this week is a preference, and
     lives with the other preferences.

     **Both lists record the "no".** Owning a pack is what puts it in the
     rotation; the list here only remembers the ones you have taken back out.
     Stored the other way round — a list of the ones that are *on* — a pack
     would arrive silent on a second device, because ownership syncs and a
     per-device preference does not: you would buy Marvel on the laptop, open
     the phone, and find it bought and saying nothing. The same rule covers the
     twenty the app came with, which are "owned" by being here.

     **They all go in one bowl.** `allQuotes()` concatenates the built-ins, your
     own, anything on loan from a room, and every quote from every active pack,
     and `Quote._show()` picks from the whole lot at random. Two packs on means
     the two are shuffled together rather than alternating — which is what
     "randomly" has to mean, or a pack of ten would show every tenth quote no
     matter how many you owned.

     The quotes are English and stay English: they are somebody's words, not the
     app's, so the lists are marked `translate="no"` (see 00a-i18n.js). The pack
     names and the lines describing them are the app's own words and are
     translated like everything else. */

  const QP_KEY = 'focus_qpacks';
  const EMB_QP = 'qp-';                        // how a pack is filed in `own`

  const QPACKS = [
    {id:'stoic', name:'Stoics', note:'Marcus Aurelius, Seneca, Epictetus', cost:60, quotes:[
      {t:"You have power over your mind, not outside events.", a:"Marcus Aurelius"},
      {t:"We suffer more often in imagination than in reality.", a:"Seneca"},
      {t:"It is not that we have a short time to live, but that we waste much of it.", a:"Seneca"},
      {t:"No man is free who is not master of himself.", a:"Epictetus"},
      {t:"Waste no more time arguing what a good man should be. Be one.", a:"Marcus Aurelius"},
      {t:"Difficulties strengthen the mind, as labour does the body.", a:"Seneca"},
      {t:"Men are disturbed not by things, but by the view they take of them.", a:"Epictetus"},
      {t:"What stands in the way becomes the way.", a:"Marcus Aurelius"},
      {t:"Luck is what happens when preparation meets opportunity.", a:"Seneca"},
      {t:"First say to yourself what you would be; then do what you have to do.", a:"Epictetus"},
    ]},
    {id:'philo', name:'Philosophy', note:'Questions that outlived the people who asked them', cost:80, quotes:[
      {t:"The unexamined life is not worth living.", a:"Socrates"},
      {t:"I think, therefore I am.", a:"René Descartes"},
      {t:"He who has a why to live can bear almost any how.", a:"Friedrich Nietzsche"},
      {t:"Happiness depends upon ourselves.", a:"Aristotle"},
      {t:"No man ever steps in the same river twice.", a:"Heraclitus"},
      {t:"The only true wisdom is in knowing you know nothing.", a:"Socrates"},
      {t:"Life must be understood backwards, but it must be lived forwards.", a:"Søren Kierkegaard"},
      {t:"Man is condemned to be free.", a:"Jean-Paul Sartre"},
      {t:"The limits of my language mean the limits of my world.", a:"Ludwig Wittgenstein"},
      {t:"To be is to do.", a:"Immanuel Kant"},
    ]},
    {id:'science', name:'Scientists', note:'People who asked why for a living', cost:90, quotes:[
      {t:"Nothing in life is to be feared, it is only to be understood.", a:"Marie Curie"},
      {t:"The important thing is not to stop questioning.", a:"Albert Einstein"},
      {t:"If I have seen further it is by standing on the shoulders of giants.", a:"Isaac Newton"},
      {t:"Somewhere, something incredible is waiting to be known.", a:"Carl Sagan"},
      {t:"The first principle is that you must not fool yourself.", a:"Richard Feynman"},
      {t:"It is not the strongest that survives, but the one most adaptable to change.", a:"Charles Darwin"},
      {t:"Intelligence is the ability to adapt to change.", a:"Stephen Hawking"},
      {t:"The present is theirs; the future is mine.", a:"Nikola Tesla"},
      {t:"Science knows no country, because knowledge belongs to humanity.", a:"Louis Pasteur"},
      {t:"That brain of mine is something more than merely mortal, as time will show.", a:"Ada Lovelace"},
    ]},
    {id:'writers', name:'Writers', note:'Novelists, on getting the words down', cost:90, quotes:[
      {t:"Not all those who wander are lost.", a:"J. R. R. Tolkien"},
      {t:"There is no greater agony than bearing an untold story inside you.", a:"Maya Angelou"},
      {t:"A word after a word after a word is power.", a:"Margaret Atwood"},
      {t:"You never really understand a person until you consider things from his point of view.", a:"Harper Lee"},
      {t:"Beware; for I am fearless, and therefore powerful.", a:"Mary Shelley"},
      {t:"There is no friend as loyal as a book.", a:"Ernest Hemingway"},
      {t:"The pen is mightier than the sword.", a:"Edward Bulwer-Lytton"},
      {t:"It was the best of times, it was the worst of times.", a:"Charles Dickens"},
      {t:"We are all in the gutter, but some of us are looking at the stars.", a:"Oscar Wilde"},
      {t:"I am no bird; and no net ensnares me.", a:"Charlotte Brontë"},
    ]},
    {id:'poets', name:'Poets', note:'Lines that were made to be said aloud', cost:70, quotes:[
      {t:"The wound is the place where the light enters you.", a:"Rumi"},
      {t:"Hope is the thing with feathers.", a:"Emily Dickinson"},
      {t:"The best way out is always through.", a:"Robert Frost"},
      {t:"I am the master of my fate, I am the captain of my soul.", a:"W. E. Henley"},
      {t:"Do not go gentle into that good night.", a:"Dylan Thomas"},
      {t:"Two roads diverged in a wood, and I took the one less travelled by.", a:"Robert Frost"},
      {t:"I celebrate myself, and sing myself.", a:"Walt Whitman"},
      {t:"Beauty is truth, truth beauty.", a:"John Keats"},
      {t:"Raise yourself so high that God Himself asks you what you wish for.", a:"Allama Iqbal"},
      {t:"And still, like dust, I'll rise.", a:"Maya Angelou"},
    ]},
    {id:'sport', name:'Sport', note:'Years of training, judged in seconds', cost:80, quotes:[
      {t:"Float like a butterfly, sting like a bee.", a:"Muhammad Ali"},
      {t:"I have failed over and over again in my life, and that is why I succeed.", a:"Michael Jordan"},
      {t:"You miss 100% of the shots you don't take.", a:"Wayne Gretzky"},
      {t:"It ain't over till it's over.", a:"Yogi Berra"},
      {t:"The more difficult the victory, the greater the happiness in winning.", a:"Pelé"},
      {t:"Champions keep playing until they get it right.", a:"Billie Jean King"},
      {t:"Hard work beats talent when talent doesn't work hard.", a:"Tim Notke"},
      {t:"It's not whether you get knocked down; it's whether you get up.", a:"Vince Lombardi"},
      {t:"You have to believe in yourself when no one else does.", a:"Serena Williams"},
      {t:"Suffer now and live the rest of your life as a champion.", a:"Muhammad Ali"},
    ]},
    {id:'builders', name:'Builders', note:'Founders, engineers and makers of things', cost:110, quotes:[
      {t:"Stay hungry. Stay foolish.", a:"Steve Jobs"},
      {t:"Whether you think you can or you think you can't, you're right.", a:"Henry Ford"},
      {t:"Done is better than perfect.", a:"Sheryl Sandberg"},
      {t:"If you are not embarrassed by the first version, you launched too late.", a:"Reid Hoffman"},
      {t:"Ideas are easy. Implementation is hard.", a:"Guy Kawasaki"},
      {t:"Quality means doing it right when no one is looking.", a:"Henry Ford"},
      {t:"The best way to predict the future is to invent it.", a:"Alan Kay"},
      {t:"Simplicity is the ultimate sophistication.", a:"Leonardo da Vinci"},
      {t:"Make something people want.", a:"Paul Graham"},
      {t:"Real artists ship.", a:"Steve Jobs"},
    ]},
    {id:'code', name:'Programmers', note:'Rules from people who ship', cost:120, quotes:[
      {t:"Premature optimisation is the root of all evil.", a:"Donald Knuth"},
      {t:"Simplicity is prerequisite for reliability.", a:"Edsger W. Dijkstra"},
      {t:"The most damaging phrase in the language is: we have always done it this way.", a:"Grace Hopper"},
      {t:"Talk is cheap. Show me the code.", a:"Linus Torvalds"},
      {t:"Debugging is twice as hard as writing the code in the first place.", a:"Brian Kernighan"},
      {t:"Programs must be written for people to read.", a:"Harold Abelson"},
      {t:"There are only two hard things in computer science: cache invalidation and naming things.", a:"Phil Karlton"},
      {t:"Any fool can write code a computer understands. Good programmers write code humans understand.", a:"Martin Fowler"},
      {t:"First, solve the problem. Then, write the code.", a:"John Johnson"},
      {t:"Weeks of coding can save you hours of planning.", a:"Anonymous"},
    ]},
    {id:'explore', name:'Explorers', note:'Ice, ocean and orbit', cost:90, quotes:[
      {t:"That's one small step for man, one giant leap for mankind.", a:"Neil Armstrong"},
      {t:"Adventure is worthwhile in itself.", a:"Amelia Earhart"},
      {t:"It is not the mountain we conquer, but ourselves.", a:"Edmund Hillary"},
      {t:"Difficulties are just things to overcome.", a:"Ernest Shackleton"},
      {t:"I am just going outside and may be some time.", a:"Lawrence Oates"},
      {t:"We shall not cease from exploration.", a:"T. S. Eliot"},
      {t:"The Earth is the cradle of humanity, but one cannot live in a cradle forever.", a:"Konstantin Tsiolkovsky"},
      {t:"Exploration is really the essence of the human spirit.", a:"Frank Borman"},
      {t:"Courage is the price that life exacts for granting peace.", a:"Amelia Earhart"},
      {t:"The greater danger is not that we aim too high and miss, but that we aim too low and reach it.", a:"Michelangelo"},
    ]},
    {id:'cinema', name:'Cinema', note:'Lines the whole room knew by heart', cost:130, quotes:[
      {t:"Do, or do not. There is no try.", a:"Yoda, The Empire Strikes Back"},
      {t:"Get busy living, or get busy dying.", a:"The Shawshank Redemption"},
      {t:"Why so serious?", a:"The Dark Knight"},
      {t:"There's no place like home.", a:"The Wizard of Oz"},
      {t:"To infinity and beyond!", a:"Toy Story"},
      {t:"Just keep swimming.", a:"Finding Nemo"},
      {t:"Carpe diem. Seize the day.", a:"Dead Poets Society"},
      {t:"May the Force be with you.", a:"Star Wars"},
      {t:"Hope is a good thing, maybe the best of things.", a:"The Shawshank Redemption"},
      {t:"Life moves pretty fast.", a:"Ferris Bueller's Day Off"},
    ]},
    {id:'marvel', name:'Marvel', note:'What the heroes said', cost:150, quotes:[
      {t:"With great power comes great responsibility.", a:"Uncle Ben, Spider-Man"},
      {t:"I can do this all day.", a:"Steve Rogers"},
      {t:"Part of the journey is the end.", a:"Tony Stark"},
      {t:"Avengers, assemble.", a:"Steve Rogers"},
      {t:"Whatever it takes.", a:"Steve Rogers"},
      {t:"Higher, further, faster.", a:"Carol Danvers"},
      {t:"I am Iron Man.", a:"Tony Stark"},
      {t:"Wakanda forever.", a:"Black Panther"},
      {t:"Dread it. Run from it. Destiny arrives all the same.", a:"Thanos"},
      {t:"I am Groot.", a:"Groot"},
    ]},
    {id:'music', name:'Music', note:'Musicians on their craft', cost:100, quotes:[
      {t:"I don't know where I'm going from here, but I promise it won't be boring.", a:"David Bowie"},
      {t:"Without music, life would be a mistake.", a:"Friedrich Nietzsche"},
      {t:"To play a wrong note is insignificant; to play without passion is inexcusable.", a:"Ludwig van Beethoven"},
      {t:"An artist's duty is to reflect the times.", a:"Nina Simone"},
      {t:"Music is the silence between the notes.", a:"Claude Debussy"},
      {t:"Find out who you are and do it on purpose.", a:"Dolly Parton"},
      {t:"A genius is the one most like himself.", a:"Thelonious Monk"},
      {t:"The times they are a-changin'.", a:"Bob Dylan"},
      {t:"Life is a lot like jazz, it's best when you improvise.", a:"George Gershwin"},
      {t:"One good thing about music: when it hits you, you feel no pain.", a:"Bob Marley"},
    ]},
  ];

  let QP_PACK_OFF = [];      // sets taken out of the rotation, by pack id
  let QP_OFF = [];           // single quotes switched off, by quote id

  /* **The built-ins, dressed as a pack.** They are listed and switched in the
     quote bank exactly like a bought one — same fold, same switch, same switch
     on every line — because from the reader's side they are the same thing: a
     set of quotes that is either in the rotation or is not.

     Only one thing keeps them apart underneath: they cost nothing and are
     always owned, so there is no buying to record. Everything after that is
     the same rule — owned and not switched off means in the rotation.

     A function rather than a constant because `DEFAULT_QUOTES` is declared in
     15-quotes-data.js, which loads after this file — reading it at load time
     would throw, and the whole app would come up blank. */
  const QP_BASE = 'base';
  function qpackBase(){
    return {id:QP_BASE, name:'Built in', note:'The twenty the app came with',
            cost:0, quotes:(typeof DEFAULT_QUOTES !== 'undefined' ? DEFAULT_QUOTES : [])};
  }

  function qpack(id){
    if(id === QP_BASE) return qpackBase();
    return QPACKS.find(p=>p.id === id) || null;
  }

  /** Bought. Lives in `own` with everything else that was paid for — except the
      built-ins, which came with the app and are yours by being here. */
  function qpackOwned(id){
    if(id === QP_BASE) return true;
    try{ return Embers.own.indexOf(EMB_QP + id) >= 0; }catch(e){ return false; }
  }
  /** Owned, and not taken back out. Two questions, because they are two: a
      pack you switch off is still yours. */
  function qpackOn(id){ return qpackOwned(id) && QP_PACK_OFF.indexOf(id) < 0; }

  /** A quote's id, the same way a custom quote gets one — from its own words,
      so a pack quote switched off stays off across a rebuild, a reinstall and
      any reordering of the list it lives in. `quoteId` is declared in
      15-quotes-data.js, which loads after this file; function declarations
      hoist across the bundle, so calling it at run time is fine. */
  function qpQuoteId(q){ return quoteId(q); }

  function qpackQuoteOn(q){ return QP_OFF.indexOf(qpQuoteId(q)) < 0; }

  /** Every quote the focus screen should be drawing from right now. */
  function packQuotes(){
    const out = [];
    for(const p of QPACKS){
      if(!qpackOn(p.id)) continue;
      for(const q of p.quotes){
        if(!qpackQuoteOn(q)) continue;
        out.push({id:qpQuoteId(q), t:q.t, a:q.a, pack:p.id});
      }
    }
    return out;
  }

  /** How many of a pack's quotes are switched on, for the line under its name. */
  function qpackLive(p){ return p.quotes.filter(qpackQuoteOn).length; }

  /** The quote an id belongs to. The switches in the quote bank are drawn from
      ids, and the id is the only thing that survives being written down. The
      built-ins are searched too, since their lines have switches as well. */
  function qpackFindQuote(id){
    for(const p of QPACKS.concat([qpackBase()])){
      for(const q of p.quotes) if(qpQuoteId(q) === id) return q;
    }
    return null;
  }

  /** The built-ins the focus screen should still be drawing from. Switched off
      as a set, or one line at a time, the same as any pack. */
  function baseQuotes(){
    if(!qpackOn(QP_BASE)) return [];
    return qpackBase().quotes.filter(qpackQuoteOn);
  }

  function savePacks(){
    try{ KV.set(QP_KEY, JSON.stringify({packsOff:QP_PACK_OFF, off:QP_OFF})); }catch(e){}
  }
  async function loadPacks(){
    try{
      const r = await KV.get(QP_KEY);
      if(r && r.value){
        const d = JSON.parse(r.value);
        /* Absent means nothing has been switched off, which is the right answer
           for a save written before any of this existed. */
        if(Array.isArray(d.packsOff)) QP_PACK_OFF = d.packsOff.filter(id=>!!qpack(id));
        if(Array.isArray(d.off)) QP_OFF = d.off.filter(x=>typeof x === 'string');
      }
    }catch(e){}
  }

  /** Turn a set on or off. Buying needs no call here: a pack you own is in the
      rotation until you say otherwise, which is also what nobody who has just
      spent embers on one should have to go and arrange. */
  function qpackSet(id, on){
    if(!qpack(id)) return;
    const at = QP_PACK_OFF.indexOf(id);
    if(on && at >= 0) QP_PACK_OFF.splice(at, 1);
    if(!on && at < 0) QP_PACK_OFF.push(id);
    savePacks();
  }

  /** Turn one line on or off, wherever it lives. */
  function qpackQuoteSet(q, on){
    const id = qpQuoteId(q);
    const at = QP_OFF.indexOf(id);
    if(on && at >= 0) QP_OFF.splice(at, 1);
    if(!on && at < 0) QP_OFF.push(id);
    savePacks();
  }
