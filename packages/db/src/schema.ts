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
  reason TEXT,
  source_url TEXT                      -- the exact public artifact (commit blob / crt.sh / wayback)
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
  reasons_json TEXT,                  -- JSON array of human-readable reasons
  form_fields_json TEXT               -- JSON array of normalized PII field kinds (Redtape reads this)
);
CREATE INDEX IF NOT EXISTS ix_scorecard_domain ON scorecards(domain, scanned_at DESC);

-- Receipts (Phase 4): timestamped snapshots of watched pages. The screenshot_ref points
-- into the RAW store, which is NEVER served publicly (screenshots public only post-review).
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  dom_hash TEXT,
  screenshot_ref TEXT,                -- raw-store path; never served publicly
  tracker_snapshot_json TEXT,         -- JSON array of tracker keys
  privacy_text_hash TEXT,             -- null = no privacy notice present
  form_fields_json TEXT,              -- JSON array of PII field kinds
  seal_present INTEGER,               -- 0/1
  wayback_url TEXT
);
CREATE INDEX IF NOT EXISTS ix_snap_url ON snapshots(url, captured_at DESC);

-- Redtape (Phase 5): PIA/SORN gap assessments. HARD RULE: only rows with
-- human_reviewed=1 AND published=1 are ever served publicly (enforced in the query layer).
CREATE TABLE IF NOT EXISTS gaps (
  id INTEGER PRIMARY KEY,
  domain TEXT NOT NULL,
  url TEXT,
  collects_pii_evidence_json TEXT,
  pia_found INTEGER,
  pia_refs_json TEXT,
  sorn_found INTEGER,
  sorn_refs_json TEXT,
  queries_run_json TEXT,               -- exact searches — makes the NEGATIVE checkable
  sources_checked_json TEXT,
  gap_assessment TEXT,                 -- 'no_filing' | 'incomplete_filing' | 'covered' | 'manual'
  confidence REAL,
  fact_vs_inference_notes TEXT,
  human_reviewed INTEGER DEFAULT 0,
  reviewer_note TEXT,
  published INTEGER DEFAULT 0,
  review_disposition TEXT,             -- 'published' | 'held' | 'rejected' (human decision; NULL = legacy/unreviewed)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_gaps_domain ON gaps(domain, created_at DESC);

-- Corrections/retractions ledger: a public, dated record of every time Daylight amends or
-- retracts one of its OWN published claims. Silent un-publishing would be the exact "quiet
-- removal" Receipts exists to expose, so we log it in the same feed format as everything else.
CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY,
  domain TEXT NOT NULL,
  module TEXT NOT NULL,                -- which module's claim was corrected (e.g. 'redtape')
  kind TEXT NOT NULL,                  -- 'retraction' | 'amendment'
  reason TEXT NOT NULL,                -- public, human-readable reason
  ref_id INTEGER,                      -- the gap/change id this corrects (nullable)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_corrections_feed ON corrections(created_at DESC);

-- First-party analytics (aggregate-only). One row per (day, normalized path, referrer class), a
-- running count. There is DELIBERATELY no column that could identify a visitor: no IP, no user-
-- agent, no cookie, no session id. \`path\` is a route pattern (never a raw domain/id/url) and
-- \`ref_host\` is retained ONLY for public federal .gov referrers (ref_kind='gov'); every other
-- referrer collapses to a coarse class with no host. This is the exact schema /privacy publishes
-- as proof of what Daylight keeps on its own visitors — Floodlight's standard, applied to us.
CREATE TABLE IF NOT EXISTS analytics_hits (
  day TEXT NOT NULL,                   -- UTC date, YYYY-MM-DD
  path TEXT NOT NULL,                  -- normalized route pattern (e.g. '/floodlight', '/domain/:name')
  ref_kind TEXT NOT NULL,              -- 'direct' | 'gov' | 'search' | 'other'
  ref_host TEXT NOT NULL DEFAULT '',   -- public .gov apex when ref_kind='gov', else ''
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path, ref_kind, ref_host)
);
CREATE INDEX IF NOT EXISTS ix_analytics_day ON analytics_hits(day);
`;
