#!/usr/bin/env python3
"""
Build the Scrabble word bank for Focus Simulator.

Strategy: hunspell en_US gives us every *valid* inflected form; a frequency list
gives us which stems are *common*. Take the whole inflection family of any stem
that is common, so "walk" brings "walks/walked/walking" with it, but obscure
stems bring nothing. Then force-include every short word, because 2- and 3-letter
words are what make a Scrabble board playable.

Output: front-coded, newline-free string written into src/js/30-scrabble-data.js
"""
import re, sys, collections, os

AFF = '/usr/share/hunspell/en_US.aff'
DIC = '/usr/share/hunspell/en_US.dic'
FREQ_DIR = ('/sessions/nice-gifted-wozniak/mnt/.claude/projects/'
            'C--Users-hashi-AppData-Roaming-Claude-local-agent-mode-sessions-'
            '965b887e-a5c5-4230-af3c-5fa538358be9-871a17e2-2115-4527-ad7c-56827ae0b64e-'
            'local-ac1c891a-d872-41ea-a75d-b6de3892122b-outputs/'
            '65d18837-689a-4aaa-8ac4-d23d38f7726e/tool-results')

MINLEN, MAXLEN = 2, 15
SHORT_ALL = 7          # every hunspell word up to this length gets in

# The standard tournament two-letter list. Not derivable from a frequency list,
# and Scrabble is unplayable without it.
TWOS = ("aa ab ad ae ag ah ai al am an ar as at aw ax ay ba be bi bo by de do ed ef eh "
        "el em en er es et ex fa fe go ha he hi hm ho id if in is it jo ka ki la li lo "
        "ma me mi mm mo mu my na ne no nu od oe of oh oi om on op or os ow ox oy pa pe "
        "pi qi re sh si so ta ti to uh um un up us ut we wo xi xu ya ye yo za").split()


def parse_aff(path):
    sfx, pfx = collections.defaultdict(list), collections.defaultdict(list)
    lines = open(path, encoding='latin-1').read().splitlines()
    i = 0
    while i < len(lines):
        p = lines[i].split()
        if p and p[0] in ('SFX', 'PFX') and len(p) >= 4 and p[3].isdigit():
            kind, flag, n = p[0], p[1], int(p[3])
            for j in range(1, n + 1):
                q = lines[i + j].split()
                if len(q) < 4:
                    continue
                strip = '' if q[2] == '0' else q[2]
                add = '' if q[3] == '0' else q[3].split('/')[0]
                cond = q[4] if len(q) > 4 else '.'
                (sfx if kind == 'SFX' else pfx)[flag].append((strip, add, cond))
            i += n + 1
            continue
        i += 1
    return sfx, pfx


def families():
    """stem -> set of every form hunspell licenses for it."""
    sfx, pfx = parse_aff(AFF)
    fam = {}
    for line in open(DIC, encoding='latin-1').read().splitlines()[1:]:
        line = line.split('\t')[0].strip()
        if not line:
            continue
        stem, flags = (line.split('/', 1) + [''])[:2] if '/' in line else (line, '')
        if not (stem.isalpha() and stem.islower() and stem.isascii()):
            continue
        forms = {stem}
        for f in flags:
            for strip, add, cond in sfx.get(f, []):
                if strip and not stem.endswith(strip):
                    continue
                if not re.search(cond + '$', stem):
                    continue
                forms.add((stem[:len(stem) - len(strip)] if strip else stem) + add)
            for strip, add, cond in pfx.get(f, []):
                if strip and not stem.startswith(strip):
                    continue
                if not re.match('^' + cond, stem):
                    continue
                forms.add(add + stem[len(strip):])
        forms = {w for w in forms if w.isalpha() and w.islower() and w.isascii()}
        fam.setdefault(stem, set()).update(forms)
    return fam


def common_seed():
    seed = set()
    for name in sorted(os.listdir(FREQ_DIR)):
        if not name.endswith('.txt'):
            continue
        for line in open(os.path.join(FREQ_DIR, name), encoding='utf-8', errors='ignore'):
            w = line.strip().split(' ')[0].lower()
            if w.isalpha() and w.isascii():
                seed.add(w)
    return seed


# Hunspell is a spellchecker list, so it carries abbreviations (avn, cml, gtd)
# and roman numerals. Neither is a word. Almost everything junky has no vowel,
# so that is the filter — with the short list of genuinely vowel-less words
# whitelisted back in.
NOVOWEL_OK = set("brr brrr crwth crwths cwm cwms hm hmm mm nth pfft phpht psst "
                 "sh shh tsk tsks tsktsk zzz".split())
VOWELS = set('aeiouy')


def romans():
    vals = [(1000, 'm'), (900, 'cm'), (500, 'd'), (400, 'cd'), (100, 'c'), (90, 'xc'),
            (50, 'l'), (40, 'xl'), (10, 'x'), (9, 'ix'), (5, 'v'), (4, 'iv'), (1, 'i')]
    out = set()
    for n in range(1, 4000):
        s, r = '', n
        for v, sym in vals:
            while r >= v:
                s += sym
                r -= v
        out.add(s)
    return out


def frontcode(words):
    """'able ably abut' -> 'able1y2ut'  — shared prefix length as a digit."""
    out, prev = [], ''
    for w in words:
        n = 0
        while n < len(prev) and n < len(w) and n < 9 and prev[n] == w[n]:
            n += 1
        out.append(str(n) + w[n:])
        prev = w
    return ''.join(out)


