  /* --- the packs you have bought ---

     Two switches, at two levels, because they answer different questions. The
     pack switch is "not this month"; the switch on a single line is "not this
     one, ever" — and losing the other nine to be rid of one is the reason a
     bought pack otherwise ends up switched off altogether.

     Nothing here is destructive and nothing here is a purchase: this screen
     only decides what is in the rotation. Buying is in the shop (37-embers.js),
     and a pack you own stays owned whatever you do with these. */
  function renderQuotePacks(){
    const box = $('q-packs');
    if(!box) return;
    /* The built-ins first and always. They are the twenty everybody has, they
       were the one set with no way to turn anything off, and listing them here
       makes that one question — "do I want to keep seeing this line?" — the
       same question wherever the line came from. */
    const bought = QPACKS.filter(p=>qpackOwned(p.id));
    const mine = [qpackBase()].concat(bought);
    /* Said once, plainly, under the list rather than instead of it: a screen
       called Quote bank with no mention of packs is how somebody who owns none
       never learns they exist. */
    const sell = bought.length ? ''
      : '<div class="q-empty">' + esc(T('Quote packs are in the shop, under Your focus.')) + '</div>';
    box.innerHTML = '<p class="q-sec">' + esc(T('Packs')) + '</p>' + mine.map(p=>{
      const on = qpackOn(p.id);
      return '<details class="q-pack' + (on ? ' on' : '') + '">'
        + '<summary>'
        + '<span class="q-pack-name"><b>' + esc(T(p.name)) + '</b>'
        /* A bare fraction rather than a sentence: it needs no translating and
           it answers "how many of these am I still showing" at a glance. */
        + '<em>' + qpackLive(p) + '/' + p.quotes.length + '</em></span>'
        + '<span class="toggle' + (on ? ' on' : '') + '" data-pack-on="' + esc(p.id) + '">'
        + '<span class="dot"></span>' + esc(on ? T('On') : T('Off')) + '</span>'
        + '</summary>'
        + '<div class="q-pack-list" translate="no">' + p.quotes.map(q=>{
            const qon = qpackQuoteOn(q);
            return '<button class="q-item q-pick' + (qon ? '' : ' off') + '"'
              + ' data-pack-q="' + esc(qpQuoteId(q)) + '">'
              + '<span class="qbody"><b>“' + esc(q.t) + '”</b>'
              + (q.a ? '<span>' + esc(q.a) + '</span>' : '') + '</span>'
              + '<span class="q-tick"></span></button>';
          }).join('') + '</div>'
        + '</details>';
    }).join('') + sell;

    box.querySelectorAll('[data-pack-on]').forEach(el=>{
      el.onclick = (e)=>{
        /* Inside a <summary>, so the click would also open or close the fold.
           Toggling the pack and folding it away in the same tap is two answers
           to one question. */
        e.preventDefault(); e.stopPropagation();
        const id = el.dataset.packOn;
        qpackSet(id, !qpackOn(id));
        renderQuotePacks();
        try{ Embers.render(); }catch(err){}
      };
    });
    box.querySelectorAll('[data-pack-q]').forEach(el=>{
      el.onclick = ()=>{
        const q = qpackFindQuote(el.dataset.packQ);
        if(!q) return;
        qpackQuoteSet(q, !qpackQuoteOn(q));
        renderQuotePacks();
      };
    });
  }

  /* --- quotes management UI --- */
  function renderQuotesList(){
    try{ renderQuotePacks(); }catch(e){}
    const chk = $('q-share');
    if(chk) chk.checked = QUOTES_SHARE;
    const lent = $('q-lent');
    if(lent){
      // Quotes on loan from the room, listed but not editable — they aren't yours.
      /* The same drawer as everything else on this page. It is still not
         editable — these belong to whoever is in the room — but a heading with
         a dozen lines under it was the one thing left pushing the page down. */
      lent.innerHTML = SHARED_QUOTES.length
        ? '<details class="q-pack"><summary><span class="q-pack-name">'
          + '<b>' + esc(T('On loan from the room')) + '</b>'
          + '<em>' + SHARED_QUOTES.length + '</em></span></summary>'
          + '<div class="q-pack-list" translate="no">' + SHARED_QUOTES.map(q=>
            '<div class="q-item lent"><div class="qbody"><b>\u201c'+esc(q.t)+'\u201d</b>'
            + '<span>'+esc(q.a||'')+'</span></div></div>').join('')
          + '</div></details>'
        : '';
    }

    const box=$('q-list');
    /* The number on the front of the drawer, so a closed one still says how
       much is in it. */
    const n = $('q-mine-n');
    if(n) n.textContent = String(CUSTOM_QUOTES.length);
    if(!CUSTOM_QUOTES.length){ box.innerHTML='<div class="q-empty">No custom quotes yet. The built-in classics still show while you focus.</div>'; return; }
    box.innerHTML='';
    CUSTOM_QUOTES.forEach((q,i)=>{
      const d=document.createElement('div'); d.className='q-item';
      d.innerHTML='<div class="qbody"><b>\u201c'+esc(q.t)+'\u201d</b>'+(q.a?'<span>'+esc(q.a)+'</span>':'')+'</div>';
      const del=document.createElement('button'); del.className='q-del'; del.textContent='\u00d7'; del.setAttribute('aria-label','Delete quote');
      /* Deleted by id, not by position: the id is what travels to the account,
         and without one the quote comes back on the next merge. */
      del.onclick=()=>{ tombstone(q.id || quoteId(q)); CUSTOM_QUOTES.splice(i,1);
                        saveQuotes(); quotesBroadcast(); renderQuotesList(); };
      d.appendChild(del); box.appendChild(d);
    });
  }
  function openQuotes(){ $('quotes-overlay').classList.remove('hide'); renderQuotesList(); }
  function toggleQuoteShare(){
    QUOTES_SHARE = !!$('q-share').checked;
    saveQuoteShare();
    quotesBroadcast();          // take effect now, not at the next session
    renderQuotesList();
  }
  function closeQuotes(){ $('quotes-overlay').classList.add('hide'); }
  function addQuote(){
    const t=$('q-text').value.trim(); if(!t){ $('q-text').focus(); return; }
    const q = quoteNorm({t, a:$('q-author').value.trim(), at:Date.now()});
    /* Typing back a quote you deleted is asking for it again, so its tombstone
       goes with it - otherwise the next sync takes it away a second time. */
    if(q){
      const i = GONE.indexOf(q.id);
      if(i >= 0){ GONE.splice(i, 1); try{ saveGone(); }catch(e){} }
      if(!CUSTOM_QUOTES.some(x=>x.id === q.id)) CUSTOM_QUOTES.push(q);
    }
    saveQuotes(); quotesBroadcast();
    $('q-text').value=''; $('q-author').value=''; renderQuotesList();
  }

