import { FUNDING_URL } from "@/lib/site";

/** A restrained, site-wide support callout. Renders nothing unless a funding URL is configured
 *  (DAYLIGHT_FUNDING_URL), so it never shows a dead ask. Gentle accent tint — present, not loud,
 *  in keeping with the institutional look. Sits just above the footer on every page. */
export function SupportBanner() {
  if (!FUNDING_URL) return null;
  return (
    <aside
      aria-label="Support Daylight"
      className="mt-2 rounded-sm border border-accent/30 bg-accent/[0.05] px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <p className="max-w-measure text-[13px] leading-snug text-muted">
          <strong className="font-semibold text-ink">Daylight is reader-supported.</strong> It runs
          on one small always-on server and takes no ads, grants, or trackers — support keeps it
          independent and online.
        </p>
        <a
          href={FUNDING_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-sm border border-accent/40 bg-accent/[0.08] px-3 py-1.5 font-mono text-xs text-accent transition-colors hover:bg-accent/15 hover:text-accent"
        >
          Support Daylight →
        </a>
      </div>
    </aside>
  );
}
