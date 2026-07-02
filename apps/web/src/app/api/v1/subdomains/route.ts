import { searchSubdomains } from "@/lib/data";
import { apiError, apiJson, apiOptions, limitOf, severityOf } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export function GET(req: Request): Response {
  const sp = new URL(req.url).searchParams;
  try {
    const subdomains = searchSubdomains({
      q: sp.get("q") ?? undefined,
      severity: severityOf(sp),
      limit: limitOf(sp, 200, 1000),
    });
    return apiJson({ count: subdomains.length, subdomains });
  } catch {
    return apiError("subdomains unavailable", 500);
  }
}
