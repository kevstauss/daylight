// Tiny env-backed feature-flag helper. Unfinished surfaces hide behind these so
// `main` is always deployable (PRD §4.3). e.g. FLAG_LEDGER_PERSONWATCH=1.

const TRUTHY = new Set(["1", "true", "yes", "on"]);

/** True when the named flag env var is set to a truthy value. */
export function flag(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined) return false;
  return TRUTHY.has(raw.trim().toLowerCase());
}
