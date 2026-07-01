# Changelog

Plain-language record of what Daylight can do, and when each piece went live.
Rendered publicly at `/changelog`.

Everything Daylight does is **observational and built on already-public data**. See
`/methods` for every source, the bot's contact, and the observational-only scope.

## Unreleased — Daylight dashboard (Phase 6, composition toward `v1.0`)

**The front door.** Type any federal `.gov` and see everything Daylight knows about it,
composed on one page — with a source link and a "last checked" timestamp on every claim:

- **Composite `/domain/{name}`** joins all five modules — ownership + contact-mismatch
  flag (Ledger), CT subdomains + function-mimic flags (Lookout), the tracker scorecard
  (Floodlight), snapshots + the removal ledger (Receipts), and reviewed privacy-filing gaps
  (Redtape). Each section **degrades gracefully** to "not yet scanned / not yet watching."
- **Scope gate is composed in:** the dashboard reads Redtape through the human gate
  (`publicGaps`), so an unreviewed gap can never surface — tested at the data layer.
- **Home is now the front door:** an Explore grid of the live modules plus recent activity.
- **The global `/feed.xml` + `/feed.json` merge every module's change events**, newest first.

The composition itself is complete and tested; the sections fill with data as each module's
deferred live ingest (certstream, Playwright capture, the Redtape researcher) is enabled.

**Visual system — "the public record."** A design pass gives Daylight an identity grounded in
its own subject: an append-only federal audit trail. **Public Sans** (the US federal
government's own typeface) leads; **IBM Plex Mono** is the co-voice for every machine fact —
domains, contacts, content hashes, UTC timestamps. The palette is a cool institutional
daylight-gray with cool near-black ink and **oxblood** used only as an official "stamp" for
high-severity flags (with desaturated ochre/pine for the scorecard states). Every record is a
ledger line — severity stamp, plain statement, mono identifier, UTC timestamp — and every
section carries a module-path eyebrow (`ledger · ownership`) so the structure of the shared
observation/change spine is legible on the surface. Underlined-ink links flag oxblood on hover.

A **dark mode** — the darkroom to daylight — inverts the palette to a warm, lamplit charcoal
with paper-cream ink (not near-black + neon), keeping the exact same stamp system, lifted just
enough to read. It follows the OS preference by default, with a system/light/dark toggle in the
masthead that persists and applies before first paint (no flash). Implemented as a CSS-variable
token swap, so every surface inherits both modes with no per-component change.

## Unreleased — Lookout (Phase 2, in progress toward `v0.3`)

**Certificate Transparency watcher.** Daylight now reads public CT logs so a new `.gov`
subdomain surfaces the day its certificate is issued — enriched with who owns the apex
(from Ledger). Existence-only: we record that a cert exists; we never connect to the host
(many sit behind a Cloudflare Access gate — untouched).

Live now (behind `FLAG_LOOKOUT`):

- **`/lookout`** — new-subdomain feed with flag scoring, filterable by severity.
- **`/lookout/feed.xml` + `/lookout/feed.json`** — the subdomain change feed.
- **Cert/subdomain section on `/domain/{name}`** — the subdomains seen for an apex.
- **Flag scoring:** high-signal labels (`previews`/`staging`/`infra`/…), a **function-mimic**
  heuristic that flags a name imitating another agency (e.g. `vote-gov.previews.ndstudio.gov`
  looks like `vote.gov` under the White House–controlled apex), and a collection/inference
  infrastructure flag (`analytics.infra.ndstudio.gov`).
- **crt.sh backfill** with backoff + an HTML-scrape fallback (crt.sh 502s under load), and
  idempotent ingest keyed by fqdn / cert hash.

Still to come for the `v0.3` tag (needs a hosting decision): the always-on **certstream**
worker for real-time ingest, and the SQLite → Postgres migration that real-time ingest wants.

**Floodlight analysis engine (Phase 3 core, toward `v0.4`).** The "Blacklight for .gov"
tracker scanner's brain is built and fixture-tested (the project's heaviest lift):

- **Reverse-proxy disguise detection (flagship):** flags a *first-party* endpoint whose
  path or POST-body shape matches a known analytics SDK — the adblocker-evasion trick —
  including the real AutoMonitor signature (`{session_id, events[]}` to an
  `analytics.infra.<apex>` host).
- **Session-replay detection**, **third-party tracker classification** (seeded from
  DuckDuckGo Tracker Radar + EasyPrivacy in `packages/fingerprints`), and a
  **privacy-notice cross-check** (does the page even link one?).
- **Real redaction** now runs on ingest (`redactText` scrubs emails/SSNs/phones from any
  page-derived text before it is stored) — the `/methods` assurance is now literally true.
- `/floodlight` hall of shame + `/floodlight/feed.*` are live behind `FLAG_FLOODLIGHT`;
  tracker add/remove diffs emit change events (Receipts will consume these in Phase 4).

Deferred (needs a scan-scheduler/host decision): the live Playwright page-capture adapter.
The engine is pure over a captured page, so it is fully tested without touching live sites —
and per the guardrails, Daylight never submits forms, authenticates, or follows an access gate.

**Receipts removal-ledger engine (Phase 4 core, toward `v0.5`).** The counter-move to an
apparatus built to be sealed and deleted:

