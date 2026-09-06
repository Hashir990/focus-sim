/**
 * Tests for the accounts Worker.
 *
 * Runs the real `fetch` handler against an in-memory stand-in for D1 — same
 * approach as mailbox-test.mjs, and for the same reason: everything worth
 * getting wrong here is logic, and none of it needs a deploy to be wrong.
 *
 * The stub understands only the statements accounts.js actually issues. If a
 * new query appears, it throwing is the correct outcome.
 *
 *   node server/accounts-test.mjs
 */
import { readFileSync } from 'node:fs';
import worker, { codeForName } from './accounts.js';

let pass = 0;
const fails = [];
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log('  ok  ' + label); return; }
  fails.push(label + (detail ? ' — ' + detail : ''));
  console.log('  ✗   ' + label + (detail ? ' — ' + detail : ''));
};

/** Just enough D1 to run this Worker. */
function fakeDB() {
  const accounts = new Map();   // id -> row
  const vaults = new Map();     // account -> {snapshot, rev, at}
  const sessions = new Map();   // token_hash -> {account}
  const throttle = new Map();   // k -> {n, until}

  const run = (sql, a) => {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.startsWith('SELECT email, username FROM accounts WHERE email = ? OR lower(username)')) {
      for (const r of accounts.values()) {
        if (r.email === a[0] || r.username.toLowerCase() === a[1]) return { first: r };
      }
      return { first: null };
    }
    if (s.startsWith('INSERT INTO accounts')) {
      accounts.set(a[0], { id: a[0], email: a[1], username: a[2], pass_hash: a[3], pass_salt: a[4] });
      return { changes: 1 };
    }
    if (s.startsWith('SELECT id, username, pass_hash, pass_salt FROM accounts WHERE email')) {
      for (const r of accounts.values()) if (r.email === a[0]) return { first: r };
      return { first: null };
    }
    if (s.startsWith('SELECT pass_hash, pass_salt FROM accounts WHERE id')) {
      return { first: accounts.get(a[0]) || null };
    }
    if (s.startsWith('UPDATE accounts SET seen')) return { changes: 1 };
    if (s.startsWith('UPDATE accounts SET pass_hash')) {
      const r = accounts.get(a[2]);
      if (r) { r.pass_hash = a[0]; r.pass_salt = a[1]; }
      return { changes: r ? 1 : 0 };
    }
    if (s.startsWith('SELECT id FROM accounts WHERE email')) {
      for (const r of accounts.values()) if (r.email === a[0]) return { first: { id: r.id } };
      return { first: null };
    }
    if (s.startsWith('DELETE FROM accounts WHERE id')) { accounts.delete(a[0]); return { changes: 1 }; }

    if (s.startsWith('INSERT INTO sessions')) { sessions.set(a[0], { account: a[1] }); return { changes: 1 }; }
    if (s.startsWith('SELECT account FROM sessions WHERE token_hash')) {
      return { first: sessions.get(a[0]) || null };
    }
    if (s.startsWith('DELETE FROM sessions WHERE token_hash')) { sessions.delete(a[0]); return { changes: 1 }; }
    if (s.startsWith('DELETE FROM sessions WHERE account')) {
      for (const [k, v] of sessions) if (v.account === a[0]) sessions.delete(k);
      return { changes: 1 };
    }

    if (s.startsWith('SELECT snapshot, rev FROM vaults')) return { first: vaults.get(a[0]) || null };
    if (s.startsWith('INSERT INTO vaults')) {
      vaults.set(a[0], { snapshot: a[1], rev: a[2], at: a[3] }); return { changes: 1 };
    }
    if (s.startsWith('UPDATE vaults SET snapshot')) {
      vaults.set(a[3], { snapshot: a[0], rev: a[1], at: a[2] }); return { changes: 1 };
    }
    if (s.startsWith('DELETE FROM vaults WHERE account')) { vaults.delete(a[0]); return { changes: 1 }; }

    /* The counter behind the rate limit. The upsert is one statement in SQL so
       that two requests cannot both read the same number and both write it back
       — reproduced here as one step for the same reason. */
    if (s.startsWith('SELECT n, until FROM throttle')) return { first: throttle.get(a[0]) || null };
    if (s.startsWith('DELETE FROM throttle WHERE k')) { throttle.delete(a[0]); return { changes: 1 }; }
    if (s.startsWith('INSERT INTO throttle')) {
      const [k, until, t] = a;                    // bind(k, until, t, t, until)
      const had = throttle.get(k);
      if (!had || had.until < t) throttle.set(k, { n: 1, until });
      else throttle.set(k, { n: had.n + 1, until: had.until });
      return { changes: 1 };
    }

    /* Every username, for the code-to-name lookup. Returned in the `.all()`
       shape D1 uses: `{results: [...]}`. */
    if (s.startsWith('SELECT username FROM accounts')) {
      return { results: [...accounts.values()].map((r) => ({ username: r.username })) };
    }

    throw new Error('the stub has no answer for: ' + s);
  };

  return {
    _accounts: accounts, _vaults: vaults, _sessions: sessions, _throttle: throttle,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() { return run(sql, args).first; },
            async run() { return run(sql, args); },
            async all() { return run(sql, args); },
          };
        },
        /* D1 lets a statement with no placeholders skip `bind` entirely, and
           the lookup does — so the stub has to as well, or it would pass a
           query the real thing rejects and fail one the real thing runs. */
        async all() { return run(sql, []); },
        async first() { return run(sql, []).first; },
      };
    },
  };
}

