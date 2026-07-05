# Daylight

A public, always-on **watchdog for federal `.gov` infrastructure** — who owns it, what
certificates it issues, what's tracking you on it, whether it filed the privacy paperwork the
law requires, and what quietly changed or disappeared. Everything Daylight does is
**observational and built on already-public data** (CISA's public registrant repo, Certificate
Transparency logs, live public page source). Same lane as the EFF, The Markup, and EPIC.

> **Design ethos:** the *data stays sober and factual*; the *attitude lives in the naming and
> the vibe*. Sober data is exactly what makes it legally bulletproof and press-credible. Module
> names carry the point; the numbers stay clean.

**Why it exists (grounding, not opinion).** In 2025–2026 a White House office (the National
Design Studio) rebuilt sensitive federal sites on Executive-Office-of-the-President
infrastructure; two investigations (The Drey Dossier, The Guardian) showed — using only public
data — covert reverse-proxied analytics with session replay and **no** privacy filings (PIA/SORN).
That reporting was manual and episodic; someone had to happen to look. Daylight turns "a reporter
noticed once" into "the ledger is always watching, timestamped, diffed, and public." Every seed
value, detection signature, and acceptance test traces back to a documented finding.

---

## ⚖️ Non-negotiable guardrails (read this first)

These are hard constraints, lifted from PRD §5. **Treat any task that would violate one as out of
scope and flag it rather than implementing it.** They are why the project is credible; breaking
one destroys the whole thing.

- **The bright line — existence, never access.** Noting that a certificate, subdomain, or login
  page *exists* (from a public log) is fine. **Never** authenticate past any access wall
  (Cloudflare Access / `*.cloudflareaccess.com`, SSO, `login.gov`, an HTTP 401), guess
  credentials, or reach a gated staging/preview endpoint. We observe the front door; we never try
  the handle. `looksGated()` / `isGatedNavigation()` in `workers/floodlight/src/guards.ts` enforce
  this at capture time — a gated navigation is recorded as "exists" and never entered.
- **Public data only.** Every source must be reachable without authentication. If it needs a
  login, it's out of scope.
- **No probing, ever.** No port scanning, vuln scanning, fuzzing, or directory brute-forcing of
  live `.gov` hosts. Subdomain *discovery* is **passive** (CT logs), never active brute-force.
- **SSRF is closed in code.** Live capture refuses private/loopback/link-local/metadata targets,
  pins the resolved IP, re-validates every redirect hop, and (for the public scan box) restricts
  the target to real federal `.gov` hosts. See `guards.ts` (`isBlockedIp`, `hostAllowed`,
  `assertScannableUrl`, `isAllowedByRobots`) — don't loosen these.
- **Redact on ingest; never serve the raw store.** Anything captured from a page runs through
  `packages/redact` before it lands in a servable field. The raw artifact store (screenshots,
  DOM) is **never** served publicly. Screenshots go public only after a human-review flag.
- **The Redtape human gate is mandatory.** Nothing legal-adjacent (a PIA/SORN "gap") ever reaches
  the public path without a human reviewing and publishing it. This is enforced **at the data
  layer** in `DaylightDb.publicGaps()`, not just in the UI. Do not add a public read path that
  bypasses it.
- **Neutral, defensible copy.** State what was observed: "No published Privacy Impact Assessment
  was found as of {date}; see searches below." Never "they broke the law."
- **Honest identity + politeness.** Descriptive User-Agent (`DaylightBot/…` with a `+/methods`
  contact URL, see `apps/web/src/lib/site.ts`), respect `robots.txt`, back off, cache
  aggressively, never hammer a source.
- **Responsible disclosure.** If a scan ever incidentally surfaces an exposed
  secret/credential/real vulnerability: stop, do not publish, route to the affected agency / CISA.
  Not our mission, not ours to weaponize.

---

## Architecture

TypeScript monorepo, **pnpm workspaces**, one shared data spine that every module writes to so the
dashboard composes cleanly. Node **22+**, pnpm **9.15.0** (`corepack enable pnpm`). ESM
throughout (`"type": "module"`; import specifiers use `.js` extensions even for `.ts` sources).

```
apps/web/          Next.js public site + per-domain dashboard + feeds + in-process schedulers
workers/           ledger · lookout · floodlight · receipts · redtape  (batch jobs / crons)
packages/          core · db · feeds · redact · enrich · fingerprints  (shared libraries)
config/
  watchlist.yaml   the domains, patterns, and watches that drive EVERY module
```

Workspace package names are `@daylight/<dir>` (e.g. `@daylight/core`, `@daylight/ledger`,
`@daylight/receipts/sweep`). Cross-package imports go through these names, never relative paths
across package boundaries.

### The shared spine (the most important contract)

