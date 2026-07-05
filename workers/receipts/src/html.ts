import { classifyFormFields, parseInputAttrs, sha256 } from "@daylight/core";
import { classifyUrl, registrableDomain } from "@daylight/fingerprints";
import type { Snapshot } from "./types.js";

const URL_RE = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
const SEAL_RE = /<img\b[^>]*(?:alt|src)\s*=\s*["'][^"']*seal[^"']*["'][^>]*>/i;
const PRIVACY_LINK_RE = /<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([^<]*)<\/a>/gi;

function extractTrackers(html: string): string[] {
  const keys = new Set<string>();
  for (const m of html.matchAll(URL_RE)) {
    const raw = m[1] ?? "";
    if (!/^https?:\/\//i.test(raw)) continue; // relative URLs are same-origin, not trackers
    const fp = classifyUrl(raw);
    if (fp) {
      try {
        keys.add(`${fp.vendor}@${new URL(raw).host.toLowerCase()}`);
      } catch {
        /* skip */
      }
    }
  }
  return [...keys].sort();
}

function extractPrivacy(html: string): { hash: string | null; text: string | null } {
  for (const m of html.matchAll(PRIVACY_LINK_RE)) {
    const href = (m[1] ?? "").toLowerCase();
    const text = (m[2] ?? "").trim();
    if (href.includes("privacy") || /privacy/i.test(text)) {
      const notice = `${text} ${href}`.trim();
      return { hash: sha256(notice.toLowerCase()), text: notice };
    }
  }
  return { hash: null, text: null };
}

// Shared with Floodlight's live DOM capture so the fixture path and live path emit the SAME
// normalized PII kinds (type + autocomplete + name/id/placeholder patterns), not just input types.
function extractFormFields(html: string): string[] {
  return classifyFormFields(parseInputAttrs(html));
}

const safeHost = (url: string): string => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return url;
  }
};

/** Build a Snapshot from a page's URL + rendered HTML. (A live Playwright capture would
 *  provide the same facts + a screenshot; this keeps the diff engine fully fixture-tested.) */
export function snapshotFromHtml(url: string, html: string, capturedAt: string): Snapshot {
  const normalized = html.replace(/\s+/g, " ").trim();
  const privacy = extractPrivacy(html);
  return {
    url,
    domain: registrableDomain(safeHost(url)),
    capturedAt,
    domHash: sha256(normalized),
    trackers: extractTrackers(html),
    privacyTextHash: privacy.hash,
    privacyText: privacy.text,
    formFields: extractFormFields(html),
    sealPresent: SEAL_RE.test(html),
    redirectTarget: null, // fixture HTML has no navigation; the live capture sets this
    screenshotRef: null,
    waybackUrl: null,
  };
}

/** Stable content hash over the diff-relevant fields (idempotency key; excludes timestamp). */
export function snapshotContentHash(s: Snapshot): string {
  return sha256(
    JSON.stringify([
      s.url,
      s.domHash,
      [...s.trackers].sort(),
      s.privacyTextHash,
      [...s.formFields].sort(),
      s.sealPresent,
      s.redirectTarget, // a changed redirect target must not short-circuit as "unchanged"
    ]),
  );
}
