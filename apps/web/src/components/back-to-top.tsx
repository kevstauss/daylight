"use client";

import { useEffect, useState } from "react";

/**
 * Floating "back to top" control — appears once the page is scrolled past ~one viewport, so long
 * pages (Foundry, /registry, /changelog) get a quick way back up. On-theme (mono kicker, panel
 * surface, edge hairline) and honors prefers-reduced-motion.
 */
export function BackToTop() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!show) return null;

  const toTop = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <button
      type="button"
      onClick={toTop}
      aria-label="Back to top"
      className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-1.5 rounded-sm border border-edgeStrong bg-panel/90 px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-muted shadow-sm backdrop-blur transition-colors hover:border-ink hover:text-ink"
    >
      <span aria-hidden="true">↑</span> Top
    </button>
  );
}
