import type { Metadata } from "next";
import Link from "next/link";
import { composite } from "@/lib/ledger";
import { watchlist } from "@/lib/watchlist";
import { EmptyState, Eyebrow, Panel } from "@/components/ui";

export const metadata: Metadata = { title: "Compare" };
export const dynamic = "force-dynamic";

const str = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v[0] : v)?.trim().toLowerCase() ?? "";

interface Profile {
  domain: string;
  org: string | null;
  contact: string | null;
  scanned: boolean;
  trackers: number | null;
  sessionReplay: boolean;
  reverseProxy: boolean;
  privacyNotice: boolean;
  formFields: string[];
  seal: boolean | null;
}

function profile(domain: string): Profile {
  const c = safe(() => composite(domain), null);
  const sc = c?.scorecards[0] ?? null;
  const snap = c?.snapshots[0] ?? null;
  return {
    domain,
    org: c?.ledger?.org ?? null,
    contact: c?.ledger?.security_contact_email ?? null,
    scanned: !!sc,
    trackers: sc?.tracker_count ?? null,
    sessionReplay: !!sc?.session_replay,
    reverseProxy: !!sc?.first_party_proxied,
    privacyNotice: !!sc?.privacy_notice_url,
    formFields: parseArr(sc?.form_fields_json ?? null),
    seal: snap ? snap.seal_present === 1 : null,
  };
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ [k: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const a = str(sp.a);
  const b = str(sp.b);
  const comparators = watchlist()?.comparators ?? {};

  if (!a || !b) {
    return (
      <div className="max-w-measure space-y-6">
        <div>
          <Eyebrow>daylight · compare</Eyebrow>
          <h1 className="text-2xl font-semibold tracking-tight">Shadow vs. legit comparator</h1>
          <p className="mt-1 text-sm text-muted">
            Put a suspected shadow site next to its legitimate counterpart and see, side by side,
            what each one collects and runs — trackers, session replay, the reverse-proxy disguise,
            privacy notices, the PII a form asks for, and the agency seal. Pick a pair:
          </p>
        </div>
        {Object.keys(comparators).length === 0 ? (
          <EmptyState title="No comparator pairs configured." hint="Comparator pairs come from the watchlist." />
        ) : (
          <Panel className="divide-y divide-edge">
            {Object.entries(comparators).map(([x, y]) => (
              <Link
                key={`${x}:${y}`}
                href={`/compare?a=${encodeURIComponent(x)}&b=${encodeURIComponent(y)}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-raised"
              >
                <span className="font-mono text-sm text-ink">
                  {x} <span className="text-faint">vs</span> {y}
                </span>
                <span className="font-mono text-xs text-faint">→</span>
              </Link>
            ))}
          </Panel>
        )}
      </div>
    );
  }

  const pa = profile(a);
  const pb = profile(b);

  const rows: { label: string; a: string; b: string; flagIf?: (p: Profile) => boolean }[] = [
    { label: "Owner (registrant)", a: pa.org ?? "—", b: pb.org ?? "—" },
    { label: "Security contact", a: pa.contact ?? "—", b: pb.contact ?? "—" },
    { label: "Third-party trackers", a: pa.scanned ? String(pa.trackers ?? 0) : "not scanned", b: pb.scanned ? String(pb.trackers ?? 0) : "not scanned" },
    { label: "Session replay", a: yn(pa.sessionReplay, pa.scanned), b: yn(pb.sessionReplay, pb.scanned), flagIf: (p) => p.sessionReplay },
    { label: "Reverse-proxy disguise", a: yn(pa.reverseProxy, pa.scanned), b: yn(pb.reverseProxy, pb.scanned), flagIf: (p) => p.reverseProxy },
    { label: "Privacy notice", a: pa.scanned ? (pa.privacyNotice ? "present" : "absent") : "—", b: pb.scanned ? (pb.privacyNotice ? "present" : "absent") : "—", flagIf: (p) => p.scanned && !p.privacyNotice },
    { label: "PII collected (form)", a: pa.formFields.length ? pa.formFields.join(", ") : "—", b: pb.formFields.length ? pb.formFields.join(", ") : "—" },
    { label: "Agency seal", a: pa.seal === null ? "—" : pa.seal ? "present" : "absent", b: pb.seal === null ? "—" : pb.seal ? "present" : "absent" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <Eyebrow>daylight · compare</Eyebrow>
        <h1 className="font-mono text-2xl text-ink">
          {a} <span className="text-faint">vs</span> {b}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Side-by-side observed behavior. A row where one side runs tracking or lacks a privacy
          notice that the other does not is the legible artifact — stated as observed, each fact
          re-verifiable on that domain&rsquo;s page.
        </p>
      </div>

      <Panel className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-left font-mono text-[11px] uppercase tracking-wide text-faint">
                <th scope="col" className="px-4 py-2 font-normal">Dimension</th>
                <th scope="col" className="px-4 py-2 font-normal">
                  <Link href={`/domain/${encodeURIComponent(a)}`} className="link">{a}</Link>
                </th>
                <th scope="col" className="px-4 py-2 font-normal">
                  <Link href={`/domain/${encodeURIComponent(b)}`} className="link">{b}</Link>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-edge">
              {rows.map((r) => {
                const aFlag = r.flagIf?.(pa) ?? false;
                const bFlag = r.flagIf?.(pb) ?? false;
                const differ = r.a !== r.b;
                return (
                  <tr key={r.label} className="align-top">
                    <td className="px-4 py-2.5 text-faint">{r.label}</td>
                    <td className={`px-4 py-2.5 font-mono text-xs ${aFlag ? "text-alarm" : differ ? "text-ink" : "text-muted"}`}>{r.a}</td>
                    <td className={`px-4 py-2.5 font-mono text-xs ${bFlag ? "text-alarm" : differ ? "text-ink" : "text-muted"}`}>{r.b}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <p className="text-xs text-faint">
        Not scanned dimensions mean Floodlight/Receipts hasn&rsquo;t captured that page yet — see{" "}
        <Link href="/methods" className="link">methods</Link> for cadence.
      </p>
    </div>
  );
}

const yn = (v: boolean, scanned: boolean): string => (!scanned ? "—" : v ? "yes" : "no");

function parseArr(json: string | null): string[] {
  try {
    const v = JSON.parse(json ?? "[]");
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
