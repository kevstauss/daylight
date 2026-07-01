// Daylight mark: a rising half-sun over a baseline — daylight breaking over the public record.
// Monochrome (currentColor) so it adapts to light/dark; the wordmark carries the name.
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      {/* rays */}
      <g stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
        <line x1="12" y1="2.5" x2="12" y2="5.2" />
        <line x1="5.4" y1="5.4" x2="7.3" y2="7.3" />
        <line x1="18.6" y1="5.4" x2="16.7" y2="7.3" />
      </g>
      {/* half-sun */}
      <path d="M5 15 A7 7 0 0 1 19 15 Z" fill="currentColor" />
      {/* baseline — the record */}
      <line x1="2.5" y1="17.3" x2="21.5" y2="17.3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
