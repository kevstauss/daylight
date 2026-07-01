# Daylight — Phase 4 Build Spec: **Receipts** (snapshot archive + removal ledger)
### Companion to `Daylight-PRD.md` v2 · engineering handoff for Claude Code · ships `v0.5`

**One line.** Snapshot watched pages on a schedule (DOM + screenshot + Floodlight tracker inventory), diff over time, and keep a permanent, public **removal ledger** of what quietly disappeared — the counter-move to an apparatus built to be sealed and deleted.

**Flagship case it must handle.** NDS removed its tracking software the day after the Guardian's questions. Receipts turns "we took it down" into a dated `removed` event with before/after — evidence, not an escape.

---

## 1. Scope & what ships
- New worker `workers/receipts`. Reuses `core/db/feeds/redact` and Floodlight's capture. Ships: snapshot history w/ screenshots, the removal ledger, Wayback push, removal alerts. Tag `v0.5`.

## 2. Data sources
- **Rendered DOM + full-page screenshot** via Playwright (same engine as Floodlight; share the capture lib).
- **Floodlight tracker inventory** for the same URL (reuse the latest scorecard/observation).
- **Wayback Save Page Now (SPN2):** `https://web.archive.org/save/<url>` — creates an independent third-party archive we don't control. Respect rate limits; store the returned archive URL.

## 3. Schema additions
```sql
CREATE TABLE snapshots (
  id BIGSERIAL PRIMARY KEY,
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL,
  dom_hash TEXT,
  screenshot_ref TEXT,              -- blob/file path in the RAW store (never served publicly)
  tracker_snapshot_json TEXT,
  privacy_text_hash TEXT,
  form_fields_json TEXT,
  seal_present BOOLEAN,
  wayback_url TEXT
);
CREATE INDEX ix_snap_url ON snapshots(url, captured_at DESC);
-- diffs recorded in shared changes table (module='receipts'); removals get severity='high'.
```

## 4. Core logic
1. For each watched URL: capture DOM + screenshot + tracker inventory + privacy-text hash + form fields + seal presence.
2. Store the **screenshot in the raw store** (filesystem/blob). **Raw store is never served publicly** (§7).
3. Fire Wayback SPN2 save; record `wayback_url`.
4. **Diff vs previous snapshot:**
   - tracker **added/removed** (from Floodlight inventory),
   - privacy-text **changed/removed** (hash + text delta),
   - form-field **added/removed**,
   - agency **seal added/removed**.
5. Classify diffs → `changes`. **Removals** (tracker/privacy-clause/seal) → `severity='high'`, prominent in the removal ledger + alert.

## 5. UI surfaces
- `/receipts/{url}` — snapshot history timeline; each entry: date, Wayback link, what changed. **Screenshots are gated:** show DOM/text diffs + Wayback link publicly by default; a screenshot is displayed publicly only after a human-review flag clears (guards against incidentally-captured PII).
- `/receipts/removals` — the public **removal ledger**, chronological across all watched URLs ("on {date}, {url} removed {thing}; archived copy: {wayback}").
- Feeds `/receipts/feed.*` — removals + notable changes.

## 6. Deployable sub-increments
**4a** snapshot + screenshot + Wayback push (an archive product) → **4b** diffing → **4c** removal-ledger view → **4d** removal alerts. Tag `v0.5` at 4d.

## 7. Fixtures & acceptance tests
Two DOM fixtures `before.html` / `after.html` where `after` has: a tracker removed, a privacy clause removed, and a seal removed. Tests:
1. Diff yields three `removed` changes with correct before/after and `severity='high'`.
2. Each appears in `/receipts/removals` with a (mocked-in-CI) Wayback URL.
3. A no-change re-capture emits zero changes (idempotent by `dom_hash`).
4. `redact` runs on captured text before persistence; the public route never serves a raw screenshot ref.
5. Wayback SPN2 is **mocked in CI** (never hit the live API in tests); a real smoke test runs only in a manual/staging job with rate-limit respect.

## 8. Guardrails
- Public pages only; same load-only rules as Floodlight; never follow a gated wall.
- **Raw store (screenshots/DOM) never served publicly**; `redact` on ingest; screenshots public only post human-review.
- Responsible disclosure for any incidentally-captured secret.
- Wayback rate-limit compliance; honest UA.

## 9. Kickoff prompt
```
Build Phase 4 (Receipts) of Daylight. Read the PRD + prior specs + this file. New worker
workers/receipts, reusing Floodlight's Playwright capture. Snapshot watched public URLs (DOM +
screenshot + tracker inventory), push each to Wayback SPN2, and diff over time — removals of
trackers/privacy-clauses/seals are the flagship signal (severity=high) and populate a public removal
ledger. Raw store (screenshots) is NEVER served publicly; screenshots go public only after a human
review flag; run redact on ingest. Write §7 tests first (mock Wayback in CI). Ship 4a→4d behind
flags; tag v0.5 with a CHANGELOG entry.
```
