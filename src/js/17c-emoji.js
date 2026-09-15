  /* ---------------- THE FACES, DRAWN ----------------

     The six moods are stored as emoji characters and always will be — that is
     what travels in the account and what a backup from last year contains. What
     the *screen* shows is drawn here instead.

     **Why not just print the character.** Because there is no one emoji. The
     same code point is a different picture on every platform this ships to — an
     Apple face, a Segoe face, a Noto face, and on anything with partial coverage
     a monochrome outline that reads as a smudge. Six faces that are the app's
     own drawing are the same six everywhere, at any size.

     **Flat, and in the theme's colours — the face is the ink, the features are
     the ground.** The head is a solid disc in `currentColor` (the muted text
     colour at rest, the accent when chosen) and the eyes and mouth are cut into
     it in the background colour, so they change with the phase and the light
     like everything else and read as a face at 15px. The first version was a
     glossy 3D ball; the second an outline with light features on the dark
     ground; this is the second one turned inside out, which is what was asked.

     **Two inks, and which one a part uses is where it sits.** Anything inside
     the head is drawn in the ground colour (`emo-s`, `emo-f`) — that is what
     makes it a face cut into a disc. Anything *outside* the head — the tired
     face's zeds, the hard face's anger marks — is drawn in the face's own
     colour (`emo-x`), because in the ground colour it would be invisible against
     the ground it is drawn on.

     **Each face moves like what it means**, keyed in 37-emoji.css on the
     `emo-<name>` class below: the great day hops, the good day winks, the
     ordinary one glances aside and blinks, the hard one shudders with its
     temper showing, the bad one lets a tear fall, the tired one yawns and nods
     off. The parts carry names so a motion can move one eye and not the other.

     **And it plays once, however often the row is redrawn under it.** A fresh
     element starts its animation now — that is how a tap starts the motion at
     all (see 17b-mood.js). It is also how it used to play *twice*: choosing a
     mood saves it, saving syncs the account, and the sync coming back redraws
     the calendar mid-motion — a fresh element, starting again from nothing. So
     a face drawn part-way through its motion is told how far in it already is,
     as a negative delay, and carries on from there. The same trick keeps the
     room's buddies in step (`--t`, HANDOFF §6). */

  /* How long a face is left popping. **Longer than any motion, on purpose.**
     The class comes off at the end of the hold and the face snaps to rest, so a
     hold shorter than the motion cuts the end off it — and the motion starts a
     frame after the tap, not on it. Every motion in 37-emoji.css finishes by
     1.1s; the smoke test checks that each one finishes inside this. */
  const EMO_HOLD = 1250;

  /* The name each face is styled and animated under. Separate from MOODS in
     17b-mood.js on purpose: that list is about the day and is what a person
     reads, this one is about the drawing and is what the stylesheet reads. */
  const EMO_NAME = {
    '\u{1F601}': 'great',
    '\u{1F642}': 'good',
    '\u{1F610}': 'ordinary',
    '\u{1F629}': 'hard',
    '\u{1F622}': 'bad',
    '\u{1F634}': 'tired',
  };

  /* The head, shared. r=26 in a 64 box rather than filling it: the motions move
     the face about inside its own square, and the corner the circle leaves free
     is where the tired face's zeds and the hard face's temper live. */
  const EMO_HEAD = '<circle class="emo-hd" cx="32" cy="32" r="26"/>';

  /* Features, then effects. Every face puts its eyes at y≈27-29 and x 23 / 41,
     because a set whose eyes wander is a set that looks drawn by different hands.

     Classes: `emo-s` a stroke and `emo-f` a solid, both in the ground colour;
     `emo-x` an effect outside the head, in the face's colour. `emo-e`, `emo-el`,
     `emo-er` are the eyes, both and each; `emo-m` the mouth; `emo-t` the tear;
     `emo-z` the zeds; `emo-v`, `emo-st`, `emo-tn` the hard face's vein, steam and
     strain marks. The stylesheet moves parts by these names, so renaming one here
     is silently stilling it there. */
  const EMO_ART = {
    /* Beaming. Smiling eyes are an *upward* arc — the curve peaks between the
       corners — and the mouth is open, solid, flat along the top. */
    great:
      '<path class="emo-e emo-el emo-s" d="M18.5 29Q23 23.5 27.5 29"/>'
      + '<path class="emo-e emo-er emo-s" d="M36.5 29Q41 23.5 45.5 29"/>'
      + '<path class="emo-m emo-f emo-s" d="M21.5 36.5H42.5Q42.5 47 32 47Q21.5 47 21.5 36.5Z"/>',

    /* A small smile, and the two dots it winks with. */
    good:
      '<circle class="emo-e emo-el emo-f" cx="23" cy="27.5" r="3"/>'
      + '<circle class="emo-e emo-er emo-f" cx="41" cy="27.5" r="3"/>'
      + '<path class="emo-m emo-s" d="M22.5 38.5Q32 46.5 41.5 38.5"/>',

    /* Ordinary. The same eyes as the smile and a straight mouth: the whole
       difference between "fine" and "good" is eight units of curve. */
    ordinary:
      '<circle class="emo-e emo-el emo-f" cx="23" cy="27.5" r="3"/>'
      + '<circle class="emo-e emo-er emo-f" cx="41" cy="27.5" r="3"/>'
      + '<path class="emo-m emo-s" d="M23.5 41H40.5"/>',

    /* A hard day. **Scrunched, not closed** — closed eyes are the tired face's,
       and at 15px two faces sharing their eyes are the same face.

       **And its temper shows round it.** A cross-popping vein in the free
       corner, the one mark of anger everybody reads, and the only one that stays
       at rest — so the face says "fed up" in a calendar square as well as when
       it moves. When it is tapped, steam puffs off both sides and three strain
       marks flick out at the top-left while it shudders. The vein sits far
       enough into the corner that none of its four hooks touches the head: at
       (55.5, 8.5) the nearest end is 28.5 from the centre against a radius of
       26 — any closer and a hook is drawn in the face colour on the face and
       disappears.

       **The mouth is a snarl, not an oval.** An open circle is a groan, which is
       the tired face's business; temper is teeth. The top edge curves *down* at
       the corners — the frown — and inside it two rows of clenched teeth in the
       face's colour, split by gaps in the ground's. The teeth sit on a band
       inset from the curve: at the corners the arc is only 0.8 units above it,
       so a band any taller pokes out through the lip. The gaps are `emo-gap`
       rather than `emo-s` so the calendar's thicker strokes leave them alone —
       at 15px they would fill the mouth solid. */
    hard:
      '<path class="emo-e emo-el emo-s" d="M19.5 24 26.5 28 19.5 32"/>'
      + '<path class="emo-e emo-er emo-s" d="M44.5 24 37.5 28 44.5 32"/>'
      + '<g class="emo-m">'
        + '<path class="emo-f emo-s" d="M20.5 40.5Q32 35.5 43.5 40.5V43.5Q43.5 47.5 39.5 47.5H24.5Q20.5 47.5 20.5 43.5Z"/>'
        + '<rect class="emo-tooth" x="23.5" y="40.2" width="17" height="5.4" rx="1.2"/>'
        + '<path class="emo-gap" d="M23.5 42.9H40.5M27.75 40.2V45.6M32 40.2V45.6M36.25 40.2V45.6"/>'
      + '</g>'
      + '<path class="emo-x emo-v" d="M50.3 6.9Q53.9 6.9 53.9 3.3M57.1 3.3Q57.1 6.9 60.7 6.9'
        + 'M60.7 10.1Q57.1 10.1 57.1 13.7M53.9 13.7Q53.9 10.1 50.3 10.1"/>'
      + '<path class="emo-x emo-tn" d="M9.5 13.5 5 9M13.5 9.5 11 4.5M7 18.5 2 17"/>'
      + '<g class="emo-st emo-st-l"><circle cx="1" cy="22" r="2.6"/>'
        + '<circle cx="-2.2" cy="24.6" r="2"/><circle cx="1.8" cy="25.4" r="1.9"/></g>'
      + '<g class="emo-st emo-st-r"><circle cx="63" cy="22" r="2.6"/>'
        + '<circle cx="66.2" cy="24.6" r="2"/><circle cx="62.2" cy="25.4" r="1.9"/></g>',

    /* A bad day. One tear, from the outer side of the left eye — two is a
       cartoon — and set a little left of the frown so the two never touch. The
       drop is drawn heavy at the bottom, the way a falling one hangs. */
    bad:
      '<circle class="emo-e emo-el emo-f" cx="23" cy="27" r="3"/>'
      + '<circle class="emo-e emo-er emo-f" cx="41" cy="27" r="3"/>'
      + '<path class="emo-t emo-f" d="M21.5 32q-3.3 5.2-3.3 7.4a3.3 3.3 0 0 0 6.6 0q0-2.2-3.3-7.4Z"/>'
      + '<path class="emo-m emo-s" d="M23.5 44Q32 37 40.5 44"/>',

    /* Tired. Closed eyes bend *down*, a small round mouth, and one zed in the
       corner the head leaves free. The other two are there for the motion —
       invisible at rest, they stream up and away when the face nods off. */
    tired:
      '<path class="emo-e emo-el emo-s" d="M18.5 27.5Q23 32 27.5 27.5"/>'
      + '<path class="emo-e emo-er emo-s" d="M36.5 27.5Q41 32 45.5 27.5"/>'
      + '<ellipse class="emo-m emo-f" cx="32" cy="42" rx="3.4" ry="2.9"/>'
      + '<path class="emo-x emo-z emo-z1" d="M52 4h6l-6 6h6"/>'
      + '<path class="emo-x emo-z emo-z2" d="M52 4h6l-6 6h6"/>'
      + '<path class="emo-x emo-z emo-z3" d="M52 4h6l-6 6h6"/>',
  };

  /** Is this character one we can draw? Anything else falls back to the glyph. */
  function emoHas(ch){ return !!EMO_NAME[ch]; }

  /** One face, as markup. `cls` rides on the wrapper for size and state; `age`
      is how many milliseconds into its motion a popping face already is, so a
      redraw carries the motion on instead of starting it again. */
  function emoFace(ch, cls, age){
    const name = EMO_NAME[ch];
    const c = 'emo' + (name ? ' emo-' + name : '') + (cls ? ' ' + cls : '');
    /* No drawing for it: print the character rather than nothing. Nothing here
       depends on the table being complete, so a mood added in a hurry still
       shows something. */
    if(!name) return '<span class="' + c + ' emo-raw">' + esc(ch) + '</span>';
    const t = age > 0 ? ' style="--emo-t:-' + Math.round(age) + 'ms"' : '';
    return '<span class="' + c + '"' + t + ' aria-hidden="true">'
      + '<svg viewBox="0 0 64 64">' + EMO_HEAD + EMO_ART[name] + '</svg>'
      + '</span>';
  }
