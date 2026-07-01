import { renderJsonFeed } from "@daylight/feeds";
import { floodlightChanges, toFeedEntries, type ChangeRow } from "@/lib/data";
import { flags } from "@/lib/flags";
import { originFromRequest, SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";

const SEVERITIES = new Set(["high", "notable", "info"]);

export function GET(req: Request): Response {
  if (!flags().floodlight) return new Response("Not found", { status: 404 });
  const origin = originFromRequest(req);
  const sevParam = new URL(req.url).searchParams.get("severity") ?? undefined;
  const severity = sevParam && SEVERITIES.has(sevParam) ? sevParam : undefined;

  let rows: ChangeRow[] = [];
  try {
    rows = floodlightChanges({ severity, limit: 100 });
  } catch {
    rows = [];
  }
  const feed = renderJsonFeed(toFeedEntries(rows), {
    title: `${SITE_NAME} — tracker changes${severity ? ` (${severity})` : ""}`,
    description:
      "Trackers added or removed on public .gov pages, plus high-risk scorecards (session replay, reverse-proxy disguise, missing privacy notice).",
    siteUrl: origin,
    feedUrl: `${origin}/floodlight/feed.json${severity ? `?severity=${severity}` : ""}`,
  });
  return Response.json(feed, { headers: { "cache-control": "public, max-age=300" } });
}
