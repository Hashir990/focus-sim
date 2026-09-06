  /* ---------------- HOW THE DAY WENT ----------------

     One emoji a day, asked once and changeable after.

     **Why an emoji rather than a scale.** A number out of five is a judgement
     and invites you to argue with it; a face is a shrug you can give in half a
     second on the way past. The point is not measurement, it is that in three
     months the calendar shows a shape — a run of grey squares before a holiday,
     a good week you had forgotten about — and that only works if answering is
     cheap enough to actually do every day.

     **Asked once, and never again that day.** The prompt appears on the first
     open of a new day and is dismissible; dismissing it is an answer too (it is
     not asked again), because an app that keeps asking is an app you learn to
     tap past without reading. Changing your mind is a tap on the day in the
     calendar.

     Stored as `{'2026-09-05': '🙂'}` under one key, and it travels with the
     account like everything else. Nothing is derived from it and nothing reads
     it but the calendar: it is a diary, not an input. */

  const MOOD_KEY = 'focus_mood';
  /* Six, in an order that runs one way. Fewer than this and a day has nowhere
     to sit; more and choosing becomes a decision rather than a shrug. The
     labels are for screen readers and the tooltip, and they are deliberately
     about the *day* rather than about you — "a hard day" is easier to admit to
     than "sad". */
  const MOODS = [
    {e:'😁', n:'a great day'},
    {e:'🙂', n:'a good day'},
    {e:'😐', n:'an ordinary day'},
    {e:'😩', n:'a hard day'},
    {e:'😢', n:'a bad day'},
    {e:'😴', n:'a tired day'},
  ];
  let MOOD = Object.create(null);
  /* Days the prompt has been shown for and answered or waved away. Kept beside
     the moods so a dismissal survives a restart — otherwise closing the app
     asks again on the next open, which is the behaviour this is meant to avoid. */
  let MOOD_ASKED = Object.create(null);

  function moodClean(v){
    const out = Object.create(null);
    if(!v || typeof v !== 'object') return out;
    const ok = Object.create(null);
    for(const m of MOODS) ok[m.e] = 1;
    for(const k in v){
      if(!Object.prototype.hasOwnProperty.call(v, k)) continue;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(k)) continue;
      const e = v[k];
      if(typeof e === 'string' && ok[e]) out[k] = e;
      else if(e === 0 || e === '') out[k] = '';        // asked, and waved away
    }
    return out;
  }
  async function moodLoad(){
    try{
      const r = await KV.get(MOOD_KEY);
      if(r && r.value) MOOD = moodClean(JSON.parse(r.value));
    }catch(e){}
  }
  function moodSave(){
    try{ KV.set(MOOD_KEY, JSON.stringify(MOOD)); }catch(e){}
    try{ Account.sync(true); }catch(e){}
  }
  function moodSnapshot(){ return MOOD; }
  /** Union, and a day the two devices disagree about keeps the one that says
      something — an emoji beats a shrug, because a shrug is mostly the absence
      of an answer and losing a real one to it would be the wrong way round. */
  function moodAdopt(v){
    const inc = moodClean(v);
    for(const k in inc){
      if(!(k in MOOD) || (!MOOD[k] && inc[k])) MOOD[k] = inc[k];
    }
    moodSave();
    moodPaint();
  }
  function moodWipe(){ MOOD = Object.create(null); try{ KV.del(MOOD_KEY); }catch(e){} }

  /** The emoji for a day, or '' for none. */
  function moodOf(day){ return MOOD[day] || ''; }
  /** Has this day been answered at all, one way or the other? */
  function moodAnswered(day){ return day in MOOD; }
  function moodSet(day, emoji){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;
    if(emoji && !MOODS.some(m=>m.e === emoji)) return;
    /* Choosing the one already there clears it. There is no other way back to
       "nothing" once you have picked, and being stuck with yesterday's face is
       worse than an empty square. */
    MOOD[day] = (MOOD[day] === emoji) ? '' : emoji;
    moodSave();
    moodPaint();
  }
  function moodPaint(){
    try{ if(Cal && Cal.open) Cal.render(); }catch(e){}
  }
  function moodName(emoji){
    const m = MOODS.find(x=>x.e === emoji);
    return m ? m.n : '';
  }

  /** The row of faces, used by the prompt and by the calendar's day panel. */
  function moodRow(day, cls){
    const now = moodOf(day);
    return '<div class="mood-row' + (cls ? ' ' + cls : '') + '">'
      + MOODS.map(m=>'<button class="mood-pick' + (now === m.e ? ' on' : '')
          + '" data-mood="' + m.e + '" data-day="' + esc(day) + '"'
          + ' title="' + esc(m.n) + '" aria-label="' + esc(m.n) + '">'
          + m.e + '</button>').join('')
      + '</div>';
  }
  /** Wire a rendered `moodRow`. Delegated so it survives a re-render. */
  function moodWire(box, after){
    if(!box) return;
    box.querySelectorAll('[data-mood]').forEach(b=>{
      b.onclick = ()=>{
        moodSet(b.dataset.day, b.dataset.mood);
        try{ blip(); }catch(e){}
        if(after) after();
      };
    });
  }

  /* ---- the once-a-day ask ----
     On the first open of a day, and not again. It sits over the timer rather
     than in front of it: this is worth a moment and is not worth blocking on,
     so it can be waved away and the day is then simply unanswered. */
  function moodAsk(){
    const el = $('mood-ask');
    if(!el) return;
    const day = dayKey(Date.now());
    if(moodAnswered(day) || MOOD_ASKED[day]){ el.classList.add('hide'); return; }
    $('mood-ask-row').innerHTML = moodRow(day, 'big');
    moodWire($('mood-ask-row'), ()=>moodDone(day));
    el.classList.remove('hide');
  }
  function moodDone(day){
    MOOD_ASKED[day] = 1;
    const el = $('mood-ask');
    if(el) el.classList.add('hide');
  }
  function moodSkip(){
    const day = dayKey(Date.now());
    MOOD_ASKED[day] = 1;
    /* A wave-away is recorded as an answer of its own, so it is not asked
       again today. It is not a mood and the calendar shows nothing for it. */
    if(!(day in MOOD)){ MOOD[day] = ''; moodSave(); }
    moodDone(day);
  }

  if($('mood-skip')) $('mood-skip').onclick = ()=>moodSkip();
