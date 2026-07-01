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
