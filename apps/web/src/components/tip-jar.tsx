import { KOFI_USERNAME, TIP_PRESETS, kofiUrl } from "@/lib/site";

/** Inline Ko-fi tip picker. Deliberately self-hosted markup — no third-party script, iframe, or
 *  image: the strict per-request CSP (`middleware.ts`) blocks all three, and putting a tracker on
 *  the one site whose whole job is naming trackers would be self-defeating. Each preset is a plain
 *  link that deep-links a prefilled amount on Ko-fi, so the visitor picks a size here and the only
 *  off-site hop is Ko-fi's checkout (it has to process the payment). "Custom" opens the plain tip
 *  page so they can choose their own amount. Renders nothing when the handle is blanked
 *  (DAYLIGHT_KOFI=""), keeping the "renders cleanly with no ask" invariant. */
export function TipJar({ className = "" }: { className?: string }) {
  if (!KOFI_USERNAME) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {TIP_PRESETS.map((amount) => (
        <a
          key={amount}
          href={kofiUrl(amount)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-sm border border-accent/40 bg-accent/[0.08] px-2.5 py-1 font-mono text-xs text-accent no-underline transition-colors hover:bg-accent/15"
        >
          ${amount}
        </a>
      ))}
      <a
        href={kofiUrl()}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded-sm px-2 py-1 font-mono text-xs text-muted underline decoration-edgeStrong underline-offset-4 transition-colors hover:text-accent"
      >
        Custom
      </a>
      <span className="font-mono text-[11px] text-muted/80">via Ko-fi&nbsp;↗</span>
    </div>
  );
}
