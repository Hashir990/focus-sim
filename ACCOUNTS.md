# Accounts — the design, and what it commits you to

Nothing in this document is built yet. `src/js/47-merge.js` and
`tools/merge-test.mjs` are the groundwork it rests on; everything below is the
part that still has to be written and deployed.

Read the *commitments* section before the schema. The code is the easy half.

---

## What is already true

| Piece | State |
|---|---|
| Merge rules for two offline copies | **Done**, 26 checks (`npm test`) |
| Embers derivable rather than only accumulated | **Done** |
| `at` stamps on sessions and settings | **Done** |
| A server to sync against | Not started |
| Login of any kind | Not started |
| Sync client in the app | Not started |
| Any UI | Not started |

So: **not functional.** What exists is the part that had to be right first,
because a sync layer over data that cannot merge is a sync layer that loses
sessions without telling anybody.

---

## Where the data would live

You already run one Cloudflare Worker (`server/mailbox.js`) with a D1 database.
Accounts belong in the same place, and it is worth being precise about what that
means, because "the edge" is often read as more than it is.

**The code runs everywhere. The database does not.**

- A **Worker** runs in whichever of Cloudflare's ~300 locations is nearest the
  person. That part is genuinely global.
- **D1 is a single-region SQLite database.** It has one primary, chosen when you
  create it, and every read and write goes there. A phone in Sydney syncing
  against a database in Western Europe is a real round trip — a few hundred
  milliseconds.

For this app that is fine, and it is worth saying why: sync happens when the app
opens and when a block ends. It is not chat, it is not the timer, and nothing
waits on it. Choose the region where most people are and let the rest pay
latency they will never notice:

```
wrangler d1 create focus-accounts --location apac      # npm run accounts:make
```

`weur` · `eeur` · `apac` · `wnam` · `enam` · `oc`.

**`apac` is the one this project chose**, and it is a decision rather than a
default: the primary cannot be moved afterwards, only recreated with the rows
copied across. Everyone outside Asia-Pacific pays a few hundred milliseconds on
a sync that nothing is waiting for, which is the trade being made on purpose.

**Not KV.** KV is globally replicated and eventually consistent — excellent for
things read often and written rarely. A per-user record that two devices both
write is exactly the case it is worst at: you can read your own stale write.

---

## What accounts commit you to

This is the part that is easy to skip and expensive to skip.

**1. The app currently promises the opposite.** The menu says *"your data stays
on this device"*, and that has been true. The moment an account exists it is not,
and that line has to change. It is the single most important edit in the whole
feature.

**2. An email address is personal data.** If anybody in the EU or UK uses this,
GDPR applies regardless of where you live or where the server is. The practical
minimum, none of which is onerous at this size:

- say what you store and why, in plain words, before someone signs up;
- collect nothing you do not need — an email and a username *is* the whole list;
- a delete-my-account route that genuinely deletes, not one that flags a row;
- an export route, which you already have in the app.

**3. Holding passwords is a responsibility you can decline.** If you store them
you own the hashing, the reset flow, the rate limiting, and the consequences of
a breach — and people reuse passwords, so a breach of yours is a breach of their
email too.

The alternative removes the entire class of problem: **email a six-digit code**,
and there is no password to store, no reset flow, and nothing to leak but an
address. The cost is an email provider (Resend, Postmark, SES) and about the same
amount of code.

If you still want passwords — and there are good reasons, mainly that it works
offline-ish and needs no provider — the rest of this document assumes them, and
they are stored properly.

---

## Schema

Alongside the two mailbox tables, in the same D1:

```sql
CREATE TABLE IF NOT EXISTS accounts (
  id         TEXT PRIMARY KEY,        -- opaque, generated; never the email
  email      TEXT NOT NULL UNIQUE,    -- lowercased and trimmed before storing
  username   TEXT NOT NULL UNIQUE,    -- what other people see
  pass_hash  TEXT NOT NULL,           -- PBKDF2, see below — never the password
  pass_salt  TEXT NOT NULL,
  made       INTEGER NOT NULL,
  seen       INTEGER
);

-- One row per account. The whole snapshot, as JSON, because it is small and it
-- is always read and written whole — there is no query here worth a schema.
CREATE TABLE IF NOT EXISTS vaults (
  account   TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  snapshot  TEXT NOT NULL,            -- {log, own, claimed, feats, adjust, sim}
  rev       INTEGER NOT NULL,         -- bumped on every write; see conflicts
  at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,        -- sha-256 of the bearer token
  account    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  made       INTEGER NOT NULL,
  seen       INTEGER
);
```

**One username per email, one email per account** — both `UNIQUE`, enforced by
the database rather than by a check the code might forget.

**The snapshot is one JSON blob on purpose.** It is a few hundred kilobytes at
most after years of use, it is always read and written in full, and the merge
already treats it as one value. Splitting sessions into rows would buy queries
nobody makes and cost a migration.

---

## Endpoints

Five, all `POST`, all JSON, on the existing Worker:

| Route | Does |
|---|---|
| `/account/new` | email + username + password → account, or a clear "taken" |
| `/account/in` | email + password → bearer token |
| `/account/out` | drop this token |
| `/vault/get` | token → `{snapshot, rev}` |
| `/vault/put` | token + `{snapshot, rev}` → merged snapshot and a new `rev` |
| `/account/gone` | token + password → delete everything, actually |

**`/vault/put` is the only interesting one, and it must merge on the server.**
The client sends the `rev` it last saw. If the stored `rev` is higher, somebody
else wrote in between — so the server merges the two with the same rules the
client uses and returns the result. It never rejects and it never overwrites.
That is what makes two offline devices safe, and it is the reason `47-merge.js`
is pure: **the identical function has to run in the Worker.**

---

## Passwords, if you keep them

