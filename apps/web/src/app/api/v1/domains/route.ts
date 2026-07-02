import { searchRegistry } from "@/lib/data";
import { apiError, apiJson, apiOptions, limitOf } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export function GET(req: Request): Response {
  const sp = new URL(req.url).searchParams;
  try {
    const domains = searchRegistry({
      q: sp.get("q") ?? undefined,
      org: sp.get("org") ?? undefined,
      contact: sp.get("contact") ?? undefined,
      limit: limitOf(sp, 100, 1000),
    });
    return apiJson({ count: domains.length, domains });
  } catch {
    return apiError("domains unavailable", 500);
  }
}
