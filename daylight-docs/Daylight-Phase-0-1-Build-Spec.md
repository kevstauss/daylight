# Daylight — Phase 0 & Phase 1 Build Spec
### Companion to `Daylight-PRD.md` (v2) · engineering handoff for Claude Code

**How to use this doc.** The PRD holds the *product* decisions. This holds the *engineering* decisions for the first two phases — the ones that are expensive to change once code exists (schema, diff semantics, matching rules, acceptance tests). **Everything here is meant to be implemented by Claude Code against a live repo**, not copy-pasted. The code blocks are *contracts* (types, DDL, signatures, test cases), not implementations — Code writes the real code, runs it, and tests it in place.

**Recommendation (the "your call"):** hand the implementation to Claude Code. It can scaffold, run `pnpm`, iterate against the real `cisagov/dotgov-data` CSVs, run tests, and deploy — all things a markdown file can't. Use the kickoff prompt in §7 to start it. *(If you'd rather I scaffold Phase 0 here first, I can — I have node + a filesystem in this session — but your repo, where Code can deploy and iterate, is the better home for it.)*

**Verified against live data on 2026-07-01.** Column names, watchlist rows, and the fixtures below were pulled from the live CISA repo, not recalled. Instruct Code to re-verify the header at build time anyway (see §6.1) — this dataset drifts, and "verify, don't assume" is the whole ethos.

---

## 0. Corrections to PRD v2 (from the live pull — apply these)

1. **The registry schema has no `agency` or `registrant` column.** Real columns are: `Domain name, Domain type, Organization name, Suborganization name, City, State, Security contact email`. "Who owns it" = `Organization name` + `Suborganization name` + `Domain type`; the person-watch signal lives in `Security contact email`. The DB schema in §3.3 supersedes the PRD's `domains` table.
2. **`trumpaccounts.gov` is `Department of the Treasury`,** not the White House Office. (Resolves PRD §11 open item.)
3. **The dataset is apex `.gov` domains only.** `genesis.energy.gov` and `vote-gov.previews.ndstudio.gov` are **not** in it — subdomains are **Lookout's** beat (CT logs), not Ledger's. This sharpens the module boundary: Ledger watches *ownership of apex domains*; Lookout watches *subdomains appearing*.
4. **The `usadf.gov` finding is now primary-source-verified** (contact = `akash@ndstudio.gov`), so it's promoted from `[single-source]` to a confirmed fixture and a first-class acceptance test.

---

## 1. Scope of these two phases

- **Phase 0 — Foundation & walking skeleton.** A live, near-empty production site with working feeds, a methods page, a status page, and the shared packages. Ends deployed and tagged `v0.1`.
- **Phase 1 — Ledger.** The registrant/contact watcher. Ends deployed and tagged `v0.2` with a searchable owner registry, a change feed, ownership heuristics, and person/org watches. This is the first phase real users *use*.

Both ship in deployable sub-increments (§4.7, §5.9).

---

## 2. Tech decisions (locked for these phases)

- **Monorepo:** TypeScript, pnpm workspaces. (Turborepo optional; not required for two phases.)
- **DB:** SQLite via **better-sqlite3** for Phase 0–1 (synchronous, zero-infra, perfect for a daily batch). Access through a thin `packages/db` so Phase 2 can swap to Postgres without touching callers. *Optional:* Drizzle ORM if Code prefers typed migrations SQLite→Postgres; either is fine as long as the query surface in §3.4 is preserved.
- **Web:** Next.js (App Router) + Tailwind. Server components read the DB directly (same host) for v1.
- **CSV parsing:** a real parser (e.g. `papaparse` or `csv-parse`) — **never** `split(',')`; org names and future fields may be quoted.
- **Feeds:** hand-rolled RSS/Atom + JSON Feed in `packages/feeds` (no heavy dep needed).
- **Scheduling:** platform cron (or a `node-cron` loop) invoking the Ledger worker daily.
- **Deploy:** green CI (`typecheck` + `test`) → auto-deploy `main`. Feature flags gate unfinished surfaces.

---

## 3. Phase 0 — Foundation

### 3.1 Package layout (create these; leave later workers as stubs)
```
daylight/
├─ apps/web/                 # Next.js: /, /methods, /status, /changelog, /feed.xml, /feed.json
├─ workers/
│  ├─ _dummy/               # Phase 0 only: writes 1 observation + 1 change (DoD)
│  └─ ledger/               # Phase 1
├─ packages/
│  ├─ core/                 # types, watchlist loader, hashing, time, flags
│  ├─ db/                   # schema + migrations + query helpers (better-sqlite3)
│  ├─ feeds/                # rss/atom/json-feed renderers
│  └─ redact/               # ingest-time PII redaction (pass-through for CSV data; real by Phase 3)
├─ config/watchlist.yaml
├─ CHANGELOG.md             # rendered at /changelog
└─ (PRD.md, this spec)
```

