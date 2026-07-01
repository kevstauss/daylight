import Papa from "papaparse";

// The real CISA current-federal.csv header, verified against live data 2026-07-01.
export const EXPECTED_HEADER: readonly string[] = [
  "Domain name",
  "Domain type",
  "Organization name",
  "Suborganization name",
  "City",
  "State",
  "Security contact email",
];

// The header CISA has used for current-federal.csv has changed several times since 2019, but
// the COLUMN POSITIONS never moved: [domain, type, top-level-org, sub-org, city, state, email].
// So normalizeRow (which reads by position) maps every one of these identically. We list the
// known variants explicitly — we recognize them, we never blindly trust an unknown 7-column
// file — so the git-history backfill can replay the full record instead of only the current era.
export const RECOGNIZED_HEADERS: readonly (readonly string[])[] = [
  EXPECTED_HEADER,
  // ~2020–2025: "Agency" (top) + "Organization name" (sub).
  ["Domain name", "Domain type", "Agency", "Organization name", "City", "State", "Security contact email"],
  // 2019: title-cased, "Agency" (top) + "Organization" (sub); rows carry trailing empty columns.
  ["Domain Name", "Domain Type", "Agency", "Organization", "City", "State", "Security Contact Email"],
];

/** Parse CSV with a real parser (never split(',') — org names may be quoted). */
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const res = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  const data = (res.data ?? []) as string[][];
  if (data.length === 0) return { header: [], rows: [] };
  const header = (data[0] ?? []).map((h) => h.replace(/\r$/, "").trim());
  return { header, rows: data.slice(1) };
}

/** Drop trailing empty header cells (older revisions pad the row with extra commas). */
function trimTrailingEmpty(header: string[]): string[] {
  const h = header.map((c) => (c ?? "").replace(/\r$/, "").trim());
  while (h.length > 0 && h[h.length - 1] === "") h.pop();
  return h;
}

/**
 * Verify the parsed header matches the CURRENT expected columns exactly (§6.1). The live daily
 * pass uses this and fails loud to /status on any drift — never trust column names blindly.
 */
export function verifyHeader(header: string[]): boolean {
  const h = trimTrailingEmpty(header);
  if (h.length !== EXPECTED_HEADER.length) return false;
  return EXPECTED_HEADER.every((c, i) => h[i] === c);
}

/**
 * True if the header is the current OR a RECOGNIZED historical CISA header. Used only by the
 * git-history backfill: every recognized variant shares the same column positions, so parsing
 * is safe. An unrecognized header still returns false (skipped), so we never mis-map.
 */
export function isRecognizedHeader(header: string[]): boolean {
  const h = trimTrailingEmpty(header).map((c) => c.toLowerCase());
  return RECOGNIZED_HEADERS.some(
    (variant) => variant.length === h.length && variant.every((c, i) => c.toLowerCase() === h[i]),
  );
}
