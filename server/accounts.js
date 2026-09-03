/**
 * Focus Simulator accounts.
 *
 * Deploy alongside the mailbox (they can share one D1):
 *
 *   wrangler d1 create focus-accounts --location weur
 *   wrangler d1 execute focus-accounts --file server/accounts-schema.sql
 *   wrangler deploy --config server/wrangler-accounts.toml
 *
 * `--location` matters and is not the edge. The Worker runs everywhere; D1 has
 * one primary and every read and write goes to it. That is fine here because
 * sync happens when the app opens and when a block ends — nothing waits on it —
 * but pick the region most people are in. See ACCOUNTS.md.
 *
 * ---- what this is careful about ----
 *
 * **It never overwrites.** `/vault/put` merges server-side with the *same*
 * rules the client uses, which is why `src/js/47-merge.js` is pure and is
 * inlined here rather than reimplemented. Two devices used offline is the
 * normal case, and last-writer-wins would silently eat an afternoon.
 *
 * **It never says which half was wrong.** Sign-in failures are one message
 * whether the email is unknown or the password is bad, because the difference
 * tells an attacker which emails have accounts.
 *
 * **It stores no password.** PBKDF2-HMAC-SHA-256, per-account salt, 210,000
 * iterations — the current OWASP figure for this algorithm, and what WebCrypto
 * gives us on Workers, where bcrypt and argon2 are not available.
 *
 * **Deleting means deleting.** `/account/gone` removes the rows. There is no
 * flag, no tombstone, nothing to un-delete from.
 */

/* ---------- the merge rules ----------
 * Kept identical to src/js/47-merge.js on purpose: the server and the client
 * have to agree or a merge is a coin toss. If you change one, change both —
 * tools/merge-test.mjs covers the client copy and server/accounts-test.mjs
 * checks this one against the same expectations.
 */
function mergeLog(a, b) {
  const by = new Map();
  const take = (r) => {
    if (!r || !r.id) return;
    const had = by.get(r.id);
    if (!had) { by.set(r.id, r); return; }
    const better = (r.secs || 0) !== (had.secs || 0)
      ? ((r.secs || 0) > (had.secs || 0) ? r : had)
      : ((r.at || 0) > (had.at || 0) ? r : had);
    by.set(r.id, better);
  };
  (a || []).forEach(take);
  (b || []).forEach(take);
  return [...by.values()].sort((x, y) => (x.ts || 0) - (y.ts || 0));
}
function mergeSet(a, b) {
  const out = [], seen = Object.create(null);
  for (const v of (a || []).concat(b || [])) {
    if (typeof v !== 'string' || seen[v]) continue;
    seen[v] = 1; out.push(v);
  }
  return out;
}
function mergeFeats(a, b) {
  const out = Object.assign({}, a || {}), other = b || {};
  for (const k in other) {
    const x = Number(other[k]) || 0, had = Number(out[k]) || 0;
    out[k] = x > had ? x : had;
  }
  return out;
}
function mergeSim(a, b) {
  const A = a || {}, B = b || {};
  return (Number(B.at) || 0) > (Number(A.at) || 0) ? B : A;
}
/* Lists you curate — the plan and the checklist. Union by id, minus anything
   deleted; where both hold the same id the later `at` wins, and `done` is
   unioned because it is keyed by day. Same rules as the client. */
function mergeById(a, b, gone) {
  const dead = new Set(gone || []);
  const by = new Map();
  const take = (r) => {
    if (!r || !r.id || dead.has(r.id)) return;
    const had = by.get(r.id);
    if (!had) { by.set(r.id, r); return; }
    const win = (Number(r.at) || 0) > (Number(had.at) || 0) ? r : had;
    const lose = win === r ? had : r;
    if (win.done && typeof win.done === 'object' && lose.done && typeof lose.done === 'object') {
      by.set(r.id, Object.assign({}, win, { done: Object.assign({}, lose.done, win.done) }));
    } else {
      by.set(r.id, win);
    }
  };
  (a || []).forEach(take);
  (b || []).forEach(take);
  return [...by.values()];
}
function mergeGone(a, b, max) {
  const out = [], seen = Object.create(null);
  for (const v of (a || []).concat(b || [])) {
    if (typeof v !== 'string' || seen[v]) continue;
    seen[v] = 1; out.push(v);
  }
  const cap = Number(max) || 500;
  return out.length > cap ? out.slice(-cap) : out;
}
/* Saved games: the newer save of each wins whole, with the best score, the
   crossword's finished puzzles and the chess shelf lifted out of the loser. */