### 3.2 Type contracts (`packages/core`) — the seam between packages
```ts
export type Module = 'ledger'|'lookout'|'floodlight'|'receipts'|'redtape';
export type ChangeKind = 'added'|'removed'|'modified';
export type Severity = 'info'|'notable'|'high';

export interface DomainRecord {          // normalized registry row (see §6.2)
  domain: string;                        // lowercased, apex, e.g. "usadf.gov"
  domainType: string;                    // e.g. "Federal - Executive"
  org: string;                           // Organization name
  suborg: string | null;                 // Suborganization name ('' -> null)
  city: string | null;
  state: string | null;
  securityContactEmail: string | null;   // '(blank)' / '' -> null
}

export interface Observation {
  module: Module;
  domain: string;
  observedAt: string;                    // ISO UTC
  sourceUrl: string;
  contentHash: string;                   // sha256 of canonicalized payload (idempotency key)
  payload: unknown;                      // module-specific (DomainRecord for ledger)
}

export interface Change {
  module: Module;
  domain: string;
  detectedAt: string;                    // ISO UTC
  kind: ChangeKind;
  field?: string;                        // for 'modified'
  oldValue?: string | null;
  newValue?: string | null;
  severity: Severity;
  reason?: string;                       // human-readable ("security contact changed to @ndstudio.gov")
}

export interface WatchSubscription {
  kind: 'person'|'org'|'suborg'|'domain'|'subdomain_flag';
  pattern: string;                       // e.g. "@ndstudio.gov", "Department of Government Efficiency"
  channel?: 'feed'|'email'|'webhook';
  target?: string;
}
```
Also in `core`: `loadWatchlist(path): Watchlist`, `sha256(s: string): string`, `nowIso(): string`, and a trivial flag helper `flag(name): boolean` (env-backed, e.g. `FLAG_LEDGER_PERSONWATCH=1`).

### 3.3 DB schema (`packages/db/migrations`) — SQLite DDL, corrected to real columns
```sql
CREATE TABLE domains (
  id INTEGER PRIMARY KEY,
  domain TEXT UNIQUE NOT NULL,          -- lowercased apex
  domain_type TEXT,
  org TEXT,
  suborg TEXT,
  city TEXT,
  state TEXT,
  security_contact_email TEXT,
  first_seen TEXT NOT NULL,             -- ISO UTC
  last_seen TEXT NOT NULL
);

CREATE TABLE scans (
  id INTEGER PRIMARY KEY,
  module TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER,                           -- 0/1
  error TEXT,
  items_seen INTEGER,
  changes_emitted INTEGER
);

CREATE TABLE observations (
  id INTEGER PRIMARY KEY,
  module TEXT NOT NULL,
  domain TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  source_url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  UNIQUE(module, domain, content_hash)  -- idempotency: same row never re-inserted
);
CREATE INDEX ix_obs_domain ON observations(module, domain, observed_at);

CREATE TABLE changes (
  id INTEGER PRIMARY KEY,
  module TEXT NOT NULL,
  domain TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  kind TEXT NOT NULL,                   -- added|removed|modified
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  severity TEXT NOT NULL,               -- info|notable|high
  reason TEXT
);
CREATE INDEX ix_changes_feed ON changes(detected_at DESC, severity);

CREATE TABLE alerts (
  id INTEGER PRIMARY KEY,
  change_id INTEGER NOT NULL REFERENCES changes(id),
  subscription_pattern TEXT,
  channel TEXT, target TEXT,
  sent_at TEXT, ok INTEGER, error TEXT
);

CREATE TABLE watch_subscriptions (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  pattern TEXT NOT NULL,
  channel TEXT, target TEXT,
  created_at TEXT NOT NULL
);
```

### 3.4 `packages/db` query surface (keep stable across the SQLite→Postgres swap)
`upsertDomain(rec, seenAt)`, `getDomain(name)`, `searchDomains({q, org, suborg, contact})`, `insertObservation(obs)`, `latestObservation(module, domain)`, `insertChange(change)`, `listChanges({since, severity, module, limit})`, `domainHistory(name)`, `recordScanStart/Finish(...)`, `getStatus()`.

