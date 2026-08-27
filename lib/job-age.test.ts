import { describe, expect, test } from "vitest";
import { ageToDate, isPastThreshold, parseAgeToDays } from "./job-age";

// A fixed instant, so nothing here depends on the wall clock. Vitest runs
// with TZ set to UTC, which is why these can be asserted to the millisecond.
const REFERENCE = new Date("2024-01-15T12:00:00.000Z");

describe("parseAgeToDays: anything under a day rounds down to zero", () => {
  test("just now reads as zero days", () => {
    expect(parseAgeToDays("just now")).toBe(0);
  });

  test("a minute count reads as zero days", () => {
    expect(parseAgeToDays("7 minutes ago")).toBe(0);
  });

  test("an abbreviated hour count reads as zero days", () => {
    expect(parseAgeToDays("6h")).toBe(0);
  });

  test("a spelled-out hour count reads as zero days", () => {
    expect(parseAgeToDays("17 hours ago")).toBe(0);
  });

  test("surrounding text around an hour count is tolerated", () => {
    expect(parseAgeToDays("Posted about 2 hours ago")).toBe(0);
  });
});

describe("parseAgeToDays: single-day language reads as one day", () => {
  test("yesterday reads as one day", () => {
    expect(parseAgeToDays("yesterday")).toBe(1);
  });

  test("an abbreviated one-day count reads as one day", () => {
    expect(parseAgeToDays("1d")).toBe(1);
  });

  test("surrounding text around a one-day count is tolerated", () => {
    expect(parseAgeToDays("Posted 1 day ago")).toBe(1);
  });
});

describe("parseAgeToDays: day counts pass through unchanged", () => {
  test("a multi-day count reads as that many days", () => {
    expect(parseAgeToDays("3 days ago")).toBe(3);
  });
});

describe("parseAgeToDays: week units convert to seven-day multiples", () => {
  test("last week reads as seven days", () => {
    expect(parseAgeToDays("last week")).toBe(7);
  });

  test("an abbreviated one-week count reads as seven days", () => {
    expect(parseAgeToDays("1w")).toBe(7);
  });

  test("a multi-week count reads as seven days per week", () => {
    expect(parseAgeToDays("2 weeks ago")).toBe(14);
  });
});

describe("parseAgeToDays: month units convert to thirty-day multiples", () => {
  test("an abbreviated one-month count reads as thirty days", () => {
    expect(parseAgeToDays("1mo")).toBe(30);
  });

  test("last month reads as thirty days", () => {
    expect(parseAgeToDays("last month")).toBe(30);
  });

  test("a multi-month count reads as thirty days per month", () => {
    expect(parseAgeToDays("2 months ago")).toBe(60);
  });
});

describe("parseAgeToDays: year units convert to 365-day multiples", () => {
  test("an abbreviated one-year count reads as 365 days", () => {
    expect(parseAgeToDays("1y")).toBe(365);
  });

  test("a multi-year count reads as 365 days per year", () => {
    expect(parseAgeToDays("2 years ago")).toBe(730);
  });
});

describe("parseAgeToDays: strings that hold no age return null", () => {
  // Null is the signal a collector acts on: it stops paginating and reports
  // the string verbatim, so a site rewording its cards cannot pass unnoticed.
  test("an empty string returns null", () => {
    expect(parseAgeToDays("")).toBeNull();
  });

  test("call-to-action text with no age returns null", () => {
    expect(parseAgeToDays("Apply now")).toBeNull();
  });

  test("unrelated text returns null", () => {
    expect(parseAgeToDays("not a date")).toBeNull();
  });
});

describe("parseAgeToDays: reading is case-insensitive", () => {
  test("a capitalized day unit still reads correctly", () => {
    expect(parseAgeToDays("Yesterday")).toBe(1);
  });

  test("a capitalized multi-day count still reads correctly", () => {
    expect(parseAgeToDays("3 Days Ago")).toBe(3);
  });
});

describe("AC 70: isPastThreshold takes the threshold as a caller-supplied argument", () => {
  test("a ten-day-old job is past a five-day threshold", () => {
    expect(isPastThreshold(10, 5)).toBe(true);
  });

  test("the same ten-day-old job is not past a twenty-day threshold", () => {
    // Same age, different threshold, different answer, which is what proves
    // the number comes from the caller rather than from inside the function.
    expect(isPastThreshold(10, 20)).toBe(false);
  });

  test("a four-day-old job is past a three-day threshold", () => {
    expect(isPastThreshold(4, 3)).toBe(true);
  });

  test("a four-day-old job is not past a thirty-day threshold", () => {
    expect(isPastThreshold(4, 30)).toBe(false);
  });
});

describe("isPastThreshold: the threshold boundary is inclusive", () => {
  test("one day under the threshold is not past it", () => {
    expect(isPastThreshold(13, 14)).toBe(false);
  });

  test("exactly at the threshold counts as past it", () => {
    expect(isPastThreshold(14, 14)).toBe(true);
  });
});

describe("ageToDate: an age string becomes a date, measured back from a reference", () => {
  test("just now resolves to the reference date itself", () => {
    expect(ageToDate("just now", REFERENCE)).toEqual(REFERENCE);
  });

  test("yesterday resolves to one day before the reference date", () => {
    expect(ageToDate("yesterday", REFERENCE)).toEqual(new Date("2024-01-14T12:00:00.000Z"));
  });

  test("a multi-day count resolves that many days before the reference date", () => {
    expect(ageToDate("3 days ago", REFERENCE)).toEqual(new Date("2024-01-12T12:00:00.000Z"));
  });

  test("a week unit resolves seven days before the reference date", () => {
    expect(ageToDate("1w", REFERENCE)).toEqual(new Date("2024-01-08T12:00:00.000Z"));
  });

  test("a month unit resolves thirty days before the reference date", () => {
    expect(ageToDate("1mo", REFERENCE)).toEqual(new Date("2023-12-16T12:00:00.000Z"));
  });

  test("a year unit resolves 365 days before the reference date", () => {
    expect(ageToDate("1y", REFERENCE)).toEqual(new Date("2023-01-15T12:00:00.000Z"));
  });
});

describe("ageToDate: strings that hold no age return null", () => {
  test("an empty string returns null", () => {
    expect(ageToDate("", REFERENCE)).toBeNull();
  });

  test("unrelated text returns null", () => {
    expect(ageToDate("not a date", REFERENCE)).toBeNull();
  });
});

describe("ageToDate: the reference date defaults to now", () => {
  test("a one-day-old age lands about a day before the current time", () => {
    const dayMs = 24 * 60 * 60 * 1000;
    const before = Date.now();
    const result = ageToDate("1d");
    const after = Date.now();

    expect(result).not.toBeNull();
    // Bracketed between the call's start and end, each shifted back a day,
    // rather than freezing the clock.
    expect(result!.getTime()).toBeGreaterThanOrEqual(before - dayMs);
    expect(result!.getTime()).toBeLessThanOrEqual(after - dayMs);
  });
});
