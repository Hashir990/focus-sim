"""Clues that are a line from a very famous song with one word blanked out.

A different kind of clue from everything else in the bank. The others define the
answer; these ask you to finish a line you already know, and the answer is a
perfectly ordinary word that happens to sit in a famous place. LOVE, DREAM,
FIRE, ROAD and NIGHT are all in the word bank already with straight definitions,
and this gives them a second way of being asked.

Three rules, and they are what keep it fair and lawful.

  * **Short.** A fragment, never a verse — the few words either side of the
    blank and no more. That is what a clue has room for anyway, and quoting a
    whole lyric is not something this file should ever grow into.
  * **Very famous only.** The test is whether somebody who does not follow music
    would still finish the line. "Is this the real ___" passes. An album track
    does not. A clue nobody can complete is worse than no clue.
  * **The answer is an ordinary word.** These attach to words that already earn
    their place in the bank, so the grid never depends on one. If a lyric clue
    were the only reason a word existed, the puzzle would turn into a quiz.

Written as `answer -> clue`, and merged into CLUES the same way any other block
is, so an answer that already has a definition ends up with both and crossClue
picks by puzzle index. The underscore run is what marks the blank; keep it to
three characters so the clue still fits MAX_CLUE.
"""

LYRICS = {
    # ---- the ones anybody can finish ----
    'life':      '"Is this the real ___, is this just fantasy"',
    'love':      '"All you need is ___"',
    'yesterday': '"___, all my troubles seemed so far away"',
    'twist':     '"Come on baby, let\u2019s do the ___"',
    'fire':      '"We didn\u2019t start the ___"',
    'road':      '"Take me home, country ___s"',
    'rain':      '"Singin\u2019 in the ___"',
    'river':     '"Moon ___, wider than a mile"',
    'happy':     '"Clap along if you feel like a room without a roof"',
    'hello':     '"___, is it me you\u2019re looking for"',
    'brick':     '"Just another ___ in the wall"',
    'money':     '"___ , ___ , ___ \u2014 must be funny in a rich man\u2019s world"',
    'imagine':   '"___ there\u2019s no heaven, it\u2019s easy if you try"',
    'yellow':    '"We all live in a ___ submarine"',
    'help':      '"___, I need somebody"',
    'wall':      '"We don\u2019t need no education" \u2014 Another Brick in the ___',
    'thriller':  '"\u2019Cause this is ___, ___ night"',
    'beat':      '"Just ___ it, ___ it"',
    'sweet':     '"___ dreams are made of this"',
    'lonely':    '"All the ___ people, where do they all come from"',
    'closer':    '"Come on, come on, come a little ___"',
    'tiger':     '"It\u2019s the eye of the ___"',
    'champion':  '"We are the ___s, my friends"',
    'bridge':    '"Like a ___ over troubled water"',
    'wind':      '"The answer is blowin\u2019 in the ___"',
    'hotel':     '"Welcome to the ___ California"',
    'dream':     '"___ on, ___ until your ___ comes true"',
    'jean':      '"Billie ___ is not my lover"',
    'stand':     '"Lean on me" \u2014 and I\u2019ll help you carry on, or ___',
    'night':     '"Like a bat out of hell" singer, or a ___ at the Opera',
    'summer':    '"___ lovin\u2019, had me a blast"',
    'gold':      '"You\u2019re indestructible, always believe in your ___"',
    'radio':     '"Video killed the ___ star"',
    'sugar':     '"___, ah honey honey"',
    'monday':    '"Tell me why, I don\u2019t like ___s"',
    'candle':    '"___ in the wind"',
    'purple':    '"___ haze, all in my brain"',
    'teen':      '"Smells Like ___ Spirit"',
    'crazy':     '"But you\u2019re not ___, you\u2019re just a little unwell"',
    'proud':     '"And I\u2019m ___ to be an American"',
}
