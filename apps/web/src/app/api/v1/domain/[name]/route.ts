import { composite } from "@/lib/ledger";
import { apiError, apiJson, apiOptions } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

// The full per-domain composite. Redtape (`gaps`) is served strictly via the human-gated
// publicGaps() inside composite() — an unreviewed gap can never appear here.
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  const { name } = await params;
  try {
    // The App Router already decodes the param; a second decode throws on a bare '%'. Decode
    // defensively (inside the try) so a malformed value returns the JSON envelope, not a raw 500.
    let domain = name;
    try {
      domain = decodeURIComponent(name);
    } catch {
      /* already decoded / malformed — use the raw param */
    }
    return apiJson(composite(domain.trim().toLowerCase()));
  } catch {
    return apiError("domain unavailable", 500);
  }
}
