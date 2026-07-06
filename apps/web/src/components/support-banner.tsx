import { KOFI_USERNAME } from "@/lib/site";
import { TipJar } from "@/components/tip-jar";

/** A restrained, site-wide support callout. Renders nothing unless a Ko-fi handle is configured
 *  (it is by default; blank DAYLIGHT_KOFI to hide), so it never shows a dead ask. Neutral "Support"
 *  framing with the tip picker as the action — present, not loud, in keeping with the institutional
 *  look. Sits just above the footer on every page. */
export function SupportBanner() {
  if (!KOFI_USERNAME) return null;
  return (
    <aside
      aria-label="Support Daylight"
      className="mt-2 rounded-sm border border-accent/30 bg-accent/[0.05] px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5">
        <p className="max-w-measure text-[13px] leading-snug text-muted">
          <strong className="font-semibold text-ink">Daylight is reader-supported.</strong> It runs
          on one small always-on server and takes no ads, grants, or trackers — a tip keeps it
          independent and online.
        </p>
        <TipJar className="shrink-0" />
      </div>
    </aside>
  );
}
