#!/usr/bin/env python3
"""
List ordinary words the fill cannot use, so they can be hand-clued.

WordNet decides the size of the word bank, and it should not. `word_bank()`
builds the pool by walking ~/clues.tsv, so a word only becomes an answer if
WordNet happens to hold a gloss for it that survives shorten(), MAX_CLUE, the
self-reference test and COARSE. A word can be in the app's own dictionary, sit
above the committed frequency floor, and still never appear in a puzzle because
a lexical database written for other purposes has nothing printable to say
about it.

Measured 2026-09-03: **5,359 words** are excluded that way. 4,421 of them have
no WordNet entry *at all*, and the reason is structural rather than a gap in
the data — WordNet stores lemmas, so every regular inflection is missing. The
loss is therefore concentrated exactly where the bank is thinnest:

     3 letters   121        7 letters  1373
     4 letters   262        8 letters   812
     5 letters   927        9 letters   657
     6 letters  1206       10 letters     1

Among them: CROSSWORD, APARTMENT, CHILDREN, FURNITURE, EQUIPMENT, FIREWORKS,
FIREPLACE, BASEBALL, DIAMONDS, DOLPHINS, EVERYONE, ENORMOUS, DOWNLOAD. Nothing
is wrong with any of these. They are missing because `children` is not the
lemma `child` and `airports` is not `airport`.

The fix is not a cleverer gloss filter. It is that a hand-written clue already
admits a word to the pool whether or not WordNet had anything to say — see the
`hand` merge in `word_bank()`. So the pool grows by writing clues, and this
tool exists to say which clues are worth writing next. Run it, take a batch off
the top, write them into tools/cross-clues.py, and the words become available.

    python3 tools/cw-missing.py              # summary and counts
    python3 tools/cw-missing.py --len 9      # every 9-letter word still missing
    python3 tools/cw-missing.py --len 8 --n 80

Words already carrying a clue in cross-clues.py, extra-answers.py or
cross-phrases.py are excluded, as are anything in BANNED, so what it prints is
always work that has not been done yet.
"""
import os, sys, collections, importlib.util

HERE = os.path.dirname(os.path.abspath(__file__))


def _mod(name, path):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, path))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def main():
    args = sys.argv[1:]
    rb = _mod('rb', 'rebuild-bank.py')
    bc = _mod('bc', 'build-crosswords.py')

    common = rb.common_words()
    in_use = rb._lines('in-use-answers.txt')
    ordinary = lambda w: w in common or w in rb.CLUE_OK or w in in_use

    allowed = set(open(os.path.expanduser('~/scrabble-words.txt')).read().split())
    covered = (set(rb._load('cross-clues', 'CLUES'))
               | set(rb._load('extra-answers', 'EXTRA'))
               | set(rb._load('cross-phrases', 'ALL')))

    glosses = collections.defaultdict(list)
    for line in open(os.path.expanduser('~/clues.tsv'), encoding='utf-8'):
        p = line.rstrip('\n').split('\t')
        if len(p) == 3:
            glosses[p[0]].append(p[2])

    missing = collections.defaultdict(list)
    reason = collections.Counter()
    for w in sorted(allowed):
        if not (3 <= len(w) <= 15) or w in rb.BANNED or w in covered:
            continue
        if not ordinary(w):
            continue
        gs = glosses.get(w)
        if not gs:
            reason['no WordNet entry at all'] += 1
            missing[len(w)].append(w)
            continue
        for g in gs:
            g = rb.shorten(g)
            if not (4 <= len(g) <= rb.MAX_CLUE):
                continue
            if w in g.lower() or w.rstrip('s') in g.lower():
                continue
            if bc.COARSE.search(g):
                continue
            break
        else:
            reason['has an entry, no usable gloss'] += 1
            missing[len(w)].append(w)

    if '--len' in args:
        L = int(args[args.index('--len') + 1])
        n = int(args[args.index('--n') + 1]) if '--n' in args else 10 ** 6
        ws = missing.get(L, [])
        print('%d-letter words with no clue (%d):' % (L, len(ws)))
        print(', '.join(ws[:n]))
        return

    total = sum(len(v) for v in missing.values())
    print('%d ordinary dictionary words the fill cannot use.' % total)
    print()
    for k, v in reason.most_common():
        print('  %-30s %5d' % (k, v))
    print()
    for L in sorted(missing):
        print('  %2d letters  %5d' % (L, len(missing[L])))
    print()
    print('Write clues for a batch into tools/cross-clues.py to admit them.')
    print('  python3 tools/cw-missing.py --len 9 --n 60')


if __name__ == '__main__':
    main()
