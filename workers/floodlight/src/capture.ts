/// <reference lib="dom" />
import net from "node:net";
import { promises as dns } from "node:dns";
import { chromium } from "playwright";
import type { Page } from "playwright";
import type { DaylightDb } from "@daylight/db";
import { assertScannableUrl, hostAllowed, isAllowedByRobots, isBlockedIp, isGatedNavigation } from "./guards.js";
import { runFloodlightScan } from "./scan.js";
import type { CapturedRequest, PageCapture } from "./types.js";

/**
 * Resolve the target host to a single vetted public IP and return a Chromium
 * --host-resolver-rules arg that PINS the connection to it. The app-layer route guard only
 * validates a DNS answer; Chromium re-resolves independently, so a rebinding host could hand
 * the browser a private address after our check passed. Pinning the target closes that for
 * the initial navigation and same-host requests. Returns [] when we can't safely pin (tests /
 * literal IPs / resolution failure) — the request-time route guard still applies.
 * NOTE: this does NOT pin redirect/subresource hosts with OTHER names; a network-level egress
 * filter dropping RFC1918/link-local (recommended for the Fly deploy) is the full guarantee.
 */
async function resolvePinArgs(url: string, allowPrivate?: boolean): Promise<string[]> {
  if (allowPrivate) return [];
  const host = new URL(url).hostname;
  if (net.isIP(host)) return []; // literal IP already vetted by assertScannableUrl
  const { address } = await dns.lookup(host); // first A/AAAA record
  if (isBlockedIp(address)) throw new Error(`refusing to scan a non-public address (${host})`);
  const target = net.isIPv6(address) ? `[${address}]` : address;
  return [`--host-resolver-rules=MAP ${host} ${target}`];
}

