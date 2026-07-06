import type { MetadataRoute } from "next";
import { absolute } from "@/lib/seo";
import { allChangeStamps, allDomainRows, allSubdomainRows } from "@/lib/data";
import { flags } from "@/lib/flags";

// A single dynamic sitemap served at /sitemap.xml. Rendered per request against the live DB (which
// in prod is a Fly volume separate from the build image), so a newly-registered .gov or a fresh
// change is discoverable the same day. NOTE: we deliberately do NOT use generateSitemaps() — it
// enumerates children at BUILD time, which would bake in the build-time (often empty) DB snapshot.
export const dynamic = "force-dynamic";

// Google caps one sitemap at 50k URLs. We're ~13k today and grow slowly, but stay comfortably under
// the cap defensively: static routes + every domain + subdomains first, then fill the remaining
// budget with the NEWEST change permalinks. Any change beyond the cap is still reachable via the
// per-domain history pages and the feeds/API — it just isn't listed here.
const MAX_URLS = 45_000;

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export default function sitemap(): MetadataRoute.Sitemap {
  const f = flags();
  const entries: MetadataRoute.Sitemap = [
    { url: absolute("/"), lastModified: new Date(), changeFrequency: "hourly", priority: 1 },
    { url: absolute("/methods"), changeFrequency: "monthly", priority: 0.7 },
    { url: absolute("/faq"), changeFrequency: "monthly", priority: 0.7 },
    { url: absolute("/watchlist"), changeFrequency: "weekly", priority: 0.5 },
    { url: absolute("/compare"), changeFrequency: "monthly", priority: 0.4 },
    { url: absolute("/corrections"), changeFrequency: "weekly", priority: 0.5 },
    { url: absolute("/changelog"), changeFrequency: "weekly", priority: 0.4 },
    { url: absolute("/privacy"), changeFrequency: "monthly", priority: 0.4 },
    { url: absolute("/status"), changeFrequency: "daily", priority: 0.3 },
  ];

  // Module landing pages — only when their flag is on (an off module 404s).
  if (f.registry) {
    entries.push({ url: absolute("/registry"), changeFrequency: "daily", priority: 0.9 });
    entries.push({ url: absolute("/ledger"), changeFrequency: "daily", priority: 0.8 });
  }
  if (f.lookout) entries.push({ url: absolute("/lookout"), changeFrequency: "daily", priority: 0.7 });
  if (f.floodlight) entries.push({ url: absolute("/floodlight"), changeFrequency: "weekly", priority: 0.7 });
  if (f.floodlightScan) entries.push({ url: absolute("/floodlight/scan"), changeFrequency: "monthly", priority: 0.5 });
  if (f.receipts) entries.push({ url: absolute("/receipts"), changeFrequency: "weekly", priority: 0.7 });
  if (f.redtape) entries.push({ url: absolute("/redtape"), changeFrequency: "weekly", priority: 0.7 });
  if (f.foundry) entries.push({ url: absolute("/foundry"), changeFrequency: "weekly", priority: 0.6 });

  // Every apex domain page (~1,300). lastModified = last time we saw the registry row.
  for (const d of safe(() => allDomainRows(), [])) {
    entries.push({
      url: absolute(`/domain/${d.domain}`),
      lastModified: d.last_seen || d.first_seen,
      changeFrequency: "weekly",
      priority: 0.6,
    });
  }

  // Known subdomains resolve at /domain/{fqdn} too — only surface them when Lookout is on.
  if (f.lookout) {
    for (const s of safe(() => allSubdomainRows(), [])) {
      entries.push({
        url: absolute(`/domain/${s.fqdn}`),
        lastModified: s.last_seen || s.first_seen,
        changeFrequency: "monthly",
        priority: 0.4,
      });
    }
  }

  // Fill the remaining URL budget with the newest change permalinks (allChangeStamps is id-desc).
  const budget = Math.max(0, MAX_URLS - entries.length);
  for (const c of safe(() => allChangeStamps(), []).slice(0, budget)) {
    entries.push({
      url: absolute(`/change/${c.id}`),
      lastModified: c.detected_at,
      changeFrequency: "yearly",
      priority: 0.3,
    });
  }

  return entries;
}
