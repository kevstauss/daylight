"use client";

import { useEffect, useState } from "react";

type Mode = "system" | "light" | "dark";

const ORDER: Mode[] = ["system", "light", "dark"];
const GLYPH: Record<Mode, string> = { system: "◐", light: "☀", dark: "☾" };
const LABEL: Record<Mode, string> = {
  system: "Theme: follow system (click to override)",
  light: "Theme: light (click for dark)",
  dark: "Theme: dark (click for system)",
};

function apply(mode: Mode): void {
  const el = document.documentElement;
  if (mode === "system") delete el.dataset.theme;
  else el.dataset.theme = mode;
}

/** Cycles system → light → dark. Defaults to the OS preference; the choice persists. */
export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("daylight-theme");
    setMode(saved === "light" || saved === "dark" ? saved : "system");
    setMounted(true);
  }, []);

  const cycle = () => {
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]!;
    setMode(next);
    try {
      if (next === "system") localStorage.removeItem("daylight-theme");
      else localStorage.setItem("daylight-theme", next);
    } catch {
      /* private mode — the inline choice still applies for this session */
    }
    apply(next);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={LABEL[mode]}
      title={LABEL[mode]}
      className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-sm border border-edgeStrong px-2 py-1 font-mono text-[12px] leading-none text-muted transition-colors hover:border-ink hover:text-ink"
    >
      <span aria-hidden suppressHydrationWarning>
        {mounted ? GLYPH[mode] : "◐"}
      </span>
      {/* Announce the tri-state change to screen readers (the glyph alone is silent). */}
      <span role="status" className="sr-only">
        {mounted ? LABEL[mode] : ""}
      </span>
    </button>
  );
}
