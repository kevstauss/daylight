import { flag } from "@daylight/core";
import { searchSorns, type SornRef } from "./federalregister.js";
import { fetchPublicPage, type FetchPageResult } from "./fetchpage.js";
import type { Researcher, ResearcherInput, ResearcherOutput } from "./types.js";

export const PROMPT_VERSION = "redtape/2026-07-05-recommendation";

// Blank / whitespace-only strings are treated as absent: the §7.6 "documented negative"
// invariant requires a trail a stranger can actually re-run, so [""] must not satisfy it.
const asStrArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];

/**
 * Safely parse the agent's raw output into a validated ResearcherOutput, or null if
 * malformed. Rejects output that lacks a documented negative (queries_run + sources_checked
 * must be non-empty), so an unsubstantiated gap can never pass — spec §4.2/§7.6.
 */
export function parseAgentJson(raw: string): ResearcherOutput | null {
  let s = raw.trim();
  // Tolerate markdown fences even though the contract forbids them.
  s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  const ga = o.gap_assessment;
  if (ga !== "no_filing" && ga !== "incomplete_filing" && ga !== "covered") return null;
  if (typeof o.pia_found !== "boolean" || typeof o.sorn_found !== "boolean") return null;

  const queries = asStrArr(o.queries_run);
  const sources = asStrArr(o.sources_checked);
  if (queries.length === 0 || sources.length === 0) return null; // negative must be documented

  return {
    pia_found: o.pia_found,
    pia_refs: asStrArr(o.pia_refs),
    sorn_found: o.sorn_found,
    sorn_refs: asStrArr(o.sorn_refs),
    gap_assessment: ga,
    confidence: typeof o.confidence === "number" ? o.confidence : 0.5,
    queries_run: queries,
    sources_checked: sources,
    fact_vs_inference_notes: typeof o.fact_vs_inference_notes === "string" ? o.fact_vs_inference_notes : "",
    recommendation: typeof o.recommendation === "string" ? o.recommendation : "",
  };
}

// Stable across every assessment → sent as a cached system prompt (prompt caching), so the
// instruction block is charged once per 5-min window instead of on every candidate + turn.
const SYSTEM_INSTRUCTIONS = [
  "You are a compliance research assistant for a public, strictly neutral watchdog. Determine",
  "whether the federal .gov site the user names has a published Privacy Impact Assessment (E-Gov",
  "Act §208) and/or System of Records Notice (Privacy Act) covering the PII collection observed.",
  "",
  "You MUST use the search_federal_register tool to ACTUALLY search — do not rely on memory.",
  "Run SEVERAL targeted queries: the domain, the operating agency, the program/system name, the",
  "specific data collected, and terms like 'System of Records' / 'Privacy Impact Assessment'.",
  "SORNs are published in the Federal Register (search_federal_register). PIAs almost always are",
  "NOT — under the E-Gov Act they are posted on the operating agency's OWN privacy pages. So you",
  "MUST ALSO use the web_search tool to (a) confirm which federal agency operates the domain, and",
  "(b) check that agency's PIA inventory (e.g. hhs.gov/pia, security.cms.gov/pia, dhs.gov/privacy,",
  "treasury.gov PCLIA inventory) and the site's own privacy page. A filing only 'covers' the",
  "collection if it plainly NAMES the site or that specific web-tracking (analytics/session replay/",
  "third-party pixels) — a topically-adjacent SORN is NOT coverage. Prefer official .gov sources.",
  "When a fetch_public_page tool is offered, prefer it to read a SPECIFIC public .gov page directly",
  "(a privacy policy or a PIA/SORN inventory page) — it returns the page's visible text, PII-redacted.",
  "It only reads public pages and returns NOTHING behind a login/access wall (existence-only), so a",
  "'gated' result means the page exists but you must not treat its contents as read.",
  "Base your conclusion only on what the tools return plus clearly-labeled public knowledge.",
  "",
  "Classify: no_filing (nothing covers this collection), incomplete_filing (a filing exists but",
  "omits this specific processor/collection), covered (a filing plainly covers it).",
  "Be neutral and precise; NEVER assert illegality. Label every claim fact vs inference.",
  "",
  "If the input includes PRIOR notes on this domain (a human 'reviewer note' and/or 'your prior",
  "recommendation'), read them as context: build on them, and don't contradict a documented human",
  "finding without explaining why.",
  "",
  "When finished searching, respond with JSON ONLY (no prose, no markdown fences) with keys:",
  "pia_found, pia_refs[], sorn_found, sorn_refs[], gap_assessment (no_filing|incomplete_filing|covered),",
  "confidence (0..1), queries_run[] (EVERY exact search you ran — Federal Register AND web_search),",
  "sources_checked[] (each source/URL you actually relied on — 'federalregister.gov/api' plus the",
  "agency PIA-inventory URLs you opened), fact_vs_inference_notes, and recommendation (an INTERNAL",
  "one-liner for the human reviewer — 'Publish', 'Reject', or 'Reclassify to <label>' + a brief why;",
  "it guides their decision and is NEVER shown publicly). If you find no filing, say so and list the",
  "queries + sources so the negative is independently re-checkable.",
].join("\n");

