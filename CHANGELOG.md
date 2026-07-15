# Changelog

What Daylight does, and what's been added or changed along the way. Everything here is
**observational and built on already-public data** — see [`/methods`](/methods) for every source, the
bot's contact, and the observational-only scope.

## Receipts: fall back to the Archive's own copy, and name a declared block — 2026-07-15

- **When our archive attempt fails, surface the Internet Archive&rsquo;s nearest existing copy.**
  Save Page Now fails often enough to matter (a 3-session concurrency cap; intermittent 403s from
  hosts behind Akamai/Cloudflare), while the same sites are independently crawled many times a day
  — `trumpaccounts.gov` alone has **702** captures. So rather than reporting a gap, Receipts now
  adopts the closest real capture within a few hours of when it looked. Only `200` captures are
  eligible: a 403 block page is not a copy of the page.
- **Every archive is dated by its own capture instant**, never by the snapshot holding the link.
  An adopted or carried-forward copy is real evidence of the page *at that moment*, not of the
  bytes we hashed — so the drift is on the face of it (&ldquo;Archived Jul 2&rdquo;, with the exact
  time and distance on hover) instead of a bare &ldquo;Archived&rdquo; that overclaims.
- **A site that tells archivers to go away is now a finding.** If a watched host&rsquo;s
  `robots.txt` carries a site-wide `Disallow` naming the Internet Archive&rsquo;s crawler
  (`ia_archiver`) or Daylight&rsquo;s own, that is recorded as a dated, `high` change quoting the
  directive verbatim, with the `robots.txt` URL as the source so anyone can check it.
  **What is deliberately NOT reported as a block:** a CDN intermittently returning 403 to the
  archiver. `trumpaccounts.gov` returns 403 to roughly one attempt in six and has no `robots.txt`
  at all — while the Archive holds 702 copies of it. Bot protection is a hosting default; a
  directive naming an archiver is a decision someone wrote down. Only the second is evidence of
  intent, and only the second gets named. Blocks being *lifted* are recorded too — a ledger that
  only reports the damning direction is a campaign, not a ledger.
- **Targeted sweeps** — `pnpm --filter @daylight/receipts snapshot --hosts a.gov,b.gov`, for when a
  newly-registered domain has no archive anywhere and shouldn&rsquo;t wait for the next full pass.

## Receipts: the archive column now tells the truth — 2026-07-14

- An audit of the [`/receipts`](/receipts) coverage table found 21 of 73 watched pages showing no
  archive — including `trumpaccounts.gov`, which Daylight had in fact archived. Four distinct
  problems, all now fixed. The archive link is the load-bearing part of a removal ledger: it is the
  independent copy that makes &ldquo;this was here on that date&rdquo; checkable by someone else.
- **A failed save no longer hides an archive we hold.** The table read only the newest snapshot per
  page, and the archive URL was written once at capture time and never revisited — so a single
  failed save blanked the column for a page archived perfectly well a week earlier. The coverage
  view now carries the most recent archive on file forward, **dated to the capture it belongs to**
  (&ldquo;Archived Jul 2&rdquo;). An archive from an earlier capture is real evidence of *that*
  day&rsquo;s page, never presented as covering today&rsquo;s.
- **No more un-timestamped &ldquo;archives.&rdquo;** When a capture wasn&rsquo;t confirmed within
  90s, the old code stored `web.archive.org/web/<url>` — no timestamp. It rendered identically to a
  real archive but resolves to whatever the Internet Archive captured **most recently**, showing the
  page&rsquo;s current state rather than the state we snapshotted. On a removal ledger that is
  exactly backwards: the proof a tracker was present would show the page without it. 21 such links
  existed; a non-confirming capture is now a plain failure, and `pnpm receipts:audit-archives`
  clears the bad rows so the retry path can re-archive them properly.
- **Archive links are now checked against the public CDX index, not just trusted.** Several watched
  hosts sit behind bot protection that refuses the Internet Archive&rsquo;s crawler, and Save Page
  Now deduplicates against recent captures — so a &ldquo;successful&rdquo; save can hand back
  another crawler&rsquo;s capture of a **403 block page** and we would file it as a receipt.
  `trumpaccounts.gov`&rsquo;s stored archive was exactly this. `pnpm receipts:audit-archives
  --verify` re-checks every link against the index and clears the ones that aren&rsquo;t a capture
  of the page — and only ever acts on positive evidence, since a page that redirects (`cdc.gov` →
  `www.cdc.gov`) is indexed under the redirect target and an unanswered query proves nothing.