const DB = fakeDB();
/* Every call comes from its own address unless one is named. Sharing one would
   make the rate limit a hidden dependency between unrelated tests — the twelfth
   sign-up anywhere in the file would start failing for a reason its own block
   says nothing about. The throttling tests below pin an address on purpose. */
let caller = 0;
/* `mail` lets a test stand a working — or a broken — provider behind the
   Worker. `/account/forgot` is the one route whose behaviour depends on
   whether the message actually went, so it has to be possible to say. */
let MAIL = null;              // null: nothing configured. {ok:false}: it fails.
const sentMail = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt) => {
  if (String(url).indexOf('api.resend.com') >= 0) {
    sentMail.push(JSON.parse(opt.body));
    return { ok: MAIL ? MAIL.ok !== false : false };
  }
  return realFetch(url, opt);
};
const call = async (path, body, ip) => {
  const env = { DB };
  if (MAIL) { env.RESEND_KEY = 'test-key'; env.MAIL_FROM = 'Focus <a@b.test>'; }
  const res = await worker.fetch(
    new Request('https://x' + path, {
      method: 'POST',
      body: JSON.stringify(body || {}),
      headers: { 'CF-Connecting-IP': ip || ('auto-' + (++caller)) },
    }),
    env);
  return { status: res.status, body: await res.json() };
};

const sec = (id, secs, at, ts) => ({ id, secs, at: at || 0, ts: ts || 0 });

console.log('\nsigning up');
{
  const r = await call('/account/new', { email: 'A@Example.com ', username: 'Hashir', password: 'hunter2hunter2' });
  ok('an account is made and comes back signed in', r.body.ok && typeof r.body.token === 'string');
  ok('and the username is kept as it was typed', r.body.username === 'Hashir', r.body.username);

  const dupe = await call('/account/new', { email: 'a@example.com', username: 'someoneelse', password: 'hunter2hunter2' });
  ok('one account per email, whatever case it is typed in',
    !dupe.body.ok && /email/.test(dupe.body.error), dupe.body.error);

  const dupeUser = await call('/account/new', { email: 'b@example.com', username: 'HASHIR', password: 'hunter2hunter2' });
  ok('and one account per username, regardless of case',
    !dupeUser.body.ok && /username/.test(dupeUser.body.error), dupeUser.body.error);

  const short = await call('/account/new', { email: 'c@example.com', username: 'ok', password: 'hunter2hunter2' });
  ok('a two-letter username is refused', !short.body.ok);
  const weak = await call('/account/new', { email: 'c@example.com', username: 'fine', password: 'short' });
  ok('and so is a password worth guessing', !weak.body.ok, weak.body.error);
  const nonsense = await call('/account/new', { email: 'not-an-email', username: 'fine', password: 'hunter2hunter2' });
  ok('and something that is not an address', !nonsense.body.ok);
}

