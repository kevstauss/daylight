import { renderJsonFeed } from "@daylight/feeds";
import { ledgerChanges, toFeedEntries, type ChangeRow } from "@/lib/data";
import { flags } from "@/lib/flags";
import { originFromRequest, SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";

const SEVERITIES = new Set(["high", "notable", "info"]);

export function GET(req: Request): Response {
  if (!flags().feed) return new Response("Not found", { status: 404 });
  const origin = originFromRequest(req);
  const url = new URL(req.url);
  const sevParam = url.searchParams.get("severity") ?? undefined;
  const severity = sevParam && SEVERITIES.has(sevParam) ? sevParam : undefined;

  let rows: ChangeRow[] = [];
  try {
    rows = ledgerChanges({ severity, limit: 100 });
  } catch {
    rows = [];
  }

  const suffix = severity ? ` (${severity})` : "";
  const feed = renderJsonFeed(toFeedEntries(rows), {
    title: `${SITE_NAME} — Ledger changes${suffix}`,
    description:
      "Ownership and security-contact changes across the federal .gov registry (CISA dotgov-data), diffed daily.",
    siteUrl: origin,
    feedUrl: `${origin}/ledger/feed.json${severity ? `?severity=${severity}` : ""}`,
  });
  return Response.json(feed, { headers: { "cache-control": "public, max-age=300" } });
}
