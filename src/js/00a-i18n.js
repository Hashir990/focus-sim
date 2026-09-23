  /* ---------------- languages ----------------

     **Two layers, because the app says two kinds of thing.**

     Most of what is on screen is a whole sentence or a label sitting alone in
     an element — "Focus together", "Nothing wrong so far". Those are translated
     where they meet the page: `langStart()` walks the document once, and a
     MutationObserver catches everything drawn afterwards, swapping each text
     node whose whole text is a known English string. The game code never
     learns there is a language at all, which matters in a codebase where every
     screen builds its own markup.

     What is *built* out of pieces — "3 of 15 squares", "Sea glass is yours" —
     cannot be matched whole, because the pieces are only known at run time.
     Those go through `T()` (and `Tn()` for anything counted) at the place they
     are built, with the pieces as named slots, so a translation can put them
     wherever its grammar wants them. A sentence glued together in English word
     order and then translated a word at a time is exactly the robotic kind.

     **A change of language restarts the app.** Everything already drawn was
     drawn in the old language, a good deal of it by `T()` at render time, and
     chasing every screen to redraw it is a bug farm for a setting somebody
     changes once. Everything that matters is saved; a reload is the honest
     way to redraw it all.

     **English costs nothing.** No table is read and no observer is attached;
     `T()` returns its own argument with the slots filled. The tests run in
     English and see the same bytes they always have.

     The strings themselves are in 60-i18n-*.js, one entry per English string
     with all six translations side by side, so a missing one is visible where
     it is missing. The prose pages — privacy, terms, credits — are written as
     whole documents per language in 61-docs-*.js, not assembled from these. */

  const LANGS = [
    {k:'en', n:'English'},
    {k:'ja', n:'日本語'},
    {k:'zh', n:'简体中文'},
    {k:'ru', n:'Русский'},
    {k:'hi', n:'हिन्दी'},
    {k:'ur', n:'اردو', rtl:true},
    {k:'ar', n:'العربية', rtl:true},
  ];
  const LANG_KEY = 'focus_lang';

  /** What was chosen, or — before anything has been chosen — the device's own
      language if it is one of these. Read straight from localStorage because
      it has to be known before the first thing is drawn, and the settings
      record is loaded asynchronously. */
  function langPick(){
    try{
      const v = localStorage.getItem(LANG_KEY);
      if(v && LANGS.some(l=>l.k === v)) return v;
    }catch(e){}
    try{
      const want = (navigator.languages && navigator.languages.length)
        ? navigator.languages : [navigator.language || ''];
      for(const w of want){
        const k = String(w || '').toLowerCase().split('-')[0];
        if(LANGS.some(l=>l.k === k)) return k;
      }
    }catch(e){}
    return 'en';
  }
  const LANG = langPick();
  const LANG_RTL = LANGS.some(l=>l.k === LANG && l.rtl);

  /* English string → {ja, zh, ru, hi, ur, ar}. Filled by 60-i18n-*.js. */
  const I18N = Object.create(null);
  function i18nAdd(table){ Object.assign(I18N, table); }

  /** The locale handed to `Intl` and the `toLocale*String` family. English keeps
      the device's own (undefined), as it always has — an English speaker in
      Karachi and one in Ohio want different date orders. Arabic is pinned to
      Western digits: the timer, the scores and every board already use them,
      and a date in another set of numerals beside them reads as two apps. */
  function langLocale(){
    if(LANG === 'en') return undefined;
    if(LANG === 'ar') return 'ar-u-nu-latn';
    return LANG;
  }

  let LANG_PLURAL = null;
  function langPlural(n){
    try{
      if(!LANG_PLURAL) LANG_PLURAL = new Intl.PluralRules(langLocale() || 'en');
      return LANG_PLURAL.select(n);
    }catch(e){ return n === 1 ? 'one' : 'other'; }
  }

  function langFill(s, vars){
    if(!vars) return s;
    return String(s).replace(/\{(\w+)\}/g, (m, k)=>(vars[k] != null ? String(vars[k]) : m));
  }

  /** A string with slots. `T('Done in {t}', {t:'3:12'})`. The English is the
      key, so a string nobody has translated yet still says something. */
  function T(en, vars){
    if(LANG !== 'en'){
      const row = I18N[en];
      const v = row && row[LANG];
      if(typeof v === 'string') return langFill(v, vars);
    }
    return langFill(en, vars);
  }

  /** Something counted. English has two forms and passes both; a translation
      is filed under the plural English and gives whichever forms its own
      language has — Russian three, Arabic six, Japanese and Chinese one. `{n}`
      is always available as a slot. */
  function Tn(one, many, n, vars){
    const all = Object.assign({n}, vars || {});
    if(LANG !== 'en'){
      const row = I18N[many];
      const v = row && row[LANG];
      if(typeof v === 'string') return langFill(v, all);
      if(v && typeof v === 'object'){
        const f = v[langPlural(n)];
        return langFill(f != null ? f : v.other, all);
      }
    }
    return langFill(n === 1 ? one : many, all);
  }

  /** "Sam, Ali and Jo" in the reader's language — "Sam、Ali、Jo", "Sam, Ali и
      Jo", "Sam، Ali اور Jo". `Intl` knows the conjunctions and the commas. */
  function langAnd(list){
    try{ return new Intl.ListFormat(langLocale() || 'en', {style:'long', type:'conjunction'}).format(list); }
    catch(e){ return list.join(langSep()); }
  }
  /** The comma between items in a run of short things: Japanese and Chinese
      use the ideographic one, Urdu and Arabic their own. */
  function langSep(){
    return LANG === 'ja' || LANG === 'zh' ? '、' : (LANG === 'ur' || LANG === 'ar') ? '، ' : ', ';
  }
  /** A weekday's name, 0 = Sunday. 1 January 2023 was a Sunday. */
  function langDow(i, style){
    try{
      return new Date(Date.UTC(2023, 0, 1 + i)).toLocaleDateString(langLocale() || 'en',
        {weekday:style || 'short', timeZone:'UTC'});
    }catch(e){ return ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][i]; }
  }

  /** The one- or two-character day name a calendar heads its columns with.
      Urdu's "narrow" form in the locale data is a Latin letter — S, M, T —
      which no Urdu calendar prints; its short names are the ones used. */
  function langDayHead(i){
    return langDow(i, LANG === 'ur' ? 'short' : 'narrow');
  }

  /* ---- where strings meet the page ---- */

  const LANG_ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

  /** The translation of a whole text, keeping the whitespace around it — or
      null. Only whole strings: a translation of a fragment of a sentence is
      the thing this file exists to avoid. */
  function langWhole(s, ctx){
    if(!s || !/[A-Za-z]/.test(s)) return null;
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    /* Markup wraps long sentences across lines, and the indentation is part of
       the text node; the key is the sentence with its spaces made single. */
    const key = I18N[m[2]] ? m[2] : m[2].replace(/\s+/g, ' ');
    /* **One English word, two meanings.** Tetris's "Next" is the piece coming
       up and the crossword's is the next puzzle; a game's "History" is its
       archive, not your sessions. An element marked `data-t="tetris"` has its
       text looked up as `tetris::Next` first, and falls back to the plain key
       when there is no such entry. */
    const row = (ctx && I18N[ctx + '::' + key]) || I18N[key];
    const v = row && row[LANG];
    return typeof v === 'string' ? m[1] + v + m[3] : null;
  }
  function langCtx(el){
    const c = el && el.closest ? el.closest('[data-t]') : null;
    return c ? c.getAttribute('data-t') : '';
  }
  /** `T()` with a context, for a label set from code inside such an element. */
  function Tx(ctx, en, vars){
    if(LANG !== 'en'){
      const row = I18N[ctx + '::' + en];
      const v = row && row[LANG];
      if(typeof v === 'string') return langFill(v, vars);
    }
    return T(en, vars);
  }

  /* **Some text is not the app's to translate.** Somebody's task, a chat
     message, a quote they saved, a crossword clue, a username. It is marked
     `translate="no"` where it is drawn — the attribute browsers already honour
     for the same reason — and nothing under it is touched. */
  function langOff(node){
    const el = node.nodeType === 1 ? node : node.parentElement;
    if(!el) return true;
    if(el.closest('[translate="no"], script, style, textarea')) return true;
    return false;
  }

  function langNode(n){
    if(n.nodeType !== 3 || langOff(n)) return;
    const v = langWhole(n.data, langCtx(n.parentElement));
    if(v != null && v !== n.data) n.data = v;
  }
  function langAttr(el, a){
    if(!el.getAttribute || langOff(el)) return;
    const was = el.getAttribute(a);
    const v = langWhole(was, langCtx(el));
    if(v != null && v !== was) el.setAttribute(a, v);
  }
  function langAttrs(el){
    let ctx = null;
    for(const a of LANG_ATTRS){
      if(!el.hasAttribute(a)) continue;
      if(ctx === null) ctx = langCtx(el);
      const was = el.getAttribute(a), v = langWhole(was, ctx);
      if(v != null && v !== was) el.setAttribute(a, v);
    }
  }
  /* A subtree marked off is refused whole, so a long chat log or a full task
     list costs one check rather than one per word in it. */
  const LANG_FILTER = {acceptNode(n){
    if(n.nodeType === 1 && (n.getAttribute('translate') === 'no'
        || n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.tagName === 'TEXTAREA')){
      return NodeFilter.FILTER_REJECT;
    }
    return NodeFilter.FILTER_ACCEPT;
  }};
  function langWalk(root){
    if(!root) return;
    if(root.nodeType === 3){ langNode(root); return; }
    if(root.nodeType !== 1 || langOff(root)) return;
    langAttrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, LANG_FILTER);
    let n;
    while((n = w.nextNode())){
      if(n.nodeType === 3){
        if(!/[A-Za-z]/.test(n.data)) continue;
        const v = langWhole(n.data, langCtx(n.parentElement));
        if(v != null && v !== n.data) n.data = v;
      }else langAttrs(n);
    }
  }

  let LANG_OBS = null;
  /** Put the page in the chosen language, and keep it there. Called once, from
      90-init.js, after every string table has been read. */
  function langStart(){
    const root = document.documentElement;
    root.setAttribute('lang', LANG);
    root.setAttribute('dir', LANG_RTL ? 'rtl' : 'ltr');
    if(LANG === 'en' || typeof MutationObserver === 'undefined') return;
    langWalk(document.body);
    /* The calendars' Monday-first column heads are single letters in the
       markup, and "T" is two different days; they come from the language's
       own names for the days instead. */
    document.querySelectorAll('.cal-week').forEach(w=>{
      Array.prototype.forEach.call(w.children, (s, i)=>{ s.textContent = langDayHead((i + 1) % 7); });
    });
    LANG_OBS = new MutationObserver((recs)=>{
      for(const r of recs){
        if(r.type === 'childList') r.addedNodes.forEach(langWalk);
        else if(r.type === 'characterData') langNode(r.target);
        else if(r.type === 'attributes') langAttr(r.target, r.attributeName);
      }
    });
    LANG_OBS.observe(document.body, {childList:true, subtree:true, characterData:true,
      attributes:true, attributeFilter:LANG_ATTRS});
  }

  /** Choose a language. Saved, then the app starts again in it. */
  function langSet(k){
    if(!LANGS.some(l=>l.k === k) || k === LANG) return;
    try{ localStorage.setItem(LANG_KEY, k); }catch(e){}
    try{ if(typeof save === 'function') save(); }catch(e){}
    try{ location.reload(); }catch(e){}
  }
