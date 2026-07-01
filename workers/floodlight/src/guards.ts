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

/** Reject anything that isn't a public http(s) URL (SSRF-safe). Throws with a reason. */
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
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(u.hostname, { all: true });
  } catch {
    throw new Error(`cannot resolve ${u.hostname}`);
  }
  for (const a of addrs) {
    if (isBlockedIp(a.address)) {
      throw new Error(`refusing to scan a non-public address (${u.hostname} → ${a.address})`);
    }
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

/** Fetch + evaluate the origin's robots.txt. Network/parse failure ⇒ allowed (courtesy). */
export async function isAllowedByRobots(url: string, ua: string): Promise<boolean> {
  try {
    const u = new URL(url);
    const res = await fetch(`${u.origin}/robots.txt`, {
      headers: { "user-agent": ua },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return true;
    return robotsAllows(await res.text(), u.pathname);
  } catch {
    return true;
  }
}

/** Detect an access-control wall we must not authenticate past (existence-only). */
export function looksGated(finalUrl: string): boolean {
  return /cloudflareaccess\.com|\/oauth2\/authorize|login\.microsoftonline\.com|\.okta\.com\//i.test(
    finalUrl,
  );
}