export function buildUserInput(input: ResearcherInput): string {
  const lines = [
    `domain: ${input.domain}`,
    `url: ${input.url ?? "(none)"}`,
    `collection evidence: ${JSON.stringify(input.collectsPiiEvidence)}`,
  ];
  const p = input.priorNotes;
  if (p?.reviewerNote?.trim()) lines.push(`prior human reviewer note: ${p.reviewerNote.trim()}`);
  if (p?.agentRecommendation?.trim()) lines.push(`your prior recommendation: ${p.agentRecommendation.trim()}`);
  return lines.join("\n");
}

/** Full prompt (system + input) — kept for reference/compat. */
export function buildPrompt(input: ResearcherInput): string {
  return `${SYSTEM_INSTRUCTIONS}\n\n${buildUserInput(input)}`;
}

const FR_TOOL = {
  name: "search_federal_register",
  description:
    "Search the public Federal Register API for NOTICE documents (SORNs are published as notices). Returns matching titles, document numbers, publication dates, and URLs. Call this multiple times with different targeted queries before concluding.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "the search terms" },
      agency: { type: "string", description: "optional Federal Register agency slug to narrow the search" },
    },
    required: ["query"],
  },
};

// Anthropic-hosted server-side web search. Runs on Anthropic's infrastructure (no client fetch,
// no SSRF surface on our side) — results are returned inline as web_search_tool_result blocks.
// Used to confirm the operating agency and check that agency's own PIA inventory + the site's
// privacy page, which the Federal-Register-only search structurally cannot see. `max_uses` bounds
// cost per assessment. The 20260209 variant (dynamic filtering) needs Sonnet 4.6+/Sonnet 5/
// Opus 4.6+/Fable 5; older models fall back to the basic 20250305 variant.
const WEB_SEARCH_MAX_USES = 8;
function webSearchTool(model: string) {
  const modern = /(sonnet-5|sonnet-4-6|opus-4-[678]|fable-5|mythos-5)/.test(model);
  return {
    type: modern ? "web_search_20260209" : "web_search_20250305",
    name: "web_search",
    max_uses: WEB_SEARCH_MAX_USES,
  };
}

// Phase 2 — a CLIENT-side custom tool WE execute (fetchpage.ts), so live-page reads go through the
// canonical SSRF guard + robots + redaction. Deliberately NOT Anthropic's server-side web_fetch,
// which would bypass those. Gated behind FLAG_REDTAPE_FETCH so main stays deployable and the
// live-.gov-fetch behavior is turned on deliberately in prod.
const FETCH_TOOL = {
  name: "fetch_public_page",
  description:
    "Fetch a PUBLIC federal .gov page — a site's privacy policy, or an agency PIA/SORN inventory page — and return its visible text, PII-redacted. Read-only. Never returns anything behind a login/access wall: a gated page comes back as {gated:true} (it exists; do not treat its contents as read).",
  input_schema: {
    type: "object" as const,
    properties: { url: { type: "string", description: "the public .gov page URL to read" } },
    required: ["url"],
  },
};

// A minimal shape for the Anthropic Messages content blocks we care about.
interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: { query?: string; agency?: string; url?: string };
}

/**
 * Real researcher backed by the Anthropic Messages API with TOOL USE: the model actually
 * queries the Federal Register (search_federal_register -> searchSorns) in a loop before it
 * concludes, so the documented negative is a real re-checkable search, not a hallucination.
 * Model-agnostic (DAYLIGHT_REDTAPE_MODEL; Sonnet 5 by default). Not invoked in CI (tests inject
 * a mock); requires ANTHROPIC_API_KEY. The pipeline + human gate never depend on it concretely.
 */
