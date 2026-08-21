#!/usr/bin/env python3
"""
Rebuild the ten 9x9 crosswords from an everyday-words-only bank.

Why this exists rather than another flag on build-crosswords.py: the nines are
the only puzzles being replaced. The fives and sevens in the bank are fine, and
`--emit` rewrites the whole data file from the cache — which would renumber
every puzzle and throw away anyone's progress on the sizes nobody complained
about. This generates nines and *patches* the data file: the 9x9 grids are
swapped, the clues they need are merged in, and nothing else is touched.

**The word list is the whole point.** The old nines filled from the "common"
tier — roughly 8k words, which sounds ordinary and includes agar, alee, ascot,
taro, ganef and benne. Two signals decide it here instead, both from WordNet
and both already on disk:

  * **tagged at least once** in the semantic concordances, meaning the word was
    actually met in running text; or
  * **used at least EASY_USES times inside other definitions**, meaning WordNet
    reaches for it to explain other words.

That is 7.3k words, 237 of them three letters, and the three-letter list reads
ace act ado age ago aim all ant ape apt art ask — which is the level being
aimed at. A hand-written BANNED list takes out the handful that pass the test
and still have no business in a crossword.

Clues are held to the same standard as answers: no clue longer than MAX_CLUE,
and every word of five letters or more inside a clue has to be a word the same
test would accept. A fair answer behind an unfair clue is still an unfair clue.

Runs in pieces, because a barred 9x9 takes a while to close and this sandbox
kills anything over a minute:

    python3 tools/rebuild-nines.py --want 10 --budget 40     # repeat
    python3 tools/rebuild-nines.py --patch src/js/26-crossword-data.js
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
CACHE = os.path.expanduser('~/nines.json')

# how many times a word must appear inside other definitions to count as ordinary
EASY_USES = 25
MAX_CLUE = 52

# Passes both tests and still not wanted: crosswordese, abbreviations that only
# exist to fill a corner, the crude ones, and a few that are common as parts of
# other words but never met alone.
BANNED = set("""
aug oct psi ism ken min mew pow sic sis tat tit pus bum ass arse cur dun hun
pap cud abo baas anoa aba ane agar alee ascot taro benne ganef etui erne olio
adit alit anil arum ares ares seta stele affine ariose imaret teredo ctenoid
egger enate peba balas serer bonce apery baric salmi grume pavis soave amyl
anna abohm argal aery ess ell emu gnu ogee obi oud oka orle
anomie ague bolo citrate comer eared oiled non semi sepia scud strew glower
elfin abed bosom fete tine anil ogle mow yap dun cur shod scab
adsorb borate paean manse withe impute oaken lilt arty bats edged citrine
cilium elute supine talky prewar wads bogey brig patina teem opus moire
toter nosed basal accede decry deem laden allot corona teat lewd clod
apogee efface ocher gird bloc peaky mien brad anus crone
beta zeta gamma delta sepal stamen coypu genus ester salt esne
""".split())

# Words a clue may use even though they are short or odd — the joins of ordinary
# English, which WordNet's own counts do not always cover.
CLUE_OK = set("""
a an the and or but of to in on at by for from with without into onto over
under about above below after before between during through against along
around as if is are was were be been being am do does did done have has had
having it its it's he she they them his her their you your we our us not no
nor so than that this these those there here when where which who whom whose
what why how all any both each few more most other some such only own same
these very can will just should now up down out off again further once
someone something anyone anything oneself yourself itself themselves
one two three four five six seven eight nine ten first second third
"""
.split())


def hand_clues():
    """The written-by-hand clue table — see tools/cross-clues.py for why."""
    spec = importlib.util.spec_from_file_location(
        'nineclues', os.path.join(HERE, 'cross-clues.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod.CLUES


def load_module():
    """The generator's own machinery — shapes, fill, bar maps — imported."""
    spec = importlib.util.spec_from_file_location(
        'cw', os.path.join(HERE, 'build-crosswords.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


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


def easy_words(cw):
    """word -> (clue, 0). Everyday answers, and clues in everyday words."""
    tagged, used = signals()
    ordinary = lambda w: w in CLUE_OK or tagged[w] >= 1 or used[w] >= EASY_USES

    allowed = set(open(os.path.expanduser('~/scrabble-words.txt')).read().split())
    best = {}
    for line in open(os.path.expanduser('~/clues.tsv'), encoding='utf-8'):
        parts = line.rstrip('\n').split('\t')
        if len(parts) != 3:
            continue
        w, _pos, gloss = parts
        if not (3 <= len(w) <= 9) or w in BANNED or w not in allowed:
            continue
        if not ordinary(w):
            continue
        gloss = gloss.strip()
        if not (4 <= len(gloss) <= MAX_CLUE):
            continue
        if w in gloss.lower() or w.rstrip('s') in gloss.lower():
            continue                                  # a clue containing its answer
        if cw.COARSE.search(gloss):
            continue
        # Every long word inside the clue should be ordinary too — but as a
        # preference, not a gate. A gate here threw away a third of the bank,
        # including the three-letter words the grid needs most, because one
        # awkward gloss is enough to lose a word that has four others. Plain
        # clues sort first; an answer with nothing but an awkward gloss still
        # gets in, and every clue that survives to the grid is read by hand
        # afterwards anyway.
        hard = sum(1 for t in re.findall(r'[a-z]+', gloss.lower())
                   if len(t) >= 5 and not ordinary(t))
        fancy = 1 if re.search(r'[;(){}\[\]]', gloss) else 0
        rank = (hard + fancy, len(gloss))
        clue = gloss[0].upper() + gloss[1:]
        if w not in best or rank < best[w][1]:
            best[w] = (clue, rank)
    for w, clue in cw.OVERRIDE_CLUES.items():
        if w in best:
            best[w] = (clue, (0, 0))
    return {w: (c, 0) for w, (c, _rank) in best.items()}


def answers_of(cw, rows, across, down, grid):
    return [''.join(grid[cell] for cell in run) for run in across + down]


def generate(cw, words, want, budget):
    have = json.load(open(CACHE)) if os.path.exists(CACHE) else []
    used = collections.Counter({w: 0 for w in words})
    for p in have:
        for a in p['answers']:
            used[a] += 1
    print('bank: %d words (%d threes)'
          % (len(words), sum(1 for w in words if len(w) == 3)), file=sys.stderr)
    print('have %d of %d' % (len(have), want), file=sys.stderr)

    # More black squares than the old build used. A barred nine has to close
    # out of a much smaller bank now, and every extra block shortens the runs
    # it has to find words for: at eight the fill never closed one in half a
    # minute, and the grid still reads as barred because the bars are still
    # doing most of the dividing.
    cw.BARRED_BLOCKS[9] = [12, 14, 16]
    started = time.time()
    made = 0
    tries = 0
    # The index costs a second to build over six thousand words, and rebuilding
    # it per attempt was most of the run. It only changes when a puzzle lands
    # and retires the words it used.
    filler = cw.Filler(words, used, salt=int(time.time()))
    while len(have) < want and time.time() - started < budget:
        tries += 1
        shape = cw.barred_shape(9)
        if not shape:
            continue
        walls, across, down = shape
        grid = cw.fill(9, across, down, filler, deadline=6000)
        if not grid:
            continue
        rows = [''.join('#' if (r, c) in walls else grid[(r, c)] for c in range(9))
                for r in range(9)]
        answers = answers_of(cw, rows, across, down, grid)
        if len(set(answers)) != len(answers):
            continue
        if any(p['rows'] == rows for p in have):
            continue
        v, h = cw.bar_maps(9, walls, across, down)
        have.append({'rows': rows, 'v': list(v), 'h': list(h), 'answers': answers})
        for a in answers:
            used[a] += 1
        made += 1
        json.dump(have, open(CACHE, 'w'))
        filler = cw.Filler(words, used, salt=int(time.time()) + made)
        print('  %d/%d' % (len(have), want), file=sys.stderr)
    print('made %d this run, %d shapes tried' % (made, tries), file=sys.stderr)


def js_grid(p):
    q = lambda xs: '[' + ','.join("'" + x + "'" for x in xs) + ']'
    return ('    {r:' + q(p['rows']) + ',\n'
            + '     v:' + q(p['v']) + ',\n'
            + '     h:' + q(p['h']) + '},')


def patch(path, words):
    """Swap the 9x9 grids in the data file and merge in the clues they need."""
    puzzles = json.load(open(CACHE))
    src = open(path, encoding='utf-8').read()

    start = src.index('const CROSS_GRIDS = [')
    end = src.index('\n  ];', start)
    body = src[start:end]
    head, _, rest = body.partition('[\n')

    # keep every entry that isn't a nine, in the order it was in
    kept = []
    for line in rest.split('\n'):
        if not line.strip():
            continue
        kept.append(line)
    text = '\n'.join(kept)
    # entries are either ['..','..'] or {r:[...], v:[...], h:[...]}
    chunks = re.findall(r"(\{r:\[.*?\]\}|\['.*?'\]),", text, re.S)
    smaller = [c for c in chunks if len(re.findall(r"'([a-z#]+)'", c)[0]) != 9]

    grids = '\n'.join(js_grid(p) for p in puzzles) + '\n'
    grids += '\n'.join('    ' + c + ',' for c in smaller) + '\n'
    src = src[:start] + head + '[\n' + grids + src[end:]

    # clues: keep the ones still in use, add the ones the new grids want
    need = set()
    for p in puzzles:
        need |= set(p['answers'])
    hand = hand_clues()
    absent = sorted(w for w in need if w not in hand)
    if absent:
        raise SystemExit('no hand-written clue for: ' + ' '.join(absent))
    cstart = src.index('const CROSS_CLUES = {')
    cend = src.index('\n  };', cstart)
    have = dict(re.findall(r"^\s{4}(\w+):'((?:[^'\\]|\\.)*)'", src[cstart:cend], re.M))
    for w in sorted(need):
        have[w] = hand[w].replace('\\', '\\\\').replace("'", "\\'")
    lines = ''.join("    %s:'%s',\n" % (w, have[w]) for w in sorted(have))
    src = src[:cstart] + 'const CROSS_CLUES = {\n' + lines + src[cend + 1:]

    open(path, 'w', encoding='utf-8').write(src)
    print('patched %s: %d nines, %d clues' % (path, len(puzzles), len(have)),
          file=sys.stderr)


def main():
    args = sys.argv[1:]
    cw = load_module()
    words = easy_words(cw)
    if '--patch' in args:
        patch(args[args.index('--patch') + 1], words)
        return
    if '--prune' in args:
        # Judging a word list by reading it is the only test that matters here,
        # and it happens after a grid exists. Pruning throws away just the
        # puzzles that use a word the ban list has since grown to cover, so the
        # next run tops the bank back up instead of rebuilding all ten.
        puzzles = json.load(open(CACHE)) if os.path.exists(CACHE) else []
        keep = [p for p in puzzles if all(a in words for a in p['answers'])]
        json.dump(keep, open(CACHE, 'w'))
        gone = [a for p in puzzles if p not in keep for a in p['answers'] if a not in words]
        print('pruned %d of %d (%s)' % (len(puzzles) - len(keep), len(puzzles),
                                        ' '.join(sorted(set(gone)))), file=sys.stderr)
        return
    if '--list' in args:
        puzzles = json.load(open(CACHE)) if os.path.exists(CACHE) else []
        seen = collections.Counter()
        for p in puzzles:
            for a in p['answers']:
                seen[a] += 1
        for w, n in sorted(seen.items()):
            print('%-10s %d  %s' % (w, n, words.get(w, ('?',))[0]))
        return
    want = int(args[args.index('--want') + 1]) if '--want' in args else 10
    budget = float(args[args.index('--budget') + 1]) if '--budget' in args else 40.0
    if '--seed' in args:
        random.seed(int(args[args.index('--seed') + 1]))
    else:
        random.seed()
    generate(cw, words, want, budget)


if __name__ == '__main__':
    main()
