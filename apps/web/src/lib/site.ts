// Central site config. Read-path constants + helpers shared across routes.

export const SITE_NAME = "Daylight";
export const SITE_TAGLINE =
  "A public, observational watchdog for federal .gov infrastructure.";
/** Short masthead subtitle (a compressed version of the homepage hero line). */
export const HEADER_TAGLINE = "Who runs the federal web, and what quietly changes.";

/** Configured public origin (no trailing slash). Feeds fall back to the request origin. */
export function configuredSiteUrl(): string {
  const raw = process.env.DAYLIGHT_SITE_URL?.trim();
  return (raw && raw.length > 0 ? raw : "http://localhost:3000").replace(/\/+$/, "");
}

/** Derive the absolute origin for a request. When DAYLIGHT_SITE_URL is configured (prod) it
 *  wins outright — feed/canonical URLs must not be derived from a client-controlled Host or
 *  X-Forwarded-Host header (cache-poisoning). Only when unset (local dev) do we read the
 *  request origin as a convenience. */
export function originFromRequest(req: Request): string {
  const configured = process.env.DAYLIGHT_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  try {
    const url = new URL(req.url);
    const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
    if (host) return `${proto}://${host}`.replace(/\/+$/, "");
  } catch {
    /* fall through */
  }
  return configuredSiteUrl();
}

/** Where the public sends tips / watchlist submissions / disputes. */
export const TIPS_EMAIL = process.env.DAYLIGHT_TIPS?.trim() || "tips@daylight.watch";

