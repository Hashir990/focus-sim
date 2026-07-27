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
  async function loadQuotes(){ const r=await KV.get('focus_quotes'); if(r&&r.value){ try{ CUSTOM_QUOTES=JSON.parse(r.value)||[]; }catch(e){} } }
  function saveQuotes(){ KV.set('focus_quotes', JSON.stringify(CUSTOM_QUOTES)); }
  function allQuotes(){ return DEFAULT_QUOTES.concat(CUSTOM_QUOTES); }

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