console.log('\nsigning in');
let token = '';
{
  const good = await call('/account/in', { email: 'a@example.com', password: 'hunter2hunter2' });
  ok('the right password gets a token', good.body.ok && !!good.body.token);
  token = good.body.token;

  const bad = await call('/account/in', { email: 'a@example.com', password: 'hunter2hunter3' });
  const missing = await call('/account/in', { email: 'nobody@example.com', password: 'hunter2hunter2' });
  ok('the wrong password is refused', !bad.body.ok && bad.status === 401);
  /* The important one: an unknown email and a wrong password answer the same,
     or the sign-in page becomes a way to find out who has an account here. */
  ok('and an unknown email is refused in exactly the same words',
    bad.body.error === missing.body.error, `${bad.body.error} vs ${missing.body.error}`);

  /* Nothing that could reconstruct a password is written down. */
  const row = [...DB._accounts.values()][0];
  ok('the password itself is nowhere in the table',
    !JSON.stringify(row).includes('hunter2hunter2'));
  ok('and two accounts with the same password would not look alike',
    row.pass_salt && row.pass_hash !== row.pass_salt);
  ok('the token is stored as a hash, not as itself',
    ![...DB._sessions.keys()].includes(token));

  /* Workers throw above 100,000 PBKDF2 iterations rather than running slowly,
     and the throw came back as the catch-all 500 — every sign-up failing with
     nothing to go on. The work factor is made up of passes instead, so the
     ceiling is the thing to hold: raising this constant back to the OWASP
     figure looks like an improvement and takes the whole endpoint down. */
  const src = readFileSync(new URL('./accounts.js', import.meta.url), 'utf8');
  const rounds = Number((src.match(/const PBKDF2_ROUNDS = (\d+)/) || [])[1]);
  const passes = Number((src.match(/const PBKDF2_PASSES = (\d+)/) || [])[1]);
  ok('no single derivation asks for more than Workers allows', rounds <= 100000, String(rounds));
  /* The free plan's 10ms of CPU is the real ceiling, and a 100k pass is most of
     it. Going over is Error 1102 and nobody can sign in at all — a worse
     outcome than a smaller number, so the total is held under one pass's worth
     until the plan changes. Raise PASSES on Workers Paid. */
  ok('and the total fits inside the CPU the free plan allows',
    rounds * passes <= 100000, `${rounds} × ${passes}`);
  /* ...but not so small that it stops being a hash. */
  ok('while still being enough to be worth grinding',
    rounds * passes >= 50000, `${rounds} × ${passes}`);
  ok('the hash records which derivation made it', /^\d+\$/.test(row.pass_hash),
    String(row.pass_hash).slice(0, 4));
}

