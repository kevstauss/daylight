# Changelog

Plain-language record of what Daylight can do, and when each piece went live.

Everything Daylight does is **observational and built on already-public data**. See
`/methods` for every source, the bot's contact, and the observational-only scope.

## Unreleased — Redirect tracking + a sharper compliance check (2026-07-05)

**A new redirect signal, plus a more thorough Redtape researcher.** Everything below stays
observational and built on already-public data.

**Redtape — a more thorough check.** The compliance researcher used to search only the Federal
Register, so it missed filings that live in agencies' own Privacy Impact Assessment inventories
(where web-tracking coverage actually sits). It now also confirms the operating agency and checks
that agency's PIA library before concluding — so a "no published filing found" is a stronger,
better-sourced negative.

**Receipts — redirect tracking.** Receipts now records when a watched `.gov` page redirects **off its
own domain**, and emits a dated change when a redirect appears, changes target, or goes away. First
finding: **`passports.gov`** — registered to the Executive Office of the President — changed its
redirect from an access/login wall to U.S. Department of State passport content (first observed
2026-07-03; source: the Internet Archive). Current off-domain redirects on other watched apexes were
recorded as dated baselines (`cio.gov` → `councils.gov`; `eop.gov` → `whitehouse.gov`; `rec.gov` →
`recreation.gov`).

**Polish.** Timestamps across the site now show minute precision (`2026-07-01T16:53Z`) instead of
noisy seconds/milliseconds, and the per-domain page's subdomain rows no longer overflow on mobile.

## Unreleased — Cross-agency vendor build-graph dig (2026-07-05)

