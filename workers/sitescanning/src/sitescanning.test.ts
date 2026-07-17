import { describe, it, expect } from "vitest";
import { nowIso } from "@daylight/core";
import { createDb, type DaylightDb } from "@daylight/db";
import {
  indexColumns,
  isBenignThirdParty,
  missingColumns,
  parseCsv,
  parseRow,
  scanContentHash,
} from "./index.js";
import { runSiteScan } from "./run.js";

// ---- tiny CSV builder (valid quoting so Papa round-trips the JSON-in-a-cell fields) ----
const HEADER = [
  "name",
  "top_level_domain",
  "url",
  "scan_date",
  "base_domain",
  "dap",
  "primary_scan_status",
  "third_party_service_domains",
  "ga_tag_id",
  "third_party_service_count",
  "future_added_col", // proves added/reordered columns are tolerated (mapped by name)
];

function cell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
function mkRow(obj: Record<string, string>): string {
  return HEADER.map((h) => cell(obj[h] ?? "")).join(",");
}
function csv(rows: Record<string, string>[]): string {
  return [HEADER.map(cell).join(","), ...rows.map(mkRow)].join("\n");
}
const tp = (hosts: string[]): string => JSON.stringify(hosts);

function irs(thirdParty: string[], status = "completed"): Record<string, string> {
  return {
    name: "IRS",
    top_level_domain: "gov",
    url: "https://www.irs.gov/",
    scan_date: "2026-07-15",
    base_domain: "irs.gov",
    dap: "true",
    primary_scan_status: status,
    third_party_service_domains: tp(thirdParty),
    ga_tag_id: "G-IRSDAP",
    third_party_service_count: String(thirdParty.length),
    future_added_col: "whatever",
  };
}
function example(thirdParty: string[], status = "completed", ga = ""): Record<string, string> {
  return {
    name: "Example",
    top_level_domain: "gov",
    url: "https://example.gov/",
    scan_date: "2026-07-15",
    base_domain: "example.gov",
    dap: "false",
    primary_scan_status: status,
    third_party_service_domains: tp(thirdParty),
    ga_tag_id: ga,
    third_party_service_count: String(thirdParty.length),
    future_added_col: "",
  };
}

function db(): DaylightDb {
  return createDb(":memory:");
}

describe("csv header guard", () => {
  it("maps required columns by name regardless of order + extra columns", () => {
    const idx = indexColumns(HEADER);
    expect(idx).not.toBeNull();
    expect(idx?.url).toBe(2);
    expect(idx?.third_party_service_domains).toBe(7);
  });

  it("fails loud (null) when a required column is missing", () => {
    const dropped = HEADER.filter((h) => h !== "third_party_service_domains");
    expect(indexColumns(dropped)).toBeNull();
    expect(missingColumns(dropped)).toContain("third_party_service_domains");
  });
});

describe("parse helpers", () => {
  it("parseRow normalizes a .gov row through the real parser and skips non-.gov", () => {
    const idx = indexColumns(HEADER)!;
    const { rows } = parseCsv(
      csv([
        example(["connect.facebook.net"]),
        { ...example([]), top_level_domain: "com", base_domain: "fake.com", url: "https://fake.com/" },
      ]),
    );
    const gov = parseRow(rows[0]!, idx);
    expect(gov?.domain).toBe("example.gov");
    expect(gov?.thirdPartyDomains).toEqual(["connect.facebook.net"]);
    expect(parseRow(rows[1]!, idx)).toBeNull(); // non-.gov out of scope
  });

  it("isBenignThirdParty covers DAP/GA/GTM/fonts + shards, not ad/social pixels", () => {
    expect(isBenignThirdParty("dap.digitalgov.gov")).toBe(true);
    expect(isBenignThirdParty("www.google-analytics.com")).toBe(true);
    expect(isBenignThirdParty("region1.google-analytics.com")).toBe(true); // shard suffix
    expect(isBenignThirdParty("fonts.gstatic.com")).toBe(true);
    expect(isBenignThirdParty("connect.facebook.net")).toBe(false);
    expect(isBenignThirdParty("stats.g.doubleclick.net")).toBe(false);
  });
});

