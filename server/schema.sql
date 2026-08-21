-- Focus Simulator mailbox. Two tables, no accounts.
--
--   owners  which device may read a code's mail (see the note in mailbox.js)
--   mail    what is waiting, keyed by the id the client generated so that a
--           retried delivery cannot become a duplicate

CREATE TABLE IF NOT EXISTS owners (
  code       TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  seen       INTEGER
);

CREATE TABLE IF NOT EXISTS mail (
  id        TEXT PRIMARY KEY,
  to_code   TEXT NOT NULL,
  from_code TEXT NOT NULL,
  name      TEXT,
  text      TEXT NOT NULL,
  at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS mail_to  ON mail (to_code, at);
CREATE INDEX IF NOT EXISTS mail_age ON mail (at);