**A directed dig on the leads the modules keep surfacing.** With the modules running, we pulled the
open anomalies out of the gathered data and dug deeper on public sources only — Certificate
Transparency (crt.sh), the CISA `dotgov-data` registry, Wayback, and public reporting. Everything
below is **existence-only**: no gated host was loaded or entered (many `*.ndstudio.gov` hosts sit
behind a Cloudflare Access gate), and no intent is asserted. Findings that only repeat
[The Drey Dossier](https://substack.com/@thedreydossier)'s existing reporting were dropped;
what's recorded here is the *new* increment. Each was independently fact-checked before landing.

The through-line: one White House vendor — the **National Design Studio** (`ndstudio.gov` / `nds.gov`,
registered to the Executive Office of the President) — is the observable build/staging/telemetry layer
under a fast-growing, **cross-agency** cluster of `.gov` product sites. CT shows EOP-vendor infra
staging properties branded for DoD, DHS, State, NASA/OPM, FBI/DOJ, USDA and Treasury, often days
before public launch. Verified specifics now watched (see `config/watchlist.yaml`):

- **`war.previews.ndstudio.gov`** — a "Department of War" property staged on the EOP vendor while
  `war.gov` itself is registered to the Dept. of Defense (`dma.websd@mail.mil`). Clean baseline: any
  future contact flip toward an `ndstudio.gov` address would trip Ledger's H1.
- **`nasaforce.gov`** — NASA/OPM's openly-announced early-career hiring site, but the apex is
  registered to EOP / White House Office (not NASA/OPM) with a **`(blank)` security contact**, and
  the live footer reads "Designed & Engineered in D.C. by National Design Studio." A new named
  instance of the `passports.gov` pattern (EOP-owned, agency-branded, blank contact).
- **`hstf.prod` / `hstf.previews.ndstudio.gov`** — the DHS Homeland Security Task Force site built on
  NDS infra. `hstf.gov`'s registry contact is legitimately DHS's own (`postmaster@dhs.gov`), so H1
  stays silent — a clean example of a build-linkage the contact heuristics **cannot** see (motivates
  Foundry, below). The `.prod.` env-tier in a public cert is an infra-hygiene note.
- **`boardofpeace.previews.ndstudio.gov`** — the Gaza "Board of Peace" site, staged ~8 days before the
  public charter signing; no `boardofpeace.gov` exists, and the live `boardofpeace.org` loads federal
  telemetry from `cdn.infra.ndstudio.gov`. We can prove the `.gov`-infra dependency, not `.org`
  ownership (the registrant is privacy-protected).
- **`trumpcard.gov` / `trumpira.gov`** — Trump-branded products with ownership scattered across
  agencies: `trumpcard.gov` (the cross-agency "Gold Card" visa) is EOP/DOGE-registered; `trumpira.gov`
  is EOP/White House Office with a `(blank)` contact even though its founding EO directs the Treasury
  to run it — an owner-vs-statutory-operator split alongside `trumpaccounts.gov` (Treasury).
- **`sweetrex.int` / `sr-input.int.ndstudio.gov`** — an internal (`.int`) tier for **SweetREX**, the
  reported DOGE deregulation-AI tool, fingerprinted purely from cert names.
- **NDS AI/collection stack** — `inference`, `chat.staging`, `chat-embed.staging`, `upload`,
  `storybook` under `ndstudio.gov`: a first-party LLM-chatbot + intake surface (NDS's own blog
  confirms an "ask anything" site chatbot). Recorded as a collection **surface to watch**, not a
  demonstrated breach.
- **`fbi-kirk-tipline.previews.ndstudio.gov`** — an FBI-branded tip host under the White House vendor
  apex, first seen in CT the night after the Sept 10 2025 shooting and actively renewed since. Framed
  strictly as existence + timing in a sensitive investigation; **no claim** is made about whether it
  serves or collects anything.
- **Registry hygiene, quantified** — EOP domains carry a `(blank)` security contact at **24% (16/66)**
  vs a **10.2%** registry-wide baseline (2.4×), and the EOP vanity/product footprint roughly doubled
  in H1 2026. `PITC-Defense@eop.gov` (25 domains) and `dl.eop.cloudadmin@eop.gov` (18) are the shared
  mailboxes — reported as counts, never as an assertion of intent.

## Unreleased — Foundry (Phase 6): the vendor build-graph module

**A sixth module, because the dig kept hitting a signal the five couldn't emit — the join of CT and
the registry.** Lookout scores one subdomain under an apex already on its list; Ledger states one
registry fact per row. Neither can say *how many distinct agencies are built through one vendor*, or
*which staged projects have no `.gov` yet* — because that needs both streams joined and aggregated.
Foundry does exactly that, reusing Lookout's ingested CT subdomains and Ledger's registry (no new
data source, existence-only):

- **Build-concentration index** — for each vendor apex (detected structurally, not hard-coded: one
  whose build tree stages ≥2 distinct registered target apexes), the distinct owning agencies whose
  properties flow through it. This is orthogonal to Ledger's *contact*-concentration and catches what
  H1 can't: `hstf.gov`'s registry contact is legitimately DHS's own, so H1 stays silent, yet the
  NDS build linkage is real and Foundry surfaces it.
- **Unlaunched-project watch** — projects staged on the vendor tree whose candidate `.gov` apex is
  confirmed **absent** from the registry (`fbi-kirk-tipline`, `boardofpeace`, `forestandrangelands`,
  …). Lookout structurally can't produce this — it only watches apexes already on its list. Emits one
  idempotent `added` change per newly-seen project (so the global feed carries it, once).

Ships flag-gated (`FLAG_FOUNDRY`) like every other surface: a `/foundry` page (build-concentration
index + unlaunched watch per vendor), a `runFoundryScan` that records a `/status` scan and runs on
`DAYLIGHT_FOUNDRY_CRON` (a beat after the Lookout backfill, since it reads fresh certs), and a
`report` CLI. Attribution carries a confidence flag — short single-word codes (`rx`, `dga`) are
marked low-confidence, since a name alone can't prove an agency owns a build. Tested against the real
observed `*.ndstudio.gov` fixtures (10 cases) and validated end-to-end against live crt.sh + CISA
(8 agencies through the one EOP vendor tree). The other four ideas from the dig — registry-hygiene
metrics, minting-velocity, a first-party collection-surface detector, and CT-SAN infra recon — fold
into Ledger, Floodlight and Lookout respectively rather than standing up as modules.

## Unreleased — Analytics: exclude operator traffic + reset; mobile table fix

**Counts you can trust at low traffic.** The operator's own visits can now be left out of the
`/privacy` analytics: set `DAYLIGHT_ANALYTICS_EXCLUDE_IPS` (exact IPs or trailing-dot/colon
prefixes) and matching requests aren't recorded. The client IP is read transiently only to make
that skip decision and is **never stored or logged** — the "no IP is ever written" pledge holds.
A new `pnpm analytics:reset` CLI wipes already-recorded hits for a clean start (`--yes` to confirm;
`fly ssh console -C "pnpm analytics:reset --yes"` in prod).

**Bots don't count as visitors.** Automated clients — search-engine and SEO crawlers, and AI
assistants/answer-engines including Daylight's own Claude Code fetches (whose User-Agent carries
`claude`/`anthropic`) — are now excluded from the counts by a built-in User-Agent list, so "visits"
means people. Like the IP above, the User-Agent is read transiently only for that skip decision and
is **never stored or logged**. Generic HTTP tools (`curl`/`python`/`wget`) are deliberately not on
the list, so real API and feed consumers still count; extend it with `DAYLIGHT_ANALYTICS_EXCLUDE_UA`
if a bot slips through. Also: the `/status` table no longer forces a page-wide horizontal scroll on
mobile — wide tables now scroll within their own block.

