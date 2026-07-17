import Papa from "papaparse";

// GSA Site Scanning publishes a WIDE CSV (~103 columns as of 2026-07) whose exact header drifts
// (columns get added; names have already diverged from the old data dictionary). So — unlike
// Ledger, which exact-matches a 7-column header by position — we map the columns we depend on BY
// NAME and require only those. Added/reordered columns are tolerated; a rename or removal of a
// column we read FAILS LOUD (indexColumns → null) so we never silently mis-map, exactly the
// fail-loud discipline Ledger's EXPECTED_HEADER guard exists for.
export const REQUIRED_COLUMNS = [
  "url", // the scanned final URL (our row key)
  "base_domain", // registrable apex (the .gov we'd promote / join on)
  "top_level_domain", // scope gate to .gov
  "scan_date",
  "primary_scan_status", // 'completed' | 'timeout' | … — absence is only real when 'completed'
  "dap", // Digital Analytics Program present (government-wide analytics)
  "ga_tag_id",
  "third_party_service_domains", // JSON-encoded array string inside the cell
  "third_party_service_count",
] as const;

export type RequiredColumn = (typeof REQUIRED_COLUMNS)[number];
export type ColumnIndex = Record<RequiredColumn, number>;

/** Parse the dump with a real CSV parser (never split(',') — cells hold quoted JSON arrays). */
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const res = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  const data = (res.data ?? []) as string[][];
  if (data.length === 0) return { header: [], rows: [] };
  const header = (data[0] ?? []).map((h) => h.replace(/\r$/, "").trim());
  return { header, rows: data.slice(1) };
}

/**
 * Resolve every REQUIRED_COLUMN to its position in this header. Returns null (fail loud) if any is
 * missing — the caller records the drift to /status and writes NO state rather than mis-mapping.
 */
export function indexColumns(header: string[]): ColumnIndex | null {
  const pos = new Map<string, number>();
  header.forEach((name, i) => {
    const key = name.replace(/\r$/, "").trim().toLowerCase();
    if (!pos.has(key)) pos.set(key, i);
  });
  const idx = {} as ColumnIndex;
  for (const col of REQUIRED_COLUMNS) {
    const i = pos.get(col);
    if (i === undefined) return null;
    idx[col] = i;
  }
  return idx;
}

/** The columns we could not find, for a descriptive /status error. */
export function missingColumns(header: string[]): RequiredColumn[] {
  const have = new Set(header.map((h) => h.replace(/\r$/, "").trim().toLowerCase()));
  return REQUIRED_COLUMNS.filter((c) => !have.has(c));
}
