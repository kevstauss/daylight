import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb, type DaylightDb } from "@daylight/db";
import type { LiveCapture } from "@daylight/floodlight/capture";
import { beforeEach, describe, expect, it } from "vitest";
import {
  diffSnapshots,
  runReceiptsSnapshot,
  snapshotFromHtml,
  snapshotFromLiveCapture,
} from "./index.js";
import type { Snapshot } from "./types.js";

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), "utf8");

const T0 = "2026-06-01T00:00:00.000Z";
const T1 = "2026-06-02T00:00:00.000Z";
const URL_ = "https://passports.gov/apply";

/** A Wayback saver mock — §7.5: never hit the live API in CI. */
const mockWayback = async (url: string): Promise<string> =>
  `https://web.archive.org/web/20260602000000/${url}`;

let db: DaylightDb;
beforeEach(() => {
  db = createDb(":memory:");
});

describe("§7.1 diff — removals of tracker, privacy clause, seal → 3 removed changes (2 high, tracker notable)", () => {
  it("before → after yields exactly three `removed` changes with before/after", () => {
    const before = snapshotFromHtml(URL_, read("before.html"), T0);
    const after = snapshotFromHtml(URL_, read("after.html"), T1);

    // sanity: the fixtures actually differ in the three tracked dimensions
    expect(before.trackers.length).toBe(1);
    expect(after.trackers.length).toBe(0);
    expect(before.privacyTextHash).not.toBeNull();
    expect(after.privacyTextHash).toBeNull();
    expect(before.sealPresent).toBe(true);
    expect(after.sealPresent).toBe(false);
    expect(before.formFields).toEqual(after.formFields); // email kept — not a change

    const changes = diffSnapshots(before, after, T1);
    const removed = changes.filter((c) => c.kind === "removed");
    expect(removed).toHaveLength(3);
    expect(removed.map((c) => c.field).sort()).toEqual(["privacy_notice", "seal", "tracker"]);
    // Losing a privacy notice / agency seal is a data-supported regression → high…
    const bySeverity = (s: string) => removed.filter((c) => c.severity === s).map((c) => c.field).sort();
    expect(bySeverity("high")).toEqual(["privacy_notice", "seal"]);
    // …but a tracker vanishing is neutral-to-good on the data alone → notable, matching a tracker add.
    expect(bySeverity("notable")).toEqual(["tracker"]);
    const tracker = removed.find((c) => c.field === "tracker");
    expect(tracker?.oldValue).toContain("Google Analytics");
    expect(tracker?.newValue).toBeNull();
  });
});

describe("§7.2 + §7.5 removal ledger + mocked Wayback", () => {
  it("removals land in the ledger, each snapshot carries a (mocked) Wayback URL", async () => {
    const before = snapshotFromHtml(URL_, read("before.html"), T0);
    const after = snapshotFromHtml(URL_, read("after.html"), T1);
    await runReceiptsSnapshot({ db, snapshot: before, waybackSave: mockWayback });
    const r2 = await runReceiptsSnapshot({ db, snapshot: after, waybackSave: mockWayback });

    expect(r2.removed).toHaveLength(3);
    expect(r2.waybackUrl).toContain("web.archive.org");
    const ledger = db.removalLedger();
    expect(ledger).toHaveLength(3);
    // privacy_notice + seal removals are high; the tracker removal is notable (see §7.1).
    expect(ledger.filter((c) => c.severity === "high").map((c) => c.field).sort()).toEqual(["privacy_notice", "seal"]);
    expect(ledger.filter((c) => c.severity === "notable").map((c) => c.field)).toEqual(["tracker"]);
    // each snapshot row stored its Wayback archive URL
    const snaps = db.listSnapshots(URL_);
    expect(snaps).toHaveLength(2);
    expect(snaps.every((s) => (s.wayback_url ?? "").includes("web.archive.org"))).toBe(true);
  });
});

describe("§7.3 idempotency — an unchanged re-capture emits zero changes", () => {
  it("re-snapshotting identical content is a no-op (idempotent by content hash)", async () => {
    const snap = snapshotFromHtml(URL_, read("before.html"), T0);
    await runReceiptsSnapshot({ db, snapshot: snap, waybackSave: mockWayback });
    const again = snapshotFromHtml(URL_, read("before.html"), T1); // same content, later time
    const r = await runReceiptsSnapshot({ db, snapshot: again, waybackSave: mockWayback });
    expect(r.shortCircuited).toBe(true);
    expect(r.changeIds).toHaveLength(0);
    expect(db.listSnapshots(URL_)).toHaveLength(1); // no duplicate snapshot row
  });
});

