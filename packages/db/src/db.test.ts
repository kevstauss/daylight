import type { Change, DomainRecord, Observation } from "@daylight/core";
import { classifyChangeFlag, FLAG_TYPES, sha256 } from "@daylight/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createDb, DaylightDb } from "./index.js";

const rec = (over: Partial<DomainRecord> = {}): DomainRecord => ({
  domain: "usadf.gov",
  domainType: "Federal - Executive",
  org: "United States African Development Foundation",
  suborg: "African Development Foundation",
  city: "Washington",
  state: "DC",
  securityContactEmail: "akash@ndstudio.gov",
  ...over,
});

let db: DaylightDb;
beforeEach(() => {
  db = createDb(":memory:");
});

describe("domains", () => {
  it("upserts and reads back, preserving first_seen while advancing last_seen", () => {
    db.upsertDomain(rec(), "2026-06-01T00:00:00.000Z");
    db.upsertDomain(rec({ securityContactEmail: "new@ndstudio.gov" }), "2026-06-02T00:00:00.000Z");
    const row = db.getDomain("usadf.gov");
    expect(row?.first_seen).toBe("2026-06-01T00:00:00.000Z");
    expect(row?.last_seen).toBe("2026-06-02T00:00:00.000Z");
    expect(row?.security_contact_email).toBe("new@ndstudio.gov");
  });

  it("searches across domain/org/suborg/contact", () => {
    db.upsertDomain(rec(), "2026-06-01T00:00:00.000Z");
    expect(db.searchDomains({ q: "ndstudio" })).toHaveLength(1); // matches contact
    expect(db.searchDomains({ org: "african" })).toHaveLength(1);
    expect(db.searchDomains({ contact: "akash" })).toHaveLength(1);
    expect(db.searchDomains({ q: "nomatch" })).toHaveLength(0);
  });
});

describe("observations idempotency", () => {
  it("skips duplicate (module,domain,content_hash)", () => {
    const obs: Observation = {
      module: "ledger",
      domain: "usadf.gov",
      observedAt: "2026-06-01T00:00:00.000Z",
      sourceUrl: "https://example/current-federal.csv",
      contentHash: sha256("payload"),
      payload: rec(),
    };
    expect(db.insertObservation(obs).inserted).toBe(true);
    expect(db.insertObservation(obs).inserted).toBe(false); // dedup
    expect(db.latestObservation("ledger", "usadf.gov")).not.toBeNull();
  });
});

describe("change flag filter — SQL predicate matches the JS classifier", () => {
  const mk = (over: Partial<Change>): Change => ({
    module: "ledger",
    domain: "x.gov",
    detectedAt: "2026-06-01T00:00:00.000Z",
    kind: "modified",
    severity: "info",
    ...over,
  });

  const samples: Change[] = [
    mk({ kind: "added", severity: "high", reason: "security contact is @ndstudio.gov, foreign to usadf.gov (US ADF)" }),
    mk({ kind: "added", severity: "high", reason: 'watched organization "Executive Office of the President" on new domain fraud.gov' }),
    mk({ kind: "added", reason: "new federal domain: soarc.gov (Department of Defense)" }),
    mk({ kind: "removed" }),
    mk({ kind: "modified", field: "securityContactEmail", oldValue: "a@x.gov", newValue: "b@x.gov" }),
    mk({ kind: "modified", field: "org", oldValue: "A", newValue: "B" }),
    mk({ kind: "modified", field: "suborg", oldValue: "A", newValue: "B" }),
    mk({ kind: "modified", field: "city", oldValue: "A", newValue: "B" }),
  ];

  it("every flag filter returns exactly the rows the classifier assigns to it", () => {
    for (const s of samples) db.insertChange(s);
    const rows = db.listChanges({ module: "ledger", limit: 1000 });
    const byFlag = db.countChangesByFlag({ module: "ledger" });
    for (const ft of FLAG_TYPES) {
      const expected = rows.filter((r) => classifyChangeFlag(r) === ft.kind).length;
      const got = db.listChanges({ module: "ledger", flag: ft.kind, limit: 1000 });
      expect(got.length, ft.kind).toBe(expected);
      expect(got.every((r) => classifyChangeFlag(r) === ft.kind), ft.kind).toBe(true);
      expect(db.countChanges({ module: "ledger", flag: ft.kind }), ft.kind).toBe(expected);
      expect(byFlag[ft.kind], ft.kind).toBe(expected); // single-query CASE matches too
    }
    // Every row lands in exactly one bucket (partition check).
    const sum = FLAG_TYPES.reduce((n, ft) => n + db.countChanges({ module: "ledger", flag: ft.kind }), 0);
    expect(sum).toBe(rows.length);
  });
});

