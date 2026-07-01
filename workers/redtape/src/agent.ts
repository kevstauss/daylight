import type { Researcher, ResearcherInput, ResearcherOutput } from "./types.js";

export const PROMPT_VERSION = "redtape/2026-07-01";

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
    "You are a compliance research assistant. Determine whether the federal .gov site below",
    "has a published Privacy Impact Assessment (E-Gov Act §208) and/or System of Records",
    "Notice (Privacy Act) covering the PII collection observed. Search the Federal Register",
    "and agency PIA inventories. Return JSON ONLY (no prose, no markdown fences) with keys:",
    "pia_found, pia_refs[], sorn_found, sorn_refs[], gap_assessment (no_filing|incomplete_filing|covered),",
    "confidence (0..1), queries_run[], sources_checked[], fact_vs_inference_notes.",
    "Label every claim fact vs inference. If you find no filing, say so and list the exact",
    "queries you ran and sources you checked so the negative is independently checkable.",
    "",
    `domain: ${input.domain}`,
    `url: ${input.url ?? "(none)"}`,
    `collection evidence: ${JSON.stringify(input.collectsPiiEvidence)}`,
  ].join("\n");
}

/**
 * Real, model-agnostic researcher backed by the Anthropic API (Opus/Sonnet now; Fable
 * swappable via DAYLIGHT_REDTAPE_MODEL). Deferred: not invoked in CI (tests inject a mock)
 * and requires ANTHROPIC_API_KEY. The pipeline + human gate never depend on this concretely.
 */
export function claudeResearcher(opts: { apiKey?: string; model?: string } = {}): Researcher {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";
  const model = opts.model ?? process.env.DAYLIGHT_REDTAPE_MODEL ?? "claude-sonnet-5";
  return async (input: ResearcherInput): Promise<string> => {
    if (!apiKey) throw new Error("Redtape researcher needs ANTHROPIC_API_KEY (agent is deferred)");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1500,
        messages: [{ role: "user", content: buildPrompt(input) }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic API ${res.status}`);
    const data = (await res.json()) as { content?: { text?: string }[] };
    return data.content?.[0]?.text ?? "";
  };
}
