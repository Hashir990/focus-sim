  /* --- quotes management UI --- */
  function renderQuotesList(){
    const box=$('q-list');
    if(!CUSTOM_QUOTES.length){ box.innerHTML='<div class="q-empty">No custom quotes yet. The built-in classics still show while you focus.</div>'; return; }
    box.innerHTML='';
    CUSTOM_QUOTES.forEach((q,i)=>{
      const d=document.createElement('div'); d.className='q-item';
      d.innerHTML='<div class="qbody"><b>\u201c'+esc(q.t)+'\u201d</b>'+(q.a?'<span>'+esc(q.a)+'</span>':'')+'</div>';
      const del=document.createElement('button'); del.className='q-del'; del.textContent='\u00d7'; del.setAttribute('aria-label','Delete quote');
      del.onclick=()=>{ CUSTOM_QUOTES.splice(i,1); saveQuotes(); renderQuotesList(); };
      d.appendChild(del); box.appendChild(d);
    });
  }
  function openQuotes(){ $('quotes-overlay').classList.remove('hide'); renderQuotesList(); }
  function closeQuotes(){ $('quotes-overlay').classList.add('hide'); }
  function addQuote(){
    const t=$('q-text').value.trim(); if(!t){ $('q-text').focus(); return; }
    CUSTOM_QUOTES.push({t, a:$('q-author').value.trim()}); saveQuotes();
    $('q-text').value=''; $('q-author').value=''; renderQuotesList();
  }

