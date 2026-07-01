// Tracker & session-replay fingerprints. This is a CURATED set — the vendors that actually
// turn up on federal .gov sites (Google Analytics/GA4, Google Tag Manager, the federal Digital
// Analytics Program, Adobe, Qualtrics, Foresee/Verint, Tealium, New Relic) plus the common
// analytics / ad / session-replay vendors — NOT a full import of DuckDuckGo Tracker Radar or
// EasyPrivacy (those are thousands of hosts; this is the high-signal subset, easy to audit and
// extend). The robust signal is host + payload shape, not a single hardcoded path — see
// @daylight/floodlight/analyze. Add vendors here as they're observed in the wild.

export type TrackerCategory =
  | "analytics"
  | "session-replay"
  | "advertising"
  | "tag-manager"
  | "social"
  | "cdn";

export interface Fingerprint {
  vendor: string;
  category: TrackerCategory;
  /** Host substrings that identify this vendor (matched case-insensitively). */
  hosts: string[];
  /** True if this vendor offers session replay (records clicks/scrolls/keystrokes). */
  sessionReplay?: boolean;
}

export const FINGERPRINTS: Fingerprint[] = [
  { vendor: "Google Analytics", category: "analytics", hosts: ["google-analytics.com", "analytics.google.com", "g.doubleclick.net"] },
  { vendor: "Google Tag Manager", category: "tag-manager", hosts: ["googletagmanager.com"] },
  { vendor: "Google Ads", category: "advertising", hosts: ["googleadservices.com", "doubleclick.net", "googlesyndication.com"] },
  { vendor: "Meta / Facebook", category: "advertising", hosts: ["facebook.com/tr", "connect.facebook.net"] },
  { vendor: "PostHog", category: "analytics", hosts: ["posthog.com", "i.posthog.com", "app.posthog.com", "us.i.posthog.com", "eu.i.posthog.com"], sessionReplay: true },
  { vendor: "FullStory", category: "session-replay", hosts: ["fullstory.com", "rs.fullstory.com", "fs.js"], sessionReplay: true },
  { vendor: "Hotjar", category: "session-replay", hosts: ["hotjar.com", "hotjar.io", "static.hotjar.com"], sessionReplay: true },
  { vendor: "Microsoft Clarity", category: "session-replay", hosts: ["clarity.ms"], sessionReplay: true },
  { vendor: "Datadog RUM", category: "analytics", hosts: ["datadoghq.com", "browser-intake-datadoghq.com"], sessionReplay: true },
  { vendor: "LogRocket", category: "session-replay", hosts: ["logrocket.com", "lr-ingest.io", "logr-ingest.com"], sessionReplay: true },
  { vendor: "Mouseflow", category: "session-replay", hosts: ["mouseflow.com"], sessionReplay: true },
  { vendor: "Smartlook", category: "session-replay", hosts: ["smartlook.com", "smartlook.cloud"], sessionReplay: true },
  { vendor: "Contentsquare", category: "session-replay", hosts: ["contentsquare.net", "contentsquare.com"], sessionReplay: true },
  { vendor: "Amplitude", category: "analytics", hosts: ["amplitude.com", "api.amplitude.com", "api2.amplitude.com"] },
  { vendor: "Heap", category: "analytics", hosts: ["heap.io", "heapanalytics.com"] },
  { vendor: "Segment", category: "analytics", hosts: ["segment.com", "segment.io", "cdn.segment.com", "api.segment.io"] },
  { vendor: "Mixpanel", category: "analytics", hosts: ["mixpanel.com", "api.mixpanel.com"] },
  // --- Common on federal .gov sites ---
  { vendor: "Digital Analytics Program (DAP)", category: "analytics", hosts: ["dap.digitalgov.gov"] },
  { vendor: "Adobe Analytics", category: "analytics", hosts: ["omtrdc.net", "2o7.net", "demdex.net", "everesttech.net"] },
  { vendor: "Adobe DTM / Launch", category: "tag-manager", hosts: ["adobedtm.com", "assets.adobedtm.com"] },
  { vendor: "Qualtrics", category: "analytics", hosts: ["qualtrics.com", "siteintercept.qualtrics.com"] },
  { vendor: "Verint / Foresee", category: "session-replay", hosts: ["foresee.com", "foreseeresults.com", "answerscloud.com"], sessionReplay: true },
  { vendor: "Tealium", category: "tag-manager", hosts: ["tiqcdn.com", "tealiumiq.com"] },
  { vendor: "New Relic", category: "analytics", hosts: ["nr-data.net", "js-agent.newrelic.com", "newrelic.com"] },
  { vendor: "Optimizely", category: "analytics", hosts: ["optimizely.com", "optimizelyapis.com"] },
  { vendor: "Matomo", category: "analytics", hosts: ["matomo.cloud", "matomo.org"] },
  { vendor: "Chartbeat", category: "analytics", hosts: ["chartbeat.com", "static.chartbeat.com"] },
  { vendor: "Plausible", category: "analytics", hosts: ["plausible.io"] },
  { vendor: "Cloudflare Web Analytics", category: "analytics", hosts: ["cloudflareinsights.com"] },
  { vendor: "HubSpot", category: "analytics", hosts: ["hs-analytics.net", "hs-scripts.com", "hubspot.com"] },
  // --- Session replay ---
  { vendor: "Glassbox", category: "session-replay", hosts: ["glassbox.com", "glassboxdigital.io"], sessionReplay: true },
  { vendor: "Medallia / Decibel", category: "session-replay", hosts: ["decibelinsight.net", "media.nl"], sessionReplay: true },
  { vendor: "Inspectlet", category: "session-replay", hosts: ["inspectlet.com"], sessionReplay: true },
  { vendor: "Lucky Orange", category: "session-replay", hosts: ["luckyorange.com", "luckyorange.net"], sessionReplay: true },
  { vendor: "UserZoom", category: "session-replay", hosts: ["userzoom.com"], sessionReplay: true },
  // --- Advertising / social ---
  { vendor: "Microsoft Advertising (UET)", category: "advertising", hosts: ["bat.bing.com"] },
  { vendor: "X / Twitter Ads", category: "advertising", hosts: ["ads-twitter.com", "analytics.twitter.com", "static.ads-twitter.com"] },
  { vendor: "LinkedIn Insight", category: "advertising", hosts: ["snap.licdn.com", "px.ads.linkedin.com"] },
  { vendor: "TikTok Pixel", category: "advertising", hosts: ["analytics.tiktok.com"] },
  { vendor: "Pinterest Tag", category: "advertising", hosts: ["ct.pinterest.com"] },
  { vendor: "Snapchat Pixel", category: "advertising", hosts: ["tr.snapchat.com", "sc-static.net"] },
  { vendor: "Criteo", category: "advertising", hosts: ["criteo.com", "criteo.net"] },
  { vendor: "Taboola", category: "advertising", hosts: ["taboola.com"] },
  { vendor: "Outbrain", category: "advertising", hosts: ["outbrain.com"] },
  { vendor: "Amazon Advertising", category: "advertising", hosts: ["amazon-adsystem.com"] },
  { vendor: "Quantcast", category: "advertising", hosts: ["quantserve.com", "quantcount.com"] },
  { vendor: "comScore / ScorecardResearch", category: "advertising", hosts: ["scorecardresearch.com"] },
  { vendor: "AddThis", category: "social", hosts: ["addthis.com"] },
  { vendor: "ShareThis", category: "social", hosts: ["sharethis.com"] },
];

