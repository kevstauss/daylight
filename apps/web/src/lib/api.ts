// Shared helpers for the public read-only JSON API (/api/v1/*). Open CORS, capped limits, and a
// consistent envelope. Everything here is a presentation layer over the same lib/data.ts readers
// the site uses — Redtape strictly through the human-gated publicGaps().

import { FLAG_TYPES, type FlagKind } from "@daylight/core";

const CORS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "cache-control": "public, max-age=60",
} as const;

export function apiJson(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), { status, headers: CORS });
}

export function apiError(message: string, status = 400): Response {
  return apiJson({ error: message }, status);
}

/** CORS preflight — every route re-exports this as OPTIONS. */
export function apiOptions(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export function limitOf(sp: URLSearchParams, def = 100, max = 1000): number {
  const v = Number(sp.get("limit"));
  return Number.isFinite(v) && v > 0 ? Math.floor(Math.min(v, max)) : def;
}

const VALID_FLAGS = new Set<string>(FLAG_TYPES.map((f) => f.kind));
export function flagOf(sp: URLSearchParams): FlagKind | undefined {
  const v = sp.get("flag") ?? "";
  return VALID_FLAGS.has(v) ? (v as FlagKind) : undefined;
}

export function severityOf(sp: URLSearchParams): string | undefined {
  const v = sp.get("severity") ?? "";
  return ["high", "notable", "info"].includes(v) ? v : undefined;
}
