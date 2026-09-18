import { describe, expect, test } from "vitest";
import fixture from "./company-names.fixture.json";
import { normalizeCompanyName } from "./company-name";

describe("normalizeCompanyName: leading and trailing whitespace", () => {
  test("an empty string returns an empty string", () => {
    expect(normalizeCompanyName("")).toBe("");
  });

  test("a name that is nothing but whitespace tidies to an empty string", () => {
    expect(normalizeCompanyName("   ")).toBe("");
  });

  test.each([
    ["Bjak ", "Bjak"],
    ["Zynga ", "Zynga"],
    ["Voodoo ", "Voodoo"],
  ])("a trailing space is trimmed: %s", (raw, expected) => {
    expect(normalizeCompanyName(raw)).toBe(expected);
  });

  test("a leading space is trimmed", () => {
    expect(normalizeCompanyName(" Bjak")).toBe("Bjak");
  });
});

describe("normalizeCompanyName: internal runs of whitespace collapse to one space", () => {
  test("a doubled internal space in Tech Mahindra  Inc. collapses to one", () => {
    expect(normalizeCompanyName("Tech Mahindra  Inc.")).toBe("Tech Mahindra Inc");
  });
});

describe("normalizeCompanyName: trailing punctuation is dropped, whatever it is", () => {
  test("a name that is nothing but punctuation tidies to an empty string", () => {
    expect(normalizeCompanyName("...")).toBe("");
  });

  test.each([
    ["22nd Century Technologies, Inc.", "22nd Century Technologies, Inc"],
    ["Apple, Inc.", "Apple, Inc"],
    ["Bumble Inc.", "Bumble Inc"],
    ["Brain Co.", "Brain Co"],
    ["The Computer Merchant, LTD.", "The Computer Merchant, LTD"],
    ["COMMLOAN, INC.", "COMMLOAN, INC"],
  ])("a trailing period is dropped: %s", (raw, expected) => {
    expect(normalizeCompanyName(raw)).toBe(expected);
  });

  test("a trailing registered-trademark mark is dropped: DEPT®", () => {
    // The rule drops trailing punctuation "whatever it is" rather than a
    // fixed list of marks, so a symbol like this is caught too.
    expect(normalizeCompanyName("DEPT®")).toBe("DEPT");
  });

  test("only the final period is dropped from Levi, Ray & Shoup, Inc.", () => {
    // The comma before "Inc" sits inside the name, not at the end, so it
    // survives; only the period after "Inc" is trailing punctuation.
    expect(normalizeCompanyName("Levi, Ray & Shoup, Inc.")).toBe("Levi, Ray & Shoup, Inc");
  });

  test("a trailing space and a trailing period are both cleared from Meta Platforms", () => {
    expect(normalizeCompanyName("Meta Platforms, Inc. ")).toBe("Meta Platforms, Inc");
  });
});

describe("normalizeCompanyName: case is left exactly as the source wrote it", () => {
  test("all-caps stays all-caps", () => {
    // Deciding that different casings name one employer is a matching
    // judgement for company association, not this cosmetic tidy.
    expect(normalizeCompanyName("AMAZON")).toBe("AMAZON");
  });

  test("lower case stays lower case", () => {
    expect(normalizeCompanyName("hims & hers")).toBe("hims & hers");
  });
});

describe("normalizeCompanyName: internal spacing is left exactly as the source wrote it", () => {
  test("a space inside a name is not joined into one word", () => {
    // "Git lab" and "GitLab" naming one employer is a matching judgement for
    // company association, not this cosmetic tidy.
    expect(normalizeCompanyName("Git lab")).toBe("Git lab");
  });
});

describe("normalizeCompanyName: nothing but whitespace and trailing punctuation is touched", () => {
  test.each([
    "M&T Bank",
    "S&P Global",
    "Realtor.com Careers",
    "Grüns",
    "Ōura",
    "1Password",
    "3Commas",
  ])("%s is returned unchanged", (name) => {
    expect(normalizeCompanyName(name)).toBe(name);
  });

  test("a bare LLC with no trailing punctuation is left alone", () => {
    // No word like "LLC" or "Ltd" is stripped, so a name ending in one with
    // nothing trailing after it passes through untouched.
    expect(normalizeCompanyName("Altria Client Services LLC")).toBe("Altria Client Services LLC");
  });

  test("a Careers suffix with no trailing punctuation is left alone", () => {
    expect(normalizeCompanyName("DFBooking Careers")).toBe("DFBooking Careers");
  });

  test("a leading The is left alone", () => {
    expect(normalizeCompanyName("The Clearing")).toBe("The Clearing");
  });

  test("an HTML entity is not decoded", () => {
    // Entity decoding, where it belongs, happens before this function sees
    // the text; normalization does not interpret the string's markup.
    expect(normalizeCompanyName("Bloom &amp; Wild Group")).toBe("Bloom &amp; Wild Group");
  });
});

describe("normalizeCompanyName: running it twice matches running it once", () => {
  // raw_company_name is overwritten in place with no copy of the source
  // spelling kept, so a second pass must not change a name a first pass
  // already cleaned — otherwise the value drifts with nothing able to
  // detect it.
  test("the fixture holds names to prove this against", () => {
    expect(fixture.length).toBeGreaterThan(0);
  });

  test("every name in the fixture is a fixed point after one normalization", () => {
    const drifted = (fixture as string[])
      .map((raw) => {
        const once = normalizeCompanyName(raw);
        return { raw, once, twice: normalizeCompanyName(once) };
      })
      .filter(({ once, twice }) => once !== twice);
    // Collecting the offending names rather than counting them means a
    // failure names exactly which spelling drifted.
    expect(drifted).toEqual([]);
  });
});
