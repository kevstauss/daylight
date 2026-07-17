import { readFileSync } from "node:fs";
import { load } from "js-yaml";

/** A federal advertiser to watch in the public ad libraries (parsed from config/broadside.yaml). */
export interface BroadsideAdvertiser {
  agency: string; // display name
  domain: string; // the agency's .gov apex — the ad's `domain`, for the /domain join
  metaPageId: string | null; // Facebook Page id searched via the Ad Library API
  googleAdvertiserId: string | null; // Google political-ads advertiser id
  highSignal: boolean;
}

interface RawAdvertiser {
  agency?: string;
  domain?: string;
  meta_page_id?: string;
  google_advertiser_id?: string;
  high_signal?: boolean;
}

/** Parse + normalize config/broadside.yaml. Entries with no usable platform id (a placeholder) are
 *  dropped, so an unfinished seed never becomes a live poll target. */
export function parseBroadsideConfig(yamlText: string): BroadsideAdvertiser[] {
  const raw = (load(yamlText) ?? {}) as { advertisers?: RawAdvertiser[] };
  return (raw.advertisers ?? [])
    .map((a) => ({
      agency: String(a?.agency ?? "").trim(),
      domain: String(a?.domain ?? "").trim().toLowerCase(),
      metaPageId: a?.meta_page_id ? String(a.meta_page_id).trim() : null,
      googleAdvertiserId: a?.google_advertiser_id ? String(a.google_advertiser_id).trim() : null,
      highSignal: !!a?.high_signal,
    }))
    .filter((a) => a.agency && a.domain && (a.metaPageId || a.googleAdvertiserId));
}

export function loadBroadsideConfig(path: string): BroadsideAdvertiser[] {
  return parseBroadsideConfig(readFileSync(path, "utf8"));
}
