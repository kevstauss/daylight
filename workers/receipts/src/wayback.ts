// Wayback Save Page Now (SPN2) — creates an independent third-party archive we don't
// control. NEVER hit in CI (tests inject a mock). In production it is opt-in
// (DAYLIGHT_WAYBACK=1). When IA S3 keys (IA_S3_ACCESS_KEY / IA_S3_SECRET, from
// https://archive.org/account/s3.php) are present it uses the AUTHENTICATED SPN2 JSON API
// (12 concurrent / 100k-per-day limits); otherwise it falls back to the anonymous, heavily
// rate-limited endpoint. Existence-only archiving of a public page; no auth to the page.

export type WaybackSaver = (url: string) => Promise<string | null>;

export interface WaybackOptions {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  /** IA S3 keys (https://archive.org/account/s3.php). Default from env. */
  accessKey?: string;
  secret?: string;
  /** Max time to wait for an authenticated capture to finish before falling back to "latest". */
  maxWaitMs?: number;
}

const SPN2_ENDPOINT = "https://web.archive.org/save";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function userAgent(): string {
  const site = (process.env.DAYLIGHT_SITE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  return `DaylightBot/0.5 (+${site}/methods; observational; public-data-only)`;
}

/**
 * Save a public URL to the Wayback Machine and return the archived snapshot URL, or null.
 * With IA S3 keys present, uses the authenticated SPN2 JSON API (submit job → poll status);
 * otherwise falls back to the anonymous Save Page Now endpoint.
 */
export async function saveToWayback(pageUrl: string, opts: WaybackOptions = {}): Promise<string | null> {
  const f = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const accessKey = opts.accessKey ?? process.env.IA_S3_ACCESS_KEY?.trim();
  const secret = opts.secret ?? process.env.IA_S3_SECRET?.trim();
  if (accessKey && secret) {
    return saveAuthenticated(pageUrl, f, `LOW ${accessKey}:${secret}`, opts.maxWaitMs ?? 90_000);
  }
  return saveAnonymous(pageUrl, f);
}

/** Authenticated SPN2: POST /save → job_id, then poll /save/status/{job_id} until done. */
async function saveAuthenticated(
  pageUrl: string,
  f: (url: string, init?: RequestInit) => Promise<Response>,
  authorization: string,
  maxWaitMs: number,
): Promise<string | null> {
  try {
    const submit = await f(SPN2_ENDPOINT, {
      method: "POST",
      headers: {
        authorization,
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": userAgent(),
      },
      body: new URLSearchParams({ url: pageUrl }).toString(),
    });
    const started = (await submit.json().catch(() => null)) as { job_id?: string } | null;
    const jobId = started?.job_id;
    if (!jobId) return null;

    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      await sleep(3000);
      const res = await f(`${SPN2_ENDPOINT}/status/${jobId}`, {
        headers: { authorization, accept: "application/json", "user-agent": userAgent() },
      });
      const st = (await res.json().catch(() => null)) as
        | { status?: string; timestamp?: string; original_url?: string }
        | null;
      if (!st) continue;
      if (st.status === "success" && st.timestamp) {
        return `https://web.archive.org/web/${st.timestamp}/${st.original_url ?? pageUrl}`;
      }
      if (st.status === "error") return null;
      // status "pending" → keep polling until the deadline
    }
    // Submitted but not confirmed in time — the capture usually still lands; point at the latest.
    return `https://web.archive.org/web/${encodeURI(pageUrl)}`;
  } catch {
    return null;
  }
}

/** Anonymous Save Page Now — heavily rate-limited; returns the archived URL from the redirect. */
async function saveAnonymous(
  pageUrl: string,
  f: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<string | null> {
  try {
    const res = await f(`${SPN2_ENDPOINT}/${encodeURI(pageUrl)}`, {
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
