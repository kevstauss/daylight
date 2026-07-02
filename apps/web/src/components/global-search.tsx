"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** "Type any .gov" — the front-door search. Normalizes the input to a bare host and routes to the
 *  /domain resolver, which handles an apex, a subdomain (Lookout), or falls through to registry
 *  search. Compact in the masthead; large in the home hero. */
export function GlobalSearch({ variant = "compact" }: { variant?: "compact" | "hero" }) {
  const router = useRouter();
  const [q, setQ] = useState("");

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const host = q
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/\/.*$/, "")
      .replace(/^www\./, "");
    if (!host) return;
    router.push(`/domain/${encodeURIComponent(host)}`);
  };

  if (variant === "hero") {
    return (
      <form onSubmit={submit} role="search" className="flex max-w-xl gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          type="text"
          inputMode="url"
          aria-label="Look up any federal .gov domain"
          placeholder="Type any .gov — e.g. vote.gov, passports.gov"
          className="w-full rounded border border-edgeStrong bg-panel px-4 py-2.5 text-sm text-ink placeholder:text-faint focus:border-accent"
        />
        <button
          type="submit"
          className="shrink-0 rounded border border-edgeStrong bg-panel px-4 py-2.5 font-mono text-xs text-ink transition-colors hover:border-ink"
        >
          Look up →
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submit} role="search" className="flex w-full max-w-md gap-2">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        type="text"
        inputMode="url"
        aria-label="Look up any federal .gov domain"
        placeholder="Type any .gov…"
        className="min-h-6 w-full rounded-sm border border-edge bg-panel px-2.5 py-1 text-sm text-ink placeholder:text-faint focus:border-accent"
      />
      <button
        type="submit"
        aria-label="Look up domain"
        className="inline-flex min-h-6 shrink-0 items-center rounded-sm border border-edgeStrong px-2.5 py-1 font-mono text-[11px] text-muted transition-colors hover:border-ink hover:text-ink"
      >
        Look up
      </button>
    </form>
  );
}
