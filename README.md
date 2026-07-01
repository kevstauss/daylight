# Daylight

A public, always-on **watchdog for federal `.gov` infrastructure** — who owns it, what
certificates it issues, what's tracking you on it, whether it filed the privacy paperwork
the law requires, and what quietly changed or disappeared.

Everything Daylight does is **observational and built on already-public data**
(CISA's public registrant repo, Certificate Transparency logs, live public page source).
Same lane as the EFF, The Markup, and EPIC.

> **The one line we never cross.** Noting that a certificate, subdomain, or login page
> *exists* is fine. We **never** authenticate past any access wall, guess credentials,
> probe, port-scan, or brute-force. We observe the front door; we never try the handle.
> See [`daylight-docs/Daylight-PRD.md`](daylight-docs/Daylight-PRD.md) §5.

## Status

| Phase | Module | Ships as | State |
|------:|--------|----------|-------|
| 0 | Foundation | Walking skeleton: site shell, feeds, `/methods`, `/status` | ✅ tagged `v0.1` |
| 1 | **Ledger** | Searchable owner registry + change feed + person/org watches | ✅ tagged `v0.2` (reviewed) |
| 2 | Lookout | New-subdomain feed + flag scoring + Ledger-owner enrichment | 🔨 core on `main` — certstream + Postgres pending a hosting decision |
| 3 | Floodlight | Tracker & session-replay scorecards | 🔨 engine on `main` — live Playwright capture pending a scheduler/host decision |
| 4 | Receipts | Snapshot archive + removal ledger | 🔨 removal-ledger engine on `main` — live snapshot + Wayback push pending the same decision |
| 5 | Redtape | PIA/SORN gap-finder (human-gated) | 🔨 gap-finder + human gate on `main` — live AI researcher (API key) + review UI pending |
| 6 | Daylight | Unified per-domain dashboard | ◻︎ planned |

All modules are fixture-tested and reuse `packages/{core,db,feeds,redact}` behind their
interfaces. The deferred pieces (real-time certstream, live page capture, the Postgres
migration) are the ones that need infrastructure/hosting decisions — the analysis logic
they feed is already built and tested.

## Monorepo layout

```
apps/web/          Next.js public site + dashboard + feeds (live from Phase 0)
workers/
  _dummy/          Phase 0 walking-skeleton prover (writes 1 observation + 1 change)
  ledger/          Phase 1 registrant/contact diff watcher (daily batch)
packages/
  core/            shared types, watchlist loader, hashing, time, feature flags
  db/              schema + migrations + query helpers (better-sqlite3; Postgres at Phase 2)
  feeds/           hand-rolled RSS/Atom + JSON Feed renderers
  redact/          ingest-time PII redaction pass (pass-through for public CSV; real by Phase 3)
config/
  watchlist.yaml   the domains/patterns/watches that drive every module
daylight-docs/     the PRD + phase build specs
```

## Develop

Requires Node 22+ and pnpm 9 (via `corepack enable pnpm`).

```bash
pnpm install
pnpm typecheck        # tsc --noEmit across all packages
pnpm test             # vitest — acceptance tests run against real-row fixtures
pnpm ledger:seed      # backfill the registry from the live CISA CSV (one-time)
pnpm ledger           # run one daily Ledger pass (fetch → verify header → diff → emit)
pnpm dev              # Next.js dev server (http://localhost:3000)
```

The SQLite database lives at `data/daylight.db` by default (override with
`DAYLIGHT_DB_PATH`). It is never committed.

### Feature flags

Unfinished surfaces are gated by env flags (`FLAG_*`), so `main` is always deployable.

| Flag | Gates |
|------|-------|
| `FLAG_LEDGER_REGISTRY` | `/registry` + `/domain/{name}` (increment 1a) |
| `FLAG_LEDGER_FEED` | `/ledger/feed.*` + change emission (increment 1b) |
| `FLAG_LEDGER_HEURISTICS` | H1–H4 heuristics + person/org watches (increment 1c) |

## Deploy (Fly.io)

See [`fly.toml`](fly.toml) and [`Dockerfile`](Dockerfile). The web app runs as a Fly
Machine with a volume-mounted SQLite file; the daily Ledger pass runs as a scheduled
Machine. `deploy` on green `main` is wired in CI once `FLY_API_TOKEN` is set as a repo
secret.

## Credits

Research and product design assisted by **Claude (Anthropic)**; tooling built with
**Claude Code**.
