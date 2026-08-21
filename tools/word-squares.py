"""Find 5x5 double word squares directly, instead of via the generic fill.

A barred 5x5 with no black squares is not really a crossword-shaped problem. The
only way to divide a five-run into entries of three or more is not to divide it,
so every row *and* every column has to be a whole five-letter word: it is a
double word square, ten entries, twenty-five squares, no slack anywhere.

tools/build-crosswords.py's `fill` treats that like any other grid — pick a slot,
try a word, backtrack — and it is very slow at it, because it only discovers a
column is doomed after it has committed most of a row. Measured on 2026-08-21
with the run rule active, it produced one square in fourteen attempts of thirty
seconds each, and the notes in rebuild-bank.py already say "getting one 5x5 a day
is a good day".

Row-by-row with prefix pruning is the standard way to do this and it is a
different order of cost. Place a whole row, then ask of every column: is there
any word at all that starts with the letters now in it? If any column has none,
the row was wrong and the next four rows never get tried. The prefix index that
answers that question is built once.

    python3 tools/word-squares.py --want 4 --budget 30

It writes into the same ~/bank.json (or CW_BANK) that rebuild-bank.py uses, in
the same shape and with the same run stamp, so --status, --patch and the gap and
run checks all treat what it makes as ordinary bank entries. Rows and columns
really are the entries at this size, so the puzzle is stored as a plain array of
rows with no bar maps — which is correct, and is why the missing-bar-map bug that
broke the first barred sevens was invisible here.
"""
import argparse
import collections
import importlib.util
import json
import os
import random
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def _load(name, attr=None):
    path = os.path.join(HERE, name + '.py')
    spec = importlib.util.spec_from_file_location('ws_' + name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return getattr(mod, attr) if attr else mod


def squares(words, want, budget, rng, size=5):
    """Yield double word squares, rows first.

    The obvious version of this — for each candidate row, append it and test
    every column prefix — is far too slow, and that is not because squares are
    rare. It scans all 1,300 words at every one of five levels and does the
    prefix test after committing, so it pays full price for rows that were never
    possible. Measured on 2026-08-21 it found nothing in thirty seconds over the
    complete five-letter pool, while the generic crossword fill in
    build-crosswords.py found one by accident in the same period.

    Turning it round is what makes it fast. After k rows are placed, each column
    holds a k-letter prefix, and that prefix admits only certain next letters.
    So the question is not "does this word fit" asked 1,300 times, it is "which
    words have an allowed letter in every column", answered once as an
    intersection of bitmasks:

        candidates = AND over columns of (OR over allowed letters of
                                          words-with-that-letter-here)

    `bypos[c][ch]` is a bitmask of every word carrying `ch` at position `c`, and
    `nexts[prefix]` the letters that may follow a prefix. Both are built once.
    Python integers are the bitset, so the whole intersection is a handful of
    machine-word operations over a 1,300-bit number, and a level with no
    candidates costs one AND rather than 1,300 string comparisons.
    """
    words = list(words)
    n = len(words)
    if not n:
        return []

    # letters that may follow each prefix, and words carrying a letter at a spot
    nexts = collections.defaultdict(set)
    bypos = [collections.defaultdict(int) for _ in range(size)]
    for i, w in enumerate(words):
        for j in range(size):
            nexts[w[:j]].add(w[j])
            bypos[j][w[j]] |= 1 << i
    full = {w for w in words}

    started = time.time()
    found = []

    def walk(rows, taken, colpre):
        if len(found) >= want or time.time() - started > budget:
            return
        if len(rows) == size:
            cols = [''.join(r[c] for r in rows) for c in range(size)]
            # The pruning guarantees each column is a word; distinctness is a
            # separate matter, and an answer repeated inside one puzzle is a bug
            # the bank has always rejected.
            if all(c in full for c in cols) and len(set(rows) | set(cols)) == 2 * size:
                found.append(list(rows))
            return

        mask = (1 << n) - 1
        for c in range(size):
            allowed = nexts.get(colpre[c])
            if not allowed:
                return
            col = 0
            for ch in allowed:
                col |= bypos[c][ch]
            mask &= col
            if not mask:
                return
        mask &= ~taken

        # candidate indices, shuffled so repeated calls explore different squares
        idx = []
        m = mask
        while m:
            low = m & -m
            idx.append(low.bit_length() - 1)
            m ^= low
        rng.shuffle(idx)

        for i in idx:
            w = words[i]
            walk(rows + [w], taken | (1 << i),
                 [colpre[c] + w[c] for c in range(size)])
            if len(found) >= want or time.time() - started > budget:
                return

    walk([], 0, [''] * size)
    return found


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--want', type=int, default=1)
    ap.add_argument('--budget', type=float, default=30)
    ap.add_argument('--reuse', action='store_true',
                    help='let squares share answers with the rest of the run')
    args = ap.parse_args()

    rb = _load('rebuild-bank')
    cw = rb._load('build-crosswords')
    words = rb.word_bank(cw)

    bank = rb.load_cache()
    have = bank.setdefault('5', [])

    # Normally the generic rules apply: nothing made earlier in this run may
    # come back at any size, and nothing may repeat inside GAP puzzles here.
    #
    # --reuse lifts the first of those, and at this size it has to be liftable.
    # Double word squares are not spread evenly through the word list — they
    # cluster on a small set of highly connective words, and taking the ten
    # answers of one square out of the pool removes most of what the next square
    # would have been built from. Measured: over the full 1,319-word pool the
    # search found four squares in 1.2 seconds; with the twenty answers of the
    # first two removed it found none in seventy-eight attempts.
    blocked = set()
    if not args.reuse:
        for size_ps in bank.values():
            for p in size_ps:
                if p.get('run') == rb.RUN:
                    blocked |= set(p['answers'])
    for p in have[-(rb.GAP - 1):]:
        blocked |= set(p['answers'])

    pool = [w for w in words if len(w) == 5 and w not in blocked]
    print('%d five-letter words available (%d blocked by the run)'
          % (len(pool), len(words) - len(pool)), file=sys.stderr)

    want = args.want - len(have)
    if want <= 0:
        print('5x5: already have %d' % len(have), file=sys.stderr)
        return
    print('5x5: have %d, want %d' % (len(have), args.want), file=sys.stderr)

    made = 0
    rng = random.Random()
    started = time.time()
    # Short slices rather than one long search. The walk has no restart of its
    # own, so a first row that leads nowhere can swallow the entire budget in a
    # single doomed subtree — which is what happened on the first run here: one
    # square found in a second, then twenty-nine seconds spent on the next.
    # Three seconds is long enough to find a square when the branch is good and
    # short enough that a bad branch costs almost nothing.
    SLICE = 3.0
    while len(have) < args.want and time.time() - started < args.budget:
        left = min(SLICE, args.budget - (time.time() - started))
        if left <= 0:
            break
        seen_sets = [frozenset(p['answers']) for p in have]
        for rows in squares(pool, 1, left, rng):
            if any(p['rows'] == rows for p in have):
                continue
            answers = list(rows) + [''.join(r[c] for r in rows) for c in range(5)]
            # The transpose of a square is a different grid with the same ten
            # answers, and to a solver it is the same puzzle. Compare the sets,
            # not the rows.
            if frozenset(answers) in seen_sets:
                continue
            have.append({'rows': rows, 'answers': answers, 'run': rb.RUN})
            if not args.reuse:
                for a in answers:
                    if a in pool:
                        pool.remove(a)
            made += 1
            rb.save_cache(bank)
            print('  %d/%d  %s' % (len(have), args.want, ' '.join(rows)),
                  file=sys.stderr)
    print('made %d this run' % made, file=sys.stderr)


if __name__ == '__main__':
    main()
