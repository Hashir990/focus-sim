#!/usr/bin/env python3
"""
Rebuild the whole crossword bank — every size — from a controlled word list.

Grew out of tools/rebuild-nines.py, which did the same job for the 9x9s only.
Two things made it worth generalising:

  * **Repetition.** The bank is walked in order at each size, and the old build
    spread answers by retiring a word after REPEAT_CAP uses. That stops a word
    appearing ten times; it does nothing to stop it appearing in two puzzles in
    a row, which is what you actually notice. `GAP` is the rule now: an answer
    used in a puzzle cannot come back until GAP puzzles later *at that size*.

  * **Difficulty.** The nines were rebuilt from a deliberately gentle list and
    came out too gentle. `EASY_USES` is the dial — how often WordNet has to
    reach for a word inside other definitions before it counts as ordinary —
    and it is set lower here than it was there, which widens the bank by about
    a thousand words without letting the crosswordese back in.

Clues come from tools/cross-clues.py where there is a hand-written one, and from
a ranked WordNet gloss otherwise. The ranking prefers glosses that are short and
made of ordinary words; `--clues` prints everything still coming from a gloss,
which is the list to read and rewrite by hand.

    python3 tools/rebuild-bank.py --size 9 --want 10 --budget 40   # repeat
    python3 tools/rebuild-bank.py --size 7 --want 11 --budget 40
    python3 tools/rebuild-bank.py --size 5 --want 10 --budget 40
    python3 tools/rebuild-bank.py --clues                          # what to review
    python3 tools/rebuild-bank.py --patch src/js/26-crossword-data.js
"""
import collections
import importlib.util
import json
import os
import random
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
# CW_BANK moves the cache, so a long search for one size can run in the
# background without racing another size for the same file. Whatever it writes
# has to be merged back before --patch, which only ever reads one bank.
CACHE = os.path.expanduser(os.environ.get('CW_BANK') or '~/bank.json')

# How often a word must appear inside other definitions to count as ordinary.
# 25 was the nines' setting and made them too easy; 6 is about two thousand words
# wider and still nowhere near the far end of the dictionary.
EASY_USES = 6
MAX_CLUE = 58

# Words a clue may never end on. Every one of them means shorten() cut inside a
# relative clause rather than at the end of a definition.
DANGLING = set('''
is are was were be been being that which who whom whose and or but a an the
in if when while than of to for with on at by from as into over under about
'''.split())

# Puzzles that must pass before an answer may appear again, at that size.
#
# 4 is what the shipped bank was built to and what it satisfies exactly: several
# answers recur at distance 4 (ace in 9x9 #1 and #5), so raising this retroactively
# puts the existing bank in breach — measured at 58 breaches at 5, and --reorder
# only gets that down to 25, because ten puzzles a size share too much short
# vocabulary to space it further. A wider gap becomes reachable as each size grows
# toward 50; CW_GAP lets a run try one without editing this file, and the run keeps
# the result only if it closes with nothing dropped.
GAP = int(os.environ.get('CW_GAP', '4'))

# Every puzzle is stamped with the run that made it, and no answer may appear
# twice inside one run at any size. Same-day repeats are the ones a solver meets
# together; CW_RUN overrides the stamp when a run spans midnight or has to be
# resumed, so the second half still counts as the same batch as the first.
RUN = os.environ.get('CW_RUN') or time.strftime('%Y-%m-%d')

# Passes the ordinariness test and still not wanted: crosswordese, abbreviations
# that only exist to fill a corner, the crude ones, and a few that are common
# inside other words but never met alone. Grown by reading the answer lists.
BANNED = set("""
aug oct psi ism ken min mew pow sic sis tat tit pus bum ass arse cur dun hun
pap cud abo baas anoa aba ane agar alee ascot taro benne ganef etui erne olio
adit alit anil arum ares seta stele affine ariose imaret teredo ctenoid
egger enate peba balas serer bonce apery baric salmi grume pavis soave amyl
anna abohm argal aery ess ell emu gnu ogee obi oud oka orle
anomie ague bolo citrate comer eared oiled non semi sepia scud strew glower
elfin abed bosom fete tine ogle mow yap shod scab
adsorb borate paean manse withe impute oaken lilt arty bats edged citrine
cilium elute supine talky prewar wads bogey brig patina teem opus moire
toter nosed basal accede decry deem laden allot corona teat lewd clod
apogee efface ocher gird bloc peaky mien brad anus crone
beta zeta gamma delta sepal stamen coypu genus ester esne
chyle dentate joss shaw roarer ovate supra blooded roughen retie intima
bleb ology titer humic sept vas dicot plat
feces arousal
""".split())

