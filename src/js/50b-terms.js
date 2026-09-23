  /* ---------------- terms of use, and the language you read them in ----------------

     **Agreed to once, before anything else happens, and readable for ever
     after.** The first time the app opens it shows these terms over
     everything and waits for "I agree"; after that they live in the menu under
     About, beside the privacy policy they refer to. The agreement is kept on
     the device with the version it was given to, so changing the terms in a
     way that matters is one line — bump `TERMS_VERSION` — and everybody is
     asked again.

     **Written in the same voice as the privacy policy, for the same reason**:
     a document nobody can read agrees nobody to anything. Each promise in it is
     one the code keeps — embers cannot be bought because there is no purchase
     anywhere in the app; rooms are unmoderated because they are peer to peer
     and nothing passes through a server; what you already own keeps its price
     because of `EMB_WAS` and `grand` in 37-embers.js. If one of those stops
     being true, this has to change with it. */

  const TERMS_VERSION = '2026-09-22';
  const TERMS_UPDATED = '22 September 2026';
  /* **Which country's law.** The app keeps Pakistani time and is made there;
     whoever ships it should confirm this, the same way they fill in the owner
     and contact lines. */
  const TERMS_LAW = 'Pakistan';
  const TERMS_KEY = 'focus_terms';

  function termsAccepted(){
    try{
      const r = JSON.parse(localStorage.getItem(TERMS_KEY) || 'null');
      return !!r && r.v === TERMS_VERSION;
    }catch(e){ return false; }
  }
  function termsAccept(){
    try{ localStorage.setItem(TERMS_KEY, JSON.stringify({v:TERMS_VERSION, at:Date.now()})); }catch(e){}
  }

  function aboutTerms(){
    return ''
      + '<p class="about-lede">Focus Simulator is a free focus timer with a rest '
      + 'arcade. These terms are the agreement between you and whoever makes it. '
      + 'They are written to be read: if anything here is unclear, that is a fault '
      + 'in the terms, and the address at the bottom is where to say so.</p>'

      + '<h4>Agreeing to them</h4>'
      + '<p>By using the app you agree to these terms, and to the privacy policy, '
      + 'which says what happens to your data. If you do not agree, please do not '
      + 'use it. Both can be read again at any time from the menu, under About.</p>'

      + '<h4>Using the app</h4>'
      + '<p>You may use Focus Simulator for your own personal, non-commercial '
      + 'purposes, on as many of your own devices as you like. Please do not use '
      + 'it to break the law, to harm anybody, or to interfere with the app, its '
      + 'server, or other people’s use of them — that includes trying to get '
      + 'into accounts that are not yours, flooding the server with requests, or '
      + 'tampering with anybody else’s progress.</p>'

      + '<h4>Your account</h4>'
      + '<p>An account is optional. If you make one, you need to be at least 13, '
      + 'the details you give should be your own, and keeping your password to '
      + 'yourself is your responsibility. One account is for one person. An '
      + 'account used to harm other people or to attack the service may be '
      + 'closed. You can ask for yours to be deleted at any time.</p>'

      + '<h4>Focus together and chat</h4>'
      + '<p>A room connects your device directly to the other people in it, so '
      + 'nobody running this app sees or moderates what is said there. You are '
      + 'responsible for what you send. Be decent: no harassment, threats or '
      + 'hate, nothing sexual involving anybody under 18, no spam, and nothing '
      + 'illegal. If somebody makes a room unpleasant, leave it; to report them, '
      + 'write to the address below.</p>'

      + '<h4>Embers and the shop</h4>'
      + '<p>Embers are earned by focusing and by achievements. They cannot be '
      + 'bought, sold, or exchanged for money or for anything outside the app, '
      + 'and they have no cash value. What you get with them is permission to '
      + 'use that look, sound, clock face or item inside the app — not '
      + 'property. Prices and the shelf can change, but anything you have '
      + 'already bought stays yours at the price you paid.</p>'

      + '<h4>Puzzles, pictures and the rest</h4>'
      + '<p>The app, its code, its puzzles and its clues belong to its maker. The '
      + 'picross pictures are other people’s work, used under the licences '
      + 'named on the Credits page. Share a result or a screenshot as often as '
      + 'you like; please do not copy the puzzle banks or the app itself to pass '
      + 'off or sell as your own.</p>'

      + '<h4>App blocking</h4>'
      + '<p>On Android, app blocking puts a pause in front of the apps you choose. '
      + 'It is a tool to help you, not a guarantee: you can switch it off, and '
      + 'Android itself may stop it. It works on your phone alone and sends '
      + 'nothing anywhere.</p>'

      + '<h4>No guarantees</h4>'
      + '<p>The app is provided free and as it is, without warranties of any '
      + 'kind. It is looked after carefully, but it may have faults, features may '
      + 'change or go away, and — although a great deal of work goes into '
      + 'keeping progress safe — something could still be lost. Signing in keeps '
      + 'a copy of your progress on the server, which is the best protection '
      + 'there is.</p>'

      + '<h4>Responsibility</h4>'
      + '<p>As far as the law allows, the maker of the app is not liable for '
      + 'indirect or consequential losses, for lost progress, or for anything '
      + 'that comes of relying on the app, and total liability for anything else '
      + 'is limited to what you paid for it, which is nothing. None of this takes '
      + 'away any right the law gives you that cannot be taken away.</p>'

      + '<h4>Your health</h4>'
      + '<p>Focus Simulator is a timer, not medical advice. The mood you record is '
      + 'for you, and it is not a diagnosis of anything. Take the breaks; they '
      + 'are the point.</p>'

      + '<h4>Changes, and stopping</h4>'
      + '<p>These terms may change as the app does. The date below changes with '
      + 'them, and if a change matters, the app asks you to agree again before '
      + 'you carry on. You can stop using the app whenever you like and ask for '
      + 'your account to be deleted. The app, or any part of it, may also be '
      + 'discontinued.</p>'

      + '<h4>The law</h4>'
      + '<p>These terms are governed by the laws of ' + esc(TERMS_LAW) + ', '
      + 'without affecting any rights you have where you live.</p>'

      + '<h4>Who to ask</h4>'
      + '<p>This app is made and run by ' + aboutWho(ABOUT_OWNER, 'the developer')
      + '. Questions about these terms go to '
      + aboutWho(ABOUT_EMAIL, 'the contact address for this build') + '.</p>'
      + '<p class="about-date">Last updated ' + TERMS_UPDATED + '. If this '
      + 'changes, the date changes with it.</p>';
  }

  /* ---- the first time ---- */

  let TERMS_THEN = null;
  let TERMS_TAB = 'terms';

  /** Show the terms if they have not been agreed to, then carry on with `then`.
      Everything that would otherwise pop up on a first start — the daily mood
      question — waits behind this, so the first thing anybody sees is one
      clear question rather than two stacked on each other. */
  function termsGate(then){
    if(termsAccepted()){ if(then) then(); return; }
    TERMS_THEN = then || null;
    termsDraw('terms');
    const g = $('terms-gate');
    if(g) g.classList.remove('hide');
  }

  function termsDraw(which){
    TERMS_TAB = which === 'privacy' ? 'privacy' : 'terms';
    const doc = $('terms-doc');
    if(doc){
      doc.innerHTML = aboutDoc(TERMS_TAB);
      doc.scrollTop = 0;
    }
    for(const b of document.querySelectorAll('#terms-gate [data-doc]')){
      b.classList.toggle('on', b.dataset.doc === TERMS_TAB);
    }
    const langs = $('terms-langs');
    if(langs){
      langs.innerHTML = langButtons('terms-lang');
      langWire(langs);
    }
  }

  if($('terms-agree')) $('terms-agree').onclick = ()=>{
    termsAccept();
    const g = $('terms-gate');
    if(g) g.classList.add('hide');
    const then = TERMS_THEN;
    TERMS_THEN = null;
    try{ if(then) then(); }catch(e){}
  };
  for(const b of document.querySelectorAll('#terms-gate [data-doc]')){
    b.onclick = ()=>termsDraw(b.dataset.doc);
  }
  if($('d-terms')) $('d-terms').onclick = ()=>{ closeDrawer(); aboutOpen('terms'); };

  /* ---- choosing a language ----

     One row of chips, each language in its own name and its own script — the
     only label a person who cannot read the current language can still find.
     They are the same chips on the first-start page and in the menu. */
  function langButtons(cls){
    return LANGS.map(l=>'<button class="' + cls + (l.k === LANG ? ' on' : '') + '" data-lang="'
      + l.k + '" lang="' + l.k + '" dir="' + (l.rtl ? 'rtl' : 'ltr') + '" translate="no">'
      + esc(l.n) + '</button>').join('');
  }
  function langWire(box){
    box.querySelectorAll('[data-lang]').forEach(b=>{
      b.onclick = ()=>{
        const k = b.dataset.lang;
        if(k === LANG) return;
        /* A restart ends a block that is running — the clock is not carried
           across a reload — so that is asked about, never done quietly. */
        if(S.running && S.mode === 'focus'){
          askConfirm(T('Change the language now?'),
            T('The app restarts in the new language, and the block that is running ends.'),
            T('Change it'), ()=>langSet(k));
          return;
        }
        langSet(k);
      };
    });
  }
  function langRender(){
    const box = $('lang-pick');
    if(!box) return;
    box.innerHTML = langButtons('toggle lang-chip');
    langWire(box);
  }
  langRender();
