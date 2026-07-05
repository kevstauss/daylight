# Changelog

What Daylight does, and what's been added or changed along the way. Everything here is
**observational and built on already-public data** — see [`/methods`](/methods) for every source, the
bot's contact, and the observational-only scope.

## Severity grades only what the data shows — 2026-07-05

- A **tracker being removed** from a `.gov` is now **notable**, not high. On the data alone a tracker
  vanishing means the page became *less* invasive; reading it as alarming ("they got caught and
  scrubbed it") takes context from outside the data, so it now matches a tracker *being added*
  (also notable) instead of out-ranking it. The removal is still recorded in the dated removal
  ledger with before/after — that record is the point; the severity just stops implying a motive.
- Losing a **privacy notice** or an **agency seal** stays **high**: those are data-supported
  regressions in disclosure and provenance, visible without any outside story. Existing tracker-
  removal findings were reclassified to match.

## Homepage: what we're seeing, in plain language — 2026-07-05

- The front page now opens with a rotating set of recent findings written for a first-time reader.
  Each is a **plain-language headline** — "A subdomain of `ndstudio.gov` is named to look like
  `travel.state.gov`," not `new subdomain … — high-signal subdomain label …` — followed by a short
  **why it matters** note and a link to the full, timestamped finding.
- Headlines are generated **deterministically** from the finding's own data (one fixed template per
  finding type), so they stay factual and never drift into a verdict. Anything unrecognized falls
  back to the detector's exact wording.
- The set **rotates**: three findings picked at random, each a distinct domain **and** a distinct
  finding type, so the homepage stays fresh and never shows three near-identical lines. Bucketing by
  type before the draw gives a rare-but-striking finding (a look-alike subdomain) the same odds as a
  type with thousands of rows — sheer volume doesn't win.
- It leads the page, above the module list: concrete findings first (the "show"), the catalog of
  what Daylight watches second.
- Copy stays observational — the "why it matters" describes the *category* of finding, never a
  specific agency. The section reads only already-public change records, never the human-gated
  privacy-filing queue.

## Redirect tracking + sharper compliance checks — 2026-07-05

- **Redirect tracking.** Daylight now records when a watched `.gov` page redirects **off its own
  domain**, and logs a dated change when a redirect appears, changes target, or disappears.
  - First finding: `passports.gov` — registered to the Executive Office of the President — switched
    its redirect from an access/login wall to U.S. Department of State passport content (first seen
    2026-07-03; source: the Internet Archive).
  - Baselines recorded for other watched apexes that currently redirect off-domain:
    `cio.gov → councils.gov`, `eop.gov → whitehouse.gov`, `rec.gov → recreation.gov`.
- **Deeper privacy-filing research.** The Redtape researcher now confirms which agency runs a site
  and checks that agency's own Privacy Impact Assessment inventory — not just the Federal Register —
  before concluding, so "no published filing found" is a stronger, better-sourced negative.
- **Polish.** Minute-precision timestamps site-wide (`2026-07-01T16:53Z` instead of noisy
  seconds/milliseconds); the per-domain page's subdomain rows no longer overflow on mobile.

## The National Design Studio cluster — a cross-agency vendor build-graph

A directed dig on the leads the modules kept surfacing, on public sources only (Certificate
Transparency, the CISA registry, the Internet Archive, public reporting) and existence-only — no
gated host was entered, no intent asserted. The through-line: one White House vendor, the **National
Design Studio** (`ndstudio.gov` / `nds.gov`, registered to the Executive Office of the President), is
the observable build/staging/telemetry layer under a fast-growing, cross-agency cluster of `.gov`
product sites — often staged days before public launch.

- `war.previews.ndstudio.gov` — a "Department of War" property staged on the EOP vendor, while
  `war.gov` itself is registered to the Dept. of Defense.
- `nasaforce.gov` — NASA/OPM's early-career hiring site, but the apex is registered to EOP / White
  House Office (not NASA/OPM) with a blank security contact; the footer credits the National Design
  Studio.
- `hstf.previews.ndstudio.gov` — the DHS Homeland Security Task Force site on NDS infra. Its registry
  contact is legitimately DHS's own, so the contact heuristic stays silent — a build linkage only the
  Foundry module can see.