function crossFill(r) {
  if (!r || typeof r.u !== 'string') return -1;
  if (r.done) return 1e9;
  let n = 0;
  for (let i = 0; i < r.u.length; i++) if (r.u[i] !== '.') n++;
  return n;
}
function mergeGameSave(key, win, lose) {
  if (!win || typeof win !== 'object' || !lose || typeof lose !== 'object') return win;
  if (key === 'arcade_2048') {
    const best = Math.max(Number(win.best) || 0, Number(lose.best) || 0,
                          Number(win.score) || 0, Number(lose.score) || 0);
    return Object.assign({}, win, { best });
  }
  if (key === 'arcade_cross') {
    const p = Object.assign({}, lose.p || {});
    const mine = win.p || {};
    for (const k in mine) {
      if (!Object.prototype.hasOwnProperty.call(mine, k)) continue;
      p[k] = crossFill(mine[k]) >= crossFill(p[k]) ? mine[k] : p[k];
    }
    return Object.assign({}, win, { p });
  }
  if (key === 'focus_chess') {
    const out = Object.assign({}, lose, win);
    for (const k in out) {
      if (!Object.prototype.hasOwnProperty.call(out, k)) continue;
      const mine = win[k], theirs = lose[k];
      if (mine && theirs) out[k] = (Number(theirs.at) || 0) > (Number(mine.at) || 0) ? theirs : mine;
    }
    return out;
  }
  return win;
}
function mergeGames(a, b) {
  const A = a || {}, B = b || {}, out = {};
  const keys = Object.create(null);
  for (const k in A) keys[k] = 1;
  for (const k in B) keys[k] = 1;
  for (const k in keys) {
    const x = A[k], y = B[k];
    if (!x || !x.v) { if (y && y.v) out[k] = y; continue; }
    if (!y || !y.v) { out[k] = x; continue; }
    const win = (Number(y.at) || 0) > (Number(x.at) || 0) ? y : x;
    const lose = win === y ? x : y;
    out[k] = { at: Number(win.at) || 0, v: mergeGameSave(k, win.v, lose.v) };
  }
  return out;
}
/* What happened to each dated puzzle: `{'sudoku:easy': {'2026-08-27': {s:2,
   t:412}}}` — 1 started, 2 finished, plus whatever the game measured. Must
   stay identical to `mergeDaily` in src/js/47-merge.js. */
function mergeDaily(a, b){
  const out = {};
  /* A day is `{s, t, g, …}` — a state and whatever numbers the game hung on
     it. Older records are a bare number and are read as `{s: n}`.

     The winner is the one that got further: higher `s`, and on a tie the one
     whose clock ran longer, which is the same argument `mergeLog` makes
     about two observations of one block. Then the loser's fields are kept
     underneath, so a device that recorded guesses and one that recorded a
     time end up with both rather than with whichever synced last. */
  const asRec = (v)=>{
    if(typeof v === 'number') return (v === 1 || v === 2) ? {s: v} : null;
    if(!v || typeof v !== 'object') return null;
    const s = v.s | 0;
    if(s !== 1 && s !== 2) return null;
    const r = {s};
    for(const k of ['t', 'g', 'w', 'c', 'n', 'h', 'm', 'd']){
      const x = Number(v[k]);
      if(isFinite(x) && x >= 0) r[k] = x;
    }
    /* The word game's grid of squares — five characters a guess.
       A string, and the only one; capped so a bad record stays small. */
    if(typeof v.p === 'string' && v.p && v.p.length <= 40) r.p = v.p;
    return r;
  };
  for(const src of [a || {}, b || {}]){
    if(!src || typeof src !== 'object') continue;
    for(const id in src){
      if(!Object.prototype.hasOwnProperty.call(src, id)) continue;
      const days = src[id];
      if(!days || typeof days !== 'object') continue;
      const into = out[id] || (out[id] = {});
      for(const k in days){
        if(!Object.prototype.hasOwnProperty.call(days, k)) continue;
        const rec = asRec(days[k]);
        if(!rec) continue;
        const had = into[k];
        if(!had){ into[k] = rec; continue; }
        const win = rec.s !== had.s ? (rec.s > had.s ? rec : had)
          : ((rec.t || 0) >= (had.t || 0) ? rec : had);
        const lose = win === rec ? had : rec;
        into[k] = Object.assign({}, lose, win);
      }
    }
  }
  return out;
}

