import { ogCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";
import { domainRow, subdomainRow } from "@/lib/data";

export const alt = "Daylight federal .gov domain record";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const dynamic = "force-dynamic";

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
function dec(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

export default async function Image({ params }: { params: Promise<{ name: string }> }): Promise<Response> {
  const { name } = await params;
  const domain = dec(name).trim().toLowerCase();
  const apex = safe(() => domainRow(domain), null);

  if (apex) {
    return ogCard({
      eyebrow: "federal .gov domain",
      title: domain,
      subtitle: apex.org
        ? `Operated by ${apex.org}. Ownership, certificates, and tracking observations.`
        : "Ownership, certificates, and tracking observations.",
      footer: `daylight.watch/domain/${domain}`,
    });
  }

  const sub = safe(() => subdomainRow(domain), null);
  if (sub) {
    const flagged = sub.flag_severity && sub.flag_severity !== "info" ? sub.flag_severity : undefined;
    return ogCard({
      eyebrow: `subdomain · under ${sub.apex}`,
      title: domain,
      subtitle: "Seen in public Certificate Transparency logs. Existence-only — the host is never probed.",
      badge: flagged,
      footer: `daylight.watch/domain/${domain}`,
    });
  }

  return ogCard({
    eyebrow: "federal .gov",
    title: domain,
    subtitle: "Not in Daylight's registry or Certificate Transparency records yet.",
  });
}
