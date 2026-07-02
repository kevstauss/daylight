-- 003: pin every change to the exact public artifact it was observed in, so any historical
-- change is one-click re-verifiable ("source →"). Nullable + additive; the runtime also applies
-- this idempotently in client.ts (applyAdditiveColumns) for DBs created before this migration.
--   Ledger backfill  → commit-pinned GitHub blob URL (github.com/cisagov/dotgov-data/blob/{sha}/…)
--   Ledger daily run → the daily source CSV (raw.githubusercontent.com/…/main/current-federal.csv)
--   Lookout          → the crt.sh query URL
--   Receipts         → the Wayback snapshot URL
ALTER TABLE changes ADD COLUMN source_url TEXT;
