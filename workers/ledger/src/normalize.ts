import type { DomainRecord } from "@daylight/core";
import { sha256 } from "@daylight/core";
import { EXPECTED_HEADER, parseCsv, verifyHeader } from "./csv.js";
import { nullify } from "./text.js";

/** Map a raw CSV row to a normalized DomainRecord (spec §5.2). */
export function normalizeRow(cols: string[]): DomainRecord | null {
  const domainRaw = (cols[0] ?? "").replace(/\r$/, "").trim();
  if (!domainRaw) return null;
  return {
    domain: domainRaw.toLowerCase(), // lowercased for keying
    domainType: (cols[1] ?? "").replace(/\r$/, "").trim(),
    org: (cols[2] ?? "").replace(/\r$/, "").trim(),
    suborg: nullify(cols[3]),
    city: nullify(cols[4]),
    state: nullify(cols[5]),
    securityContactEmail: nullify(cols[6]), // preserve original case for display
  };
}

export interface NormalizedCsv {
  header: string[];
  headerOk: boolean;
  records: DomainRecord[];
}

/** Parse + verify header + normalize. On header drift, records is empty (never mis-map). */
export function normalizeCsv(text: string): NormalizedCsv {
  const { header, rows } = parseCsv(text);
  const headerOk = verifyHeader(header);
  if (!headerOk) return { header, headerOk, records: [] };
  const records: DomainRecord[] = [];
  for (const r of rows) {
    const rec = normalizeRow(r);
    if (rec) records.push(rec);
  }
  return { header, headerOk, records };
}

// A separator that cannot occur in CSV field values, so the join stays injective and a
// field-boundary shift (e.g. "Homeland"+"Security" vs "HomelandSecurity"+"") never collides.
const FIELD_SEP = String.fromCharCode(31); // ASCII Unit Separator (0x1F)

/** Stable content hash over the normalized fields (idempotency key). */
export function canonicalHash(rec: DomainRecord): string {
  return sha256(
    [
      rec.domain,
      rec.domainType,
      rec.org,
      rec.suborg ?? "",
      rec.city ?? "",
      rec.state ?? "",
      rec.securityContactEmail ?? "",
    ].join(FIELD_SEP),
  );
}

export function recordsToMap(records: DomainRecord[]): Map<string, DomainRecord> {
  const m = new Map<string, DomainRecord>();
  for (const r of records) m.set(r.domain, r);
  return m;
}

export { EXPECTED_HEADER, verifyHeader };
