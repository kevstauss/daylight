# Hosting Daylight — Phase A go-live runbook

This is the operator runbook for taking Daylight from "engines built, fixture-tested, frozen" to
"always-on, cheap, one machine." It is deliberately **cheap and boring**: one Fly.io machine runs
the Next.js read-path *and* the scheduled workers in-process, all sharing **one SQLite file on one
Fly volume**. No Postgres, no certstream, no second machine, no message queue.

> **Scope of this document.** It describes configuration and the exact steps *you* run. It does
> **not** provision anything. Nothing here bills until you run `fly deploy` / `fly volumes create` /
> `fly secrets set`. Where a step needs your Fly auth, it's called out.

---

## 1. What's already in the repo (you don't build this)

Phase A is mostly wired already — this runbook is about turning it on, not writing it:

| Piece | Where | Status |
|---|---|---|
| Fly app config | `fly.toml` | App `daylight-watchdog`, region `iad`, `shared-cpu-2x` / 2 GB, 512 MB swap, `/data` volume mount, `/status` health check. |
| Image (incl. browser) | `Dockerfile` | `node:22-slim` + build toolchain for `better-sqlite3` + **headless Chromium** (`playwright install --with-deps chromium`, ~400 MB). |
| In-process schedulers | `apps/web/src/instrumentation.ts` | Cron for **Ledger**, **Lookout (crt.sh)**, **Floodlight sweep**, **Receipts sweep + Wayback**, **Redtape** — each activates only when its `DAYLIGHT_*_CRON` env var is set. |
| SQLite spine | `packages/db` | One file at `DAYLIGHT_DB_PATH=/data/daylight.db` (WAL mode; web reads while the worker writes). Schema is applied + additively migrated on every open. |
| Human gate | `packages/db` `publicGaps()` + `/review` | Redtape gaps are public only when `human_reviewed=1 AND published=1` with a non-empty search trail. Enforced in the data layer. |

