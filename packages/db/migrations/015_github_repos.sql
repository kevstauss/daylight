-- Federal GitHub org monitoring. Mirrored as a string in src/schema.ts (the runtime source of
-- truth — this file documents the change and is NOT executed).
-- A new repo / first commit under a watched federal org is a leading indicator (code lands before
-- the site); surfaced as Lookout events (module='lookout'). Existence-only public-API reads. Keyed
-- on GitHub's immutable numeric repo id so a rename is never a spurious remove+add. Removals are
-- deliberately NOT emitted (a missing repo can be a transient API/pagination miss).

CREATE TABLE IF NOT EXISTS github_repos (
  repo_id INTEGER PRIMARY KEY,        -- GitHub's immutable id (rename-safe diff key)
  org TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  html_url TEXT NOT NULL,
  is_fork INTEGER,                    -- 0/1 — forks never emit a change
  created_at TEXT,                    -- repo creation (GitHub); << first_seen ⇒ likely made public
  pushed_at TEXT,                     -- last push (activity proxy)
  has_commits INTEGER,                -- 0/1 first-commit gate; a 0→1 transition emits "first commit"
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_github_org ON github_repos(org, created_at DESC);
