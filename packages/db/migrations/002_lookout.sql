-- Lookout (Phase 2) schema addition. Mirrored as a string in src/schema.ts.
-- Existence-only records of subdomains observed in public Certificate Transparency logs.

CREATE TABLE IF NOT EXISTS subdomains (
  id INTEGER PRIMARY KEY,
  fqdn TEXT UNIQUE NOT NULL,           -- lowercased
  apex TEXT NOT NULL,                  -- registrable apex (join key to domains.domain)
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  labels TEXT,                         -- JSON array of labels left of the apex
  flag_severity TEXT,                  -- info|notable|high
  flag_reason TEXT,
  apex_owner_org TEXT,
  apex_owner_suborg TEXT
);
CREATE INDEX IF NOT EXISTS ix_sub_apex ON subdomains(apex, first_seen DESC);
