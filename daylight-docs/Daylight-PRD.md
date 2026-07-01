# Daylight — Product Requirements Document (v2)

**Working title:** Daylight *(placeholder — swap freely; naming options in §16)*
**One-liner:** A public, always-on watchdog for federal `.gov` infrastructure — who owns it, what certificates it issues, what's tracking you on it, whether it filed the privacy paperwork the law requires, and what quietly changed or disappeared.
**Status:** Draft v2 — findings-grounded, ready for phased build + deploy.
**Build & deploy model:** Ship in dependency-ordered phases, **and deploy a usable public product at every phase** — not just at the end. Each phase (and most sub-increments within a phase) is independently useful, independently shippable, and goes live behind a version tag.

> **What changed from v1 → v2:** grounded every module in the actual documented findings (concrete seed data, real detection signatures, and a "finding this would have caught" acceptance test per module); added the **Deployment Philosophy** section making ship-at-every-phase a hard principle; added a self-contained **Context & Findings Brief**; expanded architecture with environments/CI/feature-flags/observability; added **Metrics**, **Risks & Mitigations**, a **post-v1 roadmap**, and a **Findings-to-Tests** appendix.

---

## 1. Executive summary — why this exists

In 2025–2026, a White House office called the **National Design Studio (NDS)** — created by Executive Order 14338 (Aug 21 2025), staffed largely by veterans of Elon Musk's DOGE, led by Airbnb co-founder Joe Gebbia — built or rebuilt sensitive federal websites on infrastructure the Executive Office of the President controls. Documented builds include a White House–controlled copy of `vote.gov`, a `passports.gov` portal outside the State Department, and control of `login.gov` (the identity backbone for 180M+ accounts). Two independent investigations — **The Drey Dossier** and **The Guardian** (June 28 2026) — established, using nothing but **public data**, that several of these sites ran covert visitor-tracking (a reverse-proxied PostHog install with session replay, plus a bespoke 539-line "AutoMonitor" script) and filed **none** of the privacy disclosures federal law requires (Privacy Impact Assessments under E-Gov Act §208; System of Records Notices under the Privacy Act).

The core problem Daylight solves: **that reporting was manual and episodic.** Someone had to happen to look. A staging `vote.gov` copy can appear, be used, and be torn down between the times a human checks — and the whole apparatus is deliberately engineered around *un-auditability* (a three-year statutory sunset under 5 U.S.C. §3161, plus Presidential Records Act sealing of records until ~2040, plus no inspector general inside the EOP, plus absence from USAspending).

Daylight automates the watchdog work: it turns "a reporter noticed once" into "the ledger is always watching, timestamped, diffed, and public." Everything it does is **observational and built on already-public data**. This is the lane the EFF, The Markup, and EPIC operate in.

**Design ethos:** the *data stays sober and factual*; the *attitude lives in the naming and the vibe*. Sober data is exactly what makes it legally bulletproof and press-credible.

---

## 2. Context & findings brief *(self-contained; grounds the module specs)*

This section exists so the PRD carries its own evidentiary basis. Every seed value, detection signature, and acceptance test downstream traces back to something here. Claims are tagged **[corroborated]** (both investigations and/or agency confirmation), **[single-source]** (primarily one investigator; publicly re-checkable but not yet independently re-run), or **[inference]** (reasonable but unproven).

### 2.1 The entities & people
- **National Design Studio (NDS)** — EO 14338; a §3161 "temporary organization" inside the White House Office; terminates ~3 years from creation; reports to the White House Chief of Staff; no Senate confirmation; no IG. Mission framed as redesigning ~26,000–27,000 federal web portals, with "initial results" targeted for July 4 2026. **[corroborated]**
- **Joe Gebbia** — Chief Design Officer of the United States; ex-DOGE (~6 months, OPM retirement digitization); the Cloudflare Access login gating NDS previews reads `loveisaskill.cloudflareaccess.com` ("love is a skill" = a Gebbia/Airbnb design phrase), suggesting a personal-appearing account fronting federal sites. **[single-source on the Cloudflare string]**
- **Greg Hogan** — ex-DOGE; former OPM CIO (a role a court carved out of a DOGE data-access injunction); installed as head of **Login.gov** by late April 2026. **[corroborated]**
- **Akash Bobba** — original DOGE engineer; presented an NDS-built federal **voter-registration** system (identity via Login.gov, citizenship via DHS SAVE) to state election officials (NASED/NASS, Oct 2025); listed as the **security contact for `usadf.gov`** (US African Development Foundation — an unrelated independent agency the administration tried to dissolve). On a state call he reportedly said he didn't know what data the system would retain/log. **[corroborated]**
- **Edward "Big Balls" Coristine** — NDS Head of Engineering; co-author of **Rampart**; separately tied to State's `freedom.gov`. **[corroborated]**
- **Kaitlyn Koller** (Director of Ops, ex-DOGE), **Yat Choi**, and an advisory role reportedly involving **Scott Belsky**. **[corroborated / mixed]**