The default cron schedule (already in `fly.toml [env]`, all UTC, staggered so the single machine
isn't hit at once):

```
DAYLIGHT_LEDGER_CRON     = "17 0 * * *"     # daily 00:17 — CISA registry diff
DAYLIGHT_LOOKOUT_CRON    = "40 1 * * *"     # daily 01:40 — crt.sh subdomain poll (existence-only)
DAYLIGHT_FLOODLIGHT_CRON = "0 3 * * 1"      # weekly Mon 03:00 — tracker sweep (browser-heavy)
DAYLIGHT_RECEIPTS_CRON   = "0 4 * * 1,4"    # Mon+Thu 04:00 — snapshot + removal diff + Wayback push
DAYLIGHT_REDTAPE_CRON    = "0 5 * * 1,4"    # Mon+Thu 05:00 — AI gap-finder (idempotent, human-gated)
```

You can adjust cadence by editing `fly.toml [env]` (or `fly secrets set` for an override) and
redeploying — no code change.

---

## 2. Cost posture (why this stays cheap)

- **One `shared-cpu-2x` / 2 GB machine, always on.** It has to stay up so the in-process crons
  fire (`min_machines_running = 1`, `auto_stop_machines = "off"`). ~$0.02/hr class.
- **SQLite on a 1 GB volume**, not Postgres. The whole federal `.gov` registry + years of diffs is
  a few tens of MB. Keep it on SQLite until read concurrency actually hurts (it won't at this
  traffic). This is the single biggest cost avoidance.
- **crt.sh instead of certstream.** The nightly crt.sh poll (existence-only, 2 s between apexes) is
  free and needs no always-on websocket worker. A missed cert is recoverable from the public CT
  record forever; certstream is a later, optional upgrade.
- **Screenshots are the one thing that grows** — see §5. Keep them off the SQLite volume (or pruned)
  so the volume stays tiny.
- **Redtape runs on a cheap model, twice a week, human-gated** — a few Anthropic calls per sweep,
  not a standing cost. See §6.

The one loss-bearing choice: page **snapshots** (Receipts) are irreplaceable — a page state never
captured is gone. So turn the **Receipts + Floodlight sweeps on first** (they need only cron + the
browser image + Wayback), and leave certstream/Postgres for later.

---

## 3. Secrets to set (`fly secrets set` — needs your Fly auth)

Secrets are encrypted and injected at runtime; unlike `[env]` in `fly.toml` they aren't in the repo.
Set these once (`-a daylight-watchdog`), then `fly deploy`:

```bash
# Redtape AI researcher (Phase 5). Without it, the Redtape cron logs "skipped" and does nothing —
# safe to leave unset until you want gap-finding. Use YOUR existing Anthropic key.
fly secrets set ANTHROPIC_API_KEY="sk-ant-..." -a daylight-watchdog

# Cheap model for Redtape drafting (default is claude-sonnet-5; Haiku is plenty for FR search).
fly secrets set DAYLIGHT_REDTAPE_MODEL="claude-haiku-4-5-20251001" -a daylight-watchdog

# Gate for the internal /review queue (any long random string). /review 404s until this is set;
# nothing publishes without a human clicking Publish there.
fly secrets set DAYLIGHT_REVIEW_TOKEN="$(openssl rand -hex 24)" -a daylight-watchdog

# A REAL public contact for /methods, the dispute links, and responsible disclosure. Bare email or
# a full URL both work (a bare email is turned into a mailto:). Do set this — the code falls back to
# a placeholder mailbox and warns loudly in prod otherwise.
fly secrets set DAYLIGHT_CONTACT="tips@daylight.watch" -a daylight-watchdog

# Turn ON the independent Wayback archive push during Receipts sweeps (recommended for go-live).
fly secrets set DAYLIGHT_WAYBACK="1" -a daylight-watchdog

# OPTIONAL — a funding/donation link shown in the footer + /methods. Omit to hide it entirely.
# Recommended platform: GitHub Sponsors (no fees, developer-native). Alternatives: Ko-fi / Buy Me a
# Coffee (one-off tips, low friction) or Open Collective (transparent public ledger — on-brand).
fly secrets set DAYLIGHT_FUNDING_URL="https://github.com/sponsors/kevstauss" -a daylight-watchdog
```

`DAYLIGHT_SITE_URL` is already set in `fly.toml [env]` (`https://daylight.watch`). Change it there if
you attach a different domain, and redeploy — feeds, canonical URLs, cite blocks, and the bot's
User-Agent all derive from it.

---

## 4. Environment variables (already in `fly.toml`)

These live in `fly.toml [env]` (non-secret) — review, don't re-set:

| Var | Value | Purpose |
|---|---|---|
| `DAYLIGHT_DB_PATH` | `/data/daylight.db` | SQLite on the Fly volume. |
| `DAYLIGHT_SITE_URL` | `https://daylight.watch` | Public origin (feeds/canonical/UA). |
| `DAYLIGHT_*_CRON` | see §1 | Enables each scheduled worker. |
| `FLAG_LEDGER_*` / `FLAG_LOOKOUT` / `FLAG_FLOODLIGHT[_SCAN]` / `FLAG_RECEIPTS` / `FLAG_REDTAPE` | `1` | Surface gates. Flip a flag to `0` and redeploy to hide an unfinished surface without a branch. |

New surfaces added in this pass need **no new config** — the public JSON API (`/api/v1/*`),
`/change/{id}` permalinks, `/compare`, `/corrections`, and `/status.json` are all read-path over the
same SQLite file.

---

## 5. Screenshots — keep them off the SQLite volume

Receipts stores a full-page PNG per snapshot in the **raw store** (`DAYLIGHT_RAW_DIR`, default
`/data/raw` — i.e. on the SQLite volume). The raw store is **never served publicly**; only the
`wayback_url`, the `dom_hash`, and reviewed/redacted fields are public. But screenshots accumulate,
so they must not be allowed to fill the SQLite volume.

**Cheapest go-live default (zero new services): prune the local raw store.** Add a retention cron on
the machine, e.g. keep 30 days:

```toml
# fly.toml — a scheduled prune so /data/raw can't grow unbounded (adjust the window to taste).
[[services.machine_checks]]   # or run via `fly machine run`/an external scheduler
  # find /data/raw -type f -name '*.png' -mtime +30 -delete
```

Or the simplest possible: bump the volume a little and prune by hand periodically
(`fly ssh console -a daylight-watchdog -C "find /data/raw -mtime +30 -delete"`). At Receipts' cadence
(a few dozen homepages, 2×/week) 30 days of PNGs is well under a GB.

**Recommended upgrade (object storage, effectively free at this scale): Cloudflare R2 or Fly Tigris.**
Both are S3-compatible and have a generous free tier. This keeps the SQLite volume tiny and makes the
raw store independent of the machine.

- Provision (you): create an R2 bucket (or `fly storage create` for Tigris) and get an S3 key/secret.
- Set: `fly secrets set S3_ENDPOINT=... S3_BUCKET=... AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...`.
- Code seam (one function): `storeScreenshot()` in `workers/receipts/src/live.ts` writes the PNG to
  `rawDir()`; swap that write for an S3 `PutObject` and store the object key as `screenshot_ref`.
  This is the only code change, and it's isolated to that one function — nothing else touches the
  raw store. (Left as a documented follow-up so go-live needs no new bucket.)

Either way: set a lifecycle/retention rule (R2 lifecycle, or the prune cron) so old screenshots age
out. The **durable public record is the Wayback URL + content hashes**, not our own PNG.

---

## 6. Redtape (AI gap-finder) — cheap + human-gated

- Runs only when `ANTHROPIC_API_KEY` is set (else the cron logs `skipped`).
- Uses `DAYLIGHT_REDTAPE_MODEL` — set to a **cheap model** (`claude-haiku-4-5-20251001`); Federal
  Register search doesn't need a large model. A sweep is a handful of calls (only NEW collection
  evidence is assessed; unchanged evidence is deduped), 2×/week.
