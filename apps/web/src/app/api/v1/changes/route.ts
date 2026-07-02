import { listChangesFiltered } from "@/lib/data";
import { apiError, apiJson, apiOptions, flagOf, limitOf, severityOf } from "@/lib/api";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export function GET(req: Request): Response {
  const sp = new URL(req.url).searchParams;
  const module = sp.get("module") ?? undefined;
  const since = sp.get("since") ?? undefined;
  try {
    const changes = listChangesFiltered({
      module: module && module !== "all" ? module : undefined,
      severity: severityOf(sp),
      flag: flagOf(sp),
      since,
      limit: limitOf(sp),
    });
    return apiJson({ count: changes.length, changes });
  } catch {
    return apiError("changes unavailable", 500);
  }
}
