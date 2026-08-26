"""Does every clue in the shipped bank actually make sense?

    python3 tools/check-clues.py                       # the shipped data file
    python3 tools/check-clues.py --bank                # everything in ~/bank.json

The other checkers ask whether a *grid* is sound — entries long enough, every
square crossed, bar maps present. This one asks whether a *clue* is. That is
not fully decidable by a program, so this does not try to grade writing; it
catches the specific ways a clue has actually gone wrong in this project, each
of which shipped at least once before anyone noticed:

  * **Truncated mid-clause.** shorten() cuts a long WordNet gloss down to size
    and used to cut inside a relative clause: CRIB read "Card game in", BINGO
    "Game in", BRAIN just "That". 175 of them at the worst point.
  * **Contains its own answer.** "Vegetables, informally" for VEG, "Brother,
    informally" for BRO, "Suspicious" for SUS. Easy to write, impossible to
    solve fairly.
  * **Too thin to be a question.** A single word, or a bare category with no
    distinguishing detail.
  * **Still a dictionary definition.** WordNet's register gives itself away —
    "any of various", "of or relating to", "a person who is", "the act of".
    These are the glosses that have not been rewritten yet.
  * **Wrong sense markers.** Parenthetical genus names, "especially", and
    semicolon-separated alternatives are what a lexicographer writes and a
    solver cannot use.

Everything it reports is a judgement call, so nothing here is fatal by itself.
The counts are the point: they should go down, and a daily run should not add
to them.
"""
import argparse
import collections
import importlib.util
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAXLEN = 58

# Words a clue may never *end* on, kept deliberately narrow.
#
# The first draft of this list included the prepositions and it was useless:
# it flagged "Speak to", "Blame for", "Do away with" and "Right on top of",
# which are exactly how you clue a verb. English definitions end in prepositions
# all the time. What never happens in a real clue is ending on a conjunction,
# an article or a relative pronoun — that only occurs when shorten() has cut
# inside a clause.
NEVER_LAST = set('''
that which who whom whose and or but a an the if while than
'''.split())

# Copulas are the awkward case: "How old something is" is a fine clue and
# "Character set that includes letters and is" is a broken one, and both end on
# "is". The tell is the word before it.
COPULA = set('is are was were be been being'.split())
COPULA_LEADIN = set('and or that which can could may might'.split())

# The register of a dictionary rather than a crossword.
GLOSSY = [
    (r'^any of (various|the|a)\b', 'opens "any of various"'),
    (r'^of or (relating|pertaining|concerning)\b', 'opens "of or relating to"'),
    (r'^(the )?act of\b', 'opens "the act of"'),
    (r'^(a )?person who\b', 'opens "a person who"'),
    (r'^someone who is\b', 'opens "someone who is"'),
    (r'^(a )?(state|quality|condition) of being\b', 'opens "the state of being"'),
    (r'^informal (term|terms|form) for\b', 'opens "informal term for"'),
    (r'\bespecially\b', 'hedges with "especially"'),
    (r'\bgenus\b|\bfamily [A-Z]', 'names a genus or family'),
    (r';', 'has a semicolon, which means two senses in one clue'),
    (r'\bi\.e\.|\be\.g\.', 'uses i.e. or e.g.'),
]


def _load(name, attr):
    path = os.path.join(ROOT, 'tools', name)
    spec = importlib.util.spec_from_file_location('cc_' + attr, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return getattr(mod, attr)


def faults(answer, clue):
    """Every reason this clue looks wrong. Empty list means it looks fine."""
    out = []
    low = clue.lower()
    flat = re.sub(r'[^a-z]', '', low)

    if answer in low or answer in flat:
        out.append('contains its own answer')
    if len(clue) >= MAXLEN:
        out.append('%d characters, over the %d limit' % (len(clue), MAXLEN))

    toks = [re.sub(r'[^a-z]', '', t.lower()) for t in clue.split()]
    # A one-word clue is fine — "Flames", "Skilfully", "Helped" all are — so
    # only a very short one is suspect.
    if len(toks) == 1 and len(clue) < 5:
        out.append('a single short word, too thin to be a question')
    if toks:
        last = toks[-1]
        # `that`, `which` and `while` end plenty of good clues — "no matter
        # which", "than that", "for a while". A truncation is short, so only
        # flag those in a clue brief enough to be a fragment, and never after
        # the article that makes "for a while" work.
        soft = last in ('that', 'which', 'while')
        if soft and (len(toks) > 4 or (len(toks) > 1 and toks[-2] == 'a')):
            pass
        elif last in NEVER_LAST:
            out.append('ends mid-clause on "%s"' % last)
        elif (toks[-1] in COPULA and len(toks) > 1
              and toks[-2] in COPULA_LEADIN):
            out.append('ends mid-clause on "%s %s"' % (toks[-2], toks[-1]))

    if clue and not clue[0].isupper() and not clue.startswith(('"', '‘', '_')):
        out.append('does not start with a capital')

    for pattern, why in GLOSSY:
        if re.search(pattern, low):
            out.append(why)
            break
    return out


def from_data_file(path):
    """Answers and clues as the app will actually see them."""
    src = open(path, encoding='utf-8').read()
    start = src.index('const CROSS_CLUES = {')
    end = src.index('\n  };', start)
    pairs = []
    for m in re.finditer(r"^\s*([a-z]+):(.+?),?$", src[start:end], re.M):
        word, rest = m.group(1), m.group(2).strip().rstrip(',')
        for c in re.findall(r"'((?:[^'\\]|\\.)*)'", rest):
            pairs.append((word, c.replace("\\'", "'").replace('\\\\', '\\')))
    return pairs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bank', action='store_true',
                    help='check every clue source, not just the shipped file')
    ap.add_argument('--quiet', action='store_true')
    args = ap.parse_args()

    if args.bank:
        pairs = []
        for name, attr in (('cross-clues.py', 'CLUES'),
                           ('extra-answers.py', 'EXTRA'),
                           ('cross-phrases.py', 'ALL')):
            for a, v in _load(name, attr).items():
                for c in ((v,) if isinstance(v, str) else v):
                    pairs.append((a, c))
        where = 'every clue source'
    else:
        pairs = from_data_file(os.path.join(ROOT, 'src', 'js',
                                            '26-crossword-data.js'))
        where = 'the shipped data file'

    tally = collections.Counter()
    bad = []
    for a, c in pairs:
        f = faults(a, c)
        if f:
            bad.append((a, c, f))
            for x in f:
                tally[re.sub(r'\d+', 'N', x)] += 1

    print('%d clues checked in %s' % (len(pairs), where))
    print('%d look wrong' % len(bad))
    if tally:
        print()
        for why, n in tally.most_common():
            print('  %4d  %s' % (n, why))
    if bad and not args.quiet:
        print()
        for a, c, f in sorted(bad)[:60]:
            print('  %-12s %-46s %s' % (a.upper(), c[:46], '; '.join(f)))
        if len(bad) > 60:
            print('  ... and %d more' % (len(bad) - 60))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
