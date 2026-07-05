-- 006: record the human's review DECISION on a gap, distinct from the published bit. Lets the
-- /review UI separate "held — revisit later" from "rejected — not a gap" (both are published=0,
-- so published alone can't tell them apart). Nullable + additive; the runtime also applies this
-- idempotently in client.ts (applyAdditiveColumns) for DBs created before this migration.
--   'published' → live on /redtape (also published=1)
--   'held'      → reviewed, kept private, flagged to revisit
--   'rejected'  → reviewed, dismissed as not a gap
--   NULL        → unreviewed, or reviewed before this column existed
ALTER TABLE gaps ADD COLUMN review_disposition TEXT;
