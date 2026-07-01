import { describe, expect, it } from "vitest";
import { parseWatchlist, watchSubscriptions } from "./watchlist.js";

const YAML = `
apex_domains:
  - NDStudio.gov
  - usadf.gov
comparators:
  vote.gov: EAC.gov
person_watch:
  - "@ndstudio.gov"
org_watch:
  - "Executive Office of the President"
suborg_watch:
  - "Department of Government Efficiency"
  - "White House Office"
central_security_allowlist:
  - eop.gov
  - gsa.gov
subdomain_flags:
  high: [previews, staging]
  notable: [api, cdn]
known_subdomains_seen:
  - previews.ndstudio.gov
`;

describe("parseWatchlist", () => {
  const wl = parseWatchlist(YAML);

  it("lowercases apex domains", () => {
    expect(wl.apexDomains).toContain("ndstudio.gov");
    expect(wl.apexDomains).not.toContain("NDStudio.gov");
  });

  it("lowercases comparator keys and values", () => {
    expect(wl.comparators["vote.gov"]).toBe("eac.gov");
  });

  it("preserves org/suborg casing for display, matched case-insensitively downstream", () => {
    expect(wl.orgWatch).toEqual(["Executive Office of the President"]);
    expect(wl.suborgWatch).toContain("Department of Government Efficiency");
  });

  it("splits subdomain flags by severity", () => {
    expect(wl.subdomainFlags.high).toContain("previews");
    expect(wl.subdomainFlags.notable).toContain("api");
  });

  it("builds person/org/suborg subscriptions", () => {
    const subs = watchSubscriptions(wl);
    expect(subs.filter((s) => s.kind === "person")).toHaveLength(1);
    expect(subs.filter((s) => s.kind === "org")).toHaveLength(1);
    expect(subs.filter((s) => s.kind === "suborg")).toHaveLength(2);
  });
});