console.log('\nthe vault');
{
  const empty = await call('/vault/get', { token });
  ok('a new account has nothing in it yet', empty.body.ok && empty.body.rev === 0 && empty.body.snapshot === null);

  const first = await call('/vault/put', {
    token, rev: 0,
    snapshot: { log: [sec('s1', 600, 1, 1)], own: ['dusk'], grand: ['dusk'], claimed: [], feats: {}, adjust: 0,
      daily: { 'sudoku:easy': { '2026-08-20': 2 } }, sim: { face: 'flip', at: 5 } },
  });
  ok('the first write is kept', first.body.ok && first.body.rev === 1);

  /* The case the whole design exists for: a second device that has been offline
     pushes work the server has never seen, and the server must keep both. */
  const second = await call('/vault/put', {
    token, rev: 1,
    snapshot: { log: [sec('s2', 900, 1, 2)], own: ['beach'], grand: ['beach'], claimed: ['first'], feats: { p: 2 }, adjust: 0,
      daily: { 'crossword:7': { '2026-08-21': 1 } }, sim: { face: 'glass', at: 9 } },
  });
  const m = second.body.snapshot;
  ok('a second device does not overwrite the first', m.log.length === 2, `${m.log.length} sessions`);
  ok('purchases from both devices survive', m.own.length === 2, m.own.join(','));
  /* The server rebuilds the snapshot from the keys it knows, so a key it is
     not told about is a key that is silently dropped. `grand` is what kept the
     old price on everything bought before the rise — losing it here would
     re-charge the difference the next time any device reconciled. */
  ok('and so does what each of them kept the old price on',
    (m.grand || []).length === 2, (m.grand || []).join(','));
  /* And the puzzle calendar. Same argument: a key the server is not told to
     carry is a key it silently drops, and dropping this one loses which dated
     puzzles you played on the other device. */
  ok('and the dated puzzles both of them played',
    (m.daily || {})['sudoku:easy'] && m.daily['sudoku:easy']['2026-08-20'].s === 2
    && m.daily['crossword:7'] && m.daily['crossword:7']['2026-08-21'].s === 1,
    JSON.stringify(m.daily));
  ok('and the newer settings win', m.sim.face === 'glass');
  ok('the revision moves on', second.body.rev === 2);

  /* And the specific rule that stops a part-written block eating a whole one. */
  const partial = await call('/vault/put', {
    token, rev: 2,
    snapshot: { log: [sec('s2', 120, 999, 2)], own: [], claimed: [], feats: {}, adjust: 0, sim: { at: 0 } },
  });
  const s2 = partial.body.snapshot.log.find((r) => r.id === 's2');
  ok('a shorter, later observation of a block does not shrink it', s2.secs === 900, `${s2.secs}`);

  const back = await call('/vault/get', { token });
  ok('and reading it back gives the merged thing', back.body.snapshot.log.length === 2);

  /* **Everything the client sends, or the vault is a hole.**

     The client's snapshot grew - the calendar, the checklist, the tombstones,
     the quote bank, the arcade - and this file's copy of the merge did not.
     Anything it did not name was simply absent from what it stored, so the
     first write looked fine (it is kept verbatim) and every write after it
     threw those keys away. It presented as "my quotes do not follow me", which
     is exactly what it was. If a key is added to src/js/47-merge.js it must be
     added to server/accounts.js in the same change; this is what notices. */
  const rich = {
    log: [], own: [], claimed: [], feats: {}, adjust: 0, sim: { at: 20 },
    plan: [{ id: 'p1', t: 'gym', at: 3 }],
    tasks: [{ id: 't1', t: 'inbox', at: 3 }],
    gone: ['x9'],
    quotes: [{ id: 'q1', t: 'one', a: '' }],
    games: { arcade_2048: { at: 7, v: { board: [2], best: 400 } } },
  };
  const kept = (await call('/vault/put', { token, rev: back.body.rev, snapshot: rich })).body.snapshot;
  ok('the calendar survives a merge', (kept.plan || []).length === 1, JSON.stringify(kept.plan));
  ok('so does the checklist', (kept.tasks || []).length === 1, JSON.stringify(kept.tasks));
  ok('so do deletions', (kept.gone || []).indexOf('x9') >= 0, JSON.stringify(kept.gone));
  ok('so do your own quotes', (kept.quotes || []).length === 1, JSON.stringify(kept.quotes));
  ok('so does a saved game', !!(kept.games && kept.games.arcade_2048), JSON.stringify(kept.games));

  /* And once more against a copy that already holds them, which is the write
     that used to lose everything. */
  const again = (await call('/vault/put', {
    token, rev: 0,
    snapshot: { log: [], own: [], claimed: [], feats: {}, adjust: 0, sim: { at: 1 },
                games: { arcade_2048: { at: 9, v: { board: [4], best: 1 } } } },
  })).body.snapshot;
  ok('a second write does not empty them',
    (again.quotes || []).length === 1 && (again.plan || []).length === 1,
    JSON.stringify({ q: again.quotes, p: again.plan }));
  ok('and the best score is still the best of both',
    !!(again.games && again.games.arcade_2048) && again.games.arcade_2048.v.best === 400,
    JSON.stringify(again.games));
}

console.log('\nnot signed in');
{
  ok('no token, no vault', (await call('/vault/get', { token: 'x'.repeat(40) })).status === 401);
  ok('and no writing either', (await call('/vault/put', { token: '', snapshot: {} })).status === 401);
}

console.log('\nleaving');
{
  const wrongPass = await call('/account/gone', { token, password: 'nope' });
  ok('deleting an account needs the password again', wrongPass.status === 401);

  const gone = await call('/account/gone', { token, password: 'hunter2hunter2' });
  ok('and then it goes', gone.body.gone === true);
  ok('the account row is really gone', DB._accounts.size === 0);
  ok('so is everything in it', DB._vaults.size === 0);
  ok('and every way back in', DB._sessions.size === 0);
}

/* The endpoint is public and the hash is deliberately slow, which is a problem
   as well as a protection: every guess costs the Worker far more than it costs
   whoever is guessing. These check the counter actually bites, and that being
   turned away says nothing an attacker could use. */
