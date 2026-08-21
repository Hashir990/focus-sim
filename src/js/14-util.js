  /* ================================================================
     QUOTES · SESSION LOG · CALENDAR   (v3)
     ================================================================ */
  const esc = s => String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const fmtDur = secs => { const m=Math.round(secs/60); if(m<60) return m+' min'; const h=Math.floor(m/60), r=m%60; return r? h+'h '+r+'m' : h+'h'; };
  const dayKey = ts => { const d=new Date(ts); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); };


  /* ---- the date in the top bar ----
     Written out the way a person says it — "Tue 30 Jul" — rather than 30/07,
     which reads as a number and is ambiguous across half the world. Repainted
     on every render, so a timer left running overnight is right in the morning
     rather than a day behind. */
  function todayLabel(d){
    const t = d || new Date();
    return t.toLocaleDateString(undefined, {weekday:'short', day:'numeric', month:'short'});
  }
  function paintDate(){
    const el = $('today-date');
    if(el) el.textContent = todayLabel();
  }

  /* ---------- tombstones ----------

     **A union cannot express a deletion, so deletions are recorded.**

     The plan and the checklist merge by id: take everything on both sides and
     you never lose an entry somebody added on their phone. But that same rule
     resurrects anything they *deleted* on their phone — the other device still
     has it, the union puts it back, and the item returns an hour later looking
     like a bug in the calendar. It is the oldest problem in syncing lists and
     there is no clever way round it; the delete has to be a fact that travels,
     not the absence of one.

     So removing a plan entry or a task writes its id here, this list syncs like
     everything else, and the merge drops anything named in it. Plan ids start
     `p` and task ids `t`, so one list can hold both without collision.

     The rule when the two disagree — deleted here, edited there — is that the
     delete wins. That is the safer way round: an entry that comes back is a
     thing you have to notice and remove again, while one that stays gone is a
     thing you retype once and only if you actually wanted it.

     Capped, oldest dropped first. An id nobody has held a copy of for months
     cannot be resurrected by anything, so remembering it for ever buys nothing.
     Newest last, which is the order `mergeGone` keeps. */
  var GONE = [];
  const GONE_KEY = 'focus_gone';
  const GONE_MAX = 500;

  async function loadGone(){
    try{
      const r = await KV.get(GONE_KEY);
      if(r && r.value){
        const g = JSON.parse(r.value);
        if(Array.isArray(g)) GONE = g.filter(x=>typeof x === 'string').slice(-GONE_MAX);
      }
    }catch(e){}
  }
  function saveGone(){ try{ KV.set(GONE_KEY, JSON.stringify(GONE)); }catch(e){} }
  function tombstone(id){
    if(!id || GONE.indexOf(id) >= 0) return;
    GONE.push(id);
    if(GONE.length > GONE_MAX) GONE = GONE.slice(-GONE_MAX);
    saveGone();
  }

  /* "3 sessions, 2 calendar entries and 1 task" — an Oxford-less list, because
     it is read inside a sentence in a warning dialog and a bare comma-joined
     run of nouns reads as a database dump rather than as a sentence about your
     afternoon. */
  function listPhrase(bits){
    const a = (bits || []).filter(Boolean);
    if(!a.length) return 'nothing';
    if(a.length === 1) return a[0];
    return a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  }
