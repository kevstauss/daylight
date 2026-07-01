import { sha256 } from "@daylight/core";
import { normalizeFqdn } from "./labels.js";

export interface CertRecord {
  commonName: string;
  sans: string[];
  issuer: string;
  notBefore: string;
  notAfter: string;
  certSha256: string;
  logSource: string;
}

export interface CrtShOptions {
  /** Injectable fetch (tests); defaults to global fetch. */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  retries?: number;
  ua?: string;
}

function userAgent(): string {
  const site = (process.env.DAYLIGHT_SITE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  return `DaylightBot/0.3 (+${site}/methods; observational; public-data-only)`;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function getText(
  f: NonNullable<CrtShOptions["fetchImpl"]>,
  url: string,
  ua: string,
  retries: number,
): Promise<string | null> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await f(url, {
        headers: { "user-agent": ua, accept: "application/json,text/html,*/*" },
        signal: AbortSignal.timeout(20000), // crt.sh hangs under load — don't stall the backfill
      });
      if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(Math.min(1000 * 2 ** attempt, 15000));
    }
  }
  void lastErr;
  return null;
}

/** Build one synthetic cert per FQDN (used by fixtures + the HTML-fallback path). */
export function certsFromFqdns(fqdns: string[]): CertRecord[] {
  return fqdns.map((raw) => {
    const fqdn = normalizeFqdn(raw);
    return {
      commonName: fqdn,
      sans: [fqdn],
      issuer: "unknown (from CT log listing)",
      notBefore: "",
      notAfter: "",
      certSha256: sha256(fqdn),
      logSource: "crt.sh",
    };
  });
}

/** Parse crt.sh JSON output into cert records. */
export function parseCrtShJson(text: string, apex: string): CertRecord[] {
  let arr: unknown;
  try {
    arr = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  const suffix = `.${apex.toLowerCase()}`;
  const out: CertRecord[] = [];
  for (const e of arr as Record<string, unknown>[]) {
    const nameValue = typeof e.name_value === "string" ? e.name_value : "";
    const commonName = typeof e.common_name === "string" ? e.common_name : "";
    const sans = [...nameValue.split("\n"), commonName]
      .map(normalizeFqdn)
      .filter((s) => s.endsWith(suffix) || s === apex.toLowerCase());
    if (!sans.length) continue;
    out.push({
      commonName: normalizeFqdn(commonName) || sans[0]!,
      sans: [...new Set(sans)],
      issuer: typeof e.issuer_name === "string" ? e.issuer_name : "",
      notBefore: typeof e.not_before === "string" ? e.not_before : "",
      notAfter: typeof e.not_after === "string" ? e.not_after : "",
      certSha256: String(e.id ?? e.serial_number ?? sha256(nameValue + commonName)),
      logSource: "crt.sh",
    });
  }
  return out;
}

/** Scrape FQDNs of the apex from a crt.sh HTML page (fallback when JSON 502s). */
export function parseCrtShHtml(html: string, apex: string): string[] {
  const escaped = apex.toLowerCase().replace(/[.]/g, "\\.");
  const re = new RegExp(`[a-z0-9*._-]+\\.${escaped}`, "gi");
  const found = new Set<string>();
  for (const m of html.matchAll(re)) found.add(normalizeFqdn(m[0]));
  return [...found];
}

/**
 * Pull cert history for an apex from crt.sh. Existence-only: this queries the public CT
 * aggregator; it never connects to the discovered hosts. Robust to crt.sh's frequent 502s
 * — tries JSON, falls back to HTML scrape, and returns [] (never throws) on total failure.
 */
export async function fetchCrtShCerts(apex: string, opts: CrtShOptions = {}): Promise<CertRecord[]> {
  const f = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const retries = opts.retries ?? 3;
  const ua = opts.ua ?? userAgent();
  const jsonUrl = `https://crt.sh/?q=%25.${apex}&output=json`;
  const htmlUrl = `https://crt.sh/?q=%25.${apex}`;

  const jsonText = await getText(f, jsonUrl, ua, retries);
  if (jsonText) {
    const certs = parseCrtShJson(jsonText, apex);
    if (certs.length) return certs;
  }
  const htmlText = await getText(f, htmlUrl, ua, retries);
  if (htmlText) {
    const fqdns = parseCrtShHtml(htmlText, apex);
    if (fqdns.length) return certsFromFqdns(fqdns);
  }
  return [];
}
