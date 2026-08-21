"""Fairness and collision check for tools/cross-phrases.py.

Run it before anything in that file is allowed near a grid:

    python3 tools/check-phrases.py

Six checks, and the first is the one that matters. `stone`, `bale`, `ford`,
`cruise`, `phoenix`, `miller` and `ware` are surnames *and* ordinary words. If
one of them already carries a clue in cross-clues.py, adding it here silently
overrides that clue, and a solver who reads "Star of La La Land" for an answer
clued elsewhere as "young goose" is right to file a bug. That is a hard reject.

The dictionary check is softer and prints a warning rather than failing: a name
that happens to be in the Scrabble word list is fine as long as nothing has
clued it as a word yet, but it is on notice, because the moment the ordinary
sense gets a clue the two are in conflict.
"""
import importlib.util
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAXLEN = 58


def _load(path, attr):
    spec = importlib.util.spec_from_file_location('m_' + attr, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return getattr(mod, attr)


def main():
    src = os.path.join(ROOT, 'tools', 'cross-phrases.py')
    P = _load(src, 'ALL')
    PHRASES = _load(src, 'PHRASES')
    CLUES = _load(os.path.join(ROOT, 'tools', 'cross-clues.py'), 'CLUES')
    EXTRA = _load(os.path.join(ROOT, 'tools', 'extra-answers.py'), 'EXTRA')

    words = set()
    wpath = os.path.expanduser('~/scrabble-words.txt')
    if os.path.exists(wpath):
        words = {w.strip().lower() for w in open(wpath) if w.strip()}

    fails, warns = [], []

    for ans in sorted(P):
        clues = P[ans] if isinstance(P[ans], tuple) else (P[ans],)

        # 1. already clued as an ordinary word — hard reject
        if ans in CLUES:
            fails.append('%-14s already clued in cross-clues.py as %r'
                         % (ans, CLUES[ans]))
        if ans in EXTRA:
            fails.append('%-14s already clued in extra-answers.py as %r'
                         % (ans, EXTRA[ans]))

        # 2. shape
        if not re.fullmatch(r'[a-z]{3,15}', ans):
            fails.append('%-14s not 3-15 plain lowercase letters' % ans)

        for c in clues:
            # 3. length
            if len(c) >= MAXLEN:
                fails.append('%-14s clue is %d chars: %r' % (ans, len(c), c))
            # 4. clue must not contain its own answer, with or without spaces
            flat = re.sub(r'[^a-z]', '', c.lower())
            if ans in c.lower() or ans in flat:
                fails.append('%-14s clue contains the answer: %r' % (ans, c))
            # 5. no empty or lazy clues
            if len(c.split()) < 2:
                fails.append('%-14s clue is too thin: %r' % (ans, c))

        # 6. in the Scrabble dictionary — a warning, not a failure
        if ans in words:
            warns.append('%-14s is in the app dictionary as a word; nothing has'
                         ' clued the ordinary sense yet' % ans)

    n = sum(1 if isinstance(v, str) else len(v) for v in P.values())
    print('%d new answers, %d clues (%d phrases, %d people)'
          % (len(P), n, len(PHRASES), len(P) - len(PHRASES)))

    if warns:
        print('\n%d on notice:' % len(warns))
        for w in warns:
            print('  ', w)
    if fails:
        print('\nFAIL — %d problems:' % len(fails))
        for f in fails:
            print('  ', f)
        return 1
    print('\nchecks: clean')
    return 0


if __name__ == '__main__':
    sys.exit(main())
