-- Promotion queue for the Site Scanning breadth net. Mirrored as a string in src/schema.ts (the
-- runtime source of truth — this file documents the change and is NOT executed).
-- .gov apexes Site Scanning flagged for a full Floodlight pass because a new, non-benign third party
-- (or the site's own GA, distinct from DAP) appeared. The only new writable "candidate" table
-- (recentlyAddedDomains/keptWatchDomains are derived); sweepTargets() unions promotedWatchDomains()
-- so a flagged site gets browser-accurate inspection rather than being trusted on the signature scan.

CREATE TABLE IF NOT EXISTS promotion_candidates (
  id INTEGER PRIMARY KEY,
  domain TEXT UNIQUE NOT NULL,        -- registrable .gov apex to add to the sweep
  reason TEXT NOT NULL,               -- human-readable ("GSA Site Scanning: new third party <host> on <url>")
  source_url TEXT NOT NULL,           -- the GSA scan URL evidence (re-verifiable)
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_promotion_last ON promotion_candidates(last_seen DESC);
