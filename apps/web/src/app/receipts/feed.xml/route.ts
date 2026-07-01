import { renderRss } from "@daylight/feeds";
import { receiptsChanges, toFeedEntries, type ChangeRow } from "@/lib/data";
import { flags } from "@/lib/flags";
import { originFromRequest, SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";

const SEVERITIES = new Set(["high", "notable", "info"]);

export function GET(req: Request): Response {
  if (!flags().receipts) return new Response("Not found", { status: 404 });
  const origin = originFromRequest(req);
  const sevParam = new URL(req.url).searchParams.get("severity") ?? undefined;
  const severity = sevParam && SEVERITIES.has(sevParam) ? sevParam : undefined;

  let rows: ChangeRow[] = [];
  try {
    rows = receiptsChanges({ severity, limit: 100 });
  } catch {
    rows = [];
  }
  const xml = renderRss(toFeedEntries(rows), {
    title: `${SITE_NAME} — removals & page changes${severity ? ` (${severity})` : ""}`,
    description:
      "What watched .gov pages quietly removed — trackers, privacy notices, agency seals — dated, with an independent archived copy.",
    siteUrl: origin,
    feedUrl: `${origin}/receipts/feed.xml${severity ? `?severity=${severity}` : ""}`,
  });
  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
