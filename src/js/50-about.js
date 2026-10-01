  /* ---------------- about: privacy, and credits ----------------

     **The policy is written from what the code actually does.** Every line below
     was checked against a call site: the fonts against the `@import` at the top
     of 00-tokens-base.css, the signalling server against `SYNC_CDN` and PeerJS
     in 29-sync.js, the vault against `ACC_URL` in 48-account.js, the update
     check against `UPD_URL` in 41-update.js. A privacy policy assembled from
     what a developer remembers is a document that is wrong within a month; this
     one is a description of the program, and if the program changes this has to
     change with it. The comment is the instruction: **add a line here when you
     add a network call, and delete one when you remove it.**

     What it deliberately does not do is promise things the code cannot keep —
     there is no "we use industry-standard encryption" sentence, because the
     honest version is "your data goes to a server over HTTPS and is held there",
     and the honest version is the one that is still true next year. */

  const ABOUT_UPDATED = '11 September 2026';

  /* Filled in by whoever ships the build. Left visible on purpose: an unfilled
     contact line in a shipped policy is worse than no policy, and it should be
     impossible to miss. See §"Your part" in HANDOFF.md. */
  /* **The address is back in the policy, and it has to be.** It went when
     questions were routed through Report a problem, which is the better path
     for a bug — but a privacy policy is not a bug report. Both app stores
     require a contact for data questions; a deletion request has to reach
     somebody even from a person who has already uninstalled the app; and
     `mailto:` does nothing at all on a device with no mail app set up. So the
     address is printed plainly as well as offered as a form. `REPORT_TO` below
     is deliberately a different address: bug reports and data requests are
     different post, and mixing them loses the one that matters legally. */
  const ABOUT_OWNER = '__PRIVACY_OWNER__';
  const ABOUT_EMAIL = '__PRIVACY_EMAIL__';
  function aboutWho(v, fallback){
    return (v && v.indexOf('__') !== 0) ? esc(v) : '<u class="about-todo">' + fallback + '</u>';
  }

  function aboutPrivacy(){
    return ''
      + '<p class="about-lede">Focus Simulator keeps what you do on the device '
      + 'you do it on. Nothing here is sold, shared for advertising, or measured '
      + 'to work out who you are. There is no analytics of any kind in this app.</p>'

      + '<h4>What stays on this device</h4>'
      + '<p>Your sessions and how long they ran, your tasks and calendar, the '
      + 'quotes you keep, your embers and everything you have bought with them, '
      + 'your buddy, every saved game, and the mood you set for a day. All of it '
      + 'lives in this app’s own storage. If you never sign in, none of it '
      + 'leaves.</p>'

      + '<h4>What leaves, only if you choose it</h4>'
      + '<p><b>An account.</b> Signing in sends your email address, your chosen '
      + 'username, and a copy of the data above to the app’s own server, so '
      + 'the same progress reaches your other devices. Your password is not '
      + 'stored as you typed it. Nobody is emailed anything except about the '
      + 'account itself.</p>'
      + '<p><b>Focus together.</b> A room connects your device directly to the '
      + 'other people in it. They see the name you chose, your buddy, the game '
      + 'you have open, whatever you type in the chat, and the state of the '
      + 'shared timer. Because the connection is direct, they can also see your '
      + 'device’s network address. That is how a direct connection '
      + 'works, and it is true of every app that makes one. A public signalling '
      + 'service is used to introduce two devices to each other; it sees the room '
      + 'code and the addresses, and not what you send afterwards. Rooms keep '
      + 'nothing: close it and there is no record on any server.</p>'
      + '<p><b>Checking for a new version.</b> The desktop app asks the releases '
      + 'page whether a newer build exists. That request carries nothing but the '
      + 'fact that some device asked.</p>'
      + '<p><b>Typefaces.</b> The app loads two typefaces from Google Fonts when '
      + 'it opens, which means Google can see that a device asked for them.</p>'

      + '<h4>What is never collected</h4>'
      + '<p>No advertising identifiers. No location. No contacts. No microphone '
      + 'or camera. No third-party analytics, crash reporting or tracking. '
      + 'Nothing you write in a task, a quote or a chat is read by anyone running '
      + 'this app.</p>'

      + '<h4>Keeping it, and getting rid of it</h4>'
      + '<p><b>Reset progress</b> in this menu clears this device. If you are '
      + 'signed in, that empties the device and not the account. Deleting your '
      + 'account deletes what the server holds for it; ask at the address below '
      + 'and it is done. Data on the server is kept while the account exists and '
      + 'no longer.</p>'

      + '<h4>Children</h4>'
      + '<p>This app is not aimed at children under 13, and no account should be '
      + 'made for one. Nothing in it is designed to profile anybody, of any '
      + 'age.</p>'

      + '<h4>Who to ask</h4>'
      /* One sentence, with a comma after the name rather than a full stop. A
         name can legitimately end in an initial — "Hashir N." — and a full stop
         straight after it reads as a typo. */
      + '<p>This app is made and run by ' + aboutWho(ABOUT_OWNER, 'the developer')
      + ', and questions about your data, corrections, or a request to delete '
      + 'your account go to ' + aboutWho(ABOUT_EMAIL, 'the contact address for this build')
      + ', which is read by a person.</p>'
      + '<p>If something is broken rather than something you want to ask, '
      + '<b>Report a problem</b> in this menu is quicker: it fills in which '
      + 'version you are running and whether this device is saving properly, '
      + 'which is usually most of the answer.</p>'
      + '<p class="about-date">Last updated ' + ABOUT_UPDATED + '. If this '
      + 'changes, the date changes with it.</p>';
  }

  function aboutCredits(){
    return ''
      + '<p class="about-lede">Built by ' + aboutWho(ABOUT_OWNER, 'the developer')
      + '. It stands on other people’s work.</p>'
      + '<h4>Type</h4>'
      + '<p><b>Space Grotesk</b> by Florian Karsten, and <b>Fraunces</b> by '
      + 'Undercase Type. Both under the SIL Open Font License.</p>'
      + '<h4>Code</h4>'
      + '<p><b>PeerJS</b> carries Focus together’s direct connections (MIT). '
      + '<b>Electron</b> makes the desktop app, and <b>Capacitor</b> the phone '
      + 'ones. The server the account uses runs on <b>Cloudflare Workers</b>.</p>'
      /* CC0 asks for nothing. Saying so anyway costs a line and is the whole
         reason work like this keeps being given away. */
      /* **Two of these three credits are conditions, not courtesies.**
         game-icons.net is CC BY 3.0 and Twemoji CC BY 4.0: both licences
         require naming the maker wherever the work is used, so this section has
         to stay for as long as those pictures are in the bank. Kenney's are
         CC0 and require nothing; he is named anyway. */
      + '<h4>Pictures</h4>'
      + '<p>The picross pictures are other people’s drawings, reduced to squares.</p>'
      + '<p><b>game-icons.net</b>: icons by Lorc, Delapouite, John Colburn, '
      + 'Felbrigg, John Redman, Carl Olsen, Sbed, PriorBlue, Willdabeast, '
      + 'Viscious Speed, Lord Berandas, Irongamer, HeavenlyDog, Lucas, '
      + 'Faithtoken, Skoll, Andy Meneely, Cathelineau, Kier Heyl, Aussiesim, '
      + 'Sparker, Zeromancer, Rihlsul, Quoting, Guard13007, DarkZaitzev, '
      + 'SpencerDub, GeneralAce135, Zajkonur, Catsu, Starseeker, '
      + 'Pepijn Poolman, Pierre Leducq, Caro Asercion and SeregaCthtuf, under '
      + '<a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" '
      + 'rel="noreferrer">CC BY 3.0</a>.</p>'
      + '<p><b>Twemoji</b>, by Twitter and its contributors, and '
      + '<b>Font Awesome Free</b>, by Fonticons, both under '
      + '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" '
      + 'rel="noreferrer">CC BY 4.0</a>. <b>Bootstrap Icons</b>, by the '
      + 'Bootstrap authors, under the MIT licence. And icons by <b>Kenney</b> '
      + '(kenney.nl), public domain under CC0, credit is not required there, '
      + 'and is here because the work was given away.</p>'
      + '<h4>The games</h4>'
      + '<p>Sudoku, the crossword, the word guess, 2048, Tetris, chess, scrabble, '
      + 'hangman, pictionary and memory are all written for this app. The rules '
      + 'belong to nobody; the implementations are this app’s own. Every '
      + 'crossword clue in the bank was written for it.</p>'
      + '<h4>And</h4>'
      + '<p>Everyone who sat through a session with an early build and said which '
      + 'parts were annoying. That is most of why the rest of it is not.</p>';
  }

  /* ---------------- reporting something ----------------

     **A category before the sentence, because the sentence is usually one
     word.** "It does not work" is what people write when there is nothing to
     pick from, and it is unanswerable. Eight buckets, and the one that is
     chosen tells you which half of the app to look at before the prose starts.
     They are named after what went wrong from where the person is sitting, not
     after the file it lives in — nobody knows they are reporting a crossword
     bug when the symptom is that a board went blank.

     **And it says what it is sending.** The version and the platform are the
     two facts that settle most reports on their own — a whole week of this app's
     history was spent finding out which build somebody was running — and the
     rest is the handful of things that have actually explained a fault before.
     It is shown, in full, in a box the person can read and edit, because
     attaching diagnostics people cannot see is how you lose their trust once.

     `mailto:` rather than a server, and that is not a compromise: the report
     leaves from their own mail app, to an address they can see, with a body
     they have read. Nothing is posted anywhere, nothing is logged, and it works
     with the account signed out and the network flaky. If the mail app does not
     open — a desktop with none configured — the whole thing goes to the
     clipboard instead and says so. */

  const REPORT_TO = 'spiderman.hashir@gmail.com';

  const REPORT_KINDS = [
    ['broken',  'Something is broken',     'It does not work at all, or the screen is stuck'],
    ['lost',    'I lost progress',         'Sessions, embers, a board or a puzzle went missing'],
    ['game',    'A game misbehaves',       'Wrong rules, a board that will not take input, a score'],
    ['room',    'Focus together',          'Rooms, joining, chat, playing with somebody'],
    ['account', 'Account and syncing',     'Signing in, or two devices disagreeing'],
    ['look',    'Looks, sounds, the shop', 'Weather, the buddy, embers, something you bought'],
    ['idea',    'An idea or a request',    'Not a fault, something you would like'],
    ['other',   'Something else',          'None of the above'],
  ];

  let reportKind = '';

  /** The handful of facts that have actually settled a report before. */
  function reportFacts(){
    const bits = [];
    const push = (k, v)=>{ if(v || v === 0) bits.push(k + ': ' + v); };
    push('Version', 'v__VERSION__ (build __BUILD__)');
    try{ push('Platform', navigator.platform + ' · ' + (navigator.userAgent.match(/(Electron|Android|iPhone|iPad|Firefox|Chrome|Safari)[\/ ]?[\d.]*/) || ['browser'])[0]); }catch(e){}
    try{ push('Window', innerWidth + '\u00d7' + innerHeight); }catch(e){}
    try{ push('Signed in', Account.token ? ('yes, as ' + (Account.username || '?')) : 'no'); }catch(e){}
    try{
      let writable = false;
      try{ localStorage.setItem('focus_probe', '1'); writable = !!localStorage.getItem('focus_probe'); localStorage.removeItem('focus_probe'); }catch(e){ writable = false; }
      push('Saving', writable ? 'working' : 'NOT WORKING on this device');
    }catch(e){}
    try{ push('Look', Embers.light); }catch(e){}
    try{ if(Cross.lastError) push('Last crossword error', Cross.lastError); }catch(e){}
    return bits.join('\n');
  }

  function aboutReport(){
    return ''
      + '<p class="about-lede">Pick the closest thing, then say what happened. '
      + 'It opens your mail app with the message ready. Nothing is sent '
      + 'from here, and nothing goes anywhere until you press send there.</p>'
      + '<h4>What kind of thing is it</h4>'
      + '<div class="rep-kinds" id="rep-kinds">'
      + REPORT_KINDS.map(([k, name, note])=>
          '<button class="rep-kind' + (reportKind === k ? ' on' : '') + '" data-kind="' + k + '">'
          + '<b>' + esc(name) + '</b><span>' + esc(note) + '</span></button>').join('')
      + '</div>'
      + '<h4>What happened</h4>'
      + '<textarea id="rep-text" rows="6" placeholder="What you did, what you '
      + 'expected, and what happened instead. If it happens every time, say so. '
      + 'that is the most useful sentence in any report."></textarea>'
      + '<h4>Sent with it</h4>'
      + '<p class="about-quiet">These go in the message so it does not take three '
      + 'replies to find out. Edit or delete any of it.</p>'
      + '<textarea id="rep-facts" rows="7" spellcheck="false">' + esc(reportFacts()) + '</textarea>'
      + '<button class="primary rep-send" id="rep-send">Write the email</button>'
      + '<p class="about-quiet">' + esc(T('It goes to {addr}.', {addr:REPORT_TO})) + '</p>';
  }

  function reportBody(){
    const k = REPORT_KINDS.find(x=>x[0] === reportKind);
    const said = (($('rep-text') || {}).value || '').trim();
    const facts = (($('rep-facts') || {}).value || '').trim();
    return (k ? k[1] : 'Something else') + '\n\n'
      + (said || '(nothing written yet)') + '\n\n'
      + '--\n' + facts + '\n';
  }

  /** **Returns the address it would open, or '' if it refused.**
      A function that only has side effects can only be tested by watching for
      them, and the side effect here is handing the page to the operating system
      — which a test harness cannot let happen. Returning the result makes the
      two refusals checkable without pretending to open anything. */
  function reportSend(){
    if(!reportKind){ toast('Pick what kind of thing it is'); return ''; }
    const said = (($('rep-text') || {}).value || '').trim();
    if(!said){ toast('Say what happened first'); return ''; }
    const k = REPORT_KINDS.find(x=>x[0] === reportKind);
    const subject = 'Focus Simulator: ' + (k ? k[1] : 'Report');
    const body = reportBody();
    const url = 'mailto:' + REPORT_TO
      + '?subject=' + encodeURIComponent(subject)
      + '&body=' + encodeURIComponent(body);
    /* **A desktop with no mail app configured does nothing at all**, and gives
       no error to catch — so the clipboard is offered straight afterwards
       rather than waiting to find out. Whoever has a mail app never notices;
       whoever does not has the report in hand instead of a dead button. */
    let opened = false;
    try{ location.href = url; opened = true; }catch(e){ opened = false; }
    try{
      navigator.clipboard.writeText(REPORT_TO + '\n\n' + subject + '\n\n' + body);
      toast(opened ? 'Opening your mail. Copied it as well' : 'Copied. Paste it into an email');
    }catch(e){
      toast(opened ? 'Opening your mail' : T('Could not open mail. Write to {addr}', {addr:REPORT_TO}));
    }
    return url;
  }

  /* ---------------- the same pages, in another language ----------------

     **A policy is translated as a document, not a sentence at a time.** These
     three pages are prose, and prose assembled from separately translated
     fragments reads like a phrasebook. Each language registers its own whole
     versions here from 61-docs-*.js; English, and any page a language has not
     written yet, falls back to the functions above. */
  const ABOUT_DOCS = {};
  function aboutDocs(lang, docs){ ABOUT_DOCS[lang] = docs; }
  function aboutDoc(which){
    const own = ABOUT_DOCS[LANG] && ABOUT_DOCS[LANG][which];
    if(own){ try{ return own(); }catch(e){} }
    return which === 'credits' ? aboutCredits()
      : which === 'terms' ? aboutTerms() : aboutPrivacy();
  }

  function aboutOpen(which){
    const t = $('about-title'), b = $('about-body');
    if(!t || !b) return;
    t.textContent = which === 'credits' ? 'Credits'
      : which === 'report' ? 'Report a problem'
      : which === 'terms' ? 'Terms of use' : 'Privacy';
    /* The documents arrive already in the reader's language, so the page
       translator is told to leave them alone; the report form is interface and
       is translated like any other screen. Set before the markup goes in, so
       the observer sees the mark when it gets there. */
    b.setAttribute('translate', which === 'report' ? 'yes' : 'no');
    b.innerHTML = which === 'report' ? aboutReport() : aboutDoc(which);
    b.scrollTop = 0;
    if(which === 'report'){
      const kinds = $('rep-kinds');
      if(kinds) kinds.querySelectorAll('.rep-kind').forEach(btn=>{
        btn.onclick = ()=>{
          reportKind = btn.dataset.kind;
          kinds.querySelectorAll('.rep-kind').forEach(o=>o.classList.toggle('on', o === btn));
        };
      });
      if($('rep-send')) $('rep-send').onclick = reportSend;
    }
    $('about-overlay').classList.remove('hide');
  }
  function aboutClose(){
    const o = $('about-overlay');
    if(o) o.classList.add('hide');
  }

  if($('about-back')) $('about-back').onclick = aboutClose;
  if($('d-privacy')) $('d-privacy').onclick = ()=>{ closeDrawer(); aboutOpen('privacy'); };
  if($('d-credits')) $('d-credits').onclick = ()=>{ closeDrawer(); aboutOpen('credits'); };
  if($('d-report')) $('d-report').onclick = ()=>{ reportKind = ''; closeDrawer(); aboutOpen('report'); };
