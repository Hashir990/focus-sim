  /* ---------------- UPDATES ----------------
     How a copy of this app on somebody else's machine finds out that a newer
     one exists.

     The constraint is the shape of the thing: it is one HTML file that works
     offline, with no server of its own and no account behind it. So there is
     nothing that can push an update and nothing that should silently replace a
     file on a stranger's disk. What is left is the honest version — the app
     knows what it is, asks a static file what the newest one is, and tells the
     person if those differ. Downloading and installing stays a decision they
     make, in the browser, with their eyes open.

     **The check is opt-in by hosting, not by asking.** `UPD_URL` is stamped in
     at build time (see tools/build.mjs). If it hasn't been pointed anywhere
     real, every part of this quietly does nothing: no menu item, no request, no
     mention. A build handed out on a USB stick doesn't nag about a URL that
     isn't there.

     **Nothing is sent.** The request is a GET of a public file. No id, no
     version in a query string, no headers of ours — the app compares locally,
     because comparing two version strings does not need a server's help.

     **On a phone this fetch needs help, and the help is one line of config.**
     A Capacitor web view runs on an origin of its own (`https://localhost`), so
     asking github.com for `latest.json` is a cross-origin request — and GitHub
     redirects release-asset downloads to `objects.githubusercontent.com`, which
     does not answer with an `Access-Control-Allow-Origin` a web view can use.
     The fetch below is therefore refused before it leaves the device, the catch
     swallows it, and the app concludes there is no news. For ever. Which is
     what "the phone never notices an update" was.
     `CapacitorHttp.enabled` in capacitor.config.json routes fetch through the
     native HTTP stack instead, where CORS does not apply. Nothing here changes;
     the request simply starts arriving.

     **And it can only ever *tell* you.** Neither a copied HTML file nor a web
     view can replace its own assets, so the button is a link. The desktop build
     is the one that installs by itself (electron/updater.cjs); on a phone the
     honest answers are a store, or a live-update plugin that swaps the web
     bundle. See ANDROID.md.

     The file at the other end is one small object:

         { "version": "1.1.0",
           "notes": "What changed, in a sentence or two.",
           "url": "https://.../releases/latest" }

     tools/make-release.mjs writes it. */

  const UPD_VERSION = '__VERSION__';
  const UPD_URL = '__UPDATE_URL__';
  const UPD_KEY = 'focus_update';
  /* Once a day at most, and only when the app is opened. A focus timer that
     spends its afternoon polling a server is exactly the sort of thing this app
     is supposed to be an argument against. */
  const UPD_EVERY = 24 * 60 * 60 * 1000;

  /** Is the URL a real one, or the placeholder the repo ships with? */
  function updConfigured(){
    return !!UPD_URL && UPD_URL.indexOf('OWNER/REPO') < 0
      && /^https?:\/\//.test(UPD_URL);
  }

  /* Compare two dotted versions the way people read them: 1.10.0 is newer than
     1.9.0, which string comparison gets wrong. Anything unparseable sorts as
     zero rather than throwing — a malformed file on the far end should mean "no
     news", not a broken menu. */
  /* "just now" / "2 hours ago" / "on 14 Aug". Rough on purpose: the point is
     whether the answer is fresh, and to the minute would invite reading it as a
     clock. */
  function updWhen(at){
    const mins = Math.floor((Date.now() - at) / 60000);
    if(mins < 2) return T('just now');
    if(mins < 60) return Tn('{n} minutes ago', '{n} minutes ago', mins);
    const hrs = Math.floor(mins / 60);
    if(hrs < 24) return hrs === 1 ? T('an hour ago') : Tn('{n} hours ago', '{n} hours ago', hrs);
    const days = Math.floor(hrs / 24);
    if(days === 1) return T('yesterday');
    if(days < 7) return Tn('{n} days ago', '{n} days ago', days);
    return T('on {date}', {date:new Date(at).toLocaleDateString(langLocale(), {day:'numeric', month:'short'})});
  }

  function updNewer(there, here){
    const bits = (v)=>String(v || '').split(/[.\-+]/).map(n=>parseInt(n, 10) || 0);
    const a = bits(there), b = bits(here);
    for(let i = 0; i < Math.max(a.length, b.length); i++){
      const x = a[i] || 0, y = b[i] || 0;
      if(x !== y) return x > y;
    }
    return false;
  }

  const Update = {
    latest:null,          // what the last check found, if anything
    checking:false,

    async load(){
      if(!updConfigured()) return;
      try{
        const r = await KV.get(UPD_KEY);
        if(r && r.value){
          const d = JSON.parse(r.value) || {};
          this.last = d.last || 0;
          // Remembered so the banner can be shown again after a restart without
          // going back to the network for it.
          if(d.found && updNewer(d.found.version, UPD_VERSION)) this.latest = d.found;
        }
      }catch(e){}
      this.paint();
      if(Date.now() - (this.last || 0) > UPD_EVERY) this.check(true);
    },

    save(){
      try{
        KV.set(UPD_KEY, JSON.stringify({last:this.last || 0, found:this.latest || null}));
      }catch(e){}
    },

    /** `quiet` means say nothing unless there is something to say. */
    async check(quiet){
      if(!updConfigured() || this.checking) return;
      this.checking = true;
      this.paint();
      let found = null, failed = false;
      try{
        /* cache:'no-store' because the whole point is to see today's file, and a
           raw-file host will happily serve a cached copy for an hour. */
        const res = await fetch(UPD_URL, {cache:'no-store'});
        if(res.ok){
          const d = await res.json();
          if(d && d.version) found = {
            version:String(d.version).slice(0, 20),
            notes:String(d.notes || '').slice(0, 400),
            url:/^https?:\/\//.test(d.url || '') ? d.url : '',
          };
        }else failed = true;
      }catch(e){ failed = true; }

      this.checking = false;
      this.last = Date.now();
      this.latest = found && updNewer(found.version, UPD_VERSION) ? found : null;
      this.save();
      this.paint();

      if(quiet) return;
      if(failed) toast('Could not reach the update server');
      else if(!this.latest) toast('You are on the newest version');
    },

    /* The banner in the menu. Not a dialog: an update is news, not an
       interruption, and nothing about this app stops working because a newer one
       exists. */
    /* ---- the desktop shell, which does this properly ----
       In the Electron build there is a real updater underneath (electron/
       updater.cjs): it downloads on its own and installs at the next exit. It
       just used to do all of that *silently*, while this banner went on showing
       a "Get it" link to GitHub — so the only visible route was the manual one
       and everybody took it. The link was answering a question the app had
       already answered for itself.

       `window.focusUpdate` exists only in that build (electron/preload.cjs). If
       it is there, the banner becomes a progress line and the link goes away. */
    native:null,

    watch(){
      if(!window.focusUpdate || this.native) return;
      this.native = {state:'idle'};
      try{
        window.focusUpdate.on((p)=>{ Update.native = p || {state:'idle'}; Update.paint(); });
      }catch(e){}
    },

    paint(){
      const box = $('upd-box');
      if(!box) return;
      this.watch();
      box.classList.toggle('hide', !updConfigured());
      if(!updConfigured()) return;

      /* Whatever the shell is doing wins: it knows, and this does not.

         `manual` is the shell saying it has an updater that will not run — an
         unpacked copy, where electron-updater does nothing at all. That is the
         one case where the link to GitHub below is the honest answer, so it
         falls through exactly as a browser does. */
      const n = this.native;
      /* **`idle` is not a promise, it is the absence of one.**

         `watch()` sets `idle` the instant it subscribes — before the shell has
         said anything at all. Counting that as "the shell is handling it" meant
         that whenever the reply never came, the page hid the manual link *and*
         showed no progress, because it was waiting on an answer to a question
         nobody heard. An app that offers you nothing at all is worse than one
         that offers you the long way round.

         So only a state the shell has actually sent counts. If we have heard
         nothing, the link to GitHub is the honest answer — that is also exactly
         the right behaviour in a browser, where there is no shell to hear from.

         `manual` stays excluded for its own reason: it means the shell has an
         updater that will not run (an unpacked copy), so the link is again the
         only real route. */
      const shellAuto = !!(n && n.state && n.state !== 'manual' && n.state !== 'idle');
      if(n && n.state && n.state !== 'idle' && n.state !== 'current'
         && n.state !== 'manual' && n.state !== 'auto'){
        const pct = Math.max(0, Math.min(100, n.percent | 0));
        box.dataset.have = UPD_VERSION;
        box.innerHTML = n.state === 'ready'
          ? '<div class="upd new"><b>' + esc(T('Version {v} is ready', {v:n.version || ''})) + '</b>'
            + '<em>It goes in next time you close the app — or now, if you like.</em>'
            + '<button type="button" class="upd-get" id="upd-restart">Restart now</button>'
            + '<p class="upd-safe">Nothing you have done is touched.</p></div>'
          /* **Say what is in it while it comes down.** This showed a version
             number and a percentage and nothing else, so the one moment the
             person is actually looking at the banner was the moment it had
             least to say. The notes are already on hand from the `latest.json`
             check; the download is exactly when somebody wants to know what
             they are getting. */
          : n.state === 'downloading'
            ? '<div class="upd new"><b>' + esc(T('Downloading version {v}', {v:n.version || ''})) + '</b>'
              + ((this.latest && this.latest.notes) ? '<em>' + esc(this.latest.notes) + '</em>' : '')
              + '<div class="upd-bar"><i style="width:' + pct + '%"></i></div>'
              + '<p class="upd-safe">' + esc(T('{p}% done. It goes in when you next close the app.', {p:pct})) + '</p></div>'
            : n.state === 'checking'
              ? '<button type="button" class="upd-check" disabled>Checking…'
                + '<span>' + esc(T('version {v}', {v:UPD_VERSION})) + '</span></button>'
              : '<button type="button" class="upd-check" id="upd-check">Check for updates'
                + '<span>could not reach the update server</span></button>';
        const r = $('upd-restart');
        if(r) r.onclick = ()=>{ try{ window.focusUpdate.restart(); }catch(e){} };
        const b2 = $('upd-check');
        if(b2) b2.onclick = ()=>Update.check(false);
        return;
      }
      const v = this.latest;
      box.dataset.have = UPD_VERSION;
      box.dataset.latest = v ? v.version : '';
      /* **Only offer the manual route where it is the only route.** Sending
         somebody to GitHub in a build that is already downloading the same file
         for them is how this looked broken: the automatic path was invisible
         and the visible path was the wrong one. */
      box.innerHTML = v
        ? '<div class="upd new"><b>' + esc(T('Version {v} is out', {v:v.version})) + '</b>'
          + '<em>' + esc(T('You have {v}.', {v:UPD_VERSION}))
          + (v.notes ? ' <span translate="no">' + esc(v.notes) + '</span>' : '')
          + (shellAuto ? ' ' + esc(T('It is downloading on its own — nothing to do.')) : '') + '</em>'
          + (v.url && !shellAuto ? '<a class="upd-get" href="' + esc(v.url)
              + '" target="_blank" rel="noopener">Get it</a>' : '')
          + '<p class="upd-safe">Nothing you have done is touched.</p></div>'
        /* **Answer the question that was asked.**

           With nothing newer to report this showed "Check for updates" again —
           the same button, unchanged, whether it had just looked and found
           nothing or had never looked at all. Pressing a button and having it
           turn back into itself reads as a broken button, and it is why people
           press it four times.

           So: if a check has actually happened, say what it found and when. The
           button stays, because looking again is a reasonable thing to want. */
        : '<button type="button" class="upd-check" id="upd-check">'
          + (this.checking ? 'Checking…' : (this.last ? 'You are up to date' : 'Check for updates'))
          + '<span>' + esc(T('version {v}', {v:UPD_VERSION})
          + (this.last && !this.checking ? ' · ' + T('checked {when}', {when:updWhen(this.last)}) : ''))
          + '</span></button>';
      const b = $('upd-check');
      if(b) b.onclick = ()=>Update.check(false);
    },
  };