export function claudeResearcher(
  opts: {
    apiKey?: string;
    model?: string;
    maxTurns?: number;
    search?: (query: string, agency?: string) => Promise<SornRef[]>;
    fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
    fetchPage?: (url: string) => Promise<FetchPageResult>;
    enablePageFetch?: boolean; // overrides FLAG_REDTAPE_FETCH (tests inject the tool without the env)
  } = {},
): Researcher {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
  const model = opts.model ?? process.env.DAYLIGHT_REDTAPE_MODEL ?? "claude-sonnet-5";
  const maxTurns = opts.maxTurns ?? 8; // web_search adds turns beyond the Federal Register pass
  const search = opts.search ?? ((q: string, agency?: string) => searchSorns(q, agency ? { agency } : {}));
  const doFetch = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const fetchPage = opts.fetchPage ?? ((url: string) => fetchPublicPage(url));
  const pageFetchEnabled = opts.enablePageFetch ?? flag("FLAG_REDTAPE_FETCH");

  const textOf = (blocks: ContentBlock[]): string =>
    blocks.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n");

  return async (input: ResearcherInput): Promise<string> => {
    if (!apiKey) throw new Error("Redtape researcher needs ANTHROPIC_API_KEY (agent is deferred)");
    const messages: { role: "user" | "assistant"; content: unknown }[] = [
      { role: "user", content: buildUserInput(input) },
    ];
    // Cached system prompt (stable across candidates + turns) — prompt caching charges it once
    // per ~5-min window rather than on every request.
    const system = [{ type: "text", text: SYSTEM_INSTRUCTIONS, cache_control: { type: "ephemeral" } }];
    // Deterministic tool list (stable across turns → preserves the cache prefix): the client-side
    // Federal Register tool, Anthropic's server-side web search, and — when enabled — the guarded
    // client-side page fetcher.
    const tools = pageFetchEnabled
      ? [FR_TOOL, webSearchTool(model), FETCH_TOOL]
      : [FR_TOOL, webSearchTool(model)];

    for (let turn = 0; turn < maxTurns; turn++) {
      // Incremental cache: keep ONE moving breakpoint at the end of the (now-stable) message
      // prefix so the growing tool-result conversation is read from cache next turn. Anthropic
      // allows at most 4 cache_control blocks per request, so we must CLEAR the prior turn's
      // breakpoint before setting the new one — otherwise a long run (system + one per turn)
      // exceeds 4 and the API 400s, which silently killed assessments of well-documented
      // agencies (the ones that need the most search turns). system[] holds the other breakpoint.
      for (const m of messages) {
        if (Array.isArray(m.content)) {
          for (const b of m.content as Record<string, unknown>[]) delete b.cache_control;
        }
      }
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && Array.isArray(lastMsg.content) && lastMsg.content.length > 0) {
        const blocks = lastMsg.content as Record<string, unknown>[];
        blocks[blocks.length - 1]!.cache_control = { type: "ephemeral" };
      }
      const res = await doFetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        // 8000: the final answer packs pia/sorn refs + a full query trail (now Federal Register AND
        // web_search) + fact-vs-inference notes into one JSON object, and server-side web_search
        // results are returned inline. 2000 truncated it on well-documented agencies (long trails),
        // producing unparseable output that fell back to a useless "manual" gap.
        body: JSON.stringify({ model, max_tokens: 8000, system, tools, messages }),
      });
      if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
      const data = (await res.json()) as { content?: ContentBlock[]; stop_reason?: string };
      const content = data.content ?? [];
      messages.push({ role: "assistant", content });

      // Only CLIENT-side tools appear as `tool_use` and need a tool_result from us. Server-side
      // web_search is executed on Anthropic's infra and comes back as server_tool_use +
      // web_search_tool_result blocks (different types), so it never enters this branch.
      const toolUses = content.filter((b) => b.type === "tool_use");
      if (data.stop_reason === "tool_use" && toolUses.length > 0) {
        const toolResults = [];
        for (const tu of toolUses) {
          if (tu.name === "search_federal_register") {
            const q = tu.input?.query ?? "";
            const refs = q ? await search(q, tu.input?.agency) : [];
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify(refs.slice(0, 15)),
            });
          } else if (tu.name === "fetch_public_page") {
            const u = tu.input?.url ?? "";
            const result: FetchPageResult = u
              ? await fetchPage(u)
              : { ok: false, url: "", note: "no url provided" };
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              content: JSON.stringify(result),
            });
          } else {
            // Unknown client tool — return an error result rather than dropping it. Leaving a
            // tool_use unanswered makes the next request 400.
            toolResults.push({
              type: "tool_result",
              tool_use_id: tu.id,
              is_error: true,
              content: `unsupported tool: ${tu.name ?? "(unnamed)"}`,
            });
          }
        }
        messages.push({ role: "user", content: toolResults });
        continue;
      }
      // Server-side web_search runs its own bounded loop; if it hit the per-turn iteration cap the
      // model returns pause_turn. Re-send (messages already carries the assistant turn) so the
      // server resumes — do NOT append a "continue" message; the API detects the trailing
      // server_tool_use and picks up where it left off.
      if (data.stop_reason === "pause_turn") continue;
      return textOf(content); // model concluded — its final JSON
    }
    // Exhausted the search budget without a conclusion → return last text (parse will route to manual).
    const last = messages[messages.length - 1];
    return last && Array.isArray(last.content) ? textOf(last.content as ContentBlock[]) : "";
  };
}