def main():
    fam = families()
    seed = common_seed()
    print('frequency seed:', len(seed), file=sys.stderr)

    words = set()
    for stem, forms in fam.items():
        if stem in seed or (forms & seed):
            words |= forms
    print('after family expansion:', len(words), file=sys.stderr)

    # Short words are where a rejection stings most — they are what you reach for
    # when the rack is bad — so take everything hunspell knows up to SHORT_ALL
    # letters, common or not. Long plays are nearly always common words anyway.
    allforms = set()
    for forms in fam.values():
        allforms |= forms
    words |= {w for w in allforms if len(w) <= SHORT_ALL}

    rom = romans()
    words = {w for w in words
             if MINLEN <= len(w) <= MAXLEN
             and (set(w) & VOWELS or w in NOVOWEL_OK)
             and w not in rom}

    # the two-letter list is fixed by the rules, not by a spellchecker
    words = {w for w in words if len(w) > 2} | set(TWOS)

    words = sorted(words)
    print('final:', len(words), file=sys.stderr)

    by_len = collections.Counter(len(w) for w in words)
    print('by length:', dict(sorted(by_len.items())), file=sys.stderr)

    packed = frontcode(words)
    print('packed bytes:', len(packed), file=sys.stderr)
    open('/tmp/packed.txt', 'w').write(packed)
    open('/tmp/words.txt', 'w').write('\n'.join(words))

    if len(sys.argv) > 1:
        head = HEADER % (len(words), MAXLEN, SHORT_ALL, by_len[2], len(packed) // 1024)
        with open(sys.argv[1], 'w', newline='\n') as f:
            f.write(head)
            f.write("  const SCR_PACKED = '" + packed + "';\n")
            f.write(TAIL)
        print('wrote', sys.argv[1], file=sys.stderr)


HEADER = """  /* ---------------- SCRABBLE — the word bank ----------------
     %d words, 2 to %d letters, generated by tools/build-scrabble-dict.py from
     the hunspell en_US dictionary crossed with a frequency list. Two rules
     decided what got in:

       - every word hunspell knows up to %d letters, common or not, because a
         rejected short word is the one that actually stings — it's what you
         reach for when the rack is bad;
       - for longer words, only the inflection families of common stems, so
         "walk" brings walks/walked/walking but a stem nobody has heard of
         brings nothing.

     The %d two-letter words are the fixed list every Scrabble player ends up
     memorising, not whatever a spellchecker happened to allow.

     Stored front-coded: each entry is one digit — how many leading characters
     it shares with the previous word — then the rest of the word. "able1y2ut"
     is able, ably, abut. That turns ~300 KB of text into %d KB, and unpacks
     into a Set in a few milliseconds on first use.
  */

"""

TAIL = """
  /* Unpacked once, lazily, the first time somebody validates a word. */
  let SCR_WORDS = null;
  function scrWords(){
    if(SCR_WORDS) return SCR_WORDS;
    SCR_WORDS = new Set();
    let prev = '';
    for(let i = 0; i < SCR_PACKED.length; ){
      const keep = SCR_PACKED.charCodeAt(i++) - 48;
      let j = i;
      while(j < SCR_PACKED.length && SCR_PACKED.charCodeAt(j) > 57) j++;
      prev = prev.slice(0, keep) + SCR_PACKED.slice(i, j);
      SCR_WORDS.add(prev);
      i = j;
    }
    return SCR_WORDS;
  }
  function scrIsWord(w){ return scrWords().has(String(w||'').toLowerCase()); }

  /* ---- tiles ----
     The standard English distribution: 100 tiles, two of them blank. */
  const SCR_VALUES = {a:1,b:3,c:3,d:2,e:1,f:4,g:2,h:4,i:1,j:8,k:5,l:1,m:3,n:1,
                      o:1,p:3,q:10,r:1,s:1,t:1,u:1,v:4,w:4,x:8,y:4,z:10,'?':0};
  const SCR_COUNTS = {a:9,b:2,c:2,d:4,e:12,f:2,g:3,h:2,i:9,j:1,k:1,l:4,m:2,n:6,
                      o:8,p:2,q:1,r:6,s:4,t:6,u:4,v:2,w:2,x:1,y:2,z:1,'?':2};

  const SCR_SIZE = 15;
  const SCR_RACK = 7;
  const SCR_BINGO = 50;          // for laying down all seven in one turn

  /* Premium squares, as a string per row so the shape is readable in source.
     . plain · d/t double/triple letter · D/T double/triple word · * the centre */
  const SCR_PREMIUM = [
    'T..d...T...d..T',
    '.D...t...t...D.',
    '..D...d.d...D..',
    'd..D...d...D..d',
    '....D.....D....',
    '.t...t...t...t.',
    '..d...d.d...d..',
    'T..d...*...d..T',
    '..d...d.d...d..',
    '.t...t...t...t.',
    '....D.....D....',
    'd..D...d...D..d',
    '..D...d.d...D..',
    '.D...t...t...D.',
    'T..d...T...d..T',
  ].join('');

  function scrPrem(r, c){ return SCR_PREMIUM[r*SCR_SIZE + c]; }

  /** A fresh bag, shuffled. */
  function scrBag(){
    const bag = [];
    for(const ch in SCR_COUNTS) for(let i=0;i<SCR_COUNTS[ch];i++) bag.push(ch);
    for(let i=bag.length-1;i>0;i--){
      const j = Math.random()*(i+1)|0;
      const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
    }
    return bag;
  }
"""


main()
