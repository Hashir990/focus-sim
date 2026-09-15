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

  /* ---- which face is mid-animation ----
     A tap re-renders the row it was in — the calendar rebuilds its whole day
     panel — so a class toggled onto the button that was tapped is thrown away a
     millisecond later. The pop has to be part of what the row *renders*.

     That is also what makes it work at all: a fresh element starts its
     animations now, which is the same fact the buddy's slot depends on (see
     HANDOFF §6). Re-rendering is not something to work around here, it is the
     mechanism.

     `EMO_HOLD` is a const in 17c-emoji.js, which loads *after* this file. Read
     from inside a function that is what you want; read at load time it would
     throw and take the whole app with it (§2). */
  let MOOD_POP = '', MOOD_POP_DAY = '', MOOD_POP_T = 0, MOOD_POP_AT = 0;
  function moodPop(day, emoji){
    clearTimeout(MOOD_POP_T);
    MOOD_POP_DAY = day; MOOD_POP = emoji; MOOD_POP_AT = Date.now();
    MOOD_POP_T = setTimeout(()=>{
      MOOD_POP = ''; MOOD_POP_DAY = '';
      moodPaint();
    }, EMO_HOLD);
  }
  /** Is this the face that is popping right now? */
  function moodPopping(day, emoji){ return !!emoji && MOOD_POP === emoji && MOOD_POP_DAY === day; }
  /* **How far into its motion the popping face is.** Every redraw of the row
     makes a fresh element, and a fresh element starts its animation from the
     beginning — which is what made the faces play twice. Choosing a mood saves
     it, saving syncs the account, and the sync coming back redraws the
     calendar a few hundred milliseconds later: second element, second motion,
     the first one cut off part-way. So each redraw is told the age and picks
     the motion up where it was (17c-emoji.js turns it into a negative delay).
     Any other redraw that lands mid-motion is covered by the same line. */
  function moodPopAge(){ return MOOD_POP ? Math.max(0, Date.now() - MOOD_POP_AT) : 0; }

  /** The row of faces, used by the prompt and by the calendar's day panel.
      The faces are drawn (17c-emoji.js) rather than printed, so they are the
      same six faces on a phone, a desktop and a browser. */
  function moodRow(day, cls){
    const now = moodOf(day);
    return '<div class="mood-row' + (cls ? ' ' + cls : '') + '">'
      + MOODS.map(m=>'<button class="mood-pick' + (now === m.e ? ' on' : '')
          + '" data-mood="' + m.e + '" data-day="' + esc(day) + '"'
          + ' title="' + esc(m.n) + '" aria-label="' + esc(m.n) + '">'
          + (moodPopping(day, m.e) ? emoFace(m.e, 'pop', moodPopAge()) : emoFace(m.e))
          + '</button>').join('')
      + '</div>';
  }
  /** Wire a rendered `moodRow`. Delegated so it survives a re-render. */
  function moodWire(box, after){
    if(!box) return;
    box.querySelectorAll('[data-mood]').forEach(b=>{
      b.onclick = ()=>{
        /* Marked before the store is touched, because writing the mood is what
           repaints the calendar — and the repaint is the thing that has to
           carry the motion with it.

           **Only when it is being chosen.** Tapping the face already there
           clears it, and each face's motion is that face *meaning* something —
           the great day hopping as it is taken off the calendar is the app
           cheering at the wrong moment. */
        if(moodOf(b.dataset.day) !== b.dataset.mood) moodPop(b.dataset.day, b.dataset.mood);
        /* And a face taken off part-way through its own motion stops there,
           rather than finishing a hop for a day it no longer describes. */
        else if(moodPopping(b.dataset.day, b.dataset.mood)){ clearTimeout(MOOD_POP_T); MOOD_POP = ''; }
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
    moodAskDraw(day);
    el.classList.remove('hide');
  }
  /* The prompt draws its own row and re-draws it on a tap. It has to: the
     answer is the last thing that happens on this panel and the panel then
     goes away, so hiding it at once plays the animation behind a closing box
     and nobody ever sees the face they chose. Redraw, let the pop run, and
     close on the far side of it. */
  function moodAskDraw(day){
    const row = $('mood-ask-row');
    if(!row) return;
    row.innerHTML = moodRow(day, 'big');
    moodWire(row, ()=>{
      moodAskDraw(day);
      clearTimeout(MOOD_ASK_T);
      MOOD_ASK_T = setTimeout(()=>moodDone(day), EMO_HOLD);
    });
  }
  let MOOD_ASK_T = 0;
  function moodDone(day){
    clearTimeout(MOOD_ASK_T);
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
