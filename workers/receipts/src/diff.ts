import type { Change } from "@daylight/core";
import { redactText } from "@daylight/redact";
import type { Snapshot } from "./types.js";

/**
 * Diff two snapshots into change events (spec §4.4). The removal ledger turns "we took it down"
 * into a dated `removed` event with before/after — that dated record is the value, standing on the
 * data alone.
 *
 * Severity grades only what the data itself shows, never an inferred motive. A **tracker** removal
 * is 'notable', not 'high': on its own it means the page became *less* invasive, and reading it as
 * alarming ("they got caught and scrubbed it") needs context outside the data — so it matches a
 * tracker *addition* (also 'notable') rather than out-ranking it. Losing a **privacy notice** or an
 * **agency seal**, by contrast, is a data-supported regression in disclosure/provenance → 'high'.
 */
export function diffSnapshots(prev: Snapshot, curr: Snapshot, now: string): Change[] {
  const changes: Change[] = [];
  // The scanned URL can carry PII in its query string; reasons are public, so redact it.
  const url = redactText(curr.url).value;

  /**
   * Absence only counts when BOTH captures actually finished loading.
   *
   * A capture that timed out waiting for the page to go quiet has a partial request log, so the
   * trackers it "didn't see" may simply not have fired yet. Comparing a partial capture against a
   * complete one manufactures a change in whichever direction the incompleteness fell: a removal
   * if the newer one is partial, an addition if the older one was. healthcare.gov's count read
   * 3, 1, 3, 3, 3, 12, 3 across seven captures and published twelve dated "tracker removed"
   * findings; nothing was ever removed.
   *
   * PRESENCE is different: seeing a tracker proves it is there, whatever else the page was doing.
   * So a partial capture can still confirm what it saw — it just cannot testify to what it
   * missed. Everything below that turns on something being GONE is gated on this.
   */
  const absenceIsMeaningful = prev.settled && curr.settled;
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
  if (absenceIsMeaningful) {
    for (const t of prev.trackers) {
      // Notable, not high: a tracker vanishing is neutral-to-good on the data alone (see header).
      if (!currT.has(t)) emit("removed", "tracker", t, null, "notable", `tracker removed from ${url}: ${t}`);
    }
    // "Added" rests on the PREVIOUS capture's absence, which is only trustworthy if it settled —
    // otherwise we are reporting what we missed last time as something the site just did.
    for (const t of curr.trackers) {
      if (!prevT.has(t)) emit("added", "tracker", null, t, "notable", `tracker added on ${url}: ${t}`);
    }
  }

  // Privacy notice.
  if (prev.privacyTextHash && !curr.privacyTextHash) {
    // The highest-severity claim Receipts makes about a page, so it needs the strongest evidence:
    // a notice "missing" from a half-rendered page is the footer not having arrived yet.
    if (absenceIsMeaningful) {
      emit("removed", "privacy_notice", prev.privacyTextHash, null, "high", `privacy notice removed from ${url}`);
    }
  } else if (!prev.privacyTextHash && curr.privacyTextHash) {
    if (absenceIsMeaningful) emit("added", "privacy_notice", null, curr.privacyTextHash, "info", `privacy notice added on ${url}`);
  } else if (prev.privacyTextHash && curr.privacyTextHash && prev.privacyTextHash !== curr.privacyTextHash) {
    emit("modified", "privacy_notice", prev.privacyTextHash, curr.privacyTextHash, "notable", `privacy notice text changed on ${url}`);
  }

  // Form fields.
  const prevF = new Set(prev.formFields);
  const currF = new Set(curr.formFields);
  if (absenceIsMeaningful) {
    for (const f of prev.formFields) {
      if (!currF.has(f)) emit("removed", "form_field", f, null, "notable", `form field removed from ${url}: ${f}`);
    }
    for (const f of curr.formFields) {
      if (!prevF.has(f)) emit("added", "form_field", null, f, "notable", `form field added on ${url}: ${f}`);
    }
  }

  // Agency seal.
  if (prev.sealPresent && !curr.sealPresent) {
    if (absenceIsMeaningful) emit("removed", "seal", "present", null, "high", `agency seal removed from ${url}`);
  } else if (!prev.sealPresent && curr.sealPresent) {
    if (absenceIsMeaningful) emit("added", "seal", null, "present", "notable", `agency seal added on ${url}`);
  }

  // Off-domain redirect. A watched .gov that starts forwarding elsewhere — or changes where it
  // forwards to (e.g. an auth wall -> another agency) — is a notable, re-verifiable event. Targets
  // are redirect destinations (not user input), but redact for symmetry with the scanned URL.
  const prt = prev.redirectTarget ? redactText(prev.redirectTarget).value : null;
  const crt = curr.redirectTarget ? redactText(curr.redirectTarget).value : null;
  if (!prt && crt) {
    emit("added", "redirect_target", null, crt, "high", `${url} now redirects off-domain to ${crt}`);
  } else if (prt && !crt) {
    emit("removed", "redirect_target", prt, null, "notable", `${url} no longer redirects off-domain (was ${prt})`);
  } else if (prt && crt && prt !== crt) {
    emit("modified", "redirect_target", prt, crt, "high", `${url} changed its redirect target from ${prt} to ${crt}`);
  }

  return changes;
}
