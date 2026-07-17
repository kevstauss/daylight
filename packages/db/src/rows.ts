import type { DomainRecord } from "@daylight/core";

export interface DomainRow {
  id: number;
  domain: string;
  domain_type: string | null;
  org: string | null;
  suborg: string | null;
  city: string | null;
  state: string | null;
  security_contact_email: string | null;
  first_seen: string;
  last_seen: string;
}

export interface ObservationRow {
  id: number;
  module: string;
  domain: string;
  observed_at: string;
  source_url: string;
  content_hash: string;
  payload_json: string;
}

export interface ChangeRow {
  id: number;
  module: string;
  domain: string;
  detected_at: string;
  kind: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  severity: string;
  reason: string | null;
  source_url: string | null;
}

export interface ScanRow {
  id: number;
  module: string;
  started_at: string;
  finished_at: string | null;
  ok: number | null;
  error: string | null;
  items_seen: number | null;
  changes_emitted: number | null;
}

export interface AlertRow {
  id: number;
  change_id: number;
  subscription_pattern: string | null;
  channel: string | null;
  target: string | null;
  sent_at: string | null;
  ok: number | null;
  error: string | null;
}

export interface SubdomainRow {
  id: number;
  fqdn: string;
  apex: string;
  first_seen: string;
  last_seen: string;
  labels: string | null; // JSON array
  flag_severity: string | null;
  flag_reason: string | null;
  apex_owner_org: string | null;
  apex_owner_suborg: string | null;
}

export interface ScorecardRow {
  /** 1 = this capture finished loading. Absence is only evidence when both sides are 1. */
  settled?: number | null;
  id: number;
  url: string;
  domain: string;
  scanned_at: string;
  tracker_count: number | null;
  session_replay: number | null;
  first_party_proxied: number | null;
  privacy_notice_url: string | null;
  request_count: number | null;
  engine_version: string | null;
  severity: string | null;
  trackers_json: string | null;
  reasons_json: string | null;
  form_fields_json: string | null;
}

export interface SnapshotRow {
  id: number;
  url: string;
  domain: string;
  captured_at: string;
  dom_hash: string | null;
  screenshot_ref: string | null;
  tracker_snapshot_json: string | null;
  privacy_text_hash: string | null;
  /** 'url' | 'text' — which measurement privacy_text_hash holds. Hashes of different things
   *  are not comparable; NULL means unknown (pre-dates the label) and blocks the comparison. */
  privacy_hash_kind: string | null;
  form_fields_json: string | null;
  seal_present: number | null;
  redirect_target: string | null; // off-domain final URL if the page redirected elsewhere
  wayback_url: string | null;
  /** 1 = the page finished loading before inventory. Only then does ABSENCE mean anything. */
  settled: number | null;
}

/**
 * A coverage-table row: the latest snapshot for a page, plus the most recent archive we hold
 * for that page from ANY snapshot. Archiving fails independently of capture (SPN2 rate limits,
 * a slow origin), so the newest snapshot often has no archive while an older one does. These
 * two dates are deliberately separate: `archive_captured_at` is the snapshot the archive
 * actually belongs to, and it must be rendered as such — an archive from last week is NOT an
 * archive of today's capture, and must never be presented as one.
 */
export interface CoverageRow extends SnapshotRow {
  archive_url: string | null;
  archive_captured_at: string | null;
}

export interface GapRow {
  id: number;
  domain: string;
  url: string | null;
  collects_pii_evidence_json: string | null;
  pia_found: number | null;
  pia_refs_json: string | null;
  sorn_found: number | null;
  sorn_refs_json: string | null;
  queries_run_json: string | null;
  sources_checked_json: string | null;
  gap_assessment: string | null; // effective/published label
  model_assessment: string | null; // the model's original label, preserved on human reclassification
  confidence: number | null;
  fact_vs_inference_notes: string | null;
  agent_recommendation: string | null; // AI's internal per-run recommendation; shown on /review, never public
  human_reviewed: number | null;
  reviewer_note: string | null;
  published: number | null;
  review_disposition: string | null; // 'published' | 'held' | 'rejected' | null
  created_at: string;
}

export interface CorrectionRow {
  id: number;
  domain: string;
  module: string;
  kind: string;
  reason: string;
  ref_id: number | null;
  created_at: string;
}

/** One aggregate analytics bucket. Holds no per-visitor data by construction (see schema.ts). */
export interface AnalyticsHitRow {
  day: string;
  path: string;
  ref_kind: string;
  ref_host: string;
  count: number;
}

/** The latest GSA Site-Scanning row for one scanned URL (breadth net; see schema.ts). */
export interface SiteScanRow {
  id: number;
  url: string;
  domain: string;
  scanned_at: string;
  observed_at: string;
  source_url: string;
  primary_scan_status: string | null; // 'completed' | 'timeout' | … — absence only when 'completed'
  dap: number | null; // 0/1
  ga_tag_id: string | null;
  third_party_domains_json: string | null; // JSON array of hostnames
  third_party_count: number | null;
  content_hash: string;
}

/** A .gov apex Site Scanning flagged for a full Floodlight pass (see schema.ts). */
export interface PromotionCandidateRow {
  id: number;
  domain: string;
  reason: string;
  source_url: string;
  first_seen: string;
  last_seen: string;
}

/** A repo observed under a watched federal GitHub org (see schema.ts). Keyed on repo_id. */
export interface GithubRepoRow {
  repo_id: number;
  org: string;
  name: string;
  full_name: string;
  html_url: string;
  is_fork: number | null;
  created_at: string | null;
  pushed_at: string | null;
  has_commits: number | null;
  first_seen: string;
  last_seen: string;
}

/** Map a persisted domains row back to the normalized DomainRecord contract. */
export function rowToDomainRecord(row: DomainRow): DomainRecord {
  return {
    domain: row.domain,
    domainType: row.domain_type ?? "",
    org: row.org ?? "",
    suborg: row.suborg,
    city: row.city,
    state: row.state,
    securityContactEmail: row.security_contact_email,
  };
}
