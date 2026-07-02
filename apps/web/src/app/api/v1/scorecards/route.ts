import { floodlightScorecards } from "@/lib/data";
import { apiError, apiJson, apiOptions, limitOf, severityOf } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export function GET(req: Request): Response {
  const sp = new URL(req.url).searchParams;
  try {
    const scorecards = floodlightScorecards({ severity: severityOf(sp), limit: limitOf(sp) });
    return apiJson({ count: scorecards.length, scorecards });
  } catch {
    return apiError("scorecards unavailable", 500);
  }
}