function userAgent(): string {
  const site = (process.env.DAYLIGHT_SITE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  return `DaylightBot/0.4 (+${site}/methods; observational; public-data-only)`;
}

export interface CaptureOptions {
  timeoutMs?: number;
  /** Tests only: permit localhost/private fixtures. */
  allowPrivate?: boolean;
  /** 'chrome' to use system Chrome locally; unset ⇒ bundled Chromium (Docker). */
  channel?: string;
  /** Default true — skip when robots.txt disallows. */
  respectRobots?: boolean;
  /** Restrict the target to a federal .gov host (the public scan box sets this). */
  govOnly?: boolean;
  /** Skip the full-page screenshot — Floodlight scoring never uses it, and on a big page it's
   *  a large in-memory buffer that adds up across a sweep. Receipts leaves it on (raw store). */
  skipScreenshot?: boolean;
  /** Skip page.content() — Floodlight scores from the captured requests + DOM facts and never
   *  reads html. On a frame-heavy page (justice.gov: 58 frames) content() serialization can take
   *  30s+ against a pegged main thread and blow the sweep budget. Receipts leaves it on. */
  skipHtml?: boolean;
}

/**
 * Resolve `p`, but never wait longer than `ms` — on timeout (or rejection) yield `fallback`.
 * page.content() has no native timeout and can hang for tens of seconds while it serializes a
 * frame-heavy DOM, so we bound it here for the Receipts (html-keeping) path. The abandoned CDP
 * call is torn down when the browser closes; we clear the timer so it can't keep the process
 * alive after the race settles. NOTE: this is deliberately NOT used for the DOM evaluate — a
 * timeout there would yield ambiguous "found nothing" facts (see the evaluate call below).
 */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([p.catch(() => fallback), timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// Canonical locations agencies publish a privacy notice at, tried when the page links none.
const CANONICAL_PRIVACY_PATHS = [
  "/privacy",
  "/privacy-policy",
  "/privacy-statement",
  "/privacy-notice",
  "/privacy-act",
  "/privacy.html",
];
// A path that should never legitimately exist — used to detect soft-404 catch-alls.
const SOFT404_PROBE_PATH = "/__daylight-privacy-probe-should-not-exist__";

/**
 * Fallback privacy-notice detection, run INSIDE the page so every request rides the exact SSRF
 * controls the navigation uses — the context.route re-validation AND the --host-resolver-rules IP
 * pin. (A Node-side context.request would bypass both and re-resolve the host unpinned, reopening
 * the DNS-rebinding hole the pin exists to close.) Some agencies serve a notice at a canonical
 * path without linking it from a JS-rendered homepage (e.g. eac.gov /privacy-statement), which
 * the DOM scan alone reports as a FALSE "no privacy notice".
 *
 * Robustness (a false "has a notice" is the damaging direction — it suppresses a real gap):
 *  - GET, not HEAD (some servers fake HEAD status);
 *  - the body must actually read like a privacy notice (contains /privacy/i);
 *  - reject soft-404 catch-alls (sites that 200 every path, e.g. realfood.gov) by comparing each
 *    hit's body against a deliberately-bogus path's response;
 *  - redirects are followed in-page (each hop is route-guarded), but only a SAME-ORIGIN final URL
 *    counts. All fetches run in parallel, each AbortController-bounded to 4s.
 */
async function probePrivacyInPage(page: Page): Promise<string | null> {
  try {
    // NOTE: everything inside page.evaluate must be anonymous inline functions. A NAMED inner
    // function (e.g. `const get = async () => …`) makes esbuild/SWC (with keepNames) wrap it in a
    // `__name(...)` helper that exists only in Node, not the browser page the function is
    // serialized into — so the evaluate throws `__name is not defined` at runtime. Keep it inline.
    return await page.evaluate(
      async ({ paths, bogus }): Promise<string | null> => {
        const origin = location.origin;
        const all = await Promise.all(
          [bogus, ...paths].map(async (path) => {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 4000);
            try {
              const r = await fetch(path, { method: "GET", redirect: "follow", credentials: "omit", signal: ctrl.signal });
              const sameOrigin = new URL(r.url, origin).origin === origin;
              const ok = r.ok && sameOrigin;
              const body = ok ? (await r.text()).slice(0, 20000) : "";
              return { ok, url: r.url, len: body.length, body };
            } catch {
              return { ok: false, url: "", len: 0, body: "" };
            } finally {
              clearTimeout(timer);
            }
          }),
        );
        const bog = all[0];
        if (!bog) return null;
        for (let i = 1; i < all.length; i++) {
          const res = all[i];
          if (!res || !res.ok) continue;
          // soft-404 catch-all: the bogus path also 200'd and this body ~matches it
          if (bog.ok && Math.abs(res.len - bog.len) < 64) continue;
          if (!/privacy/i.test(res.body)) continue; // must actually read like a notice
          return res.url;
        }
        return null;
      },
      { paths: CANONICAL_PRIVACY_PATHS, bogus: SOFT404_PROBE_PATH },
    );
  } catch {
    return null; // probe is best-effort — any failure just leaves the notice unknown
  }
}

export interface LiveCapture {
  capture: PageCapture;
  html: string;
  screenshotPng: Buffer | null;
  /** True if the URL sits behind an access wall — we note it exists and stop (no scrape). */
  gated: boolean;
  finalUrl: string;
}

/**
 * Passively load a public page and capture what it loads on its own: every network request
 * (with a bounded POST-body sample), DOM facts (privacy notice, agency seal, PII form
 * fields), rendered HTML, and a screenshot. Load-only — no auth, no form submission, no
 * clicking, no crawling, and never followed past an access gate (PRD §5).
 */
export async function capturePage(url: string, opts: CaptureOptions = {}): Promise<LiveCapture> {
  await assertScannableUrl(url, { allowPrivate: opts.allowPrivate, govOnly: opts.govOnly });
  const ua = userAgent();
  if (opts.respectRobots !== false && !opts.allowPrivate) {
    if (!(await isAllowedByRobots(url, ua, { allowPrivate: opts.allowPrivate }))) {
      throw new Error(`robots.txt disallows scanning ${url}`);
    }
  }

  const pinArgs = await resolvePinArgs(url, opts.allowPrivate);
  const browser = await chromium.launch({
    headless: true,
    channel: opts.channel ?? process.env.DAYLIGHT_BROWSER_CHANNEL,
    args: ["--no-sandbox", "--disable-dev-shm-usage", ...pinArgs],
  });
  // Hard overall cap on a single capture. The per-op goto/networkidle timeouts don't bound the
  // whole thing, and one slow/heavy site (or a CPU-starved machine) can stall an entire sweep.
  // On timeout we abandon this page and the finally still closes the browser (no leak).
  const overallMs = (opts.timeoutMs ?? 20000) + 25000;
  let overallTimer: ReturnType<typeof setTimeout> | undefined;
  const overallTimeout = new Promise<never>((_, reject) => {
    overallTimer = setTimeout(() => reject(new Error(`capture exceeded ${overallMs}ms`)), overallMs);
  });
  try {
    return await Promise.race([
      (async (): Promise<LiveCapture> => {
    const context = await browser.newContext({
      userAgent: ua,
      viewport: { width: 1280, height: 900 },
      serviceWorkers: "block", // a service worker could issue requests outside route interception
    });

    // Re-validate every HTTP(S) request at request time — the initial navigation, any redirect
    // it follows, and every subresource — against the SSRF blocklist. This is best-effort
    // defense in depth: it cannot pin the IP Chromium actually connects with (see
    // resolvePinArgs, which pins the target host), but it blocks obvious private/redirect hops.
    const hostCache = new Map<string, Promise<boolean>>();
    const allowed = (host: string): Promise<boolean> => {
      let p = hostCache.get(host);
      if (!p) {
        p = hostAllowed(host, { allowPrivate: opts.allowPrivate });
        hostCache.set(host, p);
      }
      return p;
    };
    await context.route("**/*", async (route) => {
      let host = "";
      try {
        host = new URL(route.request().url()).hostname;
      } catch {
        /* malformed — block below */
      }
      try {
        if (host && (await allowed(host))) await route.continue();
        else await route.abort();
      } catch {
        await route.abort().catch(() => {});
      }
    });

    // WebSocket handshakes bypass context.route entirely, so guard them with the same check
    // (routeWebSocket added in Playwright 1.48). Only connect upstream if the host is public.
    if (typeof context.routeWebSocket === "function") {
      await context.routeWebSocket("**/*", (ws) => {
        void (async () => {
          let host = "";
          try {
            host = new URL(ws.url()).hostname;
          } catch {
            /* malformed — close below */
          }
          if (host && (await allowed(host))) ws.connectToServer();
          else ws.close();
        })();
      });
    }

    const page = await context.newPage();
    const requests: CapturedRequest[] = [];
    page.on("request", (r) => {
      const body = r.postData();
      requests.push({
        url: r.url(),
        method: r.method(),
        resourceType: r.resourceType(),
        postBody: body ? body.slice(0, 4096) : undefined, // bounded sample
      });
    });

    const navResponse = await page
      .goto(url, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs ?? 20000 })
      .catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

    const finalUrl = page.url();

    // DOM facts in one pass. Deliberately NOT time-boxed: a fallback here would be ambiguous —
    // {privacyNoticeUrl:null, formFields:[]} is indistinguishable from a page that genuinely has
    // no privacy notice / no PII fields, which would publish a FALSE "no privacy notice" flag and
    // understate a real PII page. Instead we let a genuinely-stuck evaluate hit the overall cap
    // above: that aborts the whole capture (no scorecard persisted) and the sweep retries it, so a
    // scorecard is only ever written from real, fully-read DOM facts. The heavy-page budget is
    // reclaimed by skipping page.content() below, not by short-circuiting this read.
    const dom = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a"));
      const pv = links.find(
        (a) =>
          /privacy/i.test(a.textContent || "") || /privacy/i.test(a.getAttribute("href") || ""),
      ) as HTMLAnchorElement | undefined;
      const hasSeal = !!document.querySelector('img[alt*="seal" i], img[src*="seal" i]');
      const types = Array.from(document.querySelectorAll("input")).map((i) =>
        (i.getAttribute("type") || "text").toLowerCase(),
      );
      const pii = Array.from(
        new Set(types.filter((t) => ["email", "tel", "password", "file"].includes(t))),
      );
      return { privacyNoticeUrl: pv ? pv.href || null : null, hasSeal, formFields: pii };
    });

    // Fail toward "gated": the URL/IdP signal plus high-precision runtime signals (HTTP 401,
    // a WWW-Authenticate challenge, or a password field) — so custom walls are still caught.
    const gated = isGatedNavigation({
      finalUrl,
      status: navResponse?.status(),
      wwwAuthenticate: !!navResponse?.headers()["www-authenticate"],
      hasPasswordField: dom.formFields.includes("password"),
    });

    // Snapshot the passively-loaded request log BEFORE the active privacy probe below, so the
    // probe's own same-host fetches never enter the tracker scorecard.
    const capturedRequests = requests.slice();

    // If the page linked no privacy notice, fall back to probing canonical paths in-page (skipped
    // only when gated). Corrects false "no privacy notice" flags on agencies that publish one at a
    // fixed path without linking it from the homepage.
    const privacyNoticeUrl =
      dom.privacyNoticeUrl ?? (!gated ? await withTimeout(probePrivacyInPage(page), 6000, null) : null);
    const domFacts = { ...dom, privacyNoticeUrl };

    // page.content() has no native timeout and serializes the whole DOM; on a frame-heavy page
    // it can take 30s+ and blow the overall cap. Skip it for Floodlight (scoring ignores html);
    // bound it for Receipts so a slow page degrades to "" instead of hanging.
    const html = opts.skipHtml ? "" : await withTimeout(page.content(), 12000, "");
    // Bound the screenshot too — a fullPage capture on a huge page otherwise runs to Playwright's
    // ~30s default and can push the Receipts (non-skip) path past the overall cap.
    const screenshotPng =
      gated || opts.skipScreenshot
        ? null
        : await page.screenshot({ fullPage: true, timeout: 15000 }).catch(() => null);

    return {
      capture: { url, requests: capturedRequests, dom: domFacts },
      html,
      screenshotPng: screenshotPng ?? null,
      gated,
      finalUrl,
    };
      })(),
      overallTimeout,
    ]);
  } finally {
    if (overallTimer) clearTimeout(overallTimer);
    await browser.close().catch(() => {});
  }
}

