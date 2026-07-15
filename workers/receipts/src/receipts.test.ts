import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb, type DaylightDb } from "@daylight/db";
import type { LiveCapture } from "@daylight/floodlight/capture";
import { beforeEach, describe, expect, it } from "vitest";
import {
  archiveDriftMinutes,
  archiveTimestamp,
} from "@daylight/core";
import {
  captureStatus,
  type CdxOptions,
  checkArchiverPolicy,
  recordArchiverRefusal,
  declaredBlocks,
  describeDeclaredBlock,
  describeObservedRefusal,
  originRefusedArchiver,
  diffSnapshots,
  findCaptureNear,
  makeArchiver,
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

describe("declaredBlocks — only report what a site actually declares", () => {
  it("reports a site-wide Disallow aimed at the Internet Archive, quoting it verbatim", () => {
    const b = declaredBlocks(["User-agent: ia_archiver", "Disallow: /"].join("\n"));
    expect(b).toHaveLength(1);
    expect(b[0]!.party).toBe("internet-archive");
    expect(b[0]!.directive).toBe("User-agent: ia_archiver / Disallow: /");
    const copy = describeDeclaredBlock(b[0]!, "example.gov", "2026-07-15T00:00:00.000Z");
    expect(copy).toContain("as of 2026-07-15");
    expect(copy).toContain("the site's own published crawl policy");
    // Neutral: states the directive, never a motive.
    expect(copy.toLowerCase()).not.toMatch(/hiding|cover|evade|illegal|violat/);
  });

  it("reports a block aimed at Daylight itself", () => {
    const b = declaredBlocks(["User-agent: DaylightBot", "Disallow: /"].join("\n"));
    expect(b.map((x) => x.party)).toEqual(["daylight"]);
  });

  it("groups consecutive User-agent lines under one rule block", () => {
    const b = declaredBlocks(["User-agent: ia_archiver", "User-agent: DaylightBot", "Disallow: /"].join("\n"));
    expect(b.map((x) => x.party).sort()).toEqual(["daylight", "internet-archive"]);
  });

  // ---- Everything below must report NOTHING. Each is a real pattern from the watched set. ----

  it("a wildcard block is not a decision about archiving", () => {
    // Blanket crawl policy. Reading "they block the Archive" into this would be an overclaim.
    expect(declaredBlocks(["User-agent: *", "Disallow: /"].join("\n"))).toEqual([]);
  });

  it("an empty Disallow ALLOWS everything — the opposite of a block", () => {
    expect(declaredBlocks(["User-agent: ia_archiver", "Disallow:"].join("\n"))).toEqual([]);
  });

  it("a path-scoped rule is housekeeping, not a refusal to be preserved", () => {
    expect(declaredBlocks(["User-agent: ia_archiver", "Disallow: /search"].join("\n"))).toEqual([]);
  });

  it("blocking AI crawlers is not blocking the archive (real techprosperitycorps.gov robots.txt)", () => {
    const real = [
      "# content signals",
      "User-agent: *",
      "Content-Signal: search=yes,ai-train=no,use=reference",
      "Allow: /",
      "User-agent: ClaudeBot",
      "Disallow: /",
      "User-agent: CCBot",
      "Disallow: /",
      "User-agent: Bytespider",
      "Disallow: /",
    ].join("\n");
    expect(declaredBlocks(real)).toEqual([]);
  });

  it("an Allow-everything archiver group is not a block", () => {
    expect(declaredBlocks(["User-agent: ia_archiver", "Allow: /"].join("\n"))).toEqual([]);
  });

  it("comments mentioning the archive are not directives", () => {
    expect(declaredBlocks(["# we love ia_archiver Disallow: /", "User-agent: *", "Allow: /"].join("\n"))).toEqual([]);
  });

  it("an empty or junk robots.txt declares nothing", () => {
    expect(declaredBlocks("")).toEqual([]);
    expect(declaredBlocks("<!DOCTYPE html><html>404</html>")).toEqual([]);
  });
});

describe("checkArchiverPolicy — report a declared block once, on the transition", () => {
  const HOST = "example.gov";
  /** checkArchiverPolicy fetches through the guards' fetchRobotsTxt, so drive it via global fetch. */
  const withRobots = async (body: string | null, status = 200, fn: () => Promise<void>): Promise<void> => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () =>
      body === null ? new Response("", { status: 404 }) : new Response(body, { status })) as typeof fetch;
    try {
      await fn();
    } finally {
      globalThis.fetch = real;
    }
  };

  it("emits one high-severity change when a site declares a block on the Internet Archive", async () => {
    await withRobots(["User-agent: ia_archiver", "Disallow: /"].join("\n"), 200, async () => {
      const r = await checkArchiverPolicy(db, HOST, { now: T0, allowPrivate: true });
      expect(r.blocks).toHaveLength(1);
      expect(r.changeIds).toHaveLength(1);
      const c = db.listChanges({ module: "receipts" })[0]!;
      expect(c.field).toBe("archiver_disallowed");
      expect(c.severity).toBe("high");
      expect(c.kind).toBe("added");
      expect(c.source_url).toContain("/robots.txt"); // one-click checkable
      expect(c.reason).toContain("Disallow: /");
    });
  });

  it("does not re-emit a standing directive on every sweep", async () => {
    const body = ["User-agent: ia_archiver", "Disallow: /"].join("\n");
    await withRobots(body, 200, async () => {
      await checkArchiverPolicy(db, HOST, { now: T0, allowPrivate: true });
      const second = await checkArchiverPolicy(db, HOST, { now: T1, allowPrivate: true });
      expect(second.changeIds).toHaveLength(0);
      expect(db.listChanges({ module: "receipts" })).toHaveLength(1);
    });
  });

  it("records a block being lifted too — the ledger runs both directions", async () => {
    await withRobots(["User-agent: ia_archiver", "Disallow: /"].join("\n"), 200, async () => {
      await checkArchiverPolicy(db, HOST, { now: T0, allowPrivate: true });
    });
    await withRobots(["User-agent: *", "Allow: /"].join("\n"), 200, async () => {
      const r = await checkArchiverPolicy(db, HOST, { now: T1, allowPrivate: true });
      expect(r.changeIds).toHaveLength(1);
    });
    const kinds = db.listChanges({ module: "receipts" }).map((c) => c.kind).sort();
    expect(kinds).toEqual(["added", "removed"]);
  });

  it("says nothing at all when robots.txt is unreachable (Akamai denies moms.gov's)", async () => {
    await withRobots(null, 403, async () => {
      const r = await checkArchiverPolicy(db, HOST, { now: T0, allowPrivate: true });
      // null, NOT [] — "we could not read it" must never render as "declares nothing".
      expect(r.blocks).toBeNull();
      expect(r.changeIds).toHaveLength(0);
      expect(db.listChanges({ module: "receipts" })).toHaveLength(0);
    });
  });

  it("stays silent for a site that blocks AI crawlers but not the archive", async () => {
    await withRobots(["User-agent: *", "Allow: /", "User-agent: ClaudeBot", "Disallow: /"].join("\n"), 200, async () => {
      const r = await checkArchiverPolicy(db, HOST, { now: T0, allowPrivate: true });
      expect(r.blocks).toEqual([]);
      expect(db.listChanges({ module: "receipts" })).toHaveLength(0);
    });
  });
});

