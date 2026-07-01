// Ingest-time PII redaction. It guards the raw/servable store before anything derived
// from a scanned page is persisted (PRD §5).
//
// Two entry points, by design:
//  - redact<T>(value): structured PASS-THROUGH for already-public official records
//    (Ledger's CISA registrant data — names agency contacts by design; we don't mangle it).
//  - redactText(text): REAL scrubbing for free text captured from a scanned page (Phase 3),
//    which may reflect PII from a URL query param or form value.

export interface RedactionResult<T> {
  value: T;
  redacted: boolean;
  /** Flagged for human review + withheld from the public read-path. */
  flagged: boolean;
  notes: string[];
}

/** Pass-through for already-public official data. */
export function redact<T>(value: T): RedactionResult<T> {
  return { value, redacted: false, flagged: false, notes: [] };
}

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "email", re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi },
  { name: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    name: "phone",
    re: /(?<!\d)(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}(?!\d)/g,
  },
];

/** Scrub emails / SSNs / phone numbers from free text captured off a page. */
export function redactText(text: string): RedactionResult<string> {
  let value = text;
  const notes: string[] = [];
  for (const { name, re } of PATTERNS) {
    if (re.test(value)) {
      notes.push(name);
      value = value.replace(re, `[redacted:${name}]`);
    }
    re.lastIndex = 0;
  }
  return { value, redacted: notes.length > 0, flagged: notes.length > 0, notes };
}
