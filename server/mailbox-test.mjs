/**
 * Tests for the mailbox Worker.
 *
 * Runs the real `fetch` handler against an in-memory stand-in for D1 — the same
 * approach as tools/scrabble-rules-test.mjs, and for the same reason: the logic
 * worth testing is the ownership rule and the de-duplication, neither of which
 * needs a network, a deploy, or a real database to be wrong.
 *
 * The stub understands only the handful of statements mailbox.js actually issues.
 * That is deliberate — a fuller fake would be a SQL engine, and if a new query
 * appears the stub throwing is the correct outcome.
 *
 *   node server/mailbox-test.mjs
 */
import worker from './mailbox.js';

let pass = 0, fail = 0;
const ok = (label, cond, detail = '') => {
  if (cond) { pass++; console.log('  ok  ' + label); }
  else { fail++; console.log('  FAIL ' + label + (detail ? ' — ' + detail : '')); }
};

/** Just enough D1 to run this Worker. */
function fakeDB() {
  const owners = new Map();          // code -> {token_hash, seen}
  const mail = new Map();            // id -> row

  const run = (sql, args) => {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.startsWith('SELECT token_hash FROM owners')) {
      const o = owners.get(args[0]);
      return { first: o ? { token_hash: o.token_hash } : null };
    }
    if (s.startsWith('INSERT OR IGNORE INTO owners')) {
      if (!owners.has(args[0])) owners.set(args[0], { token_hash: args[1], seen: args[2] });
      return { changes: 1 };
    }
    if (s.startsWith('UPDATE owners SET seen')) {
      const o = owners.get(args[1]);
      if (o) o.seen = args[0];
      return { changes: 1 };
    }
    if (s.startsWith('SELECT COUNT(*) AS count FROM mail WHERE to_code')) {
      let n = 0;
      for (const r of mail.values()) if (r.to_code === args[0]) n++;
      return { first: { count: n } };
    }
    if (s.startsWith('INSERT OR IGNORE INTO mail')) {
      const [id, to_code, from_code, name, text, at] = args;
      if (!mail.has(id)) mail.set(id, { id, to_code, from_code, name, text, at });
      return { changes: 1 };
    }
    if (s.startsWith('DELETE FROM mail WHERE at <')) {
      let n = 0;
      for (const [k, r] of [...mail]) if (r.at < args[0]) { mail.delete(k); n++; }
      return { changes: n };
    }
    if (s.startsWith('SELECT id, from_code, name, text, at FROM mail')) {
      const rows = [...mail.values()].filter((r) => r.to_code === args[0])
        .sort((a, b) => a.at - b.at).slice(0, args[1]);
      return { results: rows };
    }
    if (s.startsWith('DELETE FROM mail WHERE to_code = ? AND id IN')) {
      const [to, ...ids] = args;
      let n = 0;
      for (const id of ids) {
        const r = mail.get(id);
        if (r && r.to_code === to) { mail.delete(id); n++; }
      }
      return { changes: n };
    }
    throw new Error('stub does not know: ' + s);
  };

  return {
    _owners: owners, _mail: mail,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() { return run(sql, args).first; },
            async all() { return { results: run(sql, args).results || [] }; },
            async run() { return { meta: { changes: run(sql, args).changes || 0 } }; },
          };
        },
        // the TTL sweep and a couple of others bind nothing
        async first() { return run(sql, []).first; },
        async all() { return { results: run(sql, []).results || [] }; },
        async run() { return { meta: { changes: run(sql, []).changes || 0 } }; },
      };
    },
  };
}

const db = fakeDB();
const call = async (path, body) => {
  const res = await worker.fetch(new Request('https://x' + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), { DB: db });
  return { status: res.status, body: await res.json() };
};

const ALICE = 'AB2CD3', BOB = 'XY9ZW8';
const aliceToken = 'a'.repeat(32), bobToken = 'b'.repeat(32);