console.log('\nguessing');
{
  const mark = await call('/account/new',
    { email: 'target@example.com', username: 'target', password: 'hunter2hunter2' });
  ok('an account to guess at', mark.body.ok === true);

  let last = null;
  for (let i = 0; i < 10; i++) {
    last = await call('/account/in', { email: 'target@example.com', password: 'wrong' + i }, '9.9.9.9');
  }
  ok('ten wrong passwords are each refused as usual', last.status === 401, String(last.status));

  const stopped = await call('/account/in', { email: 'target@example.com', password: 'wrong' }, '9.9.9.9');
  ok('the eleventh is turned away without being checked', stopped.status === 429, String(stopped.status));
  ok('and the refusal says nothing about the account',
    !/email|password|user|exist/i.test(stopped.body.error), stopped.body.error);

  /* An unknown address is stopped too, because the email has run out of tries
     on its own — otherwise a handful of proxies undoes the whole thing. */
  const elsewhere = await call('/account/in', { email: 'target@example.com', password: 'wrong' }, '5.5.5.5');
  ok('and moving to another address does not reset it', elsewhere.status === 429, String(elsewhere.status));

  /* A different account from that second address is unaffected: the limit is
     about this email and that address, not about the service being closed. */
  const other = await call('/account/in', { email: 'nobody@example.com', password: 'wrong' }, '5.5.5.5');
  ok('while a different email from there is still served', other.status === 401, String(other.status));

  // forgetting your password twice and then remembering it is not an attack
  const soft = 'forgetful@example.com';
  await call('/account/new', { email: soft, username: 'forgetful', password: 'hunter2hunter2' });
  for (let i = 0; i < 3; i++) await call('/account/in', { email: soft, password: 'nope' + i }, '7.7.7.7');
  const remembered = await call('/account/in', { email: soft, password: 'hunter2hunter2' }, '7.7.7.7');
  ok('remembering it after a few tries works', remembered.body.ok === true, remembered.body.error);
  ok('and clears that email\'s count', !DB._throttle.has('in:em:' + soft));

  // making accounts in bulk from one address
  let made = 0, refused = null;
  for (let i = 0; i < 8; i++) {
    const r = await call('/account/new',
      { email: `bulk${i}@example.com`, username: `bulk${i}`, password: 'hunter2hunter2' }, '3.3.3.3');
    if (r.body.ok) made++; else refused = r;
  }
  ok('accounts cannot be made from one address without end', made === 5, `${made} made`);
  ok('and the sixth is told to come back later', refused && refused.status === 429,
    refused && String(refused.status));
}

