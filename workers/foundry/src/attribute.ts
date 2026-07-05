// Foundry attribution — the pure heart of the module. It reasons about a *vendor build tree*:
// the subdomains a build/design vendor exposes under its own `.gov` apex (e.g. everything under
// ndstudio.gov). From each host it extracts the PROJECT being built and the candidate target
// `.gov` apex that project would launch under, so the caller can join to the registry.
//
// This is deliberately NOT what Lookout does. Lookout scores one host against label lists under an
// apex already on the watchlist, enriched with THAT apex's owner. Foundry instead names the target
// (`hstf.previews.ndstudio.gov` → project `hstf` → candidate `hstf.gov`) so a registry join can say
// which agency it belongs to and whether the target apex exists yet. Existence-only throughout: we
// read cert-derived names, never the hosts.

/** Environment/deployment tiers seen as a label in these build trees. Their presence marks a host
 *  as pre-production plumbing and is stripped when naming the project. */
export const ENV_TIERS: readonly string[] = [
  "previews", "preview", "staging", "stage", "prod", "production", "int", "internal",
  "sandbox", "sbx", "dev", "test", "qa", "uat",
];

/** Infra/CDN/service labels that are plumbing, not the product — never the project name. */
export const PLUMBING: readonly string[] = [
  "cdn", "assets", "asset", "static", "orig", "origin", "www", "media", "img", "images",
  "api", "cms", "app", "web", "edge", "send", "mail", "smtp", "databases", "database", "db",
  "auth", "sso", "analytics", "metrics", "infra", "inference", "chat", "chat-embed", "embed",
  "upload", "uploads", "storybook", "storage", "files", "assets-cdn",
];

const ENV_SET = new Set(ENV_TIERS);
const PLUMBING_SET = new Set(PLUMBING);

/** Decoration tokens spliced into a project label that don't belong to the target apex name.
 *  e.g. `mfn-trumprx` (feature prefix) → trumprx; `vote-gov` (…-gov suffix) → vote;
 *  `trump-accounts-splashpage` (page suffix) → trump-accounts. */
const DECORATION_TOKENS = new Set([
  "gov", "ndstudio", "nds", "splashpage", "splash", "landing", "page", "site",
  "mfn", "geo", "geotesting", "test", "testing", "resize", "live", "preview",
]);

/** The registrable unit of a `.gov` FQDN — its last two labels. */
export function registrableApex(fqdn: string): string {
  const parts = fqdn.toLowerCase().replace(/\.$/, "").split(".").filter(Boolean);
  return parts.length <= 2 ? parts.join(".") : parts.slice(-2).join(".");
}

/** Labels left of `apex`, outermost-first (`a.b.ndstudio.gov`,`ndstudio.gov` → ["a","b"]). */
export function labelsUnder(fqdn: string, apex: string): string[] {
  const f = fqdn.toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
  const suffix = `.${apex.toLowerCase()}`;
  if (!f.endsWith(suffix)) return [];
  return f.slice(0, -suffix.length).split(".").filter(Boolean);
}

export interface HostAttribution {
  /** The project label, e.g. "hstf", "trump-accounts", "boardofpeace", or null if none survives. */
  project: string | null;
  /** Deployment tiers present in the host (previews/staging/prod/int/…). */
  envTiers: string[];
  /** Candidate target `.gov` apexes, best-guess first, for the registry join. */
  candidateApexes: string[];
  /** Low when the project label is a single generic word likely to be vendor plumbing, not a real
   *  agency project (e.g. "rec", "search") — the caller should treat these as tentative. */
  confidence: "high" | "low";
}

/** Candidate `.gov` apexes for a project label, for the registry join. Tries the label as-is and
 *  de-hyphenated, then strips DECORATION tokens (a `-gov` suffix, an `mfn-`/`splashpage` affix) and
 *  retries — so `vote-gov`→vote.gov, `mfn-trumprx`→trumprx.gov, `trump-accounts`→trumpaccounts.gov
 *  all resolve, while a genuine multi-word name with no decorations (e.g. `fbi-kirk-tipline`) is
 *  NOT collapsed to a bare first segment (`fbi.gov`) — that would fabricate a match and hide the
 *  unlaunched signal. Segment guesses are only made by REMOVING decorations, never by picking an
 *  arbitrary word out of the middle. */
export function candidateApexes(project: string): string[] {
  const p = project.toLowerCase();
  const out: string[] = [];
  const push = (label: string) => {
    const l = label.replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
    if (l && l.length >= 2) out.push(`${l}.gov`);
  };
  push(p);
  push(p.replace(/-/g, "")); // de-hyphenated: trump-accounts → trumpaccounts
  if (p.includes("-")) {
    const meaningful = p.split("-").filter((s) => s && !DECORATION_TOKENS.has(s));
    if (meaningful.length) {
      push(meaningful.join("-")); // decorations removed, hyphens kept
      push(meaningful.join("")); // …and de-hyphenated
    }
  }
  return [...new Set(out)];
}

/**
 * Attribute one vendor-tree host to a project + candidate target apex. Returns project=null for a
 * host that is only the vendor's own plumbing (e.g. `cdn.infra.ndstudio.gov`, `storybook.…`) with
 * no product label — those are infra, not a build target.
 */
