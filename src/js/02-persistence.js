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
      }
    }catch(e){/* first run */}
    S.remaining = S.total = S.focusMin*60;
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
        // when this was last written; what mergeSim compares (47-merge.js)
        at:S.at,
        day:new Date().toDateString()
      }));
    }catch(e){}
  }