describe("originRefusedArchiver — the Archive's own words, not our inference", () => {
  it("recognises SPN2 reporting the origin turned its crawler away (real prod message)", () => {
    const real =
      "error:no-request: The target server blocks access to https://techprosperitycorps.gov/. (HTTP status=403)";
    expect(originRefusedArchiver(real)).toBe("403");
  });

  it("does not treat SPN2's own failures as the origin refusing", () => {
    // These are the Archive struggling, not the site turning it away. Reporting them as a
    // refusal would blame the site for the archiver's bad day.
    expect(originRefusedArchiver("error:user-session-limit")).toBeNull();
    expect(originRefusedArchiver("capture still pending after 90s")).toBeNull();
    expect(originRefusedArchiver("error:service-unavailable: Service unavailable for URL (HTTP status=503).")).toBeNull();
    expect(originRefusedArchiver("no free SPN2 session slot after 120s")).toBeNull();
  });

  it("describes a zero-capture refusal as a preservation gap, quoting the Archive", () => {
    const copy = describeObservedRefusal(
      {
        status: "403",
        existingCaptures: 0,
        archiveMessage: "The target server blocks access to https://techprosperitycorps.gov/. (HTTP status=403)",
        refusesOurPlainRequest: false,
        robotsDisallowsArchiver: false,
      },
      "techprosperitycorps.gov",
      "2026-07-15T00:00:00.000Z",
    );
    expect(copy).toContain("no independent public copy of it exists");
    expect(copy).toContain("Save Page Now service reports");
    expect(copy).toContain("was served normally");
    // Facts and attribution, never motive.
    expect(copy.toLowerCase()).not.toMatch(/hiding|deliberate|refus(ing|es) to|evade|censor|illegal/);
  });

  it("states only what the caller verified — no unchecked claims about the site", () => {
    // Caller didn't establish either fact, so the copy must not assert them.
    const copy = describeObservedRefusal(
      { status: "403", existingCaptures: 0, archiveMessage: "blocks access. (HTTP status=403)" },
      "x.gov",
      "2026-07-15T00:00:00.000Z",
    );
    expect(copy).not.toContain("robots.txt");
    expect(copy).not.toContain("non-browser request");
    expect(copy).toContain("no independent public copy of it exists");
  });

  it("does not claim a preservation gap when the Archive already holds copies", () => {
    const copy = describeObservedRefusal(
      { status: "403", existingCaptures: 148, archiveMessage: "The target server blocks access. (HTTP status=403)" },
      "moms.gov",
      "2026-07-15T00:00:00.000Z",
    );
    expect(copy).toContain("148 earlier capture(s)");
    expect(copy).not.toContain("no independent public copy");
  });
});

