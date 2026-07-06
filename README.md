# Daylight

A public, always-on **watchdog for federal `.gov` infrastructure** — who owns it, what
certificates it issues, what's tracking you on it, whether it filed the privacy paperwork
the law requires, and what quietly changed or disappeared.

Everything Daylight does is **observational and built on already-public data** (CISA's
public registrant repo, Certificate Transparency logs, live public page source). Same lane
as the EFF, The Markup, and EPIC.

> **The one line we never cross.** Noting that a certificate, subdomain, or login page
> *exists* is fine. We **never** authenticate past any access wall, guess credentials,
> probe, port-scan, or brute-force. We observe the front door; we never try the handle.

## Modules

- **Ledger** — searchable `.gov` owner/contact registry + change feed + person/org watches.
- **Lookout** — new-subdomain feed from Certificate Transparency logs, with flag scoring.
- **Foundry** — vendor build-graph: joins Lookout's CT tree with Ledger's registry to surface how
  many distinct agencies build through one vendor, and projects staged with no `.gov` registered yet.
- **Floodlight** — tracker & session-replay scorecards for public `.gov` pages.
- **Receipts** — dated snapshot archive + removal ledger, with independent Wayback copies.
- **Redtape** — PIA/SORN privacy-filing gap-finder (human-reviewed before anything publishes).

## Monorepo layout

```
apps/web/     Next.js public site + per-domain dashboard + feeds
workers/      ledger · lookout · foundry · floodlight · receipts · redtape (batch jobs / crons)
packages/     core · db · feeds · redact · enrich · fingerprints (shared libraries)
config/
  watchlist.yaml   priority domains, patterns, and watches (scope is all .gov; this sets priority)
```

## Develop

Requires Node 22+ and pnpm 9 (`corepack enable pnpm`).

```bash
pnpm install
pnpm typecheck        # tsc --noEmit across all packages
pnpm test             # vitest against real-row fixtures
pnpm dev              # Next.js dev server (http://localhost:3000)
```

The SQLite database lives at `data/daylight.db` by default (override with `DAYLIGHT_DB_PATH`)
and is never committed. Unfinished surfaces are gated behind `FLAG_*` env flags so `main`
stays deployable. Deployment runs on Fly.io — see [`fly.toml`](fly.toml),
[`Dockerfile`](Dockerfile), and [`HOSTING.md`](HOSTING.md).

## Credits

Built with **Claude (Anthropic)** and **Claude Code**.
