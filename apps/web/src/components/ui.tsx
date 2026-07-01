import Link from "next/link";
import type { ReactNode } from "react";

/** Section eyebrow — a module path, e.g. "ledger · ownership". Encodes which part of the
 *  system a section belongs to (the shared observation/change spine is real structure). */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="kicker mb-2 flex items-center gap-2">{children}</div>;
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
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-sm border px-1.5 py-[3px] font-mono text-[10px] uppercase leading-none tracking-[0.12em] ${map[label]}`}
    >
      {label}
    </span>
  );
}

/** A UTC timestamp — always mono, always tabular, so a column of them lines up. */
export function Timestamp({ iso, prefix }: { iso: string | null; prefix?: string }) {
  if (!iso) return <span className="font-mono text-xs text-faint tabular-nums">—</span>;
  const d = new Date(iso);
  const text = Number.isNaN(d.getTime()) ? iso : d.toISOString().replace(".000Z", "Z");
  return (
    <time dateTime={iso} className="font-mono text-xs text-faint tabular-nums" title={iso}>
      {prefix ? <span className="text-faint/70">{prefix} </span> : null}
      {text}
    </time>
  );
}

/** Short content-hash fingerprint chip — the way a CT log / audit trail cites a record. */
export function HashChip({ hash }: { hash: string | null | undefined }) {
  if (!hash) return null;
  return (
    <span className="rounded-sm border border-edge bg-panel px-1 font-mono text-[10px] text-faint" title={hash}>
      {hash.slice(0, 8)}
    </span>
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

export function InternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="link">
      {children}
    </Link>
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