describe("featuredChanges — homepage notable-findings trio", () => {
  const mkc = (over: Partial<Change>): Change => ({
    module: "lookout",
    domain: "x.gov",
    detectedAt: "2026-07-02T16:00:00.000Z",
    kind: "added",
    severity: "high",
    ...over,
  });

  it("dedupes by domain, drops info, and ranks severity → mimic → recency", () => {
    // A single scan logs a burst of high subdomains on ONE apex in the same second. The mimic
    // ("looks like …") is inserted FIRST (lowest id) so the recency tiebreak alone would NOT pick
    // it — only the function-mimic bonus can. Two other domains + info-level noise round it out.
    const burstAt = "2026-07-02T16:47:00.000Z";
    db.insertChange(mkc({ domain: "ndstudio.gov", detectedAt: burstAt, reason: "new subdomain vote-gov.previews.ndstudio.gov — looks like vote.gov hosted under ndstudio.gov" }));
    db.insertChange(mkc({ domain: "ndstudio.gov", detectedAt: burstAt, reason: "new subdomain admin.ndstudio.gov — high-signal subdomain label admin" }));
    db.insertChange(mkc({ domain: "ndstudio.gov", detectedAt: burstAt, reason: "new subdomain sandbox.ndstudio.gov — high-signal subdomain label sandbox" }));
    // A higher-severity-tier peer on another domain, slightly more recent than the burst.
    db.insertChange(mkc({ domain: "trumpaccounts.gov", detectedAt: "2026-07-02T16:50:00.000Z", reason: "new subdomain staging.trumpaccounts.gov — high-signal subdomain label staging" }));
    // A notable (lower tier) — must sort below every high.
    db.insertChange(mkc({ domain: "realfood.gov", severity: "notable", detectedAt: "2026-07-02T16:49:00.000Z", reason: "new subdomain cdn.realfood.gov — subdomain label cdn" }));
    // Info-level noise, most recent of all — must never appear.
    db.insertChange(mkc({ domain: "noise.gov", severity: "info", detectedAt: "2026-07-02T17:00:00.000Z", reason: "new subdomain www.noise.gov" }));

    const featured = db.featuredChanges(3);

    // One card per domain — the burst collapses to a single ndstudio row.
    expect(featured.map((c) => c.domain)).toEqual(["ndstudio.gov", "trumpaccounts.gov", "realfood.gov"]);
    // The ndstudio representative is the function-mimic finding, not a generic burst sibling…
    expect(featured[0]?.reason).toContain("looks like vote.gov");
    // …even though trumpaccounts is more recent: the high+mimic score outranks a plain high.
    // Info severity is excluded entirely.
    expect(featured.some((c) => c.severity === "info")).toBe(false);
    // Every high sorts above the lone notable.
    expect(featured.at(-1)?.domain).toBe("realfood.gov");
  });

  it("respects the limit and returns [] when there are no high/notable changes", () => {
    db.insertChange(mkc({ domain: "a.gov" }));
    db.insertChange(mkc({ domain: "b.gov" }));
    db.insertChange(mkc({ domain: "c.gov", severity: "info" }));
    expect(db.featuredChanges(2)).toHaveLength(2);

    const empty = createDb(":memory:");
    empty.insertChange(mkc({ domain: "only-info.gov", severity: "info" }));
    expect(empty.featuredChanges(3)).toEqual([]);
  });

  it("collapses one vendor's unlaunched-project batch (Foundry files under the target domain, not the vendor apex)", () => {
    // Foundry stores domain = the would-be target (staging-api.gov, …); the vendor apex it's
    // staging on lives only in the reason. Deduping by raw domain would show three passports.gov
    // cards; featuredSubject groups them by "building on <apex>".
    const at = "2026-07-05T04:57:00.000Z";
    for (const t of ["staging-api", "photos", "photo"]) {
      db.insertChange(mkc({ module: "foundry", severity: "notable", domain: `${t}.gov`, detectedAt: at, reason: `unlaunched project "${t}" building on passports.gov — no ${t}.gov registered yet` }));
    }
    // A different vendor is a different story — must stay separate.
    db.insertChange(mkc({ module: "foundry", severity: "notable", domain: "staged.gov", detectedAt: at, reason: 'unlaunched project "staged" building on trumprx.gov — no staged.gov registered yet' }));

    const featured = db.featuredChanges(5);
    const foundry = featured.filter((c) => c.module === "foundry");
    expect(foundry).toHaveLength(2); // one per vendor apex, not one per target
    expect(foundry.map((c) => c.reason).every((r) => /building on/.test(r ?? ""))).toBe(true);
  });

  it("a burst of fresh notables never buries an older high (tiers are queried separately)", () => {
    // The bug the live deploy surfaced: a naive top-250-by-recency window filled with a notable
    // batch pushed the real high findings out of sight.
    db.insertChange(mkc({ domain: "old-high.gov", severity: "high", detectedAt: "2026-07-01T00:00:00.000Z", reason: "security contact @ndstudio.gov, foreign to old-high.gov" }));
    for (let i = 0; i < 30; i++) {
      db.insertChange(mkc({ module: "foundry", severity: "notable", domain: `proj${i}.gov`, detectedAt: "2026-07-05T05:00:00.000Z", reason: `unlaunched project "proj${i}" building on vendor${i}.gov — no proj${i}.gov registered yet` }));
    }
    // The high, though days older than the burst, leads the trio.
    expect(db.featuredChanges(3)[0]?.domain).toBe("old-high.gov");
  });
});

