import { timingSafeEqual } from "node:crypto";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { GapRow } from "@/lib/data";
import { reviewGap, reviewQueue, reviewedGaps, heldGaps, reopenGapForRevision } from "@/lib/data";
import { Eyebrow, Panel } from "@/components/ui";

export const metadata: Metadata = { title: "Review queue", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Bumped from "daylight_review" so any session created before the sameSite=lax / path=/ fix is
// ignored outright — that old cookie was strict + path-scoped, so it was withheld on the review
// action POST (auth failed → Hold/Reject silently no-op'd) and couldn't be cleared cleanly. A new
// name forces one fresh, correct login; the legacy cookie is proactively expired on logout.
const COOKIE = "daylight_review_2";
const LEGACY_COOKIE = "daylight_review";

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
  const store = await cookies();
  // Explicit maxAge:0 expiry (more reliable than .delete()) for the current cookie AND the legacy
  // one at both the new (/) and old (/review) paths, so a stale pre-fix session is fully cleared.
  const expire = (name: string, path: string) =>
    store.set(name, "", {
      path,
      maxAge: 0,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });
  expire(COOKIE, "/");
  expire(LEGACY_COOKIE, "/");
  expire(LEGACY_COOKIE, "/review");
  redirect("/review");
}

// `decision` is BOUND per button (actReview.bind(null, "publish"|"hold"|"reject") on each button's
// formAction — see the forms below), NOT read from formData. A submit button's name/value is not
// reliably included in a React Server Action's FormData, so `formData.get("decision")` came back
// null and every click silently early-returned (disposition undefined). Binding passes the decision
// as a guaranteed first argument; the rest of the fields still travel via formData.
async function actReview(decision: string, formData: FormData): Promise<void> {
  "use server";
  // If the session lapsed, bounce to the login screen rather than silently doing nothing.
  if (!(await authed())) redirect("/review");
  const id = Number(formData.get("id"));
  const note = String(formData.get("note") ?? "").trim() || null;
  // Reviewer reclassification: an assessment override and/or a confidence override. Empty = leave
  // the model's value as-is. The data layer preserves the model's original label in model_assessment.
  const assessment = String(formData.get("assessment") ?? "").trim() || null;
  const confidenceRaw = String(formData.get("confidence") ?? "").trim();
  const confidenceNum = confidenceRaw === "" ? null : Number(confidenceRaw);
  const confidence = confidenceNum !== null && Number.isFinite(confidenceNum) ? confidenceNum : null;
  // Map the bound decision → the canonical disposition the queries use. (heldGaps looks for 'held',
  // NOT the raw button value 'hold' — mismatching them silently drops held items from the section.)
  const DISPOSITION: Record<string, "published" | "held" | "rejected"> = {
    publish: "published",
    hold: "held",
    reject: "rejected",
  };
  const disposition = DISPOSITION[decision];
  if (!Number.isFinite(id) || !disposition) return;
  // publish → public; hold → reviewed, kept private, flagged to revisit; reject → dismissed.
  reviewGap(id, { published: decision === "publish", reviewerNote: note, disposition, assessment, confidence });
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
  const held = safe(() => heldGaps(50), [] as GapRow[]);
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
              <GapEvidence g={g} />

              <form action={actReview.bind(null, "hold")} className="mt-3 space-y-2 border-t border-edge pt-3">
                <input type="hidden" name="id" value={g.id} />
                <textarea
                  name="note"
                  rows={2}
                  placeholder="Reviewer note (why, and what to fix)…"
                  className="w-full rounded border border-edge bg-panel px-2 py-1.5 text-xs text-ink placeholder:text-faint focus:border-accent"
                />
                <Reclassify g={g} />
                <div className="flex flex-wrap gap-2 font-mono text-xs">
                  <button
                    type="submit"
                    formAction={actReview.bind(null, "publish")}
                    className="rounded border border-calm/60 px-3 py-1 text-calm transition-colors hover:border-calm"
                  >
                    Publish
                  </button>
                  <button
                    type="submit"
                    formAction={actReview.bind(null, "hold")}
                    className="rounded border border-edgeStrong px-3 py-1 text-muted transition-colors hover:border-ink hover:text-ink"
                  >
                    Hold (reviewed, keep private)
                  </button>
                  <button
                    type="submit"
                    formAction={actReview.bind(null, "reject")}
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

      {held.length > 0 ? (
        <div className="space-y-3 border-t border-edge pt-6">
          <div>
            <Eyebrow>held · revisit later</Eyebrow>
            <h2 className="text-lg font-semibold tracking-tight text-signal">Held for review</h2>
            <p className="mt-1 max-w-measure text-sm text-muted">
              Reviewed and kept private, flagged to come back to. Update the note and re-decide, or
              send it back to the active queue. Nothing here is public.
            </p>
          </div>
          <div className="space-y-3">
            {held.map((g) => (
              <Panel key={g.id} className="border-l-2 border-signal/60 px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-sm text-ink">{g.domain}</span>
                  <span className="rounded-sm border border-edgeStrong px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted">
                    {g.gap_assessment ?? "?"}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-signal">held</span>
                </div>
                <GapEvidence g={g} />
                <form action={actReview.bind(null, "hold")} className="mt-3 space-y-2 border-t border-edge pt-3">
                  <input type="hidden" name="id" value={g.id} />
                  <textarea
                    name="note"
                    rows={2}
                    defaultValue={g.reviewer_note ?? ""}
                    placeholder="Reviewer note…"
                    className="w-full rounded border border-edge bg-panel px-2 py-1.5 text-xs text-ink placeholder:text-faint focus:border-accent"
                  />
                  <Reclassify g={g} />
                  <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                    <button type="submit" formAction={actReview.bind(null, "publish")} className="rounded border border-calm/60 px-3 py-1 text-calm transition-colors hover:border-calm">
                      Publish
                    </button>
                    <button type="submit" formAction={actReview.bind(null, "hold")} className="rounded border border-signal/60 px-3 py-1 text-signal transition-colors hover:border-signal">
                      Keep on hold
                    </button>
                    <button type="submit" formAction={actReview.bind(null, "reject")} className="rounded border border-alarm/60 px-3 py-1 text-alarm transition-colors hover:border-alarm">
                      Reject
                    </button>
                  </div>
                </form>
                <form action={actReopen} className="mt-1.5">
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

      {reviewed.length > 0 ? (
        <div className="space-y-3 border-t border-edge pt-6">
          <div>
            <Eyebrow>reviewed</Eyebrow>
            <h2 className="text-lg font-semibold tracking-tight">Recently reviewed</h2>
            <p className="mt-1 max-w-measure text-sm text-muted">
              Published &amp; rejected decisions. <span className="font-mono">Published</span> items
              are live on <span className="font-mono">/redtape</span>; rejected ones stay private.
              Return any to the queue to revise — re-opening a published item logs a public correction.
            </p>
          </div>
          <div className="space-y-2">
            {reviewed.map((g) => (
              <Panel key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="font-mono text-sm text-ink">{g.domain}</span>
                <span className="rounded-sm border border-edgeStrong px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted">
                  {g.gap_assessment ?? "?"}
                </span>
                {g.model_assessment ? (
                  <span className="font-mono text-[10px] text-faint">was {g.model_assessment}</span>
                ) : null}
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

const ASSESSMENTS = ["no_filing", "incomplete_filing", "covered"] as const;

/** Reviewer reclassification control — change the effective assessment and/or confidence at decision
 *  time. Defaults to the current values, so leaving it untouched is a no-op (the data layer only
 *  reclassifies when the value actually differs). When the label isn't one of the three real
 *  assessments (e.g. a 'manual' parse-failure or a null), the select defaults to "(unchanged)" so a
 *  decision click never silently reclassifies. If the model's original label was overridden earlier,
 *  it's shown for provenance. */
function Reclassify({ g }: { g: GapRow }) {
  const current = g.gap_assessment && (ASSESSMENTS as readonly string[]).includes(g.gap_assessment) ? g.gap_assessment : "";
  const unlisted = g.gap_assessment && !current ? g.gap_assessment : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
      <label className="flex items-center gap-1.5">
        <span className="uppercase tracking-wide text-faint">assessment</span>
        <select
          name="assessment"
          defaultValue={current}
          className="rounded border border-edge bg-panel px-2 py-1 font-mono text-xs text-ink focus:border-accent"
        >
          <option value="">(unchanged{unlisted ? `: ${unlisted}` : ""})</option>
          {ASSESSMENTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        <span className="uppercase tracking-wide text-faint">confidence</span>
        <input
          type="number"
          name="confidence"
          step="0.05"
          min="0"
          max="1"
          defaultValue={g.confidence ?? ""}
          className="w-20 rounded border border-edge bg-panel px-2 py-1 font-mono text-xs text-ink focus:border-accent"
        />
      </label>
      {g.model_assessment ? (
        <span className="font-mono text-[10px] text-faint">
          reclassified · model originally: {g.model_assessment}
        </span>
      ) : null}
    </div>
  );
}

/** The full finding for a gap — the fact/inference note plus every evidence trail. Shown in both
 *  the queue and the Held section, so a held item keeps all its findings when you revisit it. */
function GapEvidence({ g }: { g: GapRow }) {
  return (
    <>
      {g.fact_vs_inference_notes ? (
        <p className="mt-1.5 text-sm text-muted">{g.fact_vs_inference_notes}</p>
      ) : null}
      <Trail label="Collection evidence" items={parse(g.collects_pii_evidence_json)} />
      <Trail label="Searches run" items={parse(g.queries_run_json)} mono />
      <Trail label="Sources checked" items={parse(g.sources_checked_json)} mono />
      <Trail label="SORN refs" items={parse(g.sorn_refs_json)} mono />
    </>
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
