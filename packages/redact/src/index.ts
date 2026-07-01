// Ingest-time PII redaction pass. It guards the raw artifact store before anything
// from a scanned page is persisted in a servable field (PRD §5).
//
// Phase 0-1 note: Ledger reads *official public registrant records* (which name agency
// contacts by design), so redaction is a deliberate PASS-THROUGH here — but the seam
// stays wired so Phase 3 (Floodlight) can drop in real page-text redaction without
// touching callers.

export interface RedactionResult<T> {
  value: T;
  redacted: boolean;
  /** Flagged for human review + withheld from the public read-path (Phase 3+). */
  flagged: boolean;
  notes: string[];
}

/** Pass-through for already-public official data. Later phases replace the body. */
export function redact<T>(value: T): RedactionResult<T> {
  return { value, redacted: false, flagged: false, notes: [] };
}

/** Convenience for text fields; identity for now. */
export function redactText(text: string): RedactionResult<string> {
  return redact(text);
}
