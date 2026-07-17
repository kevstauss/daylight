-- Broadside (module 7): federal ad buys observed in a public ad library. Mirrored as a string in
-- src/schema.ts (the runtime source of truth — this file documents the change and is NOT executed).
-- Spend + impressions are BUCKETS, stored AS RANGES (min/max) — never a computed midpoint. The ad's
-- declared window (run_start/run_end; run_end NULL = still running) is kept separate from OUR
-- observation window (first_seen/last_seen) so a "quietly pulled" ad is a query, not a rewrite.
-- creative_ref points at the raw store (never served); only source_url (the ad-library permalink)
-- is public.

CREATE TABLE IF NOT EXISTS ads (
  id INTEGER PRIMARY KEY,
  ad_key TEXT UNIQUE NOT NULL,          -- '<platform>:<platform ad id>'
  platform TEXT NOT NULL,               -- 'meta' | 'google'
  domain TEXT NOT NULL,                 -- associated federal .gov apex (from config)
  advertiser TEXT,
  advertiser_id TEXT,
  funding_entity TEXT,
  spend_min INTEGER,                    -- spend bucket bounds (USD); NULL = undisclosed/open-ended
  spend_max INTEGER,
  spend_currency TEXT,
  impressions_min INTEGER,
  impressions_max INTEGER,
  run_start TEXT,                       -- the ad's OWN declared window (run_end NULL = still running)
  run_end TEXT,
  first_seen TEXT NOT NULL,             -- OUR observation window
  last_seen TEXT NOT NULL,
  creative_ref TEXT,                    -- raw store; NEVER served
  source_url TEXT,                      -- public ad-library permalink
  landing_url TEXT,
  pixel_ids_json TEXT,                  -- usually empty: the Ad Library API doesn't expose an ad's pixel id
  flag_severity TEXT,
  flag_reason TEXT
);
CREATE INDEX IF NOT EXISTS ix_ads_domain ON ads(domain, last_seen DESC);
CREATE INDEX IF NOT EXISTS ix_ads_advertiser ON ads(advertiser_id);
