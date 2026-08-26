  /* --- quotes management UI --- */
  function renderQuotesList(){
    const chk = $('q-share');
    if(chk) chk.checked = QUOTES_SHARE;
    const lent = $('q-lent');
    if(lent){
      // Quotes on loan from the room, listed but not editable — they aren't yours.
      lent.innerHTML = SHARED_QUOTES.length
        ? '<p class="q-sec">On loan from the room</p>' + SHARED_QUOTES.map(q=>
            '<div class="q-item lent"><div class="qbody"><b>\u201c'+esc(q.t)+'\u201d</b>'
            + '<span>'+esc(q.a||'')+'</span></div></div>').join('')
        : '';
    }

    const box=$('q-list');
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

