export const DEFAULT_SOURCE_URL =
  "https://raw.githubusercontent.com/cisagov/dotgov-data/main/current-federal.csv";

/** Honest, self-identifying User-Agent with a contact pointer (PRD §3, §5). */
export function userAgent(): string {
  const site = (process.env.DAYLIGHT_SITE_URL?.trim() || "http://localhost:3000").replace(
    /\/+$/,
    "",
  );
  return `DaylightBot/0.2 (+${site}/methods; observational; public-data-only)`;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const backoffMs = (attempt: number): number => Math.min(1000 * 2 ** attempt, 15000);

/** Fetch a CSV with an honest UA and exponential backoff. Never hammers (spec §6.2).
 *  Each attempt has a hard timeout: Node's fetch has no default one, so a half-open/hung
 *  connection would block forever (and the retry loop never fires, since a hang never
 *  rejects). AbortSignal.timeout turns a hang into a retriable error. */
export async function fetchCsv(
  url: string = DEFAULT_SOURCE_URL,
  opts: { retries?: number; ua?: string; timeoutMs?: number } = {},
): Promise<string> {
  const retries = opts.retries ?? 3;
  const ua = opts.ua ?? userAgent();
  const timeoutMs = opts.timeoutMs ?? 20000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": ua, accept: "text/csv,text/plain,*/*" },
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
