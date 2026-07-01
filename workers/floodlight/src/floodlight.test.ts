import { createDb, type DaylightDb } from "@daylight/db";
import { beforeEach, describe, expect, it } from "vitest";
import { analyzeCapture, runFloodlightScan } from "./index.js";
import type { CapturedRequest, DomFacts, PageCapture } from "./types.js";

const NOW = "2026-07-01T10:00:00.000Z";

const dom = (over: Partial<DomFacts> = {}): DomFacts => ({
  privacyNoticeUrl: null,
  hasSeal: false,
  formFields: [],
  ...over,
});
const capture = (url: string, requests: CapturedRequest[], d: DomFacts): PageCapture => ({
  url,
  requests,
  dom: d,
});

// §7 deterministic fixtures (no live gov sites) — modeled as passive PageCaptures.

const PROXY = capture(
  "https://ndstudio.gov/",
  [
    {
      url: "https://ndstudio.gov/metrics",
      method: "POST",
      resourceType: "fetch",
      postBody: JSON.stringify({ event: "$pageview", properties: { $session_id: "s1" }, distinct_id: "u1", api_key: "phc_abc" }),
    },
  ],
  dom(),
);

const AUTOMONITOR = capture(
  "https://ndstudio.gov/",
  [
    {
      url: "https://analytics.infra.ndstudio.gov/metrics",
      method: "POST",
      resourceType: "fetch",
      postBody: JSON.stringify({ session_id: "abc", events: [{ t: "click" }, { t: "scroll" }] }),
    },
  ],
  dom(),
);

const VENDOR = capture(
  "https://realfood.gov/",
  [{ url: "https://www.google-analytics.com/g/collect?v=2&tid=G-XXXX", method: "GET", resourceType: "image" }],
  dom({ privacyNoticeUrl: "https://realfood.gov/privacy" }),
);

const REPLAY = capture(
  "https://trumprx.gov/",
  [{ url: "https://rs.fullstory.com/rec/page", method: "POST", resourceType: "fetch" }],
  dom({ privacyNoticeUrl: "https://trumprx.gov/privacy" }),
);

const NONOTICE = capture(
  "https://passports.gov/signin",
  [{ url: "https://www.googletagmanager.com/gtm.js?id=GTM-XXXX", method: "GET", resourceType: "script" }],
  dom({ privacyNoticeUrl: null, formFields: ["email"] }),
);

const CLEAN = capture(
  "https://travel.state.gov/",
  [{ url: "https://travel.state.gov/assets/app.js", method: "GET", resourceType: "script" }],
  dom({ privacyNoticeUrl: "https://travel.state.gov/privacy", hasSeal: true }),
);

let db: DaylightDb;
beforeEach(() => {
  db = createDb(":memory:");
});

describe("§7 reverse-proxy disguise (H1, flagship)", () => {
  it("first-party /metrics with a PostHog-shaped body → first_party_proxied=true, high", () => {
    const sc = analyzeCapture(PROXY);
    expect(sc.firstPartyProxied).toBe(true);
    expect(sc.severity).toBe("high");
    expect(sc.reasons.join(" ")).toMatch(/reverse-proxy/i);
  });

  it("AutoMonitor {session_id, events[]} to analytics.infra.<apex> → first_party_proxied=true, high", () => {
    const sc = analyzeCapture(AUTOMONITOR);
    expect(sc.firstPartyProxied).toBe(true);
    expect(sc.severity).toBe("high");
  });
});

describe("§7 vendor classification", () => {
  it("a Google Analytics third-party request → correct vendor + category", () => {
    const sc = analyzeCapture(VENDOR);
    const ga = sc.trackers.find((t) => t.vendor === "Google Analytics");
    expect(ga?.category).toBe("analytics");
    expect(sc.trackerCount).toBe(1);
    expect(sc.firstPartyProxied).toBe(false);
  });
});

describe("§7 session replay (H2)", () => {
  it("a FullStory recording endpoint → session_replay=true, high", () => {
    const sc = analyzeCapture(REPLAY);
    expect(sc.sessionReplay).toBe(true);
    expect(sc.severity).toBe("high");
  });
});

