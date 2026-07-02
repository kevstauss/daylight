import { anyUnhealthy, statusReport } from "@/lib/status";

export const dynamic = "force-dynamic";

// Machine-readable health so an EXTERNAL monitor can watch Daylight itself (a stale-but-green
// status page discovered by a reader is a direct credibility hit). ok=false ⇒ overdue or errored.
export function GET(): Response {
  try {
    const modules = statusReport();
    return Response.json(
      { ok: !anyUnhealthy(modules), modules },
      { headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } },
    );
  } catch {
    return Response.json({ ok: false, error: "status unavailable" }, { status: 500 });
  }
}
