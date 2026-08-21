/**
 * Focus Simulator — the mailbox.
 *
 * A Cloudflare Worker with one job: hold direct messages for somebody who isn't
 * online, until they are. Everything else in the app talks peer to peer and needs
 * nothing from a server; this exists only because two devices cannot hand a
 * message over unless both are awake at the same moment.
 *
 * It is deliberately small. No accounts, no sessions, no realtime — the app polls.
 * Three routes, all POST so that nothing secret ends up in a URL or an access log.
 *
 *   POST /send    {to, from, id, name, text, at}   queue one message
 *   POST /inbox   {code, token}                    everything waiting for me
 *   POST /ack     {code, token, ids}               I have it; delete it
 *
 * ---------------------------------------------------------------------------
 * The one security decision worth understanding
 *
 * A friend code is *not* a secret. It is the thing you hand out so people can
 * join your room, and by design it travels to everyone you have ever played
 * with. So a mailbox that returned mail to whoever knew a code would let any of
 * those people read your messages.
 *
 * Instead each device generates a long random token and keeps it locally. The
 * first time a code appears here, the server stores a SHA-256 hash of that
 * token against it — the code is claimed. From then on, only a request carrying
 * the matching token can read or delete that code's mail. Sending needs no
 * token, because anyone is allowed to write to you.
 *
 * The consequence to be aware of: if you lose your device you lose the claim.
 * Recovering it would need an account system, which is a much bigger thing than
 * this file.
 *
 * And the honest limit: mail sits here in plain text, so whoever runs the server
 * can read it. For a server you run yourself that may be fine. Making it
 * otherwise means encrypting per friend in the client and having this file only
 * ever see ciphertext — worth doing, and not done here.
 *
 * ---------------------------------------------------------------------------
 * Deploying it
 *
 *   npm install -g wrangler
 *   cd server
 *   wrangler login
 *   wrangler d1 create focus-mailbox          # copy the id into wrangler.toml
 *   wrangler d1 execute focus-mailbox --remote --file=./schema.sql
 *   wrangler deploy
 *
 * Then paste the URL it prints into Focus together → Message server.
 * Leave that field empty and the app behaves exactly as it did before: peer
 * delivery only, no server involved.
 */

const MAX_TEXT = 400;          // characters in one message
const MAX_QUEUE = 200;         // messages held for one person
const MAX_BODY = 8 * 1024;     // bytes of request body
const TTL_DAYS = 30;           // undelivered mail is not kept forever

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });

const bad = (why, status = 400) => json({ ok: false, error: why }, status);

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Codes are six characters from a fixed alphabet; anything else is not a code. */
const CODE = /^[2-9A-HJ-NP-Z]{6}$/;
const okCode = (c) => typeof c === 'string' && CODE.test(c);
const okToken = (t) => typeof t === 'string' && t.length >= 20 && t.length <= 128;

async function readBody(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/**
 * Claim `code` for `token`, or check an existing claim.
 * Returns true if this token owns the code.
 */
async function owns(db, code, token) {
  const hash = await sha256(token);
  const row = await db.prepare('SELECT token_hash FROM owners WHERE code = ?')
    .bind(code).first();
  if (!row) {
    // First time we've seen this code: whoever asks first claims it.
    await db.prepare('INSERT OR IGNORE INTO owners (code, token_hash, seen) VALUES (?, ?, ?)')
      .bind(code, hash, Date.now()).run();
    return true;
  }
  if (row.token_hash !== hash) return false;
  await db.prepare('UPDATE owners SET seen = ? WHERE code = ?').bind(Date.now(), code).run();
  return true;
}

async function send(db, b) {
  if (!okCode(b.to) || !okCode(b.from)) return bad('bad code');
  if (typeof b.id !== 'string' || !b.id || b.id.length > 64) return bad('bad id');
  if (typeof b.text !== 'string' || !b.text.trim()) return bad('empty');

  const text = b.text.slice(0, MAX_TEXT);
  const name = typeof b.name === 'string' ? b.name.slice(0, 40) : '';
  const at = Number.isFinite(b.at) ? b.at : Date.now();

  const { count } = await db.prepare('SELECT COUNT(*) AS count FROM mail WHERE to_code = ?')
    .bind(b.to).first();
  if (count >= MAX_QUEUE) return bad('their mailbox is full', 507);

  /* INSERT OR IGNORE, keyed on the message id the client generated. Delivery is
     retried whenever the app is open, and the same message may well arrive here
     twice — once because the peer attempt failed, once on the next poll. Making
     the id the primary key is what stops that showing up as a duplicate. */
  await db.prepare(
    'INSERT OR IGNORE INTO mail (id, to_code, from_code, name, text, at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(b.id, b.to, b.from, name, text, at).run();

  return json({ ok: true });
}

async function inbox(db, b) {
  if (!okCode(b.code) || !okToken(b.token)) return bad('bad code or token');
  if (!await owns(db, b.code, b.token)) return bad('that code belongs to another device', 403);

  const cutoff = Date.now() - TTL_DAYS * 86400000;
  await db.prepare('DELETE FROM mail WHERE at < ?').bind(cutoff).run();

  const { results } = await db.prepare(
    'SELECT id, from_code, name, text, at FROM mail WHERE to_code = ? ORDER BY at ASC LIMIT ?'
  ).bind(b.code, MAX_QUEUE).all();

  return json({
    ok: true,
    items: (results || []).map((r) => ({
      id: r.id, fromCode: r.from_code, name: r.name, text: r.text, at: r.at,
    })),
  });
}

async function ack(db, b) {
  if (!okCode(b.code) || !okToken(b.token)) return bad('bad code or token');
  if (!Array.isArray(b.ids) || !b.ids.length) return json({ ok: true, removed: 0 });
  if (!await owns(db, b.code, b.token)) return bad('that code belongs to another device', 403);

  const ids = b.ids.filter((i) => typeof i === 'string' && i.length <= 64).slice(0, MAX_QUEUE);
  if (!ids.length) return json({ ok: true, removed: 0 });

  const marks = ids.map(() => '?').join(',');
  const res = await db.prepare(`DELETE FROM mail WHERE to_code = ? AND id IN (${marks})`)
    .bind(b.code, ...ids).run();

  return json({ ok: true, removed: (res.meta && res.meta.changes) || 0 });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const path = new URL(request.url).pathname.replace(/\/+$/, '');
    if (path === '/health') return json({ ok: true });
    if (request.method !== 'POST') return bad('use POST', 405);
    if (!env.DB) return bad('no database bound', 500);

    const body = await readBody(request);
    if (!body || typeof body !== 'object') return bad('bad body');

    try {
      if (path === '/send') return await send(env.DB, body);
      if (path === '/inbox') return await inbox(env.DB, body);
      if (path === '/ack') return await ack(env.DB, body);
    } catch (e) {
      return bad('server error: ' + (e && e.message), 500);
    }
    return bad('no such route', 404);
  },
};