export interface ScanResult {
  ok: boolean;
  gated: boolean;
  domain: string | null;
  severity?: string;
  error?: string;
}

/**
 * Capture a public URL, analyze it, and persist the scorecard. If the URL sits behind an
 * access wall we note that it is gated and stop — we never scrape or score behind the wall.
 */
export async function captureAndScore(
  db: DaylightDb,
  url: string,
  opts: CaptureOptions = {},
): Promise<ScanResult> {
  let live: LiveCapture;
  try {
    // Floodlight scoring reads only the request log + DOM facts — never the screenshot or html.
    // Skipping both keeps sweep memory flat and dodges page.content()'s multi-second serialize.
    live = await capturePage(url, { skipScreenshot: true, skipHtml: true, ...opts });
  } catch (err) {
    return { ok: false, gated: false, domain: null, error: err instanceof Error ? err.message : String(err) };
  }
  if (live.gated) {
    let host: string | null = null;
    try {
      host = new URL(url).hostname;
    } catch {
      /* keep null */
    }
    return { ok: true, gated: true, domain: host };
  }
  // Guard the DB write: runFloodlightScan rethrows on any transaction error (e.g. a transient
  // SQLITE_BUSY while the web process reads). Without this, one bad host would throw out of the
  // sweep loop and abort every remaining host AND the retry pass. Report it as a failed host so
  // the caller continues (and the retry pass gives it another go).
  try {
    const result = runFloodlightScan(db, live.capture);
    return { ok: true, gated: false, domain: result.scorecard.domain, severity: result.scorecard.severity };
  } catch (err) {
    return { ok: false, gated: false, domain: null, error: err instanceof Error ? err.message : String(err) };
  }
}
