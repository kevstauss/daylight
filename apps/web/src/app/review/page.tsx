import { timingSafeEqual } from "node:crypto";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { GapRow } from "@/lib/data";
import { reviewGap, reviewQueue } from "@/lib/data";
import { Eyebrow, Panel } from "@/components/ui";

export const metadata: Metadata = { title: "Review queue", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Constant-time token check. If DAYLIGHT_REVIEW_TOKEN is unset, the queue does not exist. */
function tokenOk(provided: string): boolean {
  const secret = process.env.DAYLIGHT_REVIEW_TOKEN?.trim() || "";
  if (!secret || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const str = (v: string | string[] | undefined): string => (Array.isArray(v) ? v[0] : v) ?? "";
const parse = (json: string | null): string[] => {
  try {
    return JSON.parse(json ?? "[]") as string[];
  } catch {
    return [];
  }
};

async function actReview(formData: FormData): Promise<void> {
  "use server";
  if (!tokenOk(String(formData.get("token") ?? ""))) return; // silent no-op on bad token
  const id = Number(formData.get("id"));
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!Number.isFinite(id) || !["publish", "hold", "reject"].includes(decision)) return;
  // publish → public; hold/reject → reviewed but withheld. All leave the queue.
  reviewGap(id, { published: decision === "publish", reviewerNote: note });
  revalidatePath("/review");
}

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const token = str(sp.token);
  if (!tokenOk(token)) notFound();

  const queue = safe(() => reviewQueue(200), [] as GapRow[]);

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>redtape · internal review</Eyebrow>
        <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
        <p className="mt-1 max-w-measure text-sm text-muted">
          Agent-generated filing assessments awaiting a human decision. Nothing here is public.
          Only <span className="font-mono">Publish</span> makes an item visible on{" "}
          <span className="font-mono">/redtape</span> — the gate is enforced in the data layer,
          not just this screen. Read the evidence and the search trail before deciding.
        </p>
      </div>

      {queue.length === 0 ? (
        <Panel className="px-4 py-6">
          <p className="text-sm text-muted">The queue is empty. Nothing awaiting review.</p>
        </Panel>
      ) : (
        <div className="space-y-4">
          {queue.map((g) => (
            <Panel key={g.id} className="px-4 py-4">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-sm text-ink">{g.domain}</span>
                <span className="rounded-sm border border-edgeStrong px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted">
                  {g.gap_assessment ?? "?"}
                </span>
                {g.confidence != null ? (
                  <span className="font-mono text-xs text-faint">confidence {g.confidence}</span>
                ) : null}
              </div>
              {g.fact_vs_inference_notes ? (
                <p className="mt-1.5 text-sm text-muted">{g.fact_vs_inference_notes}</p>
              ) : null}
              <Trail label="Collection evidence" items={parse(g.collects_pii_evidence_json)} />
              <Trail label="Searches run" items={parse(g.queries_run_json)} mono />
              <Trail label="Sources checked" items={parse(g.sources_checked_json)} mono />
              <Trail label="SORN refs" items={parse(g.sorn_refs_json)} mono />

              <form action={actReview} className="mt-3 space-y-2 border-t border-edge pt-3">
                <input type="hidden" name="id" value={g.id} />
                <input type="hidden" name="token" value={token} />
                <textarea
                  name="note"
                  rows={2}
                  placeholder="Reviewer note (why, and what to fix)…"
                  className="w-full rounded border border-edge bg-panel px-2 py-1.5 text-xs text-ink placeholder:text-faint focus:border-accent focus:outline-none"
                />
                <div className="flex flex-wrap gap-2 font-mono text-xs">
                  <button
                    type="submit"
                    name="decision"
                    value="publish"
                    className="rounded border border-calm/60 px-3 py-1 text-calm transition-colors hover:border-calm"
                  >
                    Publish
                  </button>
                  <button
                    type="submit"
                    name="decision"
                    value="hold"
                    className="rounded border border-edgeStrong px-3 py-1 text-muted transition-colors hover:border-ink hover:text-ink"
                  >
                    Hold (reviewed, keep private)
                  </button>
                  <button
                    type="submit"
                    name="decision"
                    value="reject"
                    className="rounded border border-alarm/60 px-3 py-1 text-alarm transition-colors hover:border-alarm"
                  >
                    Reject
                  </button>
                </div>
              </form>
            </Panel>
          ))}
        </div>
      )}
    </div>
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