### 3.5 `packages/feeds` contract
`renderRss(changes: Change[], meta): string` and `renderJsonFeed(changes, meta): object`. Each item: title = human `reason` (or synthesized), link = `/{domain}` deep link, id = stable (`change.id`), timestamp = `detectedAt`, category = `severity`.

### 3.6 Web routes (Phase 0)
- `/` — walking-skeleton landing: what this is, one-line scope, links to feeds + methods.
- `/methods` — permanent: names every data source, the bot's User-Agent + contact, the observational-only scope, and the credit line ("Built with Claude Code. Research assisted by Claude (Anthropic).").
- `/status` — reads `scans`: each module's last run + ok/error; each source's last-checked time.
- `/changelog` — renders `CHANGELOG.md`.
- `/feed.xml`, `/feed.json` — global change feed (empty until the dummy module runs).

### 3.7 Phase 0 Definition of Done (deploy this)
`workers/_dummy` writes one `observation` and one `change`; that change appears in `/feed.xml` **on the deployed production site**; `/status` shows the dummy run healthy; `/methods` + `/changelog` render. Tag `v0.1`. *(Delete or disable `_dummy` once Ledger lands.)*

---

## 4. Phase 1 — Ledger: overview

Watch the apex `.gov` registry as a **ledger over time**: who owns each domain, who's the security contact, and every change — with heuristics that surface anomalies like a contact email pointing at another org's product domain.

**Headline acceptance test (real data):** a person-watch on `@ndstudio.gov` fires exactly once for `usadf.gov` (contact `akash@ndstudio.gov`), and the **contact-domain-mismatch** heuristic independently flags that same row without any explicit subscription. Both must reproduce against the fixtures in §5.8.

---

## 5. Phase 1 — Ledger: detailed spec

### 5.1 Source
- `current-federal.csv` (federal subset, ~1,344 rows) and optionally `current-full.csv` (all `.gov`).
- Raw: `https://raw.githubusercontent.com/cisagov/dotgov-data/main/current-federal.csv`.
- Prefer a scheduled `git fetch` of the repo (free longitudinal history) **or** a raw fetch of the CSV; either works because we compute diffs from DB state, not from git. Git history is the backfill path for a one-time seed of past changes.

### 5.2 Normalization rules (`workers/ledger/normalize.ts`)
- Parse with a real CSV parser. Expected header (verify at runtime, §6.1):
  `Domain name, Domain type, Organization name, Suborganization name, City, State, Security contact email`.
- Map to `DomainRecord`. Lowercase `domain` for keying; preserve original for display.
- Treat `(blank)`, empty string, and whitespace-only as `null` (esp. `suborg`, `securityContactEmail`).
- Strip `\r` (files are CRLF). Trim all fields.
- `contentHash` = `sha256` of the canonical join of the normalized fields (stable field order).

### 5.3 Ingestion pipeline (per run)
1. `recordScanStart('ledger')`.
2. Fetch CSV (honest User-Agent; backoff; §6.1). If the whole-file hash equals the last run's, short-circuit: no changes, `recordScanFinish(ok, items, 0)`.
3. Parse → `DomainRecord[]`; build `current: Map<domain, rec>`.
4. Load `previous` = latest stored `DomainRecord` per domain (from `domains` + `latestObservation`).
5. **Diff** (§5.4) → `Change[]`.
6. For each domain: `upsertDomain`, `insertObservation` (skips on duplicate `content_hash`).
7. `insertChange` for each change; run **heuristics** (§5.5) and **watches** (§5.6) to set `severity`/`reason` and enqueue alerts.
8. `recordScanFinish(ok, items_seen, changes_emitted)`.

### 5.4 Diff algorithm (precise semantics)
- `domain ∈ current \ previous` → `Change(kind='added')`.
- `domain ∈ previous \ current` → `Change(kind='removed')`.
- `domain ∈ both`: for each **watched field** in `{domainType, org, suborg, securityContactEmail}` where `old !== new` → `Change(kind='modified', field, oldValue, newValue)`. (Ignore `city`/`state` churn for change events; still store them.)
- Idempotency falls out of the per-row `content_hash` + the run-level short-circuit; re-running an identical CSV emits zero changes.

### 5.5 Ledger heuristics (the value-add — this is what makes it more than a diff)
Evaluate on each run against `current` (and on change events):

