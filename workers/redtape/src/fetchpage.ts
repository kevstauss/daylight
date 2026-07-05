import { assertScannableUrl, isAllowedByRobots, looksGated } from "@daylight/floodlight/guards";
import { redactText } from "@daylight/redact";

// Phase 2 — the Redtape researcher's ONE way to read a live page. It reuses the canonical SSRF
// guards (workers/floodlight/src/guards.ts) rather than a raw fetch, so the bright-line rules hold:
//   - PUBLIC federal .gov only, resolving to public IPs, re-validated on every redirect hop (SSRF)
//   - respects robots.txt for our honest DaylightBot UA
//   - EXISTENCE, NEVER ACCESS: a gated final URL / 401 / auth challenge returns "exists", never a body
//   - page text is scrubbed through @daylight/redact before it can leave this function
// It does NOT re-derive trackers / session replay — that is Floodlight's job; this only reads the
// visible text of a privacy policy or an agency PIA/SORN inventory page.

export interface FetchPageResult {
  ok: boolean;
  url: string;
  finalUrl?: string;
  status?: number;
  gated?: boolean;
  text?: string; // redacted, truncated visible text — present only when ok && !gated
  note?: string; // model-readable explanation (refusal reason, gated, error, non-HTML)
}

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

const MAX_BYTES = 600_000; // cap the download
const MAX_TEXT = 20_000; // cap the text handed back to the model
const MAX_HOPS = 5;

/** DaylightBot UA, built the same way as the Floodlight capture (never spoofed to a browser). */
function userAgent(): string {
  const site = process.env.DAYLIGHT_SITE_URL ?? "https://daylight.watch";
  return `DaylightBot/0.4 (+${site}/methods; observational; public-data-only)`;
}

/** Strip scripts/styles/tags to the visible text of an HTML page. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Guarded, read-only fetch of a public .gov page for the Redtape researcher. Returns a structured
 * result (never throws for a blocked/gated/error page — the model reads `note`).
 * `allowPrivate` is TESTS ONLY (localhost fixtures); it also lifts the .gov restriction so a
 * fixture host is reachable, mirroring guards.ts UrlGuardOptions semantics.
 */
export async function fetchPublicPage(
  url: string,
  opts: { fetchImpl?: FetchImpl; allowPrivate?: boolean; ua?: string } = {},
): Promise<FetchPageResult> {
  const doFetch = opts.fetchImpl ?? ((u, init) => fetch(u, init));
  const ua = opts.ua ?? userAgent();
  // In prod: federal .gov + public-IP only. In tests: allow the private fixture host, and (since
  // fixtures aren't .gov) drop the .gov restriction too.
  const guard = { govOnly: !opts.allowPrivate, allowPrivate: opts.allowPrivate };

  // 1. Pre-flight: http(s), .gov (prod), resolves to public IPs.
  try {
    await assertScannableUrl(url, guard);
  } catch (e) {
    return { ok: false, url, note: `refused: ${(e as Error).message}` };
  }
  // 2. robots.txt for our honest UA.
  if (!(await isAllowedByRobots(url, ua, guard))) {
    return { ok: false, url, note: "refused: disallowed by robots.txt" };
  }
  // 3. Fetch with manual redirects, re-validating the host on every hop (redirect / DNS-rebind SSRF).
  let target = url;
  let res: Response | undefined;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    try {
      await assertScannableUrl(target, guard);
    } catch (e) {
      return { ok: false, url, finalUrl: target, note: `refused mid-redirect: ${(e as Error).message}` };
    }
    res = await doFetch(target, {
      headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml,text/plain" },
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      target = new URL(loc, target).toString();
      continue;
    }
    break;
  }
  if (!res) return { ok: false, url, finalUrl: target, note: "refused: too many redirects" };
  const finalUrl = target;
  const status = res.status;

  // 4. Existence, never access: an access wall (gated URL / 401 / auth challenge) → record that it
  //    EXISTS and stop. Never read or return the body of a gated page.
  const wwwAuth = res.headers.get("www-authenticate") != null;
  if (looksGated(finalUrl) || status === 401 || wwwAuth) {
    return {
      ok: true,
      url,
      finalUrl,
      status,
      gated: true,
      note: "exists but sits behind an access wall — not entered (existence-only).",
    };
  }
  if (!res.ok) {
    return { ok: false, url, finalUrl, status, note: `no readable page (HTTP ${status})` };
  }
  const ctype = res.headers.get("content-type") ?? "";
  if (!/text\/html|text\/plain|application\/xhtml/i.test(ctype)) {
    return { ok: false, url, finalUrl, status, note: `not a readable HTML/text page (content-type: ${ctype || "unknown"})` };
  }
  // 5. Read (bounded) → visible text → REDACT → truncate. Redaction happens before the text can
  //    leave this function (it may reach reviewer_note / fact_vs_inference_notes, which publish).
  const raw = (await res.text()).slice(0, MAX_BYTES);
  const text = redactText(htmlToText(raw)).value.slice(0, MAX_TEXT);
  return { ok: true, url, finalUrl, status, gated: false, text };
}
