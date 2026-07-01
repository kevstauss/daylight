import { describe, expect, it } from "vitest";
import { classifyChangeFlag, type FlagClassifiable } from "./flag.js";

const c = (over: Partial<FlagClassifiable>): FlagClassifiable => ({
  kind: "modified",
  field: null,
  severity: "info",
  reason: null,
  ...over,
});

describe("classifyChangeFlag", () => {
  it("flags a contact-domain mismatch (H1) from its reason", () => {
    expect(
      classifyChangeFlag(c({ kind: "added", reason: "security contact is @ndstudio.gov, foreign to usadf.gov (US African Development Foundation)" })),
    ).toBe("contact-mismatch");
  });

  it("flags a watchlist hit before falling back to kind", () => {
    // A watched-org hit rides on an `added` change — watchlist must win over new-domain.
    expect(classifyChangeFlag(c({ kind: "added", reason: 'watched organization "Executive Office of the President" on new domain fraud.gov' }))).toBe(
      "watchlist",
    );
  });

  it("classifies plain new domains and removals", () => {
    expect(classifyChangeFlag(c({ kind: "added", reason: "new federal domain: soarc.gov (Department of Defense)" }))).toBe("new-domain");
    expect(classifyChangeFlag(c({ kind: "removed", reason: null }))).toBe("removed");
  });

  it("distinguishes a contact change from an owner change", () => {
    expect(classifyChangeFlag(c({ kind: "modified", field: "securityContactEmail" }))).toBe("contact-change");
    expect(classifyChangeFlag(c({ kind: "modified", field: "org" }))).toBe("owner-change");
    expect(classifyChangeFlag(c({ kind: "modified", field: "suborg" }))).toBe("owner-change");
  });

  it("falls back to other for an unclassified modification", () => {
    expect(classifyChangeFlag(c({ kind: "modified", field: "city" }))).toBe("other");
  });
});
