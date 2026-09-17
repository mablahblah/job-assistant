import { describe, expect, test } from "vitest";
import { matchesCompanyName } from "./enrichment-name-match";

// Criterion 48, and the negative side of 49, 50 and 77. A search returns ten
// results about anything the words happened to hit, so a value is read only
// out of a result whose title names the employer we asked about. Measured
// against the live service, the alternative took a university's address off a
// government-contracts listing.
describe("a result title naming the employer", () => {
  test("a title holding the name matches", () => {
    expect(matchesCompanyName("Figma", "Figma Inc. - Company Profile")).toBe(true);
  });

  test("a name holding the title matches", () => {
    expect(matchesCompanyName("Duolingo Inc", "Duolingo")).toBe(true);
  });

  test("an exact title matches", () => {
    expect(matchesCompanyName("Asana", "Asana")).toBe(true);
  });

  test("case is ignored", () => {
    expect(matchesCompanyName("figma", "FIGMA INC.")).toBe(true);
  });

  test("blanks around either side are ignored", () => {
    expect(matchesCompanyName("  Figma  ", "  Figma Inc.  ")).toBe(true);
  });
});

describe("a result title naming something else", () => {
  test("an unrelated title does not match", () => {
    expect(matchesCompanyName("Figma", "San Francisco State University")).toBe(false);
  });

  // The measured weakness, carried over deliberately. The company is known as
  // "Bolna", so a stored name of "Bolna AI" misses most of its own results.
  // It is recorded rather than fixed, because fixing it is its own decision.
  test("a name longer than the world uses misses its own results", () => {
    expect(matchesCompanyName("Bolna AI", "Bolna - Voice agents")).toBe(false);
  });
});

// An empty string is contained by every string, so a blank on either side
// would match every result and hand back the first stranger's address.
describe("a blank on either side", () => {
  test.each(["", "   "])("a company name of %p matches nothing", (name) => {
    expect(matchesCompanyName(name, "Figma Inc.")).toBe(false);
  });

  test.each(["", "   "])("a title of %p matches nothing", (title) => {
    expect(matchesCompanyName("Figma", title)).toBe(false);
  });
});
