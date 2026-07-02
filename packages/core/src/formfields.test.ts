import { describe, expect, it } from "vitest";
import { classifyFormFields, hasSensitivePii, parseInputAttrs } from "./index.js";

describe("PII form-field classifier (task 10)", () => {
  it("keeps the type-based kinds (email/tel/password/file)", () => {
    const kinds = classifyFormFields([
      { type: "email" },
      { type: "tel" },
      { type: "password" },
      { type: "file" },
    ]);
    expect(kinds).toEqual(["email", "file", "password", "tel"]);
  });

  it("detects SSN / DOB / passport / name on type=text via name & id patterns", () => {
    const kinds = classifyFormFields([
      { type: "text", name: "ssn" },
      { type: "text", id: "date_of_birth" },
      { type: "text", name: "passport_number" },
      { type: "text", name: "first_name" },
    ]);
    expect(kinds).toEqual(["dob", "name", "passport", "ssn"]);
  });

  it("detects the A-number (immigration) pattern", () => {
    expect(classifyFormFields([{ type: "text", name: "a-number" }])).toEqual(["a-number"]);
    expect(classifyFormFields([{ type: "text", placeholder: "USCIS number" }])).toEqual(["a-number"]);
  });

  it("detects split / affixed SSN field names (ssn1, applicant_ssn, ssnPart1)", () => {
    // The 3-2-4 split layout + underscore/camelCase-prefixed names are common on federal/tax forms
    // and must not slip past `\bssn\b` (digits and underscores are word chars, so no boundary).
    expect(classifyFormFields([{ type: "text", name: "ssn1" }])).toEqual(["ssn"]);
    expect(classifyFormFields([{ type: "tel", name: "ssn2" }])).toEqual(["ssn", "tel"]);
    expect(classifyFormFields([{ type: "text", name: "applicant_ssn" }])).toEqual(["ssn"]);
    expect(classifyFormFields([{ type: "text", id: "ssnPart1" }])).toEqual(["ssn"]);
  });

  it("detects kinds via the autocomplete attribute", () => {
    const kinds = classifyFormFields([
      { type: "text", autocomplete: "bday" },
      { type: "text", autocomplete: "family-name" },
      { type: "text", autocomplete: "street-address" },
    ]);
    expect(kinds).toEqual(["address", "dob", "name"]);
  });

  it("classifies an image file input as photo collection (the passports.gov tell)", () => {
    expect(classifyFormFields([{ type: "file", accept: "image/jpeg" }])).toEqual(["photo"]);
    expect(classifyFormFields([{ type: "file", accept: "application/pdf" }])).toEqual(["file"]);
  });

  it("a bare text/submit field is NOT PII", () => {
    expect(classifyFormFields([{ type: "text", name: "q" }, { type: "submit" }])).toEqual([]);
  });

  it("parseInputAttrs reads attributes regardless of order", () => {
    const html = `<input name="ssn" type="text" /><input type="email"><input type="file" accept="image/png" name="headshot">`;
    expect(classifyFormFields(parseInputAttrs(html))).toEqual(["email", "photo", "ssn"]);
  });

  it("hasSensitivePii is true only for high-sensitivity kinds", () => {
    expect(hasSensitivePii(["email", "ssn"])).toBe(true);
    expect(hasSensitivePii(["passport"])).toBe(true);
    expect(hasSensitivePii(["email", "name", "address"])).toBe(false);
  });
});
