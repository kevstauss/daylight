import type { BroadsideAdvertiser } from "@daylight/core";

/**
 * One ad as observed in a public ad library, normalized. Spend/impressions are BUCKETS — carried as
 * range bounds, never a midpoint. runEnd null = the ad is still declared running.
 */
export interface ObservedAd {
  platformAdId: string; // the library's ad id (→ ad_key = '<platform>:<platformAdId>')
  advertiser?: string | null;
  advertiserId?: string | null;
  fundingEntity?: string | null;
  spendMin?: number | null;
  spendMax?: number | null;
  spendCurrency?: string | null;
  impressionsMin?: number | null;
  impressionsMax?: number | null;
  runStart?: string | null;
  runEnd?: string | null;
  creativeRef?: string | null; // raw-store path; never served
  sourceUrl?: string | null; // the public ad-library permalink (ad_snapshot_url)
  landingUrl?: string | null;
  pixelIds?: string[];
}

/**
 * The injectable fetch seam — one per platform. The REAL Meta implementation (Graph API
 * `/ads_archive`, tied to an ID-verified token) and Google implementation (BigQuery
 * `google_political_ads`) are DEFERRED pending credentials; CI injects a mock, exactly like
 * Redtape's Researcher. `fetchAds` returns [] when the advertiser is not currently in the archive —
 * which the engine must treat as an EVENT to log (possible reclassification), never as silent truth.
 */
export interface AdFetcher {
  platform: string; // 'meta' | 'google'
  fetchAds(advertiser: BroadsideAdvertiser): Promise<ObservedAd[]>;
}
