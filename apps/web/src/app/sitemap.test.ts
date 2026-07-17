import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDb, setDefaultDb } from "@daylight/db";
import sitemap from "@/app/sitemap";
import { SITE_URL } from "@/lib/seo";

// The sitemap is the discovery path for every detail page (domains, scorecards, snapshot
// histories, change permalinks). These tests lock in that the per-URL Floodlight/Receipts pages
// and the Broadside landing appear exactly when their module flag is on — a silently missing
// family of URLs is invisible in prod until someone checks Search Console.

const FLAGS = ["FLAG_FLOODLIGHT", "FLAG_RECEIPTS", "FLAG_BROADSIDE"] as const;
const saved: Record<string, string | undefined> = {};

const SCORECARD_URL = "https://www.example.gov/";
const SNAPSHOT_URL = "https://www.example.gov/privacy";

beforeEach(() => {
  for (const f of FLAGS) saved[f] = process.env[f];
  const db = createDb(":memory:");
  db.upsertScorecard(
    {
      url: SCORECARD_URL,
      domain: "example.gov",
      trackerCount: 3,
      sessionReplay: false,
      firstPartyProxied: false,
      privacyNoticeUrl: null,
      requestCount: 10,
      engineVersion: "test",
      severity: "notable",
      trackersJson: "[]",
      reasonsJson: "[]",
    },
    "2026-07-01T00:00:00Z",
  );
  db.insertSnapshot({ url: SNAPSHOT_URL, domain: "example.gov", capturedAt: "2026-07-02T00:00:00Z" });
  setDefaultDb(db);
});

afterEach(() => {
  for (const f of FLAGS) {
    if (saved[f] === undefined) delete process.env[f];
    else process.env[f] = saved[f];
  }
});

describe("sitemap", () => {
  it("lists per-URL scorecard/snapshot pages and /broadside when their flags are on", () => {
    for (const f of FLAGS) process.env[f] = "1";
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContain(`${SITE_URL}/floodlight/${encodeURIComponent(SCORECARD_URL)}`);
    expect(urls).toContain(`${SITE_URL}/receipts/${encodeURIComponent(SNAPSHOT_URL)}`);
    expect(urls).toContain(`${SITE_URL}/broadside`);
  });

  it("omits them when the flags are off (an off module 404s)", () => {
    for (const f of FLAGS) delete process.env[f];
    const urls = sitemap().map((e) => e.url);
    expect(urls.some((u) => u.includes("/floodlight/"))).toBe(false);
    expect(urls.some((u) => u.includes("/receipts/"))).toBe(false);
    expect(urls).not.toContain(`${SITE_URL}/broadside`);
  });

  it("always lists the front door and evergreen pages", () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContain(`${SITE_URL}/`);
    expect(urls).toContain(`${SITE_URL}/methods`);
    expect(urls).toContain(`${SITE_URL}/faq`);
  });
});