/** Normalize a contact value to a usable href: bare emails get a `mailto:` scheme. */
function normalizeContact(v: string): string {
  if (/^https?:\/\//i.test(v) || v.startsWith("mailto:")) return v;
  if (v.includes("@")) return `mailto:${v}`;
  return v;
}

function resolveContact(): string {
  const raw = process.env.DAYLIGHT_CONTACT?.trim();
  if (raw) return normalizeContact(raw);
  // A real mailbox — NOT the old `${site}/methods` default, which made the "Contact" link on the
  // methods page point circularly back at itself. Warn loudly in prod so a real address gets set.
  if (process.env.NODE_ENV === "production" && !process.env.DAYLIGHT_TIPS?.trim()) {
    console.warn(
      "[daylight] DAYLIGHT_CONTACT (and DAYLIGHT_TIPS) are unset — falling back to the placeholder tips mailbox. Set a real contact for the methods/dispute path.",
    );
  }
  return `mailto:${TIPS_EMAIL}`;
}

/** A ready-to-use href (mailto: or https:) for the public/agency contact + dispute path. */
export const CONTACT = resolveContact();
/** The human-readable form (scheme stripped) for display. */
export const CONTACT_LABEL = CONTACT.replace(/^mailto:/, "");

/** Ko-fi handle that receives tips. Defaults to the project's handle so the ask works out of the
 *  box; set DAYLIGHT_KOFI to a different handle to override, or to an empty value to hide the
 *  support ask everywhere (footer, banner, /methods, /privacy). */
export const KOFI_USERNAME =
  process.env.DAYLIGHT_KOFI === undefined ? "kevstauss" : process.env.DAYLIGHT_KOFI.trim();

/** Preset one-tap tip amounts (USD). Ko-fi reads the amount straight off the URL path and prefills
 *  it, so the visitor picks a size on our page and only hops to Ko-fi for the actual checkout. */
export const TIP_PRESETS = [3, 10, 25] as const;

/** Build a Ko-fi link. With an amount it deep-links a prefilled tip (`ko-fi.com/<user>/10`);
 *  without one it opens the plain tip page so the visitor chooses their own amount. */
export function kofiUrl(amount?: number): string {
  const base = `https://ko-fi.com/${KOFI_USERNAME}`;
  return amount && amount > 0 ? `${base}/${amount}` : base;
}

/** The support destination for the footer + /privacy simple links (the banner and /methods use the
 *  inline preset picker instead). Null — ask hidden — only when DAYLIGHT_KOFI is explicitly blanked. */
export const FUNDING_URL: string | null = KOFI_USERNAME ? kofiUrl() : null;

export const USER_AGENT = `DaylightBot/0.4 (+${configuredSiteUrl()}/methods; observational; public-data-only)`;

export const CREDIT_LINE =
  "Built with Claude Code. Research assisted by Claude.";

/** Every public data source Daylight reads (PRD §8). Shown permanently on /methods.
 *  `use` is the plain-language lead; `technical` is the expandable detail; `cadence` feeds the
 *  bot-behavior table (how often + how politely we read each source). */
export const DATA_SOURCES: {
  name: string;
  url: string;
  use: string;
  technical: string;
  cadence: string;
  phase: string;
}[] = [
  {
    name: "CISA dotgov-data",
    url: "https://github.com/cisagov/dotgov-data",
    use: "The official public list of who owns each federal .gov domain, and the email listed as its security contact. We check it every day and note anything that changed.",
    technical: "We `git fetch` the public cisagov/dotgov-data repo and diff current-federal.csv commit-to-commit. Every emitted change links the commit-pinned blob it was read from, so the exact before/after row is re-checkable. Ownership/contact deltas are classified (H1 contact-domain mismatch, H9 contact concentration, watchlist hits); city/state churn is stored but never surfaced as a change.",
    cadence: "Daily; a full git-history backfill runs once.",
    phase: "Ledger (live)",
  },
  {
    name: "Certificate Transparency logs (via crt.sh)",
    url: "https://crt.sh/",
    use: "Every time a website gets a security certificate, it's published in a public log. We read those logs to notice when a new subdomain first appears — for example a `previews.` or `photo.` host.",
    technical: "Public append-only Certificate Transparency (CT) logs, queried via crt.sh (with backoff + caching). We extract SANs, identify never-before-seen subdomains under watched apexes, and score them against a label list (previews/staging/auth/photo/analytics/infra…). Existence-only: we record that a certificate exists; we never connect to, probe, or authenticate to the host. Each row links back to its crt.sh query.",
    cadence: "Nightly reconcile; certstream (real-time) deferred pending hosting.",
    phase: "Lookout (backfill live)",
  },
  {
    name: "Federal GitHub organizations",
    url: "https://docs.github.com/rest",
    use: "Federal teams build a lot of their sites in the open on GitHub. A brand-new code repository — or the first commit to an empty one — often appears before the website it powers does, so we watch a short list of federal orgs and note when something new shows up.",
    technical: "We poll the public GitHub REST API for the repositories of watched federal orgs (config/watchlist.yaml `github_orgs`: GSA, 18F, cisagov, uswds, nationaldesignstudio…), newest-created first, and diff against what we've seen. A new repo or a first commit becomes a Lookout event. We key on GitHub's immutable numeric repo id, so a rename is never mistaken for a new repo; forks never emit; and because a repo missing from one poll can be a transient API/pagination miss, we do not report removals. Existence-only: a public, read-only API (an optional token only lifts the rate limit and needs no scopes) — we never touch anything private.",
    cadence: "Daily poll.",
    phase: "Lookout (GitHub signal)",
  },
  {
    name: "Live public page source (Playwright)",
    url: "https://playwright.dev/",
    use: "We load a public government page the way your browser would, once, and write down what it loaded on its own — which trackers ran, whether it records your clicks, and whether it links a privacy notice. We never fill in or submit anything.",
    technical: "A headless Chromium loads the public URL once (load-only: no auth, no form submission, no clicking, no crawling). We capture every network request (with a bounded POST-body sample) and passive DOM facts, then fingerprint third-party trackers and the reverse-proxy disguise (a first-party endpoint whose payload shape matches an analytics SDK). SSRF-guarded (IP-pinned, RFC1918 blocked); an access-gated page is noted as existing and never entered.",
    cadence: "Weekly full sweep (Mondays).",
    phase: "Floodlight (live)",
  },
  {
    name: "GSA Site Scanning (federal web scan)",
    url: "https://open.gsa.gov/api/site-scanning-api/",
    use: "The government scans its own public websites every day and publishes the results. We read that daily list to spot when a new tracker or analytics tag shows up on a federal site — and when we and the government's own scan agree, that's a finding that's much harder to wave off. It's a wide, cheap net; Floodlight is the close-up look.",
    technical: "We download GSA/TTS's public daily bulk scan of the federal web (~12.6k live sites, one HTTP GET behind a free api.data.gov key) and diff it per URL. When a new, non-benign third-party service or the site's own Google Analytics tag (distinct from the government-wide Digital Analytics Program) appears on a .gov we don't already watch, we QUEUE that apex for a full Floodlight pass rather than trusting the scan — signature scanning is breadth, Floodlight's browser capture is depth. Two limits stated plainly: (1) it detects only KNOWN third parties by domain/tag, so a first-party endpoint on the .gov itself serving an analytics-shaped payload (the reverse-proxy disguise Floodlight exists to catch) is invisible to it by construction — a clean row is never evidence of \"no tracking\"; (2) a scan can time out, and a timeout is not an absence, so we only read a tracker as newly-appeared when the government's scan completed on both the before and after.",
    cadence: "Daily (GSA refreshes the dump ~daily; one bulk download).",
    phase: "Site Scanning (breadth net → Floodlight)",
  },
  {
    name: "DuckDuckGo Tracker Radar",
    url: "https://github.com/duckduckgo/tracker-radar",
    use: "An open, public catalog of known trackers and what they do. We use it to recognize the trackers we see on a page.",
    technical: "Seeds Floodlight's curated fingerprint set (host + payload-shape signatures) alongside EasyPrivacy and a session-replay vendor list. We keep a high-signal subset — the vendors that actually appear on federal sites plus the common analytics/session-replay tools — not the full multi-thousand-host dataset, so it stays auditable.",
    cadence: "Bundled dataset; refreshed with releases.",
    phase: "Floodlight (engine live)",
  },
  {
    name: "Wayback Save Page Now (SPN2)",
    url: "https://web.archive.org/",
    use: "An independent public archive (the Internet Archive). We ask it to save a copy of watched pages, so the record of what a page showed on a given day isn't one we control and can't quietly change.",
    technical: "On snapshot, we POST the URL to web.archive.org/save/{url} (rate-limited, opt-in) and store the returned archive URL beside our own dated snapshot. When something present before is gone after — a tracker, a privacy clause, a seal, a form field — it becomes a dated `removed` event in the removal ledger with before/after.",
    cadence: "With each Receipts snapshot (twice weekly, Mon & Thu).",
    phase: "Receipts (live)",
  },
  {
    name: "Federal Register API",
    url: "https://www.federalregister.gov/developers/documentation/api/v1",
    use: "The government's own public record of privacy filings. When a site collects personal information, the law generally requires a published privacy notice; we search this record to see whether one exists — and show you the exact searches we ran.",
    technical: "An AI research agent (behind a human-approval gate — see below) searches the Federal Register for SORNs matching a collection, returning references OR a documented negative with the exact queries run. Only human-reviewed, published gaps ever appear on /redtape, and only with a non-empty query + source trail so the negative is re-runnable. Copy is constrained to observation (\"no published PIA found as of {date}; searches below\"), never \"illegal.\" PIAs aren't in the Federal Register — they live on each agency's own privacy pages — so the researcher also web-searches the operating agency's PIA inventory and reads it directly (guarded, .gov-only, redacted) to check the PIA leg, not just the SORN.",
    cadence: "On new collection detected + monthly re-sweep (human-gated).",
    phase: "Redtape (gap-finder + human gate live)",
  },
];

export function severityLabel(sev: string): string {
  switch (sev) {
    case "high":
      return "High";
    case "notable":
      return "Notable";
    default:
      return "Info";
  }
}
