#!/usr/bin/env python3
"""
Build the crossword bank: 50 puzzles each at 9x9, 7x7 and 5x5.

The old crossword generated a grid at runtime by laying words that crossed each
other. It worked, but it produced sparse, sprawling shapes with only a handful of
crossings, and the same few hundred clues came round again and again.

This replaces it with real crossword grids, generated here rather than in the
browser:

  * **Walls.** Black squares, placed in 180-degree rotational symmetry the way a
    newspaper grid is.
  * **Fully checked.** Every white square belongs to an Across entry *and* a Down
    entry, both at least three letters. That is what "intertwined" means in
    practice — there are no letters you can only get one way.
  * **Filled by search.** A backtracking fill over a wide word list, so the grids
    are dense rather than whatever happened to fit.
  * **No difficulty axis.** Size is the only choice now. Difficulty was really
    just three word banks, and with three banks the same clues repeated within a
    session.

There are two kinds of grid and `--barred` picks the second:

  * **Black-square** (the default). Entries are divided by squares you cannot
    write in.
  * **Barred** (`--barred`). Entries are divided mainly by thick bars drawn on
    the edges between squares, with only a handful of black squares.

Barred is what makes 9x9 tractable. A black-square grid has to commit to its
wall pattern before the fill starts, and at 9x9 almost every pattern it commits
to turns out to have no solution — measured at zero puzzles in nine runs of
thirty-five seconds. A bar divides a line without spending a square to do it, so
a barred shape can be cut where the words want to be cut, and the same word list
closes a grid every few seconds.

Two things follow, and both were measured the hard way:

  * **Keep some black squares.** A 9x9 with none is 81 squares each checked
    twice, which this word list can only manage by reaching into the far end of
    the dictionary: those grids come back 36-46% uncommon (baric, serer, bonce,
    apery, balas, peba). Filling those from the common tier simply fails — nought
    in twenty-nine shapes. With eight black squares it succeeds in three, from
    common words only. `BARRED_BLOCKS` is the lever.
  * **Give up on a shape early.** Barred shapes are cheap and plentiful, so the
    fill is better off abandoning one and trying another: at a 25000-step budget
    it got through eight shapes in half a minute and found nothing, at 6000 it
    got through thirty-seven and found five.

`--barred` fills from the common tier only (see `prep_freq`); `--loose` widens it
to the whole list and throws away any grid more than LOOSE_ODDITIES uncommon.

Clues come from WordNet glosses, trimmed to read like clues, restricted to words
common enough to be fair. Answers are spent least-used-first across the whole
build, so a session sees very little repetition.

Words come in two tiers. Tier A is the common list, and the fill spends it
first; tier B is everything else the app already accepts as a word, and exists so
a nine-by-nine can actually be filled — a fully checked 9x9 needs far more
three-letter entries than a common-words-only list contains.

Inputs (see HANDOFF §5 for where they come from):
  ~/clues.tsv           word \t pos \t gloss   (WordNet)
  ~/freq.txt            one common word per line  (also written by --prep)
  ~/scrabble-words.txt  the app's own dictionary, dumped from 31-scrabble-data.js

The build is slow and is meant to be run in pieces, caching as it goes:

  npm install                                          # brings in wordnet-db
  python3 tools/build-crosswords.py --prep             # once: clues.tsv, freq.txt
  python3 tools/build-crosswords.py --size 5           # repeat until it has 50
  python3 tools/build-crosswords.py --size 7
  python3 tools/build-crosswords.py --size 9 --barred
  python3 tools/build-crosswords.py --emit src/js/26-crossword-data.js

Expect this to take a while. A fully checked grid is a hard constraint problem
and the fill fails more often than it succeeds; 5x5 runs at a few a second, 9x9
at roughly one a minute barred and effectively never with black squares.
"""
import os, random, re, sys, time, json, collections

SIZES = [15, 9, 7, 5]
PER_SIZE = 50
MAX_CLUE = 58
MIN_RUN = 3
REPEAT_CAP = 8         # puzzles an answer may appear in before it is retired

random.seed(20260729)          # a fixed bank, not a different one every build


# ---------------------------------------------------------------- word list

def _read_set(name):
    p = os.path.expanduser(name)
    return {w.strip().lower() for w in open(p)} if os.path.exists(p) else set()


# ---------------------------------------------------------------- clue source

DICT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        'node_modules', 'wordnet-db', 'dict')
POS_FILES = {'data.noun': 'n', 'data.verb': 'v', 'data.adj': 'a', 'data.adv': 'r'}


GLOSS_USES = 5         # times a word must be used in definitions to count as common


def prep_freq():
    """Write ~/freq.txt: WordNet's own answer to which words are common.

    Two signals, because neither alone is any good, and both ship inside
    `wordnet-db` so there is nothing to fetch and it is the same everywhere.

      * **Tagged senses.** `index.sense` records how often each sense was tagged
        in the semantic concordances, so a count above zero means the word
        turned up in real running text. Precise, and far too sparse: only 201 of
        the 431 clueable three-letter words score at all, and kilo, daft, preen,
        tepee and rupee all score zero.
      * **Used in definitions.** A word that WordNet reaches for to explain
        other words is, by construction, ordinary vocabulary. Dense where the
        first signal is thin — but on its own it lets in anna, amyl and aba,
        which turn up inside definitions of the obscure things they belong to.

    Their union is what a fair answer looks like: roughly 8k of the 16k clueable
    words, and it excludes anoa, abohm, argal, balas, pavis, salmi, grume,
    imaret, ctenoid, teredo, soave, baas, aba, ane, etude and amyl — the words
    an alphabetical candidate list otherwise reaches for first.

    Without this file every word lands in tier 1 and the tiering does nothing at
    all, which is what had been happening: the build logged "16120 clueable
    (0 common)" and filled grids with whatever sorted first.
    """
    tagged = collections.Counter()
    for line in open(os.path.join(DICT_DIR, 'index.sense'), encoding='latin-1'):
        parts = line.split()
        if len(parts) < 4:
            continue
        try:
            count = int(parts[3])
        except ValueError:
            continue
        tagged[parts[0].split('%')[0]] += count

    used = collections.Counter()
    for fn in POS_FILES:
        path = os.path.join(DICT_DIR, fn)
        if not os.path.exists(path):
            continue
        for line in open(path, encoding='latin-1'):
            if line.startswith('  '):
                continue
            _, _, gloss = line.partition('|')
            for token in re.findall(r'[a-z]+', gloss.lower()):
                used[token] += 1

    common = sorted(w for w in set(tagged) | set(used)
                    if w.isalpha() and (tagged[w] > 0 or used[w] >= GLOSS_USES))
    out = os.path.expanduser('~/freq.txt')
    with open(out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(common))
    print('wrote', out, len(common), 'common words', file=sys.stderr)