- `boardofpeace.previews.ndstudio.gov` — the Gaza "Board of Peace" site, staged ~8 days before the
  public charter signing; no `boardofpeace.gov` exists.
- `trumpcard.gov` / `trumpira.gov` / `trumpaccounts.gov` — Trump-branded products with ownership split
  across agencies (EOP/DOGE, EOP/White House Office, and Treasury) despite their statutory operators.
- NDS AI/collection stack (`inference`, `chat.staging`, `upload`, `storybook`, …) — a first-party
  chatbot + intake surface, recorded as a collection surface to watch, not a demonstrated breach.
- `fbi-kirk-tipline.previews.ndstudio.gov` — an FBI-branded tip host under the White House vendor
  apex, first seen the night after the Sept 10 2025 shooting (existence + timing only; no claim about
  what it serves).
- **Registry hygiene, quantified:** EOP domains carry a blank security contact at 24% (16/66) vs a
  10.2% registry-wide baseline (2.4×); the EOP vanity/product footprint roughly doubled in H1 2026.

## The modules — what each one watches

Daylight is six modules writing to one shared timeline of observations and changes.

- **Ledger — ownership & security contacts.** Reads CISA's public `.gov` registry
  (`cisagov/dotgov-data`, ~1,343 apex domains) every day and records every ownership or
  security-contact change, each linked to the exact public source row.
  - Search any federal `.gov` at `/registry`; see a domain's full history at `/domain/{name}`;
    subscribe at `/ledger/feed.{xml,json}` (filter with `?severity=high`).
  - **Contact-mismatch flag:** flags a domain whose published security contact is an email at an
    *unrelated* agency's `.gov` (e.g. `usadf.gov` listing `akash@ndstudio.gov`) — and clears the
    legitimate same-organization case (`vote.gov → security@eac.gov`, both the Election Assistance
    Commission). A second flag catches one foreign apex serving as the contact for several agencies.
  - Verifies the live registry's columns before diffing and fails loudly on drift; idempotent
    (re-running the same data emits nothing); driven by `config/watchlist.yaml`.
  - **History backfill:** replays the registry's full git history — 11,455 dated changes across
    2021–2026 — across all three of CISA's historical CSV formats, so the record didn't start the day
    Daylight launched.

- **Lookout — new certificates & subdomains.** Reads public Certificate Transparency logs so a new
  `.gov` subdomain surfaces the day its certificate is issued, enriched with who owns the apex.
  Existence-only — it records that a cert exists and never connects to the host.
  - `/lookout` feed + `/lookout/feed.{xml,json}`; the subdomains for an apex show on `/domain/{name}`.
  - **Flag scoring:** high-signal labels (`previews` / `staging` / `infra` / …), a **function-mimic**
    check (a name imitating another agency, e.g. `vote-gov.previews.ndstudio.gov`), and a
    collection/inference-infra flag (`analytics.infra.ndstudio.gov`).

- **Floodlight — trackers & session replay.** A "Blacklight for `.gov`": loads a public page once and
  scores what's watching you.
  - **Reverse-proxy disguise detection:** flags a *first-party* endpoint whose path or POST body
    matches a known analytics SDK — the adblocker-evasion trick — including the AutoMonitor signature
    (`{session_id, events[]}` to an `analytics.infra.<apex>` host). Requires a real analytics beacon
    before flagging, so ordinary content paths aren't accused.
  - Session-replay detection, third-party tracker classification, and a privacy-notice cross-check
    (does the page even link one?).
  - `/floodlight` plus a "scan this URL" box at `/floodlight/scan` that scores any public page on
    demand.
  - Guardrails in code: public `http(s)` only with SSRF blocking (private/loopback/cloud-metadata
    refused), robots.txt respected, an honest User-Agent, and an access-gated page (Cloudflare Access
    / SSO) noted as existing but **never entered**.

- **Receipts — what quietly changed or vanished.** Snapshots a page and flags what disappeared — a
  **tracker removed**, a **privacy notice removed**, an **agency seal removed** — each a dated,
  high-severity event with before/after, turning "we took it down" into a record. Also tracks
  off-domain **redirects** (above). `/receipts` + `/receipts/feed.*`. Each snapshot can carry an
  independent Internet Archive copy; the raw store (screenshots/DOM) is never served publicly.

