// Central site config. Read-path constants + helpers shared across routes.

export const SITE_NAME = "Daylight";
export const SITE_TAGLINE =
  "A public, observational watchdog for federal .gov infrastructure.";

/** Configured public origin (no trailing slash). Feeds fall back to the request origin. */
export function configuredSiteUrl(): string {
  const raw = process.env.DAYLIGHT_SITE_URL?.trim();
  return (raw && raw.length > 0 ? raw : "http://localhost:3000").replace(/\/+$/, "");
}

/** Derive the absolute origin for a request (honors proxy headers on Fly). */
export function originFromRequest(req: Request): string {
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

export const CONTACT =
  process.env.DAYLIGHT_CONTACT?.trim() || `${configuredSiteUrl()}/methods`;

export const USER_AGENT = `DaylightBot/0.2 (+${configuredSiteUrl()}/methods; observational; public-data-only)`;

export const CREDIT_LINE =
  "Built with Claude Code. Research assisted by Claude (Anthropic).";

/** Every public data source Daylight reads (PRD §8). Shown permanently on /methods. */
export const DATA_SOURCES: { name: string; url: string; use: string; phase: string }[] = [
  {
    name: "CISA dotgov-data",
    url: "https://github.com/cisagov/dotgov-data",
    use: "Public federal .gov ownership registry — who owns each apex domain and its security contact. Diffed daily.",
    phase: "Ledger (live)",
  },
  {
    name: "Certificate Transparency logs (via crt.sh)",
    url: "https://crt.sh/",
    use: "Public append-only logs of every issued TLS certificate — used to notice new subdomains appearing. Existence-only: we record that a cert exists; we never connect to the host.",
    phase: "Lookout (backfill live)",
  },
  {
    name: "Live public page source",
    url: "https://www.gov/",
    use: "Public page HTML + network requests (observational only, honest User-Agent) — used to fingerprint trackers.",
    phase: "Floodlight (planned)",
  },
  {
    name: "Wayback Save Page Now",
    url: "https://web.archive.org/",
    use: "An independent third-party archive of snapshots, so the record is not one we control.",
    phase: "Receipts (planned)",
  },
  {
    name: "Federal Register API",
    url: "https://www.federalregister.gov/developers/documentation/api/v1",
    use: "Public SORN (System of Records Notice) search — used to check for required privacy filings.",
    phase: "Redtape (planned)",
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
