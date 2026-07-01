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

/** Parse CSV with a real parser (never split(',') — org names may be quoted). */
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const res = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  const data = (res.data ?? []) as string[][];
  if (data.length === 0) return { header: [], rows: [] };
  const header = (data[0] ?? []).map((h) => h.replace(/\r$/, "").trim());
  return { header, rows: data.slice(1) };
}

/**
 * Verify the parsed header matches the expected columns exactly (§6.1).
 * The dataset drifts; never trust column names without checking the live file.
 */
export function verifyHeader(header: string[]): boolean {
  if (header.length !== EXPECTED_HEADER.length) return false;
  for (let i = 0; i < EXPECTED_HEADER.length; i++) {
    if ((header[i] ?? "").trim() !== EXPECTED_HEADER[i]) return false;
  }
  return true;
}
