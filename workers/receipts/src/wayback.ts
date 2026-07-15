// Wayback Save Page Now (SPN2) — creates an independent third-party archive we don't
// control. NEVER hit in CI (tests inject a mock). In production it is opt-in
// (DAYLIGHT_WAYBACK=1). When IA S3 keys (IA_S3_ACCESS_KEY / IA_S3_SECRET, from
// https://archive.org/account/s3.php) are present it uses the AUTHENTICATED SPN2 JSON API;
// otherwise it falls back to the anonymous, heavily rate-limited endpoint. Existence-only
// archiving of a public page; no auth to the page.
//
// INVARIANT: a non-null return is ALWAYS a timestamp-pinned capture URL
// (https://web.archive.org/web/<14-digit>/<url>). A bare https://web.archive.org/web/<url>
// resolves to whatever IA has captured MOST RECENTLY, which is not a receipt — it would show
// the page's *current* state, so a tracker we recorded as present could silently render as
// absent. If we cannot pin a dated capture, we return null and let the next sweep retry.

import { isTimestampedArchiveUrl } from "@daylight/core";

export { isTimestampedArchiveUrl };

export type WaybackSaver = (url: string) => Promise<string | null>;

export interface WaybackOptions {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  /** IA S3 keys (https://archive.org/account/s3.php). Default from env. */
  accessKey?: string;
  secret?: string;
  /** Max time to wait for a submitted capture to be confirmed before giving up (null). */
  maxWaitMs?: number;
  /** Max time to wait for a free SPN2 session slot before giving up (null). */
  maxSlotWaitMs?: number;
  /** How often to poll a submitted capture's status. Injectable so tests don't sleep. */
  pollIntervalMs?: number;
  /** How often to re-check for a free session slot. Injectable so tests don't sleep. */
  slotPollIntervalMs?: number;
  /** Observability seam: called with the reason whenever a save fails. The saver still
   *  returns null — this exists so a failed archive is never silently invisible. */
  onFailure?: (url: string, reason: string) => void;
}

const SPN2_ENDPOINT = "https://web.archive.org/save";
const SPN2_USER_STATUS = "https://web.archive.org/save/status/user";
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));


function userAgent(): string {
  const site = (process.env.DAYLIGHT_SITE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  return `DaylightBot/0.5 (+${site}/methods; observational; public-data-only)`;
}

/**
 * Save a public URL to the Wayback Machine and return the timestamp-pinned snapshot URL, or
 * null. With IA S3 keys present, uses the authenticated SPN2 JSON API (wait for a slot →
 * submit job → poll status); otherwise falls back to the anonymous Save Page Now endpoint.
 */
export async function saveToWayback(pageUrl: string, opts: WaybackOptions = {}): Promise<string | null> {
  const f = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const fail = (reason: string): null => {
    opts.onFailure?.(pageUrl, reason);
    return null;
  };
  const accessKey = opts.accessKey ?? process.env.IA_S3_ACCESS_KEY?.trim();
  const secret = opts.secret ?? process.env.IA_S3_SECRET?.trim();
  if (accessKey && secret) {
    return saveAuthenticated(pageUrl, f, `LOW ${accessKey}:${secret}`, {
      maxWaitMs: opts.maxWaitMs ?? 90_000,
      maxSlotWaitMs: opts.maxSlotWaitMs ?? 120_000,
      pollIntervalMs: opts.pollIntervalMs ?? 3_000,
      slotPollIntervalMs: opts.slotPollIntervalMs ?? 5_000,
      fail,
    });
  }
  return saveAnonymous(pageUrl, f, fail);
}

/**
 * The IA account has a small number of concurrent SPN2 session slots (3 at time of writing).
 * Submitting while all slots are busy is rejected outright, so a sweep that fires and forgets
 * loses roughly a third of its archives. Wait for a slot instead of burning the attempt.
 */
async function waitForSlot(
  f: (url: string, init?: RequestInit) => Promise<Response>,
  authorization: string,
  maxWaitMs: number,
  pollIntervalMs: number,
): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    const st = await f(`${SPN2_USER_STATUS}?_t=${Date.now()}`, {
      headers: { authorization, accept: "application/json", "user-agent": userAgent() },
    })
      .then((r) => r.json())
      .catch(() => null);
    const available = (st as { available?: number } | null)?.available;
    // Status unavailable/unparseable → don't block the sweep on our own bookkeeping; just try.
    if (typeof available !== "number") return true;
    if (available > 0) return true;
    if (Date.now() >= deadline) return false;
    await sleep(pollIntervalMs);
  }
}

