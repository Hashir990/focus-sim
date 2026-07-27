  /* ---------- celebration ----------
     One shared burst used by every game. Sorts after 09-arcade-core so the games
     (10+) can all call celebrate(). Silently does nothing if the user has asked
     for reduced motion, or if canvas is unavailable. */
  let confettiEl = null, confettiRAF = 0;

  function prefersReducedMotion(){
    try{ return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch(e){ return false; }
  }

  function celebrate(opts){
    opts = opts || {};
    if(prefersReducedMotion()) return;
    try{
      if(!confettiEl){
        confettiEl = document.createElement('canvas');
        confettiEl.className = 'confetti';
        confettiEl.setAttribute('aria-hidden','true');
        document.body.appendChild(confettiEl);
      }
      const cv = confettiEl, ctx = cv.getContext('2d');
      if(!ctx) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = window.innerWidth, H = window.innerHeight;
      cv.width = W*dpr; cv.height = H*dpr;
      cv.style.width = W+'px'; cv.style.height = H+'px';
      ctx.setTransform(dpr,0,0,dpr,0,0);

      // Read the accent from whichever menu is open, so the confetti matches it.
      const src = document.querySelector('.overlay:not(.hide)') || document.documentElement;
      const accent = (getComputedStyle(src).getPropertyValue('--accent') || '').trim() || '#8aa2f0';
      const palette = [accent, '#f2a765', '#4fe0c8', '#e7ecf6', '#8aa2f0'];

      const n = opts.count || 100;
      const cx = W/2, cy = H * (opts.originY || 0.36);
      const parts = [];
      for(let i=0;i<n;i++){
        const a = Math.random()*Math.PI*2;
        const sp = 2 + Math.random()*6.5;
        parts.push({
          x: cx + (Math.random()-0.5)*70,
          y: cy + (Math.random()-0.5)*40,
          vx: Math.cos(a)*sp,
          vy: Math.sin(a)*sp - 3.2,
          w: 4 + Math.random()*5,
          h: 6 + Math.random()*9,
          rot: Math.random()*Math.PI,
          vr: (Math.random()-0.5)*0.32,
          c: palette[Math.random()*palette.length|0],
          life: 0,
          max: 72 + Math.random()*54
        });
      }

      cancelAnimationFrame(confettiRAF);
      const step = ()=>{
        ctx.clearRect(0,0,W,H);
        let alive = 0;
        for(const p of parts){
          p.life++;
          if(p.life > p.max) continue;
          alive++;
          p.vy += 0.17; p.vx *= 0.995;
          p.x += p.vx; p.y += p.vy; p.rot += p.vr;
          ctx.save();
          ctx.globalAlpha = Math.max(0, 1 - p.life/p.max);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.c;
          ctx.fillRect(-p.w/2, -p.h/2, p.w, p.h);
          ctx.restore();
        }
        if(alive) confettiRAF = requestAnimationFrame(step);
        else ctx.clearRect(0,0,W,H);
      };
      confettiRAF = requestAnimationFrame(step);
    }catch(e){}
  }

  /** Reveal a win banner with a little pop, and fire the confetti. */
  function showBanner(id, title, sub, opts){
    const bn = $(id);
    if(!bn) return;
    if(title != null){ const h = bn.querySelector('h3'); if(h) h.textContent = title; }
    if(sub != null){ const p = bn.querySelector('p'); if(p) p.textContent = sub; }
    bn.classList.remove('hide');
    bn.classList.remove('pop');
    void bn.offsetWidth;          // restart the animation
    bn.classList.add('pop');
    celebrate(opts);
  }