def prep():
    """Write ~/clues.tsv and ~/freq.txt from the WordNet database shipped by
    `wordnet-db`.

    Run once (`npm install` first). Kept separate from the build because it is
    slow, deterministic, and has nothing to do with crosswords — it is just
    turning a lexical database into `word <tab> pos <tab> clue`.
    """
    if not os.path.isdir(DICT_DIR):
        sys.exit('no WordNet at %s — run `npm install` first' % DICT_DIR)

    bad = re.compile(r'[^a-z]')
    out = collections.defaultdict(list)
    for fn, pos in POS_FILES.items():
        path = os.path.join(DICT_DIR, fn)
        if not os.path.exists(path):
            continue
        for line in open(path, encoding='latin-1'):
            if line.startswith('  '):
                continue                       # licence header
            head, _, gloss = line.partition('|')
            if not gloss:
                continue
            parts = head.split()
            try:
                count = int(parts[3], 16)
            except (IndexError, ValueError):
                continue
            words = [parts[4 + i * 2] for i in range(count)] if len(parts) > 4 + (count - 1) * 2 else []

            # A gloss becomes a clue by keeping the first sense's first clause
            # and dropping the parenthetical asides and usage examples.
            g = gloss.split(';')[0].strip()
            g = re.sub(r'\s*\([^)]*\)', '', g)
            g = re.sub(r'^(a|an|the)\s+', '', g, flags=re.I).strip(' .,;:')
            g = re.sub(r'\s+', ' ', g)
            if not g:
                continue
            for w in words:
                w = w.lower()
                if not bad.search(w):
                    out[w].append((pos, g))

    # Every sense, not just the first. This used to write `out[w][0]` and throw
    # the rest away, which quietly decided the size of the whole word bank: a
    # word whose *first* WordNet sense happens to have a long or self-
    # referential gloss was dropped, even when its second or third sense was
    # short, plain and exactly what a solver means. Measured 2026-08-21, 3,232
    # ordinary words were being lost that way — ABDOMEN, ACORN, ACCIDENT,
    # ACRONYM, ZIP, PIZZA, ZEBRA — and the loss rose with word length, which is
    # why the bank thinned out past five letters and why a 15x15 could not fill.
    #
    # rebuild-bank.py already ranks the candidates it is given and keeps the
    # plainest, so handing it all of them costs nothing but file size.
    path = os.path.expanduser('~/clues.tsv')
    lines = 0
    with open(path, 'w', encoding='utf-8') as f:
        for w in sorted(out):
            if MIN_RUN <= len(w) <= max(SIZES):
                seen = set()
                for pos, g in out[w]:
                    if g in seen:
                        continue
                    seen.add(g)
                    f.write('%s\t%s\t%s\n' % (w, pos, g))
                    lines += 1
    print('wrote', path, len(out), 'lemmas,', lines, 'senses', file=sys.stderr)
    prep_freq()


# WordNet is a dictionary, not a puzzle book, so it glosses the coarse senses of
# ordinary words as plainly as any other — `ass` came through as "Slang for
# sexual intercourse". A word is only dropped if *every* gloss it has trips this;
# usually there is a milder sense and it simply gets used instead, which is why
# this filters glosses rather than words.
COARSE = re.compile(r'offensive|disparag|derogat|vulgar|obscene|sexual|genital'
                    r'|penis|vagina|anus|buttock|copulat|masturbat|ejaculat'
                    r'|prostitut|slur|racial|excrement|defecat|urinat', re.I)

# The handful of words WordNet has *no* clean sense for, but which are ordinary
# enough that the bank already uses them. Clued by hand so the grids they sit in
# survive; everything else COARSE catches just leaves the pool.
OVERRIDE_CLUES = {
    'ass': 'Long-eared animal related to the horse',
    'eff': 'Stand in for a stronger word',
    'pom': 'Australian nickname for a Briton',
}


def load_words():
    """word -> (clue, tier). Tier 0 is common, tier 1 is merely allowed."""
    freq = _read_set('~/freq.txt')
    allowed = _read_set('~/scrabble-words.txt')

    words = {}
    for line in open(os.path.expanduser('~/clues.tsv'), encoding='utf-8'):
        parts = line.rstrip('\n').split('\t')
        if len(parts) != 3:
            continue
        w, pos, gloss = parts
        if not (MIN_RUN <= len(w) <= max(SIZES)):
            continue
        if allowed and w not in allowed:
            continue                      # not a word this app would accept
        gloss = gloss.strip()
        if len(gloss) > MAX_CLUE or len(gloss) < 4:
            continue
        if w in gloss.lower():
            continue                      # a clue that contains its answer is no clue
        if COARSE.search(gloss):
            continue                      # not what this app is for
        tier = 0 if w in freq else 1
        clue = gloss[0].upper() + gloss[1:]
        # shortest gloss wins — short clues read better and cost less to ship
        if w not in words or len(clue) < len(words[w][0]):
            words[w] = (clue, tier)
    for w, clue in OVERRIDE_CLUES.items():
        if not allowed or w in allowed:
            words[w] = (clue, 0 if w in freq else 1)
    return words


# ---------------------------------------------------------------- grids

def ok_runs(n, walls):
    """No run of white squares shorter than MIN_RUN, in either direction."""
    for vertical in (False, True):
        for run in runs(n, walls, vertical):
            if len(run) < MIN_RUN:
                return False
    return True


def symmetric_walls(n, count):
    """Aim for `count` black squares in 180-degree rotational symmetry.

    Built up a pair at a time rather than sampled: a wall pair is only kept if
    the grid still has no run shorter than three. Sampling a set of positions and
    checking afterwards effectively never produces a legal grid — at 9x9 it
    failed every time out of sixteen hundred tries.
    """
    walls = set()
    cells = [(r, c) for r in range(n) for c in range(n)]
    random.shuffle(cells)
    misses = 0
    for (r, c) in cells:
        if len(walls) >= count or misses > n * n:
            break
        m = (n - 1 - r, n - 1 - c)
        if (r, c) in walls or m in walls:
            continue
        trial = walls | {(r, c), m}
        if ok_runs(n, trial):
            walls = trial
        else:
            misses += 1
    return walls