- **Redtape — PII collection with no privacy filing.** Finds sites collecting personal information
  with no published Privacy Impact Assessment or System of Records Notice, via an AI research agent
  behind a **mandatory human-approval gate** (enforced in the data layer — nothing agent-generated
  reaches the public path without a human publishing it).
  - Distinguishes `no_filing` from `incomplete_filing` (a filing that omits the specific processor)
    from `covered`.
  - Every finding carries the exact searches run + sources checked, so anyone can re-verify the
    absence; copy is careful and dated ("no published PIA found as of {date}; searches below"), never
    "illegal."
  - `/redtape` shows reviewed findings; publishing happens through an internal, token-gated review
    queue.

- **Foundry — vendor build-graph.** Joins Lookout's CT subdomains with Ledger's registry to answer
  what neither can alone: how many distinct agencies are built through one vendor, and which staged
  projects have no `.gov` yet.
  - **Build-concentration index:** per vendor apex, the distinct owning agencies whose properties flow
    through it (catches the `hstf.gov` case the contact heuristic can't).
  - **Unlaunched-project watch:** projects staged on a vendor tree whose candidate `.gov` is confirmed
    absent from the registry (`fbi-kirk-tipline`, `boardofpeace`, …). `/foundry`.

## The dashboard & front door

- **`/domain/{name}`** composes all six modules on one page — ownership + contact flag, CT subdomains
  + mimic flags, the tracker scorecard, snapshots + the removal ledger, and reviewed privacy-filing
  findings — with a source link and a "last checked" time on every claim, degrading gracefully to
  "not yet scanned / not yet watching."
- **Home** is an Explore grid of the live modules plus recent activity; the global `/feed.xml` +
  `/feed.json` merge every module's changes, newest first.
- **Design:** Public Sans (the US government's own typeface) with IBM Plex Mono for every machine fact
  (domains, contacts, hashes, UTC timestamps); a cool institutional palette with oxblood reserved for
  high-severity flags; a lamplit dark mode that follows the OS preference with a persistent toggle
  (no flash on load).

## Privacy & first-party analytics

- A public `/privacy` page states the pledge — no cookies, no third parties, no IP addresses or
  user-agents stored, Do-Not-Track honored — and shows it live: aggregate per-day, per-page counts
  with **no column that could identify a visitor**.
- Also surfaces which federal `.gov` pages link to Daylight (from the referrer, never anyone's
  network), a self-scorecard against Floodlight's own checks, and aggregate feed/API pull counts.
- A "visit" must be a real browser navigation, and operator/bot traffic (crawlers, AI assistants, and
  Daylight's own fetches) is excluded — the IP, User-Agent, and navigation type are read transiently
  for that decision and never stored.

## Hardening — an adversarial review

A multi-agent adversarial review found 15 real defects; all fixed, each with a regression test.

- **SSRF closed properly:** the `robots.txt` pre-flight validates every redirect hop and refuses
  private/loopback/metadata targets; the browser pins the exact IP it connects to (no DNS-rebinding
  swap); service workers and WebSockets are held to the same allowlist.
- **No false accusations:** the reverse-proxy heuristic requires a real analytics beacon before
  flagging "high"; duplicate beacons collapse to one finding; the mimic check no longer flags a
  service under its own legitimate owner.
- **Trustworthy backfill:** a transient upstream failure or empty commit list fails loudly and stays
  retriable instead of writing a "done" marker; a truncated registry revision is skipped, not treated
  as a mass removal.
- **Correct state/local domains:** `www.smithville.k12.tx.us` is no longer folded into `tx.us`.
- Review-queue sign-in uses an HttpOnly, Secure cookie — the token is never in the URL or a form
  field — and the route is `no-referrer` / `no-store` / `noindex`.

## Foundation

- The site's spine: the observation → change data model with content-hash idempotency (re-ingesting
  the same artifact emits no duplicate), one shared SQLite timeline, and working feeds end-to-end.
- Permanent `/methods` (every source, the bot's honest User-Agent and contact, the observational-only
  bright line), `/status` (each worker's last run + each source's last-checked time), and the global
  `/feed.xml` + `/feed.json`.