### 2.2 The technical findings
- **PostHog** analytics on all four public NDS sites (`ndstudio.gov`, `trumprx.gov`, `realfood.gov`, `trumpaccounts.gov`), with **session replay** (records clicks/scrolls/keystrokes) enabled on two; configured to **reverse-proxy analytics through the government domain itself** — a documented adblocker-evasion technique. **[corroborated]**
- **"AutoMonitor"** — a 539-line bespoke script on `ndstudio.gov` that assigned each visitor a session ID and POSTed captured data to `analytics.infra.ndstudio.gov/metrics`, a host not resolvable on the public internet. Reportedly also seen on `genesis.energy.gov`. **[corroborated / genesis link single-source]**
- **No PIA / SORN** filed for the tracking layer (E-Gov Act §208; Privacy Act). The one relevant filing (a Treasury SORN for Trump Accounts) doesn't mention PostHog. NDS **removed** the tracking software the day after the Guardian sent questions (June 4 2026) — but session replay is a dashboard toggle, so removal is reversible without a code change. **[corroborated]**
- **Registrant reality:** the NDS shadow sites are registered to the **Executive Office of the President / White House Office** (not the relevant agencies); NDS spending/vendors do **not** appear in USAspending. Registrant/contact facts come from **CISA's public `cisagov/dotgov-data` repo**. **[corroborated]**
- **The `vote.gov` copy:** certificate transparency logs show `vote-gov.previews.ndstudio.gov` behind the same Cloudflare login ("Log in to vote.gov preview — For official use only"). By law (HAVA 2002) `vote.gov` belongs to the **independent, bipartisan Election Assistance Commission**, a structure Congress built after 2000 so no sitting president controls voter registration. EAC says the project is "paused"; the live `vote.gov` remains under EAC control. **[corroborated]**
- **`passports.gov`:** registered to the White House Office (State runs `travel.state.gov`); first cert May 5 2026; cert logs show `staging/auth/api` and multiple **photo** subdomains (`photo.passports.gov`, `photos.passports.gov`); sign-in page with no State seal and no privacy notice; developer test code found on the live page. **[corroborated / bulk-photo purpose is inference]**
- **Rampart** (the NDS product the user originally asked about): a genuinely open-source, on-device PII-redaction ML model (14.7MB ONNX MiniLM + regex), published on GitHub (`nationaldesignstudio/rampart`), Hugging Face, and npm (`@nationaldesignstudio/rampart`), CC BY 4.0, authored by Coristine + Tai Groot. Runs entirely in-browser; sends nothing itself. Technically legitimate and narrow; best read as reputation/recruiting messaging from an office under fire. Relevant to Daylight only as a supply-chain artifact to audit. **[corroborated]**

### 2.3 The seven leads (from the investigation), by strength
1. **White House–controlled `vote.gov` copy + Login.gov/SAVE identity+citizenship pipeline in an election year** — strong governance concern; build exists; collection/retention unproven; EAC says paused.
2. **Covert, adblocker-evading tracking with zero privacy filings** — strong proof, strong concern; removed-after-questions timing is itself telling.
3. **Personal-appearing Cloudflare account (`loveisaskill`) fronting federal sites** — single-source, specific, checkable; if accurate, a serious control failure.
4. **`passports.gov` photo-subdomain collection with no privacy notice** — strong on the site's existence; "bulk biometric" purpose is inference.
5. **Akash Bobba as `usadf.gov` security contact** — strong proof; control-creep concern is inferred.
6. **Total opacity** — no USAspending record, §3161 staffing, no IG, PRA sealing — the enabling environment.
7. **DOJ court representation vs. certificate timeline** — rhetorically strong, evidentially contested; treat as a lead, not a proven contradiction.

### 2.4 Adjacent thread (future module, not v1)
- **Genesis Mission** (`genesis.energy.gov`, EO Nov 24 2025): an NDS-designed DOE AI/data-aggregation platform pooling national-lab and federal scientific datasets, with MOUs across 24 orgs including AWS, Google, Microsoft, NVIDIA, OpenAI, Anthropic, IBM, Intel, AMD, and **Musk's xAI**. AutoMonitor reportedly appeared here too. This is a *data-lake* concern (vs. the front-end-portal concern) and deserves its own future watch. **[corroborated on MOUs; AutoMonitor link single-source]**

**How Daylight uses this:** each of §2.2's concrete artifacts becomes either seed watchlist data, a detection signature, or an acceptance test (see Appendix C, Findings-to-Tests).

---

## 3. Guiding principles

1. **Public data only.** Every source must be reachable without authentication. If it needs a login, it's out of scope.
2. **Observational only.** We record that things *exist* and how they *change*. We never interact past any access control.
3. **Reproducible & timestamped.** Every observation stores its timestamp, source URL, and content hash. Every public claim is independently checkable by a stranger.
4. **Fact / inference / speculation are always distinguished.** Especially in any AI-generated narrative and any legal-adjacent claim.
5. **Honest identity.** The bot identifies itself with a descriptive User-Agent and a contact/about URL. We respect `robots.txt`, ToS, and rate limits.
6. **Neutral presentation.** Public copy states what was observed. No accusation the data doesn't support. Let the receipts talk.
7. **Composable.** Six modules, one shared spine. Build one, prove it, compose later.
8. **Ship at every phase.** Every phase deploys a usable public product. We never accumulate value in a branch waiting for "done." (See §5.)

---

## 4. Deployment philosophy — ship a usable product at every phase

This is a hard principle, not an aspiration. The apparatus we're watching is designed to move fast and disappear; a watchdog that only goes live "when it's all finished" is useless against it. So:

