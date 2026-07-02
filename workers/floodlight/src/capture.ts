/// <reference lib="dom" />
import net from "node:net";
import { promises as dns } from "node:dns";
import { chromium } from "playwright";
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
  const overallTimeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`capture exceeded ${overallMs}ms`)), overallMs),
  );
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

    const html = await page.content().catch(() => "");
    const screenshotPng =
      gated || opts.skipScreenshot ? null : await page.screenshot({ fullPage: true }).catch(() => null);

    return {
      capture: { url, requests, dom },
      html,
      screenshotPng: screenshotPng ?? null,
      gated,
      finalUrl,
    };
      })(),
      overallTimeout,
    ]);
  } finally {
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
    // Floodlight scoring never uses the screenshot — skip it to keep sweep memory flat.
    live = await capturePage(url, { skipScreenshot: true, ...opts });
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
  const result = runFloodlightScan(db, live.capture);
  return { ok: true, gated: false, domain: result.scorecard.domain, severity: result.scorecard.severity };
}
