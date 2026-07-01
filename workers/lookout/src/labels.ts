/** The registrable unit for a .gov FQDN is its last two labels (e.g. a.b.ndstudio.gov → ndstudio.gov). */
export function registrableApex(fqdn: string): string {
  const parts = fqdn.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
}

/** Labels left of the apex, in order (e.g. ("a.b.ndstudio.gov","ndstudio.gov") → ["a","b"]). */
export function splitLabels(fqdn: string, apex: string): string[] {
  const f = fqdn.toLowerCase().replace(/\.$/, "");
  const a = apex.toLowerCase();
  if (f === a) return [];
  const suffix = `.${a}`;
  if (!f.endsWith(suffix)) return f.split(".").filter(Boolean);
  return f.slice(0, -suffix.length).split(".").filter(Boolean);
}

/** Strip a leading wildcard and lowercase (CT SANs are often "*.example.gov"). */
export function normalizeFqdn(san: string): string {
  return san.trim().toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
}
