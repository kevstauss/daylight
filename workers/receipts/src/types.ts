/** A timestamped snapshot of a watched page (the diff unit for the removal ledger). */
export interface Snapshot {
  url: string;
  domain: string;
  capturedAt: string; // ISO UTC
  domHash: string;
  trackers: string[]; // tracker keys (e.g. "Google Analytics@www.google-analytics.com")
  privacyTextHash: string | null; // null = no privacy notice present
  privacyText: string | null; // raw notice text (redacted + raw-store only; never served)
  formFields: string[]; // PII field kinds present (e.g. ['email','file'])
  sealPresent: boolean;
  redirectTarget: string | null; // off-domain final URL if the page redirected elsewhere (else null)
  screenshotRef: string | null; // raw-store path; never served publicly
  waybackUrl: string | null;
}