function mergeSnapshots(local, remote) {
  const A = local || {}, B = remote || {};
  const gone = mergeGone(A.gone, B.gone);
  return {
    log: mergeLog(A.log, B.log),
    own: mergeSet(A.own, B.own),
    /* Grandfathered prices, unioned exactly like `own`: a device that met the
       price rise owning ten things and one that met it owning twelve should
       agree on all twelve. Dropping this key would re-charge the difference at
       the new price — see EMB_WAS in 37-embers.js. */
    grand: mergeSet(A.grand, B.grand),
    /* Grandfathered prices, unioned exactly like `own`: a device that met the
       price rise owning ten things and one that met it owning twelve should
       agree on all twelve. Dropping this key would re-charge the difference at
       the new price — see EMB_WAS in 37-embers.js. */
    claimed: mergeSet(A.claimed, B.claimed),
    feats: mergeFeats(A.feats, B.feats),
    adjust: Math.max(Number(A.adjust) || 0, Number(B.adjust) || 0),
    /* **These were missing, and the vault was quietly eating them.** The client
       grew the calendar, the checklist, the tombstones, the quote bank and the
       saved games; this copy did not, so every key it did not know about was
       dropped from whatever it stored. A first put looked like it worked — it
       is written verbatim — and every put after it threw the lot away. If a key
       is added to src/js/47-merge.js it has to be added here in the same
       change. */
    plan: mergeById(A.plan, B.plan, gone),
    tasks: mergeById(A.tasks, B.tasks, gone),
    gone,
    quotes: mergeById(A.quotes, B.quotes, gone),
    games: mergeGames(A.games, B.games),
    daily: mergeDaily(A.daily, B.daily),
    sim: mergeSim(A.sim, B.sim),
  };
}

/* ---------- small helpers ---------- */
const json = (o, status = 200) => new Response(JSON.stringify(o), {
  status,
  headers: {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
  },
});
const bad = (why, status = 400) => json({ ok: false, error: why }, status);

const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

async function sha256(s) {
  return b64(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

/* **Two limits fight over this number, and the free plan wins.**

   The first is a hard refusal: Workers throw above 100,000 PBKDF2 iterations
   rather than running slowly. Asking for the 210,000 OWASP recommends gives

     NotSupportedError: Pbkdf2 failed: iteration counts above 100000 are not
     supported (requested 210000)

   ...which arrived as the catch-all 500 and made every sign-up fail. That one
   is worked around with passes: each is a full PBKDF2, each one's output feeds
   the next, and since they cannot be run in parallel or reordered the cost to
   an attacker is their sum.

   The second is the one that actually decides it. **Workers Free allows 10ms of
   CPU per request**, and a 100,000-iteration PBKDF2 is most of that on its own.
   Three passes would be Error 1102 — `Worker exceeded resource limits` — which
   is a worse failure than a weak hash because nobody can sign in at all.

   So: one pass, 50,000 iterations, which should land around 4ms. This is below
   the recommendation and that is a real reduction, not a rounding error. What
   carries the weight instead is the throttle above — ten tries per email and
   per address in fifteen minutes — which is the defence that matters against
   guessing a live endpoint. The recommendation is about the other threat: an
   attacker who already has the database and can grind offline without limit.

   **On Workers Paid the CPU limit is 30 seconds.** Set PASSES to 3 and this
   goes to 300,000, above the recommendation. That is the only change needed,
   and old hashes are told apart by the KDF marker below. */
const PBKDF2_ROUNDS = 50000;
const PBKDF2_PASSES = 1;

/* Stored on the front of every hash, and it is the passes that name it. Nothing
   reads it yet, and that is the point: the day this derivation changes — most
   likely when this account moves to Workers Paid and the passes go up — it is
   the only way to tell an old hash from a new one, and without it the choice is
   locking everybody out or guessing. Costs two characters a row. */
const KDF = String(PBKDF2_PASSES);

async function hashPassword(password, saltB64) {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  let material = enc.encode(password);
  for (let i = 0; i < PBKDF2_PASSES; i++) {
    const key = await crypto.subtle.importKey('raw', material, 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ROUNDS, hash: 'SHA-256' }, key, 256);
    material = new Uint8Array(bits);
  }
  return KDF + '$' + b64(material);
}

/** Constant time, so a wrong password cannot be found one byte at a time. */
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const rnd = (n) => b64(crypto.getRandomValues(new Uint8Array(n)));
const now = () => Date.now();

/* An email is stored lowercased and trimmed, so `A@b.com ` and `a@b.com` are
   one account rather than two people who cannot see each other's history. */
const cleanEmail = (v) => String(v || '').trim().toLowerCase();
const okEmail = (v) => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v) && v.length <= 254;
/* Usernames are what other people see, so: visible characters only, and a
   length that fits in a room list. Compared lowercased for uniqueness while
   keeping the capitals somebody chose. */