- **Nothing it drafts is public.** Assessments land unreviewed. A human opens `/review` (gated by
  `DAYLIGHT_REVIEW_TOKEN`, cookie-auth, `noindex`), reads the evidence + the exact search trail, and
  clicks **Publish** / **Hold** / **Reject**. Only Publish makes an item visible on `/redtape`, and
  the gate is enforced in the DB layer (`publicGaps()`), not just the screen.
- If a later sweep finds a covering filing now exists, the gap is auto-pulled from public and logged
  as a **public correction** on `/corrections` — we never un-publish silently.

---

## 7. Floodlight sweep scope (daily watchlist now; full registry later)

The wired sweep (`instrumentation.ts` → `sweepHosts()`) covers **`CURATED_GOV` (~60 high-traffic /
high-PII apexes) + the watchlist apexes + subdomain apexes** — ~70 homepages, load-only. That's the
cheap, high-signal default and runs comfortably on the 2 GB machine.

The **full weekly sweep of all ~1,343 federal apexes** is the neutrality/coverage upgrade (a standing
tracker census nobody else has). It is **not** wired yet, deliberately — it's the heavier step. To
enable it later without blowing the machine:

- Pull the host list from the DB (`db.allDomains()`) instead of the curated set.
- **Chunk it**: sweep ~190/day across the week (Chromium peaks at a few hundred MB per page), or run
  the full sweep on a **separate scheduled Fly Machine** sized `shared-cpu-2x` / **2–4 GB** that
  `fly machine run`s weekly, writes to the same volume, and exits. Keeps the always-on web machine
  small.
- Cadence guidance is already surfaced on `/status` (the sweep shows `overdue` if it stops).