**A structural backstop the User-Agent list can't be tricked past.** A visit is now required to be
a real browser navigation (`Sec-Fetch-Dest: document`); a request with no `Sec-Fetch-Dest` is a
non-browser client (a script, crawler, or AI agent — including one behind a proxy that rewrote the
`User-Agent` so the allowlist never sees `claude`/`anthropic`) and is counted **only** for the
`/feed` and `/api` consumption buckets, never as a page view. Previously any header-less GET to a
page path was counted, which let a disguised automated client inflate the numbers even when the UA
check missed it. `Sec-Fetch-Dest` is read transiently for this decision and, like the IP and UA, is
**never stored or logged**. Note: this ships in code but is **not live until deployed** — there is
no auto-deploy from GitHub yet, so a manual `fly deploy` is required, followed by a one-time
`fly ssh console -a daylight-watchdog -C "pnpm analytics:reset --yes"` to clear counts inflated
before the filter was live.

## Unreleased — Privacy page + first-party analytics

**We measure others; here's exactly what we do.** A new public `/privacy` page states the
data pledge — no cookies, no third parties, no IP addresses or user-agents, Do-Not-Track
honored — and then shows it live. Analytics are first-party and aggregate-only: one small
table of per-day, per-page counts with **no column that could identify a visitor**. The page
also surfaces which federal `.gov` pages link to Daylight (read from the referrer, never from
anyone's network), a self-scorecard against Floodlight's own checks, and aggregate feed/API
pull counts. A "visit" is a real page load — link prefetches are structurally excluded, so the
numbers don't inflate themselves. Plus a reader-support link and a proper mobile nav menu.

## Unreleased — Hardening pass (adversarial review fixes)

**A watchdog has to hold up to the scrutiny it applies.** A multi-agent adversarial review of
Phases 2–6 (each finding independently verified) surfaced 15 real defects; all are fixed, and
each fix ships with a regression test so it can't quietly come back (test suite 69 → 86):

- **Live-capture SSRF, closed properly.** The `robots.txt` pre-flight fetch no longer follows
  redirects to unvetted hosts (it validates every hop and refuses private/loopback/metadata
  targets), the browser now **pins the exact IP** it connects to so a rebinding host can't
  swap in `169.254.169.254` after the check, service workers and WebSocket handshakes are held
  to the same host allowlist, and the misleading "DNS rebinding is closed" comments are gone
  (the complete guarantee is a network-level egress filter, noted for the deploy).
- **No false accusations.** The reverse-proxy-disguise heuristic now requires a real analytics
  beacon (a POST/XHR with a matching body), so an ordinary `.gov` content page at `/decide/…`
  or `/s/…` is never flagged "high." Duplicate analytics beacons collapse to one finding
  instead of flooding the review feed. The subdomain-mimic check no longer flags a service
  hosted under its own legitimate owner, and it names the *real* service being imitated.
- **The history backfill can't be silently poisoned.** A transient GitHub failure (or an empty
  commit list) now fails loudly and stays retriable instead of writing its "done" marker over
  an empty run; a truncated/empty registry revision is skipped instead of emitting a phantom
  removal of every domain.