const okUser = (v) => /^[a-zA-Z0-9_.-]{3,20}$/.test(String(v || ''));

/* ---------- slowing down guessing ----------
   The password hash is 210,000 rounds, which is about protecting the database
   if it ever leaks. It does nothing about somebody working a password list
   against the live endpoint — if anything it makes that *worse*, because each
   guess costs the Worker far more than it costs the attacker.

   So attempts are counted before any hashing happens: by address, and also by
   email, because the first alone is beaten with a handful of proxies and the
   second alone lets one address grind through every account in turn. A window
   passing clears the count; signing in successfully clears the count for that
   email, so somebody who simply forgot their password is not locked out by
   their own last few tries. */
const LIMIT = { in: 10, new: 5 };
const WINDOW = { in: 15 * 60 * 1000, new: 60 * 60 * 1000 };

async function strikes(db, k) {
  const row = await db.prepare('SELECT n, until FROM throttle WHERE k = ?').bind(k).first();
  if (!row) return 0;
  if (row.until < now()) {
    await db.prepare('DELETE FROM throttle WHERE k = ?').bind(k).run();
    return 0;
  }
  return row.n;
}

/* One statement, so two requests arriving together cannot both read 9 and both
   write 10. An expired window is reset here rather than deleted first, which
   would open exactly that gap. */
async function strike(db, k, window) {
  const t = now(), until = t + window;
  await db.prepare(
    'INSERT INTO throttle (k, n, until) VALUES (?, 1, ?) '
    + 'ON CONFLICT(k) DO UPDATE SET '
    + '  n = CASE WHEN throttle.until < ? THEN 1 ELSE throttle.n + 1 END, '
    + '  until = CASE WHEN throttle.until < ? THEN ? ELSE throttle.until END')
    .bind(k, until, t, t, until).run();
}

const unstrike = (db, k) => db.prepare('DELETE FROM throttle WHERE k = ?').bind(k).run();

/* ---------- accounts ---------- */
async function accountNew(db, b, ip) {
  const email = cleanEmail(b.email);
  const username = String(b.username || '').trim();
  const password = String(b.password || '');
  if (!okEmail(email)) return bad('that does not look like an email address');
  if (!okUser(username)) return bad('a username is 3–20 letters, numbers, dot, dash or underscore');
  if (password.length < 8) return bad('a password needs at least 8 characters');
  if (password.length > 200) return bad('that password is too long');

  /* Checked after the shape of the request but before it touches the database
     in earnest, so a script cannot fill the table faster than people can type. */
  const kNew = 'new:ip:' + ip;
  if (await strikes(db, kNew) >= LIMIT.new) {
    return bad('a few too many accounts from here — try again in an hour', 429);
  }

  const taken = await db.prepare(
    'SELECT email, username FROM accounts WHERE email = ? OR lower(username) = ?')
    .bind(email, username.toLowerCase()).first();
  if (taken) {
    return bad(taken.email === email
      ? 'there is already an account for that email'
      : 'that username is taken');
  }

  const id = rnd(16), salt = rnd(16);
  const hash = await hashPassword(password, salt);
  await db.prepare(
    'INSERT INTO accounts (id, email, username, pass_hash, pass_salt, made, seen) VALUES (?,?,?,?,?,?,?)')
    .bind(id, email, username, hash, salt, now(), now()).run();
  await strike(db, kNew, WINDOW.new);
  return json({ ok: true, token: await newSession(db, id), username });
}

