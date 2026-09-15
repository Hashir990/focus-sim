#!/usr/bin/env python3
"""Render the crossword release calendar to HTML.

The bank is a queue, not a schedule: `rebuild-bank.py` appends, and
`09b-daily.js` decides what comes out when. A puzzle's release date is its
position in its size's list counted from DAILY_EPOCH, through CROSS_WHEN --
so the two numbers that matter are how fast a size is *built* and how fast it
is *spent*, and those are different for every size.

Run: python3 tools/cw-calendar.py > CROSSWORD-CALENDAR.html

Reads ~/bank.json when it is there (it carries the answers, so each puzzle can
be labelled by its longest one) and falls back to counting grids in the shipped
data file, so this still works in a clean checkout.
"""
import json, os, re, sys, datetime

# Kept in step with src/js/09b-daily.js by hand. If the app's epoch or release
# days ever move, this file is the second place that has to know.
EPOCH = datetime.date(2026, 8, 17)
WHEN = {5: '*', 7: '*', 9: '35', 15: '0'}   # '*' = daily, digits = weekdays, 0 = Sunday
SIZES = [5, 7, 9, 15]
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def dow(d):
    """0 = Sunday, matching pktDow rather than Python's Monday-first weekday()."""
    return (d.weekday() + 1) % 7


def releases(size, d):
    if d < EPOCH:
        return False
    w = WHEN.get(size)
    return bool(w) and (w == '*' or str(dow(d)) in w)


def load_bank():
    """{size: [label, ...]} in bank order, which is release order."""
    p = os.path.expanduser('~/bank.json')
    if os.path.exists(p):
        raw = json.load(open(p, encoding='utf-8'))
        out = {}
        for k, ps in raw.items():
            labels = []
            for puz in ps:
                a = puz.get('answers') or puz.get('entries') or []
                words = a if isinstance(a, list) else list(a.keys())
                # The longest answer is the one a solver would remember the grid by.
                labels.append(max(words, key=len).upper() if words else '')
            out[int(k)] = labels
        return out
    src = open(os.path.join(HERE, 'src/js/26-crossword-data.js'), encoding='utf-8').read()
    m = re.search(r'CROSS_GRIDS\s*=\s*\[(.*?)\n\s*\];', src, re.S)
    out = {s: [] for s in SIZES}
    for g in re.findall(r"'([^']*)'", m.group(1) if m else ''):
        rows = [r for r in g.split('/') if r]
        n = len(rows)
        if n in out:
            out[n].append('')
    return out


def schedule(bank, today):
    """[(date, size, index, label, state)] for every puzzle currently banked."""
    rows = []
    for size in SIZES:
        labels = bank.get(size, [])
        d, i = EPOCH, 0
        while i < len(labels):
            if releases(size, d):
                state = 'past' if d < today else ('today' if d == today else 'ahead')
                rows.append((d, size, i, labels[i], state))
                i += 1
            d += datetime.timedelta(days=1)
    return rows


