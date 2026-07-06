import { synthesizeTitle } from "@daylight/feeds";
import { ogCard, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";
import { changeById } from "@/lib/data";
import { severityLabel } from "@/lib/site";

export const alt = "Daylight change record";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const dynamic = "force-dynamic";

export default async function Image({ params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const c = changeById(Number(id));
  if (!c) {
    return ogCard({ title: "Change not found", subtitle: "This record does not exist." });
  }
  const headline = synthesizeTitle({
    id: c.id,
    domain: c.domain,
    detected_at: c.detected_at,
    kind: c.kind,
    field: c.field,
    old_value: c.old_value,
    new_value: c.new_value,
    severity: c.severity,
    reason: c.reason,
  });
  return ogCard({
    eyebrow: `${c.module} · change #${c.id}`,
    title: headline,
    subtitle: `${c.domain} · observed ${c.detected_at.slice(0, 10)}`,
    badge: c.severity === "info" ? undefined : severityLabel(c.severity),
    footer: `daylight.watch/change/${c.id}`,
  });
}
