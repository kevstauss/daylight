import { renderRss } from "@daylight/feeds";
import { lookoutChanges, toFeedEntries, type ChangeRow } from "@/lib/data";
import { flags } from "@/lib/flags";
import { originFromRequest, SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";

const SEVERITIES = new Set(["high", "notable", "info"]);

export function GET(req: Request): Response {
  if (!flags().lookout) return new Response("Not found", { status: 404 });
  const origin = originFromRequest(req);
  const sevParam = new URL(req.url).searchParams.get("severity") ?? undefined;
  const severity = sevParam && SEVERITIES.has(sevParam) ? sevParam : undefined;

  let rows: ChangeRow[] = [];
  try {
    rows = lookoutChanges({ severity, limit: 100 });
  } catch {
    rows = [];
  }
  const xml = renderRss(toFeedEntries(rows), {
    title: `${SITE_NAME} — new subdomains${severity ? ` (${severity})` : ""}`,
    description:
      "New .gov subdomains as they appear in public Certificate Transparency logs, flagged and enriched with the apex owner.",
    siteUrl: origin,
    feedUrl: `${origin}/lookout/feed.xml${severity ? `?severity=${severity}` : ""}`,
  });
  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
