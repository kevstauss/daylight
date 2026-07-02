import type { ReactNode } from "react";

/**
 * A dual-track disclosure: a plain-language lead everyone can read, plus an expandable
 * "the technical version" for a reader who wants the exact mechanism. Uses the native
 * <details>/<summary> element, so it works with no JavaScript and is keyboard- and
 * screen-reader-accessible by default. Reused across /methods, heuristic explanations, the
 * reverse-proxy finding, and Redtape gap copy.
 */
export function PlainTechnical({
  plain,
  technical,
  technicalLabel = "the technical version",
  className,
}: {
  plain: ReactNode;
  technical: ReactNode;
  technicalLabel?: string;
  className?: string;
}) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <div className="text-sm text-muted">{plain}</div>
      <details className="group">
        <summary className="inline-flex min-h-6 cursor-pointer list-none items-center font-mono text-[11px] uppercase tracking-wide text-faint hover:text-ink">
          <span
            className="mr-1 inline-block transition-transform group-open:rotate-90"
            aria-hidden="true"
          >
            ▸
          </span>
          {technicalLabel}
        </summary>
        <div className="mt-1.5 border-l-2 border-edge pl-3 text-sm leading-relaxed text-muted">
          {technical}
        </div>
      </details>
    </div>
  );
}
