/** Current instant as an ISO-8601 UTC string (e.g. "2026-07-01T08:00:00.000Z"). */
export function nowIso(): string {
  return new Date().toISOString();
}
