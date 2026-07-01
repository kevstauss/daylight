import { describe, expect, it } from "vitest";
import { registrableDomain } from "./index.js";

describe("registrableDomain — public-suffix aware eTLD+1", () => {
  it("single-label suffixes use the last two labels (.gov / .com)", () => {
    expect(registrableDomain("foo.example.gov")).toBe("example.gov");
    expect(registrableDomain("a.b.c.example.com")).toBe("example.com");
    expect(registrableDomain("example.gov")).toBe("example.gov");
  });

  it("US .us locality suffixes don't collide distinct registrants (the k12 case)", () => {
    expect(registrableDomain("www.smithville.k12.tx.us")).toBe("smithville.k12.tx.us");
    expect(registrableDomain("analytics.k12.tx.us")).toBe("analytics.k12.tx.us");
    expect(registrableDomain("dmv.tx.us")).toBe("dmv.tx.us");
    // two different Texas school districts must NOT reduce to the same registrable domain
    expect(registrableDomain("a.smithville.k12.tx.us")).not.toBe(
      registrableDomain("a.austin.k12.tx.us"),
    );
    // ...and neither collapses to the bare public suffix
    expect(registrableDomain("a.smithville.k12.tx.us")).not.toBe("tx.us");
  });

  it("common ccTLD second-levels resolve correctly", () => {
    expect(registrableDomain("www.bbc.co.uk")).toBe("bbc.co.uk");
    expect(registrableDomain("shop.example.com.au")).toBe("example.com.au");
  });
});