Until then, the daily watchlist + curated sweep is the go-live scope, and it's honest about coverage
on `/methods`.

---

## 8. First-run manual steps (once, after first deploy)

The daily crons diff *forward* from now. To get history and cert backfill in place first, run these
once against the deployed machine (they're idempotent / safe to re-run):

```bash
# 1. Backfill the full CISA git history so dated ownership/contact changes exist from day one.
fly ssh console -a daylight-watchdog -C "pnpm --filter @daylight/ledger history"

# 2. Backfill crt.sh subdomains for the watched apexes (flaky under load — watch the first run).
fly ssh console -a daylight-watchdog -C "pnpm --filter @daylight/lookout backfill"
```

(The Ledger daily cron also auto-seeds a silent baseline on first boot if the registry table is
empty, so even without step 1 you won't get a flood of phantom "added" events.)

---

## 9. Operator checklist (do these in order)

1. **Authenticate**: `fly auth login`.
2. **Create the volume** (once): `fly volumes create daylight_data --region iad --size 1 -a daylight-watchdog`.
3. **Set secrets** (§3): at minimum `DAYLIGHT_CONTACT`, `DAYLIGHT_REVIEW_TOKEN`, and `DAYLIGHT_WAYBACK=1`.
   Add `ANTHROPIC_API_KEY` + `DAYLIGHT_REDTAPE_MODEL` when you want Redtape; add `DAYLIGHT_FUNDING_URL`
   if you want the Support link.
4. **Review `fly.toml`** cadence + flags (§1, §4). Defaults are sane; edit if you want a different
   schedule or to hide a surface.
5. **Decide screenshot storage** (§5): keep the volume-prune default, or provision R2/Tigris and set
   its S3 secrets.
6. **Deploy**: `fly deploy` (builds the image incl. Chromium; ~5–8 min first time).
7. **Backfill once** (§8): Ledger history, then Lookout crt.sh.
8. **Verify** (§10): hit `/status` and `/status.json`; confirm each module is `ok` (not `overdue`),
   and that a change with a working `source →` link shows on the home feed.
9. **Redtape workflow** (§6): once assessments accumulate, review at `/review` and Publish the real
   gaps. Nothing is public until you do.
10. **Announce**: write a `/changelog` entry; the feeds and `/api/v1/*` are live for reporters/tools.

---

## 10. Verifying it's healthy

- **`/status`** shows each module's last run, expected cadence, and health. A stopped scheduler shows
  **`overdue`** (not a stale "ok") — that's the "silently-dead watchdog" detector.
- **`/status.json`** is the machine-readable version (`ok:false` ⇒ something is overdue or errored).
  Point an external uptime monitor at it so *Daylight itself* is watched.
- **Fly health check** already pings `/status` every 30 s (`fly.toml [[http_service.checks]]`).
- **Logs**: `fly logs -a daylight-watchdog` — each cron logs a one-line summary (`[ledger:cron] …`,
  `[floodlight:cron] sweep — N scanned …`, etc.).
- **Data flowing**: after the first daily passes, the home feed lists changes with a `source →` link;
  `/api/v1/changes?limit=5` returns them as JSON.

---

## 11. What is deliberately NOT in Phase A

Kept out to hold the line on cost/complexity; all are clean later upgrades, none block go-live:

- **certstream** (real-time CT websocket) — crt.sh nightly poll covers it; missed certs are
  recoverable.
- **Postgres** — SQLite is fine at this scale; migrate only when read concurrency demands it (the DB
  query layer already abstracts callers, so the swap won't touch pages).
- **Full ~1,343-apex weekly Floodlight sweep** — see §7; enable via chunking or a separate scheduled
  machine when you want the full census.
- **R2/Tigris screenshot offload** — documented seam in §5; the prune-the-volume default is the cheap
  go-live path.
- **Webhook/email alert delivery** — RSS/JSON feeds + the API are the Phase A distribution surface.
