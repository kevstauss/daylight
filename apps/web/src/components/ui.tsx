import Link from "next/link";
import type { ReactNode } from "react";

export { HashChip } from "./hash-chip";

/** Section eyebrow — a module path, e.g. "ledger · ownership". Rendered as an <h2> (visually a
 *  kicker) so screen-reader users get a real heading outline to navigate each page's sections,
 *  not a wall of unlabeled lists below the lone <h1>. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <h2 className="kicker mb-2 flex items-center gap-2">{children}</h2>;
}

/** Severity as an official stamp — oxblood for high, ochre for notable, quiet for info.
 *  Facts, not verdicts: it marks what was observed, never editorializes. */
export function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    high: "border-alarm/55 bg-alarm/[0.07] text-alarm",
    notable: "border-signal/55 bg-signal/[0.06] text-signal",
    info: "border-edgeStrong bg-transparent text-faint",
  };
  const label = severity === "high" || severity === "notable" ? severity : "info";
  // Fixed width so the stamp column is uniform and every row's content (domains, titles)
  // aligns down the left — an audit-ledger look. Used across all the list views.
  return (
    <span
      className={`inline-flex w-[4.5rem] shrink-0 items-center justify-center rounded-sm border px-1 py-[3px] font-mono text-[11px] uppercase leading-none tracking-[0.12em] ${map[label]}`}
    >
      {label}
    </span>
  );
}

/** Minute-precision UTC instant for display — `2026-07-01T16:53Z`. Seconds/ms are noise for this
 *  data. Returns the input unchanged if null or unparseable. The single date-format seam: use this
 *  (or <Timestamp>) everywhere a raw ISO would otherwise be shown. */
export function fmtInstant(iso: string | null): string | null {
  if (!iso) return iso;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16)}Z`;
}

/** A UTC timestamp — mono + tabular so columns line up, with a human-readable aria-label so a
 *  screen reader announces "July 1, 2026, 8:00 AM UTC" instead of spelling out the raw ISO glyph. */
export function Timestamp({ iso, prefix }: { iso: string | null; prefix?: string }) {
  if (!iso) return <span className="font-mono text-xs text-faint tabular-nums">—</span>;
  const d = new Date(iso);
  const valid = !Number.isNaN(d.getTime());
  // The full instant stays in the machine-readable dateTime attr + the human aria-label below.
  const text = fmtInstant(iso) ?? iso;
  const human = valid
    ? `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(d)} UTC`
    : iso;
  return (
    <time
      dateTime={iso}
      className="whitespace-nowrap font-mono text-xs text-faint tabular-nums"
      aria-label={prefix ? `${prefix} ${human}` : human}
    >
      {prefix ? <span aria-hidden="true">{prefix} </span> : null}
      <span aria-hidden="true">{text}</span>
    </time>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-sm border border-edge bg-panel ${className ?? ""}`}>{children}</div>
  );
}

export function SourceLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="link">
      {children}
    </a>
  );
}

/** "source →" — the exact public artifact a change/finding was observed in (commit blob / crt.sh /
 *  wayback). Makes every row one-click re-verifiable. Renders nothing when there's no source. */
export function SourceRef({ href, label }: { href: string | null | undefined; label?: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-mono text-xs text-muted underline decoration-edgeStrong underline-offset-2 hover:text-ink"
    >
      {label ?? "source"} →
    </a>
  );
}

export function InternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="link">
      {children}
    </Link>
  );
}

/** In-page anchor links for a page that stacks more than one long list — the second list is easy
 *  to miss below the first's fold. Pair each link with a section carrying that id + scroll-mt-4
 *  (the /domain answer strip is the original of this pattern). */
export function JumpRow({ links }: { links: { href: string; label: string }[] }) {
  return (
    <nav
      aria-label="Sections on this page"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs"
    >
      <span className="text-faint">on this page:</span>
      {links.map((l) => (
        <a
          key={l.href}
          href={l.href}
          className="text-muted underline decoration-dotted underline-offset-2 hover:text-ink"
        >
          {l.label}
        </a>
      ))}
    </nav>
  );
}

/** Graceful empty state — an invitation, in the interface's voice (never an apology). */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-sm border border-dashed border-edgeStrong bg-panel/60 px-5 py-7">
      <p className="text-sm text-ink">{title}</p>
      {hint ? <p className="mt-1 max-w-measure text-xs leading-relaxed text-faint">{hint}</p> : null}
    </div>
  );
}
