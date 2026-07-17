import type { Severity } from "@daylight/core";
import type { TrackerCategory } from "@daylight/fingerprints";

/** One network request captured while a page loaded (the browser adapter produces these). */
export interface CapturedRequest {
  url: string;
  method: string;
  resourceType: string; // 'script' | 'xhr' | 'fetch' | 'image' | ...
  postBody?: string; // bounded sample of the request body
  responseContentType?: string;
}

/** DOM facts captured from the loaded page (privacy notice, seal, PII form fields). */
export interface DomFacts {
  privacyNoticeUrl: string | null; // detected privacy-notice link, or null if absent
  hasSeal: boolean;
  formFields: string[]; // normalized PII field kinds, e.g. ['email','tel','file']
}

/** The full passive capture of a single public page load — the analysis input. */
export interface PageCapture {
  url: string;
  requests: CapturedRequest[];
  dom: DomFacts;
}

export interface Tracker {
  vendor: string;
  category: TrackerCategory;
  host: string;
  path: string;
  firstPartyProxied: boolean;
  /**
   * Vendor account/property identifiers carried in the beacon — today the Meta pixel id from
   * `facebook.com/tr?id=<pixel id>`. These are PUBLIC advertiser identifiers (not PII), so they are
   * NOT redacted, and they are the join key that links a tracker on a .gov page to an ad buy by the
   * same account (Broadside). Absent when the vendor exposes none. Not part of the diff key
   * (trackerKey stays vendor-level), so a changing id never reads as a tracker add/remove.
   */
  ids?: string[];
}

export interface Scorecard {
  url: string;
  domain: string; // registrable domain of the page
  trackers: Tracker[];
  trackerCount: number; // third-party trackers
  sessionReplay: boolean;
  firstPartyProxied: boolean;
  privacyNoticeUrl: string | null;
  formFields: string[]; // normalized PII field kinds (e.g. ['email','ssn','photo']) — persisted for Redtape
  requestCount: number;
  engineVersion: string;
  severity: Severity;
  reasons: string[];
}
