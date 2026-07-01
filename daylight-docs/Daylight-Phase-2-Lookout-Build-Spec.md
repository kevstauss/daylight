# Daylight — Phase 2 Build Spec: **Lookout** (certificate transparency watcher)
### Companion to `Daylight-PRD.md` v2 · engineering handoff for Claude Code · ships `v0.3`

**Reads.** PRD (product), Phase 0–1 spec (foundation you build on). Same rules: contracts not implementations; Code writes/runs/tests in place; verify live data, don't trust this doc's specifics blindly.

**One line.** Tap public Certificate Transparency logs so a new `.gov` subdomain — especially a `previews.`/`staging.`/`photo.`/`infra.` one — surfaces the day its cert is issued, enriched with who owns the apex (from Ledger).

**Live-data note (2026-07-01).** The fixtures below are **real** subdomains pulled from CT logs for `ndstudio.gov`. Among them: `analytics.infra.ndstudio.gov` and `cdn.infra.ndstudio.gov` (the AutoMonitor endpoints from the reporting — now visible in primary CT data), `inference.ndstudio.gov`, `genesis.assets.ndstudio.gov`, `passports.staging.ndstudio.gov`, `passport.staging.ndstudio.gov`, `freedom.previews.ndstudio.gov`, plus a large `*.previews.ndstudio.gov` set (`cio.`, `dga.`, `boardofpeace.`, `forestandrangelands.`, `hstf.`, `fbi-kirk-tipline.`, `early-careers.`). Treat each as an existence-only observation.

---

## 1. Scope & what ships
- New persistent worker `workers/lookout`; new `packages/enrich`; **DB migrates SQLite → Postgres** here (real-time ingest needs it).
- Ships: cert-history timelines (backfill), a live new-subdomain feed, subdomain-flag scoring, a **function-mimic** heuristic, and Ledger-owner enrichment. Tag `v0.3`.
- Reuses `packages/{core,db,feeds}` unchanged behind their interfaces.

