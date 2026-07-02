-- 004: persist the PII form-field kinds a Floodlight scan detected, so Redtape can flag a form
-- collecting sensitive PII (SSN/DOB/passport/photo) with no PIA/SORN even when tracking is light —
-- the canonical E-Gov Act §208 gap. Normalized kind strings only (no raw PII). Nullable + additive;
-- also applied idempotently at runtime in client.ts (applyAdditiveColumns).
ALTER TABLE scorecards ADD COLUMN form_fields_json TEXT;
