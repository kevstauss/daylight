import type { BroadsideAdvertiser } from "@daylight/core";
import { nowIso } from "@daylight/core";
import type { AdRow, DaylightDb } from "@daylight/db";
import type { AdFetcher, ObservedAd } from "./types.js";

export interface RunBroadsideOptions {
  db: DaylightDb;
  advertisers: BroadsideAdvertiser[];
  fetchers: AdFetcher[]; // Meta / Google implementations (deferred); CI injects a mock
  now?: string;
  /** Set false to seed a silent baseline (populate ads WITHOUT emitting changes). */
  emitChanges?: boolean;
}

export interface RunBroadsideResult {
  ok: boolean;
  error?: string;
  advertisersPolled: number;
  adsSeen: number;
  adsNew: number;
  changesEmitted: number;
  /** True when this run only established the baseline (first-ever run) and emitted nothing. */
  seededBaseline: boolean;
  /** Advertisers that HAVE this platform's id but returned no ads — a possible reclassification /
   *  "went dark" event to surface when the module goes live (never treated as silent absence). */
  emptyAdvertisers: string[];
}

const fmtUsd = (n: number): string => `$${n.toLocaleString("en-US")}`;

/** Format a spend BUCKET as a range — never a midpoint. NULL bounds render honestly as open-ended. */
function spendLabel(
  min: number | null | undefined,
  max: number | null | undefined,
  currency?: string | null,
): string {
  const cur = currency && currency !== "USD" ? ` ${currency}` : "";
  if (min == null && max == null) return "undisclosed spend";
  if (min != null && max == null) return `≥ ${fmtUsd(min)}${cur} (open-ended bucket)`;
  if (min == null && max != null) return `≤ ${fmtUsd(max)}${cur}`;
  return `${fmtUsd(min as number)}–${fmtUsd(max as number)}${cur}`;
}

/** A disclosed spend bucket whose upper OR lower bound rose since we last saw the ad = it spent more. */
function spendGrew(prior: AdRow, ad: ObservedAd): boolean {
  if (prior.spend_max != null && ad.spendMax != null && ad.spendMax > prior.spend_max) return true;
  if (prior.spend_min != null && ad.spendMin != null && ad.spendMin > prior.spend_min) return true;
  return false;
}

const platformLabel = (p: string): string => (p === "meta" ? "Meta Ad Library" : p === "google" ? "Google political-ads" : p);

/**
 * One Broadside pass: for each watched advertiser, ask each platform fetcher for its currently
 * archived ads, upsert them (ranges stored as ranges; ad_key idempotent), and emit `broadside`
 * change events — a new ad ('added') and a grown spend bucket ('modified', field='spend'). Fetch is
 * async up front; DB writes run in one synchronous transaction. Records a 'broadside' /status
 * heartbeat. SEED-SAFE: emits only once a prior successful 'broadside' scan exists, so the first run
 * over an already-live advertiser's ad set establishes a baseline and floods nothing.
 */
export async function runBroadside(opts: RunBroadsideOptions): Promise<RunBroadsideResult> {
  const { db, advertisers, fetchers } = opts;
  const now = opts.now ?? nowIso();
  const emit = opts.emitChanges !== false;
  const emitting = emit && db.hasSuccessfulScan("broadside");
  const seededBaseline = emit && !emitting;
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
        const hasId = fetcher.platform === "meta" ? !!advertiser.metaPageId : fetcher.platform === "google" ? !!advertiser.googleAdvertiserId : false;
        if (ads.length === 0 && hasId) emptyAdvertisers.push(`${advertiser.agency} (${fetcher.platform})`);
      }
    }

    const counts = db.sql.transaction((): { adsNew: number; changes: number } => {
      let adsNew = 0;
      let changes = 0;
      for (const { advertiser, platform, ads } of fetched) {
        for (const ad of ads) {
          const adKey = `${platform}:${ad.platformAdId}`;
          const prior = db.getAd(adKey);
          const res = db.upsertAd(
            {
              adKey,
              platform,
              domain: advertiser.domain,
              category: advertiser.category,
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
          if (res.inserted) adsNew++;

          if (!emitting) continue;
          if (!prior) {
            db.insertChange({
              module: "broadside",
              domain: advertiser.domain,
              detectedAt: now,
              kind: "added",
              severity: advertiser.highSignal ? "notable" : "info",
              reason: `new ad observed for ${advertiser.agency} — disclosed spend ${spendLabel(ad.spendMin, ad.spendMax, ad.spendCurrency)} (${platformLabel(platform)})`,
              sourceUrl: ad.sourceUrl ?? null,
            });
            changes++;
          } else if (spendGrew(prior, ad)) {
            db.insertChange({
              module: "broadside",
              domain: advertiser.domain,
              detectedAt: now,
              kind: "modified",
              field: "spend",
              severity: "info",
              oldValue: spendLabel(prior.spend_min, prior.spend_max, prior.spend_currency),
              newValue: spendLabel(ad.spendMin, ad.spendMax, ad.spendCurrency),
              reason: `disclosed spend range grew for an ad by ${advertiser.agency} (${platformLabel(platform)})`,
              sourceUrl: ad.sourceUrl ?? null,
            });
            changes++;
          }
        }
      }
      return { adsNew, changes };
    })();

    db.recordScanFinish(scanId, { ok: true, itemsSeen: adsSeen, changesEmitted: counts.changes });
    return {
      ok: true,
      advertisersPolled: advertisers.length,
      adsSeen,
      adsNew: counts.adsNew,
      changesEmitted: counts.changes,
      seededBaseline,
      emptyAdvertisers,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    db.recordScanFinish(scanId, { ok: false, error, itemsSeen: 0, changesEmitted: 0 });
    return { ok: false, error, advertisersPolled: advertisers.length, adsSeen: 0, adsNew: 0, changesEmitted: 0, seededBaseline: false, emptyAdvertisers: [] };
  }
}