describe("§7 privacy-notice cross-check (H4)", () => {
  it("PII form + tracker + no privacy link → privacy_notice_url=null, flagged", () => {
    const sc = analyzeCapture(NONOTICE);
    expect(sc.privacyNoticeUrl).toBeNull();
    expect(sc.severity).toBe("high"); // collects PII with no notice
    expect(sc.reasons.join(" ")).toMatch(/no linked privacy notice/i);
  });

  it("clean page (no trackers, has a privacy link) → info, no flags", () => {
    const sc = analyzeCapture(CLEAN);
    expect(sc.trackerCount).toBe(0);
    expect(sc.sessionReplay).toBe(false);
    expect(sc.firstPartyProxied).toBe(false);
    expect(sc.privacyNoticeUrl).toBe("https://travel.state.gov/privacy");
    expect(sc.severity).toBe("info");
  });
});

describe("§7 rescan diff + redaction", () => {
  it("a tracker present then gone emits a `removed` change", () => {
    const withTracker = VENDOR;
    const withoutTracker = capture("https://realfood.gov/", [], dom({ privacyNoticeUrl: "https://realfood.gov/privacy" }));
    runFloodlightScan(db, withTracker, NOW);
    const second = runFloodlightScan(db, withoutTracker, NOW);
    expect(second.removed.some((k) => k.includes("Google Analytics"))).toBe(true);
    const removedChange = db.listChanges({ module: "floodlight" }).find((c) => c.kind === "removed");
    expect(removedChange).toBeTruthy();
  });

  it("redact strips PII reflected in a captured request URL before persistence", () => {
    const leak = capture(
      "https://realfood.gov/?email=leak@example.com",
      [{ url: "https://www.google-analytics.com/collect?uid=leak@example.com", method: "GET", resourceType: "image" }],
      dom({ privacyNoticeUrl: "https://realfood.gov/privacy" }),
    );
    runFloodlightScan(db, leak, NOW);
    const obs = db
      .latestObservation("floodlight", "realfood.gov");
    expect(obs).not.toBeNull();
    expect(obs!.payload_json).not.toContain("leak@example.com");
    expect(obs!.payload_json).toContain("[redacted:email]");
  });

  it("redacts PII from the scorecard URL (its primary key + public display), not just the observation", () => {
    const leak = capture(
      "https://realfood.gov/apply?email=leak@example.com",
      [{ url: "https://www.google-analytics.com/collect", method: "GET", resourceType: "image" }],
      dom({ privacyNoticeUrl: "https://realfood.gov/privacy" }),
    );
    const res = runFloodlightScan(db, leak, NOW);
    expect(res.scorecard.url).not.toContain("leak@example.com");
    const cards = db.scorecardsByDomain("realfood.gov");
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((c) => !c.url.includes("leak@example.com"))).toBe(true);
    expect(cards[0]!.url).toContain("[redacted:email]");
  });
});

describe("§7 reverse-proxy disguise — precision (no false HIGH on content pages)", () => {
  const firstPartyGet = (path: string): PageCapture =>
    capture(
      `https://example.gov${path}`,
      [{ url: `https://example.gov${path}`, method: "GET", resourceType: "document" }],
      dom({ privacyNoticeUrl: "https://example.gov/privacy" }),
    );

  it("a GET content page at /decide/how-to-vote is NOT flagged as proxied analytics", () => {
    const sc = analyzeCapture(firstPartyGet("/decide/how-to-vote"));
    expect(sc.firstPartyProxied).toBe(false);
    expect(sc.severity).not.toBe("high");
  });

  it("a GET content page at /s/2024-report is NOT flagged proxied or session-replay", () => {
    const sc = analyzeCapture(firstPartyGet("/s/2024-report"));
    expect(sc.firstPartyProxied).toBe(false);
    expect(sc.sessionReplay).toBe(false);
  });

  it("a genuine POST beacon to /decide/ with a JSON body IS still flagged", () => {
    const sc = analyzeCapture(
      capture(
        "https://example.gov/",
        [{ url: "https://example.gov/decide/", method: "POST", resourceType: "fetch", postBody: JSON.stringify({ token: "x" }) }],
        dom(),
      ),
    );
    expect(sc.firstPartyProxied).toBe(true);
    expect(sc.severity).toBe("high");
  });

  it("many first-party analytics beacons to one host collapse to a single tracker (dedup)", () => {
    const beacon = (p: string): CapturedRequest => ({
      url: `https://ndstudio.gov${p}`,
      method: "POST",
      resourceType: "fetch",
      postBody: JSON.stringify({ event: "$pageview", distinct_id: "u1", api_key: "phc_x" }),
    });
    const sc = analyzeCapture(
      capture("https://ndstudio.gov/", [beacon("/e/"), beacon("/batch/"), beacon("/e/")], dom()),
    );
    expect(sc.trackers.filter((t) => t.firstPartyProxied)).toHaveLength(1);
  });
});
