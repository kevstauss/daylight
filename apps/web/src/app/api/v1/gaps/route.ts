import { publicGaps } from "@/lib/data";
import { apiError, apiJson, apiOptions, limitOf } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

// Redtape's public surface — ONLY human-reviewed + published gaps with a non-empty query/source
// trail (the gate lives in @daylight/db.publicGaps). No path here can bypass it.
export function GET(req: Request): Response {
  const sp = new URL(req.url).searchParams;
  try {
    const gaps = publicGaps(limitOf(sp));
    return apiJson({ count: gaps.length, gaps });
  } catch {
    return apiError("gaps unavailable", 500);
  }
}