describe("dynamic watch tier — new registrations + auto-keep", () => {
  const iso = (d: string) => `${d}T00:00:00.000Z`;
  const mkChange = (over: Partial<Change>): Change => ({
    module: "ledger",
    domain: "x.gov",
    detectedAt: iso("2026-06-20"),
    kind: "added",
    severity: "info",
    ...over,
  });

  it("recentlyAddedDomains returns ledger 'added' domains in the window — deduped, seed-safe", () => {
    db.insertChange(mkChange({ domain: "fraud.gov", detectedAt: iso("2026-06-20") }));
    db.insertChange(mkChange({ domain: "fraud.gov", detectedAt: iso("2026-06-25") })); // re-add collapses
    db.insertChange(mkChange({ domain: "moms.gov", detectedAt: iso("2026-06-30") }));
    db.insertChange(mkChange({ domain: "old.gov", detectedAt: iso("2026-01-01") })); // before window
    db.insertChange(mkChange({ domain: "modonly.gov", kind: "modified", field: "org" })); // not an add
    db.insertChange(mkChange({ module: "lookout", domain: "sub.gov", severity: "high" })); // other module

    // Only genuine ledger 'added' inside the window, one row per domain, sorted.
    expect(db.recentlyAddedDomains(iso("2026-06-01"))).toEqual(["fraud.gov", "moms.gov"]);
    // A window that predates every add returns nothing (no false positives from a wide net).
    expect(db.recentlyAddedDomains(iso("2027-01-01"))).toEqual([]);
  });

  it("firstSeenProvenance: registered (real date) → longstanding (post-backfill) → seeded (fallback)", () => {
    // A domain with an `added` change reports its earliest appearance date, honestly registered.
    db.insertChange(mkChange({ domain: "fraud.gov", detectedAt: iso("2026-05-10") }));
    db.insertChange(mkChange({ domain: "fraud.gov", detectedAt: iso("2026-05-20") })); // later add ignored
    expect(db.firstSeenProvenance("fraud.gov")).toEqual({ kind: "registered", date: iso("2026-05-10") });

    // A domain with NO `added` change: before the history backfill has run we can only say "seeded".
    db.upsertDomain(rec({ domain: "nasa.gov" }), iso("2026-07-01"));
    expect(db.firstSeenProvenance("nasa.gov")).toEqual({ kind: "seeded", date: iso("2026-07-01") });

    // Once the backfill marker is present, that same no-`added` domain is longstanding (2019 baseline).
    db.insertObservation({
      module: "ledger",
      domain: "__ledger_history__",
      observedAt: iso("2026-07-01"),
      sourceUrl: "https://github.com/cisagov/dotgov-data",
      contentHash: sha256("history-done"),
      payload: {},
    });
    expect(db.firstSeenProvenance("nasa.gov")).toEqual({
      kind: "longstanding",
      date: "2019-02-06T00:00:00.000Z",
    });
    // …but a domain that DOES have an `added` change stays registered even post-backfill.
    expect(db.firstSeenProvenance("fraud.gov").kind).toBe("registered");
  });

  it("backfillFirstSeen: column ← earliest 'added' per domain; 2019 for longstanding once backfilled", () => {
    // A "registered" domain: two adds — the EARLIEST wins — overrides its seed date.
    db.upsertDomain(rec({ domain: "fraud.gov" }), iso("2026-07-01"));
    db.insertChange(mkChange({ domain: "fraud.gov", detectedAt: iso("2026-05-20") }));
    db.insertChange(mkChange({ domain: "fraud.gov", detectedAt: iso("2026-05-10") }));
    // A "longstanding" domain: no `added` event, still on its seed date.
    db.upsertDomain(rec({ domain: "nasa.gov" }), iso("2026-07-01"));

    // Before the history marker exists: only registered domains move; longstanding is left alone
    // (a missing add could mean "predates our watching", not "the 2019 baseline").
    let res = db.backfillFirstSeen();
    expect(db.getDomain("fraud.gov")?.first_seen).toBe(iso("2026-05-10"));
    expect(db.getDomain("nasa.gov")?.first_seen).toBe(iso("2026-07-01"));
    expect(res).toEqual({ registered: 1, longstanding: 0 });

    // Once the backfill marker is present, no-`added` domains are set to the 2019 record start.
    db.insertObservation({
      module: "ledger", domain: "__ledger_history__", observedAt: iso("2026-07-01"),
      sourceUrl: "https://github.com/cisagov/dotgov-data", contentHash: sha256("done"), payload: {},
    });
    res = db.backfillFirstSeen();
    expect(db.getDomain("nasa.gov")?.first_seen).toBe("2019-02-06T00:00:00.000Z");
    expect(db.getDomain("fraud.gov")?.first_seen).toBe(iso("2026-05-10")); // real add date preserved
    expect(res.longstanding).toBe(1);
  });

  it("keptWatchDomains returns only domains with a notable/high scorecard (auto-keep)", () => {
    const sc = (url: string, domain: string, severity: string) => ({
      url, domain, trackerCount: 1, sessionReplay: false, firstPartyProxied: false,
      privacyNoticeUrl: null, requestCount: 10, engineVersion: "test", severity,
      trackersJson: "[]", reasonsJson: "[]", formFieldsJson: null,
    });
    db.upsertScorecard(sc("https://fraud.gov/", "fraud.gov", "high"), iso("2026-06-22"));
    db.upsertScorecard(sc("https://moms.gov/", "moms.gov", "notable"), iso("2026-06-22"));
    db.upsertScorecard(sc("https://clean.gov/", "clean.gov", "info"), iso("2026-06-22")); // excluded

    expect(db.keptWatchDomains()).toEqual(["fraud.gov", "moms.gov"]);
  });
});

