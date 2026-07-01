// Federal Register API client (public JSON) for SORN search. Used by the real researcher;
// injectable fetch for tests. Existence-only public-data query.

export interface SornRef {
  documentNumber: string;
  title: string;
  url: string;
  publicationDate: string;
}

export interface FederalRegisterOptions {
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  agency?: string;
}

function userAgent(): string {
  const site = (process.env.DAYLIGHT_SITE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
  return `DaylightBot/0.6 (+${site}/methods; observational; public-data-only)`;
}

/** Search Federal Register NOTICEs (SORNs are published as notices). Returns [] on failure. */
export async function searchSorns(query: string, opts: FederalRegisterOptions = {}): Promise<SornRef[]> {
  const f = opts.fetchImpl ?? ((url, init) => fetch(url, init));
  const params = new URLSearchParams();
  params.set("conditions[term]", query);
  params.append("conditions[type][]", "NOTICE");
  if (opts.agency) params.append("conditions[agencies][]", opts.agency);
  params.set("per_page", "20");
  const url = `https://www.federalregister.gov/api/v1/documents.json?${params.toString()}`;
  try {
    const res = await f(url, { headers: { "user-agent": userAgent(), accept: "application/json" } });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: Record<string, unknown>[] };
    const results = Array.isArray(data.results) ? data.results : [];
    return results.map((r) => ({
      documentNumber: String(r.document_number ?? ""),
      title: String(r.title ?? ""),
      url: String(r.html_url ?? ""),
      publicationDate: String(r.publication_date ?? ""),
    }));
  } catch {
    return [];
  }
}
