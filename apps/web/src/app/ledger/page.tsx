import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { FLAG_TYPES, type FlagKind, classifyChangeFlag } from "@daylight/core";
import { synthesizeTitle } from "@daylight/feeds";
import { type ChangeRow, ledgerChanges, ledgerFlagCounts } from "@/lib/data";
import { flags } from "@/lib/flags";
import { Eyebrow, InternalLink, Panel, SeverityBadge, Timestamp } from "@/components/ui";
import { LedgerTabs } from "@/components/ledger-tabs";

export const metadata: Metadata = { title: "Ledger activity" };
export const dynamic = "force-dynamic";

const SEVERITIES = [
  { key: "", label: "All severities" },
  { key: "high", label: "High" },
  { key: "notable", label: "Notable" },
  { key: "info", label: "Info" },
];

const FLAG_LABEL = new Map<FlagKind, string>(FLAG_TYPES.map((f) => [f.kind, f.label]));

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");
const isFlag = (v: string): v is FlagKind => FLAG_TYPES.some((f) => f.kind === v);

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  if (!flags().registry) notFound();
  const sp = await searchParams;
  const severity = ["high", "notable", "info"].includes(str(sp.severity)) ? str(sp.severity) : "";
  const flagParam = str(sp.flag);
  const flag: FlagKind | undefined = isFlag(flagParam) ? flagParam : undefined;

  const rows = safe(() => ledgerChanges({ severity: severity || undefined, flag, limit: 200 }), []);
  const counts = safe(
    () => ledgerFlagCounts({ severity: severity || undefined }),
    {} as Record<FlagKind, number>,
  );
  const flagCounts = new Map<FlagKind, number>(FLAG_TYPES.map((ft) => [ft.kind, counts[ft.kind] ?? 0]));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  // Build a filter href preserving the other axis.
  const href = (next: { severity?: string; flag?: string }): string => {
    const s = next.severity ?? severity;
    const fl = next.flag ?? (flag ?? "");
    const qs = new URLSearchParams();
    if (s) qs.set("severity", s);
    if (fl) qs.set("flag", fl);
    const q = qs.toString();
    return q ? `/ledger?${q}` : "/ledger";
  };

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>ledger · activity</Eyebrow>
        <h1 className="text-2xl font-semibold tracking-tight">Ledger activity</h1>
        <p className="mt-1 max-w-measure text-sm text-muted">
          Every ownership and security-contact change across the federal <span className="font-mono">.gov</span>{" "}
          registry, newest first — filter by severity and flag. Each row links to its domain and
          the public source. Neutral observations, dated to the registry commit that made them.
        </p>
      </div>

      <LedgerTabs active="activity" />

      {/* Severity filter */}
      <div className="flex flex-wrap gap-1.5">
        {SEVERITIES.map((s) => (
          <Chip key={s.key || "all"} href={href({ severity: s.key })} active={severity === s.key}>
            {s.label}
          </Chip>
        ))}
      </div>

      {/* Flag filter */}
      <div className="flex flex-wrap gap-1.5">
        <Chip href={href({ flag: "" })} active={!flag}>
          All flags <Count n={total} />
        </Chip>
        {FLAG_TYPES.map((ft) => (
          <Chip key={ft.kind} href={href({ flag: ft.kind })} active={flag === ft.kind} title={ft.blurb}>
            {ft.label} <Count n={flagCounts.get(ft.kind) ?? 0} />
          </Chip>
        ))}
      </div>

      <p className="text-xs text-faint">
        &ldquo;Watchlist hit&rdquo; flags reflect the identities on the{" "}
        <InternalLink href="/watchlist">Watchlist</InternalLink> — curated, and open to suggestions.
      </p>

      {rows.length === 0 ? (
        <Panel className="px-4 py-6">
          <p className="text-sm text-muted">No changes match this filter.</p>
        </Panel>
      ) : (
        <Panel className="divide-y divide-edge">
          {rows.map((c: ChangeRow) => {
            const kind = classifyChangeFlag(c);
            return (
              <div key={c.id} className="flex items-start gap-3 px-4 py-3">
                <SeverityBadge severity={c.severity} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug text-ink">{synthesizeTitle(c)}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <InternalLink href={`/domain/${encodeURIComponent(c.domain)}`}>
                      <span className="font-mono text-xs">{c.domain}</span>
                    </InternalLink>
                    <span className="rounded-sm border border-edge px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-faint">
                      {FLAG_LABEL.get(kind) ?? kind}
                    </span>
                    <Timestamp iso={c.detected_at} />
                  </div>
                </div>
              </div>
            );
          })}
        </Panel>
      )}

      <p className="text-xs text-faint">
        Showing up to 200 most-recent matches. Machine-readable:{" "}
        <InternalLink href="/ledger/feed.xml">/ledger/feed.xml</InternalLink> (append{" "}
        <span className="font-mono">?severity=high</span>).
      </p>
    </div>
  );
}

function Chip({
  href,
  active,
  title,
  children,
}: {
  href: string;
  active: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      title={title}
      className={`rounded-full border px-3 py-1 font-mono text-xs transition-colors ${
        active
          ? "border-ink bg-ink text-panel"
          : "border-edgeStrong text-muted hover:border-ink hover:text-ink"
      }`}
    >
      {children}
    </a>
  );
}

function Count({ n }: { n: number }) {
  return <span className="opacity-60 tabular-nums">{n.toLocaleString()}</span>;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
