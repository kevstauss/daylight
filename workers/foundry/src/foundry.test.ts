import { describe, expect, it } from "vitest";
import {
  attributeHost,
  attributeProjects,
  buildConcentrationIndex,
  candidateApexes,
  unlaunchedProjectWatch,
  type RegistryView,
} from "./attribute.js";

// A fixture registry mirroring the live CISA current-federal.csv for the apexes these hosts
// resolve to. Vendor apex ndstudio.gov is EOP; the target apexes span multiple agencies; the
// unlaunched projects (boardofpeace/fbikirktipline/forestandrangelands/…) are deliberately ABSENT.
const REGISTRY: Record<string, { org: string; suborg: string | null }> = {
  "ndstudio.gov": { org: "Executive Office of the President", suborg: "White House Office" },
  "trumprx.gov": { org: "Executive Office of the President", suborg: "White House Office" },
  "nasaforce.gov": { org: "Executive Office of the President", suborg: "White House Office" },
  "trumpaccounts.gov": { org: "Department of the Treasury", suborg: null },
  "vote.gov": { org: "Election Assistance Commission", suborg: null },
  "war.gov": { org: "Department of Defense", suborg: null },
  "hstf.gov": { org: "Department of Homeland Security", suborg: "Management Directorate" },
  "america.gov": { org: "Department of State", suborg: "Bureau of Global Public Affairs" },
  "rec.gov": { org: "Department of Agriculture", suborg: "Forest Service" },
  "cio.gov": { org: "General Services Administration", suborg: null },
  "fbi.gov": { org: "Department of Justice", suborg: "Federal Bureau of Investigation" },
};
const registry: RegistryView = {
  has: (a) => a.toLowerCase() in REGISTRY,
  ownerOf: (a) => REGISTRY[a.toLowerCase()] ?? null,
};

// Real subdomains observed under ndstudio.gov in CT (existence-only fixtures).
const HOSTS = [
  "hstf.previews.ndstudio.gov",
  "hstf.prod.ndstudio.gov",
  "war.previews.ndstudio.gov",
  "nasaforce.staging.ndstudio.gov",
  "trump-accounts.previews.ndstudio.gov",
  "trump-accounts-splashpage.previews.ndstudio.gov",
  "vote-gov.previews.ndstudio.gov",
  "vote-gov-ndstudio.previews.ndstudio.gov",
  "trumprx.ndstudio.gov",
  "cdn.trumprx.ndstudio.gov",
  "geo-testing.trumprx.ndstudio.gov",
  "mfn-trumprx.ndstudio.gov",
  "cio.previews.ndstudio.gov",
  "america.ndstudio.gov",
  "rec.previews.ndstudio.gov",
  "fbi-kirk-tipline.previews.ndstudio.gov",
  "boardofpeace.previews.ndstudio.gov",
  "forestandrangelands.previews.ndstudio.gov",
  "merry.previews.ndstudio.gov",
  "dga.previews.ndstudio.gov",
  "sweetrex.int.ndstudio.gov",
  "sr-input.int.ndstudio.gov",
  // pure plumbing — must NOT become projects
  "cdn.infra.ndstudio.gov",
  "analytics.infra.ndstudio.gov",
  "storybook.ndstudio.gov",
];

describe("attributeHost", () => {
  it("extracts the project left of the env tier", () => {
    expect(attributeHost("hstf.previews.ndstudio.gov", "ndstudio.gov").project).toBe("hstf");
    expect(attributeHost("trump-accounts.previews.ndstudio.gov", "ndstudio.gov").project).toBe("trump-accounts");
    expect(attributeHost("nasaforce.staging.ndstudio.gov", "ndstudio.gov").envTiers).toContain("staging");
  });

  it("skips CDN/infra past a plumbing label to the product (cdn.trumprx → trumprx)", () => {
    expect(attributeHost("cdn.trumprx.ndstudio.gov", "ndstudio.gov").project).toBe("trumprx");
    expect(attributeHost("geo-testing.trumprx.ndstudio.gov", "ndstudio.gov").project).toBe("trumprx");
  });

  it("returns no project for the vendor's own plumbing", () => {
    expect(attributeHost("cdn.infra.ndstudio.gov", "ndstudio.gov").project).toBeNull();
    expect(attributeHost("storybook.ndstudio.gov", "ndstudio.gov").project).toBeNull();
  });
});

describe("candidateApexes", () => {
  it("resolves decorated names to the real apex without fabricating a bare-segment match", () => {
    expect(candidateApexes("vote-gov")).toContain("vote.gov");
    expect(candidateApexes("mfn-trumprx")).toContain("trumprx.gov");
    expect(candidateApexes("trump-accounts")).toContain("trumpaccounts.gov");
    // a genuine multi-word name must NOT collapse to its first word (fbi.gov exists — false match)
    expect(candidateApexes("fbi-kirk-tipline")).not.toContain("fbi.gov");
    expect(candidateApexes("fbi-kirk-tipline")).toContain("fbikirktipline.gov");
  });
});

describe("buildConcentrationIndex", () => {
  const projects = attributeProjects(HOSTS, "ndstudio.gov", registry);
  const index = buildConcentrationIndex(projects);
  const orgs = index.map((e) => e.org);

  it("surfaces the cross-agency build concentration Lookout/Ledger cannot", () => {
    // Multiple distinct owning agencies stage through the one EOP vendor tree.
    expect(orgs).toContain("Department of Homeland Security");
    expect(orgs).toContain("Department of Defense");
    expect(orgs).toContain("Department of the Treasury");
    expect(orgs).toContain("Department of State");
    expect(orgs).toContain("Election Assistance Commission");
    expect(index.length).toBeGreaterThanOrEqual(5);
  });

  it("dedups vote-gov / vote-gov-ndstudio to one vote.gov entry", () => {
    const eac = index.find((e) => e.org === "Election Assistance Commission");
    expect(eac?.projects.filter((p) => p.apex === "vote.gov")).toHaveLength(1);
  });

  it("keeps each agency's own contact legitimate — this is the H1-silent gap", () => {
    // hstf.gov resolves to DHS here; in the registry its contact is postmaster@dhs.gov, so Ledger's
    // H1 never fires — yet Foundry still ties the build to DHS. That's the whole point of the join.
    const dhs = index.find((e) => e.org === "Department of Homeland Security");
    expect(dhs?.projects.some((p) => p.apex === "hstf.gov")).toBe(true);
  });
});

describe("unlaunchedProjectWatch", () => {
  const projects = attributeProjects(HOSTS, "ndstudio.gov", registry);
  const watch = unlaunchedProjectWatch(projects);
  const names = watch.map((w) => w.project);

  it("flags projects whose target apex is not yet in the registry", () => {
    expect(names).toContain("fbi-kirk-tipline");
    expect(names).toContain("boardofpeace");
    expect(names).toContain("forestandrangelands");
    expect(names).toContain("sweetrex");
  });

  it("does not flag a project that resolves to a registered apex", () => {
    expect(names).not.toContain("hstf");
    expect(names).not.toContain("war");
    expect(names).not.toContain("trump-accounts");
  });

  it("marks short single-word codes low-confidence (dga, rx) but keeps real names high", () => {
    const dga = watch.find((w) => w.project === "dga");
    expect(dga?.confidence).toBe("low");
    const bop = watch.find((w) => w.project === "boardofpeace");
    expect(bop?.confidence).toBe("high");
  });
});
