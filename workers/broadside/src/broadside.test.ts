import { describe, it, expect } from "vitest";
import { parseBroadsideConfig, type BroadsideAdvertiser } from "@daylight/core";
import { createDb, type DaylightDb } from "@daylight/db";
import { runBroadside } from "./run.js";
import type { AdFetcher, ObservedAd } from "./types.js";

const NOW = "2026-07-17T00:00:00.000Z";
const LATER = "2026-07-18T00:00:00.000Z";

function db(): DaylightDb {
  return createDb(":memory:");
}

const DHS: BroadsideAdvertiser = {
  agency: "Department of Homeland Security",
  domain: "dhs.gov",
  category: "Immigration enforcement",
  metaPageId: "179587888720522",
  googleAdvertiserId: null,
  highSignal: true,
};

function metaFetcher(map: Record<string, ObservedAd[]>): AdFetcher {
  return {
    platform: "meta",
    fetchAds: (a) => Promise.resolve(a.metaPageId ? map[a.metaPageId] ?? [] : []),
  };
}

const ad = (id: string, over: Partial<ObservedAd> = {}): ObservedAd => ({
  platformAdId: id,
  advertiser: "DHS",
  spendMin: 1000,
  spendMax: 4999,
  spendCurrency: "USD",
  impressionsMin: 10000,
  impressionsMax: 50000,
  runStart: "2026-02-01T00:00:00.000Z",
  runEnd: null,
  sourceUrl: `https://www.facebook.com/ads/library/?id=${id}`,
  ...over,
});

describe("broadside config", () => {
  it("keeps advertisers with a platform id + domain, drops placeholders", () => {
    const cfg = parseBroadsideConfig(`
advertisers:
  - { agency: "DHS", domain: DHS.GOV, meta_page_id: "179587888720522", high_signal: true }
  - { agency: "Placeholder", domain: x.gov, meta_page_id: "" }
  - { agency: "NoDomain", meta_page_id: "123" }
`);
    expect(cfg).toHaveLength(1);
    expect(cfg[0]).toMatchObject({ domain: "dhs.gov", metaPageId: "179587888720522", highSignal: true });
  });
});

describe("ads storage", () => {
  it("upsertAd is idempotent and stores spend/impressions AS RANGES (bounds, never a midpoint)", () => {
    const d = db();
    const a = {
      adKey: "meta:1",
      platform: "meta",
      domain: "dhs.gov",
      spendMin: 1000,
      spendMax: 4999,
      impressionsMin: 10000,
      impressionsMax: 50000,
      runEnd: null,
    };
    expect(d.upsertAd(a, NOW).inserted).toBe(true);
    expect(d.upsertAd({ ...a }, LATER).inserted).toBe(false);
    const row = d.getAd("meta:1");
    expect([row?.spend_min, row?.spend_max]).toEqual([1000, 4999]);
    expect([row?.impressions_min, row?.impressions_max]).toEqual([10000, 50000]);
    expect(row?.first_seen).toBe(NOW);
    expect(row?.last_seen).toBe(LATER); // advanced on repeat, first_seen preserved
  });

  it("quietlyPulledAds: still declared running but no longer observed in the latest sweep", () => {
    const d = db();
    d.upsertAd({ adKey: "meta:running", platform: "meta", domain: "dhs.gov", runEnd: null }, "2026-07-01T00:00:00.000Z");
    d.upsertAd({ adKey: "meta:ended", platform: "meta", domain: "dhs.gov", runEnd: "2026-06-01T00:00:00.000Z" }, "2026-07-01T00:00:00.000Z");
    d.upsertAd({ adKey: "meta:current", platform: "meta", domain: "dhs.gov", runEnd: null }, NOW); // latest sweep = NOW
    // Cutoff is the latest sweep (MAX last_seen = NOW), NOT wall-clock: 'running' (last seen before
    // NOW, still declared running) is pulled; 'current' (seen this sweep) is not; 'ended' declared an
    // end date so it isn't "pulled".
    expect(d.quietlyPulledAds().map((a) => a.ad_key)).toEqual(["meta:running"]);
    // With only one sweep, nothing has disappeared yet.
    const one = db();
    one.upsertAd({ adKey: "meta:x", platform: "meta", domain: "dhs.gov", runEnd: null }, NOW);
    expect(one.quietlyPulledAds()).toEqual([]);
  });
});

describe("pixelAdLoop (closed-loop join)", () => {
  it("returns the domain's Floodlight Meta pixel ids and its ad buys together", () => {
    const d = db();
    d.upsertScorecard(
      {
        url: "https://dhs.gov/",
        domain: "dhs.gov",
        trackerCount: 1,
        sessionReplay: false,
        firstPartyProxied: false,
        privacyNoticeUrl: null,
        requestCount: 3,
        engineVersion: "test",
        severity: "notable",
        trackersJson: JSON.stringify([
          { vendor: "Meta / Facebook", category: "advertising", host: "www.facebook.com", path: "/tr", firstPartyProxied: false, ids: ["15551234567890"] },
        ]),
        reasonsJson: "[]",
      },
      NOW,
    );
    d.upsertAd({ adKey: "meta:1", platform: "meta", domain: "dhs.gov", runEnd: null }, NOW);
    const loop = d.pixelAdLoop("dhs.gov");
    expect(loop.pixelIds).toEqual(["15551234567890"]);
    expect(loop.ads.map((a) => a.ad_key)).toEqual(["meta:1"]);
  });
});