- **Registrable-domain correctness** for state and local government: `www.smithville.k12.tx.us`
  is no longer folded into `tx.us` (which would collide every Texas school district).
- **Gate tightening:** the Floodlight scan kill-switch is re-checked inside the server action,
  the Lookout wide sweep keeps its always-on `.gov` scope filter, and a Redtape gap with a
  blank or missing search trail can never reach the public path (enforced on read *and* write).

**Review queue auth moved off the URL.** Reviewer sign-in at `/review` now sets an HttpOnly,
Secure, SameSite=Strict cookie instead of carrying the token in the query string — so it can't
leak through server logs or a `Referer` header — and the route is served `no-referrer` /
`no-store` / `noindex`.

## Unreleased — Ledger git-history backfill

**We launched late, but the record didn't start today.** The CISA registry is a git repo, so
Daylight can replay it: `pnpm ledger:history` lists the ~489 commits that touched
`current-federal.csv` (Feb 2019 → today), fetches each revision, and diffs them — emitting
every ownership and security-contact change **dated to its actual commit**, run through the
same heuristics and watches as the daily pass. So the site launches with *years* of real,
dated changes it "missed" by not watching live — including new-EOP-domain and contact-mismatch
flags on past events. The first commit is a silent baseline (no "added" flood for the ~1,300
domains that predate us); it's idempotent (a completion marker makes a re-run a no-op, and a
transient upstream failure never writes it); and it reads only the public repo.

**Across every schema era.** CISA's CSV header changed three times since 2019 (`Agency,
Organization` → `Agency,Organization name` → `Organization name,Suborganization name`), but the
columns never moved. The backfill recognizes each historical header explicitly and maps them
positionally, so it replays the *whole* record rather than only the current-schema era — the
live daily pass still verifies the current header exactly and fails loud on any drift. Verified
end-to-end on live data: a full run recovered **11,455 dated changes across 2021–2026** (the
registry's real activity begins ~2021, when CISA began actively maintaining it), with the H1
contact-mismatch heuristic firing correctly on historical events (e.g. a `.mil` security
contact on a DoD `.gov`). A `--reset` flag rebuilds cleanly without duplicating prior rows.

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

**Live capture is now built** (behind `FLAG_FLOODLIGHT_SCAN`): a Playwright adapter loads a
public page once, captures every request + DOM facts + a screenshot, and a **"scan this URL"
box** at `/floodlight/scan` scores any public page on demand. Guardrails are enforced in code:
public http(s) only with **SSRF blocking** (private/loopback/cloud-metadata refused), robots.txt
respected, an honest User-Agent, and an access-gated page (Cloudflare Access / SSO) is noted as
existing but **never entered** — no forms submitted, nothing clicked. Tested against local
fixtures + a real public page; verified the metadata endpoint is refused. Off by default (it
needs a browser in the image and ~1 GB RAM); running scheduled sweeps is still a host decision.

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

The **internal review queue is now built**: `/review` (gated by `DAYLIGHT_REVIEW_TOKEN`,
`noindex`, 404 when no token is configured) lists unreviewed gaps with their evidence +
search trail and **Publish / Hold / Reject** controls. Publish is the only path to the public
`/redtape` — and the gate is enforced in the data layer, so an unreviewed gap can never leak
(verified end-to-end: the queue shows it, the public page and feed do not). Reviewer sign-in
sets an **HttpOnly, Secure, SameSite=Strict cookie** — the token is never carried in the URL or
a form field, so it can't leak through server logs or a `Referer` header — and the route is
served `no-referrer` / `no-store` / `noindex`. A `redtape:assess` CLI turns Floodlight
collection evidence into queued gaps via the researcher.

Deferred: wiring the live researcher (needs `ANTHROPIC_API_KEY` + a reviewer). The pipeline,
the gate, the parsing, the queue, and the model-agnostic researcher interface are all built.

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