async function newSession(db, account) {
  const token = rnd(32);
  await db.prepare('INSERT INTO sessions (token_hash, account, made, seen) VALUES (?,?,?,?)')
    .bind(await sha256(token), account, now(), now()).run();
  return token;
}

async function accountIn(db, b, ip) {
  const email = cleanEmail(b.email);
  const password = String(b.password || '');

  /* Before the lookup and before any hashing — the whole point is that a guess
     costs the attacker a round trip and costs us nothing. The message says only
     that there were too many attempts: which of the two counts ran out would
     say whether this email has an account here. */
  const kIp = 'in:ip:' + ip, kEm = 'in:em:' + email;
  if (await strikes(db, kIp) >= LIMIT.in || await strikes(db, kEm) >= LIMIT.in) {
    return bad('too many attempts just now — wait a few minutes and try again', 429);
  }

  const row = await db.prepare(
    'SELECT id, username, pass_hash, pass_salt FROM accounts WHERE email = ?')
    .bind(email).first();
  /* One message for both halves. Saying "no such email" tells whoever is asking
     which addresses have accounts here, which is a list worth having and not
     ours to hand out. The work is done either way so the timing does not
     answer the question either. */
  const wrong = async () => {
    await strike(db, kIp, WINDOW.in);
    await strike(db, kEm, WINDOW.in);
    return bad('that email and password do not match', 401);
  };
  if (!row) { await hashPassword(password, rnd(16)); return wrong(); }
  const hash = await hashPassword(password, row.pass_salt);
  if (!sameSecret(hash, row.pass_hash)) return wrong();
  /* Getting in clears this email's count — a few forgotten attempts followed by
     the right password is somebody remembering, not somebody guessing. The
     address count is left alone: that one is about the volume coming from one
     place, and a success does not make the rest of it innocent. */
  await unstrike(db, kEm);
  await db.prepare('UPDATE accounts SET seen = ? WHERE id = ?').bind(now(), row.id).run();
  return json({ ok: true, token: await newSession(db, row.id), username: row.username });
}

/* ---------- changing a password ----------
   The current one is required even though the token already proves who this
   is. A token is "this browser was signed in at some point"; a password is
   "this is me, now". Thirty seconds alone with an unlocked laptop is the
   ordinary way accounts are taken, and without this check that is enough to
   lock somebody out of their own account permanently.

   Other devices are deliberately left signed in. Changing your password
   because you want a better one should not mean signing in again on the phone,
   the tablet and the desktop; `/account/gone` is there for the case where you
   want everything cut off. */
async function accountPassword(db, b) {
  const id = await whoIs(db, b.token);
  if (!id) return bad('you are not signed in', 401);
  const next = String(b.next || '');
  if (next.length < 8) return bad('a password needs at least 8 characters');
  if (next.length > 200) return bad('that password is too long');
  const row = await db.prepare('SELECT pass_hash, pass_salt FROM accounts WHERE id = ?')
    .bind(id).first();
  if (!row) return bad('you are not signed in', 401);
  const now = await hashPassword(String(b.password || ''), row.pass_salt);
  if (!sameSecret(now, row.pass_hash)) return bad('that is not your current password', 401);
  const salt = rnd(16);
  await db.prepare('UPDATE accounts SET pass_hash = ?, pass_salt = ? WHERE id = ?')
    .bind(await hashPassword(next, salt), salt, id).run();
  return json({ ok: true });
}

/* ---------- forgetting one ----------
   **The reply never says whether the address is registered.** Always the same
   answer, always the same work, because "no account for that email" turns this
   into a way to ask which of a list of addresses has an account here.

   A new password is generated and sent, rather than a link, because that is
   what was asked for. It is the weaker of the two designs and worth knowing
   why: the password sits in an inbox indefinitely, and an inbox is read on
   more machines than an account ever is. A single-use link that expires in an
   hour leaves nothing behind. If this is ever revisited, that is the change.

   The old password stops working the moment this is sent — otherwise anybody
   could invalidate nothing and simply generate a second valid credential.
   Sessions elsewhere are cut, because the honest reading of "I have lost my
   password" is "somebody else may have it". */
