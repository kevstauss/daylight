import { timingSafeEqual } from "node:crypto";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { GapRow } from "@/lib/data";
import { reviewGap, reviewQueue, reviewedGaps, reopenGapForRevision } from "@/lib/data";
import { Eyebrow, Panel } from "@/components/ui";

export const metadata: Metadata = { title: "Review queue", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const COOKIE = "daylight_review";

function reviewSecret(): string {
  return process.env.DAYLIGHT_REVIEW_TOKEN?.trim() || "";
}

/** Constant-time token check against DAYLIGHT_REVIEW_TOKEN. */
function tokenOk(provided: string): boolean {
  const secret = reviewSecret();
  if (!secret || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Auth from an HttpOnly cookie — never from the URL, so the token can't leak via logs/Referer. */
async function authed(): Promise<boolean> {
  const store = await cookies();
  return tokenOk(store.get(COOKIE)?.value ?? "");
}

const parse = (json: string | null): string[] => {
  try {
    return JSON.parse(json ?? "[]") as string[];
  } catch {
    return [];
  }
};

async function login(formData: FormData): Promise<void> {
  "use server";
  const token = String(formData.get("token") ?? "");
  if (tokenOk(token)) {
    const store = await cookies();
    store.set(COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      // "lax" (not "strict") + path "/" so the cookie is sent on the Server Action POST a review
      // button triggers. With "strict"/path "/review", some browsers withheld the cookie on that
      // POST, so authed() failed and the review silently no-op'd (the item flashed away on the
      // client re-render but nothing was written). "lax" still blocks cross-site sends.
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 8,
    });
  }
  redirect("/review");
}

async function logout(): Promise<void> {
  "use server";
  (await cookies()).delete({ name: COOKIE, path: "/" });
  redirect("/review");
}

async function actReview(formData: FormData): Promise<void> {
  "use server";
  // If the session lapsed, bounce to the login screen rather than silently doing nothing — a
  // silent no-op made a click look successful (the item flashed away on re-render) while nothing
  // was written. Landing back on /review shows the login form, which is the honest signal.
  if (!(await authed())) redirect("/review");
  const id = Number(formData.get("id"));
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  if (!Number.isFinite(id) || !["publish", "hold", "reject"].includes(decision)) return;
  // publish → public; hold/reject → reviewed but withheld. All leave the queue.
  reviewGap(id, { published: decision === "publish", reviewerNote: note });
  revalidatePath("/review");
}

async function actReopen(formData: FormData): Promise<void> {
  "use server";
  if (!(await authed())) redirect("/review");
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id)) return;
  reopenGapForRevision(id);
  revalidatePath("/review");
}

export default async function ReviewPage() {
  if (!reviewSecret()) notFound(); // feature disabled unless a token is configured

  if (!(await authed())) {
    return (
      <div className="max-w-sm space-y-4">
        <Eyebrow>redtape · internal review</Eyebrow>
        <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
        <p className="text-sm text-muted">Reviewer access only.</p>
        <form action={login} className="space-y-2">
          <input
            type="password"
            name="token"
            autoComplete="off"
            placeholder="Review token"
            className="w-full rounded border border-edge bg-panel px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-accent"
          />
          <button
            type="submit"
            className="rounded border border-edgeStrong bg-panel px-4 py-2 font-mono text-xs text-ink transition-colors hover:border-ink"
          >
            Enter →
          </button>
        </form>
      </div>
    );
  }

  const queue = safe(() => reviewQueue(200), [] as GapRow[]);
  const reviewed = safe(() => reviewedGaps(30), [] as GapRow[]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
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
        <form action={logout}>
          <button type="submit" className="font-mono text-xs text-faint hover:text-ink">
            sign out
          </button>
        </form>
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
                <textarea
                  name="note"
                  rows={2}
                  placeholder="Reviewer note (why, and what to fix)…"
                  className="w-full rounded border border-edge bg-panel px-2 py-1.5 text-xs text-ink placeholder:text-faint focus:border-accent"
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

      {reviewed.length > 0 ? (
        <div className="space-y-3 border-t border-edge pt-6">
          <div>
            <Eyebrow>reviewed</Eyebrow>
            <h2 className="text-lg font-semibold tracking-tight">Recently reviewed</h2>
            <p className="mt-1 max-w-measure text-sm text-muted">
              Your last decisions. <span className="font-mono">Published</span> items are live on{" "}
              <span className="font-mono">/redtape</span>; held/rejected ones stay private. Return
              any to the queue to revise — re-opening a published item logs a public correction.
            </p>
          </div>
          <div className="space-y-2">
            {reviewed.map((g) => (
              <Panel key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="font-mono text-sm text-ink">{g.domain}</span>
                <span className="rounded-sm border border-edgeStrong px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted">
                  {g.gap_assessment ?? "?"}
                </span>
                <span className={`font-mono text-xs ${g.published ? "text-calm" : "text-faint"}`}>
                  {g.published ? "published" : "withheld"}
                </span>
                {g.reviewer_note ? (
                  <span className="w-full text-xs text-muted sm:w-auto sm:flex-1">
                    &ldquo;{g.reviewer_note}&rdquo;
                  </span>
                ) : null}
                <form action={actReopen} className="ml-auto">
                  <input type="hidden" name="id" value={g.id} />
                  <button type="submit" className="font-mono text-xs text-faint hover:text-ink">
                    return to queue →
                  </button>
                </form>
              </Panel>
            ))}
          </div>
        </div>
      ) : null}
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
