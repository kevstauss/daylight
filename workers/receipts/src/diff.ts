import type { Change } from "@daylight/core";
import type { Snapshot } from "./types.js";

/**
 * Diff two snapshots into change events (spec §4.4). Removals of a tracker, privacy clause,
 * or agency seal are the flagship signal → severity 'high', driving the removal ledger.
 * Turns "we took it down" into a dated `removed` event with before/after.
 */
export function diffSnapshots(prev: Snapshot, curr: Snapshot, now: string): Change[] {
  const changes: Change[] = [];
  const emit = (
    kind: Change["kind"],
    field: string,
    oldValue: string | null,
    newValue: string | null,
    severity: Change["severity"],
    reason: string,
  ) => changes.push({ module: "receipts", domain: curr.domain, detectedAt: now, kind, field, oldValue, newValue, severity, reason });

  // Trackers.
  const prevT = new Set(prev.trackers);
  const currT = new Set(curr.trackers);
  for (const t of prev.trackers) {
    if (!currT.has(t)) emit("removed", "tracker", t, null, "high", `tracker removed from ${curr.url}: ${t}`);
  }
  for (const t of curr.trackers) {
    if (!prevT.has(t)) emit("added", "tracker", null, t, "notable", `tracker added on ${curr.url}: ${t}`);
  }

  // Privacy notice.
  if (prev.privacyTextHash && !curr.privacyTextHash) {
    emit("removed", "privacy_notice", prev.privacyTextHash, null, "high", `privacy notice removed from ${curr.url}`);
  } else if (!prev.privacyTextHash && curr.privacyTextHash) {
    emit("added", "privacy_notice", null, curr.privacyTextHash, "info", `privacy notice added on ${curr.url}`);
  } else if (prev.privacyTextHash && curr.privacyTextHash && prev.privacyTextHash !== curr.privacyTextHash) {
    emit("modified", "privacy_notice", prev.privacyTextHash, curr.privacyTextHash, "notable", `privacy notice text changed on ${curr.url}`);
  }

  // Form fields.
  const prevF = new Set(prev.formFields);
  const currF = new Set(curr.formFields);
  for (const f of prev.formFields) {
    if (!currF.has(f)) emit("removed", "form_field", f, null, "notable", `form field removed from ${curr.url}: ${f}`);
  }
  for (const f of curr.formFields) {
    if (!prevF.has(f)) emit("added", "form_field", null, f, "notable", `form field added on ${curr.url}: ${f}`);
  }

  // Agency seal.
  if (prev.sealPresent && !curr.sealPresent) {
    emit("removed", "seal", "present", null, "high", `agency seal removed from ${curr.url}`);
  } else if (!prev.sealPresent && curr.sealPresent) {
    emit("added", "seal", null, "present", "notable", `agency seal added on ${curr.url}`);
  }

  return changes;
}
