/** Shared text helpers for normalization + matching. */

/** '(blank)', empty, and whitespace-only all become null (spec §5.2). */
export function nullify(s: string | undefined | null): string | null {
  if (s === undefined || s === null) return null;
  const t = s.replace(/\r$/, "").trim();
  if (t === "" || t.toLowerCase() === "(blank)") return null;
  return t;
}

/** Lowercased domain part of an email, or null. */
export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const dom = email.slice(at + 1).trim().toLowerCase();
  return dom || null;
}

/** Case-insensitive exact match; returns the matched pattern (original casing) or null. */
export function matchesAny(value: string | null, patterns: string[]): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  for (const p of patterns) if (p.trim().toLowerCase() === v) return p;
  return null;
}
