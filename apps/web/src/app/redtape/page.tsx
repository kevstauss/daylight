import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { GapRow } from "@/lib/data";
import { publicGaps } from "@/lib/data";
import { flags } from "@/lib/flags";
import { EmptyState, Panel, SeverityBadge } from "@/components/ui";
import { ModuleIcon } from "@/components/module-icon";

export const metadata: Metadata = { title: "Redtape — filing gaps" };
export const dynamic = "force-dynamic";

const parse = (json: string | null): string[] => {
  try {
    return JSON.parse(json ?? "[]") as string[];
  } catch {
    return [];
  }
};

function assessmentLabel(a: string | null): { text: string; sev: string } {
  switch (a) {
    case "no_filing":
      return { text: "No published PIA/SORN found", sev: "high" };
    case "incomplete_filing":
      return { text: "Filing appears incomplete", sev: "notable" };
    case "covered":
      return { text: "Filing found", sev: "info" };
    default:
      return { text: "Under review", sev: "info" };
  }
}

export default function RedtapePage() {
  if (!flags().redtape) notFound();
  const gaps = safe(() => publicGaps(200), []);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2.5"><ModuleIcon name="redtape" className="h-6 w-6 shrink-0 text-ink" /><h1 className="text-2xl font-semibold tracking-tight">Filing gaps</h1></div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Federal sites that collect personal information are required to publish a Privacy Impact
          Assessment (E-Gov Act §208) and, for a system of records, a System of Records Notice
          (Privacy Act). This page lists sites where, <strong>as of the date shown</strong>, a
          published filing could not be found — with the collection evidence and the exact searches
          run, so anyone can re-check. Every entry here has been <strong>reviewed by a human</strong>{" "}
          before publication. We state what was and wasn&rsquo;t found; we never assert illegality.
        </p>
      </div>

      {gaps.length === 0 ? (
        <EmptyState
          title="No reviewed filing gaps published yet."
          hint="The gap-finder + the human-approval gate are live and tested; nothing agent-generated is ever published without human review. Reviewed items appear here."
        />
      ) : (
        <div className="space-y-3">
          {gaps.map((g: GapRow) => {
            const a = assessmentLabel(g.gap_assessment);
            const date = g.created_at.slice(0, 10);
            return (
              <Panel key={g.id} className="px-4 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={a.sev} />
                  <Link href={`/domain/${encodeURIComponent(g.domain)}`} className="font-mono text-sm text-ink hover:text-alarm">
                    {g.domain}
                  </Link>
                  <span className="text-sm text-muted">— {a.text} as of {date}</span>
                </div>

                {/* The two required filings, broken out. "No PIA AND no SORN" is the strongest
                    finding; "SORN found but no PIA" is why a filing reads as incomplete. */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <FilingLeg name="PIA" found={g.pia_found} />
                  <FilingLeg name="SORN" found={g.sorn_found} />
                </div>

                {g.fact_vs_inference_notes ? (
                  <p className="mt-2 text-sm text-muted">{g.fact_vs_inference_notes}</p>
                ) : null}

                <Trail label="Collection evidence" items={parse(g.collects_pii_evidence_json)} />
                <Trail label="Searches run" items={parse(g.queries_run_json)} mono />
                <Trail label="Sources checked" items={parse(g.sources_checked_json)} mono />
                {parse(g.pia_refs_json).length > 0 ? (
                  <Trail label="PIA references" items={parse(g.pia_refs_json)} mono />
                ) : null}
                {parse(g.sorn_refs_json).length > 0 ? (
                  <Trail label="SORN references" items={parse(g.sorn_refs_json)} mono />
                ) : null}

                {g.reviewer_note ? (
                  <p className="mt-2 border-t border-edge pt-2 text-xs text-faint">
                    Reviewer note: {g.reviewer_note}
                  </p>
                ) : null}
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** One of the two required filings (PIA / SORN), stated as a plain fact. Finding a filing is the
 *  reassuring/"covered" state (calm); a filing not found is neutral, not alarm-colored — the
 *  severity badge above already grades the gap, and the page never asserts illegality. */
function FilingLeg({ name, found }: { name: string; found: number | null }) {
  if (found === 1) {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm border border-calm/50 bg-calm/[0.07] px-2 py-0.5 font-mono text-[11px] text-calm">
        <span aria-hidden>✓</span> {name} published
      </span>
    );
  }
  if (found === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-sm border border-edgeStrong px-2 py-0.5 font-mono text-[11px] text-muted">
        {name} — none found
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-sm border border-edge px-2 py-0.5 font-mono text-[11px] text-faint">
      {name} — not assessed
    </span>
  );
}

function Trail({ label, items, mono }: { label: string; items: string[]; mono?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-2">
      <div className="text-xs uppercase tracking-wide text-faint">{label}</div>
      <ul className={`mt-0.5 list-disc pl-5 text-xs text-muted ${mono ? "font-mono" : ""}`}>
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
