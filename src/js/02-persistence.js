  /* ---------- persistence ---------- */
  async function load(){
    try{
      const r = await KV.get('focus_sim');
      if(r && r.value){
        const d = JSON.parse(r.value);
        const today = new Date().toDateString();
        Object.assign(S,{
          focusMin:d.focusMin??25, breakMin:d.breakMin??5,
          autoContinue:d.autoContinue??true, sound:d.sound??true,
          repeat:d.repeat??4,
          // which clock face; validated in 43-faces.js, so a bad value here is
          // read as the default rather than leaving an empty dial
          face:d.face??'digital',
          // the little person by your name; see 46-buddy.js
          buddy:d.buddy||null,
          /* **Which antic he does, and whether he does it at all.**

             These were read from `S` by the picker and never written here, so
             the choice survived exactly as long as the tab did: pick the nap,
             reload, and he is back to swinging. It looked like the picker was
             ignoring you. `budAnim` is an index into `BUD_ANIMS`, so `|0`
             rather than `||` — nought is a real choice, not a missing one. */
          /* **Absent is -1, not 0.** 0 is the web-swing, which is bought like
             everything else now; a record written before antics were bought has
             no key at all and its owner has bought nothing, so the honest
             reading of a missing antic is "none". `budStrip` would take it off
             anyway; this stops him flickering through one swing first. */
          budAnim:(d.budAnim == null ? -1 : d.budAnim | 0),
          budShow:d.budShow !== false,
          at:d.at||0
        });
        if(d.day===today){ S.sessionsToday=d.sessionsToday||0; S.cycle=d.cycle||0; }
        S.day = today;
        LIVE = d.live && d.day === today ? d.live : null;
      }
    }catch(e){/* first run */}
    S.remaining = S.total = S.focusMin*60;
    loadLive();
  }

  /* What `load` found, if anything, and the putting of it back.

     **Separate from `load` because it is the one part that can decline.** A
     saved block is only worth restoring if it still makes sense: a day old, or
     finished an hour ago while the phone was off, and the honest answer is to
     start fresh rather than drop somebody into a countdown that ran out while
     they were asleep. */
  let LIVE = null;

  /* How long after a block should have ended it is still worth coming back to.
     Inside this, the block ran out while you were away and the app should say
     so; past it, too much has happened and the block is history. */
  const LIVE_GRACE = 10 * 60 * 1000;

  function loadLive(){
    const v = LIVE; LIVE = null;
    if(!v || !v.mode || v.mode === 'setup') return;
    const now = Date.now();
    if(v.running){
      const left = Number(v.endAt) - now;
      /* Ended while away, and not so long ago that it is somebody else's day:
         land on the end of the block rather than in the middle of one that is
         over. */
      if(left <= 0 && left > -LIVE_GRACE){ S.remaining = 0; }
      else if(left > 0){ S.remaining = Math.round(left / 1000); }
      else return;                    // too old to mean anything
      S.endAt = Number(v.endAt) || 0;
    }else{
      const rem = Math.round(Number(v.remaining) || 0);
      if(rem <= 0) return;
      S.remaining = rem;
      S.endAt = 0;
    }
    S.mode = v.mode;
    S.running = false;
    /* **The loop is not started here.** `start()` renders, broadcasts to the
       room and reaches for the wake lock and the ambience, none of which are up
       while the loads are still running. init picks this flag up once
       everything is; see 90-init.js. */
    S.resume = !!v.running && S.remaining > 0;
    S.total = Math.round(Number(v.total) || S.remaining) || S.remaining;
    S.cycle = Number(v.cycle) || 0;
    S.runCount = Number(v.runCount) || 0;
    S.restIsLong = !!v.restIsLong;
    /* **The same row in the log, not a new one.** The record was left open when
       the app went, and `logProgress` opens a fresh one whenever it does not
       know of an open row — which would cut one block into two, each with its
       own start time, in the calendar and in the streak. */
    if(v.logId) S.lastLogId = v.logId;
    try{ logAdopt(v.logId); }catch(e){}
  }
  /* `stamp` is only ever passed as 0, by `Account.wipe()`.

     **Settings are settled by `at`, so an emptied device must not claim now.**
     Signing in wipes this device and then pulls the account — but the wipe
     writes settings, and a write stamped with the current time is newer than
     anything the account holds. The buddy, the theme, the clock face and the
     antic would all be judged stale on arrival and thrown away, and you would
     sign in on a new laptop to find your profile reset to defaults. A device
     with nothing of its own has no claim on the answer, and 0 says so.

     **And `S.at` is updated here, not just written.** It used to be stamped
     into storage while the copy in memory kept whatever `load()` read at boot,
     so a setting changed and synced in the same session was compared using an
     hours-old timestamp and could lose to the server's older copy. */
  function save(stamp){
    try{
      S.at = stamp === undefined ? Date.now() : stamp;
      KV.set('focus_sim', JSON.stringify({
        focusMin:S.focusMin, breakMin:S.breakMin,
        autoContinue:S.autoContinue, sound:S.sound,
        sessionsToday:S.sessionsToday, cycle:S.cycle, repeat:S.repeat,
        face:S.face, buddy:S.buddy,
        budAnim:S.budAnim|0, budShow:S.budShow !== false,
        /* **The block that is running, so it survives being closed.**

           Android ends this app whenever it wants the memory, and coming back
           put you on the setup screen with the clock at twenty-five minutes: a
           block eighteen minutes in simply stopped existing. The *time* was
           never lost — the session log writes an open record within seconds of
           a block starting and keeps it current — but the clock was, and from a
           chair those are the same thing.

           Only the fields a block is made of. Settings are already above and
           the log looks after itself; this is the clock, the phase, and where
           in the cycle of four it had got to. `endAt` is an instant rather
           than a duration, so time passing while the app is dead counts, which
           is the whole point. */
        live:(S.mode === 'setup' ? null : {
          mode:S.mode, running:!!S.running,
          endAt:S.endAt, remaining:S.remaining, total:S.total,
          cycle:S.cycle, runCount:S.runCount, restIsLong:!!S.restIsLong,
          logId:S.lastLogId || null, at:Date.now()
        }),
        // when this was last written; what mergeSim compares (47-merge.js)
        at:S.at,
        day:new Date().toDateString()
      }));
    }catch(e){}
  }

