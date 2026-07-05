import type { ChangeLike } from "./entry.js";

/**
 * A plain-language, neutral description of a change: the "here's what was observed" headline the
 * homepage leads with instead of the detector's raw log line, plus a category-level "why it matters"
 * note. Both are DETERMINISTIC — the change is classified by (module, reason shape) and the salient
 * facts are dropped into a fixed template. Everything stays strictly observational: the headline
 * restates the observed fact, and the `why` explains the *class* of finding (never the specific
 * target, and never a verdict). Unrecognized shapes fall back to the detector's own wording, so a
 * card never renders worse than the raw reason.
 */
export interface FindingDescription {
  /** The plain-language lead — what was observed. */
  headline: string;
  /** Why this class of finding is worth a public record. May be empty for unclassified changes. */
  why: string;
}

type ChangeInput = Pick<
  ChangeLike,
  "module" | "domain" | "kind" | "field" | "old_value" | "new_value" | "reason"
>;

// ---- why-it-matters notes, keyed by finding type. Category-level and neutral by construction. ----
const WHY = {
  mimic: "A name that echoes another agency's site can blur who actually operates it.",
  label: "Preview and staging names surface in public certificate logs — often before anything launches.",
  collection: "Names like these point to data-collection or AI infrastructure worth tracking.",
  newSubdomain: "A subdomain becomes public the moment its certificate is logged.",
  foreignContact: "The security contact receives vulnerability reports; an address outside the agency is worth noting.",
  concentration: "One address covering many agencies concentrates who hears about their security issues.",
  newDomain: "Who owns a federal domain is a matter of public record; Daylight logs each new one.",
  watched: "This owner is on Daylight's watchlist, so new domains under it are surfaced.",
  registryRemoved: "A domain leaving the federal registry can signal a quiet handoff or retirement.",
  trackerRemoved: "A tracker that was present and then vanished leaves no public trace — unless someone kept the receipt.",
  trackerAdded: "New third-party tracking on a federal page is worth a public timestamp.",
  noticeRemoved: "A privacy notice that disappears changes what visitors are told.",
  fieldRemoved: "Form fields that come and go change what a site quietly collects.",
  sealRemoved: "An agency seal signals official provenance; its removal is a visible change.",
  redirect: "A federal page sending visitors off its own domain changes who actually serves them.",
  unlaunched: "Sites often appear on a vendor's infrastructure days before any public announcement.",
} as const;

const MODULE_WHY: Record<string, string> = {
  lookout: WHY.newSubdomain,
  receipts: "Daylight keeps a dated before/after of what quietly changed or vanished.",
  ledger: WHY.newDomain,
  foundry: WHY.unlaunched,
  floodlight: "Trackers, session replay, and analytics observed in a federal site's own live source.",
};

/** Hostname of a URL, tolerant of a bare host or a trailing slash. */
function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  }
}

/** "PostHog@us.i.posthog.com" -> "PostHog" (a tracker id is "<name>@<beacon-host>"). */
function trackerName(t: string): string {
  return t.split("@")[0]?.trim() || t.trim();
}