- **Failed saves retry, and stop being invisible.** An unchanged re-capture used to short-circuit
  before the archive step, making a failed save permanent until the page&rsquo;s content changed.
  It now retries the missing archive — and only attaches a fresh capture to an existing snapshot
  when the content hash *proves* the page hasn&rsquo;t changed since. The Internet Archive account
  allows only 3 concurrent capture sessions, so the sweep now waits for a free slot instead of
  burning the attempt, and every failure is counted and logged with its actual reason rather than
  swallowed.

## Made legible to search engines and AI — 2026-07-06

- A full SEO/AIO pass so the record is discoverable and citable. None of it changes what Daylight
  observes — it only publishes the existing public data in machine-readable form.
- **Discovery.** A dynamic [`/sitemap.xml`](/sitemap.xml) mapping every module page, all ~1,300
  domains, known subdomains, and every change permalink (freshest first); a
  [`/robots.txt`](/robots.txt) that *welcomes* the major AI crawlers (GPTBot, ClaudeBot,
  PerplexityBot, Google-Extended, and more) by name — because a public accountability record should
  be citable — while keeping the internal `/review` queue out; and a web manifest.
- **Structured data.** Every page now carries schema.org JSON-LD: the whole corpus and each domain
  as a `Dataset` (with the JSON API + feeds as downloads), each change as a citable `Report` carrying
  its content fingerprint and public source, plus `Organization`, `WebSite`, `BreadcrumbList`, and a
  `FAQPage`. This is what lets an assistant cite a specific, timestamped, re-verifiable finding.
- **Per-page metadata.** Unique, factual titles and descriptions, canonical URLs, and OpenGraph /
  Twitter cards on every page — all rooted at the configured site origin, never a request header.
- **Social & citation cards.** Branded 1,200×630 preview images generated on the fly — a default
  card, plus per-domain (name, owner, status) and per-change (the finding, severity, date) — so a
  shared or cited Daylight link unfurls with the fact, not a blank box.
- **Built for machines.** A new [`/llms.txt`](/llms.txt) site map for LLM/agent tooling, and a new
  [`/faq`](/faq) with a plain-language Q&A and a glossary (PIA, SORN, Certificate Transparency,
  session replay, reverse-proxied analytics) — the terms the record is built on, defined once.

## Real first-seen dates in the raw column — 2026-07-06

- A one-time, idempotent `pnpm ledger:backfill-first-seen` rewrites the `domains.first_seen` column
  from the uniform baseline-seed date to each domain&rsquo;s **earliest Ledger `added` date** — its
  true first appearance in the registry. Once the git-history backfill has run, longstanding domains
  (present since the 2019 baseline) are set to the record-start date as a lower bound. On the current
  data that&rsquo;s 1,053 real dates recovered + 289 longstanding (a single seed date → 164 distinct
  dates). The `/domain` label already derived this honestly; this makes the raw column accurate for
  any future consumer (feeds, sorting, the public API).

## Receipts: a coverage baseline, not just a removal list — 2026-07-06

- `/receipts` was a flat removal list that sat empty whenever nothing had been removed — which is
  most of the time. It&rsquo;s now two sections: **what quietly changed** (the removal ledger) and
  **what we&rsquo;re watching** — a coverage table of every watched page&rsquo;s current baseline:
  last captured, tracker count, whether a privacy notice and an agency seal are present, and a link
  to the independent Internet Archive copy. A removal is just one of those facts going from present
  to gone, so the baseline makes the page legible even at zero removals. A summary line shows pages
  watched · snapshots on file · removals recorded.

## Redtape: PIA and SORN, broken out — 2026-07-06

- Each filing gap now shows the two legally-required filings as **distinct legs** — a **PIA** and a
  **SORN** — each marked *published* (with its references) or *none found*, instead of collapsing
  both into one line. &ldquo;No PIA **and** no SORN&rdquo; (the strongest finding) reads at a glance,
  as does &ldquo;SORN found but PIA missing&rdquo; (why a filing reads as incomplete). PIA references
  are surfaced alongside SORN references. The data was already captured per gap; this makes it
  visible. Neutral by design: a filing found reads as reassuring (calm ✓); a filing not found is
  stated plainly, never alarm-colored — the severity badge already grades it.

