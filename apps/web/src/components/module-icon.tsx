// Flat, line-based icons for the five modules — same visual language as the Daylight mark
// (currentColor, ~1.7 stroke, round joins). One glyph per module, drawn from its subject.
export function ModuleIcon({ name, className }: { name: string; className?: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
  switch (name) {
    // Ledger — an append-only record: entry rows with leading marks.
    case "registry":
      return (
        <svg {...common}>
          <line x1="4" y1="6.5" x2="5.5" y2="6.5" />
          <line x1="8.5" y1="6.5" x2="20" y2="6.5" />
          <line x1="4" y1="12" x2="5.5" y2="12" />
          <line x1="8.5" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17.5" x2="5.5" y2="17.5" />
          <line x1="8.5" y1="17.5" x2="16.5" y2="17.5" />
        </svg>
      );
    // Lookout — certificate-transparency detection: radar arcs from an origin.
    case "lookout":
      return (
        <svg {...common}>
          <circle cx="6" cy="18" r="1.3" fill="currentColor" stroke="none" />
          <path d="M6 13.5 A4.5 4.5 0 0 1 10.5 18" />
          <path d="M6 8.5 A9.5 9.5 0 0 1 15.5 18" />
          <path d="M6 3.5 A14.5 14.5 0 0 1 20.5 18" />
        </svg>
      );
    // Floodlight — a spotlight cone illuminating the page.
    case "floodlight":
      return (
        <svg {...common}>
          <rect x="8.5" y="3" width="7" height="3.2" rx="1" />
          <path d="M9 6.2 L5 19" />
          <path d="M15 6.2 L19 19" />
          <line x1="5" y1="19.5" x2="19" y2="19.5" strokeDasharray="0.1 3.2" />
        </svg>
      );
    // Receipts — a receipt slip with a torn edge (what was taken down).
    case "receipts":
      return (
        <svg {...common}>
          <path d="M6 3.5 h12 v15 l-2 -1.4 -2 1.4 -2 -1.4 -2 1.4 -2 -1.4 -2 1.4 z" />
          <line x1="9" y1="8" x2="15" y2="8" />
          <line x1="9" y1="11.5" x2="15" y2="11.5" />
        </svg>
      );
    // Redtape — a filing with an official stamp.
    case "redtape":
      return (
        <svg {...common}>
          <path d="M5.5 3.5 h9 v17 h-9 z" />
          <line x1="8" y1="8" x2="12" y2="8" />
          <line x1="8" y1="11.5" x2="12" y2="11.5" />
          <circle cx="16" cy="16.5" r="4" />
        </svg>
      );
    default:
      return null;
  }
}