// Multi-label public suffixes in this watchdog's realistic scope. A naive "last two labels"
// eTLD+1 is wrong for every one of these: it would fold www.smithville.k12.tx.us to `tx.us`
// (colliding every Texas school district) and bbc.co.uk to `co.uk`. This is a curated subset
// of the Public Suffix List — the US `.us` locality space (state + k12/cc/lib/state/… tiers,
// where US state & local government actually live) plus common ccTLD second levels — not the
// full PSL. Anything not listed falls back to last-two-labels, which is correct for `.gov`,
// `.com`, etc. (the core Ledger dataset is all single-label `.gov`).
const US_STATES =
  "ak al ar az ca co ct dc de fl ga gu hi ia id il in ks ky la ma md me mi mn mo ms mt nc nd ne nh nj nm nv ny oh ok or pa pr ri sc sd tn tx ut va vi vt wa wi wv wy".split(
    " ",
  );
const US_LOCALITY_TIERS = "k12 cc lib state gen cog mus dst pvt tec".split(" ");
const BASE_MULTI_SUFFIXES = [
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk", "sch.uk", "ac.uk", "gov.uk", "nhs.uk", "mod.uk", "police.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au", "asn.au",
  "co.nz", "net.nz", "org.nz", "govt.nz", "ac.nz", "school.nz",
  "co.jp", "or.jp", "ne.jp", "go.jp", "ac.jp", "ad.jp", "ed.jp", "gr.jp", "lg.jp",
  "com.br", "net.br", "org.br", "gov.br", "edu.br",
  "co.in", "net.in", "org.in", "gov.in", "nic.in", "ac.in", "edu.in", "res.in",
  "co.za", "org.za", "gov.za", "ac.za", "net.za", "web.za",
  "com.mx", "org.mx", "gob.mx", "edu.mx", "net.mx",
  "com.cn", "net.cn", "org.cn", "gov.cn", "edu.cn", "ac.cn",
  "co.kr", "or.kr", "ne.kr", "go.kr", "ac.kr", "re.kr",
  "com.sg", "net.sg", "org.sg", "gov.sg", "edu.sg",
  "com.hk", "net.hk", "org.hk", "gov.hk", "edu.hk",
  "com.tw", "net.tw", "org.tw", "gov.tw", "edu.tw",
  "co.il", "org.il", "net.il", "gov.il", "ac.il", "muni.il",
  "com.tr", "net.tr", "org.tr", "gov.tr", "edu.tr", "bel.tr",
  "com.ar", "net.ar", "org.ar", "gob.ar", "edu.ar",
  "com.co", "net.co", "org.co", "gov.co", "edu.co",
  "co.id", "or.id", "go.id", "ac.id", "web.id",
  "com.ph", "net.ph", "org.ph", "gov.ph", "edu.ph",
  "com.my", "net.my", "org.my", "gov.my", "edu.my",
  "com.sa", "net.sa", "org.sa", "gov.sa", "edu.sa",
  "co.th", "or.th", "go.th", "ac.th", "in.th",
];

