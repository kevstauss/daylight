-- 009: track HTTP redirects. When Receipts captures a watched page and it redirects OFF its own
-- registrable domain (e.g. passports.gov -> travel.state.gov, or -> an auth wall), record the final
-- URL here. diffSnapshots emits a dated `redirect_target` change when it newly appears or changes,
-- so an EOP vanity domain quietly forwarding to another agency (or to a login wall) becomes a
-- re-verifiable event. NULL = the page served its own content (no off-domain redirect).
-- Nullable + additive; the runtime also applies this idempotently in client.ts (applyAdditiveColumns).
ALTER TABLE snapshots ADD COLUMN redirect_target TEXT;
