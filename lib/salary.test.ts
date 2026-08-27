import { describe, expect, test } from "vitest";
import { normalizeSalary, type SalaryPeriod } from "./salary";

describe("normalizeSalary: nothing to report", () => {
  test("neither a low nor a high gives an entirely empty object", () => {
    expect(normalizeSalary({})).toEqual({});
  });

  test("null for both is treated the same as absent", () => {
    expect(normalizeSalary({ low: null, high: null })).toEqual({});
  });

  test("AC 84: a period and a currency with no numbers still give nothing", () => {
    expect(normalizeSalary({ period: "year", currency: "USD" })).toEqual({});
  });

  test("AC 84: an empty result carries no salary_raw either", () => {
    expect(normalizeSalary({}).salary_raw).toBeUndefined();
  });
});

describe("normalizeSalary: the numbers", () => {
  test("a low and a high are carried through unchanged", () => {
    const result = normalizeSalary({ low: 140000, high: 210000 });
    expect(result.salary_low).toBe(140000);
    expect(result.salary_high).toBe(210000);
  });

  test("a low on its own is carried through, with the high left undefined", () => {
    const result = normalizeSalary({ low: 141600 });
    expect(result.salary_low).toBe(141600);
    expect(result.salary_high).toBeUndefined();
  });

  test("a high on its own is carried through, with the low left undefined", () => {
    const result = normalizeSalary({ high: 254900 });
    expect(result.salary_high).toBe(254900);
    expect(result.salary_low).toBeUndefined();
  });

  test("a fractional low is rounded to a whole unit", () => {
    // Adzuna publishes figures like 134044.9, and the column is a whole
    // number, so an unrounded figure would only fail at save time.
    expect(normalizeSalary({ low: 134044.9 }).salary_low).toBe(134045);
  });

  test("a fractional high is rounded to a whole unit", () => {
    expect(normalizeSalary({ high: 254900.4 }).salary_high).toBe(254900);
  });

  test("the rounded figure is what reaches salary_raw", () => {
    expect(normalizeSalary({ low: 134044.9 }).salary_raw).toContain("134045");
  });

  test("a low of 0 is a real value and is carried, not treated as absent", () => {
    // An unpaid role is a real figure rather than a stand-in for missing data.
    expect(normalizeSalary({ low: 0, high: 50000 }).salary_low).toBe(0);
  });
});

describe("AC 82: the period defaults to a year", () => {
  test("no period given gives year", () => {
    // Adzuna and Greenhouse both publish annual figures and state no period.
    expect(normalizeSalary({ low: 140000, high: 210000 }).salary_period).toBe("year");
  });

  test("an empty-string period gives year", () => {
    expect(normalizeSalary({ low: 140000, period: "" }).salary_period).toBe("year");
  });
});

describe("AC 83: a stated period wins", () => {
  const cases: Array<{ raw: string; expected: SalaryPeriod }> = [
    { raw: "YEAR", expected: "year" },
    { raw: "HOUR", expected: "hour" },
    { raw: "MONTH", expected: "month" },
    { raw: "WEEK", expected: "week" },
    { raw: "DAY", expected: "day" },
  ];

  test.each(cases)("$raw gives $expected", ({ raw, expected }) => {
    expect(normalizeSalary({ low: 100, high: 200, period: raw }).salary_period).toBe(expected);
  });

  test("lower case is read the same way as upper case", () => {
    expect(normalizeSalary({ low: 100, period: "hour" }).salary_period).toBe("hour");
  });

  test("mixed case is read the same way as upper case", () => {
    expect(normalizeSalary({ low: 100, period: "Hour" }).salary_period).toBe("hour");
  });

  test("a period the util does not recognise leaves salary_period undefined", () => {
    // A wrong guess must never reach the database, so an unknown word is
    // dropped rather than mapped to the nearest-looking period.
    expect(normalizeSalary({ low: 100, period: "fortnight" }).salary_period).toBeUndefined();
  });

  test("an unrecognised period still appears in salary_raw, so nothing is lost", () => {
    expect(normalizeSalary({ low: 100, period: "fortnight" }).salary_raw).toContain("fortnight");
  });
});

describe("normalizeSalary: salary_raw records what the source published", () => {
  test("a low and a high give a raw string holding both numbers", () => {
    const result = normalizeSalary({ low: 140000, high: 210000 });
    expect(result.salary_raw).toContain("140000");
    expect(result.salary_raw).toContain("210000");
  });

  test("a currency, where the source states one, appears in the raw string", () => {
    expect(normalizeSalary({ low: 140000, high: 210000, currency: "USD" }).salary_raw).toContain(
      "USD"
    );
  });

  test("the period appears in the raw string", () => {
    expect(normalizeSalary({ low: 100, high: 200, period: "HOUR" }).salary_raw).toContain("hour");
  });

  test("a low on its own gives a raw string holding that number", () => {
    expect(normalizeSalary({ low: 141600 }).salary_raw).toContain("141600");
  });

  test("the raw string is a plain, readable line rather than JSON", () => {
    expect(normalizeSalary({ low: 140000, high: 210000 }).salary_raw).not.toMatch(/[{}[\]"]/);
  });
});
