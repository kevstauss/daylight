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

  it("quietlyPulledAds: still declared running but no longer observed → a query, not a rewrite", () => {
    const d = db();
    d.upsertAd({ adKey: "meta:running", platform: "meta", domain: "dhs.gov", runEnd: null }, "2026-07-01T00:00:00.000Z");
    d.upsertAd({ adKey: "meta:ended", platform: "meta", domain: "dhs.gov", runEnd: "2026-06-01T00:00:00.000Z" }, "2026-07-01T00:00:00.000Z");
    d.upsertAd({ adKey: "meta:current", platform: "meta", domain: "dhs.gov", runEnd: null }, NOW);
    // As of NOW: 'running' was last seen 2026-07-01 and is still declared running → pulled.
    // 'ended' declared an end date → not "pulled". 'current' seen just now → not stale.
    expect(d.quietlyPulledAds(NOW).map((a) => a.ad_key)).toEqual(["meta:running"]);
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
});
