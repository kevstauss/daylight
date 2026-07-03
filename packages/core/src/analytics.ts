// First-party, aggregate-only request classification for Daylight's /privacy analytics.
//
// Pure + dependency-free on purpose: this runs in the request path (apps/web middleware), so it
// must never pull the heavy floodlight/playwright graph. It stores NOTHING itself — it only maps
// a (pathname, referrer) pair into the bounded, non-identifying shape the `analytics_hits` table
// holds. No IP, user-agent, cookie, or free-form value ever leaves this function.
//
// The `.gov` check mirrors isGovHost() in @daylight/floodlight/guards; it is inlined here (a one-
// line suffix test) to keep this module free of that package's browser dependencies. If the
// federal-detection rule there ever changes, change it here too.

export type RefKind = "direct" | "gov" | "search" | "other";

export interface HitClass {
  /** Normalized route pattern — never a raw path value (see normalizePath). */
  path: string;
  refKind: RefKind;
  /** Public `.gov` apex when refKind === "gov"; "" otherwise. */
  refHost: string;
}

// Known single-segment content routes, recorded verbatim as `/<segment>`. Dynamic routes
// (domain/change/floodlight/receipts) are handled explicitly below and collapse to a pattern, so
// no raw domain name, change id, or scanned URL is ever stored. `floodlight` and `receipts` are
// intentionally absent here — their branches run first.
const STATIC_ROUTES = new Set([
  "registry",
  "ledger",
  "lookout",
  "redtape",
  "watchlist",
  "methods",
  "changelog",
  "corrections",
  "compare",
  "privacy",
]);

// Never recorded: the Fly health check hammers /status every 30s (it would swamp every real
// count), and /review is the internal, noindex human-gate queue. Both return null ⇒ no row.
const EXCLUDED_HEADS = new Set(["status", "review"]);

// Coarse search-engine buckets. Substring match so country TLDs (google.co.uk) and subdomains
// (www.bing.com) all fold into "search" without storing the specific host.
const SEARCH_HOST_MARKERS = [
  "google.",
  "bing.",
  "duckduckgo.",
  "search.brave.",
  "yahoo.",
  "ecosia.",
  "startpage.",
  "yandex.",
  "baidu.",
  "kagi.",
];

/** Mirror of isGovHost() in @daylight/floodlight/guards — federal `.gov` (or a subdomain of one),
 *  but never the bare `gov` label. Kept inline so this stays dependency-free. */
function isGovHostname(host: string): boolean {
  return host === "gov" ? false : host.endsWith(".gov");
}

/** The registrable apex of a `.gov` host. `.gov` is a single-label public suffix, so the apex is
 *  the last two labels: www.epa.gov → epa.gov, a.b.irs.gov → irs.gov, login.gov → login.gov. */
function govApex(host: string): string {
  return host.split(".").slice(-2).join(".");
}

/**
 * Map a request pathname to a bounded route pattern, or null to skip recording entirely.
 * Dynamic segments collapse to `:name`/`:id`/`:url`; unknown/probe paths bucket to `/other` so a
 * crawler hitting random URLs can't balloon the table's cardinality.
 */
export function normalizePath(pathname: string): string | null {
  let p = (pathname.split("?")[0] ?? "").split("#")[0]?.toLowerCase() ?? "";
  if (p.length > 1) p = p.replace(/\/+$/, ""); // drop trailing slash (but keep root "/")
  if (p === "" || p === "/") return "/";

  const segs = p.slice(1).split("/");
  const head = segs[0] ?? "";
  const tail = segs[segs.length - 1] ?? "";

  if (EXCLUDED_HEADS.has(head)) return null; // /status, /review
  if (tail === "status.json") return null; // the Fly health check hits this every 30s — never count it
  // RSS/JSON feeds (global + per-module, e.g. /feed.xml, /ledger/feed.json) collapse to one
  // "consumption" bucket, kept distinct from human page views on /privacy. Checked before the
  // per-module head branches so /floodlight/feed.xml folds into /feed, not /floodlight.
  if (/^feed\.(xml|json)$/.test(tail)) return "/feed";
  if (head === "api") return "/api"; // programmatic API reads — the other consumption bucket
  if (head === "floodlight") {
    if (segs[1] === "scan") return "/floodlight/scan";
    return segs.length > 1 ? "/floodlight/:url" : "/floodlight";
  }
  if (head === "receipts") return segs.length > 1 ? "/receipts/:url" : "/receipts";
  if (head === "domain") return "/domain/:name";
  if (head === "change") return "/change/:id";
  if (STATIC_ROUTES.has(head)) return `/${head}`;
  return "/other";
}

/**
 * Classify a Referer into a coarse kind + (for federal `.gov` only) the public apex. Everything
 * else keeps no host at all. Same-origin referrers are internal navigation → "direct".
 */
export function classifyReferer(
  referer: string | null | undefined,
  selfHost?: string,
): { kind: RefKind; host: string } {
  if (!referer || !referer.trim()) return { kind: "direct", host: "" };

  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return { kind: "other", host: "" }; // a referer was sent but isn't a parseable URL
  }
  if (!host) return { kind: "other", host: "" };

  const selfBare = (selfHost ?? "").toLowerCase().split(":")[0]?.replace(/^www\./, "") ?? "";
  if (selfBare && host.replace(/^www\./, "") === selfBare) return { kind: "direct", host: "" };

  if (isGovHostname(host)) return { kind: "gov", host: govApex(host) };
  if (SEARCH_HOST_MARKERS.some((m) => host.includes(m))) return { kind: "search", host: "" };
  return { kind: "other", host: "" };
}

/**
 * Should this request be left OUT of the counts because it comes from the operator? A transient,
 * storage-free control check: the caller (middleware) reads the client IP only to decide whether
 * to record a hit, and never stores, logs, or writes it anywhere — so /privacy's "no IP is ever
 * written" pledge stays literally true. `allowlist` is DAYLIGHT_ANALYTICS_EXCLUDE_IPS: a comma/
 * space-separated list of exact IPs (e.g. `203.0.113.7`) or prefixes ending in `.`/`:` for a
 * range (e.g. `203.0.113.` for an IPv4 block, `2001:db8:` for an IPv6 one). Empty/unset ⇒ excludes
 * nobody. Matching is case-insensitive (IPv6 hex) and comparison is on the raw string, so the same
 * IP written in two forms (compressed vs. expanded IPv6) must be listed as it arrives in the header.
 */
export function isExcludedClientIp(
  ip: string | null | undefined,
  allowlist: string | null | undefined,
): boolean {
  if (!ip || !allowlist) return false;
  const client = ip.trim().toLowerCase();
  if (!client) return false;
  for (const raw of allowlist.split(/[\s,]+/)) {
    const entry = raw.trim().toLowerCase();
    if (!entry) continue;
    if (entry.endsWith(".") || entry.endsWith(":")) {
      if (client.startsWith(entry)) return true; // prefix / range
    } else if (client === entry) {
      return true; // exact
    }
  }
  return false;
}

/** Full classification for one request, or null when the path is excluded from analytics. */
export function classifyHit(
  pathname: string,
  referer: string | null | undefined,
  selfHost?: string,
): HitClass | null {
  const path = normalizePath(pathname);
  if (path === null) return null;
  const { kind, host } = classifyReferer(referer, selfHost);
  return { path, refKind: kind, refHost: host };
}
