// Wayback Save Page Now (SPN2) — creates an independent third-party archive we don't
// control. NEVER hit in CI (tests inject a mock). In production it is opt-in and rate-
// limited. Existence-only archiving of a public page; no auth, no gated walls.

export type WaybackSaver = (url: string) => Promise<string | null>;

export interface WaybackOptions {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}

function userAgent(): string {
  const site = (process.env.DAYLIGHT_SITE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  return `DaylightBot/0.5 (+${site}/methods; observational; public-data-only)`;
}

/** Save a public URL to the Wayback Machine and return the archived snapshot URL, or null. */
export async function saveToWayback(pageUrl: string, opts: WaybackOptions = {}): Promise<string | null> {
  const f = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  try {
    const res = await f(`https://web.archive.org/save/${encodeURI(pageUrl)}`, {
      headers: { "user-agent": userAgent(), accept: "*/*" },
      redirect: "follow",
    });
    const loc = res.headers.get("content-location") ?? res.headers.get("location");
    if (loc) return loc.startsWith("http") ? loc : `https://web.archive.org${loc.startsWith("/") ? "" : "/"}${loc}`;
    if (res.url && res.url.includes("/web/")) return res.url;
    return null;
  } catch {
    return null;
  }
}