describe("receipts coverage view — latest snapshot per page", () => {
  const iso = (d: string) => `${d}T00:00:00.000Z`;
  const snap = (url: string, capturedAt: string, over: Record<string, unknown> = {}) => ({
    url, domain: url.replace(/^https?:\/\//, "").replace(/\/.*/, ""), capturedAt,
    domHash: "h", screenshotRef: null, trackerSnapshotJson: "[]", privacyTextHash: null,
    formFieldsJson: "[]", sealPresent: false, redirectTarget: null, waybackUrl: null, ...over,
  });

  it("returns one row per url — the newest capture — newest page first", () => {
    db.insertSnapshot(snap("https://a.gov/", iso("2026-06-01")));
    db.insertSnapshot(snap("https://a.gov/", iso("2026-06-08"), { privacyTextHash: "p", trackerSnapshotJson: '["ga"]' }));
    db.insertSnapshot(snap("https://b.gov/", iso("2026-06-05"), { sealPresent: true, waybackUrl: "https://web.archive.org/x" }));

    const cov = db.coverageSnapshots();
    // one row per url (a collapses its two captures), newest capture first → a (Jun 8) before b (Jun 5)
    expect(cov.map((s) => s.url)).toEqual(["https://a.gov/", "https://b.gov/"]);
    const a = cov.find((s) => s.url === "https://a.gov/")!;
    expect(a.captured_at).toBe(iso("2026-06-08")); // the LATEST, not the first
    expect(a.privacy_text_hash).toBe("p");
    expect(db.coverageSnapshots().find((s) => s.url === "https://b.gov/")?.seal_present).toBe(1);
  });
});

describe("scans / status", () => {
  it("records start + finish and returns latest per module", () => {
    const id = db.recordScanStart("ledger");
    db.recordScanFinish(id, { ok: true, itemsSeen: 1344, changesEmitted: 3 });
    const status = db.getStatus();
    expect(status).toHaveLength(1);
    expect(status[0]?.ok).toBe(1);
    expect(status[0]?.changes_emitted).toBe(3);
  });
});

describe("analytics (aggregate-only)", () => {
  it("upserts per (day,path,ref) and aggregates over a window", () => {
    db.recordHit({ day: "2026-07-01", path: "/floodlight", refKind: "gov", refHost: "epa.gov" });
    db.recordHit({ day: "2026-07-01", path: "/floodlight", refKind: "gov", refHost: "epa.gov" });
    db.recordHit({ day: "2026-07-01", path: "/registry", refKind: "direct", refHost: "" });
    db.recordHit({ day: "2026-07-02", path: "/floodlight", refKind: "search", refHost: "" });

    expect(db.analyticsTotalVisits("2026-07-01")).toBe(4);
    expect(db.analyticsTotalVisits("2026-07-02")).toBe(1);
    expect(db.analyticsFirstDay()).toBe("2026-07-01");

    expect(db.analyticsDailyTotals("2026-07-01")).toEqual([
      { day: "2026-07-01", count: 3 },
      { day: "2026-07-02", count: 1 },
    ]);

    expect(db.analyticsTopPaths("2026-07-01", 10)[0]).toEqual({ path: "/floodlight", count: 3 });

    // The .gov panel: only ref_kind='gov' rows, keyed by public apex.
    expect(db.analyticsGovReferrers("2026-07-01", 10)).toEqual([{ ref_host: "epa.gov", count: 2 }]);

    const kinds = Object.fromEntries(
      db.analyticsRefKindTotals("2026-07-01").map((k) => [k.ref_kind, k.count]),
    );
    expect(kinds).toMatchObject({ gov: 2, direct: 1, search: 1 });
  });

  it("separates feed/api consumption from human page views", () => {
    db.recordHit({ day: "2026-07-01", path: "/registry", refKind: "direct", refHost: "" });
    db.recordHit({ day: "2026-07-01", path: "/feed", refKind: "direct", refHost: "" });
    db.recordHit({ day: "2026-07-01", path: "/feed", refKind: "direct", refHost: "" });
    db.recordHit({ day: "2026-07-01", path: "/api", refKind: "direct", refHost: "" });

    const byPath = Object.fromEntries(
      db.analyticsPathTotals("2026-07-01").map((p) => [p.path, p.count]),
    );
    expect(byPath).toMatchObject({ "/registry": 1, "/feed": 2, "/api": 1 });

    // The referrer mix counts the page view, not the 3 consumption pulls.
    const kinds = Object.fromEntries(
      db.analyticsRefKindTotals("2026-07-01").map((k) => [k.ref_kind, k.count]),
    );
    expect(kinds.direct).toBe(1);
  });
});

describe("redtape review lifecycle", () => {
  type GapInput = Parameters<DaylightDb["insertGap"]>[0];
  const gap = (over: Partial<GapInput> = {}): GapInput => ({
    domain: "eac.gov",
    collectsPiiEvidence: ["4 third-party trackers"],
    queriesRun: ["site:eac.gov privacy impact assessment"],
    // publicGaps() requires a non-empty sources trail (the negative must be re-checkable).
    sourcesChecked: ["https://www.federalregister.gov/agencies/election-assistance-commission"],
    gapAssessment: "incomplete_filing",
    createdAt: "2026-07-01T00:00:00.000Z",
    ...over,
  });

  it("reviewGap (default reject) moves a gap out of the queue and into reviewedGaps", () => {
    const id = db.insertGap(gap());
    expect(db.reviewQueueGaps().map((g) => g.id)).toContain(id);
    expect(db.reviewedGaps()).toHaveLength(0);

    db.reviewGap(id, { published: false, reviewerNote: "no PIA required per FY2011 AFR" });

    expect(db.reviewQueueGaps().map((g) => g.id)).not.toContain(id);
    const reviewed = db.reviewedGaps();
    expect(reviewed).toHaveLength(1);
    expect(reviewed[0]?.published).toBe(0);
    expect(reviewed[0]?.review_disposition).toBe("rejected"); // no disposition + unpublished → rejected
    expect(reviewed[0]?.reviewer_note).toBe("no PIA required per FY2011 AFR");
  });

  it("reviewGap rejects a near-miss disposition (e.g. the button value 'hold' not 'held')", () => {
    const id = db.insertGap(gap());
    expect(() => db.reviewGap(id, { published: false, disposition: "hold" })).toThrow(/invalid disposition/);
    // and it did not partially write — still unreviewed, still in the queue
    expect(db.reviewQueueGaps().map((g) => g.id)).toContain(id);
  });

  it("Hold routes a gap to heldGaps (not reviewedGaps) and out of the active queue", () => {
    const id = db.insertGap(gap());
    db.reviewGap(id, { published: false, reviewerNote: "revisit after AFR check", disposition: "held" });

    expect(db.heldGaps().map((g) => g.id)).toContain(id);
    expect(db.heldGaps()[0]?.review_disposition).toBe("held");
    expect(db.reviewedGaps().map((g) => g.id)).not.toContain(id); // held is excluded from Reviewed
    expect(db.reviewQueueGaps().map((g) => g.id)).not.toContain(id); // left the active queue
  });

  it("reopenGapForRevision requeues a held gap, clears disposition, logs NO correction", () => {
    const id = db.insertGap(gap());
    db.reviewGap(id, { published: false, reviewerNote: "revisit", disposition: "held" });
    expect(db.heldGaps().map((g) => g.id)).toContain(id);

    db.reopenGapForRevision(id);

    expect(db.reviewQueueGaps().map((g) => g.id)).toContain(id); // back in the queue
    expect(db.heldGaps()).toHaveLength(0);
    expect(db.getGap(id)?.review_disposition).toBeNull(); // disposition cleared on requeue
    expect(db.listCorrections()).toHaveLength(0); // never public → no retraction
  });

  it("reopenGapForRevision un-publishes a PUBLISHED gap AND logs a public correction", () => {
    const id = db.insertGap(gap());
    db.reviewGap(id, { published: true, reviewerNote: "published" });
    expect(db.publicGaps().map((g) => g.id)).toContain(id);

    db.reopenGapForRevision(id);

    expect(db.publicGaps().map((g) => g.id)).not.toContain(id); // pulled from public
    expect(db.reviewQueueGaps().map((g) => g.id)).toContain(id); // back in the queue
    const corrections = db.listCorrections();
    expect(corrections).toHaveLength(1);
    expect(corrections[0]?.kind).toBe("retraction");
    expect(corrections[0]?.ref_id).toBe(id);
  });

  it("reviewGap reclassifies the assessment and preserves the model's original label", () => {
    const id = db.insertGap(gap({ gapAssessment: "no_filing" }));
    db.reviewGap(id, { published: true, disposition: "published", assessment: "incomplete_filing", reviewerNote: "found the TAP SORN" });
    const g = db.getGap(id);
    expect(g?.gap_assessment).toBe("incomplete_filing"); // effective/published label is the human's
    expect(g?.model_assessment).toBe("no_filing"); // model's original preserved for provenance
  });

  it("re-reclassifying keeps the model's EARLIEST label, not the previous human value", () => {
    const id = db.insertGap(gap({ gapAssessment: "no_filing" }));
    db.reviewGap(id, { published: false, disposition: "held", assessment: "incomplete_filing" });
    db.reviewGap(id, { published: false, disposition: "held", assessment: "covered" });
    const g = db.getGap(id);
    expect(g?.gap_assessment).toBe("covered");
    expect(g?.model_assessment).toBe("no_filing"); // still the model's original, not "incomplete_filing"
  });

  it("reviewing without an override (or with the same value) leaves assessment + provenance untouched", () => {
    const id = db.insertGap(gap({ gapAssessment: "incomplete_filing" }));
    db.reviewGap(id, { published: false, disposition: "held", reviewerNote: "hold" });
    expect(db.getGap(id)?.model_assessment).toBeNull(); // never reclassified → no provenance noise
    db.reviewGap(id, { published: false, disposition: "held", assessment: "incomplete_filing" }); // same value
    const g = db.getGap(id);
    expect(g?.gap_assessment).toBe("incomplete_filing");
    expect(g?.model_assessment).toBeNull(); // a no-op override must not stamp provenance
  });

  it("rejects an out-of-set assessment override (incl. 'manual') and does not partially write", () => {
    const id = db.insertGap(gap({ gapAssessment: "no_filing" }));
    expect(() => db.reviewGap(id, { published: false, assessment: "totally_fine" })).toThrow(/invalid assessment/);
    expect(() => db.reviewGap(id, { published: false, assessment: "manual" })).toThrow(/invalid assessment/);
    const g = db.getGap(id);
    expect(g?.gap_assessment).toBe("no_filing"); // unchanged
    expect(g?.human_reviewed).toBe(0); // threw before any write
  });

  it("clamps a reviewer confidence override into [0,1]", () => {
    const id = db.insertGap(gap());
    db.reviewGap(id, { published: false, disposition: "held", confidence: 5 });
    expect(db.getGap(id)?.confidence).toBe(1);
    db.reviewGap(id, { published: false, disposition: "held", confidence: -2 });
    expect(db.getGap(id)?.confidence).toBe(0);
  });

  it("saveGapNote saves the note + reclassification WITHOUT deciding — the item stays in the queue", () => {
    const id = db.insertGap(gap({ gapAssessment: "no_filing" }));
    db.saveGapNote(id, { reviewerNote: "draft: checking Treasury PCLIA", assessment: "incomplete_filing", confidence: 0.7 });
    const g = db.getGap(id);
    expect(g?.reviewer_note).toBe("draft: checking Treasury PCLIA");
    expect(g?.gap_assessment).toBe("incomplete_filing"); // reclassified
    expect(g?.model_assessment).toBe("no_filing"); // provenance preserved
    expect(g?.confidence).toBe(0.7);
    expect(g?.human_reviewed).toBe(0); // NOT decided
    expect(g?.review_disposition).toBeNull();
    expect(db.reviewQueueGaps().map((x) => x.id)).toContain(id); // stays in the queue
  });

  it("saveGapNote on a held gap keeps it held (disposition untouched)", () => {
    const id = db.insertGap(gap());
    db.reviewGap(id, { published: false, disposition: "held", reviewerNote: "hold" });
    db.saveGapNote(id, { reviewerNote: "updated draft" });
    const g = db.getGap(id);
    expect(g?.reviewer_note).toBe("updated draft");
    expect(g?.review_disposition).toBe("held"); // unchanged
    expect(db.heldGaps().map((x) => x.id)).toContain(id);
  });

  it("a saved+reclassified-to-covered queue item stays visible; an untouched auto-covered one is hidden", () => {
    const annotated = db.insertGap(gap({ gapAssessment: "incomplete_filing" }));
    db.saveGapNote(annotated, { reviewerNote: "actually covered by a TPWA PIA", assessment: "covered" });
    expect(db.reviewQueueGaps().map((x) => x.id)).toContain(annotated); // human-touched → kept

    const auto = db.insertGap(gap({ gapAssessment: "covered" })); // no reviewer_note
    expect(db.reviewQueueGaps().map((x) => x.id)).not.toContain(auto); // sweep non-finding → hidden
  });

  it("agent_recommendation is stored + readable internally but STRIPPED from the public path", () => {
    const id = db.insertGap(gap({ agentRecommendation: "Publish — no filing found for this small agency" }));
    expect(db.getGap(id)?.agent_recommendation).toBe("Publish — no filing found for this small agency"); // internal keeps it
    db.reviewGap(id, { published: true, disposition: "published" });
    const pub = db.publicGaps().find((x) => x.id === id);
    expect(pub).toBeTruthy();
    expect(pub?.agent_recommendation).toBeNull(); // never leaves the public read path
    // reviewer_note stays public by design (the human curates it before publishing)
    db.reviewGap(id, { published: true, disposition: "published", reviewerNote: "curated public note" });
    expect(db.publicGaps().find((x) => x.id === id)?.reviewer_note).toBe("curated public note");
  });
});
