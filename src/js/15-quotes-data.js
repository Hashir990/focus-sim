  /* --- quote bank --- */
  const DEFAULT_QUOTES = [
    {t:"Patience is bitter, but its fruit is sweet.", a:"Aristotle"},
    {t:"Adopt the pace of nature: her secret is patience.", a:"Ralph Waldo Emerson"},
    {t:"He that can have patience can have what he will.", a:"Benjamin Franklin"},
    {t:"Our patience will achieve more than our force.", a:"Edmund Burke"},
    {t:"Virtue is its own reward.", a:"Cicero"},
    {t:"Knowing yourself is the beginning of all wisdom.", a:"Aristotle"},
    {t:"Well done is better than well said.", a:"Benjamin Franklin"},
    {t:"We are what we repeatedly do.", a:"Will Durant"},
    {t:"Genius is one percent inspiration, ninety-nine percent perspiration.", a:"Thomas Edison"},
    {t:"There is no substitute for hard work.", a:"Thomas Edison"},
    {t:"It always seems impossible until it is done.", a:"Nelson Mandela"},
    {t:"Energy and persistence conquer all things.", a:"Benjamin Franklin"},
    {t:"Little strokes fell great oaks.", a:"Benjamin Franklin"},
    {t:"Perseverance is many short races, one after another.", a:"Walter Elliot"},
    {t:"Success is not final; failure is not fatal.", a:"Winston Churchill"},
    {t:"The secret of getting ahead is getting started.", a:"Mark Twain"},
    {t:"A journey of a thousand miles begins with a single step.", a:"Lao Tzu"},
    {t:"Fall seven times, stand up eight.", a:"Japanese proverb"},
    {t:"Quality is not an act, it is a habit.", a:"Aristotle"},
    {t:"Well begun is half done.", a:"Aristotle"}
  ];
  let CUSTOM_QUOTES = [];

  /* Quotes other people in the room have shared, this session only. Not saved:
     they're on loan, not yours, and a backup full of somebody else's quote bank
     would be a surprise. Cleared when the room goes. */
  let SHARED_QUOTES = [];
  let QUOTES_SHARE = false;              // am I putting mine in? saved with settings

  /** A stable id for a custom quote, taken from its own words.

      Quotes had no ids: the bank was an array of `{t,a}` and deleting one was a
      splice by position. That works on one device and cannot be merged across
      two - a splice on a phone looks exactly like a laptop that never had the
      quote, so it comes straight back on the next sync. Hashing the text gives
      three things at once: a deletion can be written down (see `tombstone`),
      the same quote typed on two devices is one quote rather than two, and no
      migration is needed, because an old bank hashes to the same ids it would
      have been given. FNV-1a, 32 bits, `Math.imul` for the wrap. */
  function quoteId(q){
    const s = ((q && q.t) || '') + '\u0000' + ((q && q.a) || '');
    let h = 2166136261;
    for(let i=0;i<s.length;i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 'q' + (h >>> 0).toString(36);
  }

  /** One quote in the shape the rest of the app expects, whatever shape it
      arrived in: storage written before ids, or an account. */
  function quoteNorm(q){
    if(!q || typeof q.t !== 'string' || !q.t.trim()) return null;
    const out = {id: (typeof q.id === 'string' && q.id) || quoteId(q),
                 t: q.t, a: typeof q.a === 'string' ? q.a : ''};
    if(q.at) out.at = q.at;
    return out;
  }

  function quotesClean(list){
    const dead = Object.create(null);
    for(const id of (GONE || [])) dead[id] = 1;
    const seen = Object.create(null), out = [];
    for(const q of (Array.isArray(list) ? list : [])){
      const n = quoteNorm(q);
      if(!n || dead[n.id] || seen[n.id]) continue;
      seen[n.id] = 1; out.push(n);
    }
    return out;
  }

  async function loadQuotes(){
    const r=await KV.get('focus_quotes');
    if(r&&r.value){ try{ CUSTOM_QUOTES=quotesClean(JSON.parse(r.value)); }catch(e){} }
    const p=await KV.get('focus_quotes_share');
    QUOTES_SHARE = !!(p && p.value === '1');
  }

  /** Become the account's quote bank. Deletions are applied here rather than
      trusted from the wire: `GONE` has already been merged by the time this
      runs, so a quote deleted on any device stays deleted on all of them. */
  function quotesAdopt(list){
    if(!Array.isArray(list)) return;
    CUSTOM_QUOTES = quotesClean(list);
    saveQuotes();
    try{ renderQuotesList(); }catch(e){}
  }
  function saveQuotes(){ KV.set('focus_quotes', JSON.stringify(CUSTOM_QUOTES)); }
  function saveQuoteShare(){ KV.set('focus_quotes_share', QUOTES_SHARE ? '1' : '0'); }

  /** Everything the focus screen can draw from: the built-ins, your own, any
      on loan from a room, and every quote from every pack switched on (see
      14a-quote-packs.js). One flat list on purpose — picking at random from
      the whole lot is what mixes two packs together, where drawing from each
      source in turn would show a pack of ten every tenth quote however many
      you owned. */
  function allQuotes(){ return baseQuotes().concat(CUSTOM_QUOTES, SHARED_QUOTES, packQuotes()); }

  /** Everything I'd be willing to pass on, capped so one big bank can't flood a room. */
  function myShareableQuotes(){
    return QUOTES_SHARE ? CUSTOM_QUOTES.slice(0, 40).map(q=>({t:q.t, a:q.a})) : [];
  }

  /** Take someone else's, tagged with who sent them so the attribution is honest. */
  function quotesReceive(from, list){
    if(!Array.isArray(list)) return;
    SHARED_QUOTES = SHARED_QUOTES.filter(q=>q.from !== from);
    for(const q of list.slice(0, 40)){
      if(!q || typeof q.t !== 'string') continue;
      SHARED_QUOTES.push({
        t:String(q.t).slice(0, 240),
        a:(q.a ? String(q.a).slice(0, 60) + ' · via ' + from : 'via ' + from),
        from,
      });
    }
    try{ renderQuotesList(); }catch(e){}
  }
  function quotesClearShared(){
    SHARED_QUOTES = [];
    try{ renderQuotesList(); }catch(e){}
  }

  const Quote = {
    cycleT:null, swapT:null, last:-1,
    ensure(){ if(this.cycleT) return; this._show(); this.cycleT=setInterval(()=>this._show(), 22000); },
    stop(){ clearInterval(this.cycleT); this.cycleT=null; clearTimeout(this.swapT); const el=$('focus-quote'); if(el) el.classList.remove('show'); },
    _show(){
      const el=$('focus-quote'), list=allQuotes(); if(!el||!list.length) return;
      const gap = this.cycleT?800:250;
      el.classList.remove('show');
      clearTimeout(this.swapT);
      this.swapT=setTimeout(()=>{
        let i=Math.random()*list.length|0; if(list.length>1 && i===this.last) i=(i+1)%list.length; this.last=i;
        const q=list[i];
        el.innerHTML='<span class="qt">\u201c'+esc(q.t)+'\u201d</span>'+(q.a?'<span class="qa">'+esc(q.a)+'</span>':'');
        el.classList.add('show');
      }, gap);
    }
  };

