-- Site Scanning breadth net. Mirrored as a string in src/schema.ts (which is the runtime source of
-- truth — this file documents the change for the eventual Postgres swap and is NOT executed).
-- Latest row of GSA's daily federal-web scan per scanned URL. Breadth infrastructure that feeds
-- Floodlight (depth); writes NO changes and has no tile/feed. Signature-based, so blind by
-- construction to the first-party reverse-proxy disguise Floodlight catches — a clean row is never
-- evidence of "no tracking". primary_scan_status carries the literal 'timeout'/error enum, so a
-- failed scan is not an absence.

CREATE TABLE IF NOT EXISTS site_scans (
  id INTEGER PRIMARY KEY,
  url TEXT UNIQUE NOT NULL,            -- the scanned final URL (idempotency + upsert key)
  domain TEXT NOT NULL,               -- registrable .gov apex (base_domain; join key to domains.domain)
  scanned_at TEXT NOT NULL,           -- scan_date from the dump
  observed_at TEXT NOT NULL,          -- when Daylight ingested this row
  source_url TEXT NOT NULL,           -- the GSA bulk-CSV URL this was read from (re-verifiable)
  primary_scan_status TEXT,           -- 'completed' | 'timeout' | 'unknown_error' | … (absence only when 'completed')
  dap INTEGER,                        -- 0/1 — Digital Analytics Program present
  ga_tag_id TEXT,                     -- the site's Google Analytics tag id (may be DAP's; null = none)
  third_party_domains_json TEXT,      -- JSON array of third-party service hostnames
  third_party_count INTEGER,
  content_hash TEXT NOT NULL          -- sha256 of the canonical scan payload
);
CREATE INDEX IF NOT EXISTS ix_sitescan_domain ON site_scans(domain, scanned_at DESC);
