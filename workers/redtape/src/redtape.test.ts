import { createDb, type DaylightDb, type GapRow } from "@daylight/db";
import { beforeEach, describe, expect, it } from "vitest";
import { runRedtapeAssessment, searchSorns } from "./index.js";
import type { Researcher, ResearcherInput } from "./types.js";

const NOW = "2026-07-01T12:00:00.000Z";

const candidate: ResearcherInput = {
  domain: "trumpaccounts.gov",
  url: "https://trumpaccounts.gov/",
  collectsPiiEvidence: ["email input", "PostHog analytics with session replay"],
};

// Mock researchers return the raw model output (JSON string) — no live LLM in CI.
const mock = (obj: unknown): Researcher => async () => JSON.stringify(obj);

const covered = mock({
  pia_found: true,
  pia_refs: ["DHS/ALL-001 PIA"],
  sorn_found: true,
  sorn_refs: ["FR 2026-12345"],
  gap_assessment: "covered",
  confidence: 0.85,
  queries_run: ["trumpaccounts SORN", "Treasury Trump Accounts privacy"],
  sources_checked: ["federalregister.gov/api", "home.treasury.gov/privacy"],
  fact_vs_inference_notes: "SORN FR 2026-12345 covers the collection (fact).",
});

const incomplete = mock({
  pia_found: false,
  pia_refs: [],
  sorn_found: true,
  sorn_refs: ["FR 2026-Treasury-TrumpAccounts"],
  gap_assessment: "incomplete_filing",
  confidence: 0.7,
  queries_run: ["Trump Accounts SORN PostHog", "Treasury analytics processor SORN"],
  sources_checked: ["federalregister.gov/api"],
  fact_vs_inference_notes: "SORN exists but does not enumerate the analytics processor / PostHog (inference).",
});

const noFiling = mock({
  pia_found: false,
  pia_refs: [],
  sorn_found: false,
  sorn_refs: [],
  gap_assessment: "no_filing",
  confidence: 0.6,
  queries_run: ["ndstudio PIA", "ndstudio SORN Federal Register"],
  sources_checked: ["federalregister.gov/api", "whitehouse.gov"],
  fact_vs_inference_notes: "No published PIA or SORN found as of 2026-07-01 (searches listed).",
});

const malformed: Researcher = async () => "I could not complete the search. Sorry!";

let db: DaylightDb;
beforeEach(() => {
  db = createDb(":memory:");
});

const gap = (id: number): GapRow => db.getGap(id)!;

describe("§7.1 no false gap — a known SORN is `covered`, not a gap", () => {
  it("classifies covered and does not publish it as a gap", async () => {
    const r = await runRedtapeAssessment({ db, candidate, researcher: covered, now: NOW });
    expect(r.assessment).toBe("covered");
    expect(gap(r.gapId).sorn_found).toBe(1);
    expect(db.publicGaps()).toHaveLength(0); // unreviewed → not public
  });
});

describe("§7.2 incomplete filing — Trump Accounts SORN omits the analytics processor", () => {
  it("classifies incomplete_filing with refs + the specific omission noted", async () => {
    const r = await runRedtapeAssessment({ db, candidate, researcher: incomplete, now: NOW });
    expect(r.assessment).toBe("incomplete_filing");
    const g = gap(r.gapId);
    expect(JSON.parse(g.sorn_refs_json ?? "[]")).toHaveLength(1);
    expect(g.fact_vs_inference_notes).toMatch(/analytics processor|posthog/i);
  });
});

describe("§7.3 no filing — collection with no PIA/SORN", () => {
  it("classifies no_filing with a non-empty query trail", async () => {
    const r = await runRedtapeAssessment({ db, candidate: { ...candidate, domain: "ndstudio.gov" }, researcher: noFiling, now: NOW });
    expect(r.assessment).toBe("no_filing");
    const g = gap(r.gapId);
    expect(JSON.parse(g.queries_run_json ?? "[]").length).toBeGreaterThan(0);
    expect(JSON.parse(g.sources_checked_json ?? "[]").length).toBeGreaterThan(0);
  });
});

describe("§7.4 hard gate — an unreviewed gap is NEVER public (data-layer filter)", () => {
  it("only human_reviewed AND published rows are returned by publicGaps()", async () => {
    const r = await runRedtapeAssessment({ db, candidate: { ...candidate, domain: "ndstudio.gov" }, researcher: noFiling, now: NOW });
    expect(db.publicGaps()).toHaveLength(0);

    // reviewed but NOT published → still private
    db.reviewGap(r.gapId, { published: false, reviewerNote: "needs more evidence" });
    expect(db.publicGaps()).toHaveLength(0);

    // reviewed AND published → public
    db.reviewGap(r.gapId, { published: true, reviewerNote: "confirmed" });
    expect(db.publicGaps()).toHaveLength(1);
    expect(db.publicGaps()[0]!.domain).toBe("ndstudio.gov");
  });
});

describe("§7.5 agent robustness — malformed output routes to manual, nothing auto-published", () => {
  it("does not crash, queues manual, publishes nothing", async () => {
    const r = await runRedtapeAssessment({ db, candidate, researcher: malformed, now: NOW });
    expect(r.manual).toBe(true);
    expect(r.assessment).toBe("manual");
    expect(gap(r.gapId).human_reviewed).toBe(0);
    expect(db.publicGaps()).toHaveLength(0);
  });
});

describe("§7.6 every public gap carries a non-empty query + source trail", () => {
  it("publicGaps rows have documented queries_run + sources_checked", async () => {
    const r = await runRedtapeAssessment({ db, candidate: { ...candidate, domain: "ndstudio.gov" }, researcher: noFiling, now: NOW });
    db.reviewGap(r.gapId, { published: true });
    const g = db.publicGaps()[0]!;
    expect(JSON.parse(g.queries_run_json ?? "[]").length).toBeGreaterThan(0);
    expect(JSON.parse(g.sources_checked_json ?? "[]").length).toBeGreaterThan(0);
  });
});

describe("Federal Register client parses SORN notices", () => {
  it("maps API results to refs (injected fetch — no live call)", async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          results: [
            { document_number: "2026-12345", title: "Privacy Act SORN — Example", html_url: "https://federalregister.gov/d/2026-12345", publication_date: "2026-05-01" },
          ],
        }),
        { status: 200 },
      );
    const refs = await searchSorns("example SORN", { fetchImpl });
    expect(refs).toHaveLength(1);
    expect(refs[0]!.documentNumber).toBe("2026-12345");
    expect(refs[0]!.url).toContain("federalregister.gov");
  });
});
