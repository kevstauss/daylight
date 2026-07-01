// Tracker & session-replay fingerprints. Seeded from DuckDuckGo Tracker Radar categories
// + EasyPrivacy + the session-replay vendor list (PRD Appendix B). The robust signal is
// host + payload shape, not a single hardcoded path — see @daylight/floodlight/analyze.

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
];

/** The registrable domain (eTLD+1, best-effort last two labels). */
export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const parts = h.split(".").filter(Boolean);
  return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
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