**H1 — contact-domain mismatch (flagship).** For a row with a non-null `securityContactEmail`, extract the email's domain `d`. Flag when `d` is **not** the row's own apex domain **and not** in a curated **central-security allowlist** (see below). Emit `Change(kind='modified'/'added'` context, `severity='high'`, `reason="security contact is @{d}, foreign to {domain} ({org})"`).
  - **Real hit:** `usadf.gov` (org "United States African Development Foundation") with contact `akash@ndstudio.gov` → `d = ndstudio.gov` ∉ {usadf.gov, allowlist} → **flag**. This catches the Bobba finding *structurally*, with no name hardcoded.
  - **Central-security allowlist (seed, tunable):** `eop.gov`, `omb.eop.gov`, `gsa.gov`, `cisa.gov`, `hq.dhs.gov`, plus common patterns like `cybersecurity@<agency>.gov` and `security@<agency>.gov`. The allowlist prevents the obvious false positives (EOP domains all using `PITC-Defense@eop.gov`, GSA using `gsa-vulnerability-reports@gsa.gov`, etc.). **Escalate hardest** when `d` is itself a *product/watchlisted* `.gov` domain (like `ndstudio.gov`) rather than a recognized central mailbox.
  - Ship conservative; log candidate flags to `/status` for tuning before making them loud.

**H2 — org / suborg watch.** Subscriptions on `Organization name` or `Suborganization name` (e.g. suborg `"Department of Government Efficiency"` — real, appears on `doge.gov`, `deregulation.gov`; or org `"Executive Office of the President"`). Fire on a **newly-added** domain matching, or a domain **changing into** the watched org/suborg. `severity='high'` on add, `notable` on change.

**H3 — new federal domain.** Any newly-added `Federal - Executive` domain → `severity='notable'` (a "new federal domains" feed is independently useful).

**H4 — contact change on a watched/flagged domain.** `securityContactEmail` modified on a domain that is watchlisted or previously H1-flagged → `notable` (or `high` if the new contact is a foreign product domain).

### 5.6 Person-watch matcher
- Subscriptions of `kind:'person'` with `pattern`:
  - `@domain.gov` → **email-domain suffix** match against `securityContactEmail`.
  - plain string → case-insensitive **substring** match across `securityContactEmail` (and any future name fields).
- **Evaluate against change events, not steady state.** A person-watch fires when the matching value appears via an `added` or `modified` change — so it naturally fires **once** when it first appears and does not re-fire on subsequent daily runs where the row is unchanged. Record the fire in `alerts` (with `change_id`) for auditability.

### 5.7 Severity → routing
- `high`: person-watch match; H1 flag where contact domain is a product `.gov`; H2 add. → priority feed + (later) email/webhook.
- `notable`: H3 new federal domain; H4 contact change; H2 change; H1 flag against allowlist edge cases. → standard feed.
- `info`: everything else. → feed only.

### 5.8 UI surfaces
- `/registry` — search by domain / org / suborg / contact; results table (domain, org, suborg, type, contact, flags).
- `/{domain}` (or `/domain/[name]`) — owner card (org, suborg, type, city/state, contact) + **flags** (e.g. contact-domain mismatch) + **history timeline** built from `changes` (added / contact changed / org changed …), each with date + source link to the CISA row/commit.
- `/ledger/feed.xml` + `/ledger/feed.json` — change feed (filterable by `?severity=high`).
- Watches for v1 are **config-driven** in `config/watchlist.yaml` (person/org/suborg); a `/watch` management UI is post-v1.

### 5.9 Deployable sub-increments (ship each, behind flags)
- **1a** — importer + `/registry` search + `/{domain}` (read-only owner registry). *Instantly useful; deploy.*
- **1b** — diff engine + `changes` + `/ledger/feed.*`. *Deploy.*
- **1c** — heuristics H1–H4 + person/org watches + severity routing. *Deploy.* Tag `v0.2`.