describe("snapshotFromLiveCapture — maps a live capture to a Snapshot", () => {
  it("takes trackers from network analysis + DOM facts, keeping the screenshot in the raw store", () => {
    const live: LiveCapture = {
      capture: {
        url: "https://ndstudio.gov/",
        requests: [
          { url: "https://www.google-analytics.com/g/collect", method: "GET", resourceType: "image" },
          {
            url: "https://ndstudio.gov/metrics",
            method: "POST",
            resourceType: "fetch",
            postBody: JSON.stringify({ event: "x", properties: {}, distinct_id: "u", api_key: "k" }),
          },
        ],
        dom: { privacyNoticeUrl: "https://ndstudio.gov/privacy", hasSeal: true, formFields: ["email"] },
      },
      html: "<html><body>ok</body></html>",
      screenshotPng: null,
      gated: false,
      finalUrl: "https://ndstudio.gov/",
    };
    const snap = snapshotFromLiveCapture("https://ndstudio.gov/", live, T0, "/raw/x.png");
    expect(snap.domain).toBe("ndstudio.gov");
    expect(snap.trackers.some((t) => t.includes("Google Analytics"))).toBe(true);
    expect(snap.trackers.some((t) => t.includes("first-party-proxied"))).toBe(true);
    expect(snap.privacyTextHash).not.toBeNull();
    expect(snap.sealPresent).toBe(true);
    expect(snap.formFields).toEqual(["email"]);
    expect(snap.screenshotRef).toBe("/raw/x.png");
  });
});

describe("§7.4 redact runs on captured text before persistence", () => {
  it("PII in captured privacy text is scrubbed in the stored observation; screenshot_ref stays raw-store only", async () => {
    const snap: Snapshot = {
      url: URL_,
      domain: "passports.gov",
      capturedAt: T0,
      domHash: "abc",
      trackers: [],
      privacyTextHash: "h",
      privacyText: "Questions? email privacy-officer@passports.gov or call 202-555-0142",
      formFields: ["email"],
      sealPresent: true,
      redirectTarget: null,
      screenshotRef: "/raw/passports-apply-T0.png",
      waybackUrl: null,
    };
    await runReceiptsSnapshot({ db, snapshot: snap });
    const obs = db.latestObservation("receipts", "passports.gov");
    expect(obs).not.toBeNull();
    expect(obs!.payload_json).not.toContain("privacy-officer@passports.gov");
    expect(obs!.payload_json).not.toContain("202-555-0142");
    expect(obs!.payload_json).toContain("[redacted:email]");
    // the raw screenshot ref is retained in the raw store (snapshot row) but is never
    // exposed by a public feed/route — Receipts' UI gates it behind human review.
    const snapRow = db.latestSnapshot(URL_);
    expect(snapRow?.screenshot_ref).toBe("/raw/passports-apply-T0.png");
  });
});

describe("redirect tracking — an off-domain redirect emits a dated change", () => {
  it("added / changed / removed redirect targets each emit the right change", () => {
    const base = snapshotFromHtml(URL_, read("before.html"), T0);
    const none = { ...base, redirectTarget: null };
    const toAuth = { ...base, redirectTarget: "https://auth.passports.gov/" };
    const toState = { ...base, redirectTarget: "https://travel.state.gov/en/passports.html" };

    // served content → now redirects off-domain (high)
    const added = diffSnapshots(none, toAuth, T1).filter((c) => c.field === "redirect_target");
    expect(added).toHaveLength(1);
    expect(added[0]?.kind).toBe("added");
    expect(added[0]?.severity).toBe("high");

    // target changed (auth wall → State Dept) — only the redirect change fires (rest is identical)
    const modified = diffSnapshots(toAuth, toState, T1).filter((c) => c.field === "redirect_target");
    expect(modified).toHaveLength(1);
    expect(modified[0]?.kind).toBe("modified");
    expect(modified[0]?.newValue).toContain("travel.state.gov");

    // stopped redirecting
    const removed = diffSnapshots(toState, none, T1).filter((c) => c.field === "redirect_target");
    expect(removed[0]?.kind).toBe("removed");

    // same target → nothing for redirect_target (and the content hash includes it, so no false skip)
    expect(diffSnapshots(toAuth, toAuth, T1).some((c) => c.field === "redirect_target")).toBe(false);
  });
});