Workers have WebCrypto and no native bcrypt or argon2. The pragmatic answer is
PBKDF2-HMAC-SHA-256, which is built in:

- a random 16-byte salt per account,
- store salt and hash as base64; compare in constant time,
- and as many iterations as the platform will actually run, which is **not** the
  210,000 OWASP recommends. Two separate limits get in the way:

**Workers throw above 100,000 iterations.** Not slowly — `NotSupportedError:
Pbkdf2 failed: iteration counts above 100000 are not supported`. This arrived as
the catch-all 500 and made every sign-up fail with nothing to go on. It is
worked around with passes: each is a full PBKDF2, each one's output feeds the
next, and since they cannot be parallelised the attacker's cost is their sum.

**Workers Free allows 10ms of CPU per request**, and that is the limit that
actually decides the number. A 100,000-iteration pass is most of that budget on
its own; three would be Error 1102, `Worker exceeded resource limits` — a worse
failure than a weak hash, because then nobody can sign in at all.

So this runs **one pass of 50,000**, around 4ms. That is below the
recommendation and it is a real reduction, not a rounding error. What carries
the weight instead is the throttle: the recommendation exists for the offline
threat — an attacker holding the database, grinding without limit — while the
live endpoint is defended by ten tries per email and per address.

**On Workers Paid the CPU limit is 30 seconds.** Set `PBKDF2_PASSES` to 3 for
300,000 iterations, above the recommendation. That is the only change needed;
the `KDF` marker on the front of every hash is what tells old from new.

**Done, in the `throttle` table.** Ten failed sign-ins per address *and* ten per
email in a rolling fifteen minutes; five new accounts per address an hour. Both
counts are checked before the lookup and before any hashing, because the
iteration count cuts the wrong way on a live endpoint — each guess costs the
Worker far more than it costs whoever is guessing.

Per address alone falls to a handful of proxies; per email alone lets one
address work through every account in turn. Signing in successfully clears that
email's count, so forgetting your password a few times and then remembering it
does not lock you out. The address count is left alone, because one success does
not make the rest of the volume from there innocent. Being turned away is a 429
that names neither the email nor the password — which of the two counts ran out
would itself say whether an account exists.

The address comes from `CF-Connecting-IP`, which Cloudflare sets and a client
cannot forge. `X-Forwarded-For` is deliberately not consulted.

Never log an email next to a failure reason, and never tell the sign-in route
whether it was the email or the password that was wrong.

---

## The order to build it in

1. ~~`/account/new` and `/account/in`, with the schema above. No sync yet.~~
2. ~~`/vault/get` and `/vault/put`, with `47-merge.js` imported by the Worker.~~
3. ~~The client: sign in, pull, merge locally, push. On open and on block end.~~
4. ~~The UI, and the wording change in the menu.~~
5. ~~`/account/gone`, before anybody real signs up — not after.~~
6. ~~Rate limiting, before the endpoint is public.~~

All built and tested. What remains is deploying it, which is below.

---

## Signing out clears the device

It used to leave everything where it was, which was kind and wrong. The history,
the embers and the shelf that arrive when you sign in belong to *the account* —
so leaving them behind meant signing into somebody else's account, syncing their
hours and their purchases, signing out, and keeping all of it. Every theme in
the shop was one borrowed login away from free.

So the account is the only home for progress once there is an account. Signing
in brings it, signing out takes it away, signing in again brings it back. That
is a real cost to the honest case, which is why it asks first and why the
wording says where the history is *going* rather than that it is safe.

The last sync is pushed before anything local is dropped, so a block finished
two minutes earlier is not lost by signing out straight after it.

---

## Password reset needs a domain

`/account/password` (signed in, current password required) works today and needs
nothing. `/account/forgot` generates a new password, invalidates the old one,
signs every device out, and hands the new one to `sendMail()`.

**`sendMail()` does nothing until you configure it.** Cloudflare's own free
route — MailChannels — was withdrawn in August 2024, and every provider will
only send on behalf of a domain you control. `workers.dev` cannot be that
domain, so this is the one feature that needs you to own one.

```
# after adding the domain in Resend and its DNS records
wrangler secret put RESEND_KEY --config server/wrangler-accounts.toml
# and MAIL_FROM = "Focus Simulator <hello@yourdomain>" as a plain var
```

Two things worth knowing about the design:

- **Mailing a password is weaker than mailing a link.** The password then lives
  in an inbox indefinitely, and an inbox is read on more machines than an
  account ever is. A single-use link that expires in an hour leaves nothing
  behind. This does what was asked; that is the change if it is revisited.
- **The reply is identical for an address with no account.** Otherwise this is
  a way to ask which of a list of emails is registered here.

If sending fails, the password has *already* been changed — the person is locked
out silently. That case is logged; `wrangler tail` will show it.

---

## Turning it on

Nothing here is in the repo: the database id and the Worker URL are yours, and
the app has no sign-in at all until `FOCUS_ACCOUNT_URL` is stamped into a build.

```
npm install -g wrangler        # once
wrangler login                 # opens a browser

npm run accounts:make          # prints a database_id — paste it into
                               # server/wrangler-accounts.toml
npm run accounts:schema        # creates the five tables in the real database
npm run accounts:deploy        # prints https://focus-accounts.<you>.workers.dev
```

Check it answers before going further:

```
curl https://focus-accounts.<you>.workers.dev/health
```

Then add the URL to `.env.release` — `tools/build.mjs` bakes it in, and every
build made from that point has sign-in in **Your focus**:

```
FOCUS_ACCOUNT_URL=https://focus-accounts.<you>.workers.dev
```

`--remote` on the schema step is not optional. Without it wrangler writes to a
local sqlite file, the deploy succeeds, and the first sign-up fails against a
database with no tables in it.