describe("runBroadside engine (mock fetcher)", () => {
  it("populates ads, is idempotent, records /status, and tracks an advertiser that returned nothing", async () => {
    const d = db();
    const fetcher = metaFetcher({ "179587888720522": [ad("a1"), ad("a2")] });
    const r1 = await runBroadside({ db: d, advertisers: [DHS], fetchers: [fetcher], now: NOW });
    expect(r1.ok).toBe(true);
    expect(r1.adsSeen).toBe(2);
    expect(r1.adsNew).toBe(2);
    expect(d.adsByDomain("dhs.gov")).toHaveLength(2);
    expect(d.getStatus().find((s) => s.module === "broadside")?.ok).toBe(1);

    const r2 = await runBroadside({ db: d, advertisers: [DHS], fetchers: [fetcher], now: NOW });
    expect(r2.adsNew).toBe(0); // idempotent

    // An empty return for an advertiser that HAS a page id is the "went dark" signal.
    const empty = await runBroadside({ db: d, advertisers: [DHS], fetchers: [metaFetcher({})], now: NOW });
    expect(empty.emptyAdvertisers).toEqual(["Department of Homeland Security (meta)"]);
  });

  it("is seed-safe: the first run baselines silently; later runs emit new-ad + spend-grew changes", async () => {
    const d = db();
    // First run: baseline only (no changes), even though ads are new.
    const base = await runBroadside({ db: d, advertisers: [DHS], fetchers: [metaFetcher({ "179587888720522": [ad("a1")] })], now: NOW });
    expect(base.seededBaseline).toBe(true);
    expect(base.changesEmitted).toBe(0);
    expect(d.listChanges({ module: "broadside" })).toHaveLength(0);

    // Later run: a genuinely new ad → 'added'; and a1's spend bucket grew → 'modified' spend.
    const r = await runBroadside({
      db: d,
      advertisers: [DHS],
      fetchers: [metaFetcher({ "179587888720522": [ad("a1", { spendMax: 9999 }), ad("a2")] })],
      now: LATER,
    });
    expect(r.seededBaseline).toBe(false);
    const changes = d.listChanges({ module: "broadside" });
    const added = changes.find((c) => c.kind === "added");
    expect(added?.reason).toContain("new ad observed for Department of Homeland Security");
    expect(added?.reason).toContain("$1,000–$4,999"); // spend rendered as a RANGE, not a midpoint
    const spend = changes.find((c) => c.field === "spend");
    expect(spend?.kind).toBe("modified");
    expect(spend?.new_value).toContain("$1,000–$9,999");
  });
});

describe("spend aggregation (ranges as ranges)", () => {
  it("spendByCategory sums bounds into a range and flags open-ended top buckets", () => {
    const d = db();
    d.upsertAd({ adKey: "meta:1", platform: "meta", domain: "dhs.gov", category: "Immigration enforcement", spendMin: 1000, spendMax: 4999, spendCurrency: "USD" }, NOW);
    d.upsertAd({ adKey: "meta:2", platform: "meta", domain: "dhs.gov", category: "Immigration enforcement", spendMin: 100000, spendMax: null, spendCurrency: "USD" }, NOW); // open-ended "$100k+"
    d.upsertAd({ adKey: "meta:3", platform: "meta", domain: "dhs.gov", category: "Immigration enforcement" }, NOW); // undisclosed
    const [row] = d.spendByCategory();
    expect(row?.category).toBe("Immigration enforcement");
    expect(row?.ads_total).toBe(3);
    expect(row?.disclosed_ads).toBe(2);
    expect(row?.open_ended_ads).toBe(1);
    expect(row?.spend_min_total).toBe(101000); // Σ of all disclosed mins — a valid FLOOR
    expect(row?.spend_max_total).toBe(4999); // Σ of CLOSED maxes only — NOT a valid ceiling when open-ended > 0
    // Honest display: an open-ended top bucket → render a floor "≥ Σmin", never a two-sided range
    // (which would invert nonsensically: 101,000 > 4,999).
    const r = row!;
    const display = r.open_ended_ads > 0 ? `≥ $${r.spend_min_total.toLocaleString("en-US")}` : `$${r.spend_min_total}–$${r.spend_max_total}`;
    expect(display).toBe("≥ $101,000");
  });

  it("newAds returns ads first seen on/after the cutoff, newest first", () => {
    const d = db();
    d.upsertAd({ adKey: "meta:old", platform: "meta", domain: "dhs.gov" }, "2026-07-01T00:00:00.000Z");
    d.upsertAd({ adKey: "meta:new", platform: "meta", domain: "dhs.gov" }, LATER);
    expect(d.newAds(NOW).map((a) => a.ad_key)).toEqual(["meta:new"]);
  });
});