Everything is an **observation → change** over time, stored in SQLite. The core types live in
`packages/core/src/types.ts` and are treated as a frozen seam — changing them ripples across every
module:

- **`Observation`** — one captured artifact: `{ module, domain, observedAt, sourceUrl, contentHash,
  payload }`. `contentHash` (sha256 of the canonicalized payload) is the **idempotency key**:
  re-ingesting the same artifact emits no duplicate. Store the raw artifact next to every
  interpretation — interpretations can be wrong; raw + hash + timestamp is what makes us trustworthy.
- **`Change`** — a detected `added` / `removed` / `modified` delta with a `severity`
  (`info` | `notable` | `high`) that drives alert routing, and a `sourceUrl` (the exact public
  artifact) so every public claim is one-click re-verifiable ("source →").
- **`scans`** — one row per worker run; powers `/status` (a silently-dead watchdog is worse than
  none, so `/status` shows `overdue` when a scheduler stops).

The DB query surface is `DaylightDb` in `packages/db/src/index.ts`. **Every caller goes through
these methods** so the planned SQLite → Postgres swap never touches pages or workers. The runtime
schema is `packages/db/src/schema.ts` (applied idempotently on every connection open), mirrored by
numbered files in `packages/db/migrations/` (additive only).

### Watchlist-driven

`config/watchlist.yaml` is the heart of the system — one file drives every module (watched apexes,
comparators, person/org/suborg watches, the security-contact allowlist, subdomain-flag scoring,
known subdomains). Parsed and normalized by `packages/core/src/watchlist.ts` into the `Watchlist`
type. Change behavior by editing the watchlist, not by hard-coding domains in a module.

---

## The six modules & current status