# Read off the 2026-08-20 fill, the same way `bleb` was. Each one passed the
# ordinariness test and none of them is a word a solver arrives at from the
# crossing letters: `wen` a skin cyst, `cole` only ever met inside coleslaw,
# `dat` a Tai language rather than the tape, `mil` an artillery angle, `tho`
# another Tai language, `cisco` a lake fish, `pas` a ballet step, `ness` a
# headland, `cant` insincere jargon, `soma` the body, `wally` and `tam` British
# slang and a Scottish hat, `trey` a three, `mara` a Patagonian rodent, `baba`
# a rum cake, `tod` a fox, `lev` Bulgarian money, `genoa` a city or a jib, and
# `meg` a megabyte. `tau`, `chi` and `phi` go with the `beta`/`zeta`/`gamma`/
# `delta` already above: bare Greek letters, and `psi` was banned long since.
#
# Six of these were already in shipped puzzles, so banning them cost the grids
# that held them; those were rebuilt in the same run. `bur`, `roc`, `argot`,
# `glom`, `toed`, `rue`, `ilk` and `berg` are the same tier and are *not* here,
# because they are in shipped puzzles this run had no reason to disturb. They
# are the obvious candidates for the next pass.
BANNED |= set("""
wen cole dat mil tho cisco pas tau ness cant soma wally chi tam trey
mara baba tod lev genoa phi meg
""".split())

# Brought in by the frequency floor and not wanted. wordfreq is case-insensitive,
# so a word scores as common when the *name* is common: `alexia`, `titania`,
# `sabra`, `mantua`, `goa`, `savoy`, `merle` and `bennet` are all here because
# people and places carry them, not because anyone means the common noun. The
# rest are the usual technical and crude tiers the floor cannot see.
BANNED |= set("""
alexia titania sabra mantua goa savoy merle bennet hotspur jasper panzer
duce agha begum kami sura aga hoy zed dolce brill aloha howdy
butyl flexor halide gyrus styrene murine nitrite biotin alanine pineal
taxon trophic ternary laminar peridot testa ataxia caries rhesus torus
fossa apnea aortic eczema lancet lumen ligand diode basalt pyrite
liana mouton kea coot boll chine cuddy scrim eft hod pica laver cinque
publican chattel legate harpy gammon nunnery abbess sexton prefect plenary
usury phallus tittle etude physic obligate simian venter
fucker pecker mulatto schmuck busty bitchy spank puss gangsta sleazy
trashy dork shiv fink hippy boozer boozy doss reefer kinky
parr pes lees chino duchy rondo scion slough butte catchment nave
""".split())

# Named as words a solver never reaches for. Kept as its own block because they
# are the counter-example to the whole automated approach: `fife` scores 3.38
# and `kiosk` 3.00, so no frequency cut removes one and keeps the other, and
# WordNet's tagged count is zero for both. Half are proper nouns in disguise —
# Fife the region, Kali the goddess, som the currency, Portage the town — and
# what is left is crosswordese. A list, not a threshold.
#
# Keep the prose out of the quotes: a comment inside the string is split into
# words like any other line, and an explanation mentioning `cut`, `not`, `one`
# and `rest` quietly banned all four.
BANNED |= set("""
portage kali fife som ire yea nix kola parr
ohm ort ait eft tor rya sri tui moa nis
""".split())

# 2026-08-19: the same tier, reached by two sevens the fill closed that day.
# `ain` is Scots for "own" and sits beside `ane`, already above; `ala` is the
# anatomist's wing and sits beside `alee`; `ana` is a collection of anecdotes
# and sits beside `anoa`. All three passed the ordinariness test on the
# strength of glosses no solver would ever reach for. Both puzzles were pruned
# and rebuilt.
BANNED |= set("""
ain ala ana
""".split())

# The rebuild of those two sevens reached for three more of the same kind, so
# they are here too: `bel` is the unit `decibel` is a tenth of and nobody meets
# it on its own, `daw` is a jackdaw with the jack taken off, and `col` is the
# mountaineer's saddle. Ordinary in a dictionary, not ordinary in a grid.
BANNED |= set("""
bel daw col
""".split())

# 2026-08-21: read off this run's fill. Two are the crude tier the list has
# always excluded — `fag` (whose WordNet first sense is the cigarette, but the
# word is a slur before it is anything else) and `shit`. Two are the
# `bleb`/`daw` tier: `dah` is the long signal in Morse and exists only beside
# `dit`, and `conn` is the naval verb for steering a ship, met by nobody who is
# not on a bridge. All four sat in puzzles built this run; those were pruned and
# rebuilt.
BANNED |= set("""
fag shit dah conn
""".split())

# The rebuild of those grids reached for two more of the same kind. `carte` is
# only ever met inside `a la carte` and `carte blanche`, the way `cole` is only
# met inside coleslaw; `ben` is the Scottish hill and joins `fife`, `tor` and
# `portage` as a proper noun wearing a common-noun gloss.
BANNED |= set("""
carte ben
""".split())