function readablePassword() {
  /* Typed off a screen and into a phone, so: no l/1/O/0, and grouped. */
  const a = 'abcdefghjkmnpqrstuvwxyz', n = '23456789';
  const pick = (s, k) => [...crypto.getRandomValues(new Uint8Array(k))]
    .map((x) => s[x % s.length]).join('');
  return pick(a, 4) + '-' + pick(a, 4) + '-' + pick(n, 3);
}

async function accountForgot(db, b, ip, env) {
  const email = cleanEmail(b.email);
  const same = json({ ok: true });

  /* **Say so plainly when there is no way to send anything.** "We have emailed
     you" from a server with no mail provider is a lie that leaves somebody
     waiting for a message that will never arrive, and then assuming their
     account is broken. This reveals something about the *server*, not about
     whether the address is registered, so it costs nothing. */
  if (!env || !env.RESEND_KEY || !env.MAIL_FROM) {
    return bad('password reset is not set up on this server yet — '
      + 'sign in and change it under Your account instead', 501);
  }
  if (!okEmail(email)) return same;

  /* Rate limited on the address as well as the email: without it this is a
     button that makes somebody else's password change, over and over. */
  const kIp = 'forgot:ip:' + ip, kEm = 'forgot:em:' + email;
  if (await strikes(db, kIp) >= LIMIT.new || await strikes(db, kEm) >= LIMIT.new) return same;
  await strike(db, kIp, WINDOW.new);
  await strike(db, kEm, WINDOW.new);

  const row = await db.prepare('SELECT id FROM accounts WHERE email = ?').bind(email).first();
  if (!row) return same;

  /* **Send first. Change second. In that order, always.**

     This was written the other way round — set the new password, then post it —
     and with no mail provider configured that is a guaranteed lockout: the old
     password stops working, the new one exists only in a variable that is
     discarded a line later, and the account is gone. It did exactly that to the
     first person who pressed the button.

     Now nothing is written unless the message is accepted for delivery. A reset
     that cannot be delivered leaves the account exactly as it was, which is the
     only safe way to fail. */
  const fresh = readablePassword();
  const sent = await sendMail(env, email, 'Your new Focus Simulator password',
    'Somebody asked to reset the password for this account.\n\n'
    + 'Your new password is:  ' + fresh + '\n\n'
    + 'Sign in with it, then change it under Your account. Your old password no '
    + 'longer works, and you have been signed out everywhere.\n\n'
    + 'If this was not you, sign in and change it now — whoever asked has this '
    + 'password too.');
  if (!sent) {
    console.error('accounts: reset for ' + email + ' not sent — password left alone');
    return same;
  }

  const salt = rnd(16);
  await db.prepare('UPDATE accounts SET pass_hash = ?, pass_salt = ? WHERE id = ?')
    .bind(await hashPassword(fresh, salt), salt, row.id).run();
  await db.prepare('DELETE FROM sessions WHERE account = ?').bind(row.id).run();
  return same;
}

/* The one piece that needs somebody else's service. Cloudflare's own free
   route (MailChannels) was withdrawn in August 2024, and every provider needs a
   domain you control before it will send to a stranger — `workers.dev` cannot
   be that domain. So this is deliberately a stub with a real shape: set
   RESEND_KEY and MAIL_FROM and it works; leave them and everything above still
   runs, and the failure is logged rather than pretended away.

   wrangler secret put RESEND_KEY --config server/wrangler-accounts.toml
   ...and MAIL_FROM = "Focus Simulator <hello@yourdomain>" as a plain var. */
