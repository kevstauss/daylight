# Changelog

Plain-language record of what Daylight can do, and when each piece went live.
Rendered publicly at `/changelog`.

Everything Daylight does is **observational and built on already-public data**. See
`/methods` for every source, the bot's contact, and the observational-only scope.

## Unreleased

- Building Phase 1 (Ledger — registrant/contact diff watcher). Ships as `v0.2`.

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