def runs(n, walls, vertical=False):
    """Every straight run of white squares, as lists of (r, c)."""
    out = []
    for a in range(n):
        cur = []
        for b in range(n):
            r, c = (b, a) if vertical else (a, b)
            if (r, c) in walls:
                if cur:
                    out.append(cur)
                cur = []
            else:
                cur.append((r, c))
        if cur:
            out.append(cur)
    return out


def valid_shape(n, walls):
    """Fully checked, no short runs, and all one connected piece."""
    white = [(r, c) for r in range(n) for c in range(n) if (r, c) not in walls]
    if not white:
        return None
    across = runs(n, walls, False)
    down = runs(n, walls, True)
    if any(len(x) < MIN_RUN for x in across + down):
        return None                        # a one- or two-letter entry is not an entry

    # every white square must sit in both an across and a down entry
    covered = collections.Counter()
    for run in across + down:
        for cell in run:
            covered[cell] += 1
    if any(covered[cell] != 2 for cell in white):
        return None

    # one connected white area
    seen = {white[0]}
    stack = [white[0]]
    while stack:
        r, c = stack.pop()
        for d in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            m = (r + d[0], c + d[1])
            if m in seen or m in walls:
                continue
            if 0 <= m[0] < n and 0 <= m[1] < n:
                seen.add(m)
                stack.append(m)
    if len(seen) != len(white):
        return None

    return across, down


def make_shape(n):
    """Try wall counts until a legal, fully checked shape appears."""
    targets = {9: [26, 28, 24], 7: [12, 14, 10], 5: [0, 4]}[n]
    for _ in range(200):
        count = random.choice(targets)
        walls = symmetric_walls(n, count) if count else set()
        shape = valid_shape(n, walls)
        if shape:
            return walls, shape[0], shape[1]
    return None


# ------------------------------------------------------------- barred grids
#
# A barred grid has no black squares. Every square is a letter, and the entries
# are separated by bars drawn on the edges between squares. So a shape is not a
# set of wall positions but a *segmentation*: how each row, and each column,
# divides its n squares into entries of at least MIN_RUN.
#
# That is the whole reason this exists. The black-square generator has to fix
# its wall pattern before the fill starts and then discovers the pattern was
# unfillable; here the segmentation is drawn from a handful of possibilities per
# line and the fill gets a fresh, legal, fully checked shape every single time.

def segmentations(n, lo=MIN_RUN):
    """Every way to cut a line of n squares into entries of at least `lo`.

    Small: at n=9, lo=3 there are six — 3+3+3, 3+6, 4+5, 5+4, 6+3 and 9.
    """
    if n == 0:
        return [()]
    out = []
    for k in range(lo, n + 1):
        if 0 < n - k < lo:
            continue                       # would strand a stub shorter than lo
        for rest in segmentations(n - k, lo):
            out.append((k,) + rest)
    return out


# How often each segmentation is picked. A line of one long word is by far the
# most constrained thing to ask for — a 9 crosses nine other entries and has to
# agree with all of them — and a line of all-threes drains the short-word list,
# which is the scarcest part of the common tier (201 three-letter words against
# 1568 sevens). Both are kept, because a grid of nothing but 4s and 5s looks
# mechanical, but neither is the default.
# How much the shaper wants an entry of each length, used to weight one
# segmentation of a run against another. Peaks at 4-8, which is where the word
# list is deep: 960 fours, 1319 fives, 1758 sixes, 1827 sevens, 966 eights. A
# three scores 1 because there are only 372 of them in the whole pool and a grid
# that wants forty of them cannot be filled without repeating; 12+ scores 1
# because past eleven letters the pool is the phrase list and nothing else.
_LEN_WANT = {3: 1, 4: 5, 5: 6, 6: 6, 7: 6, 8: 5, 9: 3, 10: 2, 11: 2}

# How much `seg_weight` wants a long run left uncut at 9x9, which is the only
# lever that puts eight- and nine-letter answers in a nine-by-nine. It competes
# against 5 for a two-part split and 1 for 3+3+3, and a 9-run has six
# segmentations, so this number is most of the mass.
#
# Measured 2026-09-03, six puzzles per sample at a 110s budget, counting answers
# over seven letters. The shipped bank before this change held 4 in 896 nine-by-
# nine entries, 0.16 a puzzle:
#
#   LONG_WHOLE=1 (the old behaviour) ... 0.16/puzzle
#   LONG_WHOLE=12 ...................... 1.00/puzzle, 6 closed
#   LONG_WHOLE=25 ...................... 2.00/puzzle, 6 closed
#   LONG_WHOLE=60 ...................... 2.83, 2.50, 1.67 over three samples
#   LONG_WHOLE=150 ..................... 3.00/puzzle, but 6 closed then 1
#   LONG_WHOLE=400 ..................... 3.00/puzzle, 3 closed — throughput halves
#
# The yield saturates around 3 a puzzle because that is as many long slots as a
# 9x9 shape has room for; past 150 the extra weight only costs fills. 150 looked
# best on one sample and then made a single puzzle on the next, so the knee is
# not where one run suggests. 60 is the value with margin under the cliff, and
# it never once returned a run with no long answer in it at all.
#
# This does nothing to 5x5 or 7x7 — the `n >= 8` guard cannot fire when the
# longest possible run is 7 — and nothing to 15x15, which returns from the
# `n > 9` branch above. Both were re-run to confirm, and both still close.
LONG_WHOLE = 60