# 2026-08-21, from Hashir reading the exported bank. `roc` is the Sinbad bird
# the note above `bel daw col` already named as an obvious next candidate — it
# was held back only because shipped puzzles used it, and the rebuild drops
# those. `gee` is the horse-driving word and the mild exclamation, both
# crosswordese, and it had run to seven puzzles. `mod` is the sixties scooter
# subculture: a proper noun wearing a common-noun gloss, the `fife` tier.
BANNED |= set("""
gee mod roc
""".split())

# Read off the rebuild's own fill, the same pass that produced `bleb` and
# `carte` before it. `rudd` is a European freshwater fish, `bethel` a house of
# worship nobody calls that, `para` glosses as a Brazilian port city, `hart` is
# the red deer and sits beside `roe` and `daw`, and `planar` is the technical
# tier already holding `laminar`. `dis` came through as the god of the
# underworld. `omega` joins the bare Greek letters — `beta`, `zeta`, `gamma`,
# `delta`, `tau`, `chi`, `phi` and `psi` are all above — and is the last of them.
BANNED |= set("""
rudd bethel para hart planar dis omega
""".split())

# Read off the first two 15x15s. A grid this size reaches much further into the
# short-word list than a nine does, so it surfaces the tiers faster: `cock` and
# `pee` are the crude one, `lea` the crosswordese meadow beside `roe` and
# `daw`, `oft` is archaic, and `acc` is not an abbreviation anybody would
# recognise. `dec` goes with `aug` and `oct`, which have been banned as bare
# month abbreviations since the first list.
BANNED |= set("""
acc dec lea pee cock oft
""".split())

# The list above `wen cole dat` named `bur`, `roc`, `argot`, `glom`, `toed`,
# `rue`, `ilk` and `berg` as the same tier and left them alone only because
# shipped puzzles used them. The bank has since been cleared and rebuilt, so
# there is nothing left to protect and they go. `hap` is archaic for chance and
# `hale` survives only inside "hale and hearty"; both surfaced in the first
# fifteens, which reach further into the short list than any other size.
BANNED |= set("""
bur argot glom toed rue ilk berg hap hale
""".split())

# From the second 15x15. `theta` joins the bare Greek letters — `beta`, `zeta`,
# `gamma`, `delta`, `tau`, `chi`, `phi`, `psi` and `omega` are all above it.
# `rhea` is the South American bird beside `moa` and `erne`, `haw` exists only
# inside "hem and haw", and `chico` is a proper noun wearing a common-noun
# gloss. Widening the three-letter tier makes the fifteens close, and a fifteen
# that closes reaches straight for whatever the ban list has not caught yet.
BANNED |= set("""
theta rhea haw chico actin
""".split())

# The joins of ordinary English, which WordNet's own counts do not always cover.
CLUE_OK = set("""
a an the and or but of to in on at by for from with without into onto over
under about above below after before between during through against along
around as if is are was were be been being am do does did done have has had
having it its he she they them his her their you your we our us not no
nor so than that this these those there here when where which who whom whose
what why how all any both each few more most other some such only own same
very can will just should now up down out off again further once
someone something anyone anything oneself yourself itself themselves
one two three four five six seven eight nine ten first second third
""".split())