- **Snapshot diff engine:** compares two snapshots of a page and flags what quietly
  disappeared — a **tracker removed**, a **privacy notice removed**, an **agency seal
  removed** — each a dated, high-severity `removed` event with before/after. This turns
  "we took it down" (NDS pulled its tracking the day after the Guardian's questions) into
  evidence, not an escape.
- **`/receipts` removal ledger** + `/receipts/feed.*` are live behind `FLAG_RECEIPTS`.
- **Wayback SPN2** archiving is wired as an injected saver (mocked in CI, opt-in in prod) so
  each snapshot can carry an independent archived copy we don't control.
- Redaction runs on captured text before persistence; the **raw store (screenshots/DOM) is
  never served publicly** — screenshots go public only after a human-review flag.

Deferred (needs the scan-scheduler/host decision, shared with Floodlight): the live
Playwright snapshot + screenshot capture and the live Wayback push. The diff engine that
consumes them is built and fixture-tested.

**Redtape gap-finder + human gate (Phase 5 core, toward `v0.6`).** Automates the exact
finding experts pointed at — sites collecting PII with no published PIA/SORN — with an AI
research agent behind a mandatory human-approval gate:

- **Human gate enforced at the data layer:** `publicGaps()` returns ONLY rows a human
  reviewed AND published. Nothing agent-generated ever reaches the public path — tested
  directly, not just in the UI.
- **Model-agnostic agent:** the researcher is an interface (mocked in CI; a real Claude
  implementation via `DAYLIGHT_REDTAPE_MODEL` is wired but deferred). Output is parsed as
  strict JSON with one retry, then routed to a manual queue — malformed output never
  crashes and never publishes.
- **Distinguishes** `no_filing` from `incomplete_filing` (a SORN that exists but omits the
  analytics processor — the Trump Accounts case) from `covered`.
- **Negative-search trail:** every gap carries the exact `queries_run` + `sources_checked`
  so a stranger can re-verify the absence. Federal Register API client included.
- **`/redtape`** (behind `FLAG_REDTAPE`) shows reviewed gaps with maximally careful, dated,
  evidence-linked copy — "no published PIA found as of {date}; searches below," never
  "illegal."

Deferred: the auth-gated internal `/review` queue UI + wiring the live researcher (needs an
API key + a reviewer). The pipeline, the gate, and the parsing are built and fixture-tested.

## v0.2 — Ledger (the first phase you can use)

**The registry, now watched over time.** Daylight reads the public federal `.gov`
ownership registry (CISA's `cisagov/dotgov-data`, ~1,343 apex domains) every day and keeps
a ledger of who owns what — and, more importantly, of every change.

What you can do now:

- **Search the registry** at `/registry` — look up any federal `.gov` and see who owns it,
  its organization and sub-organization, and the published security contact.
- **See a domain's history** at `/domain/{name}` — the owner card plus a timeline of
  ownership and contact changes, each linked to the public source row.
- **Subscribe to the change feed** at `/ledger/feed.xml` and `/ledger/feed.json` — every
  registrant or security-contact change across the federal registry, filterable by
  severity (append `?severity=high`).

How it stays honest and sober:

- **Contact-domain-mismatch heuristic (H1).** Flags when a domain's published security
  contact is an email at *another* organization's `.gov` that isn't a recognized central
  mailbox — e.g. `usadf.gov` (US African Development Foundation) listing
  `akash@ndstudio.gov`. Crucially, it *clears* the legitimate cases: a contact at another
  domain owned by the **same organization** (like `vote.gov` → `security@eac.gov`, both the
  Election Assistance Commission) is not flagged. On the live dataset this surfaces a
  single high-confidence flag rather than noise. Stated as a neutral observation, linked to
  the source; never as an accusation.
- **Runtime header verification.** Before diffing, Daylight checks the live CISA CSV header
  matches the expected columns and fails loudly to `/status` on any drift — we verify, we
  don't assume.
- **Idempotent daily diffing.** Keyed by content hash: re-running the same data emits no
  duplicate changes, and a name/org watch fires exactly once when an identity first appears.
- **Config-driven watches.** `config/watchlist.yaml` fires a high-priority alert when a
  watched identity (e.g. `@ndstudio.gov`) appears as any contact, or when a watched
  organization gains or changes a domain.

Under the hood: the daily pass runs in-process on the web machine (sharing the one SQLite
volume); the Phase 0 walking-skeleton dummy worker has been retired now that Ledger is live.

## v0.1 — Foundation (walking skeleton)

**Daylight is online.** A near-empty but fully wired production site: the shared data
spine, working feeds, a permanent methods page, and a public status page.

What's live:

- **`/`** — what Daylight is and its one-line scope.
- **`/methods`** — every data source, the bot's honest User-Agent and contact, and the
  observational-only bright line we never cross.
- **`/status`** — each worker's last run (ok/error) and each source's last-checked time.
  Transparency about our own uptime is part of the ethos.
- **`/changelog`** — this page.
- **`/feed.xml`, `/feed.json`** — the global change feed (RSS/Atom + JSON Feed), so other
  reporters and tools can build on us.

Under the hood: the observation/change data model, content-hash idempotency, and a dummy
module proving the full path end-to-end — an observation written, a change emitted, and
that change appearing in the live feed.