def seg_weight(seg, n):
    """Bigger grids need a different bias, so this branches on n.

    At 5, 7 and 9 the flat weighting below is tuned and works. At 15 it does
    not: measured over 412 shapes, the average 15x15 came back with 93 entries
    of which 44 were three-letter, against a pool holding 372 threes in total
    and a rule that no answer may repeat anywhere inside a run. No fill closed.

    So above 9 the weight is built from the *parts* rather than their count —
    the product of how much each length is wanted, divided by 3 for every extra
    division so that a run is not chopped finer than it needs to be. That pulls
    a 15-run towards 5+5+5, 4+5+6 and 7+8 and away from 3+3+3+3+3.
    """
    if n > 9:
        w = 1
        for length in seg:
            w *= _LEN_WANT.get(length, 1)
        return max(1, w // (3 ** (len(seg) - 1)))
    if len(seg) == 1:
        # Leaving a run whole is the only way a 9x9 ever gets an eight- or
        # nine-letter answer, and this used to return 1 — the lowest weight on
        # offer, below even 3+3+3. That is why the bank held four answers over
        # seven letters in 896 nine-by-nine entries. The pool is nowhere near
        # the constraint: 1,512 eights and 1,165 nines against 565 threes.
        #
        # Only long runs are promoted. A whole run of 3-7 stays at 1, because
        # at those lengths "don't cut" is not buying a long answer, it is just
        # a coarser grid. The 15x15 is untouched and returns above: the block
        # at LONG_SLOTS records eight measured attempts to lengthen it, none of
        # which closed, and that finding stands.
        return LONG_WHOLE if n >= 8 else 1
    if min(seg) == MIN_RUN and len(seg) > 2:
        return 1                           # 3+3+3 and friends
    return 5


# Black squares in a barred grid. Not zero, and this is the whole reason the
# 9x9s exist at all.
#
# A 9x9 with no black squares is 81 squares each checked twice, and that is more
# than this word list can do *fairly*. It fills — but only by reaching into the
# far end of the dictionary, and the grids come back 36-46% uncommon: baric,
# serer, bonce, apery, balas, anele, peba, torr. Filling from the common tier
# instead simply fails, measured at nought in twenty-nine shapes.
#
# A handful of black squares changes that completely. They break the long
# entries that force the awkward crossings, and the same common-tier fill that
# could not close a bare grid in twenty-nine tries closes this one in three.
# The grid still reads as barred — bars do most of the dividing — and it is
# still fully checked.
#
# Wall count is the lever, the same way it is for the black-square grids. Six
# is measurably too few — the fill burns its whole budget on one shape and gets
# through eight in half a minute; at eight it gets through one a second.
BARRED_BLOCKS = {15: [34, 38, 42], 9: [8, 10, 12], 7: [0, 4], 5: [0]}

# Runs of this length or shorter are left as one entry instead of being cut by
# bars. Only 15x15 sets it: at the small sizes cutting everything is the point,
# because bars are what let a 7x7 be solid letters with no black squares at all.
# At fifteen the walls have already done the dividing and further cuts only
# multiply three-letter entries the pool cannot supply.
SPLIT_ABOVE = {15: 7}

# Shortest entry a size will accept, where that is not MIN_RUN. This is the one
# number that decides whether a 15x15 fills.
#
# In a fully checked grid every letter of a three-letter entry is a crossing
# letter, so the entry is not "find a word matching a pattern" — it is an exact
# hit against the three-letter list, and there are only 371 of those against
# 26^3 possible strings. Measured 2026-08-21: of the 676 possible first/last
# letter pairs, 436 — 64% — have no three-letter word at all. A 15x15 shaped
# the ordinary way asks for about thirty of these to come good at once, and the
# fill spent two hundred shapes never once managing it, at every block count
# from 0 to 88 and every step budget from 4,000 to 40,000.
#
# Raising the floor to four removes that class of constraint entirely. Four is
# also where the pool stops being thin: 957 fours, 1318 fives, 1756 sixes, 1827
# sevens. The nines are untouched and stay at three, which is why they have
# always filled — a 9x9 carries about twelve threes, not thirty.
MIN_ENTRY = {}

# Shortest *run between black squares* a size will accept, which is a different
# and gentler thing from MIN_ENTRY. Bars may still cut a run below this, so a
# three or a four remains possible where the fill needs one — but the walls stop
# manufacturing them wholesale.
#
# This is the lever for keeping the 15x15 off the short-word list. Measured over
# the two shipped fifteens, one puzzle was eating 39 three-letter answers — 6% of
# the entire 639-word three-letter pool in a single grid — while using 4.5
# sevens out of 2,270 available. The small grids need those threes far more: a
# 9x9 has nowhere else to go, and a 5x5 has nothing but fives.
#
# Forbidding threes outright (MIN_ENTRY = 4 or 5) was tried and does not fill —
# 21 shapes at four letters, none closed — because every entry then crosses more
# entries and the grid over-constrains. Spacing the walls instead keeps the fill
# tractable and still moves the bulk of the grid into 5-8, where the pool is
# deepest and barely touched.
WALL_FLOOR = {}

# How many runs each line of a 15x15 is cut into, which is the same as how many
# black squares it spends: k runs need k-1 blocks between them. With a
# four-letter floor 15 = 4+1+4+1+5 is the densest a line can legally get, so
# three runs a line is the ceiling. None means "any".
WALL_PARTS = {15: [1, 2, 3]}

# Attempts to push the 15x15 onto longer entries, and why none of them ship.
#
# The concern is real and measurable: one 15x15 consumes 39 three-letter
# answers, 6% of the whole 639-word three-letter pool, while using 4.5 sevens
# out of 2,270 available. Six approaches were tried, all measured on the current
# pool, and every one of them stops the grid filling:
#
#   MIN_ENTRY = 4 (no threes at all) ........... 21 shapes, none closed
#   MIN_ENTRY = 5 .............................. 43 shapes, none closed
#   WALL_FLOOR = 5, walls spaced so no run < 5 . 43 shapes, none closed
#   WALL_FLOOR = 4 ............................. 23 shapes, none closed
#   fewer blocks (22-30) to lengthen the runs ... 54 shapes, none closed
#   segmentation reweighted toward 5-8 ......... 148 shapes, none closed
#   LONG_SLOTS, demanding 3 entries of 9+ ...... 82 shapes, none closed
#   LONG_SLOTS, demanding only 2 ............... 156 shapes, none closed
#
# The reason is structural rather than a tuning failure. In a fully checked grid
# a three-letter entry crosses three others and a nine-letter entry crosses
# nine, so every letter added to an entry multiplies the agreements the fill has
# to satisfy at once. Short entries are what make a dense grid tractable; they
# are not laziness in the shaper.
#
# The pressure is also not where it looks. At the current cadence — two each of
# 5x5, 7x7 and 9x9 daily, one 15x15 every fifth day — the fifteens account for
# 7.8 of the 71.4 three-letter answers used per day, which is 11%. The nines and
# sevens together are 84% of it. Making the fifteen longer would barely move the
# number even if it worked.
#
# And the list does not run out: GAP is 2, so only the immediately preceding
# puzzle's answers are blocked at a size. Words recycle by design. What is worth
# guarding against is staleness rather than exhaustion, and the answer to that is
# a wider pool — the three-letter tier went from 371 to 639 this session — plus
# the least-used-first spending the Filler already does.
LONG_SLOTS = {}
LONG_LEN = 9

# ---------------------------------------------------------------------------
# Why there is still no 15x15 in the bank. Measured 2026-08-21; read this before
# spending another day on it, because the obvious levers have all been pulled.
#
# Three real obstacles were found and fixed, and none of them was the answer:
#
#   * Three-letter entries. Every letter of one is a crossing letter, so it is
#     an exact hit against 371 words, and 64% of the 676 first/last letter pairs
#     have no three-letter word at all. MIN_ENTRY removes them.
#   * Wall placement. Random symmetric blocks strand two-square stubs under any
#     floor above three — 32 blocks yielded no legal shape in fifteen seconds.
#     wide_walls builds rows from legal segmentations instead.
#   * Speed. Filler.candidates was not memoised, so one node cost eighty
#     intersect-and-sorts, about 2ms. Caching it made the fill five times faster.
#
# With all three in place, roughly 350 shapes were tried across floors of 3, 4,
# 5 and 6, block counts from 0 to 88, and step budgets from 4,000 to 60,000.
# Nothing closed. The newspaper design — 38 to 54 blocks with a three-letter
# floor, which is what a real 15x15 is — failed on 99 shapes.
#
# The word list is the constraint, and the experiment that shows it is clean:
# the same shapes, filled from three pools.
#
#     8,033 ordinary words ........ never closes
#    17,663 (all of freq.txt) ..... never closes
#    47,716 whole app dictionary .. closes in about a second
#
# The gap is at the short lengths a 15x15 is mostly made of: 957 four-letter
# words against the dictionary's 3,363, and 1,318 fives against 6,533. The words
# that make a fifteen fill are the ones the ordinary test exists to reject — that
# successful grid came back holding aalii, ceca, setose, gadid, arak and sard.
#
# And more black squares do not help, which is the counter-intuitive part: they
# trade long entries for short ones, and short is exactly where the pool is
# thinnest. At three runs a line the average grid is 42 four-letter entries.
#
# So the options are all trades, not fixes: loosen the pool for this size and
# ban the results by hand, drop to 11x11 or 13x13 where the ordinary pool may
# reach, or allow unchecked squares. tools/cross-phrases.py helps at nine
# letters and up but cannot help at four.
# ---------------------------------------------------------------------------


def wide_walls(n, lo, parts=None, tries=400):
    """Symmetric black squares that never strand a run shorter than `lo`.

    `symmetric_walls` scatters blocks at random and lets the caller reject what
    it does not like. That works while the floor is three, and stops working at
    four: measured at 15x15, twenty blocks took fifteen seconds to yield one
    acceptable shape and thirty-two never yielded any, because a random block
    almost always leaves a stub of one or two squares somewhere.

    So place them constructively instead. Each row is given a *segmentation* of
    the line into runs of at least `lo` separated by single blocks — 15 becomes
    (15,), (4, 10), (5, 4, 5) and so on — which makes every across run legal by
    construction. Only the columns then have to be checked, and they pass often
    enough to be cheap.

    Rows are mirrored top-to-bottom so the grid keeps the 180-degree rotational
    symmetry a newspaper grid has.
    """
    # Segmentations grouped by how many runs they cut the line into, because
    # that is the same thing as how many black squares the row spends: k runs
    # need k-1 blocks between them. Keying on k is what lets the caller ask for
    # a denser or sparser grid.
    by_k = collections.defaultdict(list)
    for k in range(1, n // lo + 1):
        spare = n - (k - 1)
        if spare < k * lo:
            break
        for seg in segmentations(spare, lo):
            if len(seg) == k:
                by_k[k].append(seg)
    if not by_k:
        return None
    ks = sorted(by_k)
    if parts:
        ks = [k for k in ks if k in parts] or ks
    opts = [seg for k in ks for seg in by_k[k]]

    def row_blocks(seg):
        cols, at = [], 0
        for i, length in enumerate(seg):
            at += length
            if i < len(seg) - 1:
                cols.append(at)
                at += 1
        return cols

    for _ in range(tries):
        walls = set()
        half = (n + 1) // 2
        for r in range(half):
            for c in row_blocks(random.choice(opts)):
                walls.add((r, c))
                walls.add((n - 1 - r, n - 1 - c))
        if all(len(run) >= lo for run in runs(n, walls, True)) and \
           all(len(run) >= lo for run in runs(n, walls, False)):
            return walls
    return None


def barred_shape(n):
    """A few symmetric black squares, then bars cutting the white runs up.

    The bars are where the flexibility lives: a black-square grid can only
    divide a line where it can afford to lose a square, and at 9x9 that
    constraint is most of why the shapes it commits to turn out unfillable.
    """
    for _ in range(200):
        lo_walls = max(MIN_ENTRY.get(n, MIN_RUN), WALL_FLOOR.get(n, 0))
        if lo_walls > MIN_RUN:
            # A floor above three needs walls placed constructively; see
            # wide_walls for why scattering them at random stops working.
            walls = wide_walls(n, lo_walls, WALL_PARTS.get(n))
            if walls is None:
                return None
        else:
            count = random.choice(BARRED_BLOCKS[n])
            walls = symmetric_walls(n, count) if count else set()
        across, down = [], []
        ok = True
        keep = SPLIT_ABOVE.get(n, 0)
        lo = MIN_ENTRY.get(n, MIN_RUN)
        for vertical in (False, True):
            for run in runs(n, walls, vertical):
                if len(run) < lo:
                    ok = False
                    break
                # Above SPLIT_ABOVE a run is left whole and the bars only break
                # what is genuinely too long to fill. At 15x15 that is the
                # difference between a grid the fill can do and one it cannot:
                # cutting every run gave 90-94 entries, of which 34-42 were
                # three-letter, and `fill` re-scores every remaining slot at
                # every node, so a 94-slot grid costs about 1.5ms a node and
                # runs out of its step budget having barely searched. Leaving
                # short runs alone gives about 78 entries of three to seven
                # letters, which is a newspaper 15x15 and is what closes.
                if keep and len(run) <= keep:
                    (down if vertical else across).append(run)
                    continue
                segs = segmentations(len(run), lo)
                if not segs:
                    ok = False
                    break
                seg = random.choices(segs, [seg_weight(s, len(run)) for s in segs])[0]
                i = 0
                for length in seg:
                    (down if vertical else across).append(run[i:i + length])
                    i += length
            if not ok:
                break
        if ok and across and down:
            want_long = LONG_SLOTS.get(n, 0)
            if want_long:
                long_runs = sum(1 for r in across + down if len(r) >= LONG_LEN)
                if long_runs < want_long:
                    continue
            return walls, across, down
    return None


def bar_maps(n, walls, across, down):
    """The bars a set of runs implies, as two n-by-n strings of 0/1.

    `vb[r][c]` is a bar on the *left* edge of square (r, c); `hb[r][c]` one on
    its *top* edge. Column 0 of vb and row 0 of hb are therefore always '0' —
    the grid's outer edge is drawn by the border, not by a bar. Storing the bar
    rather than the cut position means the browser can ask "is there a bar here"
    about a square directly, without arithmetic.

    An entry that begins right after a black square gets no bar: the square is
    already the division, and drawing a bar against it would say the same thing
    twice and look like a mistake.
    """
    vb = [['0'] * n for _ in range(n)]
    hb = [['0'] * n for _ in range(n)]
    for run in across:
        r, c = run[0]
        if c and (r, c - 1) not in walls:
            vb[r][c] = '1'
    for run in down:
        r, c = run[0]
        if r and (r - 1, c) not in walls:
            hb[r][c] = '1'
    return [''.join(row) for row in vb], [''.join(row) for row in hb]


def entry_runs(n, rows, vb=None, hb=None):
    """Every entry in a grid: runs broken by black squares and by bars.

    The one place that walks a finished puzzle, so the repeat counter, the
    emitter and the checker cannot disagree about what its entries are.
    """
    out = []
    for vertical in (False, True):
        for a in range(n):
            cur = []
            for b in range(n):
                r, c = (b, a) if vertical else (a, b)
                if rows[r][c] == '#':
                    if cur:
                        out.append(cur)
                    cur = []
                    continue
                bar = bool(vb) and b > 0 and (
                    (hb[r][c] == '1') if vertical else (vb[r][c] == '1'))
                if bar and cur:
                    out.append(cur)
                    cur = []
                cur.append((r, c))
            if cur:
                out.append(cur)
    return out


# ------------------------------------------------------- reading a cached puzzle
#
# A cached puzzle is [n, rows] with black squares, or [n, rows, vb, hb] barred.
# Everything downstream — the repeat counter, the emitter, the checker — needs
# its entries, and all of them used to derive walls from '#' by hand. They go
# through here now so there is one answer to "what are this puzzle's entries".

def puzzle_runs(p):
    n, rows = p[0], p[1]
    return entry_runs(n, rows, *(p[2:4] if len(p) > 2 else ()))


def puzzle_answers(p):
    rows = p[1]
    return [''.join(rows[r][c] for r, c in run) for run in puzzle_runs(p)]


# ---------------------------------------------------------------- fill

class Filler:
    """Word lookup by length and known letters.

    The obvious version — scan every word of the right length against a regex —
    is what made the first build too slow to finish: the fill asks this question
    tens of thousands of times per grid. Indexing (length, position, letter) and
    intersecting the sets turns each question into a couple of set operations.
    """

    def __init__(self, words, used, salt=0, cap=REPEAT_CAP):
        """`cap` is how many puzzles an answer may appear in before it retires.

        Repetition is handled by retiring words, not by reordering them. Sorting
        candidates by how often they've been used sounds right and is much worse:
        the head of the list becomes the rare unused words, the fill spends its
        whole budget on those, and grids stop closing at all — measured at zero
        puzzles in thirty seconds, against roughly one every two seconds here.
        A hard cap plus a shuffled pool keeps the search healthy and still
        spreads the vocabulary across the bank.
        """
        self.order = {}                    # word -> rank; lower is tried sooner
        by_len = collections.defaultdict(list)
        for w in words:
            if used[w] >= cap:
                continue                   # retired: it has had its turns
            by_len[len(w)].append(w)
        for k in by_len:
            # Alphabetical inside each tier, and deliberately not shuffled.
            #
            # Shuffling was tried and was roughly thirty times slower: alphabetical
            # order keeps words with shared prefixes adjacent, so the window of
            # candidates the search actually tries is a coherent set rather than a
            # scattering. Variety between puzzles comes from the random wall shapes
            # and from retirement moving the frontier along, not from the ordering.
            by_len[k].sort(key=lambda w: (words[w][1], w))
            for i, w in enumerate(by_len[k]):
                self.order[w] = i
        self.by_len = {k: set(v) for k, v in by_len.items()}
        self.sorted_len = dict(by_len)

        self.idx = collections.defaultdict(set)
        for k, ws in by_len.items():
            for w in ws:
                for i, ch in enumerate(w):
                    self.idx[(k, i, ch)].add(w)
        self.used = used
        self._cache = {}

    def candidates(self, length, pattern):
        """Words of `length` matching `pattern` ('.' is unknown), best first.

        Memoised, and that is not a micro-optimisation. `fill` picks the most
        constrained slot by asking this about *every* remaining slot at every
        node, so one step of a 15x15 costs eighty intersect-and-sort calls. The
        patterns repeat constantly — backtracking revisits the same partial grid
        from different directions, and most slots are untouched by any given
        placement — so the same question is asked over and over. Measured on
        2026-08-21 at 15x15: 2ms a node without this, which spends a 8,000-step
        budget in sixteen seconds and barely searches at all.

        The cache is safe for the life of one fill and no longer. `used` is read
        at construction and the index never changes afterwards, so a Filler is
        immutable once built — and rebuild-bank.py makes a fresh one per shape.
        """
        key = (length, pattern)
        hit = self._cache.get(key)
        if hit is not None:
            return hit
        known = [(i, ch) for i, ch in enumerate(pattern) if ch != '.']
        if not known:
            out = self.sorted_len.get(length, [])
            self._cache[key] = out
            return out
        sets = [self.idx.get((length, i, ch)) for i, ch in known]
        if any(s is None for s in sets):
            self._cache[key] = []
            return []
        sets.sort(key=len)
        out = sets[0]
        for s in sets[1:]:
            out = out & s
            if not out:
                self._cache[key] = []
                return []
        out = sorted(out, key=self.order.get)
        self._cache[key] = out
        return out


def fill(n, across, down, filler, deadline=60000):
    """Backtracking fill. Returns {cell: letter} or None."""
    slots = [(run, 'A') for run in across] + [(run, 'D') for run in down]
    grid = {}
    steps = [0]
    # A word may not appear twice in one grid — two identical clues in the same
    # puzzle is a bug you can see. This used to be checked after the fill
    # finished and the whole grid thrown away, which is affordable when grids are
    # cheap and ruinous when they are not: at 9x9 barred, nine of the first
    # forty-three shapes filled and every single one was discarded for a repeat.
    # Refusing the word at the point of placing it turns those into puzzles.
    taken = set()

    def pattern(run):
        return ''.join(grid.get(cell, '.') for cell in run)

    def solve(remaining):
        steps[0] += 1
        if steps[0] > deadline:
            raise TimeoutError
        if not remaining:
            return True
        # most constrained slot first — the standard win here
        best, best_c = None, None
        for i, (run, _) in enumerate(remaining):
            cands = filler.candidates(len(run), pattern(run))
            if not cands:
                return False
            if best_c is None or len(cands) < len(best_c):
                best, best_c = i, cands
                if len(cands) == 1:
                    break
        run = remaining[best][0]
        rest = remaining[:best] + remaining[best + 1:]
        # Trying only a handful of candidates is what made the fill stall once
        # words started being spent: the top of the list becomes the rare unused
        # words, and a narrow window of those rarely interlocks.
        for w in best_c[:200]:
            if w in taken:
                continue
            before = {}
            ok = True
            for cell, ch in zip(run, w):
                if cell in grid:
                    if grid[cell] != ch:
                        ok = False
                        break
                else:
                    before[cell] = None
                    grid[cell] = ch
            if ok:
                taken.add(w)
                if solve(rest):
                    return True
                taken.discard(w)
            for cell in before:
                grid.pop(cell, None)
        return False

    try:
        return grid if solve(slots) else None
    except TimeoutError:
        return None


# ---------------------------------------------------------------- output

CACHE = os.path.expanduser('~/cw-cache.json')


def load_cache():
    if os.path.exists(CACHE):
        return json.load(open(CACHE))
    return []


def save_cache(puzzles):
    json.dump(puzzles, open(CACHE, 'w'))


def used_from(puzzles):
    """How often each answer already appears, so the next puzzle avoids them."""
    used = collections.Counter()
    for p in puzzles:
        for a in puzzle_answers(p):
            used[a] += 1
    return used


# The most tier-1 answers a barred grid may contain before it is thrown away.
# Zero under --barred alone; --loose trades some of that for speed.
LOOSE_ODDITIES = 0.2


def build(n, want, budget, barred=False, loose=False):
    """Add puzzles at size `n` to the cache until there are `want`, or time runs out."""
    words = load_words()
    common = sum(1 for w in words if words[w][1] == 0)
    if not common:
        print('warning: no common tier — run --prep to write ~/freq.txt', file=sys.stderr)

    # A barred grid checks every letter twice, so an obscure answer is not just
    # an unfair clue, it is two unfair clues. Filling from the common tier alone
    # is the screen: there is then nothing obscure available to reach for.
    pool = words
    if barred and not loose:
        pool = {w: v for w, v in words.items() if v[1] == 0}
        if not pool:
            sys.exit('--barred needs the common tier; run --prep first')

    puzzles = load_cache()
    have = sum(1 for p in puzzles if p[0] == n)
    print('clueable words: %d (%d common)' % (len(words), common), file=sys.stderr)
    if pool is not words:
        print('barred: filling from the common tier only (%d words)' % len(pool),
              file=sys.stderr)
    print('%dx%d%s: have %d, want %d'
          % (n, n, ' barred' if barred else '', have, want), file=sys.stderr)

    used = collections.Counter({w: 0 for w in pool})
    used.update(used_from(puzzles))
    filler = Filler(pool, used, salt=have)
    started = time.time()
    made, rejected = 0, 0

    while have + made < want and time.time() - started < budget:
        shape = barred_shape(n) if barred else make_shape(n)
        if not shape:
            continue
        walls, across, down = shape
        # A barred shape is cheap and there are a lot of them, so the fill is
        # better off giving up early and trying another than pushing one shape
        # hard: at a 25000-step budget it got through eight shapes in half a
        # minute and found nothing; at 6000 it got through thirty-seven and
        # found five.
        grid = fill(n, across, down, filler, deadline=6000 if barred else 60000)
        if not grid:
            continue
        rows = [''.join('#' if (r, c) in walls else grid[(r, c)] for c in range(n))
                for r in range(n)]
        answers = [''.join(grid[cell] for cell in run) for run in across + down]
        if len(set(answers)) != len(answers):
            continue                       # the same word twice in one grid
        if any(p[1] == rows for p in puzzles):
            continue                       # already have this exact grid
        if barred:
            odd = sum(1 for a in answers if words[a][1] != 0) / len(answers)
            if odd > (LOOSE_ODDITIES if loose else 0):
                rejected += 1
                continue                   # too much crosswordese to be fair
        for w in answers:
            used[w] += 1
        entry = [n, rows]
        if barred:
            entry += list(bar_maps(n, walls, across, down))
        puzzles.append(entry)
        made += 1
        save_cache(puzzles)
        filler = Filler(pool, used, salt=have + made)   # a fresh shuffle each time
        print('  %d/%d' % (have + made, want), file=sys.stderr)

    if rejected:
        print('rejected %d grid(s) on word quality' % rejected, file=sys.stderr)
    print('made %d this run' % made, file=sys.stderr)
    return words, puzzles


def emit(words, puzzles, path):
    """Write the JS data file: the clues actually used, then the grids."""
    counts = collections.Counter()
    for p in puzzles:
        for a in puzzle_answers(p):
            counts[a] += 1

    needed = sorted(counts)
    reps = sum(1 for w in counts if counts[w] > 1)
    by_size = collections.Counter(p[0] for p in puzzles)
    barred = sum(1 for p in puzzles if len(p) > 2)
    print('puzzles: %s (%d barred)' % (dict(sorted(by_size.items())), barred),
          file=sys.stderr)
    print('answers: %d distinct across %d entries, %d used more than once'
          % (len(needed), sum(counts.values()), reps), file=sys.stderr)

    missing = [w for w in needed if w not in words]
    if missing:
        sys.exit('no clue for: %s' % ', '.join(missing[:10]))

    def js(s):
        return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"

    with open(path, 'w', newline='\n', encoding='utf-8') as f:
        f.write(HEADER % (len(puzzles), dict(sorted(by_size.items())), barred,
                          len(needed), sum(counts.values()), reps))
        f.write('  const CROSS_CLUES = {\n')
        for w in needed:
            f.write('    %s:%s,\n' % (w, js(words[w][0])))
        f.write('  };\n\n')
        f.write('  /* A puzzle is one of two shapes, and crossParse() below is the\n'
                '     only thing that knows the difference.\n\n'
                "       * Black-square: an array of rows, '#' where a wall is.\n"
                '       * Barred: {r, v, h}. Every square is a letter; the entries\n'
                '         are divided by bars on the square edges. v[r][c] is a bar\n'
                "         on the left edge of square (r,c), h[r][c] one on its top\n"
                '         edge, so v column 0 and h row 0 are always 0 — the outside\n'
                '         of the grid is a border, not a bar.\n\n'
                '     Entries and clue numbers are worked out from the shape at\n'
                '     runtime — storing them would be storing something derivable. */\n')
        f.write('  const CROSS_GRIDS = [\n')
        for p in sorted(puzzles, key=lambda q: (-q[0], q[1])):
            rows = p[1]
            if len(p) > 2:
                f.write('    {r:[%s],\n     v:[%s],\n     h:[%s]},\n'
                        % tuple(','.join(js(s) for s in part) for part in (rows, p[2], p[3])))
            else:
                f.write('    [%s],\n' % ','.join(js(r) for r in rows))
        f.write('  ];\n')
        f.write(TAIL)


HEADER = '''  /* ---------------- CROSSWORD — the bank ----------------
     %d puzzles (%s), %d of them barred, generated by
     tools/build-crosswords.py. Not made at runtime: the old version laid words
     across each other in the browser and got sparse, sprawling shapes with a
     handful of crossings.

     These are real crossword grids, in two kinds. Most divide their entries
     with black squares alone, in 180-degree rotational symmetry. The newer 9x9s
     are *barred*: entries are divided mainly by thick bars drawn on the edges
     between squares, with only a handful of black squares left. Both kinds are
     fully checked — every square is in an Across and a Down entry of at least
     three letters, so there are no letters you can only get one way.

     Barred is not decoration, it is the only reason the 9x9s exist. A
     black-square grid must commit to its wall pattern before the fill starts,
     and at 9x9 almost every pattern it commits to has no solution: nine runs
     produced nothing at all. Bars can divide a line anywhere, without spending a
     square to do it, so the same word list closes a grid every few seconds.

     What that buys is fairness rather than speed. Because the grids fill easily
     they can be filled from the common tier alone — roughly 8k words that
     WordNet either tags in real text or uses to define other words — instead of
     reaching into the far end of the dictionary for baric, serer, bonce and
     apery, which is what the 9x9 fill does when it is allowed to.

     Size is the only choice. The old easy/medium/hard axis was three word banks,
     and three banks meant the same clues came round within a session.

     %d distinct answers across %d entries; %d of them appear in more than one
     puzzle. Clues are WordNet glosses, trimmed, restricted to common words.
  */

'''

TAIL = '''
  /** The letter rows of a puzzle, whichever of the two shapes it is stored in. */
  function crossRows(g){ return Array.isArray(g) ? g : g.r; }

  /** Walk a grid and work out its entries, numbers and answers.

      A wall and a bar are the same thing to a solver — a place an entry stops —
      so both collapse into `cutL` / `cutT` here and the rest of the walk is
      shared. `cutL(r,c)` asks "is there a break immediately left of this
      square", which is true at a black square, at a bar, and at the grid edge. */
  function crossParse(g){
    const rows = crossRows(g), n = rows.length;
    const bars = Array.isArray(g) ? null : g;
    const wall = (r,c)=> r<0 || c<0 || r>=n || c>=n || rows[r][c] === '#';
    const cutL = (r,c)=> c<=0 || wall(r,c-1) || (!!bars && bars.v[r][c] === '1');
    const cutT = (r,c)=> r<=0 || wall(r-1,c) || (!!bars && bars.h[r][c] === '1');
    const entries = [];
    let num = 0;
    for(let r=0;r<n;r++) for(let c=0;c<n;c++){
      if(wall(r,c)) continue;
      // an entry starts here if it cannot come in from behind and has somewhere
      // to go — a single square between two breaks is not an entry
      const startA = cutL(r,c) && !wall(r,c+1) && !cutL(r,c+1);
      const startD = cutT(r,c) && !wall(r+1,c) && !cutT(r+1,c);
      if(!startA && !startD) continue;
      num++;
      if(startA){
        const cells = [];
        for(let k=c; k<n && !wall(r,k) && (k===c || !cutL(r,k)); k++) cells.push([r,k]);
        entries.push({num, dir:'A', cells, answer:cells.map(([y,x])=>rows[y][x]).join('')});
      }
      if(startD){
        const cells = [];
        for(let k=r; k<n && !wall(k,c) && (k===r || !cutT(k,c)); k++) cells.push([k,c]);
        entries.push({num, dir:'D', cells, answer:cells.map(([y,x])=>rows[y][x]).join('')});
      }
    }
    return {n, rows, entries, bars};
  }

  function crossClue(answer){
    return CROSS_CLUES[answer] || answer;
  }

  /** Puzzle indices at a given size, so a session can walk through them. */
  function crossAtSize(n){
    const out = [];
    for(let i=0;i<CROSS_GRIDS.length;i++) if(crossRows(CROSS_GRIDS[i]).length === n) out.push(i);
    return out;
  }
'''


def main():
    args = sys.argv[1:]
    if '--emit' in args:
        out = args[args.index('--emit') + 1]
        emit(load_words(), [tuple(p) for p in load_cache()], out)
        print('wrote', out, file=sys.stderr)
        return
    if '--prep' in args:
        prep()
        return
    if '--status' in args:
        c = collections.Counter(p[0] for p in load_cache())
        print('cached:', dict(sorted(c.items())), file=sys.stderr)
        return
    n = int(args[args.index('--size') + 1]) if '--size' in args else 5
    want = int(args[args.index('--want') + 1]) if '--want' in args else PER_SIZE
    budget = float(args[args.index('--budget') + 1]) if '--budget' in args else 30.0
    # `--seed` is the only way to explore different shapes. The module-level
    # random.seed() makes a build reproducible, but it also means re-running the
    # same command re-walks the same shapes in the same order and fails in
    # exactly the same place — nine identical 9x9 runs were logged as nine
    # attempts before this was noticed. PYTHONHASHSEED does not help: the
    # candidate lists are sorted before they are used, so dict ordering never
    # reaches the search.
    if '--seed' in args:
        random.seed(int(args[args.index('--seed') + 1]))
    build(n, want, budget, barred='--barred' in args, loose='--loose' in args)


if __name__ == '__main__':
    main()
