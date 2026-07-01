import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getDb } from "@daylight/db";
import { captureAndScore } from "@daylight/floodlight/capture";
import { flags } from "@/lib/flags";
import { Eyebrow, Panel } from "@/components/ui";

export const metadata: Metadata = { title: "Scan a URL" };
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Single-flight + a small rolling window keep the browser from piling up (one machine).
let scanning = false;
let recent: number[] = [];

async function runScan(formData: FormData): Promise<void> {
  "use server";
  // Re-check the kill-switch INSIDE the action. A Server Action has its own stable endpoint,
  // reachable even when the page component's gate isn't rendered — so gating only the page
  // would leave this browser-spawning path (FLAG_FLOODLIGHT_SCAN exists to disable it) live.
  if (!flags().floodlightScan) notFound();
  const url = String(formData.get("url") ?? "").trim();
  const back = (msg: string) => redirect(`/floodlight/scan?error=${encodeURIComponent(msg)}`);
  if (!url) back("Enter a public URL to scan.");
  if (!/^https?:\/\//i.test(url)) back("Enter a full URL starting with http:// or https://");

  const now = Date.now();
  recent = recent.filter((t) => now - t < 5 * 60 * 1000);
  if (scanning) back("A scan is already running — give it a few seconds.");
  if (recent.length >= 12) back("Scan limit reached for now. Try again in a few minutes.");

  scanning = true;
  recent.push(now);
  let result;
  try {
    result = await captureAndScore(getDb(), url, { channel: process.env.DAYLIGHT_BROWSER_CHANNEL });
  } finally {
    scanning = false;
  }

  if (!result.ok) back(result.error ?? "The scan could not complete.");
  if (result.gated) redirect(`/floodlight/scan?gated=${encodeURIComponent(result.domain ?? url)}`);
  redirect(`/floodlight?scanned=${encodeURIComponent(result.domain ?? "")}`);
}

export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  if (!flags().floodlightScan) notFound();
  const sp = await searchParams;
  const error = typeof sp.error === "string" ? sp.error : null;
  const gated = typeof sp.gated === "string" ? sp.gated : null;

  return (
    <div className="max-w-measure space-y-6">
      <div>
        <Eyebrow>floodlight · scan a url</Eyebrow>
        <h1 className="text-2xl font-semibold tracking-tight">Scan a public page</h1>
        <p className="mt-1 text-sm text-muted">
          Load any public <code className="font-mono text-ink">.gov</code> (or other public) page
          and see what it loads on its own — third-party trackers, session-replay tools, the
          reverse-proxy disguise trick, and whether it links a privacy notice. We load the page
          once, capture what it requests, and stop. No forms are submitted, nothing is clicked, and
          an access-gated page is noted but never entered.
        </p>
      </div>

      {error ? (
        <Panel className="border-alarm/50 px-4 py-3">
          <p className="text-sm text-alarm">{error}</p>
        </Panel>
      ) : null}
      {gated ? (
        <Panel className="border-signal/50 px-4 py-3">
          <p className="text-sm text-ink">
            <span className="font-mono">{gated}</span> sits behind an access wall. Daylight records
            that it exists and stops there — we never authenticate past it.
          </p>
        </Panel>
      ) : null}

      <form action={runScan} className="space-y-3">
        <input
          type="url"
          name="url"
          required
          placeholder="https://example.gov/"
          className="w-full rounded border border-edge bg-panel px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          className="rounded border border-edgeStrong bg-panel px-4 py-2 font-mono text-xs text-ink transition-colors hover:border-ink"
        >
          Scan →
        </button>
        <p className="text-xs text-faint">
          A scan takes a few seconds. The result is added to the{" "}
          <Link href="/floodlight" className="link">
            scorecard list
          </Link>
          .
        </p>
      </form>
    </div>
  );
}
