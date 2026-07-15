import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb, type DaylightDb } from "@daylight/db";
import type { LiveCapture } from "@daylight/floodlight/capture";
import { beforeEach, describe, expect, it } from "vitest";
import {
  captureStatus,
  type CdxOptions,
  diffSnapshots,
  isDefinitelyNotPageCapture,
  isPageCapture,
  isTimestampedArchiveUrl,
  runReceiptsSnapshot,
  saveToWayback,
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

// ---- Archive provenance regressions -------------------------------------------------
// All three trace to one prod incident: 21 of 203 archive links were un-timestamped "latest"
// pointers, 176 rows were null, and 10 pages showed "—" despite having a real archive on file.

describe("archive retry — a failed save is retried on the next sweep, not left forever", () => {
  it("an unchanged re-capture retries a missing archive and backfills the existing row", async () => {
    const snap = snapshotFromHtml(URL_, read("before.html"), T0);
    // First save fails (SPN2 slot exhaustion in prod) → row lands with no archive.
    const r1 = await runReceiptsSnapshot({ db, snapshot: snap, waybackSave: async () => null });
    expect(r1.waybackUrl).toBeNull();
    expect(r1.archiveAttempted).toBe(true);
    expect(db.listSnapshots(URL_)[0]?.wayback_url).toBeNull();

    // Same content next sweep: short-circuits, but MUST still retry the archive.
    const again = snapshotFromHtml(URL_, read("before.html"), T1);
    const r2 = await runReceiptsSnapshot({ db, snapshot: again, waybackSave: mockWayback });
    expect(r2.shortCircuited).toBe(true);
    expect(r2.archiveAttempted).toBe(true);
    expect(r2.waybackUrl).toContain("web.archive.org");
    expect(db.listSnapshots(URL_)).toHaveLength(1); // still no duplicate row
    expect(db.listSnapshots(URL_)[0]?.wayback_url).toContain("web.archive.org");
  });

  it("does not re-archive a page that already has one (no attempt, no false failure)", async () => {
    const snap = snapshotFromHtml(URL_, read("before.html"), T0);
    await runReceiptsSnapshot({ db, snapshot: snap, waybackSave: mockWayback });
    const again = snapshotFromHtml(URL_, read("before.html"), T1);
    let calls = 0;
    const r = await runReceiptsSnapshot({
      db,
      snapshot: again,
      waybackSave: async (u) => {
        calls++;
        return mockWayback(u);
      },
    });
    expect(r.shortCircuited).toBe(true);
    expect(r.archiveAttempted).toBe(false);
    expect(calls).toBe(0);
  });
});

describe("coverage view — an archive on an older snapshot is carried forward, with its own date", () => {
  it("surfaces the last archive on file when the newest capture's save failed", async () => {
    const before = snapshotFromHtml(URL_, read("before.html"), T0);
    const after = snapshotFromHtml(URL_, read("after.html"), T1);
    await runReceiptsSnapshot({ db, snapshot: before, waybackSave: mockWayback }); // archived
    await runReceiptsSnapshot({ db, snapshot: after, waybackSave: async () => null }); // save failed

    const rows = db.coverageSnapshots();
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    // The row shown is the NEWEST capture, which genuinely has no archive of its own…
    expect(row.captured_at).toBe(T1);
    expect(row.wayback_url).toBeNull();
    // …but we still hold one from T0, and it is dated to T0 — never implied to cover T1.
    expect(row.archive_url).toContain("web.archive.org");
    expect(row.archive_captured_at).toBe(T0);
  });

  it("reports no archive when the page has never been archived", async () => {
    const snap = snapshotFromHtml(URL_, read("before.html"), T0);
    await runReceiptsSnapshot({ db, snapshot: snap, waybackSave: async () => null });
    const row = db.coverageSnapshots()[0]!;
    expect(row.archive_url).toBeNull();
    expect(row.archive_captured_at).toBeNull();
  });
});

describe("isTimestampedArchiveUrl — only a pinned capture counts as a receipt", () => {
  it("accepts a timestamp-pinned capture and rejects a bare 'latest' pointer", () => {
    expect(isTimestampedArchiveUrl("https://web.archive.org/web/20260702181455/https://trumpaccounts.gov/")).toBe(true);
    // This is what the old 90s-timeout fallback wrote. It resolves to whatever IA has captured
    // most recently, so it would show the page's CURRENT state — the opposite of a receipt.
    expect(isTimestampedArchiveUrl("https://web.archive.org/web/https://cdc.gov/")).toBe(false);
    expect(isTimestampedArchiveUrl("https://example.com/web/20260702181455/x")).toBe(false);
  });
});

describe("saveToWayback — never fabricates an archive URL", () => {
  // Fast poll intervals: the seam exists so CI never sleeps on real SPN2 cadence.
  const keys = { accessKey: "k", secret: "s", pollIntervalMs: 1, slotPollIntervalMs: 1 };

  it("returns null (with a reason) when the capture never confirms, instead of a 'latest' pointer", async () => {
    const reasons: string[] = [];
    const fetchImpl = async (url: string): Promise<Response> => {
      if (url.includes("/status/user")) return json({ available: 3 });
      if (url === "https://web.archive.org/save") return json({ job_id: "j1" });
      return json({ status: "pending" }); // never resolves
    };
    const out = await saveToWayback("https://cdc.gov/", {
      ...keys,
      fetchImpl,
      maxWaitMs: 10,
      onFailure: (_u, r) => reasons.push(r),
    });
    expect(out).toBeNull();
    expect(reasons[0]).toContain("pending");
  });

  it("surfaces the SPN2 error instead of swallowing it", async () => {
    const reasons: string[] = [];
    const fetchImpl = async (url: string): Promise<Response> => {
      if (url.includes("/status/user")) return json({ available: 3 });
      return json({ status: "error", status_ext: "error:user-session-limit" });
    };
    const out = await saveToWayback("https://va.gov/", {
      ...keys,
      fetchImpl,
      onFailure: (_u, r) => reasons.push(r),
    });
    expect(out).toBeNull();
    expect(reasons).toEqual(["error:user-session-limit"]);
  });

  it("waits for a free session slot rather than burning the attempt", async () => {
    let slotChecks = 0;
    const fetchImpl = async (url: string): Promise<Response> => {
      if (url.includes("/status/user")) return json({ available: slotChecks++ === 0 ? 0 : 1 });
      if (url === "https://web.archive.org/save") return json({ job_id: "j1" });
      return json({ status: "success", timestamp: "20260713043508", original_url: "https://va.gov/" });
    };
    const out = await saveToWayback("https://va.gov/", { ...keys, fetchImpl, maxSlotWaitMs: 30_000 });
    expect(slotChecks).toBeGreaterThan(1); // it re-checked rather than giving up on the first busy read
    expect(out).toBe("https://web.archive.org/web/20260713043508/https://va.gov/");
  });

  it("rejects a capture of a block page (SPN2 'success' with a non-200 origin status)", async () => {
    // Real case: our stored archive for trumpaccounts.gov (20260702181455) is a capture of a
    // 403 — the origin's bot protection refused IA's crawler. Archiving the refusal and citing
    // it as evidence is worse than reporting no archive.
    const reasons: string[] = [];
    const fetchImpl = async (url: string): Promise<Response> => {
      if (url.includes("/status/user")) return json({ available: 3 });
      if (url === "https://web.archive.org/save") return json({ job_id: "j1" });
      return json({
        status: "success",
        timestamp: "20260702181455",
        original_url: "https://trumpaccounts.gov/",
        http_status: 403,
      });
    };
    const out = await saveToWayback("https://trumpaccounts.gov/", {
      ...keys,
      fetchImpl,
      onFailure: (_u, r) => reasons.push(r),
    });
    expect(out).toBeNull();
    expect(reasons[0]).toContain("403");
  });

  it("returns a pinned URL on success", async () => {
    const fetchImpl = async (url: string): Promise<Response> => {
      if (url.includes("/status/user")) return json({ available: 3 });
      if (url === "https://web.archive.org/save") return json({ job_id: "j1" });
      return json({ status: "success", timestamp: "20260702181455", original_url: "https://trumpaccounts.gov/" });
    };
    const out = await saveToWayback("https://trumpaccounts.gov/", { ...keys, fetchImpl });
    expect(out).not.toBeNull();
    expect(isTimestampedArchiveUrl(out!)).toBe(true);
  });
});

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("cdx — is a stored archive actually a capture of the page?", () => {
  const cdx = (body: unknown, status = 200): CdxOptions => ({
    fetchImpl: async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  });

  it("reports the captured status when the index has that exact capture", async () => {
    // The real trumpaccounts.gov case: the pinned capture is of a 403 block page.
    const s = await captureStatus("https://trumpaccounts.gov/", "20260702181455", cdx([
      ["timestamp", "statuscode"],
      ["20260702181455", "403"],
    ]));
    expect(s).toEqual({ known: true, statusCode: "403" });
    expect(isDefinitelyNotPageCapture(s)).toBe(true);
    expect(isPageCapture(s)).toBe(false);
  });

  it("recognises a real capture of the page", async () => {
    const s = await captureStatus("https://sec.gov/", "20260713043028", cdx([
      ["timestamp", "statuscode"],
      ["20260713043028", "200"],
    ]));
    expect(isPageCapture(s)).toBe(true);
    expect(isDefinitelyNotPageCapture(s)).toBe(false);
  });

  // The next four are the "never act without positive evidence" rule. A redirecting host
  // (cdc.gov → www.cdc.gov) indexes under the redirect target, so an empty CDX answer is NOT
  // evidence the archive is bad — clearing on it would destroy good links.
  it("an empty index answer is unknown, never 'bad'", async () => {
    const s = await captureStatus("https://cdc.gov/", "20260709041058", cdx(""));
    expect(s.known).toBe(false);
    expect(isDefinitelyNotPageCapture(s)).toBe(false);
  });

  it("a network failure is unknown, never 'bad'", async () => {
    const s = await captureStatus("https://va.gov/", "20260706040605", {
      fetchImpl: async () => {
        throw new Error("fetch failed");
      },
    });
    expect(s).toEqual({ known: false, reason: "fetch failed" });
    expect(isDefinitelyNotPageCapture(s)).toBe(false);
  });

  it("a CDX error response is unknown, never 'bad'", async () => {
    const s = await captureStatus("https://va.gov/", "20260706040605", cdx("", 429));
    expect(s.known).toBe(false);
    expect(isDefinitelyNotPageCapture(s)).toBe(false);
  });

  it("a revisit record ('-') is a real capture, not a block page", async () => {
    // IA writes "-" when a capture is byte-identical to a previous one. That is the page.
    const s = await captureStatus("https://trumpaccounts.gov/", "20260602013316", cdx([
      ["timestamp", "statuscode"],
      ["20260602013316", "-"],
    ]));
    expect(isDefinitelyNotPageCapture(s)).toBe(false);
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
