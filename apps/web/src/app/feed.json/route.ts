import { renderJsonFeed } from "@daylight/feeds";
import { globalChanges, toFeedEntries, type ChangeRow } from "@/lib/data";
import { originFromRequest, SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  const origin = originFromRequest(req);
  let rows: ChangeRow[] = [];
  try {
    rows = globalChanges(100);
  } catch {
    rows = [];
  }
  const feed = renderJsonFeed(toFeedEntries(rows), {
    title: `${SITE_NAME} — all changes`,
    description:
      "Every observed change across Daylight's modules — ownership, contacts, and more, on the federal .gov registry.",
    siteUrl: origin,
    feedUrl: `${origin}/feed.json`,
  });
  return Response.json(feed, {
    headers: { "cache-control": "public, max-age=300" },
  });
}
