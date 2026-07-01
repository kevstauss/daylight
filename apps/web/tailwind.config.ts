import type { Config } from "tailwindcss";

// Daylight visual system — "the public record."
// A cool, institutional light palette (deliberately NOT warm cream): near-black cool ink
// on a daylight-gray page, with oxblood as an official "stamp" flag. Public Sans (the US
// federal typeface) leads; IBM Plex Mono is the co-voice for all machine data.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#e7eaec", // daylight-gray page
        panel: "#f7f8f9", // near-white record surface
        raised: "#ffffff", // brightest surface (input, active row)
        edge: "#d3d8dd", // hairline rule
        edgeStrong: "#b7c0c7",
        ink: "#14171a", // cool near-black
        muted: "#4f575f", // secondary text
        faint: "#828b93", // meta / timestamps
        accent: "#1c4a67", // deep institutional blue — interactive
        alarm: "#9c2a24", // HIGH — oxblood stamp
        signal: "#8a6412", // NOTABLE — dark ochre
        calm: "#2f6b4f", // OK / low — pine
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
