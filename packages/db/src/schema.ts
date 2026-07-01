// Runtime source of truth for the schema (bundler-safe string; mirrors
// migrations/001_init.sql). Applied idempotently on every connection open.

export const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS domains (
  id INTEGER PRIMARY KEY,
  domain TEXT UNIQUE NOT NULL,
  domain_type TEXT,
  org TEXT,
  suborg TEXT,
  city TEXT,
  state TEXT,
  security_contact_email TEXT,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY,
  module TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER,
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
  UNIQUE(module, domain, content_hash)
);
CREATE INDEX IF NOT EXISTS ix_obs_domain ON observations(module, domain, observed_at);

CREATE TABLE IF NOT EXISTS changes (
  id INTEGER PRIMARY KEY,
  module TEXT NOT NULL,
  domain TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  severity TEXT NOT NULL,
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

-- Lookout (Phase 2): subdomains seen in Certificate Transparency logs. Existence-only.
-- (Postgres uses TEXT[] for labels; SQLite stores a JSON array in a TEXT column.)
CREATE TABLE IF NOT EXISTS subdomains (
  id INTEGER PRIMARY KEY,
  fqdn TEXT UNIQUE NOT NULL,           -- lowercased
  apex TEXT NOT NULL,                  -- registrable apex (join key to domains.domain)
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  labels TEXT,                         -- JSON array of labels left of the apex
  flag_severity TEXT,                  -- info|notable|high
  flag_reason TEXT,
  apex_owner_org TEXT,                 -- enriched from Ledger domains.org
  apex_owner_suborg TEXT
);
CREATE INDEX IF NOT EXISTS ix_sub_apex ON subdomains(apex, first_seen DESC);

-- Floodlight (Phase 3): latest tracker scorecard per public URL (history in observations).
CREATE TABLE IF NOT EXISTS scorecards (
  id INTEGER PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,
  domain TEXT NOT NULL,
  scanned_at TEXT NOT NULL,
  tracker_count INTEGER,
  session_replay INTEGER,             -- 0/1
  first_party_proxied INTEGER,        -- 0/1
  privacy_notice_url TEXT,            -- null = absent
  request_count INTEGER,
  engine_version TEXT,
  severity TEXT,
  trackers_json TEXT,                 -- JSON array of {vendor,category,host,path,firstPartyProxied}
  reasons_json TEXT                   -- JSON array of human-readable reasons
);
CREATE INDEX IF NOT EXISTS ix_scorecard_domain ON scorecards(domain, scanned_at DESC);
`;