const PUBLIC_SUFFIXES: ReadonlySet<string> = (() => {
  const s = new Set(BASE_MULTI_SUFFIXES);
  for (const st of US_STATES) {
    s.add(`${st}.us`);
    for (const tier of US_LOCALITY_TIERS) s.add(`${tier}.${st}.us`);
  }
  return s;
})();

/** The registrable domain (eTLD+1) using a curated public-suffix set, longest match wins. */
export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const parts = h.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  // Check candidate suffixes longest-first; registrable domain = matched suffix + one label.
  for (let take = Math.min(parts.length - 1, 4); take >= 2; take--) {
    const suffix = parts.slice(parts.length - take).join(".");
    if (PUBLIC_SUFFIXES.has(suffix)) return parts.slice(parts.length - take - 1).join(".");
  }
  return parts.slice(-2).join(".");
}

/** Classify a request host against the fingerprint set. */
export function classifyHost(host: string): Fingerprint | null {
  const h = host.toLowerCase();
  for (const fp of FINGERPRINTS) {
    if (fp.hosts.some((needle) => h.includes(needle))) return fp;
  }
  return null;
}

/** Classify a full URL (host + path) — some vendors are identified by a path fragment. */
export function classifyUrl(url: string): Fingerprint | null {
  try {
    const u = new URL(url);
    const byHost = classifyHost(u.host);
    if (byHost) return byHost;
    const hostPath = `${u.host}${u.pathname}`.toLowerCase();
    for (const fp of FINGERPRINTS) {
      if (fp.hosts.some((needle) => needle.includes("/") && hostPath.includes(needle))) return fp;
    }
    return null;
  } catch {
    return null;
  }
}

/** Vendors that offer session replay. */
export const SESSION_REPLAY_VENDORS: ReadonlySet<string> = new Set(
  FINGERPRINTS.filter((f) => f.sessionReplay).map((f) => f.vendor),
);
