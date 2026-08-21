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

  /* A dash, for the "none" options. Drawn rather than typed so the row is all
     one kind of thing — a lone character among pictures reads as a mistake. */
  const BUD_NONE = '<path d="M4 12h16" stroke="currentColor" stroke-width="2" '
    + 'stroke-linecap="round" fill="none" opacity=".5"/>';

  /* Eyes carry nearly all of the character, so there are more of these than of
     anything else and none of them is "normal". */
  const BUD_EYES = [
    {s:'<circle cx="26" cy="30" r="3.2"/><circle cx="38" cy="30" r="3.2"/>', box:'20 24 24 12'},
    {s:'<circle cx="26" cy="30" r="4.4"/><circle cx="38" cy="30" r="4.4"/>'
       + '<circle cx="27.4" cy="28.6" r="1.5" fill="#fff"/><circle cx="39.4" cy="28.6" r="1.5" fill="#fff"/>',
     box:'20 24 24 12'},
    {s:'<path d="M22 30h8M34 30h8" stroke-width="3" stroke-linecap="round" fill="none"/>', box:'20 24 24 12'},
    {s:'<circle cx="26" cy="30" r="3"/><path d="M34 31l8-3" stroke-width="3" stroke-linecap="round" fill="none"/>',
     box:'20 24 24 12'},
    {s:'<circle cx="25" cy="31" r="4.6"/><circle cx="39" cy="29" r="2.6"/>', box:'19 24 25 13'},
    {s:'<path d="M22 27l7 4-7 4M42 27l-7 4 7 4" stroke-width="2.6" fill="none" stroke-linecap="round"/>',
     box:'20 25 24 12'},
    {s:'<rect x="21" y="26" width="10" height="8" rx="2"/><rect x="33" y="26" width="10" height="8" rx="2"/>',
     box:'19 24 26 12'},
    {s:'<path d="M22 33a4.5 4.5 0 0 1 9 0M33 33a4.5 4.5 0 0 1 9 0" stroke-width="2.8" fill="none" stroke-linecap="round"/>',
     box:'20 28 24 9'},
  ];

  const BUD_HATS = [
    {s:'', box:'0 0 24 24', none:1},
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
    {s:'<path d="M17.6 20A16 16 0 0 1 46.4 20q-14.4 4.6-28.8 0z" fill="#e01b24"/>'
       + '<path d="M32 11.2v10.6" stroke="#a3131a" stroke-width="1.2" fill="none" opacity=".8"/>'
       + '<path d="M44.6 19.8q11.4 0 13 4.2.6 1.8-1.8 2.4-6.4 1.6-13.4-1.6z" fill="#c0182b"/>'
       + '<path d="M16.9 20q15.1 4.6 30.2 0v3.2q-15.1 4.6-30.2 0z" fill="#8f1116"/>'
       + '<circle cx="32" cy="11.6" r="1.8" fill="#8f1116"/>', box:'15 8 44 20'},
    // beanie
    {s:'<path d="M18 17c0-9 6-13 14-13s14 4 14 13z" fill="#3f8a4a"/>'
       + '<rect x="15" y="16" width="34" height="4" rx="2" fill="#2c6234"/>', box:'14 3 36 19'},
    // top hat
    {s:'<rect x="21" y="6" width="22" height="12" rx="2" fill="#2438a8"/>'
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
    {s:'<path d="M20.5 14.5C13 15 7.5 17.5 3.6 21.8c5.6 1.6 11.6.4 18.4-3.4z" fill="#8a5fd8"/>'
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
    {s:'<path d="M18 19l-2-13 8 5 8-8 8 8 8-5-2 13z" fill="#ffd34a"/>'
       + '<rect x="17" y="18" width="30" height="3.6" rx="1.8" fill="#e0a800"/>'
       + '<circle cx="24" cy="8.5" r="1.5" fill="#e01b24"/>'
       + '<circle cx="40" cy="8.5" r="1.5" fill="#e01b24"/>'
       + '<circle cx="32" cy="4.5" r="1.8" fill="#4fe0c8"/>', box:'15 2 34 21'},
    // hair bow
    {s:'<path d="M30 11q-10-8-12 0t12 4z" fill="#ff8fd0"/>'
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
    {s:'<path d="M13.8 31v-4.6a18.2 18.2 0 0 1 36.4 0v4.6" stroke="#2c3340" stroke-width="3.4" fill="none" stroke-linecap="round"/>'
       + '<rect x="9.4" y="23.4" width="8.4" height="13.6" rx="4.2" fill="#2c3340"/>'
       + '<rect x="46.2" y="23.4" width="8.4" height="13.6" rx="4.2" fill="#2c3340"/>'
       + '<rect x="11.2" y="25.6" width="4.8" height="9.2" rx="2.4" fill="#4a5566"/>'
       + '<rect x="48" y="25.6" width="4.8" height="9.2" rx="2.4" fill="#4a5566"/>', box:'8 6 48 34'},
  ];

  /* Worn on the body. Kept apart from the face on purpose: a tie and a beard
     are not alternatives, and one list meant choosing between them. */
  const BUD_ACC = [
    {s:'', box:'0 0 24 24', none:1},
    // tie
    {s:'<path d="M32 43l-3.4 2.8 3.4 2.8 3.4-2.8z" fill="#c0182b"/>'
       + '<path d="M32 48.6l-3.2 5.4 3.2 2.2 3.2-2.2z" fill="#e01b24"/>', box:'27 41 10 17'},
    // bow tie
    {s:'<path d="M32 46l-9-4v9z" fill="#b78cff"/><path d="M32 46l9-4v9z" fill="#b78cff"/>'
       + '<rect x="30" y="43.5" width="4" height="5" rx="1.4" fill="#8a5fd8"/>', box:'21 40 22 13'},
    /* **It has to reach both sides of him or it is a stripe, not a wrap.** This
       ran 20 to 44 across a body that runs 19 to 45, and those two units of
       body colour showing past each end were the whole difference between a
       band going round him and a band painted on him. It runs the body's full
       width now — a tenth of a unit past it at each end, so no hairline of
       teal survives the antialiasing — and it sits a little lower, on the
       widest part of him, where a belt goes. */
    // scarf, wrapped rather than a bar stuck on the neck
    {s:'<path d="M18.9 43.4q13.1 6.6 26.2 0v5.4q-13.1 6.6-26.2 0z" fill="#f7bd52"/>'
       + '<path d="M21.4 49.4l-2.6 9.2 5.8 1.2 2-9.6z" fill="#e09b1e"/>', box:'17 41 30 21'},
  ];

  /* Worn on the face. Facial hair, glasses and masks all live here because they
     all compete for the same square inches — you cannot have two of them, and
     you can have any of them *and* a tie. */
  const BUD_FACE = [
    {s:'', box:'0 0 24 24', none:1},
    /* A beard sits under the mouth rather than over it — over it reads as a
       mistake, and the mouth is half of what makes these things quirky. */
    /* Follows the jaw and stops short of the mouth. The first one was a solid
       mass from y=36 down, which put its top edge straight through the smile —
       it read as a bib. The inner edge sits at 40 now, below the mouth curve
       (which bottoms out at 39), so the face keeps its expression. */
    // beard
    {s:'<path d="M19.5 32.5q1.5 10.5 12.5 13.5t12.5-13.5q-2.5 8-12.5 8t-12.5-8z" fill="#5c3a24"/>'
       + '<path d="M23 40.5q9 4 18 0-2.5 5-9 5t-9-5z" fill="#4a2e1c"/>', box:'17 30 30 18'},
    /* **In the gap, not on the mouth.** It was drawn at nearly the width of
       the whole face and sat across the smile, which is why it read as a
       mistake rather than as hair. There are only four units between the
       bottom of the eyes (33) and the top of the mouth (37), so it is small
       because it has to be — about a third of the width it was. */
    // moustache
    {s:'<path d="M32 34.6q-2.8-2.2-4.8-.4t1.2 2.8 3.6-2.4z" fill="#5c3a24"/>'
       + '<path d="M32 34.6q2.8-2.2 4.8-.4t-1.2 2.8-3.6-2.4z" fill="#5c3a24"/>', box:'25 32 14 7'},
    // round glasses
    {s:'<circle cx="26" cy="30" r="5.5" fill="none" stroke="#2c3340" stroke-width="1.8"/>'
       + '<circle cx="38" cy="30" r="5.5" fill="none" stroke="#2c3340" stroke-width="1.8"/>'
       + '<path d="M31.5 30h1M20.5 30h-3M43.5 30h3" stroke="#2c3340" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
     box:'16 22 32 16'},
    /* Drawn last, so it covers the head, the eyes and the mouth — which is the
       point of a mask. Wearing it with a hat is allowed and looks it. */
    // spider mask
    {s:'<circle cx="32" cy="27" r="16" fill="#c8102e"/>'
       + '<g stroke="#7d0a1c" stroke-width=".7" fill="none" opacity=".85">'
       + '<path d="M17 23q15 5 30 0M17 29q15 5 30 0M17 35q15 5 30 0"/>'
       + '<path d="M32 11v32M23 13l5 29M41 13l-5 29"/></g>'
       + '<path d="M23.5 23.5q7-3.5 8 3-1 5.5-5.5 5.5t-2.5-8.5z" fill="#fff" stroke="#1a1a1a" stroke-width=".9"/>'
       + '<path d="M40.5 23.5q-7-3.5-8 3 1 5.5 5.5 5.5t2.5-8.5z" fill="#fff" stroke="#1a1a1a" stroke-width=".9"/>',
     box:'14 9 36 36'},
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
  const BUD_OUTER = [
    {s:'', box:'0 0 24 24', none:1},
    /* Pullover, so it closes at the front, and the hood is the point of it —
       an ellipse a little larger than the skull, drawn behind everything, so a
       rim of it shows all the way round like a hood pushed back. */
    // hoodie
    {s:'<path d="M28 36h8a9 9 0 0 1 9 9v1a9 9 0 0 1-9 9h-8a9 9 0 0 1-9-9v-1a9 9 0 0 1 9-9z" fill="#5b7fa8"/>'
       + '<path d="M23.4 46.8h17.2v2.8a3.6 3.6 0 0 1-3.6 3.6H27a3.6 3.6 0 0 1-3.6-3.6z" fill="#4d6d94"/>'
       + '<path d="M29.6 44.2q-1 3.4-1 6.2M34.4 44.2q1 3.4 1 6.2" stroke="#e9edf5" stroke-width="1.3" fill="none" stroke-linecap="round"/>'
       + '<circle cx="28.4" cy="51" r="1.3" fill="#e9edf5"/>'
       + '<circle cx="35.6" cy="51" r="1.3" fill="#e9edf5"/>',
     b:'<ellipse cx="32" cy="29.4" rx="19.8" ry="19.4" fill="#3f5d80"/>', box:'11 9 42 49'},
    // denim jacket
    {s:'<path d="M28 36a9 9 0 0 0-9 9v1a9 9 0 0 0 9 9h2.6v-6z" fill="#3f6ea8"/><path d="M36 36a9 9 0 0 1 9 9v1a9 9 0 0 1-9 9h-2.6v-6z" fill="#3f6ea8"/>'
       + '<path d="M29.6 43.4L30.6 49l-7.2-4.2z" fill="#2d5280"/>'
       + '<path d="M34.4 43.4L33.4 49l7.2-4.2z" fill="#2d5280"/>'
       + '<path d="M21.6 47.6h5.8v4.2h-5.8zM36.6 47.6h5.8v4.2h-5.8z" fill="#35608f"/>'
       + '<path d="M21.4 47.4h6.2M36.4 47.4h6.2" stroke="#9fc4e8" stroke-width=".9" fill="none"/>'
       + '<circle cx="31.4" cy="52.4" r="1.2" fill="#d8b04a"/>', box:'17 41 30 17'},
    /* Quilted, which is the only thing that tells a puffer from a coat at this
       size — three seams across it and a zip down the middle. */
    // puffer
    {s:'<path d="M28 36h8a9 9 0 0 1 9 9v1a9 9 0 0 1-9 9h-8a9 9 0 0 1-9-9v-1a9 9 0 0 1 9-9z" fill="#c0483a"/>'
       + '<path d="M20.4 41.6h23.2M19.9 46.2h24.2M21.6 50.6h20.8" stroke="#a03a2e" stroke-width="1.5" fill="none" stroke-linecap="round"/>'
       + '<path d="M32 36.6v16.8" stroke="#8f3225" stroke-width="1.6" fill="none"/>'
       + '<circle cx="32" cy="43.8" r="1.5" fill="#e9edf5"/>', box:'17 34 30 23'},
    /* Nothing on the front at all but the clasp, so the body colour is
       untouched — the whole garment is behind him. It trails on the swing;
       see `.bud-cape` in the stylesheet. */
    // cape
    {s:'<rect x="26" y="43.4" width="12" height="2.8" rx="1.4" fill="#c92a55"/>'
       + '<circle cx="32" cy="44.8" r="2.2" fill="#ffd34a"/>',
     b:'<path class="bud-cape" d="M23 39q-13 8-15 22 24 7.4 48 0-2-14-15-22z" fill="#8a1f3d"/>'
       + '<path class="bud-cape" d="M27 39.6q-8 7-9.4 19 14.4 3.6 28.8 0-1.4-12-9.4-19z" fill="#a82a4c"/>',
     box:'6 36 52 27'},
    // lab coat
    {s:'<path d="M28 36a9 9 0 0 0-9 9v1a9 9 0 0 0 9 9h2.6v-6z" fill="#eef2f7"/><path d="M36 36a9 9 0 0 1 9 9v1a9 9 0 0 1-9 9h-2.6v-6z" fill="#eef2f7"/>'
       + '<path d="M29.6 43.4L30.6 49.4l-7.6-4.6z" fill="#dbe3ee"/>'
       + '<path d="M34.4 43.4L33.4 49.4l7.6-4.6z" fill="#dbe3ee"/>'
       + '<path d="M21.4 48h6v4.6h-6z" fill="#dbe3ee"/>'
       + '<path d="M24.4 46.6v3.4" stroke="#2f6fd0" stroke-width="1.4" fill="none" stroke-linecap="round"/>'
       + '<circle cx="34" cy="52.4" r="1.2" fill="#c4cede"/>', box:'17 41 30 17'},
    // blazer
    {s:'<path d="M28 36a9 9 0 0 0-9 9v1a9 9 0 0 0 9 9h2.6v-6z" fill="#3f4d6b"/><path d="M36 36a9 9 0 0 1 9 9v1a9 9 0 0 1-9 9h-2.6v-6z" fill="#3f4d6b"/>'
       + '<path d="M29.6 43.4L30.6 49.6l-7.8-4.8z" fill="#57678c"/>'
       + '<path d="M34.4 43.4L33.4 49.6l7.8-4.8z" fill="#3c4a68"/>'
       + '<path d="M21.6 48.4h5.4l-.8 2.6h-3.8z" fill="#e01b24"/>'
       + '<circle cx="31.6" cy="52.6" r="1.3" fill="#c9b06a"/>', box:'17 41 30 17'},
    // cardigan
    {s:'<path d="M28 36a9 9 0 0 0-9 9v1a9 9 0 0 0 9 9h2.6v-6z" fill="#6f8f5a"/><path d="M36 36a9 9 0 0 1 9 9v1a9 9 0 0 1-9 9h-2.6v-6z" fill="#6f8f5a"/>'
       /* **Down to 55 exactly, which is the hem.** Stopping short left a notch of
          body colour below it — the gap between the two panels, showing through
          as a square tab hanging under a rounded coat. Going past it hung the
          placket's own square corners off the curve. 55 is right because the
          placket is 29.4 to 34.6 and the body's bottom edge is flat between 28
          and 36: the two coincide, so there is nothing to round. */
       + '<path d="M29.4 42.6h5.2v12.4h-5.2z" fill="#5b7a48"/>'
       + '<circle cx="32" cy="45" r="1.25" fill="#e6ddc4"/>'
       + '<circle cx="32" cy="48.4" r="1.25" fill="#e6ddc4"/>'
       + '<circle cx="32" cy="51.8" r="1.25" fill="#e6ddc4"/>'
       + '<path d="M22.8 49.6h5.2M36 49.6h5.2" stroke="#5b7a48" stroke-width="1.3" fill="none" stroke-linecap="round"/>', box:'17 41 30 17'},
    /* **Straight-fronted, because a hi-vis has a zip and not lapels** — and
       because the V the other coats use puts a sloping edge exactly where the
       reflective bands have to end, which is how you get bands that stop in
       three different places.

       **Butt caps, and every end computed against the hem.** These were round
       caps, which add half a stroke width *beyond* the point you asked for: a
       2.6-wide band told to stop at x=19 actually reached 17.7, a unit and a
       third outside a garment whose edge is at 19. That is the whole of the
       "sharp shape edges" — not a shape at all, a line cap. */
    // high-vis vest
    {s:'<path d="M30.6 36h-2.6a9 9 0 0 0-9 9v1a9 9 0 0 0 9 9h2.6z" fill="#d8f24a"/>'
       + '<path d="M33.4 36h2.6a9 9 0 0 1 9 9v1a9 9 0 0 1-9 9h-2.6z" fill="#d8f24a"/>'
       + '<path d="M19.3 44.4h10.9M33.8 44.4h10.9" stroke="#c9d4e0" stroke-width="2.4" fill="none"/>'
       + '<path d="M21 50.4h9.2M33.8 50.4h9.2" stroke="#c9d4e0" stroke-width="2.4" fill="none"/>'
       + '<path d="M24.8 43.4v8.2M39.2 43.4v8.2" stroke="#c9d4e0" stroke-width="2" fill="none"/>', box:'17 41 30 17'},
    // raincoat
    {s:'<path d="M28 36h8a9 9 0 0 1 9 9v1a9 9 0 0 1-9 9h-8a9 9 0 0 1-9-9v-1a9 9 0 0 1 9-9z" fill="#f2c14a"/>'
       + '<path d="M32 36.6v16.6" stroke="#d8a12c" stroke-width="1.4" fill="none"/>'
       + '<path d="M27.8 45.6h8.4M27.8 50.2h8.4" stroke="#8f6a12" stroke-width="1.6" fill="none" stroke-linecap="round"/>'
       + '<circle cx="27.4" cy="45.6" r="1.3" fill="#8f6a12"/>'
       + '<circle cx="27.4" cy="50.2" r="1.3" fill="#8f6a12"/>',
     b:'<ellipse cx="32" cy="29.4" rx="19.8" ry="19.4" fill="#d8a12c"/>', box:'11 9 42 49'},
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
      + '<path d="M31.2 35.4l-12.2 2.2v15.2l12.2-1.9z" fill="#6f47bd"/>'
      + '<path d="M32.8 35.4l12.2 2.2v15.2l-12.2-1.9z" fill="#7d55c8"/>'
      + '<path d="M19 52.8l12.2-1.9v1.5l-12.2 1.9z" fill="#e6ebf3"/>'
      + '<path d="M45 52.8l-12.2-1.9v1.5l12.2 1.9z" fill="#eef2f7"/>'
      + '<path d="M31 35.2h2v16.2h-2z" fill="#59349e"/>'
      + '<path d="M32 35.2v16.2" stroke="#8a5fd8" stroke-width=".7" fill="none" opacity=".55"/></g>'},
  };
  function budProp(pose, where){
    const p = BUD_PROPS[pose];
    return (p && p[where]) || '';
  }

  /* Somebody else's number, made safe against our list — same rule as the
     parts. Used by the room list, which draws other people's buddies. */
  function budAnimKey(i){
    i = parseInt(i, 10);
    return BUD_ANIMS[(i >= 0 && i < BUD_ANIMS.length) ? i : 0].k;
  }
  function budAnim(){
    const i = parseInt(S.budAnim, 10);
    return BUD_ANIMS[(i >= 0 && i < BUD_ANIMS.length) ? i : 0];
  }

  function budDefault(){ return {b:0, c:0, e:0, h:0, a:0, f:0, o:0}; }
  /** Somebody else's numbers, made safe against our tables. */
  function budClean(v){
    const n = (x, max)=>{ const i = parseInt(x, 10); return (i >= 0 && i < max) ? i : 0; };
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
    return ['b','c','e','h','a','f','o'].every(k=>a[k] === b[k]);
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
      + (BUD_OUTER[v.o].b || '') + budProp(pose, 'back')
      + budLimbs(pose, skin, body)
      /* Body, coat, then head over both. The coat goes *under* the head on
         purpose — that is what puts a collar behind his chin instead of on it.
         `bud-torso` is a name, not decoration: the nap breathes this rect, and
         when it was selected as plain `rect` it also breathed the top hat. */
      + '<rect class="bud-torso" x="19" y="36" width="26" height="19" rx="9" fill="' + body + '"/>'
      + BUD_OUTER[v.o].s
      + '<circle cx="32" cy="27" r="16" fill="' + skin + '"/>'
      + '<g fill="#20242e" stroke="#20242e">' + eyes + '</g>'
      + mouth
      /* Face first, hat last. A hat sits *on* a head and a mask sits *against*
         one, so the brim has to cross the mask rather than the other way round
         — with the mask on top a cap looked like it had been slid underneath. */
      + BUD_ACC[v.a].s + BUD_FACE[v.f].s + BUD_HATS[v.h].s
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
  function budIcon(part){
    return '<svg class="bud-ic" viewBox="' + (part.none ? '0 0 24 24' : part.box) + '"'
      + ' width="26" height="26" aria-hidden="true" focusable="false">'
      + '<g fill="#20242e" stroke="#20242e">'
      + (part.none ? BUD_NONE : (part.b || '') + part.s) + '</g></svg>';
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
    return budSvg(v, size, pose);
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
        box.innerHTML = '<p class="bud-locked">Sign in to make a buddy — he travels '
          + 'with your account, so he turns up on every device you use.</p>';
        return;
      }
      const v = budMine();
      const dirty = !budSame(budMine(), budSaved());
      const row = (key, list, label)=>{
        const swatch = key === 'b' || key === 'c';
        const n = swatch ? (key === 'b' ? BUD_BODY : BUD_SKIN).length : list.length;
        return '<div class="bud-row"><span>' + label + '</span><div class="bud-opts">'
        + [...Array(n)].map((_, i)=>{
            const on = v[key] === i;
            const sw = swatch ? ' style="--sw:' + (key === 'b' ? BUD_BODY[i] : BUD_SKIN[i]) + '"' : '';
            return '<button class="bud-opt' + (swatch ? ' sw' : '') + (on ? ' on' : '') + '"'
              + ' data-bud="' + key + '" data-i="' + i + '"' + sw
              + ' aria-label="' + esc(label) + ' ' + (i + 1) + '"'
              + (on ? ' aria-pressed="true"' : '') + '>'
              + (swatch ? '' : budIcon(list[i])) + '</button>';
          }).join('')
        + '</div></div>';
      };
      box.innerHTML = '<div class="bud-stage">' + budSvg(v, 116) + '</div>'
        + row('c', null, 'Skin')
        + row('b', null, 'Colour')
        + row('e', BUD_EYES, 'Eyes')
        + row('h', BUD_HATS, 'Hat')
        + row('f', BUD_FACE, 'Face')
        /* Above Worn: a coat is the bigger decision and the tie goes on over
           it, so the rows read the way you would actually get dressed. */
        + row('o', BUD_OUTER, 'Coat')
        + row('a', BUD_ACC, 'Worn')
        + '<div class="bud-row"><span>Antics</span><div class="bud-opts">'
          + BUD_ANIMS.map((a, i)=>
              '<button class="bud-opt bud-anim' + (budAnim() === a ? ' on' : '') + '"'
              + ' data-anim="' + i + '" aria-label="' + esc(a.n) + '"'
              + (budAnim() === a ? ' aria-pressed="true"' : '') + '>'
              + '<svg class="bud-ic" viewBox="0 0 24 24" width="26" height="26"'
              + ' aria-hidden="true" focusable="false">' + a.ic + '</svg>'
              + '</button>').join('')
          + '</div></div>'
        + '<p class="bud-anim-name"><b>' + esc(budAnim().n) + '</b> — ' + esc(budAnim().d) + '</p>'
        + '<p class="bud-anim-note">He does this while the clock is running. On the '
          + 'main menu he waits on the minutes box instead, whichever you pick.</p>'
        + '<div class="bud-save' + (dirty ? ' on' : '') + '">'
          + '<span>' + (dirty ? 'Unsaved changes' : 'Saved') + '</span>'
          + '<button class="mini-btn" id="bud-revert"' + (dirty ? '' : ' disabled') + '>Undo</button>'
          + '<button class="mini-btn" id="bud-save"' + (dirty ? '' : ' disabled') + '>Save buddy</button>'
          + '</div>'
        + '<label class="bud-show"><input type="checkbox" id="bud-onscreen"'
          + (S.budShow === false ? '' : ' checked') + '/>'
          + '<span>Show him on the timer screens</span></label>';
      const sv = $('bud-save'); if(sv) sv.onclick = ()=>Buddy.commit();
      const rv = $('bud-revert'); if(rv) rv.onclick = ()=>Buddy.revert();
      const t = $('bud-onscreen');
      if(t) t.onchange = ()=>{ S.budShow = !!t.checked; save(); Buddy.stage(); };
    },

    draft:null,

    /* Into the draft. Nothing is written down and nobody in the room is told
       until Save — trying on six hats should not be six announcements. */
    set(key, i){
      const v = budMine();
      v[key] = i;
      this.draft = v;
      this.render();
      this.stage();
    },

    commit(){
      if(!this.draft) return;
      S.buddy = budClean(this.draft);
      this.draft = null;
      save();
      this.render();
      this.stage();
      /* Everybody in the room is looking at the old one until they are told,
         and the account is the thing that carries him between devices. */
      try{ syncBroadcast({t:'buddy', buddy:S.buddy, anim:(S.budAnim | 0)}); }catch(e){}
      try{ Account.sync(true); }catch(e){}
      toast('Buddy saved.');
    },

    revert(){
      if(!this.draft) return;
      this.draft = null;
      this.render();
      this.stage();
    },

    /* Leaving the page with changes in hand. Asked rather than assumed either
       way: silently keeping them makes Save a lie, silently dropping them makes
       the page a trap. */
    leaving(done){
      if(!this.draft || budSame(this.draft, budSaved())){ this.draft = null; return done(); }
      askConfirm('Save your buddy?',
        'You have changed him and not saved. Saving sends him to your account '
        + 'and to anybody in a room with you.',
        'Save', ()=>{ Buddy.commit(); done(); });
      /* `askConfirm` runs nothing on No, and this is the one place where No
         means *do something* rather than *do nothing* — the changes have to be
         dropped and the page still has to close. So No is borrowed for one
         press and handed straight back; leaving it rebound would quietly change
         what every other confirm in the app does on No. */
      const no = $('confirm-no');
      if(!no) return;
      const was = no.onclick;
      no.onclick = ()=>{
        no.onclick = was;
        closeConfirm();
        Buddy.draft = null; Buddy.render(); Buddy.stage();
        done();
      };
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
      const anim = budAnim();
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
        slot.dataset.pose = sig;
        /* **The pose class goes here and nowhere else.** The travel is written
           as `.bud-swing{ left:0; right:0; animation:bud-go }`, and the slot is
           the thing that spans the window, so the slot is the thing that has to
           carry it. `budSvg()` used to stamp the same class on the `<svg>` as
           well; both then ran `bud-go`, the drawing drifted out from under the
           rope, and the web looked severed. It emits a bare `class="bud"` now —
           see the note there before putting a pose class back on it. */
        slot.className = 'bud-slot bud-' + pose;
        /* **Swinging hangs off a rig.** The rope reaches the top of the layer
           and he hangs at the bottom of it, and the *rig* is what rotates — so
           the rope and the man pivot together about a real anchor instead of
           him turning on the spot beneath a line that stays put. Two ropes: the
           one he is on and the one he is throwing; the CSS decides which is
           lit, in step with the arc. */
        /* The rig measures the rope and his own offset from his rendered size,
           so it has to be told what that is — one number, one place. */
        if(pose === 'swing') slot.style.setProperty('--bud', size + 'px');
        slot.innerHTML = budFill(budMine(), size, pose);
      };
      paint('bud-perch', setup, 'perch', 53);
      paint('bud-live', live && !setup && anim.k !== 'onpause', anim.k, 55);
      paint('bud-pause', live && !setup && anim.k === 'onpause', 'onpause', 41);
      /* Whose buddies are on screen and whether the layer is needed are two
         different questions now. `live` is "have *I* got one to show", which
         wants an account; the crowd only wants the switch, because being signed
         out is no reason to blank out the people you are sitting with. */
      const others = this.others();
      const lane = $('bud-layer');
      if(lane) lane.classList.toggle('hide', setup || !(live || others.length));
      this.crowd(others);
      this._roam(live && !setup && anim.k === 'swing');
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
        const seed = budSeed(budId(p));
        const el = document.createElement('div');
        el.className = 'bud-slot bud-peer bud-' + pose;
        el.setAttribute('aria-hidden', 'true');
        /* Negative, always: a positive delay would have them all standing still
           for a while first, which is worse than being in step. */
        el.style.setProperty('--t', '-' + ((seed % 1600) / 100).toFixed(2) + 's');
        el.style.setProperty('--x', ((seed >> 4) % 240) + 'px');
        el.style.setProperty('--y', ((seed >> 11) % 13) + 'vh');
        if(pose === 'swing') el.style.setProperty('--bud', '55px');
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
    if(a){
      S.budAnim = parseInt(a.getAttribute('data-anim'), 10) || 0;
      save();
      /* **Changing the antic is a change to your buddy, and the room has to be
         told.** It was not: the only broadcast was in `commit()`, which the
         antic buttons do not go through — so everybody else went on watching
         you swing long after you had switched to the nap. There is no separate
         message kind for it, on purpose; one kind is one thing for the host to
         relay and one thing to forget. */
      try{ syncBroadcast({t:'buddy', buddy:budSaved(), anim:(S.budAnim | 0)}); }catch(e){}
      try{ Account.sync(true); }catch(e){}
      Buddy.render();
      /* The slot has to be emptied, not just repainted: `stage()` skips work
         when the signature matches, and switching antic changes which slot is
         used rather than what is in it. */
      ['bud-live','bud-pause'].forEach(id=>{ const s = $(id); if(s){ s.innerHTML = ''; s.dataset.pose = ''; } });
      Buddy.stage();
    }
  });
