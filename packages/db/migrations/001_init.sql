-- Daylight shared data spine (Phase 0-1 build spec §3.3).
-- Corrected to the REAL CISA registry columns (no `agency`/`registrant`).
-- SQLite dialect; mirrored as a string in src/schema.ts (the runtime source of truth).
-- `IF NOT EXISTS` added for idempotent open — column contract is unchanged.

CREATE TABLE IF NOT EXISTS domains (
  id INTEGER PRIMARY KEY,
  domain TEXT UNIQUE NOT NULL,          -- lowercased apex
  domain_type TEXT,
  org TEXT,
  suborg TEXT,
  city TEXT,
  state TEXT,
  security_contact_email TEXT,
  first_seen TEXT NOT NULL,             -- ISO UTC
  last_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY,
  module TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER,                           -- 0/1
  error TEXT,
  items_seen INTEGER,
  changes_emitted INTEGER
);

CREATE TABLE IF NOT EXISTS observations (
  id INTEGER PRIMARY KEY,
  module TEXT NOT NULL,
  domain TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE(module, domain, content_hash)  -- idempotency: same row never re-inserted
);
CREATE INDEX IF NOT EXISTS ix_obs_domain ON observations(module, domain, observed_at);

CREATE TABLE IF NOT EXISTS changes (
  id INTEGER PRIMARY KEY,
  module TEXT NOT NULL,
  domain TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  kind TEXT NOT NULL,                   -- added|removed|modified
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  severity TEXT NOT NULL,               -- info|notable|high
  reason TEXT
);
CREATE INDEX IF NOT EXISTS ix_changes_feed ON changes(detected_at DESC, severity);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  change_id INTEGER NOT NULL REFERENCES changes(id),
  subscription_pattern TEXT,
  channel TEXT, target TEXT,
  sent_at TEXT, ok INTEGER, error TEXT
);
CREATE INDEX IF NOT EXISTS ix_alerts_change ON alerts(change_id);

CREATE TABLE IF NOT EXISTS watch_subscriptions (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  pattern TEXT NOT NULL,
  channel TEXT, target TEXT,
  created_at TEXT NOT NULL
);
