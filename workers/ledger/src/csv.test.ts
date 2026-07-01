import { describe, expect, it } from "vitest";
import { isRecognizedHeader, parseCsv, verifyHeader } from "./csv.js";
import { normalizeCsv } from "./normalize.js";

const H_2019 = "Domain Name,Domain Type,Agency,Organization,City,State,Security Contact Email,,,";
const H_MID = "Domain name,Domain type,Agency,Organization name,City,State,Security contact email";
const H_NOW = "Domain name,Domain type,Organization name,Suborganization name,City,State,Security contact email";
const ROW_2019 = "gsa.gov,Federal - Executive,General Services Administration,Technology Transformation Services,Washington,DC,security@gsa.gov,,,";

describe("CISA header recognition across schema eras", () => {
  it("verifyHeader is STRICT — only the current header passes (live pass fails loud on drift)", () => {
    expect(verifyHeader(parseCsv(H_NOW + "\n").header)).toBe(true);
    expect(verifyHeader(parseCsv(H_MID + "\n").header)).toBe(false);
    expect(verifyHeader(parseCsv(H_2019 + "\n").header)).toBe(false);
  });

  it("isRecognizedHeader accepts the current + known historical headers, rejects unknown", () => {
    expect(isRecognizedHeader(parseCsv(H_NOW + "\n").header)).toBe(true);
    expect(isRecognizedHeader(parseCsv(H_MID + "\n").header)).toBe(true);
    expect(isRecognizedHeader(parseCsv(H_2019 + "\n").header)).toBe(true);
    // An unfamiliar 7-column layout must NOT be trusted (never mis-map).
    expect(isRecognizedHeader(["A", "B", "C", "D", "E", "F", "G"])).toBe(false);
  });

  it("normalizeCsv maps a 2019-format row positionally only when allowHistorical is set", () => {
    const strict = normalizeCsv(`${H_2019}\n${ROW_2019}\n`);
    expect(strict.headerOk).toBe(false);
    expect(strict.records).toHaveLength(0);

    const hist = normalizeCsv(`${H_2019}\n${ROW_2019}\n`, { allowHistorical: true });
    expect(hist.headerOk).toBe(true);
    expect(hist.records).toHaveLength(1);
    const rec = hist.records[0]!;
    expect(rec.domain).toBe("gsa.gov");
    expect(rec.org).toBe("General Services Administration"); // col 2 (Agency) → top-level org
    expect(rec.suborg).toBe("Technology Transformation Services"); // col 3 → sub-org
    expect(rec.securityContactEmail).toBe("security@gsa.gov"); // col 6, trailing empties ignored
  });
});