export function attributeHost(fqdn: string, vendorApex: string): HostAttribution {
  const labels = labelsUnder(fqdn, vendorApex);
  const envTiers = labels.filter((l) => ENV_SET.has(l));
  // The project is the product label: prefer the label immediately left of the first env tier;
  // otherwise the right-most (apex-adjacent) label that is neither env nor plumbing.
  const nonEnv = labels.filter((l) => !ENV_SET.has(l));
  const product = nonEnv.filter((l) => !PLUMBING_SET.has(l));

  let project: string | null = null;
  const envIdx = labels.findIndex((l) => ENV_SET.has(l));
  if (envIdx > 0) {
    // label(s) left of the env tier — take the one adjacent to it, if it's a real product label.
    const left = labels[envIdx - 1]!;
    if (!PLUMBING_SET.has(left)) project = left;
  }
  if (!project && product.length) {
    project = product[product.length - 1]!; // apex-adjacent product label (cdn.trumprx → trumprx)
  }
  if (!project) return { project: null, envTiers, candidateApexes: [], confidence: "low" };

  // A short single word is likely vendor plumbing or a feature code (rx, dga, rec), not a distinct
  // agency project — flag it tentative so the human-gated review treats it with suspicion.
  const single = !project.includes("-");
  const confidence: "high" | "low" =
    (single && project.length <= 3) || (single && project.length <= 4 && envTiers.length === 0)
      ? "low"
      : "high";
  return { project, envTiers, candidateApexes: candidateApexes(project), confidence };
}

export interface RegistryView {
  /** True if `apex` (last two labels) is a registered federal `.gov`. */
  has(apex: string): boolean;
  /** Owning org (+ optional suborg) for a registered apex, or null. */
  ownerOf(apex: string): { org: string | null; suborg: string | null } | null;
}

export interface FoundryProject {
  project: string;
  vendorApex: string;
  hosts: string[];
  envTiers: string[];
  /** The registered target apex this project resolves to, or null if none is registered yet. */
  resolvedApex: string | null;
  owningOrg: string | null;
  owningSuborg: string | null;
  confidence: "high" | "low";
}

/** Collapse a vendor tree's hosts into distinct projects, resolving each against the registry. */
export function attributeProjects(
  hosts: string[],
  vendorApex: string,
  registry: RegistryView,
): FoundryProject[] {
  const byProject = new Map<string, FoundryProject>();
  for (const fqdn of hosts) {
    const a = attributeHost(fqdn, vendorApex);
    if (!a.project) continue;
    let p = byProject.get(a.project);
    if (!p) {
      p = {
        project: a.project,
        vendorApex,
        hosts: [],
        envTiers: [],
        resolvedApex: null,
        owningOrg: null,
        owningSuborg: null,
        confidence: a.confidence,
      };
      byProject.set(a.project, p);
    }
    p.hosts.push(fqdn);
    for (const e of a.envTiers) if (!p.envTiers.includes(e)) p.envTiers.push(e);
    if (a.confidence === "high") p.confidence = "high";
    if (!p.resolvedApex) {
      for (const cand of a.candidateApexes) {
        // Never resolve a project to the vendor's own apex (self-reference isn't a build target).
        if (cand === vendorApex) continue;
        if (registry.has(cand)) {
          const owner = registry.ownerOf(cand);
          p.resolvedApex = cand;
          p.owningOrg = owner?.org ?? null;
          p.owningSuborg = owner?.suborg ?? null;
          break;
        }
      }
    }
  }
  return [...byProject.values()].sort((a, b) => a.project.localeCompare(b.project));
}

export interface ConcentrationEntry {
  org: string;
  projects: { project: string; apex: string }[];
}

/**
 * BUILD-CONCENTRATION INDEX — how many DISTINCT owning agencies stage through one vendor apex.
 * This is the signal the contact heuristics can't see: each agency's registry security contact is
 * legitimately its own (hstf.gov→dhs, war.gov→mail.mil), so Ledger's H1 and contact-concentration
 * stay silent even though the build linkage is real. Only resolved, registered projects count; the
 * index is deduped by target apex so `vote-gov`/`vote-gov-ndstudio` don't double-count.
 */
export function buildConcentrationIndex(projects: FoundryProject[]): ConcentrationEntry[] {
  const byOrg = new Map<string, Map<string, string>>(); // org -> (apex -> project)
  for (const p of projects) {
    if (!p.resolvedApex || !p.owningOrg) continue;
    let m = byOrg.get(p.owningOrg);
    if (!m) {
      m = new Map();
      byOrg.set(p.owningOrg, m);
    }
    if (!m.has(p.resolvedApex)) m.set(p.resolvedApex, p.project);
  }
  return [...byOrg.entries()]
    .map(([org, m]) => ({
      org,
      projects: [...m.entries()].map(([apex, project]) => ({ project, apex })).sort((a, b) => a.apex.localeCompare(b.apex)),
    }))
    .sort((a, b) => b.projects.length - a.projects.length || a.org.localeCompare(b.org));
}

export interface UnlaunchedProject {
  project: string;
  vendorApex: string;
  candidateApexes: string[];
  hosts: string[];
  envTiers: string[];
  confidence: "high" | "low";
}

/**
 * UNLAUNCHED-PROJECT WATCH — projects being built on the vendor tree whose candidate target apex is
 * confirmed ABSENT from the federal registry. This is what surfaced fbi-kirk-tipline, boardofpeace,
 * and forestandrangelands before any public launch — a signal Lookout structurally can't produce,
 * because it only watches apexes already on its list and never asks whether a target apex exists.
 */
export function unlaunchedProjectWatch(projects: FoundryProject[]): UnlaunchedProject[] {
  return projects
    .filter((p) => !p.resolvedApex)
    .map((p) => ({
      project: p.project,
      vendorApex: p.vendorApex,
      candidateApexes: candidateApexes(p.project),
      hosts: p.hosts,
      envTiers: p.envTiers,
      confidence: p.confidence,
    }))
    .sort((a, b) => a.project.localeCompare(b.project));
}