describe("recordArchiverRefusal — write it down only when the Archive says the site refused", () => {
  const HOST = "techprosperitycorps.gov";
  // SPN2's real prod message for a site the Archive cannot capture.
  const REFUSED =
    "error:no-request: The target server blocks access to https://techprosperitycorps.gov/. (HTTP status=403)";

  const withCdx = async (body: string, fn: () => Promise<void>): Promise<void> => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => new Response(body)) as typeof fetch;
    try {
      await fn();
    } finally {
      globalThis.fetch = real;
    }
  };

  it("records a high-severity preservation gap when nothing has archived the site", async () => {
    await withCdx("", async () => {
      // CDX answers "no captures", and the site serves our plain request → the 403 really is
      // specific to the archiver.
      const id = await recordArchiverRefusal(db, HOST, REFUSED, { now: T0, probe: async () => 200 });
      expect(id).not.toBeNull();
    });
    const c = db.listChanges({ module: "receipts" })[0]!;
    expect(c.field).toBe("archiver_refused");
    expect(c.severity).toBe("high");
    expect(c.reason).toContain("no independent public copy of it exists");
    expect(c.reason).toContain("The target server blocks access");
    expect(c.reason).toContain("served normally");
    expect(c.source_url).toContain("web.archive.org/save/");
  });

  // The regression that matters most here: three claims went public implying these sites
  // singled the Archive out. They 403 every non-browser client, ours included.
  it("says the site refuses ALL automated clients when it also refuses us", async () => {
    await withCdx("", async () => {
      await recordArchiverRefusal(db, HOST, REFUSED, { now: T0, probe: async () => 403 });
    });
    const c = db.listChanges({ module: "receipts" })[0]!;
    expect(c.reason).toContain("refuse automated clients generally rather than the Internet Archive specifically");
    // Must NOT imply the site treats us better than the Archive.
    expect(c.reason).not.toContain("served normally");
    // And it is not a high-severity preservation story when nobody automated can read it.
    expect(c.severity).toBe("notable");
  });

  it("names the redirect target that actually refused", async () => {
    // Real case: techprosperitycorps.gov 301s to www.peacecorps.gov/tech, and Peace Corps' server
    // is what returns the 403. Quoting a message about another domain without saying so misleads.
    const viaRedirect =
      "error:no-request: The target server blocks access to https://www.peacecorps.gov/tech. (HTTP status=403)";
    await withCdx("", async () => {
      await recordArchiverRefusal(db, HOST, viaRedirect, { now: T0, probe: async () => 403 });
    });
    const c = db.listChanges({ module: "receipts" })[0]!;
    expect(c.reason).toContain("redirects to https://www.peacecorps.gov/tech, which is the server that refused");
  });

  it("keeps SPN2's sentence intact when stripping our error prefix", async () => {
    await withCdx("", async () => {
      await recordArchiverRefusal(db, HOST, REFUSED, { now: T0, probe: async () => 403 });
    });
    const c = db.listChanges({ module: "receipts" })[0]!;
    expect(c.reason).toContain('"The target server blocks access');
    expect(c.reason).not.toContain("no-request:"); // the old sloppy prefix strip left this behind
  });

  it("grades a refusal on a well-archived site as notable, not a preservation gap", async () => {
    const rows = JSON.stringify([["timestamp"], ...Array.from({ length: 148 }, (_, i) => [`2026070200${i}`])]);
    await withCdx(rows, async () => {
      await recordArchiverRefusal(db, "moms.gov", REFUSED, { now: T0, probe: async () => 403 });
    });
    const c = db.listChanges({ module: "receipts" })[0]!;
    expect(c.severity).toBe("notable");
    expect(c.reason).toContain("148 earlier capture(s)");
  });

  it("says nothing when the archiver failed for its OWN reasons", async () => {
    for (const own of [
      "error:user-session-limit",
      "capture still pending after 90s",
      "error:service-unavailable: Service unavailable for URL (HTTP status=503).",
    ]) {
      expect(await recordArchiverRefusal(db, HOST, own, { now: T0 })).toBeNull();
    }
    expect(db.listChanges({ module: "receipts" })).toHaveLength(0);
  });

  it("says nothing when the capture count is unknowable", async () => {
    const real = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("cdx unreachable");
    }) as typeof fetch;
    try {
      // Can't count ⇒ can't say whether a copy exists ⇒ must not claim a preservation gap.
      expect(await recordArchiverRefusal(db, HOST, REFUSED, { now: T0 })).toBeNull();
      expect(db.listChanges({ module: "receipts" })).toHaveLength(0);
    } finally {
      globalThis.fetch = real;
    }
  });

  it("reports a standing refusal once, not every sweep", async () => {
    await withCdx("", async () => {
      await recordArchiverRefusal(db, HOST, REFUSED, { now: T0, probe: async () => 403 });
      expect(await recordArchiverRefusal(db, HOST, REFUSED, { now: T1, probe: async () => 403 })).toBeNull();
    });
    expect(db.listChanges({ module: "receipts" })).toHaveLength(1);
  });
});