def main():
    today = datetime.date.today()
    bank = load_bank()
    rows = schedule(bank, today)
    by_day = {}
    for d, size, i, label, state in rows:
        by_day.setdefault(d, []).append((size, i, label, state))

    # Per-size runway, and the net drift that decides whether it is growing.
    # Built: 2 a day at 5/7/9, one 15 every fifth day. Spent: whatever
    # CROSS_WHEN releases.
    built = {5: 14.0, 7: 14.0, 9: 14.0, 15: 7 / 5.0}          # per week
    spent = {s: (7.0 if WHEN[s] == '*' else float(len(WHEN[s]))) for s in SIZES}
    summary = []
    for size in SIZES:
        mine = [r for r in rows if r[1] == size]
        # Today's has already gone out, so it is not runway.
        left = [r for r in mine if r[4] == 'ahead']
        last = mine[-1][0] if mine else None
        summary.append({
            'size': size, 'bank': len(mine), 'left': len(left),
            'last': last, 'runway': (last - today).days if last else 0,
            'drift': built[size] - spent[size],
            'when': {'*': 'every day', '35': 'Wed + Fri', '0': 'Sundays'}[WHEN[size]],
        })

    months = []
    if rows:
        cur = datetime.date(EPOCH.year, EPOCH.month, 1)
        end = max(r[0] for r in rows)
        while cur <= end:
            months.append(cur)
            cur = datetime.date(cur.year + (cur.month == 12), cur.month % 12 + 1, 1)

    COL = {5: 'c5', 7: 'c7', 9: 'c9', 15: 'c15'}
    out = []
    w = out.append
    w('<!doctype html><meta charset="utf-8">')
    w('<title>Crossword release calendar</title>')
    w('''<style>
:root{--bg:#12141a;--fg:#e8e9ee;--dim:#8b90a0;--line:#262a35;--card:#1a1d26;
 --c5:#5fb3d4;--c7:#8fd46f;--c9:#e8b04b;--c15:#e06c9f;--today:#e8e9ee}
*{box-sizing:border-box}
body{margin:0;padding:28px;background:var(--bg);color:var(--fg);
 font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif}
h1{font-size:20px;margin:0 0 4px}
.sub{color:var(--dim);margin-bottom:22px}
table.sum{border-collapse:collapse;margin-bottom:10px;min-width:640px}
table.sum th,table.sum td{padding:7px 14px;text-align:left;border-bottom:1px solid var(--line)}
table.sum th{color:var(--dim);font-weight:500;font-size:12px;
 text-transform:uppercase;letter-spacing:.06em}
.sz{font-weight:600}
.pos{color:#8fd46f}.neg{color:#e0645c}.thin{color:#e8b04b}
.note{color:var(--dim);font-size:13px;max-width:760px;margin:14px 0 26px}
.months{display:flex;flex-wrap:wrap;gap:18px}
.m{background:var(--card);border:1px solid var(--line);border-radius:10px;
 padding:14px 16px 16px;width:340px}
.m h2{font-size:14px;margin:0 0 10px;font-weight:600}
.g{display:grid;grid-template-columns:repeat(7,1fr);gap:3px}
.dow{color:var(--dim);font-size:10px;text-align:center;padding-bottom:4px}
.d{min-height:52px;border:1px solid var(--line);border-radius:5px;padding:3px 4px;
 font-size:10px;background:#161923}
.d.blank{border:0;background:none}
.d.past{opacity:.42}
.d.today{border-color:var(--today);box-shadow:0 0 0 1px var(--today)}
.n{color:var(--dim);font-size:10px;display:block;margin-bottom:2px}
.d.today .n{color:var(--today);font-weight:700}
.p{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:10px}
.p b{font-weight:600}
.c5{color:var(--c5)}.c7{color:var(--c7)}.c9{color:var(--c9)}.c15{color:var(--c15)}
.key{margin:22px 0 0;color:var(--dim);font-size:12px}
.key span{margin-right:16px}
</style>''')
    w('<h1>Crossword release calendar</h1>')
    w(f'<div class="sub">Bank as it stands on {today.isoformat()}. '
      f'Epoch {EPOCH.isoformat()}. Faded days have already been published; '
      f'solid days ahead of today are banked and waiting.</div>')

    w('<table class="sum"><tr><th>Size</th><th>Comes out</th><th>In bank</th>'
      '<th>Unreleased</th><th>Last banked date</th><th>Runway</th><th>Net per week</th></tr>')
    for s in summary:
        drift = s['drift']
        cls = 'pos' if drift >= 3 else ('thin' if drift >= 0 else 'neg')
        w(f'<tr><td class="sz {COL[s["size"]]}">{s["size"]}x{s["size"]}</td>'
          f'<td>{s["when"]}</td><td>{s["bank"]}</td><td>{s["left"]}</td>'
          f'<td>{s["last"].isoformat() if s["last"] else "--"}</td>'
          f'<td>{s["runway"]} days</td>'
          f'<td class="{cls}">{drift:+.1f}</td></tr>')
    w('</table>')
    w('<div class="note">Net per week is what the daily build adds minus what the '
      'release schedule spends. A positive number means the runway lengthens on its '
      'own and the last-banked date moves further out every day; only a negative one '
      'needs attention. Past the last banked date the app does not go blank -- '
      '<code>crossOnDay</code> wraps and reissues an earlier puzzle as an encore.</div>')

    w('<div class="months">')
    for mth in months:
        nxt = datetime.date(mth.year + (mth.month == 12), mth.month % 12 + 1, 1)
        w('<div class="m">')
        w(f'<h2>{mth.strftime("%B %Y")}</h2><div class="g">')
        for lbl in ['S', 'M', 'T', 'W', 'T', 'F', 'S']:
            w(f'<div class="dow">{lbl}</div>')
        for _ in range(dow(mth)):
            w('<div class="d blank"></div>')
        d = mth
        while d < nxt:
            items = sorted(by_day.get(d, []))
            state = 'today' if d == today else ('past' if d < today else '')
            w(f'<div class="d {state}"><span class="n">{d.day}</span>')
            for size, i, label, _st in items:
                txt = f'<b>{size}</b> #{i + 1}' + (f' {label[:9]}' if label else '')
                w(f'<span class="p {COL[size]}">{txt}</span>')
            w('</div>')
            d += datetime.timedelta(days=1)
        w('</div></div>')
    w('</div>')
    w('<div class="key"><span class="c5">5x5 daily</span>'
      '<span class="c7">7x7 daily</span><span class="c9">9x9 Wed+Fri</span>'
      '<span class="c15">15x15 Sundays</span>'
      '&nbsp; #n is the puzzle\'s position in its size, which is what fixes its date. '
      'The word is that grid\'s longest answer, as a handle.</div>')
    sys.stdout.write('\n'.join(out) + '\n')


if __name__ == '__main__':
    main()
