-- 005_analytics.sql — first-party, aggregate-only analytics for /privacy.
-- Mirrors the analytics_hits block in src/schema.ts (the runtime source of truth). Human/Postgres
-- reference only; SQLite applies schema.ts on every open. There is deliberately NO column that
-- could identify a visitor (no IP, user-agent, cookie, or session id). `path` is a normalized
-- route pattern; `ref_host` is retained only for public federal .gov referrers (ref_kind='gov').

CREATE TABLE IF NOT EXISTS analytics_hits (
  day TEXT NOT NULL,                   -- UTC date, YYYY-MM-DD
  path TEXT NOT NULL,                  -- normalized route pattern (e.g. '/floodlight', '/domain/:name')
  ref_kind TEXT NOT NULL,              -- 'direct' | 'gov' | 'search' | 'other'
  ref_host TEXT NOT NULL DEFAULT '',   -- public .gov apex when ref_kind='gov', else ''
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path, ref_kind, ref_host)
);
CREATE INDEX IF NOT EXISTS ix_analytics_day ON analytics_hits(day);