describe("findCaptureNear — adopt the Archive's nearest real capture", () => {
  const cdxRows = (rows: string[][]): CdxOptions => ({
    fetchImpl: async () => new Response(JSON.stringify([["timestamp", "statuscode"], ...rows])),
  });

  it("picks the capture closest to when we looked, and reports the drift honestly", async () => {
    const near = await findCaptureNear("https://trumpaccounts.gov/", "2026-07-13T04:35:00.000Z", {
      ...cdxRows([
        ["20260713010000", "200"], // 3h35m before
        ["20260713044000", "200"], // 5m after  <- closest
        ["20260713080000", "200"], // 3h25m after
      ]),
      windowHours: 6,
    });
    expect(near?.archiveUrl).toBe("https://web.archive.org/web/20260713044000/https://trumpaccounts.gov/");
    expect(near?.driftMinutes).toBe(5);
    expect(near?.capturedAt).toBe("2026-07-13T04:40:00.000Z");
  });

  it("never adopts a block page — only 200s are a copy of the page", async () => {
    const near = await findCaptureNear("https://trumpaccounts.gov/", "2026-07-13T04:35:00.000Z", {
      ...cdxRows([["20260713043600", "403"]]), // 1m away, but a refusal
      windowHours: 6,
    });
    expect(near).toBeNull();
  });

  it("refuses a capture outside the window — too far to be evidence of what we saw", async () => {
    const near = await findCaptureNear("https://trumpaccounts.gov/", "2026-07-13T04:35:00.000Z", {
      ...cdxRows([["20260710040000", "200"]]), // 3 days off
      windowHours: 6,
    });
    expect(near).toBeNull();
  });

  it("returns null (not a throw) when CDX is unreachable", async () => {
    const near = await findCaptureNear("https://x.gov/", "2026-07-13T04:35:00.000Z", {
      fetchImpl: async () => {
        throw new Error("fetch failed");
      },
    });
    expect(near).toBeNull();
  });
});