/** Authenticated SPN2: wait for a slot → POST /save → job_id → poll /save/status/{job_id}. */
async function saveAuthenticated(
  pageUrl: string,
  f: (url: string, init?: RequestInit) => Promise<Response>,
  authorization: string,
  o: {
    maxWaitMs: number;
    maxSlotWaitMs: number;
    pollIntervalMs: number;
    slotPollIntervalMs: number;
    fail: (reason: string) => null;
  },
): Promise<string | null> {
  try {
    if (!(await waitForSlot(f, authorization, o.maxSlotWaitMs, o.slotPollIntervalMs))) {
      return o.fail(`no free SPN2 session slot after ${Math.round(o.maxSlotWaitMs / 1000)}s`);
    }

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
    const started = (await submit.json().catch(() => null)) as
      | { job_id?: string; status_ext?: string; message?: string }
      | null;
    const jobId = started?.job_id;
    if (!jobId) {
      return o.fail(started?.status_ext ?? started?.message ?? `submit returned HTTP ${submit.status}`);
    }

    const deadline = Date.now() + o.maxWaitMs;
    while (Date.now() < deadline) {
      await sleep(o.pollIntervalMs);
      const res = await f(`${SPN2_ENDPOINT}/status/${jobId}`, {
        headers: { authorization, accept: "application/json", "user-agent": userAgent() },
      });
      const st = (await res.json().catch(() => null)) as
        | {
            status?: string;
            status_ext?: string;
            message?: string;
            timestamp?: string;
            original_url?: string;
            http_status?: number;
          }
        | null;
      if (!st) continue;
      if (st.status === "success" && st.timestamp) {
        // A "successful" capture of a 403/404 is a capture of a block page, not of the site.
        // Several watched hosts (va.gov, dhs.gov, trumpaccounts.gov…) sit behind bot protection
        // that refuses IA's crawler, and archiving the refusal as if it were the page is worse
        // than having no archive: the removal ledger would cite it as proof of what was there.
        if (typeof st.http_status === "number" && st.http_status !== 200) {
          return o.fail(`origin returned HTTP ${st.http_status} to the archiver (not a capture of the page)`);
        }
        const archived = `https://web.archive.org/web/${st.timestamp}/${st.original_url ?? pageUrl}`;
        return isTimestampedArchiveUrl(archived) ? archived : o.fail(`malformed capture URL: ${archived}`);
      }
      // Keep SPN2's own message, not just the code. The codes are terse and partly
      // undocumented ("error:no-request"), while the message is the diagnosis — e.g. "The
      // target server blocks access to <url>. (HTTP status=403)" — and it is the Archive's
      // words, which is exactly what makes it quotable rather than our inference.
      if (st.status === "error") {
        const code = st.status_ext ?? "spn2 error";
        return o.fail(st.message ? `${code}: ${st.message}` : code);
      }
      // status "pending" → keep polling until the deadline
    }
    // Submitted but never confirmed. The capture may still land, but we cannot pin its
    // timestamp, and an un-pinned link is not a receipt — fail and retry on the next sweep.
    return o.fail(`capture still pending after ${Math.round(o.maxWaitMs / 1000)}s`);
  } catch (err) {
    return o.fail(err instanceof Error ? err.message : String(err));
  }
}

/** Anonymous Save Page Now — heavily rate-limited; returns the archived URL from the redirect. */
async function saveAnonymous(
  pageUrl: string,
  f: (url: string, init?: RequestInit) => Promise<Response>,
  fail: (reason: string) => null,
): Promise<string | null> {
  try {
    const res = await f(`${SPN2_ENDPOINT}/${encodeURI(pageUrl)}`, {
      headers: { "user-agent": userAgent(), accept: "*/*" },
      redirect: "follow",
    });
    const loc = res.headers.get("content-location") ?? res.headers.get("location");
    const candidate = loc
      ? loc.startsWith("http")
        ? loc
        : `https://web.archive.org${loc.startsWith("/") ? "" : "/"}${loc}`
      : res.url && res.url.includes("/web/")
        ? res.url
        : null;
    if (!candidate) return fail(`anonymous save returned no archive location (HTTP ${res.status})`);
    return isTimestampedArchiveUrl(candidate) ? candidate : fail(`archive URL is not timestamp-pinned: ${candidate}`);
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
