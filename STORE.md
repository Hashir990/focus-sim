# The store listing

Everything Play Console asks for in words, kept here so it is reviewable and
so the next version can be a diff rather than a rewrite. The screenshots it
goes with are made by `npx electron tools/look-promo.mjs`.

**Every number below was counted from the code, not remembered.** The app has
already shipped a privacy policy claiming it loads "two typefaces" when it
loaded four; a listing is read by more people than that policy and is the
worst place to be approximately right. If you add a game or a look, re-count
before you re-publish:

| | |
|---|---|
| games | 12, of which 6 are played with other people |
| looks | 13 |
| ambience tracks | 8 |
| buddy faces | 22 |
| languages | 7 |

---

## App name

```
focUS simulator
```

The casing is the joke and it is load-bearing: `focUS` contains *us*. Nothing
in the listing may title-case or upper-case it. (A `text-transform:uppercase`
on the wordmark once rendered it FOCUS SIMULATOR and destroyed the whole
point; it is the kind of thing a store form does by itself.)

## Short description

*Play's limit is 80 characters. This is 74.*

```
A focus timer that blocks what distracts you and makes the break worth it.
```

## Full description

*Play's limit is 4000 characters. This is 2466.*

```
Work in blocks. Take the break properly.

Most focus timers give you twenty-five minutes of work and five minutes of
nothing, and the five minutes is where it falls apart. You skip it and run
yourself down, or you open something and never come back. So this one puts an
arcade in the break and takes it away again when the break is over.

GETTING THE WORK DONE
Pick a length and start. While the clock runs, the apps and sites that take
you away stay shut: during focus blocks, for a whole session, on a schedule,
or always. Make getting back in cost you a written reason or a sum. Set daily
limits, or a pause that gets longer every time you reach for the same app. Put
a lock on it and the app cannot be uninstalled until you unlock it.

Attach a task to a block so you know afterwards what the time went on.

THE BREAK
Sudoku, crossword, picross, word guess, 2048 and tetris on your own. Hangman,
scrabble, chess, pictionary, Mr White and Spymaster with somebody else. More
get added.

Three are new every morning: a sudoku in three difficulties, a crossword in
four sizes, three nonograms. Miss a day and it waits for you in the calendar.

WATCHING IT ADD UP
Every finished block lands on a calendar, which plans the ones ahead as well
as keeping the ones behind. Totals, averages, your best day, the last
fortnight. How long you have spent in each app, and whether that is going up
or down.

Your level is the hours you have put in. It cannot be spent and it cannot be
bought.

Ten minutes of focus earns an ember. Embers buy looks for the app, ambience to
work to, clock faces, quote packs, and clothes for the small figure who
potters about the screen while you work. No in-app purchases, no ads, nothing
that costs money.

Keep a run of days going and the ember in the top bar burns brighter, and the
day counts for a little more. Miss one and you can buy it back.

FOCUSING WITH SOMEBODY
Share a code and you are in a room. One clock runs for everyone in it, there
is a chat, and the shared games are dealt between you. Device to device.

NOTHING LEAVES THE PHONE
No ads, no advertising identifiers, no analytics, no crash reporting, no
tracking. No location, contacts, microphone or camera. What the blocker sees
stays on the device. An account is optional and carries only your own progress
between your own devices; without one it all works offline.

Seven languages: English, 日本語, 中文, Русский, हिन्दी, اردو, العربية.

There is a Windows version as well.
```

---

## What is deliberately not in the copy

**App blocking is in the copy now.** It was held back while it had never
been run on a handset, because a listing is a promise. It has been since 15
September — the log entry in `HANDOFF.md` for that day lists what it does —
so it is advertised, and it is the strongest thing in the listing.

That makes the Console declarations in `PLAY.md` §3 the gate on publishing
rather than a formality: the accessibility service needs its prominent
disclosure recorded, and the in-app wording has to match the Console wording
word for word. Advertising the feature and failing the declaration is the
one combination that gets the whole listing rejected.

**A count of the games.** It was in the copy, because a number is the most
concrete thing the app can say about itself, and it has been taken out again:
"twelve" is wrong the day a thirteenth ships, and nobody re-reads a store
listing when the arcade grows. The names are still there -- they are what
somebody searches for -- but as examples rather than as an inventory, and
with "more get added" after them. The screenshots say the same thing: the
arcade frame no longer counts the shelf. The looks and the tracks are still
counted, because that shelf is finished and the count is doing work in a
sentence about how much there is to earn. Re-check it if that changes.

## The screenshots

**Eight, because eight is the most Play takes.** There were ten, three of
which said the same thing -- here is the arcade, here is a picross, here is
a crossword. The two boards are fanned behind the shelf in one frame now,
which is both fewer frames and a better one: a shelf with its own contents
showing round the edges.

`npx electron tools/look-promo.mjs` writes `look/promo/`:

| file | what it shows |
|---|---|
| `01-focus.png` | the timer running |
| `02-arcade.png` | the shelf, with a picross and a crossword fanned behind it |
| `05-shop.png` | the shelf of looks, with the level bar and its locks |
| `06-calendar.png` | a month and a day off it, fanned |
| `07-spiders.png` | the Spiders look, to show there are looks |
| `08-together.png` | the statistics page |
| `09-room.png` | three real two-device games, fanned |
| `10-room-timer.png` | three real devices on one clock, fanned |
| `feature.png` | the 1024×500 feature graphic |

All eight are exactly 1080×1920 and the feature graphic is exactly 1024×500,
which Play requires to the pixel. The app in each is the real build driven to
that screen, not a mock-up — `08-together.png` is driven live past the account gate
(a token is seeded so the screen can be reached at all, and `fetch` is
stubbed so a screenshot tool never touches the live account server), and
`09-room.png` is a genuine capture of two copies of the app paired over the
room protocol with a real game dealt between them.
