import Link from "next/link";
import type { ReactNode } from "react";

/** Severity pill — sober, color-coded on observed facts (PRD §13). */
export function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    high: { label: "high", cls: "border-alarm/50 text-alarm" },
    notable: { label: "notable", cls: "border-signal/50 text-signal" },
    info: { label: "info", cls: "border-calm/40 text-calm" },
  };
  const s = map[severity] ?? map.info!;
  return (
    <span
      className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wide ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

/** Monospace UTC timestamp — every card carries "last checked {when}". */
export function Timestamp({ iso, prefix }: { iso: string | null; prefix?: string }) {
  if (!iso) return <span className="font-mono text-xs text-faint">—</span>;
  const d = new Date(iso);
  const text = Number.isNaN(d.getTime()) ? iso : d.toISOString().replace(".000Z", "Z");
  return (
    <time dateTime={iso} className="font-mono text-xs text-faint" title={iso}>
      {prefix ? `${prefix} ` : ""}
      {text}
    </time>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-edge bg-panel ${className ?? ""}`}>{children}</div>
  );
}

export function SourceLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-signal underline underline-offset-2 hover:text-ink"
    >
      {children}
    </a>
  );
}

export function InternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-signal underline underline-offset-2 hover:text-ink">
      {children}
    </Link>
  );
}

/** Graceful empty state — early phases must not look broken (PRD §4.1). */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-edge bg-panel/50 px-5 py-8 text-center">
      <p className="text-sm text-muted">{title}</p>
      {hint ? <p className="mt-1 text-xs text-faint">{hint}</p> : null}
    </div>
  );
}