## 2. Data sources
- **certstream** (real-time firehose of CT entries). Use the `certstream` client against a public server (`wss://certstream.calidog.io/`), with reconnect/backoff; it can drop — so also:
- **Nightly reconcile via crt.sh.** JSON: `https://crt.sh/?q=<apex>&output=json`. **It 502s/rate-limits under load** (confirmed today) — implement backoff + cache + an HTML-scrape fallback (`https://crt.sh/?q=<apex>` then regex `[a-z0-9._-]+\.<apex>`). Most robust backfill: the **public crt.sh Postgres** (`psql -h crt.sh -p 5432 -U guest certwatch`) for bulk history.
- **Corroboration:** Cert Spotter / Censys APIs (keyed) — optional.
- **Scope filter:** all SANs ending `.gov`, then keep those whose registrable apex ∈ watchlist `apex_domains` (or, if `FLAG_LOOKOUT_ALL_GOV`, all federal apexes from Ledger's `domains`).

## 3. Schema additions (Postgres)
```sql
CREATE TABLE subdomains (
  id BIGSERIAL PRIMARY KEY,
  fqdn TEXT UNIQUE NOT NULL,            -- lowercased
  apex TEXT NOT NULL,                   -- registrable apex (join key to domains.domain)
  first_seen TIMESTAMPTZ NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL,
  labels TEXT[],                        -- ['previews'] etc.
  flag_severity TEXT,                   -- info|notable|high
  apex_owner_org TEXT,                  -- enriched from Ledger domains.org
  apex_owner_suborg TEXT
);
CREATE INDEX ix_sub_apex ON subdomains(apex, first_seen DESC);

-- cert observations reuse the shared observations table with module='lookout':
--   payload_json = { common_name, san_list[], issuer, not_before, not_after, cert_sha256, log_source }
--   content_hash = sha256(cert_sha256) so a re-seen cert is idempotent.
```
`packages/enrich`: `ownerForApex(apex) -> {org, suborg} | null` (reads Ledger `domains`).

## 4. Core logic
1. **Backfill (one-time, ships first as 2a):** for each watched apex, pull full cert history (crt.sh Postgres or JSON w/ fallback); populate `subdomains` + cert `observations`; render per-apex timelines. Useful immediately, no stream needed.
2. **Stream (2b):** certstream → per cert, extract every SAN → filter (§2) → for each **never-before-seen** `fqdn`: insert `subdomains`, insert cert `observation`, emit `Change(kind='added')`, score flags (§5), enrich owner (`enrich.ownerForApex`).
3. **Reconcile (nightly):** re-pull crt.sh per watched apex; insert any SANs the stream missed (idempotent by `fqdn` / `content_hash`).
4. `scans` rows + `/status` health for both stream (last event age) and reconcile.

## 5. Flag scoring & heuristics
Split each `fqdn` into labels (everything left of the apex). Match against `watchlist.subdomain_flags`:
- **H1 — high-signal label** (`previews, staging, sandbox, auth, photo, photos, internal, infra, analytics, inference, upload, admin`) on a watched apex → `severity='high'`.
- **H2 — function-mimic (flagship).** A label token matches **another agency's domain/function** while sitting under a non-owning apex/infra. Build the token set from Ledger apex names (e.g. `vote`/`vote-gov`→vote.gov; `passport(s)`→travel.state.gov; `login`→login.gov; `freedom`→freedom.gov). Real hits: `vote-gov.previews.ndstudio.gov`, `passports.staging.ndstudio.gov`, `freedom.previews.ndstudio.gov`. → `severity='high'`, `reason="looks like {function} hosted under {apex} ({owner})"`.
- **H3 — collection/inference infra.** Labels `analytics`/`metrics`/`infra`/`inference` (e.g. `analytics.infra.ndstudio.gov`, `inference.ndstudio.gov`) → flag as data/inference infrastructure for a human to review; feeds a note into Floodlight/Redtape context.
- Everything else on a watched apex → `notable`; off-watchlist `.gov` → `info` (only if `FLAG_LOOKOUT_ALL_GOV`).

## 6. UI surfaces
- `/lookout` — live "new subdomains" feed (filter `?severity=high`), each item: fqdn, labels/flags, apex owner, first-seen, source (CT).
- `/{domain}` (extends Ledger's page) — cert timeline + subdomain list with flags for that apex.
- `/lookout/explorer` — searchable subdomain table across watched apexes.
- Feeds `/lookout/feed.xml` + `.json`.

## 7. Deployable sub-increments (ship each)
**2a** crt.sh backfill + timelines (static-ish, instantly useful) → **2b** Postgres migration + live certstream feed → **2c** flag scoring + H2 function-mimic + owner enrichment + alerts. Tag `v0.3` at 2c.

## 8. Fixtures & acceptance tests (use REAL subdomains)
Seed `subdomains_before` (empty) and a stream/backfill batch containing these real FQDNs:
```
cms.ndstudio.gov, previews.ndstudio.gov, passports.staging.ndstudio.gov,
freedom.previews.ndstudio.gov, analytics.infra.ndstudio.gov, cdn.infra.ndstudio.gov,
inference.ndstudio.gov, genesis.assets.ndstudio.gov, admin.ndstudio.gov,
vote-gov.previews.ndstudio.gov   # documented by reporting; the previews.* pattern is confirmed live
```
Tests:
1. **New-SAN detection:** each never-seen FQDN → one `added` change; re-running the same batch → zero new changes (idempotent by `fqdn`/`content_hash`).
2. **H1:** `passports.staging.ndstudio.gov` → `staging` label, `high`.
3. **H2 flagship:** `vote-gov.previews.ndstudio.gov` → function-mimic `high`, reason names vote.gov + owner "Executive Office of the President / White House Office" (via enrich).
4. **H3:** `analytics.infra.ndstudio.gov` → infra/analytics flag.
5. **Enrichment:** owner attached from Ledger `domains` for `ndstudio.gov`.
6. **crt.sh resilience:** on a 502/empty response, worker backs off, uses HTML fallback, and does **not** crash the scan.

## 9. Guardrails (the bright line, restated for Lookout)
CT logs tell us a subdomain **exists**. We record that and stop. **Never** issue a request to the discovered host to "confirm" it — most of these sit behind the `loveisaskill` Cloudflare Access gate, and touching them (or authenticating) is the CFAA line and would discredit the project. Honest UA; crt.sh/certstream rate-limit compliance; existence-only.

## 10. Kickoff prompt
```
Build Phase 2 (Lookout) of Daylight. Read Daylight-PRD.md, Daylight-Phase-0-1-Build-Spec.md, and
Daylight-Phase-2-Lookout-Build-Spec.md. Reuse packages/{core,db,feeds}; add workers/lookout and
packages/enrich; migrate the DB to Postgres. Ingest CT logs (certstream live + crt.sh backfill with
backoff + HTML fallback — it 502s), keep existence-only (NEVER connect to a discovered subdomain to
confirm it; many are behind a Cloudflare Access gate). Write the §8 tests first using the REAL
subdomain fixtures; H2 function-mimic must flag vote-gov.previews.ndstudio.gov as high and enrich it
with the ndstudio.gov owner from Ledger. Ship 2a→2b→2c behind flags; tag v0.3 with a plain-language
CHANGELOG entry. Ask before choosing hosting for the always-on certstream worker.
```
