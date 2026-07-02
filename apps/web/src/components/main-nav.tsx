"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  /** Extra path prefixes this item "owns" (e.g. Ledger owns /ledger and /domain). */
  owns?: string[];
}

export function MainNav({ items, rssHref }: { items: NavItem[]; rssHref: string }) {
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
      <Link
        href={rssHref}
        aria-label="Global RSS feed"
        className="inline-flex min-h-6 items-center rounded-sm border border-edgeStrong px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:border-ink hover:text-ink"
      >
        RSS
      </Link>
    </nav>
  );
}
