#!/usr/bin/env python3
"""
Re-create the two sandbox-local inputs build-crosswords.py expects but does not
build itself, and seed its cache from the bank that already ships.

Why this exists: the scheduled crossword run starts in a fresh sandbox, so
`~/cw-cache.json` is empty and `~/scrabble-words.txt` is missing. Both failures
are silent and both are destructive:

  * Empty cache. `--emit` writes the whole file from the cache, so emitting with
    an empty cache replaces the shipped bank with whatever the run just made.
  * Missing ~/scrabble-words.txt. load_words() only applies the app-dictionary
    filter `if allowed and ...`, so an absent file widens the pool from 16k to
    35k and the fill happily uses words the app does not accept. Measured: a 9x9
    built without it contained ded, iaa, aas and hrolf — squares you cannot
    solve. Every answer in the shipped bank is in the dictionary.

Run this once per sandbox, after --prep:

    python3 tools/cw-prep-sandbox.py

~/freq.txt used to be left alone here, on the grounds that it was an external
list and inventing one would alter the bank's character unverifiably. It is no
longer external: `build-crosswords.py --prep` derives it from the tagged sense
counts in WordNet's own index.sense, which ships inside `wordnet-db`. This
script only checks it is there, because without it every word lands in tier 1,
the common tier is empty, and `--barred` has nothing to fill from.
"""
import collections, importlib.util, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'src', 'js', '26-crossword-data.js')
SCRAB = os.path.join(ROOT, 'src', 'js', '31-scrabble-data.js')
CACHE = os.path.expanduser('~/cw-cache.json')
WORDS = os.path.expanduser('~/scrabble-words.txt')


def dump_dictionary():
    """Decode SCR_PACKED with the same front-coding the app unpacks at runtime."""
    src = open(SCRAB, encoding='utf-8').read()
    m = re.search(r"const SCR_PACKED\s*=\s*'((?:[^'\\]|\\.)*)'", src, re.S)
    if not m:
        sys.exit('could not find SCR_PACKED in %s' % SCRAB)
    packed = m.group(1).encode().decode('unicode_escape')
    words, prev, i = set(), '', 0
    while i < len(packed):
        keep = ord(packed[i]) - 48
        i += 1
        j = i
        while j < len(packed) and ord(packed[j]) > 57:
            j += 1
        prev = prev[:keep] + packed[i:j]
        words.add(prev)
        i = j
    with open(WORDS, 'w', encoding='utf-8') as f:
        f.write('\n'.join(sorted(words)))
    print('wrote %s — %d words' % (WORDS, len(words)))
    return words


# A grid in the data file is either an array of row strings or the barred form
# {r:[...], v:[...], h:[...]}. The object alternative comes first so that at a
# '{' the whole object is consumed rather than its three inner arrays matching
# as three separate black-square grids.
GRID = re.compile(r"\{\s*r:\[(.*?)\],\s*v:\[(.*?)\],\s*h:\[(.*?)\]\s*\}"
                  r"|\[((?:\s*'(?:[^'\\]|\\.)*'\s*,?)+)\]", re.S)


def _strings(chunk):
    return [s.replace("\\'", "'").replace('\\\\', '\\')
            for s in re.findall(r"'((?:[^'\\]|\\.)*)'", chunk)]


def seed_cache():
    """Rebuild ~/cw-cache.json from the grids already in the emitted data file."""
    src = open(DATA, encoding='utf-8').read()
    m = re.search(r'const CROSS_GRIDS = \[(.*?)\n  \];', src, re.S)
    if not m:
        sys.exit('could not find CROSS_GRIDS in %s' % DATA)
    puzzles = []
    for g in GRID.finditer(m.group(1)):
        if g.group(1) is not None:
            rows, vb, hb = (_strings(g.group(i)) for i in (1, 2, 3))
            extra = [vb, hb]
        else:
            rows, extra = _strings(g.group(4)), []
        n = len(rows)
        if not n or any(len(r) != n for r in rows):
            sys.exit('grid is not square: %r' % (rows,))
        if any(len(part) != n or any(len(r) != n for r in part) for part in extra):
            sys.exit('bar map does not match the grid: %r' % (rows,))
        puzzles.append([n, rows] + extra)
    json.dump(puzzles, open(CACHE, 'w'))
    counts = dict(sorted(collections.Counter(p[0] for p in puzzles).items()))
    barred = sum(1 for p in puzzles if len(p) > 2)
    print('seeded %s — %d puzzles %s, %d barred'
          % (CACHE, len(puzzles), counts, barred))
    return puzzles


def answers(p):
    """Every entry in a puzzle. A bar and a black square both end a run."""
    n, rows = p[0], p[1]
    vb, hb = (p[2], p[3]) if len(p) > 2 else (None, None)
    walls = {(r, c) for r, row in enumerate(rows)
             for c, ch in enumerate(row) if ch == '#'}
    out = []
    for vertical in (False, True):
        for a in range(n):
            run = []
            for b in range(n):
                cell = (b, a) if vertical else (a, b)
                bar = (b > 0 and (hb[b][a] == '1' if vertical else vb[a][b] == '1')
                       if vb else False)
                if cell in walls or bar:
                    if len(run) >= 3:
                        out.append(''.join(rows[y][x] for y, x in run))
                    run = [] if cell in walls else [cell]
                    continue
                run.append(cell)
            if len(run) >= 3:
                out.append(''.join(rows[y][x] for y, x in run))
    return out


def _dict_from(filename, attr):
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), filename)
    if not os.path.exists(path):
        return {}
    spec = importlib.util.spec_from_file_location('cw_' + attr, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return getattr(mod, attr)


def extra_answers():
    """Answers that are deliberately not words.

    Two files, same reason. tools/extra-answers.py holds abbreviations, brands
    and names — IBM, UFO, NASA — which exist because three-letter English is too
    thin to fill a grid without them. tools/cross-phrases.py holds the 15x15
    pool: phrases with the spaces taken out and people clued by their work.
    FLIPACOIN and DITKO are not in a Scrabble dictionary and never will be, so
    the dictionary check has to know about them or every fifteen fails.
    """
    out = {}
    out.update(_dict_from('extra-answers.py', 'EXTRA'))
    out.update(_dict_from('cross-phrases.py', 'ALL'))
    return out


def check(puzzles, words):
    """Every answer must be a word the app accepts, or the grid is unsolvable.

    "Accepts" means the dictionary *or* the curated list of abbreviations and
    famous names, which are answers precisely because the dictionary has never
    heard of them. Anything outside both is unsolvable and fails the run.
    """
    extra = extra_answers()
    bad = collections.Counter()
    for p in puzzles:
        for a in answers(p):
            if a not in words and a not in extra:
                bad[a] += 1
    if bad:
        print('FAIL: %d answers outside the app dictionary: %s'
              % (len(bad), ', '.join(sorted(bad))), file=sys.stderr)
        return False
    print('checked: every answer is in the app dictionary')
    return True


def check_freq():
    """--barred needs a common tier, and an absent freq.txt empties it silently."""
    path = os.path.expanduser('~/freq.txt')
    if not os.path.exists(path):
        print('FAIL: ~/freq.txt is missing — run build-crosswords.py --prep',
              file=sys.stderr)
        return False
    print('checked: ~/freq.txt present (%d common words)'
          % sum(1 for _ in open(path, encoding='utf-8')))
    return True


if __name__ == '__main__':
    words = dump_dictionary()
    puzzles = seed_cache()
    if '--check' in sys.argv and not (check(puzzles, words) & check_freq()):
        sys.exit(1)
