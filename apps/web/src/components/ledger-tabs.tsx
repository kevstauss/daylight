import Link from "next/link";

// Two views of the Ledger — the domain registry and the change/flag activity — cross-linked
// so the flag filter is discoverable from the registry (and vice versa).
export function LedgerTabs({ active }: { active: "registry" | "activity" }) {
  const tabs = [
    { key: "registry", href: "/registry", label: "Registry" },
    { key: "activity", href: "/ledger", label: "Activity & flags" },
  ] as const;
  return (
    <nav className="flex gap-1 border-b border-edge">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
            active === t.key
              ? "border-ink font-medium text-ink"
              : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
