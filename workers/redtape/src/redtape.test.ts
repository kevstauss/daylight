import { fileURLToPath } from "node:url";
import { loadWatchlist } from "@daylight/core";
import { createDb, type DaylightDb, type GapRow } from "@daylight/db";
import { beforeEach, describe, expect, it } from "vitest";
import { claudeResearcher, parseAgentJson, runRedtapeAssessment, runRedtapeSweep, searchSorns } from "./index.js";
import type { Researcher, ResearcherInput } from "./types.js";

const watchlist = loadWatchlist(fileURLToPath(new URL("../../../config/watchlist.yaml", import.meta.url)));

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

describe("§7.6 a blank trail is not a documented negative", () => {
  const blankTrail = mock({
    pia_found: false,
    pia_refs: [],
    sorn_found: false,
    sorn_refs: [],
    gap_assessment: "no_filing",
    confidence: 0.6,
    queries_run: ["", "   "],
    sources_checked: [""],
    fact_vs_inference_notes: "",
  });

  it("an all-blank queries/sources trail is rejected (routed to manual, never auto no_filing)", async () => {
    const r = await runRedtapeAssessment({
      db,
      candidate: { ...candidate, domain: "ndstudio.gov" },
      researcher: blankTrail,
      now: NOW,
    });
    expect(r.manual).toBe(true);
    expect(db.publicGaps()).toHaveLength(0);
  });

  it("publicGaps withholds a published gap that has an empty trail (read-side invariant)", async () => {
    const r = await runRedtapeAssessment({ db, candidate, researcher: malformed, now: NOW }); // manual, []
    db.reviewGap(r.gapId, { published: true }); // a reviewer publishes a trail-less manual gap
    expect(db.publicGaps()).toHaveLength(0); // still withheld — no re-checkable negative
  });
});

describe("sweep is idempotent (safe for the weekly cron)", () => {
  it("assesses a candidate once, then skips it while its evidence is unchanged", async () => {
    // Floodlight collection evidence for a watched apex.
    db.upsertScorecard(
      {
        url: "https://trumpaccounts.gov/",
        domain: "trumpaccounts.gov",
        trackerCount: 3,
        sessionReplay: true,
        firstPartyProxied: false,
        privacyNoticeUrl: null,
        requestCount: 40,
        engineVersion: "floodlight/0.4",
        severity: "high",
        trackersJson: "[]",
        reasonsJson: "[]",
      },
      NOW,
    );

    const r1 = await runRedtapeSweep({ db, watchlist, researcher: noFiling, now: NOW });
    expect(r1.assessed).toBeGreaterThanOrEqual(1);
    const queued = db.reviewQueueGaps(500).length;

    const r2 = await runRedtapeSweep({ db, watchlist, researcher: noFiling, now: NOW });
    expect(r2.assessed).toBe(0); // unchanged evidence → nothing re-assessed
    expect(r2.skipped).toBeGreaterThanOrEqual(1);
    expect(db.reviewQueueGaps(500).length).toBe(queued); // no duplicate gaps piled up
  });
});

describe("tool-use researcher actually searches before concluding", () => {
  it("runs the Federal Register tool, feeds results back, and returns the model's final JSON", async () => {
    const searches: string[] = [];
    let call = 0;
    const fetchImpl = async (): Promise<Response> => {
      call++;
      if (call === 1) {
        // Model asks to search.
        return new Response(
          JSON.stringify({
            stop_reason: "tool_use",
            content: [
              { type: "text", text: "Let me search." },
              { type: "tool_use", id: "t1", name: "search_federal_register", input: { query: "trumpaccounts SORN" } },
            ],
          }),
          { status: 200 },
        );
      }
      // Model concludes with JSON after seeing the tool result.
      return new Response(
        JSON.stringify({
          stop_reason: "end_turn",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                pia_found: false,
                pia_refs: [],
                sorn_found: true,
                sorn_refs: ["FR 2026-Treasury"],
                gap_assessment: "incomplete_filing",
                confidence: 0.7,
                queries_run: ["trumpaccounts SORN"],
                sources_checked: ["federalregister.gov/api"],
                fact_vs_inference_notes: "SORN found but omits the analytics processor (inference).",
              }),
            },
          ],
        }),
        { status: 200 },
      );
    };
    const researcher = claudeResearcher({
      apiKey: "test-key",
      fetchImpl,
      search: async (q) => {
        searches.push(q);
        return [{ documentNumber: "2026-1", title: "SORN — Treasury", url: "https://fr/d/2026-1", publicationDate: "2026-01-01" }];
      },
    });
    const raw = await researcher({ domain: "trumpaccounts.gov", url: null, collectsPiiEvidence: ["email input"] });
    expect(searches).toContain("trumpaccounts SORN"); // it really searched
    expect(parseAgentJson(raw)?.gap_assessment).toBe("incomplete_filing");
  });

  it("never sends more than 4 cache_control blocks, even on a long multi-turn run", async () => {
    // Anthropic caps cache_control at 4 blocks/request. A well-documented agency drives many
    // search turns; if the breakpoint isn't cleared each turn the count grows past 4 and the API
    // 400s — silently killing exactly those assessments. This locks the incremental cache at
    // <=4 (system anchor + one moving breakpoint) while still proving caching is on (>0).
    let maxBreakpoints = 0;
    const fetchImpl = async (...args: unknown[]): Promise<Response> => {
      const init = args[1] as { body?: string } | undefined;
      const body = JSON.parse(init?.body ?? "{}") as {
        system?: { cache_control?: unknown }[];
        messages?: { content?: { cache_control?: unknown }[] }[];
      };
      let count = 0;
      for (const b of body.system ?? []) if (b.cache_control) count++;
      for (const m of body.messages ?? []) if (Array.isArray(m.content)) for (const b of m.content) if (b.cache_control) count++;
      maxBreakpoints = Math.max(maxBreakpoints, count);
      // Always request another search → drives the full maxTurns budget.
      return new Response(
        JSON.stringify({
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "search_federal_register", input: { query: "q" } }],
        }),
        { status: 200 },
      );
    };
    const researcher = claudeResearcher({
      apiKey: "test-key",
      maxTurns: 6,
      fetchImpl,
      search: async () => [{ documentNumber: "1", title: "SORN", url: "https://fr/d/1", publicationDate: "2026-01-01" }],
    });
    await researcher({ domain: "eac.gov", url: null, collectsPiiEvidence: ["email input"] });
    expect(maxBreakpoints).toBeGreaterThan(0); // caching is actually engaged
    expect(maxBreakpoints).toBeLessThanOrEqual(4); // never exceeds Anthropic's limit
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
