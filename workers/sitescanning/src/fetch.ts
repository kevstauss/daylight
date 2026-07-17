// The daily bulk "live-filtered" dump — one row per live federal website, already filtered to real
// websites (excludes login pages + machine-readable files). ~30 MB / ~12.6k rows / ~1-day lag.
// The query API does NOT expose third_party_service as a filter, so the whole-dump download +
// client-side diff is the correct (and cheapest: one GET/day) shape for Daylight.
export const DEFAULT_SOURCE_URL =
  "https://api.gsa.gov/technology/site-scanning/data/site-scanning-live-filtered-latest.csv";

/** The env var holding the api.data.gov key (free, instant signup). A SECRET — set via
 *  `fly secrets set`, never in the repo. DEMO_KEY works for a manual local test but is heavily
 *  throttled; do NOT build on it. */
export const API_KEY_ENV = "GSA_SITE_SCANNING_API_KEY";

export function apiKeyFromEnv(): string | null {
  return process.env[API_KEY_ENV]?.trim() || null;
}

/** Honest, self-identifying User-Agent with a contact pointer (same posture as every Daylight bot). */
export function userAgent(): string {
  const site = (process.env.DAYLIGHT_SITE_URL?.trim() || "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
  return `DaylightBot/0.4 (+${site}/methods; observational; public-data-only)`;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const backoffMs = (attempt: number): number => Math.min(1000 * 2 ** attempt, 15000);

/** Fetch the bulk CSV with the api.data.gov key, an honest UA, per-attempt timeout, and exponential
 *  backoff. One request per day, so this never hammers the source. */
export async function fetchSiteScanCsv(
  url: string = DEFAULT_SOURCE_URL,
  opts: { apiKey?: string; retries?: number; ua?: string; timeoutMs?: number } = {},
): Promise<string> {
  const apiKey = opts.apiKey ?? apiKeyFromEnv();
  if (!apiKey) {
    throw new Error(`missing ${API_KEY_ENV} (get a free key at https://api.data.gov/signup/)`);
  }
  const retries = opts.retries ?? 3;
  const ua = opts.ua ?? userAgent();
  const timeoutMs = opts.timeoutMs ?? 60000; // a ~30 MB file over a slow link needs headroom
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": ua, "x-api-key": apiKey, accept: "text/csv,text/plain,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(backoffMs(attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
