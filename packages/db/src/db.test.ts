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
