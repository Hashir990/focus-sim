-- Focus Simulator accounts. Three tables.
--
--   accounts  one per person: email and username both unique, password hashed
--   vaults    one row per account, the whole merged snapshot as JSON
--   sessions  bearer tokens, stored as hashes so the table is not a key ring
--
-- See ACCOUNTS.md for why the snapshot is one blob and why `rev` exists.

CREATE TABLE IF NOT EXISTS accounts (
  id         TEXT PRIMARY KEY,        -- opaque; never the email
  email      TEXT NOT NULL UNIQUE,    -- lowercased and trimmed before storing
  username   TEXT NOT NULL UNIQUE,    -- what other people see
  pass_hash  TEXT NOT NULL,           -- PBKDF2-HMAC-SHA256, 210k rounds
  pass_salt  TEXT NOT NULL,
  made       INTEGER NOT NULL,
  seen       INTEGER
);

-- Case-insensitive uniqueness for the name people type, while keeping whatever
-- capitals they chose. The UNIQUE above is exact; this is the one that matters.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_user ON accounts (lower(username));

CREATE TABLE IF NOT EXISTS vaults (
  account   TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  snapshot  TEXT NOT NULL,            -- {log, own, claimed, feats, adjust, sim}
  rev       INTEGER NOT NULL,         -- bumped on every write
  at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,        -- sha-256 of the bearer token
  account    TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  made       INTEGER NOT NULL,
  seen       INTEGER
);

CREATE INDEX IF NOT EXISTS sessions_acct ON sessions (account);

-- Failed sign-ins and new accounts, counted per address and per email inside a
-- moving window. Without this, `/account/in` is an open guessing machine: the
-- password hash is deliberately expensive, which protects a stolen database but
-- does nothing about somebody working through a list against the live endpoint.
-- Rows are dropped once their window has passed rather than swept on a timer —
-- there is no cron here and a stale row costs one integer.
CREATE TABLE IF NOT EXISTS throttle (
  k      TEXT PRIMARY KEY,          -- 'in:ip:1.2.3.4', 'in:em:a@b.com', 'new:ip:…'
  n      INTEGER NOT NULL,
  until  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS throttle_until ON throttle (until);