console.log('\npasswords');
{
  const em = 'pw@example.com';
  const made = await call('/account/new', { email: em, username: 'pwuser', password: 'hunter2hunter2' });
  const tok = made.body.token;

  const wrongNow = await call('/account/password',
    { token: tok, password: 'not-it-at-all', next: 'brandnewpassword' });
  ok('changing a password needs the current one', wrongNow.status === 401, wrongNow.body.error);

  const tooShort = await call('/account/password',
    { token: tok, password: 'hunter2hunter2', next: 'short' });
  ok('and the new one has to be long enough', !tooShort.body.ok);

  const changed = await call('/account/password',
    { token: tok, password: 'hunter2hunter2', next: 'brandnewpassword' });
  ok('with both, it changes', changed.body.ok === true, changed.body.error);
  ok('the old password stops working',
    (await call('/account/in', { email: em, password: 'hunter2hunter2' })).status === 401);
  ok('and the new one works', (await call('/account/in', { email: em, password: 'brandnewpassword' })).body.ok === true);
  /* Changing it because you fancy a better one should not sign out your phone. */
  ok('other devices stay signed in', (await call('/vault/get', { token: tok })).body.ok === true);

  /* ---- forgetting one ----
     **The password must not change unless the message actually went.** This was
     written the other way round — reset first, post second — so on a server
     with no mail provider every press was a silent, permanent lockout: the old
     password stopped working and the new one existed only in a discarded
     variable. It locked out the first person who used it. These checks exist so
     that ordering can never be quietly reversed again. */
  MAIL = null;
  const noMail = await call('/account/forgot', { email: em }, '8.8.8.8');
  ok('with no way to send, a reset says so rather than pretending',
    noMail.status === 501 && /not set up/i.test(noMail.body.error), noMail.body.error);
  ok('and above all it does not touch the password',
    (await call('/account/in', { email: em, password: 'brandnewpassword' })).body.ok === true);

  MAIL = { ok: false };       // configured, but the send fails
  const failed = await call('/account/forgot', { email: em }, '8.8.8.7');
  ok('a send that fails is not a reset either', failed.body.ok === true);
  ok('and the old password still works after it',
    (await call('/account/in', { email: em, password: 'brandnewpassword' })).body.ok === true,
    'LOCKED OUT — the reset ran before the mail went');

  /* The failed attempt still handed a message to the provider before the
     provider refused it — so the record has to be cleared, or the checks below
     read the password from the reset that never happened. */
  sentMail.length = 0;
  MAIL = { ok: true };
  /* The reply must not differ between a real address and a stranger, or this
     becomes a way to ask which emails are registered here. */
  const known = await call('/account/forgot', { email: em }, '8.8.8.6');
  const unknown = await call('/account/forgot', { email: 'nobody-at-all@example.com' }, '8.8.8.5');
  ok('a real address and a stranger get the same answer',
    known.status === unknown.status && JSON.stringify(known.body) === JSON.stringify(unknown.body),
    `${known.status} ${JSON.stringify(known.body)} vs ${unknown.status} ${JSON.stringify(unknown.body)}`);
  ok('and only the real one is written to', sentMail.length === 1 && sentMail[0].to === em,
    JSON.stringify(sentMail.map((m) => m.to)));
  ok('the new password is in the message', /[a-z]{4}-[a-z]{4}-\d{3}/.test(sentMail[0].text),
    sentMail[0].text.slice(0, 60));

  const fresh = (sentMail[0].text.match(/[a-z]{4}-[a-z]{4}-\d{3}/) || [])[0];
  ok('now the old password has stopped working',
    (await call('/account/in', { email: em, password: 'brandnewpassword' })).status === 401);
  ok('and the one that was sent gets you in',
    (await call('/account/in', { email: em, password: fresh })).body.ok === true);
  ok('and everything that was signed in is signed out',
    (await call('/vault/get', { token: tok })).status === 401);

  ok('a reset cannot be fired at somebody over and over', await (async () => {
    for (let i = 0; i < 6; i++) await call('/account/forgot', { email: em }, '4.4.4.4');
    return (DB._throttle.get('forgot:em:' + em) || {}).n >= 5;
  })());
  MAIL = null;
}

/* ---------- a code turned back into a name ----------

   **The hash exists twice and must agree.** `codeForName` in accounts.js and
   `syncCodeFor` in src/js/29-sync.js are the same function written out twice,
   and a code is derived from a username, so a drift in either does not throw —
   it quietly answers with somebody else's name, or with nobody. The client's
   copy is read out of the source here rather than restated, so the check
   compares the two that actually ship.

   The alphabet was wrong the first time this endpoint was written, which is
   exactly the failure this catches. */
{
  const src = readFileSync(new URL('../src/js/29-sync.js', import.meta.url), 'utf8');
  const alpha = (src.match(/SYNC_ALPHABET\s*=\s*'([^']+)'/) || [])[1];
  const body = (src.match(/function syncCodeFor\(name\)\{([\s\S]*?)\n  \}/) || [])[1];
  ok('the client hash was found in the source', !!alpha && !!body, `${alpha} / ${!!body}`);
  const clientCode = new Function('SYNC_ALPHABET', 'name', body + '\n');
  const names = ['hashir', 'sam', 'noor', 'a', 'zz9', 'a-very-long-username'];
  const same = names.every((n) => clientCode(alpha, n) === codeForName(n));
  ok('the server derives the same code from a name as the app does', same,
    names.map((n) => `${n}:${clientCode(alpha, n)}/${codeForName(n)}`).join(' '));

  const r = await call('/account/who', { code: codeForName('whoami') });
  ok('a code nobody owns resolves to nothing', r.body.ok === true && !r.body.name,
    JSON.stringify(r.body));
  await call('/account/new', { email: 'who@x.co', username: 'whoami', password: 'correct horse b' });
  const r2 = await call('/account/who', { code: codeForName('whoami') });
  ok('and a real one comes back as the username', r2.body.name === 'whoami', JSON.stringify(r2.body));
  const r3 = await call('/account/who', { code: 'X' });
  ok('a code too short to be one is refused quietly', r3.body.ok === true && !r3.body.name,
    JSON.stringify(r3.body));
}

console.log('\n' + pass + '/' + (pass + fails.length) + ' account checks passed');
if (fails.length) { fails.forEach((f) => console.log('   ' + f)); process.exit(1); }
