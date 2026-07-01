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
    <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      {items.map((n) => (
        <Link
          key={n.href}
          href={n.href}
          aria-current={active(n) ? "page" : undefined}
          className={
            active(n)
              ? "font-medium text-ink underline decoration-alarm decoration-2 underline-offset-[5px]"
              : "text-muted underline decoration-transparent underline-offset-[5px] transition-colors hover:text-ink hover:decoration-edgeStrong"
          }
        >
          {n.label}
        </Link>
      ))}
      <Link
        href={rssHref}
        className="rounded-sm border border-edgeStrong px-2 py-0.5 font-mono text-[11px] text-muted transition-colors hover:border-ink hover:text-ink"
      >
        RSS
      </Link>
    </nav>
  );
}
