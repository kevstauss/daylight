# Daylight — Phase 3 Build Spec: **Floodlight** (tracker & session-replay scanner)
### Companion to `Daylight-PRD.md` v2 · engineering handoff for Claude Code · ships `v0.4`

**One line.** "Blacklight for .gov": load a public gov page in a headless browser, capture every network request, and report which third-party trackers and session-replay tools fire — plus the reverse-proxy-disguise trick and whether the page even has a privacy notice.

**Reads.** PRD + prior specs. Heaviest lift of the project. Detection signatures below are **hints to verify at build time** against authoritative sources (PostHog docs, DuckDuckGo Tracker Radar); the robust signal is payload-shape + host, not a hardcoded path.

---

## 1. Scope & what ships
- New worker `workers/floodlight`; new `packages/fingerprints`. Reuses `core/db/feeds/redact`.
- Ships: per-URL **scorecards**, a ranked **hall of shame**, reverse-proxy + session-replay + privacy-notice detection, and tracker-change events (which feed Receipts in Phase 4). Tag `v0.4`.

## 2. Data sources
- **Live public URLs** via **Playwright** (headless Chromium; capture network via CDP). Scan only: watchlist domains, their `comparators`, and user-submitted **public** URLs. No path discovery, no crawling beyond the given URL + its same-origin subresources that load naturally.
- **Fingerprints:** seed `packages/fingerprints` from **DuckDuckGo Tracker Radar** (`github.com/duckduckgo/tracker-radar`) + **EasyPrivacy**. Session-replay vendor list: PostHog, FullStory, Hotjar, Microsoft Clarity, Datadog RUM, LogRocket, Mouseflow, Smartlook, Contentsquare.

## 3. Schema additions
```sql
CREATE TABLE scorecards (
  id BIGSERIAL PRIMARY KEY,
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  scanned_at TIMESTAMPTZ NOT NULL,
  tracker_count INT,
  session_replay BOOLEAN,
  first_party_proxied BOOLEAN,
  privacy_notice_url TEXT,             -- null = absent
  request_count INT,
  engine_version TEXT
);
-- detail per request kept in observations (module='floodlight'):
--   payload_json = { trackers:[{vendor,category,host,path,first_party_proxied}], forms:[...], seal:bool }
```

## 4. Core logic
1. Playwright loads the URL (realistic viewport; wait for network-idle); record **every** request: URL, method, resource type, a **bounded sample** of POST bodies, response content-type.
2. Also capture DOM facts: presence of a linked **privacy notice** (anchor text/href heuristics), presence of an **agency seal** (img/alt heuristics), and **PII-collecting form fields** (`input[type=email|tel|password|file]`, patterns for SSN/DOB, photo upload).
3. **Classify each request** against fingerprints → `{vendor, category}`. Count third-party trackers (registrable domain ≠ page's).
4. **Session-replay detection (H2):** any session-replay vendor present, or known recording endpoints (e.g. PostHog `/s/`, FullStory `rs.fullstory.com`, Clarity `clarity.ms`, Hotjar, LogRocket). → `session_replay=true`.
5. **Reverse-proxy disguise (H1, flagship):** a **first-party** request (same registrable domain as the page) whose **path or POST-body shape** matches a known analytics SDK. Signatures to verify at build time:
   - **PostHog capture shape:** JSON body with `{event, properties{...,$session_id?}, distinct_id, api_key|token}`; common paths `/e/`, `/i/v0/e/`, `/capture/`, `/batch/`, `/decide/`, `/s/`, `/static/array.js`. A first-party host proxying these = disguise.
   - **AutoMonitor shape (grounded in real data):** POST `{session_id, events:[...]}` to a first-party `analytics|metrics|infra` host (e.g. `analytics.infra.<apex>/metrics`). → `first_party_proxied=true`, high severity.
6. **Privacy-notice cross-check (H4):** if a PII-collecting form/tracking is present **and** no privacy-notice link → flag.
7. Compute `scorecards` row; on rescan, diff vs previous → emit tracker `added`/`removed` change events (Receipts consumes these).

## 5. UI surfaces
- `/floodlight/scan` — **"scan this public URL" box** (sub-increment 3a; instantly useful, shareable).
- `/floodlight` — hall of shame ranked by severity (session replay + reverse-proxy + tracker count), each linking a scorecard.
- `/floodlight/{url}` — scorecard detail: tracker list (vendor/category/host), session-replay flag, reverse-proxy flag, privacy-notice present/absent, last scanned + engine version.
- Feeds `/floodlight/feed.*` (tracker added/removed, new high-severity scorecards).

## 6. Deployable sub-increments
**3a** single-URL scorecard box → **3b** scheduled watchlist sweeps + hall of shame → **3c** reverse-proxy (H1) + session-replay (H2) + privacy-notice (H4) heuristics → **3d** tracker-change alerts. Tag `v0.4` at 3d.

## 7. Fixtures & acceptance tests (deterministic local fixtures — do NOT hit live gov sites in CI)
Build controlled HTML fixtures served by the test harness:
- `proxy.html` — posts `{event, properties, distinct_id, api_key}` to a **same-origin** `/metrics` path → expect `first_party_proxied=true`.
- `vendor.html` — loads a known third-party analytics host from Tracker Radar → expect correct `vendor`+`category`.
- `replay.html` — hits a session-recording endpoint → expect `session_replay=true`.
- `nonotice.html` — has an email input + tracker, **no** privacy link → expect `privacy_notice_url=null` and H4 flag.
- `clean.html` — no trackers, has a privacy link → clean scorecard.
Tests assert each of the above, plus: rescan where a tracker is removed emits a `removed` change; the `redact` pass strips any PII reflected from a URL query param before persistence.

## 8. Guardrails (CRITICAL — this module touches live sites)
- **Public pages only. GET/load only. No form submission, no auth, no clicking into gated flows, no following a Cloudflare Access wall.** Passive capture of what the page loads on its own — nothing more.
- **No path discovery / no crawling.** Only the submitted/watchlisted URL and the subresources it loads naturally.
- Honest User-Agent + contact URL; respect `robots.txt`; rate-limit; backoff.
- **`redact` runs before persisting any page-derived text** (a page may reflect PII from a query param). Raw captures never served publicly.
- Responsible disclosure if a scan incidentally exposes a secret/vuln: stop, don't publish, route to the agency/CISA.

## 9. Kickoff prompt
```
Build Phase 3 (Floodlight) of Daylight. Read the PRD + prior specs + this file. New worker
workers/floodlight + packages/fingerprints (seed from DuckDuckGo Tracker Radar + EasyPrivacy).
Use Playwright to load ONLY public watchlist/comparator/user-submitted URLs; passive network capture
only — no auth, no form submit, no crawling, never follow a Cloudflare Access gate. Verify PostHog /
session-replay signatures against authoritative docs at build time; the robust signal is payload
shape + first-party host (the AutoMonitor {session_id,events[]} → analytics.infra.<apex> case is
real). Write the §7 deterministic fixture tests FIRST (proxy/vendor/replay/nonotice/clean); H1 must
flag first-party-proxied analytics. Run redact before persisting page text. Ship 3a→3d behind flags;
tag v0.4. Ask before choosing the scan scheduler/host.
```
