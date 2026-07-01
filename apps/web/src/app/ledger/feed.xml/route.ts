import { renderRss } from "@daylight/feeds";
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
  const xml = renderRss(toFeedEntries(rows), {
    title: `${SITE_NAME} — Ledger changes${suffix}`,
    description:
      "Ownership and security-contact changes across the federal .gov registry (CISA dotgov-data), diffed daily.",
    siteUrl: origin,
    feedUrl: `${origin}/ledger/feed.xml${severity ? `?severity=${severity}` : ""}`,
  });
  return new Response(xml, {
    headers: {
      "content-type": "application/rss+xml; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
