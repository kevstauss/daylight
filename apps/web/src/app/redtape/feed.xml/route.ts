import { renderRss } from "@daylight/feeds";
import { gapToFeedEntry, publicGaps, type GapRow } from "@/lib/data";
import { flags } from "@/lib/flags";
import { originFromRequest, SITE_NAME } from "@/lib/site";

export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  if (!flags().redtape) return new Response("Not found", { status: 404 });
  const origin = originFromRequest(req);
  let rows: GapRow[] = [];
  try {
    rows = publicGaps(100); // human-gated at the data layer
  } catch {
    rows = [];
  }
  const xml = renderRss(rows.map(gapToFeedEntry), {
    title: `${SITE_NAME} — reviewed filing gaps`,
    description:
      "Human-reviewed PIA/SORN filing gaps: federal sites collecting PII with no published filing found as of the date shown, with the search trail.",
    siteUrl: origin,
    feedUrl: `${origin}/redtape/feed.xml`,
  });
  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
