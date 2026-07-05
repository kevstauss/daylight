import { describe, expect, it } from "vitest";
import { describeFinding } from "./headline.js";

const base = { kind: "added", field: null, old_value: null, new_value: null } as const;

describe("describeFinding — deterministic, neutral headlines + why", () => {
  it("Lookout: function-mimic reads as a look-alike, not a raw fqdn", () => {
    const d = describeFinding({
      ...base,
      module: "lookout",
      domain: "ndstudio.gov",
      reason: "new subdomain vote-gov.previews.ndstudio.gov — looks like vote.gov hosted under ndstudio.gov (Executive Office of the President / White House Office)",
    });
    expect(d.headline).toBe("A subdomain of ndstudio.gov is named to look like vote.gov");
    expect(d.why).toMatch(/echoes another agency/i);
    expect(d.headline).not.toMatch(/previews\.ndstudio/); // the raw fqdn is gone from the lead
  });

  it("Lookout: high-signal label + collection label", () => {
    expect(
      describeFinding({ ...base, module: "lookout", domain: "trumpaccounts.gov", reason: "new subdomain staging.trumpaccounts.gov — high-signal subdomain label staging on trumpaccounts.gov (Department of the Treasury)" }).headline,
    ).toBe('A new "staging" subdomain appeared on trumpaccounts.gov');
    expect(
      describeFinding({ ...base, module: "lookout", domain: "ndstudio.gov", reason: "new subdomain inference.ndstudio.gov — collection/inference infrastructure label inference on ndstudio.gov (Executive Office of the President)" }).headline,
    ).toBe("A new data-collection subdomain (inference) appeared on ndstudio.gov");
  });

  it("Ledger: foreign contact, concentration, new domain, watched", () => {
    expect(
      describeFinding({ ...base, module: "ledger", domain: "usadf.gov", reason: "security contact is @ndstudio.gov, foreign to usadf.gov (United States African Development Foundation)" }).headline,
    ).toBe("usadf.gov's security contact is an address at ndstudio.gov, outside the agency");
    expect(
      describeFinding({ ...base, module: "ledger", domain: "usadf.gov", reason: "security contact @ndstudio.gov is foreign to 3 organizations it is the contact of record for (a.gov, b.gov, +1 more)" }).headline,
    ).toBe("One contact address (ndstudio.gov) is the security contact for 3 different agencies");
    expect(
      describeFinding({ ...base, module: "ledger", domain: "soarc.gov", reason: "new federal domain: soarc.gov (Department of Defense)" }).headline,
    ).toBe("Department of Defense registered a new federal domain: soarc.gov");
    expect(
      describeFinding({ ...base, module: "ledger", domain: "fraud.gov", reason: 'watched org "Executive Office of the President" on new domain fraud.gov' }).headline,
    ).toBe("A new domain, fraud.gov, is registered to Executive Office of the President");
  });

  it("Receipts: the removal ledger reads as an action by the host", () => {
    expect(
      describeFinding({ ...base, module: "receipts", kind: "removed", domain: "trumpaccounts.gov", reason: "tracker removed from https://trumpaccounts.gov/: PostHog@us.i.posthog.com" }).headline,
    ).toBe("trumpaccounts.gov quietly removed a tracker (PostHog)");
    expect(
      describeFinding({ ...base, module: "receipts", kind: "removed", domain: "eac.gov", reason: "privacy notice removed from https://eac.gov/vote" }).headline,
    ).toBe("eac.gov removed its privacy notice");
    expect(
      describeFinding({ ...base, module: "receipts", domain: "passports.gov", reason: "https://passports.gov/ now redirects off-domain to https://travel.state.gov/passport" }).headline,
    ).toBe("passports.gov now redirects visitors off its own domain to travel.state.gov");
  });

  it("Floodlight: tracker + missing-notice shapes are recognized (not just Receipts)", () => {
    expect(
      describeFinding({ ...base, module: "floodlight", domain: "weather.gov", reason: "tracker added on https://weather.gov/: Digital Analytics Program (DAP)@dap.digitalgov.gov" }).headline,
    ).toBe("weather.gov added a tracker (Digital Analytics Program (DAP))");
    expect(
      describeFinding({ ...base, module: "floodlight", domain: "example.gov", reason: "page collects PII but has no linked privacy notice" }).headline,
    ).toBe("example.gov collects personal data but links no privacy notice");
  });

  it("Foundry: an unlaunched project reads as staging on a vendor", () => {
    const d = describeFinding({ ...base, module: "foundry", domain: "staging-api.gov", reason: 'unlaunched project "staging-api" building on passports.gov — no staging-api.gov registered yet' });
    expect(d.headline).toBe('An unlaunched site, "staging-api", is being built on passports.gov');
    expect(d.why).toMatch(/before any public announcement/i);
  });

  it("falls back to the detector's wording (de-jargoned) for an unknown shape", () => {
    const d = describeFinding({ ...base, module: "floodlight", domain: "x.gov", reason: "session replay beacon observed on x.gov" });
    expect(d.headline).toBe("Session replay beacon observed on x.gov");
    const empty = describeFinding({ ...base, module: "ledger", domain: "y.gov", reason: null });
    expect(empty.headline).toBe("y.gov changed");
  });

  it("never leaks a verdict word into a headline (stays observational)", () => {
    const reasons = [
      "new subdomain vote-gov.previews.ndstudio.gov — looks like vote.gov hosted under ndstudio.gov",
      "security contact is @ndstudio.gov, foreign to usadf.gov (US ADF)",
      "tracker removed from https://trumprx.gov/: Clarity@t.clarity.ms",
    ];
    for (const reason of reasons) {
      const { headline, why } = describeFinding({ ...base, module: "lookout", domain: "z.gov", reason });
      expect(`${headline} ${why}`.toLowerCase()).not.toMatch(/illegal|unlawful|broke the law|violat|caught/);
    }
  });
});
