// The Wayback CDX index — the public record of what the Internet Archive actually captured.
//
// Why this exists: SPN2 reporting "success" is not proof that the archive is a copy of the PAGE.
// It deduplicates against recent captures, so it can hand back a capture made by a different
// IA crawler — and that capture may be of a 403/404 block page from a host whose bot protection
// refuses the archiver. An archive link on a removal ledger is a factual claim ("this is what
// was there"), so it has to be checked against the index rather than trusted from the save call.
//
// Read-only queries against a public index; no auth, no capture created.

export type CaptureStatus =
  | { known: true; statusCode: string } // the index has this exact capture
  | { known: false; reason: string }; // not indexed, or we could not tell — NEVER act on this

export interface CdxOptions {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}

function userAgent(): string {
  const site = (process.env.DAYLIGHT_SITE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  return `DaylightBot/0.5 (+${site}/methods; observational; public-data-only)`;
}

/**
 * The HTTP status of the page as the Internet Archive captured it at `timestamp`.
 *
 * Returns `known: false` when the answer is genuinely unknown (not indexed, network failure,
 * unparseable). Callers MUST treat that as "leave it alone": a page that redirects (cdc.gov →
 * www.cdc.gov) can be indexed under the redirect target rather than the URL we submitted, so an
 * empty result is not evidence of a bad archive.
 */
export async function captureStatus(
  pageUrl: string,
  timestamp: string,
  opts: CdxOptions = {},
): Promise<CaptureStatus> {
  const f = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const query =
    `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(pageUrl)}` +
    `&output=json&fl=timestamp,statuscode&from=${timestamp}&to=${timestamp}`;
  try {
    const res = await f(query, {
      headers: { "user-agent": userAgent(), accept: "application/json" },
      // Generous by design. CDX is slow for high-volume hosts (cdc.gov, whitehouse.gov have
      // millions of captures) — a tight timeout turns "slow" into "unknown", and unknown means
      // we leave a bad link in place. Waiting is cheaper than a wrong answer.
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
    if (!res.ok) return { known: false, reason: `cdx HTTP ${res.status}` };
    const text = (await res.text()).trim();
    if (!text) return { known: false, reason: "not in the CDX index for this URL form" };
    const rows = JSON.parse(text) as string[][];
    // Row 0 is the header (["timestamp","statuscode"]).
    const hit = rows.slice(1).find((r) => r[0] === timestamp);
    if (!hit) return { known: false, reason: "no capture at this exact timestamp" };
    const statusCode = hit[1] ?? "";
    // CDX writes "-" for a revisit record (content identical to a previous capture). That is a
    // real capture of the page, just deduplicated by IA — not evidence of a block page.
    if (!statusCode || statusCode === "-") return { known: false, reason: "revisit/unknown status record" };
    return { known: true, statusCode };
  } catch (err) {
    return { known: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

/** Is this capture a copy of the page itself, rather than a block page or an error? */
export const isPageCapture = (s: CaptureStatus): boolean => s.known && s.statusCode === "200";

/** Positive evidence that a capture is NOT the page (a 4xx/5xx block/error page). Only this
 *  justifies clearing an archive link — absence of evidence never does. */
export const isDefinitelyNotPageCapture = (s: CaptureStatus): boolean =>
  s.known && /^[45]\d\d$/.test(s.statusCode);
