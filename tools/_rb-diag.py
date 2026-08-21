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
STATS=collections.Counter() if False else __import__('collections').Counter()
import importlib.util
import json
import os
import random
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.expanduser('~/bank.json')

# How often a word must appear inside other definitions to count as ordinary.
# 25 was the nines' setting and made them too easy; 6 is about two thousand words
# wider and still nowhere near the far end of the dictionary.
EASY_USES = 6
MAX_CLUE = 58

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


def word_bank(cw):
    """word -> (clue, 0), everything the fill is allowed to use."""
    tagged, used = signals()
    ordinary = lambda w: w in CLUE_OK or tagged[w] >= 1 or used[w] >= EASY_USES
    hand = _load('cross-clues', 'CLUES')

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
        STATS['shapes']+=1
        shape = shaper()
        if not shape:
            STATS['noshape']+=1
            continue
        walls, across, down = shape
        # Nines abandon a shape early because barred shapes are cheap and
        # plentiful; a barred five has to be pushed much harder because it is a
        # double word square and there is no easier shape to move on to.
        deadline = {9: 6000, 7: 60000, 5: 200000 if barred else 60000}[n]
        grid = cw.fill(n, across, down, filler, deadline=deadline)
        if not grid:
            STATS['nofill']+=1
            continue
        rows = [''.join('#' if (r, c) in walls else grid[(r, c)] for c in range(n))
                for r in range(n)]
        answers = [''.join(grid[cell] for cell in run) for run in across + down]
        if len(set(answers)) != len(answers):
            STATS['dupans']+=1
            continue
        if any(p['rows'] == rows for p in have):
            STATS['dupgrid']+=1
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
    print('STATS', dict(STATS), file=sys.stderr)


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
    order = [9, 7, 5]
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
        c = hand.get(w) or words[w][0]
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
