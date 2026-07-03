"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  /** Extra path prefixes this item "owns" (e.g. Ledger owns /ledger and /domain). */
  owns?: string[];
}

/**
 * `items` are the primary modules (Ledger…Redtape); `meta` are the secondary pages
 * (Watchlist, Methods, Status). The two groups are visually separated so the five
 * modules read as the product and the meta pages as supporting context.
 */
export function MainNav({
  items,
  meta = [],
}: {
  items: NavItem[];
  meta?: NavItem[];
}) {
  const pathname = usePathname() || "/";
  const active = (item: NavItem): boolean =>
    [item.href, ...(item.owns ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));

  return (
    <nav aria-label="Primary" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      {items.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          aria-current={active(n) ? "page" : undefined}
          className={`inline-flex min-h-6 items-center py-1 underline underline-offset-[5px] ${
            active(n)
              ? "font-medium text-ink decoration-alarm decoration-2"
              : "text-muted decoration-transparent transition-colors hover:text-ink hover:decoration-edgeStrong"
          }`}
        >
          {n.label}
        </Link>
      ))}

      {meta.length > 0 ? (
        <span aria-hidden className="hidden h-4 w-px self-center bg-edgeStrong sm:inline-block" />
      ) : null}

      {meta.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          aria-current={active(n) ? "page" : undefined}
          className={`inline-flex min-h-6 items-center py-1 text-[13px] ${
            active(n)
              ? "font-medium text-muted"
              : "text-faint transition-colors hover:text-muted"
          }`}
        >
          {n.label}
        </Link>
      ))}
    </nav>
  );
}
