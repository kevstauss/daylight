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
  settled INTEGER,                    -- 1 = the capture finished loading. A diff may only infer
                                      -- ABSENCE when BOTH sides settled; NULL = unknown.
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
  privacy_hash_kind TEXT,             -- 'url' | 'text': WHICH measurement the hash holds. A URL
                                      -- hash and a text hash always differ; comparing them across
                                      -- captures published 38 false "notice text changed" events.
  form_fields_json TEXT,              -- JSON array of PII field kinds
  seal_present INTEGER,               -- 0/1
  redirect_target TEXT,               -- off-domain final URL if the page redirected elsewhere (else NULL)
  wayback_url TEXT,
  settled INTEGER                     -- 1 = page stopped fetching before we inventoried it.
                                      -- Absence is only evidence when this is 1; NULL = unknown
                                      -- (pre-dates the flag) and withholds absence claims.
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
  gap_assessment TEXT,                 -- 'no_filing' | 'incomplete_filing' | 'covered' | 'manual' (effective/published)
  model_assessment TEXT,               -- the model's ORIGINAL label, preserved when a human reclassifies (provenance; NULL = never reclassified)
  confidence REAL,
  fact_vs_inference_notes TEXT,
  agent_recommendation TEXT,           -- AI's INTERNAL per-run recommendation (Publish/Reject/reclassify + why). Shown on /review, NEVER on /redtape.
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

-- Site Scanning (breadth net): the latest row of GSA's daily federal-web scan per scanned URL.
-- This is BREADTH infrastructure feeding Floodlight (depth) — it is deliberately NOT a module: it
-- writes NO changes and has no tile/feed. Its two jobs: (1) promote an unwatched .gov into the
-- Floodlight sweep when a new third party appears (see promotion_candidates); (2) corroborate a
-- Floodlight finding against the government's own scanner. Signature-based, so it is blind by
-- construction to the first-party reverse-proxy disguise Floodlight exists to catch — a clean
-- Site-Scanning row is NEVER evidence of "no tracking". primary_scan_status carries the literal
-- 'timeout'/error enum: a failed scan is NOT an absence (mirrors the scorecards/snapshots settled rule).
CREATE TABLE IF NOT EXISTS site_scans (
  id INTEGER PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,            -- the scanned final URL (idempotency + upsert key)
  domain TEXT NOT NULL,               -- registrable .gov apex (base_domain; join key to domains.domain)
  scanned_at TEXT NOT NULL,           -- scan_date from the dump
  observed_at TEXT NOT NULL,          -- when Daylight ingested this row
  source_url TEXT NOT NULL,           -- the GSA bulk-CSV URL this was read from (re-verifiable)
  primary_scan_status TEXT,           -- 'completed' | 'timeout' | 'unknown_error' | … (absence only when 'completed')
  dap INTEGER,                        -- 0/1 — Digital Analytics Program (government-wide analytics) present
  ga_tag_id TEXT,                     -- the site's Google Analytics tag id (may be DAP's; null = none)
  third_party_domains_json TEXT,      -- JSON array of third-party service hostnames the scan saw
  third_party_count INTEGER,
  content_hash TEXT NOT NULL          -- sha256 of the canonical scan payload (cheap unchanged-row skip)
);
CREATE INDEX IF NOT EXISTS ix_sitescan_domain ON site_scans(domain, scanned_at DESC);

-- Promotion queue: .gov apexes Site Scanning flagged for a full Floodlight pass because a NEW,
-- non-benign third party (or the site's own GA, distinct from DAP) appeared. This is the ONLY new
-- writable "candidate" table (recentlyAddedDomains/keptWatchDomains are derived); sweepTargets unions
-- promotedWatchDomains() so a flagged site gets browser-accurate inspection rather than being trusted
-- on the signature scan alone. Self-limiting: a candidate drops out of promotedWatchDomains() once
-- Floodlight has produced a scorecard for it (retention then handled by keptWatchDomains).
CREATE TABLE IF NOT EXISTS promotion_candidates (
  id INTEGER PRIMARY KEY,
  domain TEXT UNIQUE NOT NULL,        -- registrable .gov apex to add to the sweep
  reason TEXT NOT NULL,               -- human-readable ("GSA Site Scanning: new third party <host> on <url>")
  source_url TEXT NOT NULL,           -- the GSA scan URL evidence (re-verifiable)
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_promotion_last ON promotion_candidates(last_seen DESC);

-- Federal GitHub org monitoring — a Lookout signal (its changes carry module='lookout'). A new repo
-- or first commit under a watched federal org is a leading indicator: code often lands before the
-- site. Existence-only, public-API reads. Keyed on GitHub's immutable numeric repo id so a RENAME is
-- never a spurious remove+add. We record but deliberately do NOT emit 'removed': a repo missing from
-- one poll can be a transient API/pagination miss, not a deletion (the false-positive discipline the
-- page-watching ledgers were rebuilt around).
CREATE TABLE IF NOT EXISTS github_repos (
  repo_id INTEGER PRIMARY KEY,        -- GitHub's immutable id (the rename-safe diff key)
  org TEXT NOT NULL,                  -- watched org login
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  html_url TEXT NOT NULL,             -- the re-verifiable public artifact (Change.sourceUrl)
  is_fork INTEGER,                    -- 0/1 — forks are not original work and never emit a change
  created_at TEXT,                    -- repo creation time (GitHub); << first_seen ⇒ likely made public
  pushed_at TEXT,                     -- last push (activity proxy)
  has_commits INTEGER,                -- 0/1 first-commit gate (size>0); a 0→1 transition emits "first commit"
  first_seen TEXT NOT NULL,           -- when Daylight first observed the repo
  last_seen TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_github_org ON github_repos(org, created_at DESC);
`;
