/** A timestamped snapshot of a watched page (the diff unit for the removal ledger). */
export interface Snapshot {
  url: string;
  domain: string;
  capturedAt: string; // ISO UTC
  domHash: string;
  trackers: string[]; // tracker keys (e.g. "Google Analytics@www.google-analytics.com")
  privacyTextHash: string | null; // null = no privacy notice present
  /**
   * WHICH measurement privacyTextHash holds: the notice's fetched TEXT, or just its URL.
   *
   * These are unrelated values in the same field. The capture hashes the URL, then upgrades to a
   * text hash if it can fetch the policy — and that fetch fails on exactly the bot-protected
   * hosts we watch. So the field flipped between two values for an unchanged page and published
   * "privacy notice text changed" 38 times. A hash is only comparable to a hash of the same
   * thing.
   */
  privacyHashKind: "url" | "text" | null;
  privacyText: string | null; // raw notice text (redacted + raw-store only; never served)
  formFields: string[]; // PII field kinds present (e.g. ['email','file'])
  sealPresent: boolean;
  redirectTarget: string | null; // off-domain final URL if the page redirected elsewhere (else null)
  screenshotRef: string | null; // raw-store path; never served publicly
  waybackUrl: string | null;
  /** Did the page stop fetching before we inventoried it? Decides whether ABSENCE in this
   *  snapshot means anything (see LiveCapture.settled). Older rows predate the flag and are
   *  treated as unsettled — unknown, so no absence is inferred from them. */
  settled: boolean;
}
