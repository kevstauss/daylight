"use client";

import { useEffect, useState } from "react";

/**
 * Floating "back to top" control for long pages (Foundry, /registry, /changelog). It is ALWAYS in
 * the DOM (server-rendered) and toggles visibility via opacity once the page is scrolled past ~300px
 * — rather than mounting on scroll — so it's robust to hydration timing and easy to verify in the
 * HTML. On-theme, keyboard-reachable only when visible, and honors prefers-reduced-motion.
 */
export function BackToTop() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const check = () => {
      const y = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
      setShow(y > 300);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  const toTop = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <button
      type="button"
      onClick={toTop}
      aria-label="Back to top"
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      className={`fixed bottom-5 right-5 z-40 inline-flex items-center gap-1.5 rounded-sm border border-edgeStrong bg-panel px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-muted shadow-sm transition-opacity duration-200 hover:border-ink hover:text-ink ${
        show ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
    >
      <span aria-hidden="true">↑</span> Top
    </button>
  );
}
