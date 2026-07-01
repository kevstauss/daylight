# Daylight — Phase 6 Build Spec: **Daylight** (unified dashboard)
### Companion to `Daylight-PRD.md` v2 · engineering handoff for Claude Code · ships `v1.0`

**One line.** The front door: type any `.gov` and see who owns it (Ledger), its cert/subdomain history + flags (Lookout), its tracker scorecard (Floodlight), its snapshot/removal history (Receipts), and its privacy-filing status (Redtape) — one page answering *legit? who runs it? watching me? changed?*

**Build last; compose proven modules.** No new ingestion — this phase is composition, aggregation, and the design pass.

---

## 1. Scope & what ships
- Extend `apps/web`. No new worker. Reuses every module's tables via read helpers. Ships the composite per-domain view, global search, cross-module highlights, hall of shame, and the removal ledger — with a coherent visual system. Tag `v1.0`.

## 2. Core logic
- **Composite read** for `/{domain}`: join `domains` (Ledger) + `subdomains`/cert observations (Lookout) + `scorecards` (Floodlight) + `snapshots`/removal `changes` (Receipts) + published `gaps` (Redtape). Each section renders independently and **degrades gracefully** to "not yet scanned / not yet watching" when a module has no data.
- **Global feed aggregation:** merge module feeds into `/feed.*`, sortable by severity/recency.
- **Highlights:** recent `severity='high'` changes across all modules on the home page.

## 3. UI surfaces
- **Home** — search box + "recent high-signal" highlights + hall of shame + removal ledger + links to methods/status/changelog/feeds.
- **`/{domain}`** — the composite card. **Every claim shows a source link + "last checked {timestamp}."** Sections: Ownership & flags (incl. Ledger's contact-domain-mismatch) · Certs & subdomains (flags, function-mimic) · Tracker scorecard (session replay, reverse-proxy, privacy notice) · Snapshots & removals (with Wayback links) · Privacy filings (reviewed gaps only).
- **`/methods`** (expand) · **`/status`** (all workers + source freshness) · **`/changelog`** · global **`/feed.xml` + `/feed.json`**.
- **Data-scope discipline:** the public read path serves only reviewed/redacted data — Redtape `published AND human_reviewed`; Receipts screenshots only post-review; Lookout existence-only.

## 4. Design
Pull in the `frontend-design` skill. Target: **credible civic instrument**, not partisan blog. Sober typography, receipts-forward layout, timestamps everywhere, scorecards (green/amber/red) on **observed facts** only. The attitude lives in module names, never in the data presentation.

## 5. Deployable sub-increments
**6a** composite `/{domain}` view → **6b** home + global search + highlights → **6c** hall-of-shame + removal-ledger aggregation → **6d** design pass + polish. Tag `v1.0` at 6d.

## 6. Fixtures & acceptance tests
1. **Composition:** `/{domain}` for a seed domain with **partial** module data renders every available section and shows graceful "not yet scanned" for the rest.
2. **Provenance:** every displayed claim has a source link + a last-checked timestamp (assert none are missing).
3. **Scope gate:** the composite never surfaces an unreviewed Redtape gap or a pre-review Receipts screenshot (assert at the query layer).
4. **Search:** querying a known domain/org returns it; querying a partial term returns expected matches.
5. **Feed merge:** the global feed contains items from ≥2 modules, ordered by recency, with correct severities.

## 7. Guardrails
Read-path serves reviewed/redacted data only; neutral, dated, source-linked copy throughout; `/methods` prominent and permanent; no claim without provenance.

## 8. Success metrics (wire these up)
Expose on an internal `/metrics` (and summarize on `/status`): detection latency per module; domains watched / fully-covered; count of `high` changes and human-confirmed leads; feed subscribers; guardrail-violation count (must stay 0); Floodlight/Redtape false-positive rate.

## 9. Kickoff prompt
```
Build Phase 6 (Daylight dashboard) of Daylight — the final composition phase, ships v1.0. Read the
PRD + all prior specs + this file. Extend apps/web only (no new worker). Build the composite
/{domain} view joining Ledger+Lookout+Floodlight+Receipts+Redtape, degrading gracefully to
"not yet scanned" per missing module; every claim MUST show a source link + last-checked timestamp.
Enforce the read-path scope gate (only reviewed/published Redtape; post-review Receipts screenshots).
Use the frontend-design skill for a sober "credible civic instrument" look. Write §6 tests first
(composition, provenance-present, scope-gate, search, feed-merge). Ship 6a→6d behind flags; tag v1.0
with a CHANGELOG entry and wire up the §8 metrics.
```
