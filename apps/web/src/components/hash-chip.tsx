"use client";

import { useState } from "react";

/** Content-hash chip that copies the FULL hash on click. The short slice is only the visible
 *  glyph; the whole sha256 rides in the aria-label + clipboard, so a phone or screen-reader user
 *  can actually retrieve the verifiability primitive (it was previously title-only + truncated). */
export function HashChip({ hash }: { hash: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!hash) return null;

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — the full hash is still exposed via the aria-label + title */
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy full content hash ${hash}`}
      title={copied ? "Copied" : `Copy ${hash}`}
      className="inline-flex min-h-6 items-center rounded-sm border border-edge bg-panel px-1.5 font-mono text-[11px] text-muted transition-colors hover:border-ink hover:text-ink"
    >
      {copied ? "copied ✓" : hash.slice(0, 10)}
      <span role="status" className="sr-only">
        {copied ? "Copied full hash to clipboard" : ""}
      </span>
    </button>
  );
}
