#!/usr/bin/env python3
"""
Seed ~/bank.json — the cache rebuild-bank.py works from — out of the grids that
already ship in src/js/26-crossword-data.js.

Why this exists: cw-prep-sandbox.py seeds ~/cw-cache.json, which is the cache
*build-crosswords.py* reads. rebuild-bank.py keeps its own cache in a different
file and a different shape (size -> list of dicts, with the answers stored
alongside each grid so the GAP rule can be checked without re-walking a grid).
Nothing seeded that one, so in a fresh sandbox rebuild-bank.py starts from {}.

That is silently destructive in exactly the way the empty cw-cache.json was:
`rebuild-bank.py --patch` rewrites the whole CROSS_GRIDS block from its bank, so
patching from an empty bank would replace all 31 shipped puzzles with whatever
the run just made.

Run this once per sandbox, after cw-prep-sandbox.py:

    python3 tools/cw-seed-bank.py --check

--check additionally reports the GAP breaches in the seeded bank, because the
shipped order has to satisfy the spacing rule before anything is appended to it;
rebuild-bank.py --patch refuses to write while any breach exists.
"""
import collections, importlib.util, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
BANK = os.path.expanduser('~/bank.json')


def _load(name):
    spec = importlib.util.spec_from_file_location(
        name.replace('-', '_'), os.path.join(HERE, name + '.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def main():
    prep = _load('cw-prep-sandbox')       # grid parser + answer walker
    rb = _load('rebuild-bank')            # GAP and its checker

    src = open(prep.DATA, encoding='utf-8').read()
    import re
    m = re.search(r'const CROSS_GRIDS = \[(.*?)\n  \];', src, re.S)
    if not m:
        sys.exit('could not find CROSS_GRIDS in %s' % prep.DATA)

    bank = collections.defaultdict(list)
    for g in prep.GRID.finditer(m.group(1)):
        if g.group(1) is not None:
            rows, vb, hb = (prep._strings(g.group(i)) for i in (1, 2, 3))
            extra = [vb, hb]
        else:
            rows, extra = prep._strings(g.group(4)), []
        n = len(rows)
        p = [n, rows] + extra
        entry = {'rows': rows, 'answers': prep.answers(p)}
        if extra:
            entry['v'], entry['h'] = extra
        bank[str(n)].append(entry)

    bank = dict(sorted(bank.items()))
    json.dump(bank, open(BANK, 'w'))
    counts = {k: len(v) for k, v in bank.items()}
    print('seeded %s — %s' % (BANK, counts))

    if '--check' in sys.argv:
        bad = rb.check_gap(bank)
        print('gap breaches (GAP=%d): %d' % (rb.GAP, len(bad)))
        for line in bad[:10]:
            print('  ' + line)
        if bad:
            print('FAIL: --patch will refuse to write while these exist',
                  file=sys.stderr)
            return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