function short(v: string | null | undefined, max = 40): string {
  const s = (v ?? "").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function cap(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** Collapse any "https://host/path" occurrences in free text down to just "host" — keeps an
 *  unmapped/legacy reason from dumping raw URLs into a headline. */
function deUrl(s: string): string {
  return s.replace(/https?:\/\/([^/\s]+)\/?\S*/gi, "$1");
}

/** Drop a trailing " (Org name)" suffix a reason fragment may carry. */
function stripOwner(s: string): string {
  return s.replace(/\s*\([^()]*\)\s*$/, "").trim();
}

export function describeFinding(c: ChangeInput): FindingDescription {
  const reason = (c.reason ?? "").trim();
  const module = (c.module ?? "").toLowerCase();

  // ---- Lookout: reason is "new subdomain <fqdn> — <scoreReason>" (or "new subdomain of <apex>…").
  if (module === "lookout") {
    const apex = c.domain;
    const mSub = /^new subdomain\s+(\S+)\s+—\s+(.*)$/i.exec(reason);
    const score = (mSub?.[2] ?? reason.replace(/^new subdomain\s+/i, "")).trim();

    const mMimic = /^looks like\s+(\S+)\s+hosted under/i.exec(score);
    if (mMimic) {
      return { headline: `A subdomain of ${apex} is named to look like ${mMimic[1]}`, why: WHY.mimic };
    }
    const mInfra = /^collection\/inference infrastructure labels?\s+(.+?)\s+on\s/i.exec(score);
    if (mInfra) {
      return { headline: `A new data-collection subdomain (${stripOwner(mInfra[1]!)}) appeared on ${apex}`, why: WHY.collection };
    }
    const mLabel = /^(?:high-signal subdomain label|subdomain label)s?\s+(.+?)\s+on\s/i.exec(score);
    if (mLabel) {
      return { headline: `A new "${stripOwner(mLabel[1]!)}" subdomain appeared on ${apex}`, why: WHY.label };
    }
    if (mSub) return { headline: `A new subdomain, ${mSub[1]}, appeared on ${apex}`, why: WHY.newSubdomain };
    return { headline: `A new subdomain appeared on ${apex}`, why: WHY.newSubdomain };
  }

  // ---- Ledger: ownership + security-contact record.
  if (module === "ledger") {
    const mConc = /security contact @?(\S+) is foreign to\s+(\d+)\s+organizations/i.exec(reason);
    if (mConc) {
      return { headline: `One contact address (${mConc[1]}) is the security contact for ${mConc[2]} different agencies`, why: WHY.concentration };
    }
    const mForeign = /security contact (?:is\s+)?@?([^\s,]+),\s*foreign to\s+\S+/i.exec(reason);
    if (mForeign) {
      return { headline: `${c.domain}'s security contact is an address at ${mForeign[1]}, outside the agency`, why: WHY.foreignContact };
    }
    const mNew = /^new federal domain:\s+(\S+?)(?:\s*\(([^()]+)\))?$/i.exec(reason);
    if (mNew) {
      const org = mNew[2] && !/unknown/i.test(mNew[2]) ? mNew[2] : null;
      return { headline: org ? `${org} registered a new federal domain: ${mNew[1]}` : `A new federal domain was registered: ${mNew[1]}`, why: WHY.newDomain };
    }
    const mWatchNew = /^watched\s+\w+\s+"([^"]+)"\s+on new domain\s+(\S+)/i.exec(reason);
    if (mWatchNew) {
      return { headline: `A new domain, ${mWatchNew[2]}, is registered to ${mWatchNew[1]}`, why: WHY.watched };
    }
    const mBecame = /^(\S+)\s+changed into watched\s+(\w+)\s+"([^"]+)"/i.exec(reason);
    if (mBecame) {
      return { headline: `${mBecame[1]}'s ${mBecame[2]} is now "${mBecame[3]}", a watched entity`, why: WHY.watched };
    }
    if (/was removed from the federal registry/i.test(reason)) {
      return { headline: `${c.domain} was removed from the federal .gov registry`, why: WHY.registryRemoved };
    }
    if (c.kind === "modified" && c.field) {
      const delta = c.old_value != null && c.new_value != null ? ` from "${short(c.old_value)}" to "${short(c.new_value)}"` : "";
      return { headline: `${c.domain}'s ${c.field} changed${delta}`, why: WHY.newDomain };
    }
  }

  // ---- Receipts (removal ledger + off-domain redirects) and Floodlight (live-page trackers) share
  //      the same tracker/notice/seal/field vocabulary — "tracker removed from" (Receipts) vs
  //      "tracker removed on" (Floodlight) — so match both here regardless of which module logged it.
  if (module === "receipts" || module === "floodlight") {
    let m: RegExpExecArray | null;
    if ((m = /tracker (added|removed) (?:on|from|to)\s+(\S+):\s*(.+)$/i.exec(reason))) {
      const host = hostOf(m[2]!);
      const t = trackerName(m[3]!);
      return /removed/i.test(m[1]!)
        ? { headline: `${host} quietly removed a tracker (${t})`, why: WHY.trackerRemoved }
        : { headline: `${host} added a tracker (${t})`, why: WHY.trackerAdded };
    }
    if ((m = /privacy notice (removed from|added on|text changed on)\s+(\S+)/i.exec(reason))) {
      const host = hostOf(m[2]!);
      const verb = /removed/i.test(m[1]!)
        ? "removed its privacy notice"
        : /added/i.test(m[1]!)
          ? "added a privacy notice"
          : "changed its privacy-notice text";
      return { headline: `${host} ${verb}`, why: WHY.noticeRemoved };
    }
    if (/but has no linked privacy notice/i.test(reason)) {
      const collects = /collects pii/i.test(reason);
      return {
        headline: `${c.domain} ${collects ? "collects personal data" : "loads trackers"} but links no privacy notice`,
        why: WHY.noticeRemoved,
      };
    }
    if ((m = /form field (removed from|added on)\s+(\S+):\s*(.+)$/i.exec(reason))) {
      const verb = /removed/i.test(m[1]!) ? "removed" : "added";
      return { headline: `${hostOf(m[2]!)} ${verb} a form field (${short(m[3]!, 30)})`, why: WHY.fieldRemoved };
    }
    if ((m = /agency seal (removed from|added on)\s+(\S+)/i.exec(reason))) {
      const verb = /removed/i.test(m[1]!) ? "removed its agency seal" : "added an agency seal";
      return { headline: `${hostOf(m[2]!)} ${verb}`, why: WHY.sealRemoved };
    }
    if ((m = /high-risk scorecard for\s+(\S+):\s*(.+)$/i.exec(reason))) {
      return { headline: `${hostOf(m[1]!)} flagged high-risk on a live scan — ${short(m[2]!, 60)}`, why: MODULE_WHY.floodlight! };
    }
    if ((m = /^(\S+)\s+now redirects off-domain to\s+(\S+)/i.exec(reason))) {
      return { headline: `${hostOf(m[1]!)} now redirects visitors off its own domain to ${hostOf(m[2]!)}`, why: WHY.redirect };
    }
    if ((m = /^(\S+)\s+no longer redirects off-domain/i.exec(reason))) {
      return { headline: `${hostOf(m[1]!)} stopped redirecting off its own domain`, why: WHY.redirect };
    }
    if ((m = /^(\S+)\s+changed its redirect target/i.exec(reason))) {
      return { headline: `${hostOf(m[1]!)} changed where it redirects visitors`, why: WHY.redirect };
    }
  }

  // ---- Foundry: cross-agency vendor build-graph.
  if (module === "foundry") {
    const m = /unlaunched project\s+"([^"]+)"\s+building on\s+(\S+)/i.exec(reason);
    if (m) return { headline: `An unlaunched site, "${m[1]}", is being built on ${m[2]}`, why: WHY.unlaunched };
  }

  // ---- Fallback: the detector's own wording, de-jargoned. Strip the "new subdomain <fqdn> — "
  //      prefix, and collapse any raw "https://host/path" down to its host so an unmapped or legacy
  //      reason still reads as prose, never a URL dump.
  const mSubFallback = /^new subdomain\s+(\S+)\s+—\s+(.*)$/i.exec(reason);
  const headline = reason ? cap(deUrl(mSubFallback ? mSubFallback[2]!.trim() : reason)) : `${c.domain} changed`;
  return { headline, why: MODULE_WHY[module] ?? "" };
}
