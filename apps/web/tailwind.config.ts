import type { Config } from "tailwindcss";

// Daylight visual system — "the public record."
// A cool, institutional light palette (deliberately NOT warm cream): near-black cool ink
// on a daylight-gray page, with oxblood as an official "stamp" flag. Public Sans (the US
// federal typeface) leads; IBM Plex Mono is the co-voice for all machine data.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Tokens resolve to CSS variables (channels in globals.css), so light ↔ dark is a
      // pure value swap — every component inherits both modes with no per-file changes.
      colors: {
        paper: "rgb(var(--c-paper) / <alpha-value>)", // page
        panel: "rgb(var(--c-panel) / <alpha-value>)", // record surface
        raised: "rgb(var(--c-raised) / <alpha-value>)", // lifted surface (input, active row)
        edge: "rgb(var(--c-edge) / <alpha-value>)", // hairline rule
        edgeStrong: "rgb(var(--c-edge-strong) / <alpha-value>)",
        ink: "rgb(var(--c-ink) / <alpha-value>)", // primary text
        muted: "rgb(var(--c-muted) / <alpha-value>)", // secondary text
        faint: "rgb(var(--c-faint) / <alpha-value>)", // meta / timestamps
        accent: "rgb(var(--c-accent) / <alpha-value>)", // interactive
        alarm: "rgb(var(--c-alarm) / <alpha-value>)", // HIGH — oxblood stamp
        signal: "rgb(var(--c-signal) / <alpha-value>)", // NOTABLE — ochre
        calm: "rgb(var(--c-calm) / <alpha-value>)", // OK / low — pine
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      letterSpacing: {
        kicker: "0.14em",
      },
      borderRadius: {
        sm: "2px",
        DEFAULT: "3px",
      },
      maxWidth: {
        measure: "68ch",
      },
    },
  },
  plugins: [],
};

export default config;
