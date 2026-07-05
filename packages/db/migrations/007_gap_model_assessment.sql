-- 007: preserve the model's ORIGINAL gap_assessment when a human reclassifies a gap in /review.
-- The reviewer can now change the effective label (e.g. no_filing -> incomplete_filing once they
-- find a filing the Federal-Register-only agent missed). gap_assessment holds the effective label
-- that publishes; model_assessment holds what the model first concluded, so the interpretation the
-- machine produced is never silently overwritten (raw + interpretation preserved — provenance).
-- Nullable + additive; the runtime also applies this idempotently in client.ts (applyAdditiveColumns).
--   NULL  → never reclassified (the model's label and the effective label are the same)
--   value → the model's original label; gap_assessment now carries the human's reclassification
ALTER TABLE gaps ADD COLUMN model_assessment TEXT;
