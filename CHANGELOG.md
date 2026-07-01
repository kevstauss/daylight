# Changelog

Plain-language record of what Daylight can do, and when each piece went live.
Rendered publicly at `/changelog`.

Everything Daylight does is **observational and built on already-public data**. See
`/methods` for every source, the bot's contact, and the observational-only scope.

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