describe("runSiteScan — diff + promotion", () => {
  it("skips non-.gov rows and populates state without promoting on the first pass", async () => {
    const d = db();
    const r = await runSiteScan({
      db: d,
      csvText: csv([irs(["dap.digitalgov.gov"]), example([]), { ...example([]), top_level_domain: "com", base_domain: "fake.com", url: "https://fake.com/" }]),
      now: nowIso(),
    });
    expect(r.ok).toBe(true);
    expect(r.headerOk).toBe(true);
    expect(r.itemsSeen).toBe(2); // fake.com skipped
    expect(r.promoted).toBe(0); // no prior scan → nothing is "newly appeared"
    expect(d.siteScansByDomain("example.gov")).toHaveLength(1);
    expect(d.promotedWatchDomains()).toEqual([]);
  });

  it("promotes an apex when a new NON-benign third party appears; ignores a new benign one", async () => {
    const d = db();
    const now = nowIso();
    await runSiteScan({ db: d, csvText: csv([irs(["dap.digitalgov.gov"]), example([])]), now });
    // Day 2: example.gov gains a Meta pixel (promote); irs.gov gains GA (benign → ignore).
    const r = await runSiteScan({
      db: d,
      csvText: csv([irs(["dap.digitalgov.gov", "www.google-analytics.com"]), example(["connect.facebook.net"])]),
      now,
    });
    expect(r.promoted).toBe(1);
    expect(d.promotedWatchDomains()).toEqual(["example.gov"]);
    expect(d.listPromotionCandidates()[0]?.reason).toContain("connect.facebook.net");
  });

  it("treats a timeout as unknown, never as absence (no promotion when either side didn't complete)", async () => {
    const d = db();
    const now = nowIso();
    await runSiteScan({ db: d, csvText: csv([example([])]), now });
    // A new tracker shows up but the CURRENT scan timed out → we can't trust presence → no promote.
    const r1 = await runSiteScan({ db: d, csvText: csv([example(["connect.facebook.net"], "timeout")]), now });
    expect(r1.promoted).toBe(0);
    // Now it completes but the PRIOR row we compare against was a timeout → absence unestablished.
    const r2 = await runSiteScan({ db: d, csvText: csv([example(["connect.facebook.net"], "completed")]), now });
    expect(r2.promoted).toBe(0);
    expect(d.promotedWatchDomains()).toEqual([]);
  });

  it("promotes a site's OWN Google Analytics (dap=false) but not DAP's tag", async () => {
    const d = db();
    const now = nowIso();
    await runSiteScan({ db: d, csvText: csv([example([], "completed", "")]), now });
    const r = await runSiteScan({ db: d, csvText: csv([example([], "completed", "G-SITEOWN")]), now });
    expect(r.promoted).toBe(1);
    expect(d.listPromotionCandidates()[0]?.reason).toContain("G-SITEOWN");
  });

  it("seed mode populates state but queues no promotions", async () => {
    const d = db();
    const now = nowIso();
    await runSiteScan({ db: d, csvText: csv([example([])]), now, emitChanges: false });
    const r = await runSiteScan({
      db: d,
      csvText: csv([example(["connect.facebook.net"])]),
      now,
      emitChanges: false,
    });
    expect(r.promoted).toBe(0);
    expect(d.promotedWatchDomains()).toEqual([]);
    expect(d.siteScansByDomain("example.gov")).toHaveLength(1);
  });

  it("a promoted apex drops out of the sweep set once Floodlight has a scorecard for it", async () => {
    const d = db();
    const now = nowIso();
    await runSiteScan({ db: d, csvText: csv([example([])]), now });
    await runSiteScan({ db: d, csvText: csv([example(["connect.facebook.net"])]), now });
    expect(d.promotedWatchDomains()).toEqual(["example.gov"]);
    d.upsertScorecard(
      {
        url: "https://example.gov/",
        domain: "example.gov",
        trackerCount: 1,
        sessionReplay: false,
        firstPartyProxied: false,
        privacyNoticeUrl: null,
        requestCount: 3,
        engineVersion: "test",
        severity: "notable",
        trackersJson: "[]",
        reasonsJson: "[]",
      },
      now,
    );
    expect(d.promotedWatchDomains()).toEqual([]); // self-limiting: it's been looked at
  });

  it("re-promotes a previously-cleared apex when a NEW tracker appears (stale scorecard must not block)", async () => {
    const d = db();
    // Long-ago Floodlight look that found nothing (a scorecard dated before today's re-flag).
    d.upsertScorecard(
      {
        url: "https://example.gov/",
        domain: "example.gov",
        trackerCount: 0,
        sessionReplay: false,
        firstPartyProxied: false,
        privacyNoticeUrl: null,
        requestCount: 2,
        engineVersion: "test",
        severity: "info",
        trackersJson: "[]",
        reasonsJson: "[]",
      },
      "2026-01-01T00:00:00.000Z",
    );
    const now = "2026-07-16T00:00:00.000Z";
    await runSiteScan({ db: d, csvText: csv([example([])]), now });
    const r = await runSiteScan({ db: d, csvText: csv([example(["connect.facebook.net"])]), now });
    expect(r.promoted).toBe(1);
    // The stale (Jan) scorecard predates the (July) re-flag, so it must NOT suppress the promotion.
    expect(d.promotedWatchDomains()).toEqual(["example.gov"]);
  });

  it("does not promote a site's GA tag when GSA left the dap cell blank (could be DAP's own tag)", async () => {
    const d = db();
    const now = nowIso();
    const blankDap = (ga: string): Record<string, string> => ({ ...example([], "completed", ga), dap: "" });
    await runSiteScan({ db: d, csvText: csv([blankDap("")]), now });
    const r = await runSiteScan({ db: d, csvText: csv([blankDap("G-COULDBEDAP")]), now });
    expect(r.promoted).toBe(0);
    expect(d.promotedWatchDomains()).toEqual([]);
  });

  it("fails loud to /status on header drift, writing no state", async () => {
    const d = db();
    const badHeader = HEADER.filter((h) => h !== "third_party_service_domains");
    const badCsv = [badHeader.join(","), badHeader.map(() => "x").join(",")].join("\n");
    const r = await runSiteScan({ db: d, csvText: badCsv, now: nowIso() });
    expect(r.ok).toBe(false);
    expect(r.headerOk).toBe(false);
    expect(r.itemsSeen).toBe(0);
    const status = d.getStatus().find((s) => s.module === "sitescanning");
    expect(status?.ok).toBe(0);
    expect(status?.error).toContain("third_party_service_domains");
  });

  it("scanContentHash is stable across re-ingest and shifts when a field changes", () => {
    const rec = {
      url: "https://example.gov/",
      domain: "example.gov",
      scannedAt: "2026-07-15",
      primaryScanStatus: "completed",
      dap: false,
      gaTagId: null,
      thirdPartyDomains: ["b.com", "a.com"],
      thirdPartyCount: 2,
    };
    const h1 = scanContentHash(rec);
    const h2 = scanContentHash({ ...rec, thirdPartyDomains: ["a.com", "b.com"] }); // order-independent
    const h3 = scanContentHash({ ...rec, thirdPartyDomains: ["a.com"] });
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});
