"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { NavItem } from "./main-nav";

/** Mobile-only nav: a hamburger that opens a compact dropdown of every route. Shown under `sm`,
 *  where the inline MainNav would otherwise wrap to two rows of text (see the masthead). Closes on
 *  navigation, on Escape, and on an outside click. */
export function MobileNav({ items, meta = [] }: { items: NavItem[]; meta?: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() || "/";
  const active = (item: NavItem): boolean =>
    [item.href, ...(item.owns ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const all = [...items, ...meta];

  return (
    <div className="relative sm:hidden">
      <button
        type="button"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        aria-controls="mobile-menu"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-edgeStrong text-muted transition-colors hover:border-ink hover:text-ink"
      >
        {open ? <CloseIcon /> : <MenuIcon />}
      </button>

      {open ? (
        <>
          {/* Backdrop: an outside click closes the menu. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            id="mobile-menu"
            className="absolute right-0 top-full z-50 mt-2 w-52 rounded-sm border border-edgeStrong bg-panel p-1.5 shadow-lg"
          >
            <ul className="flex flex-col">
              {all.map((n) => (
                <li key={n.href}>
                  <Link
                    href={n.href}
                    aria-current={active(n) ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={`block rounded-sm px-3 py-2 text-sm ${
                      active(n)
                        ? "bg-raised font-medium text-ink"
                        : "text-muted transition-colors hover:bg-raised hover:text-ink"
                    }`}
                  >
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  );
}

function MenuIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
