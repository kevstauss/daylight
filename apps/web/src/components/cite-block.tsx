"use client";

import { useState } from "react";

/** A one-click "cite this" block: the canonical URL, a content fingerprint, and an accessed date,
 *  formatted as a copyable citation so a reporter can drop a precise, re-verifiable reference into
 *  an article. Turns "a reporter noticed once" into a citable public record. */
export function CiteBlock({ title, url, hash }: { title: string; url: string; hash: string }) {
  const [copied, setCopied] = useState(false);
  const accessed = new Date().toISOString().slice(0, 10);
  const citation = `Daylight, “${title}.” ${url} — content fingerprint sha256:${hash} (accessed ${accessed}).`;

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(citation);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — the citation text is visible below to copy by hand */
    }
  };

  return (
    <div className="rounded-sm border border-edge bg-panel px-4 py-3">
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="font-mono text-[11px] uppercase tracking-wide text-faint">Cite this</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-6 items-center rounded-sm border border-edgeStrong px-2 py-0.5 font-mono text-[11px] text-muted transition-colors hover:border-ink hover:text-ink"
        >
          {copied ? "copied ✓" : "copy citation"}
        </button>
      </div>
      <p className="break-words font-mono text-xs leading-relaxed text-muted">{citation}</p>
      <span role="status" className="sr-only">
        {copied ? "Citation copied to clipboard" : ""}
      </span>
    </div>
  );
}