describe("makeArchiver — save, else adopt", () => {
  it("prefers our own capture and does not touch CDX when the save works", async () => {
    let cdxCalls = 0;
    const archiver = makeArchiver({
      accessKey: "k",
      secret: "s",
      pollIntervalMs: 1,
      slotPollIntervalMs: 1,
      fetchImpl: async (url) => {
        if (url.includes("/cdx/")) cdxCalls++;
        if (url.includes("/status/user")) return new Response(JSON.stringify({ available: 3 }));
        if (url === "https://web.archive.org/save") return new Response(JSON.stringify({ job_id: "j" }));
        return new Response(
          JSON.stringify({ status: "success", timestamp: "20260713043500", original_url: "https://a.gov/" }),
        );
      },
    });
    expect(await archiver("https://a.gov/")).toBe("https://web.archive.org/web/20260713043500/https://a.gov/");
    expect(cdxCalls).toBe(0);
  });

  it("falls back to the Archive's existing capture when our save fails", async () => {
    const adopted: { url: string; drift: number }[] = [];
    const archiver = makeArchiver({
      accessKey: "k",
      secret: "s",
      pollIntervalMs: 1,
      slotPollIntervalMs: 1,
      now: () => "2026-07-13T04:35:00.000Z",
      onAdopt: (_u, archiveUrl, drift) => adopted.push({ url: archiveUrl, drift }),
      fetchImpl: async (url) => {
        if (url.includes("/status/user")) return new Response(JSON.stringify({ available: 3 }));
        if (url === "https://web.archive.org/save")
          return new Response(JSON.stringify({ status_ext: "error:user-session-limit" }));
        if (url.includes("/cdx/"))
          return new Response(JSON.stringify([["timestamp", "statuscode"], ["20260713043800", "200"]]));
        return new Response("{}");
      },
    });
    expect(await archiver("https://a.gov/")).toBe("https://web.archive.org/web/20260713043800/https://a.gov/");
    expect(adopted[0]?.drift).toBe(3);
  });

  it("returns null when the save fails and no nearby capture exists", async () => {
    const archiver = makeArchiver({
      accessKey: "k",
      secret: "s",
      pollIntervalMs: 1,
      slotPollIntervalMs: 1,
      now: () => "2026-07-13T04:35:00.000Z",
      fetchImpl: async (url) => {
        if (url.includes("/status/user")) return new Response(JSON.stringify({ available: 3 }));
        if (url === "https://web.archive.org/save") return new Response(JSON.stringify({ status_ext: "error:x" }));
        return new Response(""); // CDX: nothing indexed (techprosperitycorps.gov's real state)
      },
    });
    expect(await archiver("https://techprosperitycorps.gov/")).toBeNull();
  });
});

describe("archive dating — an archive is dated by its OWN capture, not the row holding it", () => {
  it("reads the capture instant off a pinned URL", () => {
    expect(archiveTimestamp("https://web.archive.org/web/20260702181455/https://trumpaccounts.gov/")).toBe(
      "2026-07-02T18:14:55.000Z",
    );
    expect(archiveTimestamp("https://web.archive.org/web/https://cdc.gov/")).toBeNull();
  });

  it("measures drift between the archive and the observation it backs", () => {
    const url = "https://web.archive.org/web/20260713044000/https://a.gov/";
    expect(archiveDriftMinutes(url, "2026-07-13T04:35:00.000Z")).toBe(5);
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
