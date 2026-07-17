import type { BroadsideAdvertiser } from "@daylight/core";
import { nowIso } from "@daylight/core";
import type { DaylightDb } from "@daylight/db";
import type { AdFetcher, ObservedAd } from "./types.js";

export interface RunBroadsideOptions {
  db: DaylightDb;
  advertisers: BroadsideAdvertiser[];
  fetchers: AdFetcher[]; // Meta / Google implementations (deferred); CI injects a mock
  now?: string;
}

export interface RunBroadsideResult {
  ok: boolean;
  error?: string;
  advertisersPolled: number;
  adsSeen: number;
  adsNew: number;
  /** Advertisers that HAVE this platform's id but returned no ads — a possible reclassification /
   *  "went dark" event to surface when the module goes live (never treated as silent absence). */
  emptyAdvertisers: string[];
}

function hasPlatformId(platform: string, a: BroadsideAdvertiser): boolean {
  if (platform === "meta") return !!a.metaPageId;
  if (platform === "google") return !!a.googleAdvertiserId;
  return false;
}

/**
 * One Broadside pass: for each watched advertiser, ask each platform fetcher for its currently
 * archived ads and upsert them into the `ads` table (ranges stored as ranges; ad_key idempotent).
 * Fetch is async and happens up front; the DB writes run in one synchronous transaction. Records a
 * 'broadside' /status heartbeat.
 *
 * SCAFFOLDING SCOPE: this populates storage and reports health. It deliberately emits NO public
 * Change rows yet — what surfaces (new-ad events, the quietly-pulled ledger, severity) is an
 * editorial decision made at go-live, and Broadside stays behind FLAG_BROADSIDE until then. The
 * "went dark" signal is collected (emptyAdvertisers) but not yet emitted.
 */
export async function runBroadside(opts: RunBroadsideOptions): Promise<RunBroadsideResult> {
  const { db, advertisers, fetchers } = opts;
  const now = opts.now ?? nowIso();
  const scanId = db.recordScanStart("broadside");

  try {
    const fetched: { advertiser: BroadsideAdvertiser; platform: string; ads: ObservedAd[] }[] = [];
    const emptyAdvertisers: string[] = [];
    let adsSeen = 0;
    for (const advertiser of advertisers) {
      for (const fetcher of fetchers) {
        const ads = await fetcher.fetchAds(advertiser);
        adsSeen += ads.length;
        fetched.push({ advertiser, platform: fetcher.platform, ads });
        if (ads.length === 0 && hasPlatformId(fetcher.platform, advertiser)) {
          emptyAdvertisers.push(`${advertiser.agency} (${fetcher.platform})`);
        }
      }
    }

    const adsNew = db.sql.transaction((): number => {
      let n = 0;
      for (const { advertiser, platform, ads } of fetched) {
        for (const ad of ads) {
          const res = db.upsertAd(
            {
              adKey: `${platform}:${ad.platformAdId}`,
              platform,
              domain: advertiser.domain,
              advertiser: ad.advertiser ?? advertiser.agency,
              advertiserId: ad.advertiserId ?? null,
              fundingEntity: ad.fundingEntity ?? null,
              spendMin: ad.spendMin ?? null,
              spendMax: ad.spendMax ?? null,
              spendCurrency: ad.spendCurrency ?? null,
              impressionsMin: ad.impressionsMin ?? null,
              impressionsMax: ad.impressionsMax ?? null,
              runStart: ad.runStart ?? null,
              runEnd: ad.runEnd ?? null,
              creativeRef: ad.creativeRef ?? null,
              sourceUrl: ad.sourceUrl ?? null,
              landingUrl: ad.landingUrl ?? null,
              pixelIds: ad.pixelIds ?? [],
              flagSeverity: advertiser.highSignal ? "notable" : "info",
              flagReason: null,
            },
            now,
          );
          if (res.inserted) n++;
        }
      }
      return n;
    })();

    db.recordScanFinish(scanId, { ok: true, itemsSeen: adsSeen, changesEmitted: adsNew });
    return { ok: true, advertisersPolled: advertisers.length, adsSeen, adsNew, emptyAdvertisers };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    db.recordScanFinish(scanId, { ok: false, error, itemsSeen: 0, changesEmitted: 0 });
    return { ok: false, error, advertisersPolled: advertisers.length, adsSeen: 0, adsNew: 0, emptyAdvertisers: [] };
  }
}