console.log('\nsending');
{
  const r = await call('/send', { to: ALICE, from: BOB, id: 'm1', name: 'Bob', text: 'hello' });
  ok('a message is accepted', r.body.ok, JSON.stringify(r.body));
  ok('no token needed to send', r.status === 200);

  const bad1 = await call('/send', { to: 'nope', from: BOB, id: 'm2', text: 'x' });
  ok('a malformed code is refused', !bad1.body.ok, JSON.stringify(bad1.body));

  const bad2 = await call('/send', { to: ALICE, from: BOB, id: 'm3', text: '   ' });
  ok('an empty message is refused', !bad2.body.ok);

  // A long message is trimmed rather than refused; a body big enough to be an
  // attack is refused before it is even parsed.
  const long = await call('/send', { to: ALICE, from: BOB, id: 'm4', text: 'y'.repeat(1000) });
  ok('a long message is trimmed, not rejected', long.body.ok, JSON.stringify(long.body));
  ok('and stored at the cap', db._mail.get('m4').text.length === 400,
     `${db._mail.get('m4').text.length}`);
  const huge = await call('/send', { to: ALICE, from: BOB, id: 'm5', text: 'y'.repeat(20000) });
  ok('an oversized body is refused unparsed', !huge.body.ok, JSON.stringify(huge.body));
  ok('and nothing is stored for it', !db._mail.has('m5'));
}

console.log('\nreading, and who may');
{
  const r = await call('/inbox', { code: ALICE, token: aliceToken });
  ok('the owner gets their mail', r.body.ok && r.body.items.length === 2,
     JSON.stringify(r.body).slice(0, 100));
  ok('the sender is named', r.body.items[0].fromCode === BOB && r.body.items[0].name === 'Bob');
  ok('claiming a code is recorded', db._owners.has(ALICE));

  // the whole point: a friend code is public, so knowing it must not be enough
  const imposter = await call('/inbox', { code: ALICE, token: 'c'.repeat(32) });
  ok('another device with the same code is refused', imposter.status === 403,
     `${imposter.status} ${JSON.stringify(imposter.body)}`);
  ok('and told why', /another device/.test(imposter.body.error || ''), imposter.body.error);

  const again = await call('/inbox', { code: ALICE, token: aliceToken });
  ok('the real owner still gets in', again.body.ok && again.body.items.length === 2);

  const short = await call('/inbox', { code: ALICE, token: 'tiny' });
  ok('a token that could be guessed is refused outright', !short.body.ok, short.body.error);
}

console.log('\nnot delivering twice');
{
  const before = db._mail.size;
  await call('/send', { to: ALICE, from: BOB, id: 'm1', name: 'Bob', text: 'hello again' });
  ok('the same id cannot be queued twice', db._mail.size === before, `${db._mail.size}`);
  ok('and the first text is the one kept', db._mail.get('m1').text === 'hello');
}

console.log('\nacknowledging');
{
  const bad = await call('/ack', { code: ALICE, token: 'z'.repeat(32), ids: ['m1'] });
  ok('somebody else cannot delete your mail', bad.status === 403);
  ok('so it is still there', db._mail.has('m1'));

  const r = await call('/ack', { code: ALICE, token: aliceToken, ids: ['m1', 'm4'] });
  ok('the owner can clear what they have read', r.body.ok && r.body.removed === 2,
     JSON.stringify(r.body));
  ok('and it is gone', !db._mail.has('m1') && !db._mail.has('m4'));

  const empty = await call('/inbox', { code: ALICE, token: aliceToken });
  ok('the inbox is empty afterwards', empty.body.items.length === 0);

  const other = await call('/ack', { code: BOB, token: bobToken, ids: ['does-not-exist'] });
  ok('acking something that is not there is harmless', other.body.ok && other.body.removed === 0);
}

console.log('\nold mail');
{
  await call('/send', { to: BOB, from: ALICE, id: 'old', text: 'ancient', at: 1000 });
  ok('it goes in', db._mail.has('old'));
  const r = await call('/inbox', { code: BOB, token: bobToken });
  ok('anything past the time limit is swept on read', !db._mail.has('old'));
  ok('and not returned', r.body.items.every((i) => i.id !== 'old'));
}

console.log('\nthe rest of the surface');
{
  const h = await worker.fetch(new Request('https://x/health'), { DB: db });
  ok('there is a health check', h.status === 200);
  const g = await worker.fetch(new Request('https://x/inbox'), { DB: db });
  ok('GET is refused', g.status === 405);
  const o = await worker.fetch(new Request('https://x/send', { method: 'OPTIONS' }), { DB: db });
  ok('preflight is answered', o.headers.get('access-control-allow-origin') === '*');
  const n = await call('/nope', {});
  ok('an unknown route is a 404', n.status === 404);
  const nodb = await worker.fetch(new Request('https://x/send', {
    method: 'POST', body: '{}',
  }), {});
  ok('a missing database says so rather than crashing', nodb.status === 500);
}

console.log(`\n${pass}/${pass + fail} mailbox checks passed`);
process.exit(fail ? 1 : 0);