### 5.10 Fixtures & acceptance tests (use REAL rows)
Seed two CSV fixtures, `before.csv` and `after.csv`, from live rows (header + these):
```
# both files share the header:
Domain name,Domain type,Organization name,Suborganization name,City,State,Security contact email

# in BOTH (steady state):
ndstudio.gov,Federal - Executive,Executive Office of the President,White House Office,Washington,DC,dl.eop.cloudadmin@eop.gov
vote.gov,Federal - Executive,Election Assistance Commission,,Washington,DC,security@eac.gov

# usadf.gov: present in AFTER with the foreign contact (the flagship case)
usadf.gov,Federal - Executive,United States African Development Foundation,African Development Foundation,Washington,DC,akash@ndstudio.gov

# a benign contact change for H4 (fabricate a prior value in before.csv):
#   before: trumprx.gov ... ,(blank)      after: trumprx.gov ... ,someone@ndstudio.gov
```
**Tests:**
1. **Diff:** `before → after` yields exactly the expected `added`/`modified` set (no `city/state`-only noise).
2. **H1 flagship:** `usadf.gov` is flagged `high` with reason naming `ndstudio.gov`, **with no person-watch configured**.
3. **Person-watch:** with `person_watch: ["@ndstudio.gov"]`, exactly one `high` alert fires for `usadf.gov` on the run where it appears; a second identical run fires **zero** new alerts (dedup via change-event evaluation).
4. **Allowlist sanity:** the ~20 `Executive Office of the President` domains sharing `PITC-Defense@eop.gov` do **not** each trip H1 (allowlist works).
5. **Idempotency:** re-running `after → after` emits zero changes and inserts zero new observations.
6. **Feed:** the `high` change surfaces in `/ledger/feed.xml` with a working deep link.

---

## 6. Cross-cutting build notes

### 6.1 Verify-the-header guardrail (do this at runtime)
On each run, assert the parsed header equals the expected column set; if it differs, **fail loudly to `/status`** and skip the diff rather than silently mis-mapping. The dataset drifts; never trust the column order/names from this doc without checking.

### 6.2 Guardrails recap for these phases
Ledger touches only a public git repo of **official public registrant records** — no live-site interaction at all, so the CFAA bright line isn't in play here, but the rules still hold: honest User-Agent + contact URL; respect GitHub rate limits (cache, backoff); show individuals **only** in official-contact capacity; the `redact` pass is pass-through for this already-public official data but stays wired in for later phases. Public copy states observations ("security contact is `@ndstudio.gov`, foreign to `usadf.gov`"), never accusations.

### 6.3 Post-phase deploy checklist (run for `v0.1` and `v0.2`)
green CI → migrations applied → flags set → `/status` healthy → plain-language `/changelog` entry → tag pushed → smoke-test the public artifact → announce via a feed item.

---

## 7. Handing this to Claude Code — ready-to-paste kickoff prompt

> Paste into Claude Code from the repo root, with `Daylight-PRD.md` and this spec present.

```
You are building "Daylight," a public, observational watchdog for federal .gov infrastructure.
Read Daylight-PRD.md (product decisions) and Daylight-Phase-0-1-Build-Spec.md (engineering
decisions) fully before writing code. Build ONLY Phase 0 then Phase 1 (Ledger).

Non-negotiables:
- Public data only; observational only. Never authenticate past any access wall; never probe/
  scan/brute-force live hosts. (Ledger only reads a public git CSV, so this is easy to honor.)
- At runtime, VERIFY the CISA CSV header matches the expected columns before diffing; fail loudly
  to /status on mismatch. Do not trust column names from the spec without checking the live file.
- The dataset is APEX domains only — subdomains are out of scope for Ledger.
- Show individuals only in official-contact capacity. Neutral, factual copy; never "illegal."
- Ship deployable sub-increments (1a→1b→1c); keep main always deployable; hide unfinished
  surfaces behind feature flags. Every phase ends live in production, tagged, with a /changelog entry.

Stack: TypeScript pnpm monorepo; SQLite via better-sqlite3 (thin packages/db so Postgres can swap
in at Phase 2); Next.js (App Router) + Tailwind; a real CSV parser (papaparse/csv-parse); hand-
rolled RSS/Atom + JSON Feed. Follow the package layout, type contracts, DDL, and query surface in
the spec exactly.

Method: write the acceptance tests from §5.10 FIRST (using the real fixtures, incl. the usadf.gov
→ akash@ndstudio.gov flagship case), then implement until green. The contact-domain-mismatch
heuristic (H1) must flag usadf.gov with NO person-watch configured, and the @ndstudio.gov person-
watch must fire exactly once with dedup. Start with Phase 0's walking skeleton and get it deployed
(a dummy change visible in /feed.xml on the live site) before starting Ledger.

Deliver Phase 0 as tag v0.1 and Phase 1 as tag v0.2, each with a plain-language CHANGELOG entry.
Ask me before choosing a hosting target and before any schema change beyond the spec.
```

---

## 8. What comes after (so Code can see the shape)
Phase 2 (Lookout) reuses `packages/{core,db,feeds}` unchanged, adds a persistent certstream worker, and is where the DB migrates to Postgres. The `enrich` package then joins Lookout cert hits to Ledger owners (a new subdomain's apex owner is already in `domains`). Nothing in Phase 0–1 should assume SQLite beyond the `packages/db` boundary.