Each module has a "finding it would have caught" acceptance test grounding it in a real documented
event. Build status below reflects `CHANGELOG.md` (source of truth for what's live).

| # | Module | Watches | Public source | Status |
|---|--------|---------|---------------|--------|
| 1 | **Ledger** (`workers/ledger`) | `.gov` owners + security contacts, every change | CISA `cisagov/dotgov-data` git repo | **Live (v0.2)** — daily diff + full git-history backfill |
| 2 | **Lookout** (`workers/lookout`) | New certs / new subdomains | CT logs via crt.sh | **Live behind `FLAG_LOOKOUT`** — crt.sh backfill; certstream (real-time) deferred |
| 3 | **Floodlight** (`workers/floodlight`) | Trackers & session-replay on live pages | Live page source (Playwright) | **Engine live** behind `FLAG_FLOODLIGHT`; live capture behind `FLAG_FLOODLIGHT_SCAN` |
| 4 | **Receipts** (`workers/receipts`) | Snapshots + what quietly changed/vanished | Rendered page + screenshot + Wayback | **Diff/removal engine live** behind `FLAG_RECEIPTS`; live capture deferred |
| 5 | **Redtape** (`workers/redtape`) | PII collection with no PIA/SORN | Federal Register API + PIA inventories | **Pipeline + human gate live** behind `FLAG_REDTAPE`; live AI researcher needs `ANTHROPIC_API_KEY` |
| 6 | **Daylight** (`apps/web`) | Everything, per domain | composes 1–5 | **Composite `/domain/{name}` live** (`packages/enrich` joins the modules) |

"Deferred" almost always means *the engine is built and fixture-tested; only the live ingest
(certstream, Playwright sweep, the real Claude researcher) awaits a hosting/secret decision.* Don't
rebuild the engines — wire the ingest.

### Signature detections (what makes each module non-generic)

- **Ledger H1** — flags a security contact whose email domain is foreign to the org and not in
  `central_security_allowlist` (caught `akash@ndstudio.gov` on `usadf.gov`); **clears** the
  legitimate same-org case (`vote.gov` → `security@eac.gov`). **H9** — contact concentration (one
  foreign apex serving ≥3 orgs).
- **Lookout** — subdomain-flag scoring (`previews`/`staging`/`infra`/`photo`/…) plus a
  **function-mimic** heuristic (a name imitating another agency under a foreign apex, e.g.
  `vote-gov.previews.ndstudio.gov`).
- **Floodlight flagship** — **reverse-proxy disguise detection**: a *first-party* endpoint whose
  path or POST-body shape matches a known analytics SDK (the adblocker-evasion trick), including
  the AutoMonitor signature (`{session_id, events[]}` to `analytics.infra.<apex>`). Requires a real
  analytics beacon before flagging "high" — don't loosen this into flagging ordinary content paths.
- **Receipts** — the **removal ledger**: a tracker/privacy-notice/seal/form-field that was present
  and then vanished becomes a dated, high-severity `removed` event with before/after.
- **Redtape** — distinguishes `no_filing` from `incomplete_filing` (a SORN that exists but omits
  the processor — the Trump Accounts case) from `covered`, and carries the exact `queries_run` +
  `sources_checked` so the *negative* is independently re-checkable.

---

## Development

```bash
pnpm install
pnpm typecheck        # tsc --noEmit across all packages (parallel)
pnpm test             # vitest against real-row fixtures
pnpm dev              # Next.js dev server → http://localhost:3000
pnpm ci               # typecheck + test (what GitHub Actions runs)

# Worker CLIs (run against the local SQLite file):
pnpm ledger           # one daily Ledger diff pass
pnpm ledger:seed      # silent baseline (populate state, emit no changes)
pnpm ledger:history   # replay the full CISA git history (dated backfill)
pnpm redtape:assess   # turn Floodlight collection evidence into queued gaps
pnpm analytics:reset  # wipe first-party analytics counts (--yes to confirm)
```

- **Testing:** Vitest, `environment: node`, `pool: "forks"` (better-sqlite3 is native). Tests run
  against package **source** via aliases in `vitest.config.ts` (no build step). Test files are
  `*.test.ts` colocated in `src/`. Many use fixtures (`workers/*/fixtures/`) and real captured rows.
  **When you fix a bug, add a regression test** — the hardening pass grew the suite 69 → 86 exactly
  this way.
- **Local DB:** SQLite at `data/daylight.db` (override with `DAYLIGHT_DB_PATH`). Gitignored, never
  committed. Tests use `:memory:` via `createDb(":memory:")`.
- **Local env:** copy `.env.example` → `.env`. Nothing there is required to boot. Leave
  `FLAG_ANALYTICS` and `FLAG_FLOODLIGHT_SCAN` **off** in dev.
- **TS config:** `tsconfig.base.json` is `strict` + `noUncheckedIndexedAccess`. Keep code clean
  under it; don't weaken compiler options.

### Feature flags

`FLAG_*` env vars gate surfaces on/off as a simple kill-switch (`packages/core/src/flags.ts` →
`flag(name)`; web-side typed accessor in `apps/web/src/lib/flags.ts`); the active ones are set in
`fly.toml`, and the module table above notes which surface each gates. Any page must render cleanly
when a module has no data yet ("not yet scanned / not yet watching").

---

## Deployment

**Cheap and boring by design:** one Fly.io machine (`daylight-watchdog`, region `iad`,
`shared-cpu-2x` / 2 GB) runs the Next.js read-path *and* the scheduled workers in-process, all
sharing **one SQLite file on one Fly volume** (`/data/daylight.db`). No Postgres, no certstream, no
second machine, no queue. `HOSTING.md` is the full operator runbook; `fly.toml` + `Dockerfile` are
the config.

- **Schedulers** live in `apps/web/src/instrumentation.ts` (Next.js `register()` hook, Node runtime
  only). Each cron activates only when its `DAYLIGHT_*_CRON` env var is set, so `pnpm dev` stays
  quiet. Crons are staggered UTC (see `fly.toml [env]`).
- **CI/CD:** `.github/workflows/ci.yml` — typecheck + test on every push/PR; auto-deploy to Fly on
  green `main` **once `FLY_API_TOKEN` is set** as a repo secret (skips cleanly until then).
- **Secrets** (via `fly secrets set`, never in the repo): `DAYLIGHT_CONTACT` (real contact for
  `/methods`), `DAYLIGHT_REVIEW_TOKEN` (gates `/review`; the queue 404s without it),
  `ANTHROPIC_API_KEY` + optional `DAYLIGHT_REDTAPE_MODEL` (Redtape researcher), `IA_S3_ACCESS_KEY`
  / `IA_S3_SECRET` (authenticated Wayback), `DAYLIGHT_FUNDING_URL` (optional footer link). See
  `HOSTING.md` §3.
- **Provenance of URLs:** in prod, feed/canonical/UA URLs derive from `DAYLIGHT_SITE_URL`, **never**
  from a client `Host`/`X-Forwarded-Host` header (cache-poisoning). See `site.ts`
  `originFromRequest()`.
- **Screenshots** (Receipts raw store) must not fill the SQLite volume — prune `/data/raw` or
  offload to R2/Tigris (documented seam: `storeScreenshot()` in `workers/receipts/src/live.ts`).

---

## Code conventions & invariants

- **Idempotency everywhere.** Writes key off `contentHash` (observations), `fqdn`/cert hash
  (subdomains), sentinel observations (Ledger's whole-file + concentration re-emission gates). A
  re-run never double-emits. Preserve this when adding ingest.
- **Provenance on every change.** Populate `sourceUrl` with the exact public artifact (commit-pinned
  CSV blob, crt.sh query, Wayback URL). It renders as a re-verifiable "source →" link.
- **Atomic multi-write runs.** Wrap a run's DB writes in `db.sql.transaction(...)` so an interrupted
  run rolls back and stays re-processable (see `workers/ledger/src/run.ts`).
- **Redaction seam.** Persist page-derived text through `redact()` from `@daylight/redact`; skip
  anything `flagged`. This is a real scrub (emails/SSNs/phones), not a stub.
- **Header/schema drift fails loud.** Ledger verifies the live CISA CSV header before diffing and
  records an error to `/status` on drift rather than mis-mapping columns (`EXPECTED_HEADER`).
- **Neutral copy in every user-facing string.** Scorecards on observed facts (green/amber/red on
  "3 trackers, session replay on, no privacy notice"), never verdicts. The `/methods` page names
  every source, the bot's contact, and the observational-only scope — keep it accurate as behavior
  changes (its assurances must be *literally* true).
- **Swift/iOS rules in the global CLAUDE.md do not apply here** — this is a TypeScript/Next.js web
  project. (The "never use 'enhanced' in identifiers" rule still holds as a general preference.)

### AI agent (Redtape) conventions

The Redtape researcher (`workers/redtape/src/agent.ts`) is the one LLM in the stack. When touching it:

- **Model-agnostic + deferred.** `Researcher` is an interface; CI injects a mock. The real
  implementation (`claudeResearcher`) uses the Anthropic Messages API with **tool use** (it
  actually queries the Federal Register in a loop before concluding — the documented negative must
  be a real search, not a hallucination). Default model `claude-sonnet-5`, overridable via
  `DAYLIGHT_REDTAPE_MODEL`. The pipeline + human gate never depend on it concretely.
- **Strict-JSON parsing with one retry** (`parseAgentJson`); malformed output routes to a manual
  queue and **never publishes**. A gap with an empty query/source trail is rejected on parse.
- **Prompt caching** — the stable system prompt carries `cache_control`, and one moving breakpoint
  trails the growing tool-result conversation (at most 4 `cache_control` blocks per request — clear
  the prior turn's before setting the next, or the API 400s).
- Follow the repo's Anthropic model IDs and API conventions; consult the `claude-api` skill before
  changing model IDs, token limits, or the tool-use loop.

---

## Public surfaces (all read-path over the one SQLite file)

Home `/` (front door + recent activity) · `/registry` (owner search) · `/domain/{name}` (composite
dashboard) · `/ledger` `/lookout` `/floodlight` `/receipts` `/redtape` (per-module) ·
`/floodlight/scan` (on-demand URL scorecard) · `/compare` · `/change/{id}` (permalink) ·
`/corrections` (public retraction ledger) · `/methods` · `/status` + `/status.json` · `/privacy`
(first-party aggregate-only analytics; **no IP/UA/cookie ever stored**) · `/review` (internal,
token-gated, `noindex`) · `/changelog` · `/watchlist`. Feeds: global `/feed.xml` + `/feed.json` and
per-module `/{module}/feed.{xml,json}`. Public JSON API: `/api/v1/{changes,domains,domain/[name],
subdomains,scorecards,gaps}`. Security headers (per-request nonce CSP) live in
`apps/web/src/middleware.ts`.

---

## Gotchas / do-not

- **Don't serve the raw artifact store** (screenshots/DOM). Only `wayback_url`, hashes, and
  reviewed/redacted fields are public.
- **Don't bypass `publicGaps()`** for any Redtape read path. The human gate is a data-layer
  invariant, re-checked on read *and* write.
- **Don't connect to a gated/staging host to "confirm" it.** Existence (from a public log) ≠ access.
- **Don't loosen the SSRF guards** or the reverse-proxy "requires a real beacon" rule — both were
  tightened in an adversarial review; regressing them re-introduces SSRF or false accusations.
- **Don't derive public URLs from request headers in prod** — use `DAYLIGHT_SITE_URL`.
- **Don't commit the DB, `.env`, or research notes.** `data/`, `*.db*`, `.env*`, and
  `drey_research.md` are gitignored; `drey_research.md` (the source research) is intentionally
  untracked and must never enter git history.
- **Don't put a `build/` or DerivedData folder in the repo.** Next build output (`.next/`) is
  gitignored; keep it that way.
- **Don't let the CI deploy path-filter treat `CHANGELOG.md` as docs.** It renders at `/changelog`
  (`apps/web/src/lib/markdown.ts`), so it is site content — the `changes` job in
  `.github/workflows/ci.yml` deliberately keeps it deployable. Broadening the deploy ignore list to
  a blanket `*.md` would silently stop `/changelog` from updating on release.

## Credits

Built with **Claude (Anthropic)** and **Claude Code**. The `/methods` page is where credit,
sources, and scope live together — practicing the transparency we ask of the sites we watch.
