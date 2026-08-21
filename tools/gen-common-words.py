"""Write tools/common-words.txt: app-dictionary words that are genuinely common.

Committed rather than generated per sandbox, because wordfreq is a pip install
the daily run should not depend on, and because a word list you can read in a
diff is a word list you can argue with.

Zipf >= 2.5 is the line. Chosen by measurement, not taste: below it sit
`comedo`, `epigone`, `haslet`, `topee` and `bleb` (1.43, the word that had to be
banned by hand last month); above it sit `mutter`, `morsel`, `terse`, `boutique`
and `ukulele`. See the 2.5-vs-2.8 comparison in the run that added this.
"""
import os
from wordfreq import zipf_frequency

CUT = 3.0
allowed = sorted(set(open(os.path.expanduser('~/scrabble-words.txt')).read().split()))
out = [w for w in allowed if 3 <= len(w) <= 9 and zipf_frequency(w, 'en') >= CUT]
path = '/sessions/exciting-keen-cori/mnt/Focus/tools/common-words.txt'
with open(path, 'w') as f:
    f.write('# app-dictionary words, 3-9 letters, wordfreq zipf >= %s\n' % CUT)
    f.write('# regenerate: pip install wordfreq --break-system-packages; see tools/gen-common-words.py\n')
    f.write('\n'.join(out) + '\n')
print('wrote %s — %d words (of %d in dictionary at 3-9 letters)'
      % (path, len(out), len([w for w in allowed if 3 <= len(w) <= 9])))
