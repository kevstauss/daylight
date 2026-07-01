import { promises as dns } from "node:dns";
import net from "node:net";

// Guardrails for live capture (PRD §5): public pages only, no SSRF, respect robots.txt,
// never authenticate past a wall. We observe the front door; we never try the handle.

export interface UrlGuardOptions {
  allowPrivate?: boolean; // tests only — allow localhost fixtures
}

/** True if an IP is loopback / private / link-local / reserved (blocks SSRF + metadata). */
export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number) as [number, number, number, number];
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    if (p[0] === 192 && p[1] === 0 && p[2] === 0) return true;
    if (p[0] >= 224) return true; // multicast + reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    const low = ip.toLowerCase();
    if (low === "::1" || low === "::") return true;
    if (low.startsWith("fe80") || low.startsWith("fc") || low.startsWith("fd")) return true;
    const mapped = low.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/);
    if (mapped?.[1]) return isBlockedIp(mapped[1]);
    return false;
  }
  return true; // unknown format — refuse
}

/** True only if a hostname resolves entirely to public addresses (SSRF check). */
export async function hostAllowed(hostname: string, opts: UrlGuardOptions = {}): Promise<boolean> {
  if (opts.allowPrivate) return true;
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(hostname, { all: true });
  } catch {
    return false;
  }
  return addrs.length > 0 && addrs.every((a) => !isBlockedIp(a.address));
}

/** Reject anything that isn't a public http(s) URL (SSRF-safe). Throws with a reason.
 *  NOTE: this is the pre-flight check; every actual request is re-validated at request time
 *  (capture.ts) so redirects and DNS rebinding to a private address are also refused. */
export async function assertScannableUrl(url: string, opts: UrlGuardOptions = {}): Promise<void> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("only http(s) URLs may be scanned");
  }
  if (opts.allowPrivate) return;
  if (!(await hostAllowed(u.hostname, opts))) {
    throw new Error(`refusing to scan a non-public address (${u.hostname})`);
  }
}

interface RobotsGroup {
  agents: string[];
  rules: { type: "disallow" | "allow"; path: string }[];
}

/** Minimal robots.txt evaluation for our bot token. Disallow prefixes block; absent = allow. */
export function robotsAllows(robotsTxt: string, path: string, uaToken = "daylightbot"): boolean {
  const lines = robotsTxt
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean);
  const groups: RobotsGroup[] = [];
  let cur: RobotsGroup | null = null;
  for (const line of lines) {
    const m = line.match(/^(user-agent|disallow|allow)\s*:\s*(.*)$/i);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = (m[2] ?? "").trim();
    if (key === "user-agent") {
      if (!cur || cur.rules.length > 0) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
    } else if (cur) {
      cur.rules.push({ type: key as "disallow" | "allow", path: val });
    }
  }
  const mine = groups.filter((g) => g.agents.includes(uaToken.toLowerCase()));
  const star = groups.filter((g) => g.agents.includes("*"));
  const use = mine.length ? mine : star;
  for (const g of use) {
    for (const r of g.rules) {
      if (r.type === "disallow" && r.path && path.startsWith(r.path)) return false;
    }
  }
  return true;
}

/**
 * Fetch + evaluate the origin's robots.txt. This is a SERVER-SIDE request made before the
 * browser launches, so it does NOT go through the context.route SSRF guard. We therefore
 * validate every hop ourselves: refuse to auto-follow redirects (redirect:"manual") and
 * re-run the SSRF host check on each Location before following, capping the chain. Without
 * this, a page could 302 its /robots.txt to http://169.254.169.254/… and bounce us into the
 * metadata service. Network/parse failure ⇒ allowed (courtesy — the scan itself is guarded).
 */
export async function isAllowedByRobots(url: string, ua: string, opts: UrlGuardOptions = {}): Promise<boolean> {
  try {
    const u = new URL(url);
    let target = `${u.origin}/robots.txt`;
    for (let hop = 0; hop < 5; hop++) {
      const t = new URL(target);
      if (t.protocol !== "http:" && t.protocol !== "https:") return true;
      if (!(await hostAllowed(t.hostname, opts))) return true; // can't vet the hop → courtesy allow
      const res = await fetch(target, {
        headers: { "user-agent": ua },
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return true;
        target = new URL(loc, target).toString(); // resolve, re-validate on next iteration
        continue;
      }
      if (!res.ok) return true;
      return robotsAllows(await res.text(), u.pathname);
    }
    return true; // redirect loop / too many hops → courtesy allow
  } catch {
    return true;
  }
}

// Known identity-provider / access-wall signals. A page whose FINAL url matches one of these
// is sitting behind SSO or an access gate we must never authenticate past (existence-only).
const GATE_PATTERNS =
  /cloudflareaccess\.com|login\.microsoftonline\.com|\.okta\.com|\.auth0\.com|amazoncognito\.com|\.onelogin\.com|pingidentity\.com|(^|\/\/)(secure\.)?login\.gov\/|\/oauth2\/(authorize|v2)|\/openid|\/saml2?\/|\/adfs\/|response_type=code/i;

/** Detect an access-control wall we must not authenticate past (existence-only). */
export function looksGated(finalUrl: string): boolean {
  return GATE_PATTERNS.test(finalUrl);
}

/**
 * Decide whether a completed navigation landed on a wall — fail toward "gated" so we err on
 * the side of NOT scraping. Combines the URL/IdP signal with high-precision runtime signals
 * (an HTTP 401 or a WWW-Authenticate challenge, or a password field on the page) so custom
 * walls the substring list doesn't name are still caught, without falsely calling a plain
 * cross-domain redirect an "access wall."
 */
export function isGatedNavigation(opts: {
  finalUrl: string;
  status?: number;
  wwwAuthenticate?: boolean;
  hasPasswordField?: boolean;
}): boolean {
  if (looksGated(opts.finalUrl)) return true;
  if (opts.status === 401) return true;
  if (opts.wwwAuthenticate) return true;
  if (opts.hasPasswordField) return true;
  return false;
}
