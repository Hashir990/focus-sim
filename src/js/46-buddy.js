  /* ---------------- your buddy ----------------
     A small person who stands next to your name. Stubs for hands and feet, a
     round body, and a face — quirky rather than pretty, because the point is
     that it is *yours* and recognisable across a room, not that it is a good
     drawing.

     Drawn from parts rather than stored as an image: five choices, each an
     index into a list here, so a buddy is about forty bytes. That matters more
     than it sounds — it travels in the `hello` that opens every peer
     connection, so it has to be small enough that nobody notices it going.

     **The parts are indexes, not names.** `{b:2,c:5,e:1,h:3,a:0}` survives a
     rename of anything in these tables, and an index that no longer exists
     falls back to the first rather than drawing nothing. Somebody else's buddy
     is drawn by *their* numbers against *our* tables, so the two copies have to
     agree — which is the usual reason to never reorder a list like this.

     *These lists were rebuilt once, deliberately, and that is the last time.*
     Four of the five accessories were a white bar, a floating dot, a thin white
     rectangle, and a path with `fill:none` and no stroke colour — which draws
     nothing at all, an option that was literally invisible. They are gone and
     the numbers moved with them, so a buddy made before that changed clothes
     once. From here: **add to the end, never insert, never remove.**

     Every part carries the box its icon is cropped from. The picker draws the
     *thing* — a crown, a tie — and not a whole buddy wearing it, because at
     30px a whole buddy is a blob with a speck on top. */

  const BUD_SKIN = ['#f5c9a4', '#e0a877', '#c98a5b', '#a4693f', '#7d4a2a', '#5c3520',
                    '#b7d6c0', '#c9b7e8', '#9fd0e8', '#f2b8cf'];
  const BUD_BODY = ['#4fe0c8', '#f7bd52', '#ff7a3c', '#8fd977', '#ff8fd0', '#c3cede',
                    '#7fb2d9', '#e01b24', '#b78cff', '#2f9fd0'];

  /* ---------------- colour, and how a part takes one ----------------

     **Every part can be dyed, and no part had to be rewritten for it.** The
     obvious way is a token in each drawing — `%A%` for the main colour, `%B%`
     for the shade — and it means editing thirty hand-tuned paths and getting
     the shading right twice. This does it from the outside instead: the colours
     already in a drawing are read off it, and each one is moved onto the chosen
     hue *keeping the lightness it had*.

     That is what makes it safe. A hoodie's drawstrings are near-white and stay
     near-white when the hoodie turns red; a puffer's seams stay a shade darker
     than its panels; the jester's bells stay pale gold-ish against whatever the
     cap becomes. The drawing keeps its own internal contrast, which is the part
     that took the work, and only the hue moves.

     **Index 0 is "as it was made" and returns the string untouched**, so
     everything anybody is already wearing is byte-identical to before this
     existed, and there is a check that says so.

     The base is the *first* colour in the drawing rather than the commonest,
     because these are written back to front — the big shape first, the trim
     after — so the first fill is the garment and the rest are its details. Both
     layers of a coat are read together for that, or a cape's lining would pick
     a different base from its back and the two would drift apart. */
  const BUD_TINT = ['', '#e01b24', '#ff7a3c', '#f7bd52', '#8fd977', '#3f8a4a',
                    '#4fe0c8', '#4f9ee0', '#2438a8', '#b78cff', '#ff8fd0',
                    '#8a6a4a', '#e9edf5', '#3a4150'];

  /* **Hair gets its own, shorter list.** Thirteen bright dyes on hair is
     thirteen wigs: the greens and the teals read as a costume rather than as
     hair, and the detail in a style — the parting, the band round a bun — was
     disappearing into them because it is a shade of the base rather than a
     separate colour. These are the shades hair comes in, plus two it obviously
     does not, and they are dyed with more contrast than everything else (see
     `budPart`) so the detail survives being pale. */
  const BUD_HAIR_TINT = ['', '#20242e', '#3a2a1c', '#5c3a24', '#8a5a2c',
                         '#a8642c', '#c9a24a', '#e6d8b0', '#b8bcc6',
                         '#8a5fd8', '#4f9ee0'];

  /* The ink his eyes are drawn in. Index 0 is the near-black they have always
     been; everything else is somebody deciding their buddy has blue eyes. */
  const BUD_INK = ['#20242e', '#2f6fd0', '#1f8f6a', '#8a5fd8', '#c0182b',
                   '#8a5a2c', '#e0a800', '#e9edf5'];

  /* How big, as an adjustment rather than another eight drawings of everything.
     Scaled about the point between them, so both stay where they belong on the
     face and only their size changes. */
  const BUD_EYE_SIZE = [1, 1.2, 0.82];

  function budHex(h){
    h = String(h || '').replace('#', '');
    if(h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [128, 128, 128];
  }
  function budHexOf(rgb){
    return '#' + rgb.map(v=>Math.max(0, Math.min(255, Math.round(v)))
      .toString(16).padStart(2, '0')).join('');
  }
  /** Perceived lightness, 0..1. Weighted, because a pure blue and a pure yellow
      of the same number are nothing like the same brightness. */
  function budLum(hex){
    const [r, g, b] = budHex(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }
  /** The colour, moved `d` of the way towards white (d>0) or black (d<0). */
  function budShade(hex, d){
    const rgb = budHex(hex);
    const to = d >= 0 ? 255 : 0;
    const k = Math.min(1, Math.abs(d));
    return budHexOf(rgb.map(v=>v + (to - v) * k));
  }
  /** The map from a drawing's own colours onto a chosen one.

      `keep` is the handful of hexes that are not the garment — a party hat's
      yellow bands, its pompom. They are left out of the map entirely, which
      also keeps them out of the base lightness: if the first colour found were
      a stripe, every other shade would be measured against a stripe. */
  function budDyeMap(str, tint, boost, keep){
    const skip = {};
    for(const h of (keep || [])) skip[String(h).toLowerCase()] = 1;
    const found = String(str || '').match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}\b/g) || [];
    if(!found.length) return null;
    const seen = [];
    for(const h of found){
      const k = h.toLowerCase();
      if(skip[k]) continue;
      if(seen.indexOf(k) < 0) seen.push(k);
    }
    if(!seen.length) return null;
    const base = budLum(seen[0]);
    const map = {};
    for(const c of seen){
      const d = budLum(c) - base;
      /* A little more than the difference it had: two colours a hair apart on a
         dark garment are a hair apart on a pale one, and the detail disappears.
         1.35 keeps a seam visible without turning a shade into a stripe — and
         hair asks for more, because its detail *is* the shading. */
      map[c] = budShade(tint, d * (boost || 1.35));
    }
    return map;
  }
  /** Recolour one part. `both` is everything the part draws, across its layers,
      so the base colour is decided once for the whole garment. */
  function budDye(str, i, both, pal, boost, keep){
    pal = pal || BUD_TINT;
    if(!str || !(i > 0) || !pal[i]) return str || '';
    const map = budDyeMap(both || str, pal[i], boost, keep);
    if(!map) return str;
    /* Anything in `keep` never reached the map, so it falls through unchanged. */
    return str.replace(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}\b/g,
      m=>map[m.toLowerCase()] || m);
  }
  /** Both layers of a part, dyed together. Returns `{b, s}`.

      **Not everything may be dyed, and that is a judgement rather than an
      oversight.** A crown that is not gold is a hat; an astronaut's helmet in
      pink is a novelty; a hi-vis vest in navy is the one thing a hi-vis vest
      cannot be. The parts carrying `dye:1` are the plain ones — the caps, the
      ties, the coats — and the rest keep the colours they were drawn in. */
  function budPart(part, i, pal, boost){
    if(!part) return {b:'', nk:'', s:''};
    if(!part.dye) return {b: part.b || '', nk: part.nk || '', s: part.s || ''};
    /* All three layers are dyed against the *whole* drawing, so the darkest hex
       in a strap maps to the same shade whether it happens to live in `n` or in
       `s`. Splitting a part between layers must not change its colours. */
    const all = (part.b || '') + (part.nk || '') + (part.s || '');
    return {b: budDye(part.b || '', i, all, pal, boost, part.keep),
            nk: budDye(part.nk || '', i, all, pal, boost, part.keep),
            s: budDye(part.s || '', i, all, pal, boost, part.keep)};
  }
  /** Which palette a row is dyed from, and how hard. */
  function budPal(k){ return k === 'r' ? BUD_HAIR_TINT : BUD_TINT; }
  function budBoost(k){ return k === 'r' ? 2.1 : 1.35; }

  /* ---------------- hair ----------------
     Its own row rather than more hats, because you wear both: a cap over a
     ponytail is the commonest thing there is, and one list would have made them
     alternatives. Drawn *after* the skull and *before* the hat, so a hat sits on
     it; the styles that fall past the shoulders put that half in `b`, behind
     him, the same trick the hoodie's hood uses.

     The skull is a circle at (32,27) with r=16, so its crown is y=11 and its
     sides are x=16 and x=48. Every cap of hair here is drawn on r=15.85 — a
     seventh of a unit inside it — because a hairline exactly on the edge leaves
     a rim of skin showing wherever the antialiasing rounds the other way.

     **Two rules learned by rendering it:**

     *Down past the widest point, or there is skin at the corners.* The first
     version's arc ran from (16.2,27) to (47.8,27) — the exact equator of the
     skull — so at each end the hair stopped dead while the head carried on
     curving out from under it, and what showed was two crescents of scalp
     either side. The arcs end at y=31 now, below the widest point, so the hair
     wraps the corner the way hair does.

     *And short of the brow, or he has no forehead.* The fringes came down to
     y=26, which is a unit above his eyes. Nothing here goes below y=23.5 in the
     middle: about a third of the face left bare, which is what reads as a
     hairline rather than as a hat. */
  const BUD_HAIR = [
    {n:'Bare', s:'', box:'0 0 24 24', none:1},
    /* Swept over from a parting on his right: the long side falls to the brow
       and the short side tucks behind the corner. */
    {n:'Side part', dye:1, s:'<path d="M15.72 29A16.4 16.4 0 1 1 48.28 29q-2.5 1.5-5.4.4-3.4-6.8-10.88-7.4-7.5.2-11 5.8-1.9 2.4-5.28 1.2z" fill="#5c3a24"/>'
       + '<path d="M32 22q8.8.6 10.88 7.4 2.9-1.1 5.4-.4-1.7-9.8-16.28-10.8z" fill="#46291a"/>', box:'13 9 38 23'},
    /* A crown of curls. The circles overlap the arc rather than sitting on it,
       so the outline is lumpy all the way round instead of being a dome with
       bumps stuck to the top. */
    {n:'Curls', dye:1, s:'<path d="M15.72 29A16.4 16.4 0 1 1 48.28 29q-3 1.4-5.6-.6-4.4-4.8-10.68-4.8t-10.68 4.8q-2.6 2-5.6.6z" fill="#3a2a1c"/>'
       + '<circle cx="19" cy="20.4" r="5.2" fill="#3a2a1c"/><circle cx="25.2" cy="12.6" r="5.8" fill="#3a2a1c"/>'
       + '<circle cx="34.6" cy="11.6" r="6" fill="#3a2a1c"/><circle cx="43" cy="16.6" r="5.4" fill="#3a2a1c"/>'
       + '<circle cx="45.6" cy="22.8" r="4.4" fill="#3a2a1c"/>'
       + '<circle cx="24.4" cy="15.4" r="2.1" fill="#63492f" opacity=".85"/>'
       + '<circle cx="36.6" cy="14.2" r="2.3" fill="#63492f" opacity=".85"/>', box:'12 4 40 28'},
    /* Gathered at the back, so the tail comes off the side of the skull rather
       than out of the middle of it. */
    /* **No parting line across the front.** A stroke drawn where hair scraped
       back would part reads as a scratch on a face this size — there are four
       pixels between the hairline and the brow at the size he is usually drawn,
       and a line in them is a mark, not a detail. The shape says it instead:
       the hairline is swept up to y=18.7 in the middle, which is where hair
       pulled back off the face actually sits, and leaves a real forehead. */
    {n:'Ponytail', dye:1, s:'<path d="M15.6 27A16.4 16.4 0 1 1 48.4 27q-5.4.6-9-4.6-7.4-7.4-14.8 0-3.6 5.2-9 4.6z" fill="#8a5a2c"/>',
     b:'<path d="M45.8 22.4q10.2 3.8 10.4 13.6.2 6.6-4.6 10.2 1.8-7-1-12.8-2.4-4.8-7.8-7z" fill="#8a5a2c"/>'
       + '<path d="M43.6 23.2q3.9 1 6.4 3.2-1.4 2.6-4.8 2.6-2.8-2.8-1.6-5.8z" fill="#6f4520"/>', box:'12 8 46 40'},
    /* Up and off the neck entirely. The band is what stops it reading as a
       balloon on a stick. */
    {n:'Top bun', dye:1, s:'<path d="M15.6 27A16.4 16.4 0 1 1 48.4 27Q32 18 15.6 27z" fill="#2f2a3a"/>'
       + '<path d="M21.6 24.6q10.4-4.4 20.8 0" stroke="#544a6b" stroke-width="1" fill="none" opacity=".65"/>'
       + '<circle cx="32" cy="6.2" r="5.4" fill="#2f2a3a"/>'
       + '<path d="M27.8 10.6q4.2 1.9 8.4 0v2.3q-4.2 1.9-8.4 0z" fill="#544a6b"/>', box:'13 0 38 32'},
    /* Past the shoulders on both sides, with a centre parting so the brow is
       not covered by the join. */
    {n:'Long', dye:1, s:'<path d="M15.72 29A16.4 16.4 0 1 1 48.28 29q-4.2 1.2-7.3-2.6-4.5-5.6-8.98-5.4-4.48-.2-8.98 5.4-3.1 3.8-7.3 2.6z" fill="#c9a24a"/>'
       + '<path d="M32 21q-5.2 2.4-8.2 8.2M32 21q5.2 2.4 8.2 8.2" stroke="#9c7a26" stroke-width="1.1" fill="none" stroke-linecap="round" opacity=".8"/>',
     b:'<path d="M16.3 23.1q-4.4 12.2-2.4 25.8 4.8 1.6 8.6.6-3.2-13-.4-25.4z" fill="#c9a24a"/>'
       + '<path d="M47.7 23.1q4.4 12.2 2.4 25.8-4.8 1.6-8.6.6 3.2-13 .4-25.4z" fill="#c9a24a"/>'
       + '<path d="M17.3 26.9q-2.2 10.2-1 20M46.7 26.9q2.2 10.2 1 20" stroke="#9c7a26" stroke-width="1.3" fill="none" stroke-linecap="round"/>', box:'11 8 42 44'},

    /* ---- the second set ----

       **A hairstyle at this size is its outline.** The first attempt at these
       was Cropped, Bob, Quiff and Braids: four sensible haircuts that, blurred
       down to forty pixels, were four slightly different domes. If you cannot
       name it from the silhouette alone it is not a style here, it is shading.

       So each of these is one idea you could recognise as a black shape """ + D + """ a
       fin, two orbs, a bowl, a halo, two bunches out at the sides. They still
       keep the rules the first set set: the sides wrap past the widest point of
       the head so no crescent of scalp shows at the corners, and nothing
       crosses y=23.5 in the middle, which is what leaves a forehead rather than
       a hat.

       **And a third rule, which all five of these broke.** Every one was drawn
       on its own circle rather than on the skull's, so each crown landed one to
       three units *below* y=11 and every head wore a crescent of bare scalp on
       top. It is invisible in a list of hairstyles and obvious the moment one
       is on a face. `tools/look-hair.mjs` draws the row over the skull with the
       crown, brow and equator marked; a style whose own crown sits under the
       red line is wrong, whatever it looks like on its own. Caps use the
       skull's arc verbatim — `M15.72 29A16.4 16.4 0 1 1 48.28 29` — and
       anything that stands off the head is measured from y=11, not from
       wherever the shape happened to look balanced. */

    /* A straight line all the way round, which is the whole joke. The fringe is
       flat and the sides drop past the corner of the head, so the outline is a
       bowl and reads as one instantly. */
    {n:'Bowl cut', dye:1, s:'<path d="M15.72 29A16.4 16.4 0 1 1 48.28 29l-.9 2.6q-2.2-7.6-7.4-8.3H24q-5.2.7-7.4 8.3z" fill="#3b2a1b"/>'
       + '<path d="M21.6 15.6q10.4-4.8 20.8 0" stroke="#54402c" stroke-width="1.4" fill="none" opacity=".5" stroke-linecap="round"/>', box:'13 9 38 24'},

    /* A fin, and nothing else. The sides are not bare """ + D + """ they are stubble, two
       faint arcs following the skull, which is what stops the head reading as
       *bald with a thing on it*. */
    {n:'Mohawk', dye:1, s:'<path d="M17.2 26.4a15 15 0 0 1 6.6-11" stroke="#2a1f17" stroke-width="3" fill="none" opacity=".42" stroke-linecap="round"/>'
       + '<path d="M46.8 26.4a15 15 0 0 0-6.6-11" stroke="#2a1f17" stroke-width="3" fill="none" opacity=".42" stroke-linecap="round"/>'
       + '<path d="M24 15.8q-.9-7 2.6-11.2L27.4 1.8 29 5.2 30.6.6 32.2 4.4 33.8 1.2 35.2 5 36.6 2.2 37.4 4.6q3.5 4.2 2.6 11.2-3.7 3.6-8 3.6t-8-3.6z" fill="#2a1f17"/>'
       + '<path d="M29.6 5.4 30.6 1l1.2 4.2M33.6 5.6 34.6 2l1 3.4" fill="#463327" opacity=".7"/>', box:'15 0 34 30'},

    /* Two orbs on top. They sit high and wide apart, so the outline is three
       circles and could not be anything else. */
    {n:'Space buns', dye:1, s:'<path d="M15.72 29A16.4 16.4 0 1 1 48.28 29q-2.8 1.5-5.1-.4-3.3-4.6-11.18-4.6t-11.18 4.6q-2.3 1.9-5.1.4z" fill="#2f2438"/>'
       + '<circle cx="20.4" cy="8.2" r="6.4" fill="#2f2438"/><circle cx="43.6" cy="8.2" r="6.4" fill="#2f2438"/>'
       + '<path d="M16.2 12.4q4.2 2.3 8.4 0v2.7q-4.2 2.3-8.4 0z" fill="#574566"/>'
       + '<path d="M39.4 12.4q4.2 2.3 8.4 0v2.7q-4.2 2.3-8.4 0z" fill="#574566"/>'
       + '<circle cx="18.4" cy="5.8" r="1.7" fill="#574566" opacity=".8"/>'
       + '<circle cx="41.6" cy="5.8" r="1.7" fill="#574566" opacity=".8"/>', box:'12 0 40 32'},

    /* A halo, and it has to be *wide* """ + D + """ the shape is the whole point, and an afro
       that only clears the head by a few pixels is a hat. The circles set into
       its edge keep the outline uneven the whole way round; a smooth one reads
       as a helmet. */
    {n:'Afro', dye:1, s:'<path d="M32 .8q17.8 0 20.4 15.4 1.4 8.4-3.4 13.8-3.6-1.4-5.8-4.6-4.2-5.6-11.2-5.6t-11.2 5.6q-2.2 3.2-5.8 4.6-4.8-5.4-3.4-13.8Q14.2.8 32 .8z" fill="#241a12"/>'
       + '<circle cx="13.4" cy="17.6" r="7" fill="#241a12"/><circle cx="50.6" cy="17.6" r="7" fill="#241a12"/>'
       + '<circle cx="19.2" cy="6.6" r="6.6" fill="#241a12"/><circle cx="44.8" cy="6.6" r="6.6" fill="#241a12"/>'
       + '<circle cx="32" cy="2.6" r="7.2" fill="#241a12"/>'
       + '<circle cx="24.8" cy="9.4" r="2.6" fill="#4c3624" opacity=".8"/>'
       + '<circle cx="39.6" cy="8" r="2.8" fill="#4c3624" opacity=".8"/>'
       + '<circle cx="16.6" cy="19.4" r="2.2" fill="#4c3624" opacity=".65"/>', box:'5 -6 54 40'},

    /* Two bunches, out past the ears rather than down the back """ + D + """ which is what
       makes this a different shape from the ponytail and not a second one. */
    {n:'Pigtails', dye:1, s:'<path d="M15.72 29A16.4 16.4 0 1 1 48.28 29q-3.2 1.3-6.3-1.5-3.4-4.7-9.98-4.7t-9.98 4.7Q18.92 30.3 15.72 29z" fill="#7a4a22"/>'
       + '<path d="M32 22.4V12" stroke="#5a3414" stroke-width="1.1" fill="none" opacity=".6" stroke-linecap="round"/>',
     b:'<ellipse cx="11.4" cy="25.4" rx="7" ry="7.8" fill="#7a4a22"/>'
       + '<ellipse cx="52.6" cy="25.4" rx="7" ry="7.8" fill="#7a4a22"/>'
       + '<path d="M16.6 20.6q4 1.2 4 5-3.6 1.6-6.2-1z" fill="#5a3414"/>'
       + '<path d="M47.4 20.6q-4 1.2-4 5 3.6 1.6 6.2-1z" fill="#5a3414"/>'
       + '<path d="M8 22.6q3.4 3.2 3 7.6M56 22.6q-3.4 3.2-3 7.6" stroke="#5a3414" stroke-width="1.2" fill="none" opacity=".7" stroke-linecap="round"/>', box:'3 8 58 28'},
  ];

  /* A dash, for the "none" options. Drawn rather than typed so the row is all
     one kind of thing — a lone character among pictures reads as a mistake. */
  const BUD_NONE = '<path d="M4 12h16" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" fill="none" opacity=".5"/>';

  /* Eyes carry nearly all of the character, so there are more of these than of
     anything else and none of them is "normal". */
  const BUD_EYES = [
    {n:'Beady', s:'<circle cx="26" cy="30" r="3.2"/><circle cx="38" cy="30" r="3.2"/>', box:'20 24 24 12'},
    {n:'Bright', s:'<circle cx="26" cy="30" r="4.4"/><circle cx="38" cy="30" r="4.4"/>'
       + '<circle cx="27.4" cy="28.6" r="1.5" fill="#fff"/><circle cx="39.4" cy="28.6" r="1.5" fill="#fff"/>',
     box:'20 24 24 12'},
    {n:'Shut', s:'<path d="M22 30h8M34 30h8" stroke-width="3" stroke-linecap="round" fill="none"/>', box:'20 24 24 12'},
    {n:'Sidelong', s:'<circle cx="26" cy="30" r="3"/><path d="M34 31l8-3" stroke-width="3" stroke-linecap="round" fill="none"/>',
     box:'20 24 24 12'},
    {n:'Mismatched', s:'<circle cx="25" cy="31" r="4.6"/><circle cx="39" cy="29" r="2.6"/>', box:'19 24 25 13'},
    {n:'Crossed', s:'<path d="M22 27l7 4-7 4M42 27l-7 4 7 4" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
     box:'20 25 24 12'},
    {n:'Pixel', s:'<rect x="21" y="26" width="10" height="8" rx="2"/><rect x="33" y="26" width="10" height="8" rx="2"/>',
     box:'19 24 26 12'},
    {n:'Content', s:'<path d="M22 33a4.5 4.5 0 0 1 9 0M33 33a4.5 4.5 0 0 1 9 0" stroke-width="2.8" fill="none" stroke-linecap="round"/>',
     box:'20 28 24 9'},
    /* **Five more, and none of them is another pair of dots.** The eyes carry
       the character, so each of these is a different *expression* rather than a
       different shape: half-asleep, delighted, in on the joke, smitten, and not
       having it. All of them inherit their colour from the group they sit in,
       so the ink dial recolours every one — the whites are the only literal. */
    // sleepy: a lid over each, and only the bottom half of the eye under it
    {n:'Sleepy', s:'<path d="M21.6 29.4h8.8M33.6 29.4h8.8" stroke-width="2.2" stroke-linecap="round" fill="none"/>'
       + '<path d="M22.4 30.2a3.6 3.6 0 0 0 7.2 0z"/><path d="M34.4 30.2a3.6 3.6 0 0 0 7.2 0z"/>',
     box:'20 26 24 10'},
    // starry
    {n:'Starry', s:'<path d="M26 25.4q1.2 3.4 4.6 4.6-3.4 1.2-4.6 4.6-1.2-3.4-4.6-4.6 3.4-1.2 4.6-4.6z"/>'
       + '<path d="M38 25.4q1.2 3.4 4.6 4.6-3.4 1.2-4.6 4.6-1.2-3.4-4.6-4.6 3.4-1.2 4.6-4.6z"/>',
     box:'20 24 24 13'},
    // wink
    {n:'Wink', s:'<circle cx="26" cy="30" r="4.2"/><circle cx="27.3" cy="28.7" r="1.4" fill="#fff"/>'
       + '<path d="M33.8 31.6q4.2-4.2 8.4 0" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
     box:'20 24 24 12'},
    // smitten
    {n:'Smitten', s:'<path d="M26 34.4q-5-3.2-5-5.8a2.6 2.6 0 0 1 5-1.1 2.6 2.6 0 0 1 5 1.1q0 2.6-5 5.8z"/>'
       + '<path d="M38 34.4q-5-3.2-5-5.8a2.6 2.6 0 0 1 5-1.1 2.6 2.6 0 0 1 5 1.1q0 2.6-5 5.8z"/>',
     box:'19 25 26 11'},
    // unimpressed: brows down, eyes narrowed
    {n:'Unimpressed', s:'<circle cx="26" cy="31.4" r="2.6"/><circle cx="38" cy="31.4" r="2.6"/>'
       + '<path d="M21.4 25.8l7.8 2.6M42.6 25.8l-7.8 2.6" stroke-width="2.2" stroke-linecap="round" fill="none"/>',
     box:'19 24 26 12'},
  ];

  const BUD_HATS = [
    {n:'Bare', s:'', box:'0 0 24 24', none:1},
    /* **Redrawn, not replaced.** It was a red trapezoid and a 4px bar, and at
       the 26px the picker draws it the bar disappeared — what was left read as
       a slab of colour rather than as a cap. Three things fix it and none of
       them moves an index: a crown that follows the skull *exactly* (same
       centre and radius as the head, so it sits rather than hovers), a seam and
       a button so it has a top, and a bill big enough to survive being drawn at
       a quarter size. The crown's lower edge and the band's upper edge are the
       same curve — a band on a sphere dips in the middle, and a straight cut
       there left a crescent of scalp showing between the two. */
    // cap
    {n:'Ball cap', dye:1, s:'<path d="M17.6 20A16 16 0 0 1 46.4 20q-14.4 4.6-28.8 0z" fill="#e01b24"/>'
       + '<path d="M32 11.2v10.6" stroke="#a3131a" stroke-width="1.2" fill="none" opacity=".8"/>'
       + '<path d="M44.6 19.8q11.4 0 13 4.2.6 1.8-1.8 2.4-6.4 1.6-13.4-1.6z" fill="#c0182b"/>'
       + '<path d="M16.9 20q15.1 4.6 30.2 0v3.2q-15.1 4.6-30.2 0z" fill="#8f1116"/>'
       + '<circle cx="32" cy="11.6" r="1.8" fill="#8f1116"/>', box:'15 8 44 20'},
    // beanie
    {n:'Beanie', dye:1, y:-0.8, s:'<path d="M18 17c0-9 6-13 14-13s14 4 14 13z" fill="#3f8a4a"/>'
       + '<path d="M25.4 5.6q0 6-1 11.4M32 4q0 6.4 0 13M38.6 5.6q0 6 1 11.4" stroke="#357a41" stroke-width="1.1" fill="none" stroke-linecap="round"/>'
       + '<rect x="15" y="16" width="34" height="4.2" rx="2.1" fill="#2c6234"/>'
       + '<circle cx="32" cy="3.2" r="3" fill="#5ba767"/>', box:'13 -1 38 23'},
    // top hat
    {n:'Top hat', dye:1, y:-1.2, s:'<rect x="21" y="6" width="22" height="12" rx="2" fill="#2438a8"/>'
       + '<rect x="15" y="16" width="34" height="4" rx="2" fill="#16226b"/>', box:'14 5 36 17'},
    /* **Redrawn, not replaced.** Two purple peaks and nothing else: no band, no
       bells, no second tone — which at any size reads as a crown somebody sat
       on. A jester is a *skullcap with horns on it*, so it is drawn that way:
       three horns first, then the cap over their roots so they disappear under
       it instead of stopping in mid-air. They droop rather than point up:
       three spikes radiating from a skullcap is a sun, and the flop is the
       half of the silhouette that says jester, then the band, then the bells last so
       nothing covers them. The darker left half is the two-tone every jester
       has and the cheapest way to say "this is a costume, not a hat". */
    // jester
    {n:'Jester', s:'<path d="M20.5 14.5C13 15 7.5 17.5 3.6 21.8c5.6 1.6 11.6.4 18.4-3.4z" fill="#8a5fd8"/>'
       + '<path d="M43.5 14.5C51 15 56.5 17.5 60.4 21.8c-5.6 1.6-11.6.4-18.4-3.4z" fill="#8a5fd8"/>'
       + '<path d="M28 14c1-6 2.6-10 4-12 1.4 2 3 6 4 12z" fill="#8a5fd8"/>'
       + '<path d="M17.6 20A16 16 0 0 1 46.4 20q-14.4 4.6-28.8 0z" fill="#b78cff"/>'
       + '<path d="M32 11A16 16 0 0 0 17.6 20q7.2 2.3 14.4 2.3z" fill="#8a5fd8"/>'
       + '<path d="M16.9 20q15.1 4.6 30.2 0v3.2q-15.1 4.6-30.2 0z" fill="#6f47bd"/>'
       + '<circle cx="3.2" cy="22.2" r="2.7" fill="#ffd34a"/>'
       + '<circle cx="60.8" cy="22.2" r="2.7" fill="#ffd34a"/>'
       + '<circle cx="32" cy="1.6" r="2.6" fill="#ffd34a"/>', box:'0 -2 64 30'},
    /* Crown. The old one was drawn from x=19 to x=44 against a head centred on
       32 — two pixels adrift, which is exactly enough to look like a mistake
       and not enough to look deliberate. It is symmetrical about 32 now: the
       band spans 18..46 and every point mirrors. */
    // crown
    {n:'Crown', y:-1.6, s:'<path d="M18 19l-2-13 8 5 8-8 8 8 8-5-2 13z" fill="#ffd34a"/>'
       + '<rect x="17" y="18" width="30" height="3.6" rx="1.8" fill="#e0a800"/>'
       + '<circle cx="24" cy="8.5" r="1.5" fill="#e01b24"/>'
       + '<circle cx="40" cy="8.5" r="1.5" fill="#e01b24"/>'
       + '<circle cx="32" cy="4.5" r="1.8" fill="#4fe0c8"/>', box:'15 2 34 21'},
    // hair bow
    {n:'Bow', dye:1, y:-0.6, s:'<path d="M30 11q-10-8-12 0t12 4z" fill="#ff8fd0"/>'
       + '<path d="M34 11q10-8 12 0t-12 4z" fill="#ff8fd0"/>'
       + '<path d="M30 11q-7-4-9 0t9 2z" fill="#e0559f" opacity=".5"/>'
       + '<path d="M34 11q7-4 9 0t-9 2z" fill="#e0559f" opacity=".5"/>'
       + '<circle cx="32" cy="12" r="2.8" fill="#e0559f"/>', box:'16 4 32 14'},
    /* Headphones. Moved twice and wrong both times, each with a confident
       comment: first to y=27, then *down* to y=31, which put the cups level
       with his mouth. They are centred on the eyes now — y=30, the same line —
       which is where a cup sits on a face this round. Checked by rendering it
       (`tools/buddy-look.mjs`) rather than by reasoning about the geometry,
       which is what got it wrong the first two times. */
    // headphones, which is what half the people using this are wearing anyway
    /* **The band arcs over a bigger circle than the head, on purpose.** It used
       to be r=16 about (32,26) — the head's own radius, one unit above the
       skull — so it read as painted on rather than worn, and the cups sat half
       inside his cheeks. r=18.2 leaves about three units of daylight over the
       crown, and the cups have moved out until only their inner edge touches
       him, which is where a cup actually sits. */
    {n:'Headphones', dye:1, s:'<path d="M13.8 31v-4.6a18.2 18.2 0 0 1 36.4 0v4.6" stroke="#2c3340" stroke-width="3.4" fill="none" stroke-linecap="round"/>'
       + '<rect x="9.4" y="23.4" width="8.4" height="13.6" rx="4.2" fill="#2c3340"/>'
       + '<rect x="46.2" y="23.4" width="8.4" height="13.6" rx="4.2" fill="#2c3340"/>'
       + '<rect x="11.2" y="25.6" width="4.8" height="9.2" rx="2.4" fill="#4a5566"/>'
       + '<rect x="48" y="25.6" width="4.8" height="9.2" rx="2.4" fill="#4a5566"/>', box:'8 6 48 34'},
    /* Five more. A hat is the one thing on him you read from across a room, so
       these go for silhouette first — a cone, a ring, a knot, a dome — and
       detail second. Anything above y=11 is off the top of the skull and
       outside the viewBox, which is fine: the slot's SVG is `overflow:visible`
       and the jester has been hanging over the edge since the day it was
       drawn. */
    // wizard hat
    {n:'Wizard hat', y:-1, s:'<path d="M32 -3.6 46.8 20.4q-14.8 4.8-29.6 0z" fill="#4a3f8a"/>'
       + '<path d="M32 -3.6 39.4 8.4q-3.6 1.6-7.4 1.6z" fill="#3b3170" opacity=".9"/>'
       + '<path d="M16.9 19.8q15.1 4.8 30.2 0v3.4q-15.1 4.8-30.2 0z" fill="#2f2757"/>'
       + '<path d="M31 4.2l1.2 2.5 2.7.4-2 1.9.5 2.7-2.4-1.3-2.4 1.3.5-2.7-2-1.9 2.7-.4z" fill="#ffd34a"/>'
       + '<path d="M38.4 13.4l.8 1.7 1.8.3-1.3 1.3.3 1.8-1.6-.9-1.6.9.3-1.8-1.3-1.3 1.8-.3z" fill="#ffd34a"/>'
       + '<path d="M24.6 14.8l.7 1.4 1.5.2-1.1 1.1.3 1.5-1.4-.7-1.4.7.3-1.5-1.1-1.1 1.5-.2z" fill="#ffd34a" opacity=".85"/>'
       + '<path d="M33.8 .4q1.8 1.6 0 3.2-2.6-.8-1.6-2.4z" fill="#e9edf5" opacity=".9"/>'
       + '<circle cx="29.4" cy="10.6" r=".7" fill="#e9edf5" opacity=".75"/>'
       + '<circle cx="36.4" cy="6.8" r=".6" fill="#e9edf5" opacity=".7"/>',
     box:'14 -6 36 32'},
    /* Flowers, not a crown of them — five, sized down towards the ears, sitting
       on the hairline rather than floating over it. */
    // flower crown
    {n:'Flower crown', y:-2.2, s:'<path d="M17.4 24.6q4.6-11.4 14.6-11.4t14.6 11.4" stroke="#5b7a48" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
       + '<g fill="#ff8fd0"><circle cx="18.6" cy="24.2" r="2"/><circle cx="21.4" cy="21.4" r="2"/><circle cx="16.4" cy="21.6" r="2"/><circle cx="19" cy="19.2" r="2"/></g>'
       + '<circle cx="18.6" cy="21.6" r="1.5" fill="#ffd34a"/>'
       + '<g fill="#fff"><circle cx="24.6" cy="17.4" r="2.1"/><circle cx="27.8" cy="15.4" r="2.1"/><circle cx="23.2" cy="14.6" r="2.1"/><circle cx="27" cy="18.8" r="2.1"/></g>'
       + '<circle cx="25.6" cy="16.6" r="1.5" fill="#ffd34a"/>'
       + '<g fill="#b78cff"><circle cx="34.6" cy="14.6" r="2.3"/><circle cx="38.2" cy="15.8" r="2.3"/><circle cx="35" cy="18.2" r="2.3"/><circle cx="38.6" cy="12.8" r="2.3"/></g>'
       + '<circle cx="36.6" cy="15.6" r="1.6" fill="#ffd34a"/>'
       + '<g fill="#ff8fd0"><circle cx="44.4" cy="21.8" r="2"/><circle cx="46.8" cy="19.6" r="2"/><circle cx="42.4" cy="19.4" r="2"/><circle cx="45.4" cy="17.4" r="2"/></g>'
       + '<circle cx="44.8" cy="19.6" r="1.5" fill="#ffd34a"/>',
     box:'13 11 38 17'},
    /* Tied at the side, and the knot is what makes it a bandana rather than a
       swimming cap — so the knot is drawn big enough to survive 26px and the
       tails fall past the ear. */
    // bandana
    {n:'Bandana', dye:1, y:-0.8, s:'<path d="M16.6 22.8q1.6-11.8 15.4-11.8t15.4 11.8q-15.4 5-30.8 0z" fill="#c0182b"/>'
       + '<path d="M17 20.4q15 4.6 30 0" stroke="#8f1116" stroke-width="1.3" fill="none"/>'
       + '<g fill="#f2e0c4"><circle cx="23.4" cy="17.6" r="1.1"/><circle cx="31" cy="15.4" r="1.1"/><circle cx="38.6" cy="17.2" r="1.1"/><circle cx="27.2" cy="20.8" r="1.1"/><circle cx="35" cy="20.6" r="1.1"/></g>'
       + '<path d="M46.6 20.6l6.4-3-1.6 5.6 5.4 2.4-6.6 1.4.2 4.6-5.2-4.4z" fill="#c0182b"/>'
       + '<path d="M47.4 24.2q3.4.4 6.6-.6-2.8 2-6.4 2.2z" fill="#8f1116"/>',
     box:'14 9 46 26'},
    // party cone
    /* **Perched, not pushed down over him.** Its base was at y=21, where the
       skull is 29 units wide and the cone only 25 — so it sat *inside* the
       silhouette, which reads as a hat sunk into a head. Four and a half units
       up puts the base at 16.2, where the head is 23.6 wide: the cone is
       fractionally the wider of the two and rests on top of it, which is how a
       party hat is worn and why it needs an elastic. */
    /* **The bands and the pompom are not the hat.** Dye recolours every hex in
       a drawing, which is right for a coat and wrong here: a party hat in green
       came out green-striped, and the stripes are the thing that makes it a
       party hat rather than a cone. `keep` holds them out of the map — see
       `budDyeMap`. It also means a yellow hat still has a pink pompom to read
       against, which is why the pompom is on the list too. */
    {n:'Party hat', dye:1, y:-4.6, keep:['#ffd34a', '#ff8fd0'],
     s:'<path d="M32 -1.4 44.6 20.8q-12.6 4-25.2 0z" fill="#4f9ee0"/>'
       + '<path d="M25.4 9.4q6.6 2.4 13.2 0l1.8 3.2q-8.4 2.8-16.8 0z" fill="#ffd34a"/>'
       + '<path d="M28.6 2.6q3.4 1.2 6.8 0l1.6 2.8q-5 1.6-10 0z" fill="#ffd34a"/>'
       + '<path d="M19.4 20.8q12.6 4 25.2 0v2.6q-12.6 4-25.2 0z" fill="#2f6fd0"/>'
       + '<circle cx="32" cy="-3.4" r="3.2" fill="#ff8fd0"/>',
     box:'16 -7 32 32'},
    /* A dome, and the point of a dome is that you can still see his face
       through it — so it is a fill at low opacity with a rim, not a solid.
       Wearing it with the swim is very good. */
    // space bubble
    {n:'Space helmet', s:'<circle cx="32" cy="26" r="20.4" fill="#9fd0e8" opacity=".18"/>'
       + '<circle cx="32" cy="26" r="20.4" fill="none" stroke="#9fd0e8" stroke-width="1.6" opacity=".9"/>'
       + '<path d="M19.6 15.4q5.4-4.8 12.4-5.2" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" opacity=".55"/>'
       + '<path d="M13.4 35.6q18.6 6.8 37.2 0v3.4q-18.6 6.8-37.2 0z" fill="#c3cede"/>'
       + '<path d="M44.6 10.4l4.8-5.4" stroke="#c3cede" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
       + '<circle cx="50.4" cy="3.8" r="2.2" fill="#4fe0c8"/>',
     box:'10 1 46 42'},
  ];

  /* Worn on the body. Kept apart from the face on purpose: a tie and a beard
     are not alternatives, and one list meant choosing between them. */
  const BUD_ACC = [
    {n:'Bare', s:'', box:'0 0 24 24', none:1},
    // tie
    {n:'Tie', dye:1, s:'<path d="M32 43l-3.4 2.8 3.4 2.8 3.4-2.8z" fill="#c0182b"/>'
       + '<path d="M32 48.6l-3.2 5.4 3.2 2.2 3.2-2.2z" fill="#e01b24"/>', box:'27 41 10 17'},
    // bow tie
    {n:'Bow tie', dye:1, s:'<path d="M32 46l-9-4v9z" fill="#b78cff"/><path d="M32 46l9-4v9z" fill="#b78cff"/>'
       + '<rect x="30" y="43.5" width="4" height="5" rx="1.4" fill="#8a5fd8"/>', box:'21 40 22 13'},
    /* **It has to reach both sides of him or it is a stripe, not a wrap.** This
       ran 20 to 44 across a body that runs 19 to 45, and those two units of
       body colour showing past each end were the whole difference between a
       band going round him and a band painted on him. It runs the body's full
       width now — a tenth of a unit past it at each end, so no hairline of
       teal survives the antialiasing — and it sits a little lower, on the
       widest part of him, where a belt goes. */
    // scarf, wrapped rather than a bar stuck on the neck
    {n:'Scarf', dye:1, s:'<path d="M18.9 43.4q13.1 6.6 26.2 0v5.4q-13.1 6.6-26.2 0z" fill="#f7bd52"/>'
       + '<path d="M21.4 49.4l-2.6 9.2 5.8 1.2 2-9.6z" fill="#e09b1e"/>', box:'17 41 30 21'},
    /* Five more, all of them things that hang *on* him rather than shapes laid
       over him — straps that go over the shoulder and round the curve, a cord
       that dips, a sash that follows the body's diagonal. The pill's bottom
       corners round in by nine, so nothing here goes below y=52 outside
       x 22..42, which is the rule the coats learned the hard way. */
    // backpack straps
    /* Straps come over the shoulder from behind, so they start behind him and
       appear at the collarbone — see the `n` layer in budSvg. */
    {n:'Backpack', dye:1,
     nk:'<path d="M26.8 37.4q-3.2 7.8-2.4 14.8" stroke="#5b4a3a" stroke-width="3" fill="none" stroke-linecap="round"/>'
       + '<path d="M37.2 37.4q3.2 7.8 2.4 14.8" stroke="#5b4a3a" stroke-width="3" fill="none" stroke-linecap="round"/>',
     s:'<rect x="22.1" y="47.4" width="4.6" height="2.8" rx="1" fill="#3f332a"/>'
       + '<rect x="37.3" y="47.4" width="4.6" height="2.8" rx="1" fill="#3f332a"/>',
     box:'20 40 24 15'},
    // pendant
    /* The cord runs from behind one side of the jaw to behind the other; the
       skull hides the top of the loop, so what you see is a chain coming out
       from under his chin with a stone on it. */
    {n:'Pendant', dye:1,
     nk:'<path d="M22 36q10 21 20 0" stroke="#c9b06a" stroke-width="1.3" fill="none" stroke-linecap="round"/>',
     s:'<circle cx="32" cy="47.4" r="2.9" fill="#4fe0c8"/>'
       + '<circle cx="31" cy="46.4" r="1" fill="#fff" opacity=".75"/>',
     box:'20 38 24 13'},
    // medal
    {n:'Medal',
     nk:'<path d="M24.4 36.6 30.6 48.6M39.6 36.6 33.4 48.6" stroke="#2f6fd0" stroke-width="2.8" fill="none" stroke-linecap="round"/>'
       + '<path d="M25.8 39.2 30.9 49M38.2 39.2 33.1 49" stroke="#1f4f96" stroke-width=".9" fill="none"/>',
     s:'<circle cx="32" cy="51.2" r="3.9" fill="#ffd34a"/>'
       + '<path d="M32 48.4l.8 1.7 1.85.28-1.35 1.3.33 1.85-1.63-.88-1.63.88.33-1.85-1.35-1.3 1.85-.28z" fill="#e0a800"/>',
     box:'22 38 20 18'},
    // lanyard
    {n:'Lanyard', dye:1,
     nk:'<path d="M24.6 36.2 30.4 46.8M39.4 36.2 33.6 46.8" stroke="#2f6fd0" stroke-width="2" fill="none" stroke-linecap="round"/>',
     s:'<rect x="28.4" y="46.2" width="7.2" height="5.4" rx="1.2" fill="#e9edf5"/>'
       + '<path d="M30 48h4M30 49.8h2.6" stroke="#7f8ba0" stroke-width="1" fill="none" stroke-linecap="round"/>',
     box:'22 38 20 16'},
    // sash
    /* Over one shoulder and under the jaw on that side, so the band itself
       belongs behind the head; only the rosette sits on top of it. */
    {n:'Sash', dye:1,
     nk:'<path d="M22.6 37.4q8.4 10 19 12.8-.4 1.8-1.2 3.2-11-2.6-19.6-11.6z" fill="#c92a55"/>'
       + '<path d="M23.4 39.6q7.4 8.2 16.8 10.8" stroke="#a32044" stroke-width="1" fill="none"/>',
     s:'<circle cx="40.6" cy="51.6" r="2.3" fill="#ffd34a"/>',
     box:'19 36 26 20'},
  ];

  /* Worn on the face. Facial hair, glasses and masks all live here because they
     all compete for the same square inches — you cannot have two of them, and
     you can have any of them *and* a tie. */
  const BUD_FACE = [
    {n:'Bare', s:'', box:'0 0 24 24', none:1},
    /* A beard sits under the mouth rather than over it — over it reads as a
       mistake, and the mouth is half of what makes these things quirky. */
    /* Follows the jaw and stops short of the mouth. The first one was a solid
       mass from y=36 down, which put its top edge straight through the smile —
       it read as a bib. The inner edge sits at 40 now, below the mouth curve
       (which bottoms out at 39), so the face keeps its expression. */
    // beard
    {n:'Beard', dye:1, s:'<path d="M19.5 32.5q1.5 10.5 12.5 13.5t12.5-13.5q-2.5 8-12.5 8t-12.5-8z" fill="#5c3a24"/>'
       + '<path d="M23 40.5q9 4 18 0-2.5 5-9 5t-9-5z" fill="#4a2e1c"/>', box:'17 30 30 18'},
    /* **In the gap, not on the mouth.** It was drawn at nearly the width of
       the whole face and sat across the smile, which is why it read as a
       mistake rather than as hair. There are only four units between the
       bottom of the eyes (33) and the top of the mouth (37), so it is small
       because it has to be — about a third of the width it was. */
    // moustache
    {n:'Moustache', dye:1, s:'<path d="M32 34.6q-2.8-2.2-4.8-.4t1.2 2.8 3.6-2.4z" fill="#5c3a24"/>'
       + '<path d="M32 34.6q2.8-2.2 4.8-.4t-1.2 2.8-3.6-2.4z" fill="#5c3a24"/>', box:'25 32 14 7'},
    // round glasses
    {n:'Round glasses', dye:1, s:'<circle cx="26" cy="30" r="5.5" fill="none" stroke="#2c3340" stroke-width="1.8"/>'
       + '<circle cx="38" cy="30" r="5.5" fill="none" stroke="#2c3340" stroke-width="1.8"/>'
       + '<path d="M31.5 30h1M20.5 30h-3M43.5 30h3" stroke="#2c3340" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
     box:'16 22 32 16'},
    /* Drawn last, so it covers the head, the eyes and the mouth — which is the
       point of a mask. Wearing it with a hat is allowed and looks it. */
    // spider mask
    {n:'Spider mask', s:'<circle cx="32" cy="27" r="16" fill="#c8102e"/>'
       + '<g stroke="#7d0a1c" stroke-width=".7" fill="none" opacity=".85">'
       + '<path d="M17 23q15 5 30 0M17 29q15 5 30 0M17 35q15 5 30 0"/>'
       + '<path d="M32 11v32M23 13l5 29M41 13l-5 29"/></g>'
       + '<path d="M23.5 23.5q7-3.5 8 3-1 5.5-5.5 5.5t-2.5-8.5z" fill="#fff" stroke="#1a1a1a" stroke-width=".9"/>'
       + '<path d="M40.5 23.5q-7-3.5-8 3 1 5.5 5.5 5.5t2.5-8.5z" fill="#fff" stroke="#1a1a1a" stroke-width=".9"/>',
     box:'14 9 36 36'},
    /* Five more. Everything here competes for the same square inches, so each
       of these has to work with a hat on and with the mouth still showing —
       which is why the freckles and the plaster sit off to the side and the
       two that do cover the eyes are the two that are meant to. */
    // sunglasses
    {n:'Sunglasses', dye:1, s:'<path d="M17.2 26.8h29.6v1.9H17.2z" fill="#2c3340"/>'
       + '<rect x="18.4" y="26.4" width="11.8" height="7.8" rx="3.2" fill="#20242e"/>'
       + '<rect x="33.8" y="26.4" width="11.8" height="7.8" rx="3.2" fill="#20242e"/>'
       + '<path d="M18.4 28.2h-2.9M45.6 28.2h2.9" stroke="#2c3340" stroke-width="1.7" fill="none" stroke-linecap="round"/>'
       + '<path d="M20.8 32.4l4.4-4.4M36.2 32.4l4.4-4.4" stroke="#fff" stroke-width="1.3" fill="none" stroke-linecap="round" opacity=".4"/>',
     box:'15 24 34 13'},
    // eyepatch
    {n:'Eyepatch', dye:1, s:'<path d="M16.6 22.4q15.4 4.4 30.8 0" stroke="#2c3340" stroke-width="1.7" fill="none" stroke-linecap="round"/>'
       + '<path d="M32.6 25.2q8-1.4 9.6 2.8t-4.8 6.6q-6 .4-6.2-4.4z" fill="#20242e"/>'
       + '<path d="M34 27.4q4-.6 5 1.4" stroke="#4a5566" stroke-width="1.1" fill="none" stroke-linecap="round"/>',
     box:'15 20 34 18'},
    // freckles
    {n:'Freckles', s:'<g fill="#c98a5b" opacity=".85"><circle cx="21.8" cy="33.4" r=".95"/><circle cx="24.8" cy="35.2" r=".85"/>'
       + '<circle cx="19.6" cy="35.8" r=".85"/><circle cx="23" cy="37.4" r=".8"/>'
       + '<circle cx="42.2" cy="33.4" r=".95"/><circle cx="39.2" cy="35.2" r=".85"/>'
       + '<circle cx="44.4" cy="35.8" r=".85"/><circle cx="41" cy="37.4" r=".8"/></g>',
     box:'17 31 30 9'},
    // sticking plaster
    {n:'Plaster', s:'<g transform="rotate(-26 41.6 33.6)"><rect x="36.4" y="31.3" width="10.4" height="4.6" rx="2.3" fill="#f2c9a4"/>'
       + '<rect x="39.6" y="31.9" width="4" height="3.4" rx="1.1" fill="#e0a877"/>'
       + '<g fill="#dba078" opacity=".9"><circle cx="38.2" cy="32.6" r=".42"/><circle cx="38.2" cy="34.6" r=".42"/>'
       + '<circle cx="44.8" cy="32.6" r=".42"/><circle cx="44.8" cy="34.6" r=".42"/></g></g>',
     box:'34 27 18 13'},
    /* Wear it with the swim. */
    // diving mask
    {n:'Diving mask', s:'<rect x="17.6" y="23.4" width="28.8" height="12.6" rx="5.4" fill="#bfe6f5" opacity=".5"/>'
       + '<rect x="17.6" y="23.4" width="28.8" height="12.6" rx="5.4" fill="none" stroke="#e01b24" stroke-width="2.2"/>'
       + '<path d="M32 24.2v11" stroke="#e01b24" stroke-width="1.4" fill="none"/>'
       + '<path d="M17.8 27.4h-3.2M46.2 27.4h1.4" stroke="#e01b24" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
       + '<path d="M47.8 34.2v-8.6a3.2 3.2 0 0 1 6.4 0v13.4" stroke="#f7bd52" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
     box:'13 20 44 24'},
  ];


  /* ---------------- outerwear ----------------
     A coat, worn over the body and under everything on the face. Its own list
     rather than another entry in `BUD_ACC` for the same reason the face and the
     body were split: a tie and a beard are not alternatives, and neither are a
     tie and a denim jacket. You can have one of each.

     **Same contract as every other table: add to the end, never insert, never
     remove.** `o` travels in `hello` with the other five, and an index that
     moves puts somebody else in a different coat without asking them.
     `budClean` supplies `o:0` for anyone whose buddy predates this list, which
     is everybody — the missing key reads as "no coat", which is what they had.

     **Two layers, because a hood goes behind a head.** `b` is drawn before the
     body and the head, `s` after the body and before the head. Anything in `s`
     above about y=43 is covered by the skull, which is why every collar and
     lapel here starts below it — a collar drawn at the neck is a collar drawn
     under his chin, invisible, and that is a whole evening you can have back.

     **A coat cannot know what colour it is worn over.** The opening down the
     front is a *gap between two panels*, not a stripe painted in some third
     colour: the body shows through it. That is why most of these are two paths
     that between them leave the middle bare, and why the ones that genuinely
     do close at the front — the hoodie, the puffer, the raincoat — are honest
     about hiding him. The feet keep the body colour whatever he is wearing, so
     he is never unrecognisable.

     **Nothing may cross the silhouette, and the hem is where that goes wrong.**
     The body is a pill: its bottom corners round in by nine, so at y=52 it is
     only 21.3 to 42.7 wide and at y=54 only 23.9 to 40.1. Trims drawn to the
     panel's *nominal* edges — a placket to 55, a butt-capped band starting at
     19 — hang past the curve as square corners floating in mid-air, which is
     what a drawing looks like when nobody rendered it. Keep anything that is
     not itself the panel outline inside x 21.5..42.5 below y=49, and give
     strokes round caps so the ends do not add half a width of corner. */
  /* **Not everything takes a colour.** `dye:1` is what puts a swatch row under a
     coat, and it used to be on nearly all of them — which meant a lab coat in
     magenta and a denim jacket in lime. Those are not that coat any more: at
     this size a lab coat *is* the white and denim *is* the blue, and recolouring
     one leaves a shape nobody can name. So the dial belongs to the garments
     that are a shape rather than a uniform — a cape, a scarf, a puffer, a
     cardigan — and the ones whose colour is half their identity keep the one
     they were drawn in. `dyeable` in the wardrobe reads this flag, so dropping
     it takes the swatch row away with it. */
  const BUD_OUTER = [
    {n:'Bare', s:'', box:'0 0 24 24', none:1},
    /* Pullover, so it closes at the front, and the hood is the point of it —
       an ellipse a little larger than the skull, drawn behind everything, so a
       rim of it shows all the way round like a hood pushed back. The pouch is
       a curve rather than a rounded box: at this size a box with a radius on it
       still reads as a box, and the one thing a hoodie's pocket is not is
       square. */
    // hoodie
    {n:'Hoodie', dye:1, s:'<path d="M28 36h8a9 9 0 0 1 9 9v1a9 9 0 0 1-9 9h-8a9 9 0 0 1-9-9v-1a9 9 0 0 1 9-9z" fill="#5b7fa8"/>'
       + '<path d="M23.8 46.8q8.2 2.4 16.4 0 .3 4.2-3.2 5.6-5 1.5-10 0-3.5-1.4-3.2-5.6z" fill="#4d6d94"/>'
       + '<path d="M29.4 43.8q-.7 2.6-.6 4.6M34.6 43.8q.7 2.6.6 4.6" stroke="#e9edf5" stroke-width="1.3" fill="none" stroke-linecap="round"/>'
       + '<circle cx="28.7" cy="49.4" r="1.2" fill="#e9edf5"/>'
       + '<circle cx="35.3" cy="49.4" r="1.2" fill="#e9edf5"/>',
     b:'<ellipse cx="32" cy="29.4" rx="19.8" ry="19.4" fill="#3f5d80"/>', box:'11 9 42 49'},
    /* Denim: the lapels are the only hard lines on it, and they are meant to
       be — a revere is a fold. Everything else curves. */
    // denim jacket
    {n:'Denim jacket', s:'<path d="M28 36a9 9 0 0 0-9 9v1a9 9 0 0 0 9 9h2.6v-6z" fill="#3f6ea8"/><path d="M36 36a9 9 0 0 1 9 9v1a9 9 0 0 1-9 9h-2.6v-6z" fill="#3f6ea8"/>'
       + '<path d="M29.6 43.4q1.4 3 1 5.6-4-1.6-7.2-4.2 3.2-.8 6.2-1.4z" fill="#2d5280"/>'
       + '<path d="M34.4 43.4q-1.4 3-1 5.6 4-1.6 7.2-4.2-3.2-.8-6.2-1.4z" fill="#2d5280"/>'
       + '<path d="M21.8 47.6q3.2.9 6.4 0 .3 3-3.2 3.7-3.5-.7-3.2-3.7z" fill="#35608f"/>'
       + '<path d="M35.8 47.6q3.2.9 6.4 0 .3 3-3.2 3.7-3.5-.7-3.2-3.7z" fill="#35608f"/>'
       + '<circle cx="31.4" cy="52.2" r="1.2" fill="#d8b04a"/>', box:'17 41 30 17'},
    /* Quilted, which is the only thing that tells a puffer from a coat at this
       size. The seams sag a little across him rather than running dead straight,
       so they read as padding rather than as ruled lines. */
    // puffer
    {n:'Puffer', dye:1, s:'<path d="M28 36h8a9 9 0 0 1 9 9v1a9 9 0 0 1-9 9h-8a9 9 0 0 1-9-9v-1a9 9 0 0 1 9-9z" fill="#c0483a"/>'
       + '<path d="M20.6 41.4q11.4 2.2 22.8 0M20 46q12 2.2 24 0M21.8 50.4q10.2 2 20.4 0" stroke="#a03a2e" stroke-width="1.5" fill="none" stroke-linecap="round"/>'
       + '<path d="M32 37v16.4" stroke="#8f3225" stroke-width="1.5" fill="none" stroke-linecap="round"/>'
       + '<circle cx="32" cy="43.6" r="1.4" fill="#e9edf5"/>', box:'17 34 30 23'},
    /* Nothing on the front but the clasp, so the body colour is untouched —
       the whole garment is behind him. It trails on the swing; see `.bud-cape`
       in the stylesheet. */
    // cape
    {n:'Cape', dye:1, s:'<path d="M26 43.4q6 1.6 12 0 .2 2.6-1.4 3.4-4.6 1.2-9.2 0-1.6-.8-1.4-3.4z" fill="#c92a55"/>'
       + '<circle cx="32" cy="45" r="2.1" fill="#ffd34a"/>',
     b:'<path class="bud-cape" d="M23 39q-13 8-15 22 24 7.4 48 0-2-14-15-22z" fill="#8a1f3d"/>'
       + '<path class="bud-cape" d="M27 39.6q-8 7-9.4 19 14.4 3.6 28.8 0-1.4-12-9.4-19z" fill="#a82a4c"/>',
     box:'6 36 52 27'},
    // lab coat
    {n:'Lab coat', s:'<path d="M28 36a9 9 0 0 0-9 9v1a9 9 0 0 0 9 9h2.6v-6z" fill="#eef2f7"/><path d="M36 36a9 9 0 0 1 9 9v1a9 9 0 0 1-9 9h-2.6v-6z" fill="#eef2f7"/>'
       + '<path d="M29.6 43.4q1.4 3.2 1 6-4.2-1.8-7.6-4.6 3.4-.8 6.6-1.4z" fill="#dbe3ee"/>'
       + '<path d="M34.4 43.4q-1.4 3.2-1 6 4.2-1.8 7.6-4.6-3.4-.8-6.6-1.4z" fill="#dbe3ee"/>'
       + '<path d="M21.6 47.8q3 .8 6 0 .3 3.4-3 4.2-3.3-.8-3-4.2z" fill="#dbe3ee"/>'
       + '<path d="M24.6 46.6v3.2" stroke="#2f6fd0" stroke-width="1.4" fill="none" stroke-linecap="round"/>'
       + '<circle cx="33.8" cy="52" r="1.1" fill="#c4cede"/>', box:'17 41 30 17'},
    // blazer
    {n:'Blazer', s:'<path d="M28 36a9 9 0 0 0-9 9v1a9 9 0 0 0 9 9h2.6v-6z" fill="#3f4d6b"/><path d="M36 36a9 9 0 0 1 9 9v1a9 9 0 0 1-9 9h-2.6v-6z" fill="#3f4d6b"/>'
       + '<path d="M29.6 43.4q1.5 3.4 1 6.4-4.4-1.9-8-4.9 3.6-.9 7-1.5z" fill="#57678c"/>'
       + '<path d="M34.4 43.4q-1.5 3.4-1 6.4 4.4-1.9 8-4.9-3.6-.9-7-1.5z" fill="#57678c"/>'
       + '<path d="M22 48.6q2.6.7 5.2 0-.4 2.4-2.6 2.8-2.2-.4-2.6-2.8z" fill="#e01b24"/>'
       + '<circle cx="31.6" cy="52.4" r="1.2" fill="#c9b06a"/>', box:'17 41 30 17'},
    // cardigan
    {n:'Cardigan', dye:1, s:'<path d="M28 36a9 9 0 0 0-9 9v1a9 9 0 0 0 9 9h2.6v-6z" fill="#6f8f5a"/><path d="M36 36a9 9 0 0 1 9 9v1a9 9 0 0 1-9 9h-2.6v-6z" fill="#6f8f5a"/>'
       + '<path d="M29.4 43q2.6.6 5.2 0v10.2q-2.6.9-5.2 0z" fill="#5b7a48"/>'
       + '<circle cx="32" cy="45.4" r="1.15" fill="#e6ddc4"/>'
       + '<circle cx="32" cy="48.6" r="1.15" fill="#e6ddc4"/>'
       + '<circle cx="32" cy="51.8" r="1.15" fill="#e6ddc4"/>'
       + '<path d="M22.8 49.4q2.6.7 5.2 0M36 49.4q2.6.7 5.2 0" stroke="#5b7a48" stroke-width="1.3" fill="none" stroke-linecap="round"/>', box:'17 41 30 17'},
    /* Straight-fronted, because a hi-vis has a zip and not lapels. The bands
       curve with him: a reflective strip on a round body is not a ruler. */
    // high-vis vest
    {n:'Hi-vis vest', s:'<path d="M30.6 36h-2.6a9 9 0 0 0-9 9v1a9 9 0 0 0 9 9h2.6z" fill="#d8f24a"/><path d="M33.4 36h2.6a9 9 0 0 1 9 9v1a9 9 0 0 1-9 9h-2.6z" fill="#d8f24a"/>'
       + '<path d="M19.6 44.2q5.4 1.4 10.6.9M33.8 45.1q5.2.5 10.6-.9" stroke="#c9d4e0" stroke-width="2.4" fill="none" stroke-linecap="round"/>'
       + '<path d="M21.2 50q4.6 1.2 9 .8M34 50.8q4.4.4 9-.8" stroke="#c9d4e0" stroke-width="2.4" fill="none" stroke-linecap="round"/>'
       + '<path d="M25 43.8v7.4M39 43.8v7.4" stroke="#c9d4e0" stroke-width="2" fill="none" stroke-linecap="round"/>', box:'17 41 30 17'},
    // raincoat
    {n:'Raincoat', dye:1, s:'<path d="M28 36h8a9 9 0 0 1 9 9v1a9 9 0 0 1-9 9h-8a9 9 0 0 1-9-9v-1a9 9 0 0 1 9-9z" fill="#f2c14a"/>'
       + '<path d="M32 37v16.2" stroke="#d8a12c" stroke-width="1.4" fill="none" stroke-linecap="round"/>'
       + '<path d="M28.2 45.6h7.6M28.2 50.2h7.6" stroke="#8f6a12" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
       + '<circle cx="27.6" cy="45.6" r="1.2" fill="#8f6a12"/>'
       + '<circle cx="27.6" cy="50.2" r="1.2" fill="#8f6a12"/>',
     b:'<ellipse cx="32" cy="29.4" rx="19.8" ry="19.4" fill="#d8a12c"/>', box:'11 9 42 49'},
    /* Five more, and the constraint that shaped all of them is the one written
       above: the body is a pill, so nothing may hang past the curve. Every hem
       here stops at y=52 inside x 22..42, and the ones with straps run them
       over the shoulder rather than straight up, because straight up on a round
       body reads as two sticks. */
    // dungarees
    {n:'Dungarees', s:'<path d="M19 45.6q13 3.2 26 0a9 9 0 0 1-9 9.4h-8a9 9 0 0 1-9-9.4z" fill="#3f6ea8"/>'
       + '<path d="M26.4 41.2h11.2v5.6q-5.6 1.6-11.2 0z" fill="#3f6ea8"/>'
       + '<path d="M27 41.4q-1-3.4.4-5.2M37 41.4q1-3.4-.4-5.2" stroke="#3f6ea8" stroke-width="2.7" fill="none" stroke-linecap="round"/>'
       + '<circle cx="27.6" cy="41.8" r="1.15" fill="#d8b04a"/>'
       + '<circle cx="36.4" cy="41.8" r="1.15" fill="#d8b04a"/>'
       + '<path d="M28.8 44.4h6.4" stroke="#2d5280" stroke-width="1.1" fill="none" stroke-linecap="round"/>'
       + '<path d="M32 47.4v7.4" stroke="#2d5280" stroke-width="1.1" fill="none" stroke-linecap="round"/>',
     box:'18 34 28 23'},
    /* Draped rather than fitted: one shape over both shoulders with a fringe,
       which is the whole silhouette of a poncho. */
    // poncho
    {n:'Poncho', dye:1, s:'<path d="M32 36.2q10 1.4 12.8 9.8-6.4 2.8-12.8 2.8t-12.8-2.8q2.8-8.4 12.8-9.8z" fill="#c0483a"/>'
       + '<path d="M21.4 43.4q10.6 3 21.2 0" stroke="#f2e0c4" stroke-width="1.6" fill="none"/>'
       + '<path d="M22.6 47.2l-.7 2.6M26.4 48.4l-.5 2.6M30 49l-.3 2.6M34 49l.3 2.6M37.6 48.4l.5 2.6M41.4 47.2l.7 2.6" stroke="#8f3225" stroke-width="1.2" fill="none" stroke-linecap="round"/>',
     box:'18 35 28 18'},
    // dressing gown
    {n:'Dressing gown', dye:1, s:'<path d="M28 36a9 9 0 0 0-9 9v1a9 9 0 0 0 9 9h2.6v-6z" fill="#8a5fd8"/><path d="M36 36a9 9 0 0 1 9 9v1a9 9 0 0 1-9 9h-2.6v-6z" fill="#8a5fd8"/>'
       + '<path d="M29.8 43.2q1.4 4 1 7.6-4.6-2.2-8.4-5.6 3.8-1.2 7.4-2z" fill="#6f47bd"/>'
       + '<path d="M34.2 43.2q-1.4 4-1 7.6 4.6-2.2 8.4-5.6-3.8-1.2-7.4-2z" fill="#6f47bd"/>'
       + '<path d="M21.4 47.8q10.6 3.2 21.2 0v3.2q-10.6 3.2-21.2 0z" fill="#5b3a9e"/>'
       + '<circle cx="32" cy="49.6" r="1.9" fill="#6f47bd"/>',
     box:'17 41 30 17'},
    /* Knitted, which at this size is one band of pattern and a ribbed hem —
       any more and it is noise. */
    // knit jumper
    {n:'Knit jumper', dye:1, s:'<path d="M28 36h8a9 9 0 0 1 9 9v1a9 9 0 0 1-9 9h-8a9 9 0 0 1-9-9v-1a9 9 0 0 1 9-9z" fill="#6f8f5a"/>'
       + '<path d="M20 44.4q12 2.6 24 0v3.4q-12 2.6-24 0z" fill="#e6ddc4"/>'
       + '<g fill="#6f8f5a"><path d="M24 44.6l1.6 1.6-1.6 1.6-1.6-1.6z"/><path d="M32 44.8l1.6 1.6-1.6 1.6-1.6-1.6z"/><path d="M40 44.6l1.6 1.6-1.6 1.6-1.6-1.6z"/></g>'
       + '<path d="M22 51.4q10 2.2 20 0" stroke="#5b7a48" stroke-width="1.3" fill="none" stroke-linecap="round"/>'
       + '<path d="M22.6 39.4q9.4 2.4 18.8 0" stroke="#5b7a48" stroke-width="1.3" fill="none" stroke-linecap="round"/>',
     box:'17 34 30 23'},
    // apron
    {n:'Apron', s:'<path d="M27.2 40.6h9.6v5.4q-4.8 1.4-9.6 0z" fill="#f2e0c4"/>'
       + '<path d="M21.4 45.8q10.6 2.8 21.2 0a9 9 0 0 1-8.6 9.2h-4a9 9 0 0 1-8.6-9.2z" fill="#f2e0c4"/>'
       + '<path d="M27.6 40.8q4.4-4.4 8.8 0" stroke="#f2e0c4" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
       + '<path d="M21.8 46.6q-2.6 1.4-3.2 3.4M42.2 46.6q2.6 1.4 3.2 3.4" stroke="#f2e0c4" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
       + '<path d="M28.6 48.6h6.8v3.4h-6.8z" fill="#d8c8a8"/>',
     box:'17 38 30 19'},
  ];

  /* ---- what he does while the clock runs ----
     Three, chosen rather than assigned. The old version picked for you by
     phase — swim through focus, sleep through rest — which meant two thirds of
     him was invisible depending on what you were doing, and nobody could tell
     there was anything to choose. The icon is the antic, drawn small.

     Same rule as the parts: **add to the end.** `S.budAnim` is an index. */
  const BUD_ANIMS = [
    {k:'swing', n:'Web-swing', d:'Swings across the whole screen on webs he throws himself.',
     ic:'<path d="M12 2v7" stroke="currentColor" stroke-width="1.6" fill="none"/>'
        + '<circle cx="12" cy="13" r="4" fill="currentColor"/>'
        + '<path d="M7 18l-3 4M17 18l3 4" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>'},
    {k:'onpause', n:'Nap', d:'Curls up on the corner of the Pause button and snores.',
     /* Zs, not an arrow. The arrow was meant to say "up on top of something"
        and said "go somewhere" instead — the one thing a nap is not. */
     ic:'<rect x="2" y="15" width="20" height="5" rx="2.5" fill="currentColor" opacity=".4"/>'
        + '<circle cx="9" cy="11" r="4" fill="currentColor"/>'
        + '<text x="14" y="9" font-size="7" fill="currentColor">z</text>'
        + '<text x="18" y="5" font-size="6" fill="currentColor" opacity=".7">z</text>'},
    {k:'swim', n:'Swim', d:'Front crawl, up and down the screen, turning at each end.',
     ic:'<circle cx="10" cy="9" r="4" fill="currentColor"/>'
        + '<path d="M2 17q3-2 5 0t5 0 5 0 5 0" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
        + '<path d="M2 21q3-2 5 0t5 0 5 0 5 0" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" opacity=".5"/>'},
    /* ---- and six more, appended, never inserted ----
       Three loud and three quiet, because "what he does while the clock runs"
       is not one job. The swing is a spectacle and some people want the screen
       to hold still; Pace and Read are the same idea as the nap — something
       alive in the corner of your eye that is not asking for it.

       **The tightrope was here and has been taken out.** It walked a wire at a
       fixed height and that was the whole of it — one line, one speed, nothing
       to look at twice — and its clean full-width crossing was the only good
       part, which the jetpack now does. Removing it moved four indexes, which
       is normally forbidden; it is allowed exactly once here because these six
       were written this afternoon and no build carrying them has ever left the
       machine. From the next release the same rule applies to them as to
       everything else: **add to the end, never insert, never remove.**

       Each of these is a slot travelling and a drawing reacting, exactly like
       the swing: the pose name becomes the class on the slot, `BUD_LIMBS` moves
       the four stubs into the shape, and `BUD_PROPS` draws whatever he is
       holding or standing on. Nothing here needs a rig — the swing is the only
       one where a second element has to pivot about the same anchor. */
    {k:'skate', n:'Skateboard', d:'Rolls the width of the screen and kick-turns at each wall.',
     ic:'<circle cx="12" cy="6.6" r="3.4" fill="currentColor"/>'
        + '<path d="M12 10v5" stroke="currentColor" stroke-width="1.8" fill="none"/>'
        + '<rect x="3" y="16.4" width="18" height="2.4" rx="1.2" fill="currentColor"/>'
        + '<circle cx="7.4" cy="20.6" r="1.7" fill="currentColor" opacity=".65"/>'
        + '<circle cx="16.6" cy="20.6" r="1.7" fill="currentColor" opacity=".65"/>'},
    {k:'jetpack', n:'Jetpack', d:'Crosses the whole window on a thruster, climbing and diving as he goes.',
     ic:'<circle cx="12" cy="6" r="3.4" fill="currentColor"/>'
        + '<rect x="7" y="10" width="10" height="7.4" rx="3.2" fill="currentColor"/>'
        + '<path d="M9.4 18.4q1.8 3 0 5.2-1.8-2.2 0-5.2M14.6 18.4q1.8 3 0 5.2-1.8-2.2 0-5.2" fill="currentColor" opacity=".55"/>'},
    {k:'balloon', n:'Balloon', d:'Drifts up on a balloon, hangs about at the top, and comes back down.',
     ic:'<ellipse cx="12" cy="7" rx="5.6" ry="6.4" fill="currentColor"/>'
        + '<path d="M12 13.6v3.4" stroke="currentColor" stroke-width="1.4" fill="none"/>'
        + '<circle cx="12" cy="20" r="3.2" fill="currentColor" opacity=".65"/>'},
    {k:'pace', n:'Pace', d:'Walks the bottom of the screen and back, thinking about it.',
     ic:'<circle cx="10" cy="6" r="3.4" fill="currentColor"/>'
        + '<path d="M10 9.6v6.4l-3.4 4.4M10 16l3.4 4.4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>'
        + '<path d="M2 22.6h20" stroke="currentColor" stroke-width="1.5" fill="none" opacity=".45"/>'},
    {k:'read', n:'Reading', d:'Stands with a book up in front of his face, lowering it now and then.',
     ic:'<circle cx="12" cy="5" r="3.2" fill="currentColor"/>'
        + '<path d="M2.6 10.6h8.8v10.8H2.6zM12.6 10.6h8.8v10.8h-8.8z" fill="currentColor" opacity=".5"/>'
        + '<path d="M12 10v11.6" stroke="currentColor" stroke-width="1.6" fill="none"/>'},
  ];

  /* ---- the four stubs, wherever the pose puts them ----
     Hands and feet are not attached to anything, which is exactly what lets a
     pose move them: there is no arm to bend the wrong way. So a pose is a table
     of four points rather than a rotation — "one arm up on the web, the other
     thrown back" is a *shape*, and no amount of turning the whole figure gets
     to it.

     **A pose with no entry here stands normally, on purpose.** A new antic that
     forgets its limbs then looks plain rather than broken, which is the failure
     you want out of the two. */
  const BUD_LIMBS = {
    stand:     {fl:[25, 58, 5, 3.4],   fr:[39, 58, 5, 3.4],   hl:[13, 45], hr:[51, 45]},
    swing:     {fl:[17, 55, 5.4, 3.2], fr:[28, 60, 5.4, 3.2], hl:[46, 16], hr:[14, 40]},
    skate:     {fl:[26.6, 58, 5, 3.4], fr:[37.4, 58, 5, 3.4], hl:[10, 41], hr:[54, 41]},
    /* **The hands have to clear the thrusters and the thrusters have to clear
       the body.** Everything inside x 19..45 is behind the torso and everything
       inside about x 16..48 above y 43 is behind the head, so there are only a
       few units either side where a prop can actually be seen. Both hands sit
       above the nozzles; both feet hang between them. */
    jetpack:   {fl:[27, 58, 5, 3.4],   fr:[37, 59, 5, 3.4],   hl:[12, 40], hr:[52, 40]},
    /* The raised hand was at (45,17), which is *inside* the skull — the head is
       drawn after the limbs, so all but a crescent of it was painted over and
       the string appeared to end in his ear. Out at 52 it is clear of the head
       at every height. */
    balloon:   {fl:[27, 59, 5, 3.4],   fr:[37, 60, 5, 3.4],   hl:[13, 46], hr:[52, 20]},
    /* Both hands up on the covers, wide enough that the fists show past the
       edges of the book rather than disappearing behind it. */
    read:      {fl:[25, 58, 5, 3.4],   fr:[39, 58, 5, 3.4],   hl:[17.4, 45], hr:[46.6, 45]},
  };
  function budLimbs(pose, skin, body){
    const L = BUD_LIMBS[pose] || BUD_LIMBS.stand;
    /* The class names are the reverse of the jobs in the swing — see the note
       on `.bud-hand-l` in the stylesheet — and they are load-bearing: every
       pose's CSS animates the stubs by these names. */
    const foot = (k, p)=>'<ellipse class="bud-foot bud-foot-' + k + '" cx="' + p[0] + '" cy="' + p[1]
      + '" rx="' + p[2] + '" ry="' + p[3] + '" fill="' + body + '"/>';
    const hand = (k, p)=>'<circle class="bud-hand bud-hand-' + k + '" cx="' + p[0] + '" cy="' + p[1]
      + '" r="4.2" fill="' + skin + '"/>';
    return foot('l', L.fl) + foot('r', L.fr) + hand('l', L.hl) + hand('r', L.hr);
  }

  /* ---- what he is standing on, or holding ----
     `back` is drawn before the limbs and the body, `front` after everything
     including the hat. Which of the two a prop belongs in is a question about
     overlap and nothing else: a board goes under his feet, a book goes over his
     hands, a jetpack goes behind him, and a balloon's string has to disappear
     into the hand that is holding it rather than crossing over it.

     These leave the 64-unit box on purpose — the board's wheels, the balance
     pole's ends, the balloon. `.bud-slot svg{overflow:visible}` is what lets
     them, and the picker never sees any of it because the editor draws him
     with no pose at all. */
  const BUD_PROPS = {
    /* A deck with kicked ends rather than a bar, and wheels with something on
       them to turn — a plain disc spins invisibly, which is the same as not
       spinning. The board is its own group because it flips without him. */
    skate:{back:'<g class="bud-board">'
      + '<path d="M13.2 62.2q1.4-3 5.4-3h26.8q4 0 5.4 3-1.2 2.4-5.4 2.4H18.6q-4.2 0-5.4-2.4z" fill="#2c3340"/>'
      + '<path d="M19 60.4h26" stroke="#525f70" stroke-width="1.2" fill="none" stroke-linecap="round"/>'
      + '<path d="M22.6 64.4v1.4M41.4 64.4v1.4" stroke="#4a5566" stroke-width="1.6" fill="none"/>'
      /* One spoke, not two. A pair reads as the slot in a screw head and the
         wheel stops being a wheel; one off-centre mark is all a rotation needs
         to be visible. */
      + '<g class="bud-wheel"><circle cx="22.6" cy="67.4" r="2.9" fill="#e6ebf3"/>'
      + '<path d="M22.6 67.4V64.8" stroke="#5a6675" stroke-width="1.1" stroke-linecap="round"/>'
      + '<circle cx="22.6" cy="67.4" r="1.1" fill="#5a6675"/></g>'
      + '<g class="bud-wheel"><circle cx="41.4" cy="67.4" r="2.9" fill="#e6ebf3"/>'
      + '<path d="M41.4 67.4V64.8" stroke="#5a6675" stroke-width="1.1" stroke-linecap="round"/>'
      + '<circle cx="41.4" cy="67.4" r="1.1" fill="#5a6675"/></g>'
      + '</g>'},
    /* **The pack that mattered was the one you could see.** This started as a
       cylinder on his back and two tanks at his shoulders: the cylinder was
       behind the torso, the tanks were behind the head, and what reached the
       screen was two grey slivers and a spark. Everything visible now lives
       outside the silhouette — nozzles down each side, flames below the feet —
       and the only thing on the torso is a pair of straps, which is the one
       part of a jetpack you would see from the front anyway. */
    jetpack:{back:'<rect x="14.6" y="44" width="7.6" height="16" rx="3.8" fill="#6b7788"/>'
      + '<rect x="41.8" y="44" width="7.6" height="16" rx="3.8" fill="#6b7788"/>'
      + '<rect x="15.8" y="46.2" width="5.2" height="4.4" rx="2.2" fill="#8c99ab"/>'
      + '<rect x="43" y="46.2" width="5.2" height="4.4" rx="2.2" fill="#8c99ab"/>'
      + '<g class="bud-flame"><path d="M18.4 59.6q4.2 7.4 0 13-4.2-5.6 0-13z" fill="#ffb020"/>'
      + '<path d="M45.6 59.6q4.2 7.4 0 13-4.2-5.6 0-13z" fill="#ffb020"/>'
      + '<path d="M18.4 60.6q2.3 4.4 0 7.8-2.3-3.4 0-7.8z" fill="#ffe08a"/>'
      + '<path d="M45.6 60.6q2.3 4.4 0 7.8-2.3-3.4 0-7.8z" fill="#ffe08a"/></g>',
      front:'<path d="M27.4 43.6l-1.6 11M36.6 43.6l1.6 11" stroke="#4a5566" stroke-width="2.8" fill="none" stroke-linecap="round"/>'
      + '<circle cx="26.4" cy="49.6" r="1.3" fill="#8c99ab"/>'
      + '<circle cx="37.6" cy="49.6" r="1.3" fill="#8c99ab"/>'},
    balloon:{back:'<ellipse cx="53" cy="-3" rx="9.4" ry="11" fill="#e01b24"/>'
      + '<ellipse cx="49.4" cy="-6.6" rx="2.4" ry="3.6" fill="#fff" opacity=".32"/>'
      + '<path d="M53 7.4l-2.2 2.6h4.4z" fill="#8f1116"/>'
      + '<path d="M53 10q-.6 3.4-.8 6" stroke="#e9edf5" stroke-width="1" fill="none" opacity=".8"/>'},
    /* **Turned round, and held up.** It used to lie open towards the camera at
       waist height, which is a book being shown to you, not read. From behind
       you see the two covers splayed away and the spine ridge nearest — and it
       belongs in front of his face, high enough to cover the mouth and low
       enough to leave the eyes, because a reader with no eyes is a blindfold.
       The pale slivers along the inside edges are the block of pages, the one
       part of the far side you would actually catch. */
    read:{front:'<g class="bud-book">'
      /* **The far edges rise, they do not fall.** Drawn the other way up this is
         an open book held out towards you with its pages showing, which is a
         book being read *to* somebody. Seen from behind — which is what you see
         of a person reading — the spine is nearest and lowest, and both covers
         angle away and upwards from it. Two things to check it by: the spine's
         top sits *below* the outer corners, and the page block shows along the
         bottom, because that is the edge tilted towards you. */
      + '<path d="M31.2 37.6l-12.2-2.2v15.5l12.2 2.2z" fill="#6f47bd"/>'
      + '<path d="M32.8 37.6l12.2-2.2v15.5l-12.2 2.2z" fill="#7d55c8"/>'
      /* **The page block is along the top.** It was under the covers, which is
         where the folded edge of the pages is; the cut edge — the pale stack you
         can actually see — is at the head of the book, above the covers, and
         that is the edge that catches the light. */
      + '<path d="M19 35.4l12.2 2.2v-1.7l-12.2-2.2z" fill="#e6ebf3"/>'
      + '<path d="M45 35.4l-12.2 2.2v-1.7l12.2-2.2z" fill="#eef2f7"/>'
      + '<path d="M31 37.4h2v16h-2z" fill="#59349e"/>'
      + '<path d="M32 37.4v16" stroke="#8a5fd8" stroke-width=".7" fill="none" opacity=".55"/></g>'},
  };
  function budProp(pose, where){
    const p = BUD_PROPS[pose];
    return (p && p[where]) || '';
  }

  /* Somebody else's number, made safe against our list — same rule as the
     parts. Used by the room list, which draws other people's buddies. */
  function budAnimKey(i){
    i = parseInt(i, 10);
    /* **-1 is a real answer: no antic.** Somebody who has not bought one yet
       has nothing to do, and drawing them mid-swing because the index was
       missing would be showing a thing they do not own. Everything that paints
       a peer checks for the empty string this returns. */
    if(!(i >= 0 && i < BUD_ANIMS.length)) return '';
    return BUD_ANIMS[i].k;
  }
  /* **What he is *doing* is part of the buddy, so it drafts like the rest of
     him.** Every other choice goes into `Buddy.draft` and waits for Save; the
     antic wrote straight through to `S.budAnim`, saved, and announced itself to
     the room — so trying the eight of them was eight saves and eight
     broadcasts, Undo did not touch it, and Save had nothing to say about the
     one change you can actually see moving. `Buddy.anim` is the unsaved one;
     null means "not changed yet", which is not the same as 0. */
  function budAnimIdx(){
    const raw = (typeof Buddy === 'object' && Buddy.anim != null) ? Buddy.anim : S.budAnim;
    const i = parseInt(raw, 10);
    if(!(i >= 0 && i < BUD_ANIMS.length)) return -1;
    return budOwns('an', i) ? i : -1;
  }
  /** The antic, or null when he has not bought one. */
  function budAnim(){ const i = budAnimIdx(); return i < 0 ? null : BUD_ANIMS[i]; }
  /** The saved one, for anything that has to agree with what the room was told. */
  function budAnimSaved(){
    const i = parseInt(S.budAnim, 10);
    if(!(i >= 0 && i < BUD_ANIMS.length)) return -1;
    return budOwns('an', i) ? i : -1;
  }

  /* **The eyes are adjusted rather than redrawn.** Bigger, wider apart and
     higher up are three dials over every style there is, which is thirty-nine
     drawings this does not have to contain. Three steps either side of the
     middle, and **the middle is 3**: `budClean` reads a missing dial as the
     middle rather than as 0, because 0 is a real setting here and "not set" has
     to mean "as it was". */
  const BUD_EYE_MID = 3, BUD_EYE_STEPS = 7;
  function budEyeAdjust(v){
    const s = 1 + (v.es - BUD_EYE_MID) * 0.075;     // 0.775 .. 1.225
    const w = 1 + (v.ex - BUD_EYE_MID) * 0.055;     // apart, or closer in
    const dy = (v.ey - BUD_EYE_MID) * 1.15;         // up the face, or down it
    if(s === 1 && w === 1 && !dy) return '';
    return ' transform="translate(32 ' + (30 + dy).toFixed(2) + ') scale('
      + (s * w).toFixed(3) + ' ' + s.toFixed(3) + ') translate(-32 -30)"';
  }

  function budDefault(){
    return {b:0, c:0, e:0, h:0, a:0, f:0, o:0, r:0, ec:0,
            es:BUD_EYE_MID, ey:BUD_EYE_MID, ex:BUD_EYE_MID,
            rc:0, hc:0, ac:0, fc:0, oc:0};
  }

  /* ---- every row, in one list ----
     The editor, the shop, the price table and the "is this bought" test all
     need the same six answers, and four copies of that list is four places to
     forget hair. `k` is the key in a buddy, `t` is where its colour is kept,
     and `id` is the letter its purchases are filed under in `Embers.own`. */
  const BUD_ROWS = [
    {k:'e', t:'ec', id:'e', name:'Eyes',      one:'eyes',  dye:'Eye ink',      list:()=>BUD_EYES, ink:1},
    {k:'r', t:'rc', id:'r', name:'Hair',      one:'hair',  dye:'Hair colour',  list:()=>BUD_HAIR},
    {k:'h', t:'hc', id:'h', name:'Hats',      one:'hat',   dye:'Hat colour',   list:()=>BUD_HATS},
    {k:'f', t:'fc', id:'f', name:'Face',      one:'face',  dye:'Face colour',  list:()=>BUD_FACE},
    {k:'a', t:'ac', id:'a', name:'Worn',      one:'thing', dye:'Worn colour',  list:()=>BUD_ACC},
    {k:'o', t:'oc', id:'o', name:'Outerwear', one:'coat',  dye:'Coat colour',  list:()=>BUD_OUTER},
  ];
  /** The name of what is in a row's slot right now, for anything that talks
      about it — the try list, a confirm, a label. */
  function budName(k, i){
    const r = BUD_ROWS.find(x=>x.k === k || x.id === k);
    const list = r ? r.list() : null;
    const part = list && list[i | 0];
    return (part && part.n) || (k === 'an' && BUD_ANIMS[i | 0] ? BUD_ANIMS[i | 0].n : 'It');
  }
  const BUD_KEYS = ['b','c','e','h','a','f','o','r','ec','es','ey','ex',
                    'rc','hc','ac','fc','oc'];
  /** Somebody else's numbers, made safe against our tables. */
  function budClean(v){
    const n = (x, max)=>{ const i = parseInt(x, 10); return (i >= 0 && i < max) ? i : 0; };
    const mid = (x)=>{ const i = parseInt(x, 10);
      return (i >= 0 && i < BUD_EYE_STEPS) ? i : BUD_EYE_MID; };
    v = v || {};
    return {
      b: n(v.b, BUD_BODY.length), c: n(v.c, BUD_SKIN.length),
      e: n(v.e, BUD_EYES.length), h: n(v.h, BUD_HATS.length),
      a: n(v.a, BUD_ACC.length), f: n(v.f, BUD_FACE.length),
      /* **Missing is 0, which is the whole migration.** Every buddy made before
         outerwear existed has no `o` at all, here and in the `hello` arriving
         from an older copy of the app; `n()` turns that into 0, and 0 is "no
         coat" — which is exactly what they were wearing. Nobody is redressed
         and no version check is needed. */
      o: n(v.o, BUD_OUTER.length),
      /* Hair and the colour dials, all of them the same migration as `o` was:
         a buddy made before they existed has no key, `n()` reads that as 0, and
         0 is "no hair, and everything the colour it was drawn". Nobody is
         restyled and there is no version to check. */
      r: n(v.r, BUD_HAIR.length),
      ec: n(v.ec, BUD_INK.length),
      /* The three dials, middled rather than zeroed when they are absent. */
      es: mid(v.es), ey: mid(v.ey), ex: mid(v.ex),
      rc: n(v.rc, BUD_HAIR_TINT.length), hc: n(v.hc, BUD_TINT.length),
      ac: n(v.ac, BUD_TINT.length), fc: n(v.fc, BUD_TINT.length),
      oc: n(v.oc, BUD_TINT.length),
    };
  }
  /* **The saved buddy, and the one being fiddled with, are different things.**
     Every tap used to write straight through to `S.buddy` and go out to the
     room, so trying six hats meant six broadcasts and no way back to the one
     you liked. `Buddy.draft` holds the unsaved version; everything that *draws*
     him reads `budMine()`, which prefers the draft, and only Save commits. */
  function budMine(){ return budClean(Buddy.draft || S.buddy); }
  function budSaved(){ return budClean(S.buddy); }
  function budSame(a, b){
    a = budClean(a); b = budClean(b);
    return BUD_KEYS.every(k=>a[k] === b[k]);
  }

  /* One SVG, no defs and no ids — several of these are on screen at once in a
     room, and ids in a repeated fragment collide with each other. */
  function budSvg(v, size, pose){
    v = budClean(v);
    const skin = BUD_SKIN[v.c], body = BUD_BODY[v.b];
    const px = size || 48;   // 20% up from 40; he was hard to read in a room list
    /* Asleep overrides the eyes you chose, because open eyes on somebody
       snoring reads as a bug rather than as a choice. Everything else keeps
       the face you made. */
    const napping = pose === 'onpause';
    const eyes = napping ? BUD_EYES[2].s : BUD_EYES[v.e].s;
    /* The ink and the size are adjustments rather than more drawings: the whole
       eye group is one `<g>`, so its fill recolours every style there is, and
       one scale about the point between them resizes every style there is. */
    const ink = BUD_INK[v.ec] || BUD_INK[0];
    const hair = budPart(BUD_HAIR[v.r], v.rc, BUD_HAIR_TINT, budBoost('r'));
    const outer = budPart(BUD_OUTER[v.o], v.oc);
    const worn = budPart(BUD_ACC[v.a], v.ac);
    const face = budPart(BUD_FACE[v.f], v.fc);
    const hat = budPart(BUD_HATS[v.h], v.hc);
    /* **Hats sit where that hat sits.** Every one of them was drawn against the
       same skull and so every one of them sat on the same line, which is why a
       beanie looked perched and a top hat looked jammed on. `y` is how far down
       this one goes: a beanie is pulled over the ears, a crown rides the crown,
       a bandana comes down over the brow. */
    const hatY = (BUD_HATS[v.h] && BUD_HATS[v.h].y) || 0;
    const hatSvg = hatY ? '<g transform="translate(0 ' + hatY + ')">' + hat.s + '</g>' : hat.s;
    const mouth = napping
      ? '<ellipse cx="32" cy="38" rx="2.4" ry="3" fill="#20242e"/>'
      : '<path d="M28 37q4 3 8 0" stroke="#20242e" stroke-width="2" fill="none" stroke-linecap="round"/>';
    /* **The web is not part of him any more.** It used to be two paths inside
       this drawing, which meant it could only ever be as long as the viewBox —
       sixty units, about fifty pixels. A web that stops fifty pixels above your
       head is a piece of string. It is drawn by the *layer* now (`.bud-rope`),
       so it can run all the way to the top of the screen, and it pivots on the
       same origin he does — see `.bud-rig`. */
    /* **The pose class belongs to the slot alone — never to the drawing.**
       This used to emit `class="bud bud-swing"`, and `stage()` also puts
       `bud-swing` on the slot. `.bud-swing` is where the travel lives
       (`bud-go`/`bud-round`, or `bud-lap`/`bud-depth` for the swim), so the
       drawing ran the whole journey a *second* time, on top of its parent —
       and drifted away from the rope that stayed with the slot. That is the
       detached web: not a broken anchor, two elements travelling separately.

       Nothing needs it here. Every pose rule is a descendant selector
       (`.bud-swing .bud`, `.bud-swim svg`, `.bud-onpause svg`), matched
       through the slot. `pose` still decides the *shape* below; it just must
       not become a class. */
    return '<svg class="bud"'
      + ' viewBox="0 0 64 64"'
      + ' width="' + px + '" height="' + px + '"'
      + ' aria-hidden="true" focusable="false">'
      /* Feet and hands: stubs, deliberately not attached to anything.

         **Swinging puts them somewhere else entirely.** Hanging from a line
         with your arms by your sides and your feet under you is a man being
         lowered on a rope, not a man swinging on one — the shape that reads is
         one arm up on the web, the other thrown back, and the legs trailing
         and split behind. So that pose moves the four stubs rather than trying
         to sell it with rotation alone. */
      /* Anything worn *behind* him, and anything he is standing on: the hood,
         the cape, the jetpack, the balloon, the skateboard. Before the limbs so
         a board is under his feet and a hood is behind his hands. */
      /* Hair that falls past the shoulders goes behind him with the hood and
         the cape; the part that sits on his head is drawn over the skull
         below. */
      + outer.b + hair.b + budProp(pose, 'back')
      + budLimbs(pose, skin, body)
      /* Body, coat, then head over both. The coat goes *under* the head on
         purpose — that is what puts a collar behind his chin instead of on it.
         `bud-torso` is a name, not decoration: the nap breathes this rect, and
         when it was selected as plain `rect` it also breathed the top hat. */
      + '<rect class="bud-torso" x="19" y="36" width="26" height="19" rx="9" fill="' + body + '"/>'
      /* **The coat, then what is worn over it.** A scarf goes on *after* a coat
         and hangs outside one, which is how it has to read — so `BUD_ACC` is
         painted last of the two. (It was the other way round for one build, on
         the tie-under-a-jacket argument; a scarf is the commoner case and it
         looked wrong tucked away.) The coat still goes under the head, which is
         what keeps a collar behind the chin rather than painted on it. */
      + outer.s
      /* **Round the neck, which means behind the chin.**
         Everything worn used to be one layer painted after the head — and a
         head is what a cord goes *behind*, so a necklace could only ever begin
         below the jaw and hang there, which reads as a sticker rather than as
         something round his neck. `n` is the half of a worn item that passes
         behind him: the cord, the ribbon, the strap. Over the body and the
         coat, under the skull — so it vanishes at the jawline and comes out at
         the collar, which is the whole illusion. Whatever hangs on the end of
         it stays in `s`, over everything.

         **`nk`, not `n`.** `n` is the part's *name* — every entry in every one
         of these tables starts `n:'Pendant'` — so calling the layer `n` gave
         the object two of them, the second won, and the shop listed a path
         string where the name goes. */
      + worn.nk
      + '<circle cx="32" cy="27" r="16" fill="' + skin + '"/>'
      /* Hair on the skull, under everything on the face and under the hat —
         which is the order they go on in. */
      + hair.s
      + '<g fill="' + ink + '" stroke="' + ink + '"' + budEyeAdjust(v) + '>' + eyes + '</g>'
      + mouth
      /* Face first, hat last. A hat sits *on* a head and a mask sits *against*
         one, so the brim has to cross the mask rather than the other way round
         — with the mask on top a cap looked like it had been slid underneath. */
      + worn.s + face.s + hatSvg
      /* Three, staggered by CSS, so there is always one in the air. They all
         start from the same place beside his head and follow the same drift —
         the delay is what makes it a stream rather than a burst. */
      /* **`currentColor`, not the ink colour.** These were `#20242e` — the same
         near-black as his eyes, which is right *on his face* and invisible
         floating on the app's dark background. They were drawing all along.
         The slot sets `color` from the theme, so they read on any look. */
      /* **Drawn, not typed.** These were `<text>z</text>`, which needs a font to
         exist, to have loaded, and to put the glyph where you expected — three
         things to go wrong for a shape that is a line, a diagonal and a line.
         As paths they cannot fail to render and they scale with him. */
      + (napping ? '<g class="bud-zzz">' + budZ(45, 17, 1) + budZ(45, 17, 1) + budZ(45, 17, 1) + '</g>' : '')
      /* Over everything, hat included: a balance pole crosses in front of him
         and so does a book. */
      + budProp(pose, 'front')
      + '</svg>';
  }

  /** A z, as three strokes. `currentColor` so it takes the theme's ink — these
      float on the app's background rather than on his face, and drawn in the
      figure's near-black they were invisible on every dark look, which is all
      but one of them. */
  function budZ(x, y, sc){
    const w = 4.6 * sc, h = 5.4 * sc;
    return '<path d="M' + x + ' ' + y + 'h' + w + 'l' + (-w) + ' ' + h + 'h' + w + '"'
      + ' fill="none" stroke="currentColor" stroke-width="' + (1.6 * sc) + '"'
      + ' stroke-linecap="round" stroke-linejoin="round"/>';
  }

  /** One part on its own, for the picker. Not a buddy wearing it. */
  /* **Both layers, or a hood is an icon of a drawstring.** Outerwear is the
     only part drawn in two passes, and the half that makes a hoodie a hoodie
     lives in the one that goes behind the head. The icon has no head to go
     behind, so the two are simply concatenated back-first. */
  /** The ink an eye icon is drawn in *on a tile*, which is not the ink it is
      drawn in on his face. The default is a near-black — right against skin and
      invisible against a dark card, which is what the picker's tiles are. So
      the default takes the tile's own text colour, and a chosen ink is shown as
      itself, because that is the thing being chosen. */
  function budTileInk(i){ return i ? BUD_INK[i] : 'currentColor'; }

  function budIcon(part, tint, ink, pal){
    const p = budPart(part, tint, pal, pal === BUD_HAIR_TINT ? budBoost('r') : 0);
    const col = ink || '#20242e';
    return '<svg class="bud-ic" viewBox="' + (part.none ? '0 0 24 24' : part.box) + '"'
      + ' width="26" height="26" aria-hidden="true" focusable="false">'
      + '<g fill="' + col + '" stroke="' + col + '">'
      + (part.none ? BUD_NONE : p.b + p.nk + p.s) + '</g></svg>';
  }

  /* ---------------- what things cost ----------------

     **Everything he wears is bought, and the prices live here rather than on
     the drawings.** A part is a drawing; keeping a number on it would mean
     every art change touching the economy and every price change touching the
     art. One table, one row per list, in the same order as the list — and
     `tools/smoke-test.mjs` fails if the two ever come apart, which is the whole
     reason it is safe to keep them separate.

     Index 0 is free in every row, always: it is "none", or in the eyes' case
     the plain pair he was born with. A buddy with nothing bought is still a
     buddy. Skin and body colour are free too, and so is every dial — a colour
     is not an item, and charging for one would make the shop feel like a
     tollbooth rather than a shelf.

     Antics are the dearest things in here on purpose. A hat is seen by whoever
     is looking at your name; an antic is a thing that crosses the whole screen
     for the length of a session, and it should feel like it cost something.

     **The whole shelf was repriced, and not by one multiplier.** An ember is ten
     minutes of focus, and at the old numbers the entire shop was a fortnight's
     work — which makes the last thing you buy feel like the first. Each row is
     now banded by where an item sits in its *own* row rather than against some
     absolute figure: the cheapest third doubled, the middle third quadrupled,
     and the top third times five. Banding by rank rather than by price is what
     keeps peers together — thirty and thirty-two are the same kind of hat and
     had no business landing either side of a line — and because the multiplier
     never falls as the price rises, the cheapest-first order of every shelf is
     unchanged. */
  const BUD_COST = {
    e:  [0, 24, 28, 24, 32, 72, 32, 80, 88, 130, 120, 140, 130],
    /* Six through ten are the second set of hairstyles. They arrived without
       prices for one release and every one of them showed a bare `0` in the
       shop — an option that looks broken rather than free. A row shorter than
       its list is now a failing check; see tools/smoke-test.mjs. */
    r:  [0, 32, 88, 96, 40, 140, 36, 160, 150, 170, 104],
    h:  [0, 36, 32, 96, 120, 170, 40, 160, 190, 120, 104, 44, 220],
    f:  [0, 104, 44, 112, 240, 120, 170, 40, 48, 190],
    a:  [0, 28, 32, 80, 120, 88, 130, 88, 140],
    o:  [0, 180, 200, 275, 400, 80, 300, 180, 70, 200, 84, 192, 310, 208, 76],
    /* **No free antic.** He had the swing from the first minute and it was the
       one thing in the shop nobody would ever buy — the flashiest item, given
       away. Buying your first is now the first thing embers are for, and until
       you have one he simply does not appear: an empty timer screen is a
       question, and a man swinging across it for free is not.

       Ordered by what they are worth to look at rather than by index: the
       reader turns a page, the swing crosses the whole window on webs it
       throws. `BUD_ANIM_ORDER` is what the shelf shows, cheapest first. */
    an: [500, 70, 240, 350, 425, 220, 90, 60],
  };
  /* How a purchase is filed in `Embers.own`: the row's letter and the index,
     so `bud-h8` is the wizard hat and `bud-an3` is the skateboard. Parsed by
     `priceOf` in 37-embers.js, which has to be able to price anything it finds
     in `own` or the ember balance drifts — see `embersFrom` in 47-merge.js. */
  /* Cheapest first, by index. Written out rather than sorted at render time so
     that two antics at the same price keep a stable order. */
  const BUD_ANIM_ORDER = [7, 1, 6, 5, 2, 3, 4, 0];

  const BUD_ITEM = 'bud-';
  function budItemId(row, i){ return BUD_ITEM + row + i; }
  function budCost(row, i){
    const list = BUD_COST[row];
    return (list && list[i]) || 0;
  }
  /** The price of anything filed under `bud-`, for the ember maths. */
  function budPriceOf(id){
    const m = /^bud-(an|[a-z])(\d+)$/.exec(String(id || ''));
    return m ? budCost(m[1], parseInt(m[2], 10)) : 0;
  }
  /** Is it his? Index 0 always is; everything else has to have been bought. */
  function budOwns(row, i){
    i = i | 0;
    /* Index 0 of a wardrobe row is "bare", and bare is always available. The
       antics have no such entry — index 0 is the web-swing, which is a thing
       you buy like any other. */
    if(!i && row !== 'an') return true;
    if(i < 0) return false;
    try{ return Embers.own.indexOf(budItemId(row, i)) >= 0; }catch(e){ return false; }
  }
  /** Everything in a row he could actually wear. */
  function budOwnedIn(row, list){
    const out = [];
    for(let i = 0; i < list.length; i++) if(budOwns(row, i)) out.push(i);
    return out;
  }

  /* **Nothing stays on him that he does not own.**

     The shop arrived after the wardrobe did, so on the update everything came
     off and has to be bought back. Rather than a migration that runs once and a
     flag to remember it by, this is simply true all the time: anything he is
     wearing that is not in `own` comes off, checked at boot and again whenever
     an account changes what is owned. A rule that holds continuously cannot be
     half-applied, and it also closes the case nobody would have thought to
     write a migration for — signing into an account that owns less than this
     device did.

     Only *his*. Everybody else's buddy is drawn from the numbers they send;
     what they have bought is their business and their app's. */
  function budStrip(){
    /* **Never against a list that is not the real one.**
       `Embers.own` starts life as `['seaglass']` and stays that way until the
       record comes back out of storage — and `budOwns` answers "no" for
       anything it cannot read. Run in that window and this takes off
       everything he owns and *writes it down*, which is the antic that
       randomly resets: not random, just early. `ready` is set at the end of
       `Embers.load()`, so it is the one moment at which "not in the list"
       means "not bought" rather than "not looked yet". */
    let ready = false;
    try{ ready = Embers.ready === true && Array.isArray(Embers.own) && Embers.own.length > 0; }catch(e){}
    if(!ready) return false;

    const v = budClean(S.buddy);
    let changed = false;
    for(const row of BUD_ROWS){
      if(v[row.k] && !budOwns(row.id, v[row.k])){ v[row.k] = 0; changed = true; }
    }
    if(changed){ S.buddy = v; changed = true; }
    /* **The antic is hidden, not forgotten.** No antic is -1, not 0 — 0 is the
       web-swing, which is bought like everything else. But clearing the number
       is destructive and it does not buy anything: `budAnimIdx()` and
       `budAnimSaved()` both already answer -1 for an antic that is not owned,
       so an unowned one is neither drawn nor sent to a room either way. The
       difference is what happens when the ownership comes *back* — an account
       finishing its sync, a merge landing late. Leave the number alone and the
       antic he picked is still his; overwrite it and it is gone for good on
       the strength of a list that was wrong for a second. */
    if(changed){ try{ save(); }catch(e){} }
    return changed;
  }


  /* What goes *inside* a slot. Pulled out of `stage()` because the room crowd
     fills slots too and there must be exactly one answer to "how is a buddy of
     this pose built" — the swing's rig especially, which is three elements that
     only work together. */
  function budFill(v, size, pose){
    if(pose === 'swing'){
      /* **Swinging hangs off a rig.** The rope reaches the top of the layer and
         he hangs at the bottom of it, and the *rig* is what rotates — so the
         rope and the man pivot together about a real anchor instead of him
         turning on the spot beneath a line that stays put. Two identical ropes
         taking turns: `b` differs only by a negative delay of one swing, so
         whichever one he throws is the one he ends up hanging from. */
      return '<div class="bud-rig">'
        + '<i class="bud-rope bud-rope-a"></i>'
        + '<i class="bud-rope bud-rope-b"></i>'
        + budSvg(v, size, pose) + '</div>';
    }
    /* **The skater hangs off a rig too, for the same kind of reason as the
       swing.** Two things want to rotate him: the orbit, which turns him a
       quarter turn at every corner so the board stays against the edge, and the
       wheelie, which tips him back on the spot. `rotate` is one property and
       the second would simply replace the first, so they are given an element
       each — the rig carries the orbit, the drawing inside it does the trick. */
    if(pose === 'skate') return '<div class="bud-ride">' + budSvg(v, size, pose) + '</div>';
    return budSvg(v, size, pose);
  }

  /* ---------------- the shop's half ----------------
     Written here, next to the parts and the prices, and called from
     `Embers.html()` in 37-embers.js — which runs earlier in the file order, so
     these are function declarations rather than methods on anything. The same
     reason `logSession` is a declaration: hoisting is what lets a lower file
     call a higher one. */

  /** The swatches for a part's colour dial. Index 0 is the colour it was drawn
      in, so the row starts with "as made" rather than with a colour that is not
      an option anybody chose. */
  function budTintSwatches(part, pal){
    const both = ((part && part.b) || '') + ((part && part.s) || '');
    const first = (both.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}\b/) || ['#8d97a8'])[0];
    return (pal || BUD_TINT).map((c, i)=>(i === 0 ? first : c));
  }

  /** How many things he has not got yet, for the line on the shop button. */
  function budUnowned(){
    let n = 0;
    for(const r of BUD_ROWS){
      const list = r.list();
      for(let i = 1; i < list.length; i++) if(!budOwns(r.id, i)) n++;
    }
    for(let i = 1; i < BUD_ANIMS.length; i++) if(!budOwns('an', i)) n++;
    return n;
  }

  /** What the shop is drawing him as: himself, plus everything being tried.

      **A whole outfit, not one thing at a time.** The first version held a
      single item and swapped it out on the next tap, which is fine for "what
      does that hat look like" and useless for the actual question, which is
      whether the hat goes with the coat. `tryOn` is a bag of rows now — one
      entry each, because you cannot wear two hats — and the bar under him
      lists the lot with what they come to. */
  function budTried(){
    const v = budMine();
    const t = Buddy.tryOn;
    if(t) for(const k in t) if(BUD_ROWS.some(r=>r.k === k)) v[k] = t[k];
    return v;
  }
  /** Everything being tried, as rows, cheapest question first: what is it,
      what does it cost, and is it already his. */
  function budTryList(){
    const out = [];
    const t = Buddy.tryOn || {};
    for(const r of BUD_ROWS){
      if(!(r.k in t)) continue;
      const i = t[r.k];
      out.push({r, i, name:budName(r.k, i), cost:budCost(r.id, i), owned:budOwns(r.id, i)});
    }
    return out;
  }

  /** One square with a picture and a caption. The wardrobe and the shop draw
      the same tile — they are the same object seen from two sides, and two
      tile designs for one thing was the wardrobe looking like a settings page
      and the shop looking like a shop. */
  function budTile(r, list, i, v, opts){
    const o = opts || {};
    return '<button class="bud-tile' + (o.mine ? ' mine' : '') + (o.on ? ' on' : '')
      + (o.tried ? ' tried' : '') + (o.far ? ' far' : '') + '"'
      + ' ' + o.attr + '="' + r.k + '" data-i="' + i + '"'
      + ' aria-label="' + esc(list[i].n || (r.name + ' ' + i)) + '">'
      + budIcon(list[i], r.ink ? 0 : v[r.t], r.ink ? budTileInk(v.ec) : '', budPal(r.k))
      /* A price gets its own class so the label's ellipsis clip does not
         reach it — see `.bud-tile em.bud-price` in 30-embers.css. */
      + '<em' + (o.mark ? ' class="bud-price"' : '') + '>'
      + (o.mark ? embMark() : '') + esc(o.label) + '</em></button>';
  }

  function budShopTile(r, list, i, v){
    const owned = budOwns(r.id, i);
    const worn = v[r.k] === i;
    const tried = Buddy.tryOn && Buddy.tryOn[r.k] === i;
    const cost = budCost(r.id, i);
    const afford = (()=>{ try{ return Embers.have >= cost; }catch(e){ return false; } })();
    return budTile(r, list, i, v, {
      attr:'data-shop', mine:owned, on:worn && !Buddy.tryOn, tried,
      far: !owned && !afford,
      label: owned ? (worn ? 'worn' : 'yours') : String(cost),
      mark: !owned,
    });
  }

  /** The Buddy shelf: him at the top, everything there is underneath, and one
      line under him saying what the thing he is currently trying costs. */
  function budShopHtml(){
    const v = budTried();
    const tried = budTryList();
    const due = tried.filter(x=>!x.owned).reduce((n, x)=>n + x.cost, 0);
    let afford = false;
    try{ afford = Embers.have >= due; }catch(e){}
    let bar = '<p class="bud-try-note">Tap anything to try it on. '
      + 'Nothing is bought until you say so.</p>';
    if(tried.length){
      bar = '<div class="bud-try">'
        + '<ul class="bud-try-list">' + tried.map(x=>
            '<li' + (x.owned ? ' class="mine"' : '') + '><b>' + esc(x.name) + '</b>'
            + '<span>' + (x.owned ? 'yours' : embPrice(x.cost)) + '</span></li>').join('') + '</ul>'
        + '<div class="bud-try-do">'
        + (due
            ? '<button class="mini-btn' + (afford ? ' primary' : '') + '" id="bud-try-buy"'
              + (afford ? '' : ' disabled') + '>'
              + (afford ? 'Buy ' + (tried.filter(x=>!x.owned).length > 1 ? 'these' : 'it')
                          + ' for ' + embPrice(due)
                 : embPrice(due)) + '</button>'
            : '<button class="mini-btn primary" id="bud-try-wear">Wear it</button>')
        + '<button class="mini-btn" id="bud-try-off">Take it all off</button></div></div>';
    }
    return '<div class="bud-shop">'
      + '<div class="bud-shop-stage">' + budSvg(v, 108) + '</div>'
      + bar
      + BUD_ROWS.map(r=>{
          const list = r.list();
          const left = [];
          for(let i = 1; i < list.length; i++) if(!budOwns(r.id, i)) left.push(i);
          return '<p class="emb-head">' + r.name
            + ' <em>' + (left.length ? left.length + ' to go' : 'all yours') + '</em></p>'
            /* **Cheapest first.** A shelf in list order is in the order the
               drawings happened to be written, which is no order at all to the
               person paying. Ties keep their index order, so the shelf does not
               reshuffle itself between two things that cost the same. */
            + '<div class="bud-tiles">'
            + [...Array(list.length).keys()].slice(1)
                .sort((a, b)=>(budCost(r.id, a) - budCost(r.id, b)) || (a - b))
                .map(i=>budShopTile(r, list, i, v)).join('')
            + '</div>';
        }).join('')
      + '</div>';
  }

  /** The Antics shelf. Separate from the wardrobe because it is a different
      kind of thing to buy — not what he looks like but what he *does*, and the
      dearest things in the shop. */
  function budAnticShopHtml(){
    const now = budAnimIdx();
    return '<div class="bud-shop">'
      + '<p class="emb-spend">What he does while the clock runs. One at a time.</p>'
      + '<div class="emb-lights">' + BUD_ANIM_ORDER.map(i=>{
          const a = BUD_ANIMS[i];
          const owned = budOwns('an', i);
          const on = owned && now === i;
          const cost = budCost('an', i);
          let afford = false;
          try{ afford = Embers.have >= cost; }catch(e){}
          return '<button class="emb-light' + (owned ? ' mine' : '') + (on ? ' on' : '')
            + (!owned && !afford ? ' far' : '') + '" data-antic="' + i + '"'
            + ' style="--lit:var(--accent)">'
            + embIcon(a.ic) + '<b>' + esc(a.n) + '</b>'
            + '<em>' + (owned ? (on ? 'in use' : (cost ? 'owned' : 'free')) : embPrice(cost)) + '</em>'
            + '<span>' + esc(a.d) + '</span></button>';
        }).join('') + '</div></div>';
  }

  /** Everything the two shelves do when they are tapped. */
  function budShopWire(box){
    box.querySelectorAll('[data-shop]').forEach(b=>{
      b.onclick = ()=>{
        const k = b.dataset.shop, i = +b.dataset.i;
        const r = BUD_ROWS.find(x=>x.k === k);
        if(!r) return;
        /* Something you own goes straight on — the trying is for the things you
           have not bought, and making you tap twice for your own hat is the
           kind of politeness nobody thanks you for. */
        if(budOwns(r.id, i) && !(Buddy.tryOn && k in Buddy.tryOn)){
          Buddy.set(k, budMine()[k] === i ? 0 : i);
          try{ Embers.render(); }catch(e){}
          return;
        }
        const t = Object.assign({}, Buddy.tryOn || {});
        if(t[k] === i) delete t[k]; else t[k] = i;
        Buddy.tryOn = Object.keys(t).length ? t : null;
        try{ Embers.render(); }catch(e){}
      };
    });
    box.querySelectorAll('[data-antic]').forEach(b=>{
      b.onclick = ()=>{
        const i = +b.dataset.antic;
        if(budOwns('an', i)){ Buddy.setAnim(i); try{ Embers.render(); }catch(e){} return; }
        budBuy('an', i, ()=>{ Buddy.setAnim(i); });
      };
    });
    const wearAll = ()=>{
      const t = Buddy.tryOn || {};
      Buddy.tryOn = null;
      const v = budMine();
      for(const k in t) v[k] = t[k];
      Buddy.draft = v;
      Buddy.render(); Buddy.clearSlots(); Buddy.stage();
      try{ Embers.render(); }catch(e){}
    };
    const wear = box.querySelector('#bud-try-wear');
    if(wear) wear.onclick = wearAll;
    const off = box.querySelector('#bud-try-off');
    if(off) off.onclick = ()=>{ Buddy.tryOn = null; try{ Embers.render(); }catch(e){} };
    const buy = box.querySelector('#bud-try-buy');
    if(buy) buy.onclick = ()=>{
      const want = budTryList().filter(x=>!x.owned);
      if(!want.length) return;
      const due = want.reduce((n, x)=>n + x.cost, 0);
      let have = 0;
      try{ have = Embers.have; }catch(e){}
      if(have < due){ toast(due + ' embers for that lot'); return; }
      askConfirm(want.length === 1 ? 'Buy the ' + want[0].name.toLowerCase() + '?'
                                   : 'Buy all ' + want.length + '?',
        want.map(x=>x.name).join(', ') + ', ' + due + ' embers, yours for good.',
        'Spend ' + due, ()=>{
          try{
            if(Embers.have < due) return;
            Embers.have -= due;
            for(const x of want) Embers.own.push(budItemId(x.r.id, x.i));
            Embers.save();
            chime(false);
          }catch(e){}
          wearAll();
          toast(want.length === 1 ? 'Bought. It is yours.' : 'Bought. They are yours.');
        });
    };
  }

  /** Spend the embers, write it down, and put the thing on.

      The confirm is the same shape as the one a light asks, because it is the
      same question and a second dialog language would be a second thing to
      learn. `Embers.own` is what makes it his — it syncs with the account and
      `priceOf` in 37-embers.js can price it, which is what keeps the balance
      derivable rather than stored. */
  function budBuy(row, i, then){
    const cost = budCost(row, i);
    const name = row === 'an' ? BUD_ANIMS[i].n
      : (BUD_ROWS.find(r=>r.id === row) || {one:'thing'}).one;
    let have = 0;
    try{ have = Embers.have; }catch(e){}
    if(have < cost){ toast(cost + ' embers for that one'); return; }
    askConfirm('Buy this ' + name.toLowerCase() + '?',
      cost + ' embers, yours for good.',
      'Spend ' + cost, ()=>{
        try{
          if(Embers.have < cost) return;
          Embers.have -= cost;
          Embers.own.push(budItemId(row, i));
          Embers.save(); Embers.render();
          chime(false);
        }catch(e){}
        if(then) then();
        toast('Bought. It is yours.');
      });
  }

  /** Whatever is stable about somebody, for keying their slot off. */
  /* The peer id is a throwaway that changes on every reconnection, so it is the
     last thing tried rather than the first — hashing it would move somebody's
     buddy across the screen every time the connection blinked. */
  function budId(p){ return String((p && (p.code || p.name || p.id)) || ''); }

  /** A small stable number from a string. Not a hash for anything that matters
      — it decides where somebody stands and how far into their own animation
      they are, and the only property it needs is that it does not change. */
  function budSeed(str){
    let h = 2166136261;
    for(let i = 0; i < str.length; i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h | 0);
  }

  const Buddy = {
    /** The editor, on the account page. */
    render(){
      const box = $('bud-box');
      if(!box) return;
      /* **No buddy without an account.** It is the thing other people see next
         to your name, it rides on the account, and it comes back on a new
         device because the account carries it. Offering it to somebody with
         nowhere to keep it is offering them something that vanishes. */
      let locked = false;
      try{ locked = accConfigured() && !Account.token; }catch(e){}
      if(locked){
        box.innerHTML = '<p class="bud-locked">Sign in to make a buddy.</p>';
        return;
      }
      const v = budMine();
      const dirty = !budSame(budMine(), budSaved())
        || (this.anim != null && this.anim !== budAnimSaved());
      /* **The wardrobe holds what you own; the shop holds what you don't.**
         Rows used to list every part there is and grey out nothing, which was
         fine while everything was free. Now a row is your things — so the row
         is short, it is all wearable, and the reason it is short is one button
         away rather than a wall of locked tiles you have to read past every
         time you want a different hat. */
      const swatches = (key, cols, label)=>
        '<div class="bud-row"><span>' + label + '</span><div class="bud-opts">'
        + cols.map((col, i)=>
            '<button class="bud-opt sw' + (v[key] === i ? ' on' : '') + '"'
            + ' data-bud="' + key + '" data-i="' + i + '" style="--sw:' + col + '"'
            + ' aria-label="' + esc(label) + ' ' + (i + 1) + '"'
            + (v[key] === i ? ' aria-pressed="true"' : '') + '></button>').join('')
        + '</div></div>';
      /* **The wardrobe is the shop with the prices taken off.** They were two
         layouts for one thing — a settings page here and a shop there — and
         switching between them was learning the same list twice. Same tiles,
         same headings, same order; what changes is that this one holds only
         what is his and says what each thing is called.

         The colours are the exception the other way: skin and body are the two
         choices everybody makes first, they are free, and a swatch *is* a
         picture of itself — so those two stay the rows they always were. */
      const row = (r)=>{
        const list = r.list();
        const mine = budOwnedIn(r.id, list);
        const dyeable = !r.ink && v[r.k] && list[v[r.k]].dye;
        return '<p class="emb-head bud-sec">' + r.name
          + (r.ink
              ? ' <button class="bud-dial" data-eyes="1">Adjust</button>'
              : (dyeable ? ' <button class="bud-dial" data-dye="' + r.k + '">Colour</button>' : ''))
          + '</p>'
          + (Buddy.dyeOpen === r.k && dyeable
              ? swatchSheet(r.t, budTintSwatches(list[v[r.k]], budPal(r.k)), r.dye)
              : '')
          + (r.ink && Buddy.eyeOpen ? eyePanel() : '')
          + '<div class="bud-tiles">'
          + mine.map(i=>budTile(r, list, i, v, {
              attr:'data-bud', mine:true, on:v[r.k] === i, label:list[i].n || String(i),
            })).join('')
          + '</div>';
      };
      /* **The colour sheet opens, is used, and closes.** Every row having its
         palette permanently on screen was thirteen swatches per row and a page
         you had to scroll past to reach the next thing you actually wanted. */
      const swatchSheet = (key, cols, label)=>
        '<div class="bud-sheet"><span>' + esc(label) + '</span><div class="bud-opts">'
        + cols.map((col, i)=>
            '<button class="bud-opt sw' + (v[key] === i ? ' on' : '') + '"'
            + ' data-bud="' + key + '" data-i="' + i + '" style="--sw:' + col + '"'
            + ' aria-label="' + esc(label) + ' ' + (i + 1) + '"></button>').join('')
        + '<button class="mini-btn bud-sheet-done" data-dye="">Done</button>'
        + '</div></div>';
      /* **The eyes are three dials and an ink, in a drawer of their own.**
         Bigger, wider apart and higher up are adjustments to whichever pair he
         has on, not more pairs — and as sliders they are one gesture each
         rather than a row of squares that all look the same. */
      const eyePanel = ()=>
        '<div class="bud-sheet bud-eyes">'
        + [['es', 'Size'], ['ex', 'Apart'], ['ey', 'Height']].map(([k, n])=>
            '<label class="bud-slider"><span>' + n + '</span>'
            + '<input type="range" min="0" max="' + (BUD_EYE_STEPS - 1) + '" step="1"'
            + ' value="' + v[k] + '" data-eye="' + k + '"/></label>').join('')
        + '<span class="bud-sheet-lab">Ink</span><div class="bud-opts">'
        + BUD_INK.map((col, i)=>
            '<button class="bud-opt sw' + (v.ec === i ? ' on' : '') + '"'
            + ' data-bud="ec" data-i="' + i + '" style="--sw:' + col + '"'
            + ' aria-label="Eye ink ' + (i + 1) + '"></button>').join('')
        + '<button class="mini-btn bud-sheet-done" data-eyes="">Done</button>'
        + '</div></div>';
      const antics = BUD_ANIM_ORDER.filter(i=>budOwns('an', i));
      box.innerHTML = '<div class="bud-stage">' + budSvg(v, 116) + '</div>'
        /* Straight under him, because it is the answer to the question the
           short rows below raise. It was at the bottom, past everything. */
        + '<button class="bud-shop-btn" id="bud-shop">'
          + '<b>Buddy shop</b><span>' + budUnowned() + ' more to try on</span>'
          + '<i aria-hidden="true">→</i></button>'
        + swatches('c', BUD_SKIN, 'Skin')
        + swatches('b', BUD_BODY, 'Colour')
        + BUD_ROWS.map(row).join('')
        + '<p class="emb-head bud-sec">Antics</p>'
        + '<div class="bud-tiles">'
          + antics.map(i=>
              '<button class="bud-tile mine' + (budAnimIdx() === i ? ' on' : '') + '"'
              + ' data-anim="' + i + '" aria-label="' + esc(BUD_ANIMS[i].n) + '"'
              + (budAnimIdx() === i ? ' aria-pressed="true"' : '') + '>'
              + '<svg class="bud-ic" viewBox="0 0 24 24" width="26" height="26"'
              + ' aria-hidden="true" focusable="false">' + BUD_ANIMS[i].ic + '</svg>'
              + '<em>' + esc(BUD_ANIMS[i].n) + '</em></button>').join('')
          + '</div>'
        + (budAnim()
            ? '<p class="bud-anim-name"><b>' + esc(budAnim().n) + '</b>: ' + esc(budAnim().d) + '</p>'
            /* **Nothing bought yet, so there is nothing for him to do.** Said
               here rather than left as an empty row, because an empty row reads
               as a thing that has not loaded. */
            : '<p class="bud-anim-note">No antic yet, so he stays off the timer screen.</p>')
        + '<div class="bud-save' + (dirty ? ' on' : '') + '">'
          + '<span>' + (dirty ? 'Unsaved changes' : 'Saved') + '</span>'
          /* **Never disabled, unlike the other two.** Undo and Save are about
             work in progress; starting over is about the buddy, and wanting a
             clean one is not a thing that requires having already changed
             something. */
          + '<button class="mini-btn" id="bud-reset">Start over</button>'
          + '<button class="mini-btn" id="bud-revert"' + (dirty ? '' : ' disabled') + '>Undo</button>'
          + '<button class="mini-btn" id="bud-save"' + (dirty ? '' : ' disabled') + '>Save buddy</button>'
          + '</div>'
        + '<label class="bud-show"><input type="checkbox" id="bud-onscreen"'
          + (S.budShow === false ? '' : ' checked') + '/>'
          + '<span>Show him on the timer screens</span></label>';
      const sh = $('bud-shop');
      if(sh) sh.onclick = ()=>{ try{ shopOpen('buddy'); }catch(e){} };
      /* The two drawers, and the three dials inside one of them. A slider
         redraws *him* on every move but not the panel it lives in — rebuilding
         the panel mid-drag takes the slider out from under your thumb. */
      box.querySelectorAll('[data-dye]').forEach(b=>{
        b.onclick = ()=>{ Buddy.dyeOpen = b.dataset.dye || null; Buddy.eyeOpen = false; Buddy.render(); };
      });
      box.querySelectorAll('[data-eyes]').forEach(b=>{
        b.onclick = ()=>{ Buddy.eyeOpen = b.dataset.eyes === '1'; Buddy.dyeOpen = null; Buddy.render(); };
      });
      box.querySelectorAll('[data-eye]').forEach(sl=>{
        sl.oninput = ()=>Buddy.setQuiet(sl.dataset.eye, +sl.value);
      });
      const sv = $('bud-save'); if(sv) sv.onclick = ()=>Buddy.commit();
      const rv = $('bud-revert'); if(rv) rv.onclick = ()=>Buddy.revert();
      const rs = $('bud-reset'); if(rs) rs.onclick = ()=>Buddy.resetAll();
      const t = $('bud-onscreen');
      if(t) t.onchange = ()=>{ S.budShow = !!t.checked; save(); Buddy.stage(); };
    },

    draft:null,
    anim:null,          // the unsaved antic; null is "unchanged", not zero
    /* What he is trying on in the shop but has not bought. Kept apart from the
       draft on purpose: a draft is a change you are about to save, and this is
       a thing that is not yours yet. It never reaches `S.buddy`, the room or
       the account, and it is dropped when the shop closes. */
    tryOn:null,
    /* Which drawer is open, if any: a row's colour sheet, or the eye dials.
       One at a time — two open drawers is a page of drawers. */
    dyeOpen:null,
    eyeOpen:false,

    /* Into the draft. Nothing is written down and nobody in the room is told
       until Save — trying on six hats should not be six announcements. */
    set(key, i){
      const v = budMine();
      v[key] = i;
      this.draft = v;
      this.render();
      this.stage();
    },

    /* **Everything back to how he started, in one press.**
       Every row to "none", every colour to as-made, and the three eye dials to
       the middle — which is the bit that needed saying out loud, because the
       dials are not zero at rest: `budDefault()` puts them at `BUD_EYE_MID`,
       and a reset that sent them to 0 would leave him with tiny eyes jammed
       together and no obvious way back.

       A draft like any other change, so the save bar lights up and Undo is
       sitting right beside the button — nothing is written down until Save.

       **The antic is deliberately left alone.** It is the one thing on this
       page that was paid for, and there is no "no antic" tile to choose, so
       clearing it would take away something bought with no way to put it back.
       Starting over is about how he looks. */
    resetAll(){
      this.draft = budDefault();
      this.dyeOpen = null;
      this.eyeOpen = false;
      this.render();
      this.clearSlots();
      this.stage();
      toast('Back to how he started');
    },

    /* The antic, into the draft with everything else. */
    setAnim(i){
      this.anim = i | 0;
      this.render();
      this.clearSlots();
      this.stage();
    },

    /* Into the draft and onto the drawing, without rebuilding the panel the
       change came from. Only the sliders use this; everything else is a tap,
       and a tap can afford a redraw. */
    setQuiet(key, i){
      const v = budMine();
      v[key] = i | 0;
      this.draft = v;
      try{
        document.querySelectorAll('.bud-stage, .bud-shop-stage').forEach(el=>{
          el.innerHTML = budSvg(v, el.classList.contains('bud-stage') ? 116 : 108);
        });
      }catch(e){}
      const bar = $('bud-box') && $('bud-box').querySelector('.bud-save');
      if(bar){
        const dirty = !budSame(budMine(), budSaved())
          || (this.anim != null && this.anim !== budAnimSaved());
        bar.classList.toggle('on', dirty);
        const lab = bar.querySelector('span');
        if(lab) lab.textContent = dirty ? 'Unsaved changes' : 'Saved';
        bar.querySelectorAll('.mini-btn').forEach(b=>{ b.disabled = !dirty; });
      }
      this.stage();
    },

    commit(){
      if(!this.draft && this.anim == null) return;
      if(this.draft) S.buddy = budClean(this.draft);
      if(this.anim != null) S.budAnim = this.anim | 0;
      this.draft = null; this.anim = null;
      save();
      this.render();
      this.stage();
      /* Everybody in the room is looking at the old one until they are told,
         and the account is the thing that carries him between devices. */
      try{ syncBroadcast({t:'buddy', buddy:budSaved(), anim:budAnimSaved()}); }catch(e){}
      try{ Account.sync(true); }catch(e){}
      toast('Buddy saved.');
    },

    revert(){
      if(!this.draft && this.anim == null) return;
      this.draft = null; this.anim = null;
      this.render();
      this.clearSlots();
      this.stage();
    },

    /* `stage()` skips work when the signature matches, and changing the antic
       changes which *slot* is used rather than what is in it — so the old one
       has to be emptied by hand or the previous pose stays on screen. */
    clearSlots(){
      ['bud-live','bud-pause'].forEach(id=>{ const n = $(id); if(n){ n.innerHTML = ''; n.dataset.pose = ''; } });
    },

    /* Leaving the page with changes in hand. Asked rather than assumed either
       way: silently keeping them makes Save a lie, silently dropping them makes
       the page a trap. */
    leaving(done){
      const changed = (this.draft && !budSame(this.draft, budSaved()))
        || (this.anim != null && this.anim !== budAnimSaved());
      if(!changed){ this.draft = null; this.anim = null; return done(); }
      /* **Three answers, because there are three.** Save and go, throw the
         changes away and go, or go back to dressing him. It used to be two,
         with "Cancel" meaning *discard* — so the only way to say "I did not
         mean to press Back" was the close box, which is not something anybody
         reads as an answer to a question. `Keep editing` is that answer,
         spelled out. */
      askConfirm('Save your buddy?',
        'You have unsaved changes.',
        'Save', ()=>{ Buddy.commit(); done(); },
        {
          no: 'Discard',
          onNo: ()=>{
            Buddy.draft = null; Buddy.anim = null;
            Buddy.render(); Buddy.clearSlots(); Buddy.stage();
            done();
          },
          alt: { label: 'Keep editing', run: ()=>{} },
        });
    },

    /* ---- him, actually on the screen ----
       Perched on the minutes box before you start, swimming through the focus
       block, asleep through the rest. He is decoration and knows it: no layout
       depends on him, he is `pointer-events:none`, and switching him off or
       signing out takes him away without anything moving. */
    /* **Two different questions.** `on()` is "do *I* have a buddy to show" —
       which needs an account, because he lives on it. `shown()` is "do I want
       to see buddies at all", which is the switch and nothing else: not being
       signed in yourself is no reason to blank out everybody else's in a room.
       Conflating them hid the whole column from anyone signed out. */
    shown(){ return S.budShow !== false; },

    on(){
      if(!this.shown()) return false;
      /* Same rule as the editor: no account, no buddy. In a build with no
         account server at all there is nothing to sign into, so he stays. */
      try{ if(accConfigured() && !Account.token) return false; }catch(e){}
      return true;
    },

    /* Three slots, at most one of them filled.

       On the main menu he is always on the minutes box, jumping — that is the
       screen you look at while deciding, and a figure crouching and springing
       there is the whole invitation. The chosen antic is for the clock screens,
       where you are meant to be looking at something else. */
    stage(){
      const live = this.on();
      const setup = live && S.mode === 'setup';
      /* **No antic, nothing on the clock screens.** He does not stand about
         doing nothing until one is bought: an idle figure reads as a broken
         animation rather than as an empty slot, and the empty slot is the whole
         argument for buying one. The perch on the main menu is *not* an antic —
         it is where he waits while you decide, and the only way to see the
         buddy you have just dressed before you have bought him something to
         do. */
      const anim = budAnim();
      const doing = !!anim;
      const paint = (id, on, pose, size)=>{
        const slot = $(id);
        if(!slot) return;
        slot.classList.toggle('hide', !on);
        if(!on){
          if(slot.dataset.pose){ slot.innerHTML = ''; slot.dataset.pose = ''; }
          return;
        }
        /* Only redraw when something actually changed. This is called from the
           timer's render, which runs once a second for the whole of a block,
           and replacing the SVG would restart every animation on it — he would
           twitch back to the start of his stroke every second. */
        const sig = pose + ':' + JSON.stringify(budMine());
        if(slot.dataset.pose === sig) return;
        /* **The pose class goes here and nowhere else.** The travel is written
           as `.bud-swing{ left:0; right:0; animation:bud-go }`, and the slot is
           the thing that spans the window, so the slot is the thing that has to
           carry it. `budSvg()` used to stamp the same class on the `<svg>` as
           well; both then ran `bud-go`, the drawing drifted out from under the
           rope, and the web looked severed. It emits a bare `class="bud"` now —
           see the note there before putting a pose class back on it. */
        /* **The slot is replaced, not refilled — because two clocks have to
           start together.**

           The travel is an animation on the slot (`bud-go`, 7.8s) and the swing
           and the mirror are animations on the rig *inside* it (`bud-arc` 1.3s,
           `bud-turn` 7.8s). Every period divides the lap exactly, so once they
           start together they stay locked for ever, and the whole antic is
           built on that: the arc, the throw and the handover are all timed
           against where the traverse has got to.

           Nothing in CSS re-locks them. Writing `innerHTML` builds a new rig,
           whose animations start *now*, while the slot's own `bud-go` carries
           on from wherever it was — and the two are then out of phase until
           something hides the slot. Measured at 1450ms, most of a whole swing:
           he swings backwards under his own web, mirrors himself in the middle
           of a crossing, and hangs about at the edge of the window. That is the
           "web swinging is broken, but not always" and the "skateboard turns
           too early, but not always" — the same bug, once for each pose, and
           the "not always" is that it only starts when something re-renders him
           mid-lap: saving a colour, an account arriving, switching him off and
           on again.

           A fresh element starts *all* of its animations, and its children's,
           at the same moment. So the slot is rebuilt rather than refilled, and
           the pair can never drift apart again. `tools/look-swing.mjs` measures
           the phase error in a real browser; jsdom has no animation engine and
           cannot see this at all, which is why it survived so long.

           **The pose class goes on the slot and nowhere else.** The travel is
           written as `.bud-swing{ left:0; right:0; animation:bud-go }`, and the
           slot is the thing that spans the window. `budSvg()` used to stamp the
           same class on the `<svg>` as well; both then ran `bud-go`, the
           drawing drifted out from under the rope, and the web looked severed.
           It emits a bare `class="bud"` now — see the note there before putting
           a pose class back on it.

           **Swinging hangs off a rig.** The rope reaches the top of the layer
           and he hangs at the bottom of it, and the *rig* is what rotates — so
           the rope and the man pivot together about a real anchor instead of
           him turning on the spot beneath a line that stays put. Two ropes: the
           one he is on and the one he is throwing; the CSS decides which is
           lit, in step with the arc. The rig measures the rope and his own
           offset from his rendered size, so it has to be told what that is —
           one number, one place. */
        const fresh = slot.cloneNode(false);      // same id and attributes, no children
        fresh.className = 'bud-slot bud-' + pose;
        fresh.dataset.pose = sig;
        if(pose === 'swing' || pose === 'skate') fresh.style.setProperty('--bud', size + 'px');
        fresh.innerHTML = budFill(budMine(), size, pose);
        slot.replaceWith(fresh);
      };
      paint('bud-perch', setup, 'perch', 53);
      paint('bud-live', live && !setup && doing && anim.k !== 'onpause', doing ? anim.k : '', 55);
      paint('bud-pause', live && !setup && doing && anim.k === 'onpause', 'onpause', 41);
      /* Whose buddies are on screen and whether the layer is needed are two
         different questions now. `live` is "have *I* got one to show", which
         wants an account; the crowd only wants the switch, because being signed
         out is no reason to blank out the people you are sitting with. */
      const others = this.others();
      const lane = $('bud-layer');
      if(lane) lane.classList.toggle('hide', setup || !(live || others.length));
      this.crowd(others);
      this._roam(live && !setup && doing && anim.k === 'swing');
    },

    /* ---- everybody else in the room ----
       Capped, and the cap is not shyness: the buddy layer and the effects layer
       between them already keep about fifty infinite animations alive, and the
       one time this app was called laggy it was a hundred-odd blurred layers.
       Five others is a room, and a room of five is already busy to look at. */
    CROWD:5,

    others(){
      if(!this.shown() || S.mode === 'setup') return [];
      let all = [];
      try{ all = syncPeople(); }catch(e){ return []; }
      return all.filter(p=>p && !p.me).slice(0, this.CROWD);
    },

    /* One slot each, in the same layer as yours, each running its own antic.

       **They must not move as one.** Five people who all picked the swing on one
       7.8s clock is one buddy drawn five times, and the repetition is the thing
       you notice. `--t` is a negative delay taken from a hash of who they are —
       stable, so somebody does not jump the moment the roster is rebuilt — and
       because custom properties inherit, one value on the slot shifts every
       animation inside it by the same amount. That sameness is the point: the
       swing's travel, arc and webs are phase-locked, and moving one without the
       others takes the man off his own rope. See the note in the stylesheet.

       `--x` and `--y` are for the poses that park. Two people reading in the
       same corner are one person however differently their pages turn. */
    crowd(others){
      const lane = $('bud-layer');
      if(!lane) return;
      others = others || this.others();
      /* Same guard as `paint()`, and for the same reason: this runs from the
         timer's render once a second, and rebuilding the crowd would restart
         every animation in it. Keyed on everything that is drawn — who, what
         they look like, and what they are doing. */
      const sig = others.map(p=>[budId(p), budAnimKey(p.anim), budClean(p.buddy)]
        .map(x=>typeof x === 'object' ? JSON.stringify(x) : x).join('/')).join('|');
      if(lane.dataset.crowd === sig) return;
      lane.dataset.crowd = sig;
      lane.querySelectorAll('.bud-peer').forEach(n=>n.remove());
      others.forEach(p=>{
        const pose = budAnimKey(p.anim);
        /* They have not bought one. Nothing to draw, and inventing a swing for
           them would be showing something they do not own. */
        if(!pose) return;
        const seed = budSeed(budId(p));
        const el = document.createElement('div');
        el.className = 'bud-slot bud-peer bud-' + pose;
        el.setAttribute('aria-hidden', 'true');
        /* Negative, always: a positive delay would have them all standing still
           for a while first, which is worse than being in step. */
        el.style.setProperty('--t', '-' + ((seed % 1600) / 100).toFixed(2) + 's');
        el.style.setProperty('--x', ((seed >> 4) % 240) + 'px');
        el.style.setProperty('--y', ((seed >> 11) % 13) + 'vh');
        if(pose === 'swing' || pose === 'skate') el.style.setProperty('--bud', '55px');
        el.innerHTML = budFill(budClean(p.buddy), 55, pose);
        lane.appendChild(el);
      });
    },

    /* ---- where the swing goes ----
       A pendulum that starts and finishes in the same two places is a metronome.
       Each traverse picks its own anchor height and its own landing point, which
       is what makes it read as somebody getting about rather than a decoration
       running on a loop.

       Done here rather than in CSS because CSS cannot choose a number. The
       animation itself is still entirely CSS — this only sets where it goes,
       once per crossing, off the `animationiteration` event so it never
       interrupts a swing halfway through. */
    /* **Nothing is re-rolled mid-flight, and that is the stutter fixed.**

       `--rope` and `--tilt` were randomised on every `animationiteration`. Both
       are read by animations already running, so changing them moved the anchor
       and the hang length between one frame and the next — he jumped. That was
       not dropped frames, it was a discontinuity written on purpose, and no
       amount of variety is worth a visible seam. Both are constants in the CSS
       now. Kept as a no-op so the call site stays honest about there being
       nothing left to do. */
    _roam(){},
  };

  document.addEventListener('click', (e)=>{
    if(!e.target.closest) return;
    const b = e.target.closest('[data-bud]');
    if(b){ Buddy.set(b.getAttribute('data-bud'), parseInt(b.getAttribute('data-i'), 10) || 0); return; }
    const a = e.target.closest('[data-anim]');
    /* Into the draft, like every other part of him. `commit()` is where the
       room and the account find out, and it is the only place — one message
       kind is one thing for the host to relay and one thing to forget. */
    if(a) Buddy.setAnim(parseInt(a.getAttribute('data-anim'), 10) || 0);
  });
