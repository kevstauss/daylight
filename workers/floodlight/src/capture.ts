import { chromium } from "playwright";
import type { DaylightDb } from "@daylight/db";
import { assertScannableUrl, isAllowedByRobots, looksGated } from "./guards.js";
import { runFloodlightScan } from "./scan.js";
import type { CapturedRequest, PageCapture } from "./types.js";

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
  await assertScannableUrl(url, { allowPrivate: opts.allowPrivate });
  const ua = userAgent();
  if (opts.respectRobots !== false && !opts.allowPrivate) {
    if (!(await isAllowedByRobots(url, ua))) throw new Error(`robots.txt disallows scanning ${url}`);
  }

  const browser = await chromium.launch({
    headless: true,
    channel: opts.channel ?? process.env.DAYLIGHT_BROWSER_CHANNEL,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const context = await browser.newContext({
      userAgent: ua,
      viewport: { width: 1280, height: 900 },
    });
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

    await page
      .goto(url, { waitUntil: "domcontentloaded", timeout: opts.timeoutMs ?? 20000 })
      .catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});

    const finalUrl = page.url();
    const gated = looksGated(finalUrl);

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

    const html = await page.content().catch(() => "");
    const screenshotPng = gated ? null : await page.screenshot({ fullPage: true }).catch(() => null);

    return {
      capture: { url, requests, dom },
      html,
      screenshotPng: screenshotPng ?? null,
      gated,
      finalUrl,
    };
  } finally {
    await browser.close();
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
    live = await capturePage(url, opts);
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
