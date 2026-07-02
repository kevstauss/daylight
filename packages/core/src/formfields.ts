// Shared PII form-field classifier. Two producers must agree on the SAME normalized kind
// vocabulary: Floodlight's live DOM capture (workers/floodlight/capture.ts) and Receipts' fixture
// HTML path (workers/receipts/html.ts). Keeping the logic here (pure, no browser) means both feed
// identical kinds into the scorecard/snapshot and the diff/content-hash, and Redtape can reason
// about the SAME strings. A bare `type=text` field is NOT PII — we only classify a field when its
// type, autocomplete token, or name/id/placeholder pattern names a specific PII category.

/** Attributes read off a single `<input>` (all lowercased; missing = empty). */
export interface FormInputAttrs {
  type: string; // "text" if the element had no type
  autocomplete?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  accept?: string; // file inputs — image accept ⇒ photo collection
}

/** The high-sensitivity kinds. A form collecting any of these with no PIA/SORN is the canonical
 *  §208 gap — so their presence is a STRONG Redtape trigger, not just supporting evidence. */
export const SENSITIVE_PII_KINDS: ReadonlySet<string> = new Set([
  "ssn",
  "dob",
  "passport",
  "a-number",
  "dl-number",
  "payment-card",
  "photo",
]);

// autocomplete token → normalized kind (HTML autocomplete spec tokens).
const AUTOCOMPLETE_KIND: Record<string, string> = {
  name: "name",
  "given-name": "name",
  "additional-name": "name",
  "family-name": "name",
  "honorific-prefix": "name",
  "honorific-suffix": "name",
  nickname: "name",
  email: "email",
  tel: "tel",
  "tel-national": "tel",
  "tel-local": "tel",
  "tel-area-code": "tel",
  "street-address": "address",
  "address-line1": "address",
  "address-line2": "address",
  "address-line3": "address",
  "address-level1": "address",
  "address-level2": "address",
  "postal-code": "address",
  country: "address",
  "country-name": "address",
  bday: "dob",
  "bday-day": "dob",
  "bday-month": "dob",
  "bday-year": "dob",
  "cc-number": "payment-card",
  "cc-name": "payment-card",
  "cc-exp": "payment-card",
  "cc-exp-month": "payment-card",
  "cc-exp-year": "payment-card",
  "cc-csc": "payment-card",
};

// name / id / placeholder heuristic patterns → normalized kind. Ordered; a field can match several.
const NAME_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "ssn", re: /\bssn\b|social.?security|\bs\.?s\.?n\.?\b|\bitin\b|\btin\b/ },
  { kind: "passport", re: /passport/ },
  { kind: "a-number", re: /\ba-?number\b|alien.?(registration.?)?number|\buscis\b|\breceipt.?number\b/ },
  { kind: "dob", re: /\bdob\b|date.?of.?birth|birth.?date|\bbirthday\b|\bbday\b/ },
  { kind: "dl-number", re: /driver'?s?.?licen[sc]e|\bdln\b|licen[sc]e.?(number|no)/ },
  { kind: "name", re: /first.?name|last.?name|full.?name|\bfname\b|\blname\b|\bmname\b|middle.?name|legal.?name|your.?name|maiden.?name/ },
  { kind: "address", re: /street.?address|address.?line|\bzip.?code\b|postal.?code|mailing.?address|home.?address/ },
  { kind: "tel", re: /phone.?number|\btelephone\b|mobile.?(number|phone)|cell.?phone/ },
  { kind: "email", re: /e-?mail/ },
  { kind: "payment-card", re: /card.?number|\bcc.?num|credit.?card/ },
];

/** All PII kinds a single input implies (via type, autocomplete, and name/id/placeholder). */
export function fieldKinds(a: FormInputAttrs): string[] {
  const kinds = new Set<string>();
  const type = (a.type || "text").toLowerCase();
  if (type === "email") kinds.add("email");
  else if (type === "tel") kinds.add("tel");
  else if (type === "password") kinds.add("password");
  else if (type === "file") {
    kinds.add((a.accept || "").toLowerCase().includes("image") ? "photo" : "file");
  }
  for (const tok of (a.autocomplete || "").toLowerCase().split(/\s+/).filter(Boolean)) {
    const k = AUTOCOMPLETE_KIND[tok];
    if (k) kinds.add(k);
  }
  // Normalize so a word boundary appears around glued tokens: split camelCase (ssnPart → ssn Part)
  // and turn digits + underscores into spaces (ssn1 / applicant_ssn → "ssn"), WITHOUT touching
  // hyphens (the a-number pattern needs "a-number" intact). Otherwise `\bssn\b` misses the very
  // common split/affixed SSN field names (ssn1, ssn2, ssn3, applicant_ssn) — a §208 blind spot.
  const hay = `${a.name || ""} ${a.id || ""} ${a.placeholder || ""}`
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\d]+/g, " ")
    .toLowerCase()
    .trim();
  if (hay) for (const { kind, re } of NAME_PATTERNS) if (re.test(hay)) kinds.add(kind);
  return [...kinds];
}

/** Sorted unique set of PII kinds present across a page's inputs. */
export function classifyFormFields(inputs: FormInputAttrs[]): string[] {
  const all = new Set<string>();
  for (const i of inputs) for (const k of fieldKinds(i)) all.add(k);
  return [...all].sort();
}

/** True if any of the given kinds is high-sensitivity PII (drives the Redtape strong trigger). */
export function hasSensitivePii(kinds: string[]): boolean {
  return kinds.some((k) => SENSITIVE_PII_KINDS.has(k));
}

const INPUT_TAG_RE = /<input\b[^>]*>/gi;
const ATTR_RE = /([a-z][a-z-]*)\s*=\s*["']([^"']*)["']/gi;

/** Parse `<input>` tags out of an HTML string into attribute records (the fixture/regex path,
 *  order-independent — unlike a single `type="…"` capture). Feeds classifyFormFields. */
export function parseInputAttrs(html: string): FormInputAttrs[] {
  const out: FormInputAttrs[] = [];
  for (const tag of html.match(INPUT_TAG_RE) ?? []) {
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(ATTR_RE)) attrs[(m[1] ?? "").toLowerCase()] = m[2] ?? "";
    out.push({
      type: attrs.type || "text",
      autocomplete: attrs.autocomplete,
      name: attrs.name,
      id: attrs.id,
      placeholder: attrs.placeholder,
      accept: attrs.accept,
    });
  }
  return out;
}
