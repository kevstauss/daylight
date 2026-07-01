import { searchSorns, type SornRef } from "./federalregister.js";
import type { Researcher, ResearcherInput, ResearcherOutput } from "./types.js";

export const PROMPT_VERSION = "redtape/2026-07-02-tooluse";

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
  };
}

export function buildPrompt(input: ResearcherInput): string {
  return [
    "You are a compliance research assistant for a public, strictly neutral watchdog. Determine",
    "whether the federal .gov site below has a published Privacy Impact Assessment (E-Gov Act §208)",
    "and/or System of Records Notice (Privacy Act) covering the PII collection observed.",
    "",
    "You MUST use the search_federal_register tool to ACTUALLY search — do not rely on memory.",
    "Run SEVERAL targeted queries: the domain, the operating agency, the program/system name, the",
    "specific data collected, and terms like 'System of Records' / 'Privacy Impact Assessment'.",
    "Base your conclusion only on what the tool returns plus clearly-labeled public knowledge.",
    "",
    "Classify: no_filing (nothing covers this collection), incomplete_filing (a filing exists but",
    "omits this specific processor/collection), covered (a filing plainly covers it).",
    "Be neutral and precise; NEVER assert illegality. Label every claim fact vs inference.",
    "",
    "When finished searching, respond with JSON ONLY (no prose, no markdown fences) with keys:",
    "pia_found, pia_refs[], sorn_found, sorn_refs[], gap_assessment (no_filing|incomplete_filing|covered),",
    "confidence (0..1), queries_run[] (the exact searches you ran), sources_checked[] (e.g.",
    "'federalregister.gov/api'), fact_vs_inference_notes. If you find no filing, say so and list the",
    "queries + sources so the negative is independently re-checkable.",
    "",
    `domain: ${input.domain}`,
    `url: ${input.url ?? "(none)"}`,
    `collection evidence: ${JSON.stringify(input.collectsPiiEvidence)}`,
  ].join("\n");
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

// A minimal shape for the Anthropic Messages content blocks we care about.
interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: { query?: string; agency?: string };
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
  } = {},
): Researcher {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
  const model = opts.model ?? process.env.DAYLIGHT_REDTAPE_MODEL ?? "claude-sonnet-5";
  const maxTurns = opts.maxTurns ?? 6;
  const search = opts.search ?? ((q: string, agency?: string) => searchSorns(q, agency ? { agency } : {}));
  const doFetch = opts.fetchImpl ?? ((url, init) => fetch(url, init));

  const textOf = (blocks: ContentBlock[]): string =>
    blocks.filter((b) => b.type === "text" && b.text).map((b) => b.text).join("\n");

  return async (input: ResearcherInput): Promise<string> => {
    if (!apiKey) throw new Error("Redtape researcher needs ANTHROPIC_API_KEY (agent is deferred)");
    const messages: { role: "user" | "assistant"; content: unknown }[] = [
      { role: "user", content: buildPrompt(input) },
    ];

    for (let turn = 0; turn < maxTurns; turn++) {
      const res = await doFetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model, max_tokens: 2000, tools: [FR_TOOL], messages }),
      });
      if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
      const data = (await res.json()) as { content?: ContentBlock[]; stop_reason?: string };
      const content = data.content ?? [];
      messages.push({ role: "assistant", content });

      const toolUses = content.filter((b) => b.type === "tool_use");
      if (data.stop_reason === "tool_use" && toolUses.length > 0) {
        const toolResults = [];
        for (const tu of toolUses) {
          const q = tu.input?.query ?? "";
          const refs = q ? await search(q, tu.input?.agency) : [];
          toolResults.push({
            type: "tool_result",
            tool_use_id: tu.id,
            content: JSON.stringify(refs.slice(0, 15)),
          });
        }
        messages.push({ role: "user", content: toolResults });
        continue;
      }
      return textOf(content); // model concluded — its final JSON
    }
    // Exhausted the search budget without a conclusion → return last text (parse will route to manual).
    const last = messages[messages.length - 1];
    return last && Array.isArray(last.content) ? textOf(last.content as ContentBlock[]) : "";
  };
}
