import { headers } from "next/headers";

/** Renders a schema.org JSON-LD block. It carries the per-request CSP nonce (like the layout's
 *  inline theme script) so the strict `script-src 'nonce-…' 'strict-dynamic'` policy never blocks
 *  it. `<` is escaped to `<` so a value can never break out of the <script> element. Async
 *  because headers() is async in Next 15 — a server component may be async. */
export async function JsonLd({ data }: { data: unknown }): Promise<React.ReactElement> {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