def _load(name, attr=None):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'),
                                                  os.path.join(HERE, name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return getattr(mod, attr) if attr else mod


def signals():
    """(tagged, used) counters straight out of the shipped WordNet database."""
    d = os.path.join(ROOT, 'node_modules', 'wordnet-db', 'dict')
    tagged = collections.Counter()
    for line in open(os.path.join(d, 'index.sense'), encoding='latin-1'):
        parts = line.split()
        if len(parts) < 4:
            continue
        try:
            count = int(parts[3])
        except ValueError:
            continue
        tagged[parts[0].split('%')[0]] += count
    used = collections.Counter()
    for fn in ('data.noun', 'data.verb', 'data.adj', 'data.adv'):
        path = os.path.join(d, fn)
        if not os.path.exists(path):
            continue
        for line in open(path, encoding='latin-1'):
            if line.startswith('  '):
                continue
            _, _, gloss = line.partition('|')
            for token in re.findall(r'[a-z]+', gloss.lower()):
                used[token] += 1
    return tagged, used


def common_words():
    """The committed frequency floor — see tools/common-words.txt.

    WordNet's own idea of what is common (`~/freq.txt`) is a gloss-usage
    artifact, not usage data: it has no `goodbye`, no `neon` and no `tux`, but
    it does have `zoroastrianism`. Measured against it, real usage frequency
    (wordfreq's Zipf scale, cut at 2.5) admits about four thousand ordinary
    words the old signals miss, and puts `bleb` at 1.43 — the word that had to
    be added to BANNED by hand on 2026-08-06 would never have been reached.
    """
    return _lines('common-words.txt')


def _lines(name):
    """A committed word list, minus its comment header."""
    path = os.path.join(HERE, name)
    if not os.path.exists(path):
        return set()
    return {w for line in open(path) if not line.startswith('#')
            for w in line.split()}


def shorten(gloss):
    """Cut a WordNet gloss down to something that reads as a clue.

    This is the single biggest thing standing between the bank and a 15x15, and
    it was never about word quality. `word_bank` drops any word whose gloss runs
    past MAX_CLUE, and WordNet writes definitions, not clues: it explains ACORN
    as "fruit of the oak tree: a smooth thin-walled nut in a woody cup-shaped
    cupule" and ABORT as "act of terminating a project or procedure before it is
    completed". Measured 2026-08-21, that rule alone was throwing away 3,232
    words which passed every other test — ABDOMEN, ACCENT, ACCIDENT, ACRONYM,
    ACTIVISM — and it got worse the longer the word, because longer words have
    longer definitions: 41% lost at three letters rising to 28% at seven.

    Almost all of those glosses carry a perfectly good clue in front of the
    elaboration. Cutting at the first colon, semicolon, bracket or the joining
    words that introduce a second sense recovers it. Anything that will not come
    down to length this way is still dropped, and the caller still applies the
    self-reference and coarseness tests to whatever comes back.
    """
    def usable(head):
        """Reject a cut that leaves the clue hanging mid-clause.

        The cuts below are made on punctuation and joining words, which is
        mostly safe and sometimes lands in the middle of a relative clause:
        "card game in which the players..." became "Card game in", "automaton
        that resembles a human being" became "Automaton that resembles a human
        being" only by luck, and `brain` came out as the single word "That".
        Measured 2026-08-21, 175 pool clues ended this way. A clue ending on a
        copula, conjunction or article is always a truncation artefact rather
        than English, so those are refused and the next cut is tried.
        """
        if not (4 <= len(head) <= MAX_CLUE):
            return False
        toks = head.split()
        if len(toks) < 2:
            return False
        return re.sub(r'[^a-z]', '', toks[-1].lower()) not in DANGLING

    g = gloss.strip()
    if len(g) <= MAX_CLUE:
        return g
    # a colon or semicolon almost always separates the definition from the
    # illustration that follows it
    for sep in (':', ';'):
        if sep in g:
            head = g.split(sep)[0].strip()
            if usable(head):
                return head
    # parenthetical asides and trailing examples
    for sep in (' (', ' - ', ' -- ', '--'):
        if sep in g:
            head = g.split(sep)[0].strip()
            if usable(head):
                return head
    # "x or y", "x and y", "x especially z" — keep the first sense only
    for sep in (' especially ', ' or a ', ' or an ', ' or the ',
                ' as in ', ' used to ', ' that is ', ' which '):
        if sep in g:
            head = g.split(sep)[0].strip()
            if usable(head):
                return head
    # last resort: keep whole clauses off the front while they fit
    if ',' in g:
        parts = g.split(',')
        head = parts[0].strip()
        if usable(head):
            return head
    return g


def word_bank(cw):
    """word -> (clue, 0), everything the fill is allowed to use."""
    common = common_words()
    in_use = _lines('in-use-answers.txt')
    # The floor is now the whole test, not a widening of it. WordNet's signals
    # were the thing letting `ort`, `ait` and `epigram` through: they measure
    # how often a lexicographer reaches for a word, which is not how often a
    # person does. Requiring real usage instead retires about eighteen hundred
    # words nobody would want to meet in a grid.
    #
    # Two exemptions, both narrow. CLUE_OK is the joining words — `the`, `and`,
    # `of` — which no frequency list is asked to justify. in-use-answers.txt is
    # every answer already in a shipped puzzle: tightening the pool must never
    # orphan a puzzle that exists, because patch() would then have no clue to
    # write for it. Frequency cannot tell `aloof` and `oboe` from `ovule` and
    # `phage` — all four sit below the line — so what is already in play stays
    # in play, and the floor only governs what gets added next.
    ordinary = lambda w: w in common or w in CLUE_OK or w in in_use
    hand = _load('cross-clues', 'CLUES')

    allowed = set(open(os.path.expanduser('~/scrabble-words.txt')).read().split())
    best = {}
    for line in open(os.path.expanduser('~/clues.tsv'), encoding='utf-8'):
        parts = line.rstrip('\n').split('\t')
        if len(parts) != 3:
            continue
        w, _pos, gloss = parts
        if not (3 <= len(w) <= 15) or w in BANNED or w not in allowed:
            continue
        if not ordinary(w):
            continue
        gloss = shorten(gloss)
        if not (4 <= len(gloss) <= MAX_CLUE):
            continue
        if w in gloss.lower() or w.rstrip('s') in gloss.lower():
            continue
        if cw.COARSE.search(gloss):
            continue
        # plainer glosses sort first; see the note in rebuild-nines.py
        hard = sum(1 for t in re.findall(r'[a-z]+', gloss.lower())
                   if len(t) >= 5 and not ordinary(t))
        fancy = 1 if re.search(r'[;(){}\[\]]', gloss) else 0
        rank = (hard + fancy, len(gloss))
        clue = gloss[0].upper() + gloss[1:]
        if w not in best or rank < best[w][1]:
            best[w] = (clue, rank)
    out = {w: (c, 0) for w, (c, _r) in best.items()}
    # a word with a hand-written clue is in the bank whether or not WordNet
    # had anything printable to say about it
    for w, c in hand.items():
        if w not in BANNED:
            out[w] = (c, 0)
    # Abbreviations, brands and famous names — see tools/extra-answers.py. They
    # skip the `allowed` filter by design: the whole point is that they are not
    # in the dictionary. Three-letter English is thin enough that without them
    # the fill reaches for `ort` and `ait`, which no solver gets from crossings.
    for w, c in _load('extra-answers', 'EXTRA').items():
        if w not in BANNED:
            out[w] = (c, 0)
    # Phrases with the spaces taken out, and people clued by their work — see
    # tools/cross-phrases.py. Like the abbreviations above they skip `allowed`
    # by design, and for the same reason: FLIPACOIN and DITKO were never going
    # to be in a Scrabble dictionary.
    #
    # This pool is what makes a 15x15 possible at all. Ordinary English runs out
    # at length: filtered to words a solver actually meets, the dictionary offers
    # 36 sevens, 2 eights and one nine, and a 15x15 wants nine, eleven, thirteen
    # and fifteen-letter entries in every corner. Without these the fill has
    # nothing to put there.
    for w, c in _load('cross-phrases', 'ALL').items():
        if w not in BANNED:
            out[w] = (c, 0)
    # Song lyrics last, and *added* to whatever the answer already carries
    # rather than replacing it — see tools/cross-lyrics.py. Merged here because
    # this is the only place that can see both the finished pool and the clue
    # table: most of the words a lyric hangs on (LOVE, WIND, MONEY) come from
    # WordNet and never needed a hand-written clue, so doing it inside
    # cross-clues.py reached only ten of the forty.
    #
    # A lyric is never the sole reason a word is in the bank. If the answer did
    # not already make it into `out`, the lyric is dropped.
    for w, lyric in _load('cross-lyrics', 'LYRICS').items():
        if w in BANNED or w not in out:
            continue
        have = out[w][0]
        existing = (have,) if isinstance(have, str) else tuple(have)
        if lyric not in existing:
            out[w] = (existing + (lyric,), 0)
    return out


def load_cache():
    return json.load(open(CACHE)) if os.path.exists(CACHE) else {}


def save_cache(bank):
    json.dump(bank, open(CACHE, 'w'))


def generate(cw, words, n, want, budget, barred=True):
    bank = load_cache()
    have = bank.setdefault(str(n), [])
    used = collections.Counter({w: 0 for w in words})
    for p in have:
        for a in p['answers']:
            used[a] += 1

    print('bank: %d words (%d threes)'
          % (len(words), sum(1 for w in words if len(w) == 3)), file=sys.stderr)
    print('%dx%d: have %d, want %d' % (n, n, len(have), want), file=sys.stderr)

    started = time.time()
    made = 0
    # The index costs about a second to build over seven thousand words, so it
    # is built once and again only when a puzzle lands — which is also the only
    # moment the list it is built from changes.
    def index():
        # Whatever the last GAP-1 puzzles used is off the table, so the same
        # answer cannot come round again until GAP puzzles later.
        recent = set()
        for p in have[-(GAP - 1):]:
            recent |= set(p['answers'])
        # And nothing made earlier in the same run may come back, at any size.
        #
        # GAP alone is per-size and says nothing across sizes, so a word could
        # land in today's 5x5 and again in today's 9x9 — the repeat you would
        # actually meet, because a day's puzzles are played as a batch. This is
        # the one rule that reaches across the bank; between runs GAP takes over
        # again, and where a word does have to come back a later run gives it a
        # second clue rather than repeating the first (see cross-clues.py).
        for size_ps in bank.values():
            for p in size_ps:
                if p.get('run') == RUN:
                    recent |= set(p['answers'])
        pool = {w: v for w, v in words.items() if w not in recent}
        # The stock cap retires an answer after eight puzzles, which is aimed at
        # a bank filled from sixteen thousand words. Out of eight thousand, with
        # GAP already spacing repeats out, retirement is the thing that starves
        # the fill: the sevens went from one a minute to none at all around the
        # seventh puzzle. Three appearances across a whole size is still rare.
        return cw.Filler(pool, used, salt=len(have) + made + int(time.time()))

    cw.make_shape.__globals__['SHAPE_TARGETS'] = None

    # Every size is barred now, not just the nines.
    #
    # Hashir asked for the fives and sevens to lose their black squares. Bars do
    # that for free: they divide a line at any edge without spending a square, so
    # `BARRED_BLOCKS` can ask for zero blocks and still get entries of three or
    # more. A 7x7 built this way is completely full — 107 grids closed out of 152
    # shapes in sixteen seconds, so it costs nothing.
    #
    # A 5x5 with no blocks is the hard one, because the only segmentation of a
    # five-run is (5,) — every row and every column has to be a whole five-letter
    # word, which is a double word square. Out of 1,307 fives it does close, but
    # it needs a far bigger step budget than a grid with somewhere to breathe:
    # nothing at all at the stock 60,000 steps, one in about thirty seconds at
    # 200,000. Hence the per-size deadlines below rather than one number.
    #
    # BARRED_BLOCKS still allows a handful of blocks at 7 (0 or 4) — the "entire
    # spaces for comfort" case, taken only when the fill needs it.
    if barred:
        # Zero blocks at five and seven, not the stock [0, 4] at seven. Hashir
        # asked for the small grids to lose their black squares, and at seven the
        # fill closes so easily without them (107 grids out of 152 shapes in
        # sixteen seconds) that there is no reason to spend the squares. Variety
        # comes from where the bars fall, which is a bigger space than four
        # blocks was. If a seven ever stops closing, [0, 4] is the way back.
        cw.BARRED_BLOCKS.update({5: [0], 7: [0]})
        # CW_BLOCKS5 puts black squares back at five, and there is a hard reason
        # it has to exist. Zero blocks at 5x5 means every row and every column is
        # a whole five-letter word — a double word square — and tools/
        # word-squares.py enumerated the pool exhaustively on 2026-08-21: it
        # contains exactly four, which is two puzzles and their transposes. Both
        # are now in the bank. There is no third solid five to find, so a bank
        # that wants more than two of them has to allow a black square.
        if os.environ.get('CW_BLOCKS5'):
            cw.BARRED_BLOCKS[5] = [int(x) for x in
                                   os.environ['CW_BLOCKS5'].split(',')]
        if n > 9:
            # No shape filter is needed at fifteen any more. It used to reject
            # shapes carrying too many three-letter entries, because those were
            # what the fill choked on; MIN_ENTRY in build-crosswords.py now stops
            # them being generated at all, so every shape that comes back is
            # already the right kind.
            shaper = lambda: cw.barred_shape(n)
        else:
            shaper = lambda: cw.barred_shape(n)
    elif n == 7:
        _stock = cw.make_shape
        def make7():
            for _ in range(200):
                walls = cw.symmetric_walls(7, random.choice([16, 18, 14]))
                shape = cw.valid_shape(7, walls)
                if shape:
                    return walls, shape[0], shape[1]
            return None
        shaper = make7
    elif n == 5:
        # Five is a small space: with four black squares there are only so many
        # distinct grids this bank can close, and the build stalled at nine of
        # them. Six and eight open two more shapes without making the puzzle
        # any less of one.
        def make5():
            for _ in range(200):
                count = random.choice([0, 4, 4, 6, 8])
                walls = cw.symmetric_walls(5, count) if count else set()
                shape = cw.valid_shape(5, walls)
                if shape:
                    return walls, shape[0], shape[1]
            return None
        shaper = make5
    else:
        shaper = (lambda: cw.barred_shape(n)) if n == 9 else (lambda: cw.make_shape(n))

    filler = index()
    while len(have) < want and time.time() - started < budget:
        shape = shaper()
        if not shape:
            continue
        walls, across, down = shape
        # Nines abandon a shape early because barred shapes are cheap and
        # plentiful; a barred five has to be pushed much harder because it is a
        # double word square and there is no easier shape to move on to.
        # A 15x15 is the opposite of a 5x5. The five is expensive because it is
        # over-constrained — a double word square with no slack anywhere — so it
        # is worth pushing one shape very hard. The fifteen has slack everywhere
        # (thirty-odd blocks, and bars on top of that) but a great many cells to
        # fill, so a shape that is going to close does so early and one that is
        # not should be abandoned for another, the way the nines are.
        deadline = {15: 6000, 9: 6000, 7: 60000,
                    5: 200000 if barred else 60000}[n]
        grid = cw.fill(n, across, down, filler, deadline=deadline)
        if not grid:
            continue
        rows = [''.join('#' if (r, c) in walls else grid[(r, c)] for c in range(n))
                for r in range(n)]
        answers = [''.join(grid[cell] for cell in run) for run in across + down]
        if len(set(answers)) != len(answers):
            continue
        if any(p['rows'] == rows for p in have):
            continue
        entry = {'rows': rows, 'answers': answers, 'run': RUN}
        if barred:
            # Every barred size needs its bar maps, not just the nines. This was
            # `if n == 9` and the first barred sevens went out without them: the
            # data file stores a grid with no v/h as a plain array of rows, and
            # crossParse then has nothing to divide a line on, so it read whole
            # rows as single entries — `peepdig`, `godbony`, `flogwry`. The 5x5
            # double word squares happened to survive that, because their only
            # segmentation is the whole five-run anyway, which is exactly why the
            # bug was not visible at every size.
            v, h = cw.bar_maps(n, walls, across, down)
            entry['v'], entry['h'] = list(v), list(h)
        have.append(entry)
        for a in answers:
            used[a] += 1
        made += 1
        save_cache(bank)
        filler = index()
        print('  %d/%d' % (len(have), want), file=sys.stderr)
    print('made %d this run' % made, file=sys.stderr)


def check_gap(bank):
    """Nothing may come back inside GAP puzzles at its own size."""
    bad = []
    for size, puzzles in bank.items():
        for i, p in enumerate(puzzles):
            for j in range(max(0, i - GAP + 1), i):
                shared = set(p['answers']) & set(puzzles[j]['answers'])
                for w in shared:
                    bad.append('%s: %s in #%d and #%d' % (size, w, j + 1, i + 1))
    return bad


def check_run(bank):
    """Nothing may appear twice inside one run, across every size.

    check_gap is per-size and blind to the rest of the bank; this is the rule
    that reaches across it. Only puzzles carrying a run stamp are considered, so
    the bank that shipped before stamping existed is not retroactively in breach.
    """
    where = collections.defaultdict(list)
    for size, puzzles in bank.items():
        for i, p in enumerate(puzzles):
            if not p.get('run'):
                continue
            for a in set(p['answers']):
                where[(p['run'], a)].append('%sx%s #%d' % (size, size, i + 1))
    return ['%s: %s in %s' % (run, a, ' and '.join(ps))
            for (run, a), ps in sorted(where.items()) if len(ps) > 1]


def reorder(bank):
    """Sort each size so nothing repeats inside GAP puzzles.

    Needed because the bank is not built in one pass. Pruning takes puzzles out
    of the middle — a word list is judged by reading the answers it produced,
    which happens after they exist — and topping up appends to the end, so two
    puzzles that were eight apart can end up next to each other. The generator
    only ever looks backwards at the last GAP-1, which is right while it builds
    and says nothing about what pruning did behind it.

    Greedy, and honest about failing: at each position take the first puzzle
    that shares nothing with the last GAP-1 chosen, and if none exists take the
    one that shares least. The bank is small enough that this closes.
    """
    for size in bank:
        pool = list(bank[size])
        out = []
        while pool:
            best, score = None, None
            for i, p in enumerate(pool):
                recent = set()
                for q in out[-(GAP - 1):]:
                    recent |= set(q['answers'])
                n = len(set(p['answers']) & recent)
                if score is None or n < score:
                    best, score = i, n
                if n == 0:
                    break
            out.append(pool.pop(best))
        bank[size] = out
    return bank


def js_grid(p):
    q = lambda xs: '[' + ','.join("'" + x + "'" for x in xs) + ']'
    if 'v' in p:
        return ('    {r:' + q(p['rows']) + ',\n'
                + '     v:' + q(p['v']) + ',\n'
                + '     h:' + q(p['h']) + '},')
    return '    ' + q(p['rows']) + ','


def patch(path, words):
    bank = load_cache()
    bad = check_gap(bank)
    if bad:
        raise SystemExit('answers repeat inside %d puzzles:\n  %s'
                         % (GAP, '\n  '.join(bad[:10])))
    bad = check_run(bank)
    if bad:
        raise SystemExit('answers repeat inside one run:\n  %s'
                         % '\n  '.join(bad[:10]))

    hand = _load('cross-clues', 'CLUES')
    order = [15, 9, 7, 5]
    puzzles = [p for n in order for p in bank.get(str(n), [])]
    need = sorted({a for p in puzzles for a in p['answers']})
    missing = [w for w in need if w not in hand and w not in words]
    if missing:
        raise SystemExit('no clue at all for: ' + ' '.join(missing))

    src = open(path, encoding='utf-8').read()
    start = src.index('const CROSS_GRIDS = [')
    end = src.index('\n  ];', start)
    grids = '\n'.join(js_grid(p) for p in puzzles) + '\n'
    src = src[:start] + 'const CROSS_GRIDS = [\n' + grids + src[end:]

    esc = lambda s: s.replace('\\', '\\\\').replace("'", "\\'")

    def clue_js(w):
        """One clue is a string; an answer that recurs carries several.

        cross-clues.py may hold a tuple for an answer the bank could not avoid
        reusing, so that the second meeting asks a different question. crossClue
        picks between them by puzzle index."""
        # word_bank() already folds the hand-written table in, and then adds
        # the song lyrics on top of it — so its value is the *complete* clue,
        # and preferring `hand` here would silently drop every lyric from any
        # answer that also has a hand-written definition.
        c = words[w][0] if w in words else hand[w]
        if isinstance(c, (list, tuple)):
            return '[' + ','.join("'" + esc(x) + "'" for x in c) + ']'
        return "'" + esc(c) + "'"

    lines = ''.join("    %s:%s,\n" % (w, clue_js(w)) for w in need)
    cstart = src.index('const CROSS_CLUES = {')
    cend = src.index('\n  };', cstart)
    src = src[:cstart] + 'const CROSS_CLUES = {\n' + lines + src[cend + 1:]

    open(path, 'w', encoding='utf-8').write(src)
    byhand = sum(1 for w in need if w in hand)
    print('patched %s: %d puzzles, %d clues (%d hand-written)'
          % (path, len(puzzles), len(need), byhand), file=sys.stderr)


def main():
    args = sys.argv[1:]
    cw = _load('build-crosswords')
    words = word_bank(cw)
    if '--patch' in args:
        patch(args[args.index('--patch') + 1], words)
        return
    if '--clues' in args:
        hand = _load('cross-clues', 'CLUES')
        bank = load_cache()
        seen = collections.Counter()
        for size in bank:
            for p in bank[size]:
                for a in p['answers']:
                    seen[a] += 1
        for w in sorted(seen):
            if w not in hand:
                print('%-10s %d  %s' % (w, seen[w], words[w][0] if w in words else '?'))
        return
    if '--prune' in args:
        bank = load_cache()
        gone = []
        for size in list(bank):
            keep = [p for p in bank[size] if all(a in words for a in p['answers'])]
            gone += [a for p in bank[size] if p not in keep
                     for a in p['answers'] if a not in words]
            bank[size] = keep
        save_cache(bank)
        print('pruned; dropped %s' % ' '.join(sorted(set(gone))), file=sys.stderr)
        return
    if '--fix-gaps' in args:
        # Reorder first, then throw away whatever still repeats too soon, then
        # top the bank back up. Generation only ever appends, and only ever
        # looks back at the last GAP-1 puzzles, so anything added after this
        # point is clean by construction — which is why the order is left alone
        # afterwards.
        # Deliberately *not* reordered first. Reordering to satisfy the gap and
        # then dropping what still breaks it is worse than either on its own:
        # the greedy order moves puzzles next to ones they share words with,
        # and the drop then takes those out — twice it emptied the nines down to
        # a third of the bank. Walking the order they were built in and dropping
        # only what genuinely repeats too soon loses one or two.
        bank = load_cache()
        for size, ps in bank.items():
            keep = []
            for p in ps:
                recent = set()
                for q in keep[-(GAP - 1):]:
                    recent |= set(q['answers'])
                if not (set(p['answers']) & recent):
                    keep.append(p)
            bank[size] = keep
        save_cache(bank)
        print({k: len(v) for k, v in sorted(bank.items())},
              'breaches', len(check_gap(bank)), file=sys.stderr)
        return
    if '--reorder' in args:
        bank = reorder(load_cache())
        save_cache(bank)
        print('reordered; gap breaches now', len(check_gap(bank)), file=sys.stderr)
        return
    if '--status' in args:
        bank = load_cache()
        print({k: len(v) for k, v in sorted(bank.items())}, file=sys.stderr)
        print('gap breaches:', len(check_gap(bank)), file=sys.stderr)
        runs = collections.Counter(p.get('run') for ps in bank.values() for p in ps)
        print('same-run breaches:', len(check_run(bank)),
              '| runs:', dict(sorted((k, v) for k, v in runs.items() if k)),
              file=sys.stderr)
        return
    n = int(args[args.index('--size') + 1]) if '--size' in args else 5
    want = int(args[args.index('--want') + 1]) if '--want' in args else 10
    budget = float(args[args.index('--budget') + 1]) if '--budget' in args else 40.0
    random.seed()
    # Barred is the default at every size now. --walls asks for the old
    # black-square shapes, which is only useful for reproducing an older puzzle.
    generate(cw, words, n, want, budget, barred='--walls' not in args)


if __name__ == '__main__':
    main()