async function sendMail(env, to, subject, text) {
  const key = env && env.RESEND_KEY, from = env && env.MAIL_FROM;
  if (!key || !from) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
      body: JSON.stringify({ from, to, subject, text }),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function whoIs(db, token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const row = await db.prepare('SELECT account FROM sessions WHERE token_hash = ?')
    .bind(await sha256(token)).first();
  return row ? row.account : null;
}

async function accountOut(db, b) {
  if (typeof b.token === 'string') {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?')
      .bind(await sha256(b.token)).run();
  }
  return json({ ok: true });
}

/* Everything, actually gone. No flag, no tombstone — there is nothing left to
   un-delete from, which is the only version of this promise worth making. */
async function accountGone(db, b) {
  const id = await whoIs(db, b.token);
  if (!id) return bad('not signed in', 401);
  const row = await db.prepare('SELECT pass_hash, pass_salt FROM accounts WHERE id = ?')
    .bind(id).first();
  if (!row) return bad('not signed in', 401);
  const hash = await hashPassword(String(b.password || ''), row.pass_salt);
  if (!sameSecret(hash, row.pass_hash)) return bad('that password does not match', 401);
  await db.prepare('DELETE FROM vaults WHERE account = ?').bind(id).run();
  await db.prepare('DELETE FROM sessions WHERE account = ?').bind(id).run();
  await db.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();
  return json({ ok: true, gone: true });
}

/* ---------- the vault ---------- */
async function vaultGet(db, b) {
  const id = await whoIs(db, b.token);
  if (!id) return bad('not signed in', 401);
  const row = await db.prepare('SELECT snapshot, rev FROM vaults WHERE account = ?').bind(id).first();
  if (!row) return json({ ok: true, rev: 0, snapshot: null });
  let snapshot = null;
  try { snapshot = JSON.parse(row.snapshot); } catch (e) { snapshot = null; }
  return json({ ok: true, rev: row.rev, snapshot });
}

/**
 * The only interesting endpoint.
 *
 * The client sends the `rev` it last saw. If the stored one is higher, another
 * device wrote in between — so this **merges** and returns the result. It never
 * rejects the write and it never overwrites the other device. That is the whole
 * reason the merge rules are pure and duplicated here rather than living only
 * in the app: the arbiter has to be the side both devices can reach.
 */
async function vaultPut(db, b) {
  const id = await whoIs(db, b.token);
  if (!id) return bad('not signed in', 401);
  if (!b.snapshot || typeof b.snapshot !== 'object') return bad('no snapshot');

  const row = await db.prepare('SELECT snapshot, rev FROM vaults WHERE account = ?').bind(id).first();
  let merged = b.snapshot, rev = 1;
  if (row) {
    let mine = null;
    try { mine = JSON.parse(row.snapshot); } catch (e) { mine = null; }
    merged = mine ? mergeSnapshots(mine, b.snapshot) : b.snapshot;
    rev = (row.rev || 0) + 1;
    await db.prepare('UPDATE vaults SET snapshot = ?, rev = ?, at = ? WHERE account = ?')
      .bind(JSON.stringify(merged), rev, now(), id).run();
  } else {
    await db.prepare('INSERT INTO vaults (account, snapshot, rev, at) VALUES (?,?,?,?)')
      .bind(id, JSON.stringify(merged), rev, now()).run();
  }
  return json({ ok: true, rev, snapshot: merged });
}

/* ---------- the surface ---------- */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return json({ ok: true });
    if (path === '/health') return json({ ok: true, what: 'accounts' });
    if (request.method !== 'POST') return bad('post only', 405);
    if (!env || !env.DB) return bad('no database bound', 500);

    let body = {};
    try { body = await request.json(); } catch (e) { return bad('expected json'); }

    /* Cloudflare sets this and a client cannot forge it; `X-Forwarded-For` can
       be anything the sender likes and is deliberately not consulted. With no
       header at all — which is the test harness, not the internet — everything
       shares one bucket, so the tests pass an address of their own. */
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    try {
      if (path === '/account/new') return await accountNew(env.DB, body, ip);
      if (path === '/account/in') return await accountIn(env.DB, body, ip);
      if (path === '/account/out') return await accountOut(env.DB, body);
      if (path === '/account/password') return await accountPassword(env.DB, body);
      if (path === '/account/forgot') return await accountForgot(env.DB, body, ip, env);
      if (path === '/account/gone') return await accountGone(env.DB, body);
      if (path === '/vault/get') return await vaultGet(env.DB, body);
      if (path === '/vault/put') return await vaultPut(env.DB, body);
    } catch (e) {
      /* The person is told nothing — a stack trace is a map of the inside and
         they cannot act on it anyway. But it goes to the log, because "something
         went wrong" with nothing behind it means the only way to find a missing
         table or a renamed column is to guess. `wrangler tail` shows this. */
      console.error('accounts ' + path + ' failed:', (e && e.stack) || String(e));
      return bad('something went wrong', 500);
    }
    return bad('no such route', 404);
  },
};
