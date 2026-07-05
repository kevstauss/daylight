-- 008: the Redtape researcher's INTERNAL per-run recommendation for the human reviewer
-- ("Publish / Reject / reclassify to X — one line why"). Distinct from:
--   fact_vs_inference_notes  — the model's neutral finding (PUBLIC when published)
--   reviewer_note            — the human's curated note/draft (PUBLIC when published)
-- agent_recommendation is shown on /review to guide the decision but is NEVER rendered on the
-- public /redtape path. Nullable + additive; the runtime also applies this idempotently in
-- client.ts (applyAdditiveColumns).
ALTER TABLE gaps ADD COLUMN agent_recommendation TEXT;
