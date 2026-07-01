import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Sober civic-instrument palette: ink on paper, restrained accents.
        paper: "#0d0f12",
        panel: "#14171c",
        edge: "#232830",
        ink: "#e7e9ec",
        muted: "#9aa3ad",
        faint: "#6b7280",
        signal: "#e6b450", // amber — "notable"
        alarm: "#e06c5b", // red — "high"
        calm: "#7fb08a", // green — "info" / ok
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
