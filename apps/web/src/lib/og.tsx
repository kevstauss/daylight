import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";

// Shared renderer for dynamic OpenGraph/social cards (next/og + satori). On-brand: the darkroom
// palette from icon.svg (cream ink on #14181d), Public Sans for text, IBM Plex Mono for machine
// facts, the alarm dot. Fonts are bundled (src/og/fonts) and read from disk — no external fetch at
// render time (matches the site's no-external-dependency ethos). If a font can't be read the card
// still renders in next/og's default font, so this route never 500s on a missing asset.

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

const COLOR = {
  bg: "#14181d",
  ink: "#f4f1ea",
  muted: "#b6ac9c",
  faint: "#8a9099",
  alarm: "#e87a6e",
  line: "#2a2f37",
};

// The Mark (app/icon.svg), inlined as a data URI for satori's <img>. Its own backdrop is #14181d,
// so it blends into the card and reads as the cream sun-over-horizon glyph.
const MARK_SVG =
  '<svg width="72" height="72" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">' +
  '<rect width="32" height="32" rx="7" fill="#14181d"/>' +
  '<g stroke="#f4f1ea" stroke-width="2" stroke-linecap="round">' +
  '<line x1="16" y1="4.5" x2="16" y2="7.6"/><line x1="7.7" y1="8" x2="9.9" y2="10.2"/>' +
  '<line x1="24.3" y1="8" x2="22.1" y2="10.2"/></g>' +
  '<path d="M8 20 A8 8 0 0 1 24 20 Z" fill="#f4f1ea"/>' +
  '<rect x="5.5" y="21.3" width="21" height="2.5" rx="1.25" fill="#7a2436"/></svg>';
const MARK = `data:image/svg+xml;base64,${Buffer.from(MARK_SVG).toString("base64")}`;

interface OgFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 500 | 700;
  style: "normal";
}

let fontsCache: OgFont[] | null = null;
function ogFonts(): OgFont[] {
  if (fontsCache) return fontsCache;
  const dir = path.join(process.cwd(), "src/og/fonts");
  const read = (file: string): ArrayBuffer => {
    const b = fs.readFileSync(path.join(dir, file));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  };
  try {
    fontsCache = [
      { name: "Public Sans", data: read("PublicSans-Regular.ttf"), weight: 400, style: "normal" },
      { name: "Public Sans", data: read("PublicSans-Bold.ttf"), weight: 700, style: "normal" },
      { name: "IBM Plex Mono", data: read("IBMPlexMono-Medium.ttf"), weight: 500, style: "normal" },
    ];
  } catch {
    fontsCache = [];
  }
  return fontsCache;
}

function clamp(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

export interface OgCardInput {
  /** Small uppercase mono kicker over the title (e.g. "ledger · change #123" or a domain flag). */
  eyebrow?: string;
  /** The headline. Long values scale down and truncate so the card never overflows. */
  title: string;
  /** One supporting line under the title. */
  subtitle?: string;
  /** Top-right pill (e.g. severity or status). */
  badge?: string;
  /** Bottom-left mono line; defaults to the site host. */
  footer?: string;
}

/** Render an OG card to a PNG ImageResponse. */
export function ogCard(input: OgCardInput): ImageResponse {
  const { eyebrow, subtitle, badge } = input;
  const title = clamp(input.title, 140);
  const titleSize = title.length > 90 ? 44 : title.length > 52 ? 54 : 66;
  const footer = input.footer ?? "daylight.watch";
  const fonts = ogFonts();
  const sans = fonts.length ? "Public Sans" : undefined;
  const mono = fonts.length ? "IBM Plex Mono" : undefined;

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          backgroundColor: COLOR.bg,
          color: COLOR.ink,
          padding: "62px 72px",
          fontFamily: sans,
        }}
      >
        {/* masthead */}
        <div style={{ display: "flex", alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={MARK} width={72} height={72} alt="" />
          <div style={{ display: "flex", flexDirection: "column", marginLeft: 18 }}>
            <span style={{ fontSize: 36, fontWeight: 700, letterSpacing: -0.5 }}>Daylight</span>
            <span
              style={{ fontSize: 18, color: COLOR.faint, fontFamily: mono, letterSpacing: 2, marginTop: 2 }}
            >
              FEDERAL .GOV WATCH
            </span>
          </div>
          {badge ? (
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                fontSize: 22,
                fontFamily: mono,
                color: COLOR.alarm,
                border: `2px solid ${COLOR.alarm}`,
                borderRadius: 8,
                padding: "8px 18px",
                letterSpacing: 1,
              }}
            >
              {badge.toUpperCase()}
            </div>
          ) : null}
        </div>

        {/* headline block, pinned to the lower third */}
        <div style={{ display: "flex", flexDirection: "column", marginTop: "auto" }}>
          {eyebrow ? (
            <span
              style={{
                fontSize: 24,
                color: COLOR.alarm,
                fontFamily: mono,
                letterSpacing: 2,
                marginBottom: 18,
              }}
            >
              {clamp(eyebrow.toUpperCase(), 60)}
            </span>
          ) : null}
          <span style={{ fontSize: titleSize, fontWeight: 700, lineHeight: 1.05, letterSpacing: -1 }}>
            {title}
          </span>
          {subtitle ? (
            <span style={{ fontSize: 27, color: COLOR.muted, lineHeight: 1.32, marginTop: 20 }}>
              {clamp(subtitle, 150)}
            </span>
          ) : null}
        </div>

        {/* footer bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            marginTop: 44,
            paddingTop: 24,
            borderTop: `1px solid ${COLOR.line}`,
          }}
        >
          <span style={{ fontSize: 22, color: COLOR.faint, fontFamily: mono }}>{footer}</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
            <div style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: COLOR.alarm, marginRight: 12 }} />
            <span style={{ fontSize: 20, color: COLOR.faint }}>observational · public data only</span>
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: fonts.length ? fonts : undefined },
  );
}