### 4.1 Rules
- **Walking skeleton from Phase 0.** The very first deploy is a live (near-empty) production site + a working feed + a public methods/about page. Everything after adds to a thing that is already online.
- **Every phase ends live in production**, tagged (`v0.1`, `v0.2`, …), with a public changelog entry and a "what's new / what you can do now" note.
- **Sub-increments deploy too.** Within a phase, ship behind feature flags as soon as a slice is useful (e.g., Ledger's search UI can go live before person-watch alerts do). Prefer many small deploys over one big one.
- **Continuous deployment.** `main` is always deployable; merges to `main` auto-deploy to production after CI passes. Use flags to hide unfinished surfaces, not long-lived branches.
- **Public from Phase 1.** Phase 1 (Ledger) is the first phase real users can *use*; it goes to a public URL, not just a staging box.
- **Graceful partial state.** Any page renders cleanly when a module has no data yet ("not yet scanned / not yet watching"), so early phases don't look broken.
- **Nothing legal-adjacent auto-publishes.** Redtape's gap claims (Phase 5) deploy behind the human-approval gate; the rest can deploy continuously.

### 4.2 What is *live and usable* after each phase

| After… | Public artifact that's live | Who can use it, for what |
|--------|-----------------------------|--------------------------|
| **Phase 0** | Site shell + methods/about page + empty JSON/RSS feed endpoints + status page | Anyone: understand scope; subscribe to feeds early |
| **Phase 1 (Ledger)** | Searchable domain→owner registry + ownership-change feed + **person-watch alerts** | Reporters: subscribe to `@ndstudio.gov`; citizens: "who owns this .gov?" |
| **Phase 2 (Lookout)** | Live new-certificate / new-subdomain feed + per-domain cert timeline + flagged-subdomain alerts | Watchdogs: catch a new `*.previews.ndstudio.gov` the day it's issued |
| **Phase 3 (Floodlight)** | Per-site **tracker scorecards** + ranked hall of shame + tracker-added alerts | Everyone: "is this gov site tracking me?"; reporters: story leads |
| **Phase 4 (Receipts)** | Snapshot history w/ screenshots + the **removal ledger** + Wayback links | Reporters: dated proof; watchdogs: "what did they quietly delete?" |
| **Phase 5 (Redtape)** | Human-reviewed **PIA/SORN gap list** w/ evidence + negative-search trail | Advocates/lawyers: documented apparent filing gaps |
| **Phase 6 (Daylight)** | Unified per-domain composite dashboard | Everyone: one page — legit? who runs it? watching me? changed? |

### 4.3 Environments & release mechanics
- **Environments:** `local` → `staging` (auto-deploy on every merge) → `production` (auto-deploy on green CI, or one-click promote from staging).
- **Feature flags:** a tiny env/DB-backed flag system (`FLAG_LEDGER_PERSONWATCH`, `FLAG_FLOODLIGHT_PUBLIC`, …). No flag SaaS needed for v1.
- **Versioning & changelog:** semver-ish tags per phase/increment; a public `CHANGELOG.md` rendered at `/changelog`; each entry is human-readable ("Now watching certificate transparency logs in real time").
- **Status page:** `/status` shows each worker's last successful run + last error, and each data source's last-checked time. Transparency about our *own* uptime is part of the ethos.
- **Rollback:** deploys are immutable + tagged; rollback = re-deploy previous tag. Workers are idempotent (keyed by `content_hash`), so re-runs never double-emit.
- **Hosting posture:** cheap and boring — a VPS or Fly.io/Railway. One **always-on** worker (Lookout's certstream connection); the rest scheduled. *Self-hosting note:* this stack also runs fine on a home server behind Tailscale for the workers/DB, with only the public web app + feeds exposed — a viable low-cost option, though a public-facing civic tool generally wants cloud uptime for the read path.

---

## 5. ⚖️ Legal & ethical guardrails (NON-NEGOTIABLE)

> Hard constraints. Claude Code: treat any task that would violate these as out of scope and flag it rather than implementing it.

- **The bright line:** noting that a certificate, subdomain, or login page **exists** is fine. **Attempting to authenticate past any access wall** (e.g., a Cloudflare Access / `*.cloudflareaccess.com` gate like the `loveisaskill` one), guessing credentials, or reaching a gated staging/preview endpoint is **strictly prohibited** — potentially illegal (CFAA) and credibility-destroying. We observe the *front door*; we never try the handle.
- **No exploitation, no probing.** No port scanning, vuln scanning, fuzzing, or directory brute-forcing of live gov hosts. Subdomain *discovery* is **passive** (CT logs), never active brute-force against the target.
- **Rate-limit & ToS compliance** for every source (crt.sh, certstream, CISA repo, Wayback SPN2, Federal Register). Exponential backoff, aggressive caching, honest User-Agent. Never hammer.
- **PII restraint.** We surface *official public registrant records* (which name agency contacts by design) and public officials acting officially. We do **not** enrich, cross-reference, or aggregate personal data about individuals beyond official capacity. Home addresses, personal accounts, family = never. When in doubt, redact + flag for human review.
- **The public read-path serves reviewed/redacted data only.** The raw artifact store (which may incidentally capture something sensitive from a misconfigured page) is **never** served publicly; a redaction pass runs on ingest, and anything flagged is withheld pending human review.
- **Responsible disclosure.** If a scanner ever incidentally surfaces an exposed secret/credential/real vulnerability: **stop, do not publish, route to the affected agency / CISA** through proper channels. Not our mission, not ours to weaponize.
- **Neutral, defensible copy.** "No published Privacy Impact Assessment was found as of {date}; see searches below" — never "they broke the law."

---

## 6. The six modules at a glance

| # | Module | Watches | Core public source | Ships as (public artifact) | Lift | Phase |
|---|--------|---------|--------------------|----------------------------|------|-------|
| 1 | **Ledger** | Who *owns* .gov + security contacts, and every change | CISA `cisagov/dotgov-data` (git) | Owner search + change feed + person-watch | S | 1 |
| 2 | **Lookout** | New certs / new subdomains, near-real-time | CT logs (certstream / crt.sh) | New-subdomain feed + cert timelines | S–M | 2 |
| 3 | **Floodlight** | Trackers & session-replay on live gov sites | Live page source (Playwright) | Tracker scorecards + hall of shame | L | 3 |
| 4 | **Receipts** | Snapshots + what quietly changed/vanished | Rendered page + screenshot + Wayback | Snapshot history + removal ledger | M | 4 |
| 5 | **Redtape** | PII collection with no PIA/SORN | Federal Register API + PIA inventories | Reviewed gap list + evidence trails | M–L | 5 |
| 6 | **Daylight** | Everything, per domain | (composes 1–5) | Unified dashboard | M | 6 |

---

## 7. Shared architecture

### 7.1 Monorepo layout (TypeScript, pnpm workspaces or Turborepo)

```
daylight/
├─ apps/
│  └─ web/                 # Next.js public site + dashboard + feeds (live from Phase 0)
├─ workers/
│  ├─ ledger/             # Phase 1: registrant diff watcher
│  ├─ lookout/            # Phase 2: CT-log ingestion (persistent connection)
│  ├─ floodlight/         # Phase 3: Playwright tracker scanner
│  ├─ receipts/           # Phase 4: snapshot + removal ledger
│  └─ redtape/            # Phase 5: PIA/SORN gap-finder (+ AI agent, human gate)
├─ packages/
│  ├─ core/               # shared types, watchlist loader, hashing, timestamps, flags
│  ├─ db/                 # schema + migrations + query helpers
│  ├─ enrich/             # cross-module joins (registrant ↔ cert ↔ tracker ↔ snapshot)
│  ├─ feeds/              # RSS/Atom + JSON Feed + webhook/email emitters
│  ├─ fingerprints/       # tracker/session-replay signatures (seed: DDG Tracker Radar)
│  └─ redact/             # ingest-time PII redaction pass (guards the raw store)
├─ config/
│  └─ watchlist.yaml      # domains/patterns we watch (Appendix A)
├─ CHANGELOG.md           # rendered at /changelog
└─ PRD.md
```

**Language rationale:** one TS toolchain covers certstream clients, Playwright, and the frontend — keeps Claude Code in a single mental model. Drop to a Python worker only where a library is clearly stronger; keep the DB write-interface identical.

### 7.2 Shared data model (SQLite → Postgres at Phase 2)

The common spine every module writes to, so the dashboard composes cleanly:

```
domains(id, name UNIQUE, agency, org, registrant, first_seen, last_seen)

scans(                              -- one row per module run (for /status + provenance)
  id, module, started_at, finished_at, ok BOOL, error, items_seen, changes_emitted)

observations(
  id, domain_id, module,            -- 'ledger'|'lookout'|'floodlight'|'receipts'|'redtape'
  observed_at,                      -- UTC
  source_url,                       -- exact public source
  content_hash,                     -- sha256 of the raw captured artifact (idempotency key)
  payload_json,                     -- module-specific structured data
  raw_ref)                          -- pointer to stored raw artifact (never served publicly)

changes(
  id, domain_id, module, detected_at,
  kind,                             -- 'added'|'removed'|'modified'
  field, old_value, new_value,
  observation_before, observation_after,
  severity)                         -- 'info'|'notable'|'high'  (drives alert routing)

alerts(id, change_id, channel, target, sent_at, ok, error)

watch_subscriptions(id, kind, pattern, channel, target, created_at)
                                    -- kind: 'person'|'domain'|'subdomain_flag'

-- indexes: observations(domain_id, module, observed_at), changes(detected_at, severity),
--          domains(name), unique(observations.content_hash per module)
```

**Rule:** store the **raw artifact** next to every interpretation. Interpretations can be wrong; raw + hash + timestamp is what makes us trustworthy. The `redact` pass runs before anything from a scanned page is persisted in a servable field.

### 7.3 The watchlist (config-driven — the heart of the system)

One `watchlist.yaml` drives every module (seed in Appendix A):

```yaml
domains: [ndstudio.gov, passports.gov, trumprx.gov, realfood.gov,
          trumpaccounts.gov, usadf.gov, genesis.energy.gov, freedom.gov]
comparators:                 # legit originals, for shadow-vs-real diffs
  vote.gov: eac.gov
  passports.gov: travel.state.gov
person_watch: ["@ndstudio.gov"]     # Ledger alerts when these appear as any contact
subdomain_flags: [previews, staging, auth, api, photo, photos, admin, internal,
                  analytics, cdn, infra, metrics]
```

### 7.4 Scheduling & ingestion
- **Ledger, Redtape, Receipts, Floodlight** = scheduled batch (worker loop or platform cron).
- **Lookout** = **persistent** certstream connection (WSS) — needs a durable always-on worker with reconnect + nightly crt.sh reconciliation for gaps.
- **Idempotent by `content_hash`:** re-ingesting the same artifact emits no duplicate change.

### 7.5 CI/CD & observability
- CI: typecheck + unit tests + fixture tests per package; green `main` auto-deploys (§4.3).
- Observability: `scans` table powers `/status`; structured logs; alert on worker failure (a watchdog that silently dies is worse than none). Feature flags in `packages/core`.

### 7.6 Feeds & alerting
- One `feeds` package emits **change events** as RSS/Atom + JSON Feed (so other reporters/tools subscribe and build on us), plus optional email + Slack/Discord webhook. `severity='high'` (person-watch hits, flagged subdomains, tracker additions, removals) routes to priority channels.

---

## 8. Master data-source registry

| Source | Access | Notes / limits |
|--------|--------|----------------|
| **CISA dotgov-data** — `github.com/cisagov/dotgov-data` | Public git repo (`current-full.csv`, `current-federal.csv`) | Diff via git history = free longitudinal record. Poll daily. |
| **certstream** | Real-time WSS firehose of all CT entries | Filter to `.gov`. Persistent connection + reconnect/backfill. |
| **crt.sh** | Query API (`?q=%25.ndstudio.gov&output=json`) | Best for backfill/enumeration. Flaky under load — backoff + cache. |
| **Censys / Cert Spotter** | Cert/CT APIs (keyed) | Corroboration + fallback for crt.sh. |
| **Live page source** | Headless browser (Playwright) → *public* URLs only | Network capture via CDP. Never past auth. |
| **DuckDuckGo Tracker Radar** — `github.com/duckduckgo/tracker-radar` | Open dataset | Seed for Floodlight fingerprints; supplement w/ EasyPrivacy. |
| **Wayback Save Page Now** — `web.archive.org/save/{url}` | SPN2 API | Independent third-party archive. Respect rate limits. |
| **Federal Register API** — `federalregister.gov/api/v1` | JSON, public | SORN search for Redtape. |
| **Agency PIA inventories** | Scattered agency pages + central inventories | The messy one; normalize+match; AI-agent-assisted (Module 5). |
| **npm / GitHub / Hugging Face** | Public package + repo metadata | For the NDS Rampart supply-chain audit note (Lookout stretch). |

---

## 9. Module specifications

Each module below includes a **"Finding it would have caught"** — a real documented event from §2 that the module must be able to reproduce/detect. That doubles as its headline acceptance test.

### Module 1 — **Ledger** *(registrant & security-contact diff watcher)*

**Purpose.** Watch the public federal `.gov` registry as a *ledger over time*. Nobody watches the diffs. Registrant/contact creep is invisible unless someone tracks changes.

**Finding it would have caught.** Akash Bobba appearing as the **security contact for `usadf.gov`** — a White House staffer on the security record of an unrelated independent agency. A person-watch on his contact identity would have fired the day the CSV changed.

**User stories.**
- Reporter subscribes to `@ndstudio.gov`; gets pinged the instant that identity appears as a contact on *any* new domain.
- Citizen searches a `.gov`; sees who owns it and its full ownership history.
- Researcher subscribes to a change-feed of every registrant/contact change across the federal registry.

**Inputs.** `cisagov/dotgov-data` CSVs via scheduled `git fetch`; diff commit-to-commit.

**Schema (payload_json).** `{ registrant, agency, org, security_contact_email, domain_type }` per row; `changes` rows per field delta.

**Core logic.** (1) Fetch latest repo; parse `current-federal.csv` (+ full). (2) Diff vs last snapshot (git gives history free). (3) Emit `added`/`removed`/`modified` per domain+field. (4) Evaluate `person_watch` against every contact field → `severity='high'` alert on match.

**Cadence.** Daily.

**Ships as / deploy.** A searchable owner registry page + ownership-history timeline + change feed (RSS/JSON) + person-watch alerts. **Deployable sub-increments:** (a) importer + search UI first; (b) change feed; (c) person-watch alerts last.

**Acceptance criteria.**
- Two known historical commits → exact set of changed rows.
- A person-watch string appearing in a new commit fires exactly one alert with a source link.
- Every displayed fact links to the specific commit/row.

**Guardrails.** Read-only public repo; individuals shown only in official-contact capacity.

---

### Module 2 — **Lookout** *(certificate transparency watcher — "automated Drey")*

**Purpose.** Every `.gov` TLS cert is published to public CT logs in near-real-time. Lookout taps the stream and flags new subdomains the moment they appear — especially the tells: `previews.`, `staging.`, `auth.`, `photo(s).`, `analytics.`, `infra.`.

**Finding it would have caught.** `vote-gov.previews.ndstudio.gov` and the `photo(s).passports.gov` subdomains — surfaced on the day their certs were issued, instead of whenever a human happened to look.

**User stories.**
- Watchdog is alerted within minutes when a watched domain issues a cert for a new subdomain.
- Researcher gets a complete, timestamped cert history per watched domain, enriched with its Ledger owner.

**Inputs.** certstream (real-time) + crt.sh/Censys (backfill & corroboration).

**Schema (payload_json).** `{ common_name, san_list[], issuer, not_before, not_after, cert_sha256, log_source }`.

**Core logic.** (1) Persistent certstream; filter to `.gov` + watchlist wildcards. (2) Extract every SAN; identify never-before-seen subdomains. (3) Score against `subdomain_flags` → priority alert. (4) Enrich with Ledger registrant. (5) Nightly crt.sh reconcile for dropped events.

**Cadence.** Real-time stream + nightly reconcile.

**Ships as / deploy.** Live new-subdomain feed + per-domain cert timeline + flagged-subdomain alerts. **Sub-increments:** (a) crt.sh **backfill** timelines can ship *before* the live stream (a static-ish product immediately); (b) then the real-time certstream feed; (c) then flag scoring + alerts.

**Acceptance criteria.**
- A newly-issued cert for a watched domain surfaces in the feed within minutes.
- Flagged patterns (`previews/staging/auth/photo/...`) generate a distinct high-priority alert.
- crt.sh backfill reproduces a known domain's documented cert history.

**Stretch (supply-chain).** A one-off audit view of the NDS Rampart npm package (`@nationaldesignstudio/rampart`) / GitHub repo: does the published artifact make any network calls, or is the "runs entirely on-device" claim verifiable? Publish the finding factually.

**Guardrails.** We record that a subdomain *exists* from the public log. We do **not** connect to gated/staging endpoints to "confirm" it. Existence ≠ access.

---

### Module 3 — **Floodlight** *("Blacklight for .gov" — tracker & session-replay scanner)*

**Purpose.** The Markup built Blacklight for the open web; nobody built the `.gov` version. Floodlight visits public gov pages, captures every network request, and fingerprints third-party trackers and **session-replay** tools. This operationalizes the Guardian's finding into a continuous public check.

**Finding it would have caught.** The **reverse-proxied PostHog + session replay** across the NDS sites — and, crucially, would keep re-checking after "we removed it," since session replay is a re-enable-able dashboard toggle.

**Two differentiators over Blacklight:**
1. **Reverse-proxy disguise detection.** Flag *first-party* endpoints whose payload shape matches a known analytics SDK (the adblocker-evasion trick). Seed heuristic: a first-party path resembling PostHog's capture endpoint shape (`/e/`, `/i/v0/e/`, batched `{event, properties, distinct_id}` bodies) or an AutoMonitor-style POST of `{session_id, events[]}` to an `analytics`/`metrics`/`infra` host.
2. **Privacy-notice cross-check.** Record whether the page even *has* a linked privacy notice (the NDS sign-in pages didn't).

**User stories.**
- Citizen sees a plain scorecard: "loads N third-party trackers, session replay {on/off}, privacy notice {present/absent}."
- Reporter watches a ranked hall of shame; gets alerted when a site *adds* a tracker.
- Skeptic gets continuous re-answers to "did they actually remove it, or just toggle it off?"

**Inputs.** Live public URLs via Playwright; network capture via CDP; `packages/fingerprints`.

**Schema (payload_json).** `{ trackers[]:{vendor,category,host,first_party_proxied}, session_replay:bool, privacy_notice_url|null, request_count, scan_engine_version }`.

**Core logic.** (1) Playwright loads the public page; capture all requests + response metadata. (2) Match hosts/paths/payload signatures vs fingerprints (seed: DDG Tracker Radar + EasyPrivacy + session-replay list, Appendix B). (3) Reverse-proxy heuristic (above). (4) Detect privacy-notice link presence. (5) Rescan on schedule; emit tracker `added`/`removed` (feeds Receipts).

**Cadence.** Weekly full sweep; daily for high-priority watchlist.

**Ships as / deploy.** Per-site scorecard + ranked hall of shame + tracker-added alerts + historical tracker timeline. **Sub-increments:** (a) single-URL scorecard (even a manual "scan this URL" box) ships first and is instantly useful; (b) scheduled watchlist sweeps + hall of shame; (c) reverse-proxy heuristic; (d) change alerts.

**Acceptance criteria.**
- On a page with a known analytics tag → correct vendor + category.
- On a controlled fixture that proxies analytics first-party → `first_party_proxied=true`.
- Correct privacy-notice present/absent.
- Re-scan detects a previously-present tracker now gone.

**Guardrails.** Public pages only. No form submission, no auth, no interaction beyond load + passive capture. Honest User-Agent; respect `robots.txt`. Redact pass before persisting any page-derived text.

---

### Module 4 — **Receipts** *(snapshot archive + removal ledger — "screenshot before they delete it")*

**Purpose.** The apparatus is built to be sealed and forgotten. Independent timestamped archiving is the counter-move. Receipts snapshots watched sites (source + screenshot + Floodlight inventory) and diffs over time. Killer feature: the **removal ledger** — when something quietly disappears (a tracker pulled the day after a reporter emails; a privacy policy edited; a seal vanishing), it's captured, dated, permanent.

**Finding it would have caught.** NDS **removing the tracking software the day after the Guardian's questions** — captured as a dated `removed` event with before/after, so "we took it down" becomes "here's exactly what was there and exactly when it vanished."

**User stories.**
- Reporter has dated, court-usable proof of a page on a given date.
- Watchdog is alerted when a watched page *removes* something (tracker, privacy text, form field, seal).
- Anyone browses a chronological removal ledger.

**Inputs.** Rendered DOM + full-page screenshot (Playwright) + Floodlight payload; pushed to Wayback via SPN2 for an independent copy we don't control.

**Schema (payload_json).** `{ dom_hash, screenshot_ref, tracker_snapshot_ref, privacy_text_hash, form_fields[], wayback_url }`.

**Core logic.** (1) Snapshot watched URLs. (2) Diff vs previous: tracker add/remove, privacy-text delta, form-field delta, seal presence. (3) Classify; write `changes`; **removals** get their own prominent ledger + `severity='high'`. (4) Fire `web.archive.org/save/{url}`.

**Cadence.** Weekly; daily for high-priority; on-demand snapshot endpoint.

**Ships as / deploy.** Per-URL snapshot history w/ screenshots + the public removal ledger + removal alerts. **Sub-increments:** (a) snapshot + screenshot + Wayback push (an archive product) first; (b) diffing; (c) the removal ledger view; (d) alerts.

**Acceptance criteria.**
- Two snapshots of a changed fixture → precise human-readable diff.
- A removed tracker/privacy-clause/form-field → `removed` change with before/after.
- Each snapshot has a working Wayback URL.

**Guardrails.** Public pages only. The `redact` pass runs on ingest so no inadvertently-exposed PII is stored in servable fields; flagged items withheld pending review.

---

### Module 5 — **Redtape** *(PIA/SORN gap-finder — the EPIC violation, automated)*

**Purpose.** Automate the exact finding experts pointed at: sites collecting PII with **no** published PIA (E-Gov Act §208) or SORN (Privacy Act). Cross-reference collection evidence (from Floodlight/Receipts) against published PIAs and Federal Register SORNs; flag gaps.

**Finding it would have caught.** The NDS tracking layer running with **no PIA/SORN** — and the Trump Accounts Treasury SORN that exists but **doesn't mention PostHog** (a filed-but-incomplete case, not just a missing one).

> This module reuses your PLAINLY pattern: an **AI research agent behind a human-approval gate**, because PIA/SORN data is semi-structured and scattered.

**User stories.**
- Advocate sees gov sites that appear to collect PII with no matching published PIA/SORN as of a date.
- Lawyer sees, per flag, (a) the collection evidence and (b) the exact searches that found *no* filing — so the negative is checkable.

**Inputs.** Federal Register API (SORNs); agency PIA inventories (scrape+normalize); Floodlight/Receipts form-field + tracking evidence.

**Schema (payload_json).** `{ collects_pii_evidence[], pia_found, pia_refs[], sorn_found, sorn_refs[], gap_assessment, confidence, human_reviewed, reviewer_note }`.

**Core logic.** (1) Candidates = watchlist sites where collection was detected. (2) AI agent searches Federal Register + PIA inventories; returns refs **or** a documented "no filing found" with the exact queries run. (3) **Human approval gate** — no gap publishes until reviewed; agent output always labeled fact vs inference. (4) Publish only human-approved gaps, each with collection evidence + negative-search trail.

**Cadence.** On new collection detected + monthly re-sweep.

**Ships as / deploy.** Reviewed gap list + per-site filing status + negative-evidence trails. **Deploy note:** the review queue/tooling can be an internal-only deploy first; only human-approved items become public. This is the one module whose public surface is gated by a human, by design.

**Acceptance criteria.**
- Site with a known SORN → found + linked (no false gap).
- Documented gap → collection evidence + "no filing found" query trail.
- Nothing publishes without `human_reviewed=true`.

**Guardrails.** Legal-adjacent claims → maximally careful copy ("No published PIA found as of {date}; searches below"), never "illegal." Human gate mandatory.

---

### Module 6 — **Daylight** *(unified dashboard)*

**Purpose.** The front door. Type any `.gov` → who owns it (Ledger), full cert history (Lookout), tracker scorecard (Floodlight), snapshot/removal history (Receipts), privacy-filing status (Redtape). One page answering: *legit? who runs it? watching me? changed?*

**Build last; compose proven modules.** Don't scaffold the dashboard before the data exists.

**Ships as / deploy.** Per-domain composite view + global feeds + hall of shame + removal ledger + search. Renders "not yet scanned" gracefully where a module has no data.

**Acceptance criteria.** For a seed domain, composite renders all available module data with source links + last-checked timestamps; degrades gracefully.

**Frontend note.** Pull in the `frontend-design` skill for visual direction — read as *credible civic instrument*, not partisan blog. Sober typography, receipts-forward, timestamp everything.

---

## 10. Phase plan (dependency-ordered, deploy-at-every-phase)

Every phase ends **live in production**, tagged, with a `/changelog` entry. DoD = shippable + tested + publicly useful on its own.

**Phase 0 — Foundation & walking skeleton.**
`packages/core|db|feeds|redact`, `config/watchlist.yaml`, the observation/change spine, CI + auto-deploy, `/status`, `/methods`, empty feeds. **Deploys:** a live (near-empty) production site + working feed endpoints + methods page. *DoD: a dummy module writes an observation, emits a change, and it appears in a live feed on the deployed site.*

**Phase 1 — Ledger** *(first phase real users use).*
**Deploys:** searchable owner registry + ownership-change feed + person-watch alerts, at a public URL. *DoD: daily diffing live; `@ndstudio.gov` person-watch firing; owner search usable.* Sub-increments (a→c) each deploy behind flags.

**Phase 2 — Lookout.**
Migrate DB to Postgres (real-time ingest). **Deploys:** cert-history timelines (backfill) → live new-subdomain feed → flagged-subdomain alerts, enriched with Ledger owner. Together with Ledger = a complete early-warning system (a cert says a domain *exists*; Ledger says who *owns* it). *DoD: sub-minute new-cert surfacing; flag alerts; nightly reconcile.*

**Phase 3 — Floodlight.**
The press magnet; heaviest lift. **Deploys:** "scan this URL" scorecard → scheduled watchlist sweeps + hall of shame → reverse-proxy + privacy-notice detection → tracker-change alerts. *DoD: scorecards live for seed watchlist; heuristics pass fixtures; change events flowing.*

**Phase 4 — Receipts.**
Depends on Floodlight output. **Deploys:** snapshot+screenshot+Wayback archive → diffing → removal ledger → removal alerts. *DoD: removal ledger live; Wayback links working; diffs precise.*

**Phase 5 — Redtape.**
AI agent + human gate. **Deploys:** internal review queue first → public human-reviewed gap list. *DoD: reviewed gaps live w/ evidence + negative-search trail; hard human gate enforced.*

**Phase 6 — Daylight dashboard.**
Compose all five. **Deploys:** per-domain composite + global search/feeds/hall-of-shame/removal-ledger. *DoD: composite renders with source links + timestamps; graceful partial state.*

**Per-phase deploy checklist (run every time):** green CI → migrations applied → feature flags set → `/status` shows the new worker healthy → `/changelog` entry written in plain language → tag pushed → smoke-test the public artifact → announce (feed item / short note).

---

## 11. Success metrics

- **Detection latency:** median time from a public event (new cert, registrant change, tracker add/remove) to it appearing in a Daylight feed. Target: minutes for Lookout, <24h for the batch modules.
- **Coverage:** # domains watched; # with full module coverage.
- **Leads surfaced:** # of `severity='high'` changes; # that a human confirms as newsworthy.
- **Reach/utility:** feed subscribers; unique domains searched; # of times a Receipts snapshot or Wayback link is cited externally.
- **Trust/uptime:** worker success rate on `/status`; zero guardrail violations; false-positive rate on Floodlight fingerprints and Redtape gaps (tracked and driven down).

---

## 12. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Rate-limit bans / IP blocks from a source | Backoff + cache + honest UA + a contact URL; degrade gracefully; never hammer. |
| False positives (wrong tracker ID; false "gap") | Fixture-tested fingerprints; Redtape human gate; publish evidence + let readers check; correct fast + log corrections. |
| "You're just partisan" | Sober data; neutral copy; watch *all* federal `.gov` (comparators included); publish methods + raw sources. The attitude lives in module names, not the data. |
| Legal threat / takedown pressure | Everything is public data, observational, within ToS; keep the bright line (§5); retain counsel-review of any legal-adjacent copy; document methods publicly. |
| Incidentally capturing exposed PII/secrets | `redact` pass on ingest; raw store never served; responsible-disclosure path; withhold + human-review flagged items. |
| The apparatus goes dark / sites removed | That's the point — Receipts + Wayback preserve the record; removals become the story. |
| Watchdog silently dies | `/status` + failure alerts; idempotent workers; rollback = redeploy prior tag. |
| Scope creep stalls launch | Ship-at-every-phase (§4) + flags; each increment is independently valuable. |

---

## 13. Public-facing UX principles

- **Receipts-forward:** every card shows source link + "last checked {timestamp}."
- **Scorecards, not verdicts:** green/amber/red on *observed facts* ("3 trackers, session replay on, no privacy notice"), not editorializing.
- **Feeds are first-class:** RSS/Atom + JSON so others build on us.
- **Petty in voice, sober in data:** module names carry the attitude; the numbers stay clean.
- **Methods page is permanent and prominent:** name every source, link the bot's contact, state the observational-only scope. Practicing on ourselves the transparency we ask of them.

---

## 14. Tech stack (recommended, not mandatory)

- **Monorepo:** TypeScript, pnpm workspaces (or Turborepo).
- **Frontend:** Next.js + Tailwind (`frontend-design` skill for the UI phase).
- **Workers:** Node; Playwright (Floodlight/Receipts); certstream client (Lookout, persistent).
- **DB:** SQLite → Postgres at Phase 2.
- **Feeds/alerts:** shared `feeds` package → RSS/JSON + webhook/email.
- **CI/CD:** typecheck + tests → auto-deploy `main`; feature flags in `core`.
- **Hosting:** VPS or Fly.io/Railway (one always-on worker for Lookout); self-host-behind-Tailscale viable for workers/DB with only web+feeds public.
- Drop a worker to Python only where a library is clearly better; keep the DB write-interface identical.

---

## 15. Roadmap beyond v1 (stretch)

- **Genesis Watch** — a module tracking `genesis.energy.gov` and the DOE data-aggregation program: MOU partners (incl. xAI), datasets pooled, and any tracking. A *data-lake* watch to complement the *portal* watch.
- **Public API** — expose the observation/change spine read-only so other reporters/tools query Daylight programmatically.
- **Diff-any-two-gov-sites** — a self-serve tool to compare a suspected shadow site vs its legit comparator (fields collected, trackers, seals, privacy notices).
- **Embeddable scorecard widget** — a badge reporters can drop into articles ("as of {date}, this site loaded N trackers").
- **Historical cert/registrant explorer** — deep backfill as a research dataset.

---

## 16. Open questions / decisions

1. Umbrella name — keep "Daylight" or pick from §17?
2. Alert channels for v1 — RSS only, or + email + Slack/Discord?
3. Watchlist scope — EOP-adjacent only, or all federal `.gov` (noisier, more defensible against partisanship claims)?
4. Redtape review — solo (you) or a small trusted reviewer pool?
5. Launch posture — quiet tool-first, or launch with a writeup?
6. Hosting — cloud for uptime, or self-host workers behind Tailscale with a cloud read-path?

---

## 17. Naming

**Umbrella (pick one):** Daylight · Glasshouse · Plumbline · Sunlight · Bulwark
**Modules — clean / petty:**
- Ledger — *"New Registrant Who Dis" / "The Deed Registry"*
- Lookout — *"Certified Fresh" / "New Subdomain Just Dropped"*
- Floodlight — *"The Snitch List" / "Who's Watching You Vote"*
- Receipts — *"Screenshot Before They Delete It"*
- Redtape — *"Where's the Paperwork" / "Missing Papers"*

---

## 18. Credits & attribution

- Research, threat-mapping, and this product design were developed with **Claude (Anthropic)**.
- Tooling built with **Claude Code (Anthropic)**.
- Suggested public credit line: *"Built with Claude Code. Research assisted by Claude (Anthropic)."*
- The **methods/about page** is where credit + sources + scope live together — transparency about our own tooling is part of the ethos.

> **Note on model tiers:** Anthropic's Mythos/Fable tier is **not currently publicly available** (access is suspended pending an export-control matter), so the concrete build-now path is Claude Code on the currently available models (Opus / Sonnet). Architect model-agnostically — especially Phase 5's agent — so Fable can swap in later without a rewrite. Keep the credit line factual; let the *work* carry the point rather than any claim about a vendor's institutional record.

---

## Appendix A — Seed watchlist

**Watch:** `ndstudio.gov`, `passports.gov`, `trumprx.gov`, `realfood.gov`, `trumpaccounts.gov`, `usadf.gov`, `genesis.energy.gov`, `freedom.gov`
**Comparators (legit originals):** `vote.gov` → `eac.gov`; `passports.gov` → `travel.state.gov`; login infra → `login.gov`
**Person-watch seeds:** `@ndstudio.gov` (+ any contact emails Ledger surfaces)
**Subdomain flags:** `previews`, `staging`, `auth`, `api`, `photo`, `photos`, `admin`, `internal`, `analytics`, `cdn`, `infra`, `metrics`
**Known artifacts to expect (from findings):** `vote-gov.previews.ndstudio.gov`, `photo(s).passports.gov`, `analytics.infra.ndstudio.gov`, a `*.cloudflareaccess.com` gate (observe existence only — never authenticate).

## Appendix B — Session-replay / analytics fingerprint seeds

PostHog, FullStory, Hotjar, Microsoft Clarity, Datadog RUM, LogRocket, Mouseflow, Smartlook, Contentsquare, Amplitude, Heap, Segment. Seed categories/hosts from **DuckDuckGo Tracker Radar** + **EasyPrivacy**. Add reverse-proxy payload-shape heuristics per vendor — start with the **PostHog capture shape** (`/e/`, `/i/v0/e/`; batched `{event, properties, distinct_id}` bodies) and an **AutoMonitor-style** signature (a `{session_id, events[]}` POST to an `analytics`/`metrics`/`infra` first-party host).

## Appendix C — Findings-to-Tests map *(directly grounds the build)*

| Documented finding (§2) | Module | Acceptance test |
|-------------------------|--------|-----------------|
| Bobba as `usadf.gov` security contact | Ledger | Person-watch on his contact fires exactly one alert on the CSV change. |
| `vote-gov.previews.ndstudio.gov` cert | Lookout | New-cert for this SAN surfaces in-feed + trips the `previews` flag. |
| `photo(s).passports.gov` subdomains | Lookout | Both surface; `photo` flag trips. |
| Reverse-proxied PostHog + session replay | Floodlight | Fixture with first-party-proxied capture → `first_party_proxied=true`, `session_replay=true`. |
| NDS sign-in pages lacked a privacy notice | Floodlight | Fixture without a privacy link → `privacy_notice_url=null`. |
| Tracking removed the day after questions | Receipts | Two snapshots across a removal → dated `removed` change with before/after. |
| No PIA/SORN for tracking; SORN omits PostHog | Redtape | Known-SORN site → no false gap; missing/incomplete case → gap w/ evidence + query trail. |
| EOP is registrant; absent from USAspending | Ledger/Daylight | Owner view shows EOP registrant + links the CISA row. |

## Appendix D — Glossary

- **CT (Certificate Transparency):** public append-only logs of every issued TLS cert. Public, real-time, un-hideable.
- **PIA / SORN:** Privacy Impact Assessment (E-Gov Act §208) / System of Records Notice (Privacy Act) — required disclosures before collecting PII via a federal site.
- **Session replay:** analytics that record a user's actual interactions (clicks, scrolls, sometimes keystrokes).
- **Reverse-proxy disguise:** routing third-party analytics through the site's *own* domain so adblockers don't recognize it.
- **Removal ledger:** our timestamped record of things that were present and then quietly deleted.
- **Walking skeleton:** a minimal end-to-end system, deployed early, that later work fills in.