## Honest &ldquo;first seen&rdquo; — registered, longstanding, or on record — 2026-07-06

- The `/domain` &ldquo;First seen&rdquo; field stops showing a seed date as if it were a
  registration date. It now tells the truth in three shapes:
  - **First appeared {date}** — when Ledger recorded the domain&rsquo;s `added` event, its real first
    appearance in CISA&rsquo;s public registry.
  - **Longstanding** — for domains on the public `.gov` record since it began (Feb 2019); their true
    registration predates the record, so Daylight doesn&rsquo;t invent a date.
  - **On our record since {date}** — the honest fallback before the git-history backfill has run.
- Derived at read time from Ledger&rsquo;s `added` changes plus the history-backfill marker — no data
  mutation, and the raw seed date is never surfaced as a fact it isn&rsquo;t.

## Auto-watch brand-new .gov registrations — 2026-07-06

- A newly-registered federal domain is the highest-signal, lowest-volume event Daylight sees
  (~1 a week), so it&rsquo;s now watched from day one instead of only when someone hand-adds it. When
  Ledger records a domain as `added`, it enters a dynamic watch tier that Floodlight, Receipts, and
  Lookout sweep alongside the curated baseline and the hand-picked watchlist — its trackers, a dated
  snapshot, and its certs/subdomains, automatically.
- **The watchlist is a priority tier, not the scope boundary.** It was never a fence (the SSRF
  guards gate on `.gov`, not the list). New registrations — plus any domain that turns up a finding
  (auto-keep) — ride alongside the hand-picked priorities.
- Keyed on Ledger&rsquo;s `added` change, not `first_seen`: the baseline seed emits no changes, so a
  one-time seed can never flood the tier. The probation window defaults to 90 days
  (`DAYLIGHT_NEW_DOMAIN_WATCH_DAYS`); a domain that flags during probation is kept past it.
- Backfill check: **17** federal `.gov` domains registered in the last ~90 days (13 of them not
  previously page-scanned — e.g. `fraud.gov`, `moms.gov`, `usvisabond.gov`) are now picked up
  automatically.

## Honest support copy, corrected module status, no more screenshots — 2026-07-06

- The **support note on `/methods`** is now first-person and plain — a person doing this on the side
  because it matters, not an institution. It says where a tip goes (hosting) and that findings come
  from public data, so money doesn&rsquo;t touch them; the forced "never buys a finding" line is gone.
- **Corrected stale status copy.** Floodlight and Receipts live capture are running (weekly, and
  twice weekly) — `/methods` and `/receipts` no longer describe them as "deferred / capture pending."
  The `/methods` note on privacy filings now reflects that the researcher checks the **PIA** leg too
  (it web-searches the operating agency&rsquo;s PIA inventory and reads it directly, guarded), not
  just the SORN. Only the real-time certstream feed remains genuinely deferred.
- **Stopped storing screenshots.** Receipts captured a full-page screenshot into the raw store on
  every snapshot, but nothing ever served or read it — the removal ledger works off DOM facts +
  hashes, and the Internet Archive keeps the durable visual copy. Capturing them only grew the disk,
  so the snapshot path now skips the screenshot by default (re-enableable if a review→publish flow
  ever needs it).

## Reader support: an inline Ko-fi tip picker — 2026-07-05

- The support ask is now a small **inline tip picker** — preset `$3 / $10 / $25 / Custom` chips in
  the site-wide banner and on [`/methods`](/methods) — instead of a single "Support" link. You pick
  an amount **on Daylight's own page**; the only hop off-site is Ko-fi's checkout, which has to
  process the payment. Neutral "Support" framing, tip-sized action.
- **No third-party anything.** The picker is self-hosted markup — no Ko-fi script, iframe, or remote
  image. The strict per-request CSP would block those, and loading a tracker onto the one site whose
  job is naming trackers would be self-defeating. It stays true to the banner's own line: *no ads,
  grants, or trackers.*
- On by default (handle baked in); the non-secret `DAYLIGHT_KOFI` overrides the handle or, blanked,
  hides the ask everywhere — footer, banner, `/methods`, and `/privacy` render cleanly with no ask.

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
