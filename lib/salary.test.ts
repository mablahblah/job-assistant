import { describe, expect, test } from "vitest";
import fixture from "./description-fields.fixture.json";
import { normalizeSalary, readSalaryFromText, type SalaryPeriod } from "./salary";

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

describe("AC 86: a pay range stated in a description fills all four salary fields", () => {
  test("the low, the high and the period are all read", () => {
    const result = readSalaryFromText("The pay range for this role is $120,000 - $150,000 per year.");
    expect(result.salary_low).toBe(120000);
    expect(result.salary_high).toBe(150000);
    expect(result.salary_period).toBe("year");
  });

  test("salary_raw holds the source's own wording rather than the numbers rebuilt", () => {
    const raw = readSalaryFromText("Salary: $182,208 - $236,580/yr. This range represents base pay.")
      .salary_raw;
    expect(raw).toContain("182,208");
    expect(raw).toContain("236,580");
  });
});

describe("AC 88: a description holding no readable range leaves every field empty", () => {
  test("nothing is filled in and nothing is guessed", () => {
    expect(
      readSalaryFromText("We offer great benefits and a collaborative, mission-driven culture.")
    ).toEqual({});
  });
});

describe("AC 89: money that is not pay is never read as a salary", () => {
  test.each([
    "Save for the future with our traditional or Roth 401k retirement plan options.",
    "Flexible retirement savings through Traditional or Roth 401(k) investment paths.",
    "Product Sales is tasked with attacking a $100B market opportunity.",
    "Modern Health raised more than $170 million in less than two years.",
    "Businesses on HighLevel have generated over $7 billion in ecosystem value.",
    "This role includes a $10,000 signing bonus paid within 30 days.",
    "Total equity grant ranges between 0.10% and 0.35% of the company.",
  ])("no salary is read from: %s", (text) => {
    expect(readSalaryFromText(text)).toEqual({});
  });
});

describe("AC 91: a period the description states overrides the yearly default", () => {
  const cases: Array<{ text: string; expected: SalaryPeriod }> = [
    { text: "$100,000 - $120,000/yr", expected: "year" },
    { text: "$100,000 - $120,000/Yr", expected: "year" },
    { text: "$100,000 - $120,000 per year", expected: "year" },
    { text: "$100,000 - $120,000 annually", expected: "year" },
    { text: "$100,000 - $120,000 per annum", expected: "year" },
    { text: "$41.96 - $53.23 per hour", expected: "hour" },
    { text: "$41.96 - $53.23 hourly", expected: "hour" },
    { text: "$5,000 - $6,500 per month", expected: "month" },
    { text: "$5,000 - $6,500 monthly", expected: "month" },
  ];

  test.each(cases)("$text reads as $expected", ({ text, expected }) => {
    expect(readSalaryFromText(text).salary_period).toBe(expected);
  });
});

describe("where no period is stated, the size of the figures settles it", () => {
  // Stated hourly rates ran from $17.84 to $41.96 and stated yearly ones
  // began at $108,000, with nothing at all in between.
  test("two figures under a thousand read as an hourly rate", () => {
    expect(readSalaryFromText("The pay range is $17.84 - $41.96.").salary_period).toBe("hour");
  });

  test("two figures of a thousand or more read as a yearly salary", () => {
    expect(readSalaryFromText("The pay range is $108,000 - $130,000.").salary_period).toBe("year");
  });

  test("one figure under a thousand and one above it still reads as yearly", () => {
    expect(readSalaryFromText("The pay range is $500 - $1,500.").salary_period).toBe("year");
  });
});

describe("every separator these boards publish is read the same way", () => {
  test.each([
    "$100,000 - $120,000",
    "$100,000 – $120,000",
    "$100,000 — $120,000",
    "$100,000 to $120,000",
    "between $100,000 and $120,000",
  ])("a range written %s is read as 100000 to 120000", (text) => {
    const result = readSalaryFromText(text);
    expect(result.salary_low).toBe(100000);
    expect(result.salary_high).toBe(120000);
  });
});

describe("a currency is read whether it leads or trails the figures", () => {
  test.each([
    "$100,000 - $120,000",
    "£100,000 - £120,000",
    "€100,000 - €120,000",
    "USD 100,000 - 120,000",
    "100,000 - 120,000 USD",
    "CAD 100,000 - 120,000",
    "100,000 - 120,000 CAD",
    "GBP 100,000 - 120,000",
    "EUR 100,000 - 120,000",
  ])("a range written %s is still read", (text) => {
    const result = readSalaryFromText(text);
    expect(result.salary_low).toBe(100000);
    expect(result.salary_high).toBe(120000);
  });

  test.each([
    ["€57,000-63,000", 57000, 63000],
    ["$156,400 - 195,500", 156400, 195500],
    ["CAD 132,000–150,000", 132000, 150000],
  ])("%s marks only the low figure and both are still read", (text, low, high) => {
    const result = readSalaryFromText(text);
    expect(result.salary_low).toBe(low);
    expect(result.salary_high).toBe(high);
  });
});

describe("a stray space inside a figure does not break the range", () => {
  test("Asana's space before the last three digits still reads 261000", () => {
    expect(readSalaryFromText("$207,000 – $261, 000").salary_high).toBe(261000);
  });

  test("Intercom's space after the currency mark still reads both figures", () => {
    const result = readSalaryFromText("$ 132,836 -$171,745");
    expect(result.salary_low).toBe(132836);
    expect(result.salary_high).toBe(171745);
  });
});

describe("a dot separates thousands unless exactly two digits follow it", () => {
  test("Lyft's $59.040 reads as 59040 rather than 59.04", () => {
    expect(readSalaryFromText("$59.040 - $73,800").salary_low).toBe(59040);
  });

  test("a genuine two-digit remainder is read as cents", () => {
    const result = readSalaryFromText("$41.96 - $53.23");
    expect(result.salary_low).toBe(41.96);
    expect(result.salary_high).toBe(53.23);
  });
});

describe("a thousands group short of three digits is refused outright", () => {
  // Intercom published both of these a digit short. Reading them would file a
  // $118,000 job as $11,800, which is worse than filing no salary at all.
  test.each([
    "The pay range is $118,00 - $141,900.",
    "The pay range is $ 228,00 - $349,375.",
  ])("no field is filled from: %s", (text) => {
    expect(readSalaryFromText(text)).toEqual({});
  });
});

describe("a range naming one figure twice is a real salary", () => {
  test.each([
    ["Illinois Pay Range$24.50—$24.50 USD", 24.5],
    ["Texas Pay Range$21—$21 USD", 21],
  ])("%s reads a low and a high of %s", (text, figure) => {
    const result = readSalaryFromText(text);
    expect(result.salary_low).toBe(figure);
    expect(result.salary_high).toBe(figure);
  });
});

describe("the first range in the description wins", () => {
  test("Coursera's later pay zones do not overwrite the first", () => {
    const text =
      "This role is available in the following US Pay Zones: US Zone 3: $121,550- $143,000US Zone 4: $113,000 - $133,000";
    const result = readSalaryFromText(text);
    expect(result.salary_low).toBe(121550);
    expect(result.salary_high).toBe(143000);
  });

  test("Squarespace's second city does not overwrite the first", () => {
    const text =
      "Cash Compensation Range New York, NY: $148,000 - $267,500 Dublin, Ireland: € 88,500 - € 159,500";
    const result = readSalaryFromText(text);
    expect(result.salary_low).toBe(148000);
    expect(result.salary_high).toBe(267500);
  });
});

describe("a high figure below the low figure is refused", () => {
  test("nothing is filled in and the two are not swapped", () => {
    expect(readSalaryFromText("The pay range is $150,000 - $120,000.")).toEqual({});
  });
});

describe("the description is read exactly as a collector stored it", () => {
  test("Greenhouse's entity-encoded markup is decoded before the range is looked for", () => {
    const raw =
      "&lt;div class=&quot;pay-range&quot;&gt;&lt;span&gt;$139,200&lt;/span&gt;&lt;span&gt;&amp;mdash;&lt;/span&gt;&lt;span&gt;$235,200 USD&lt;/span&gt;&lt;/div&gt;";
    const result = readSalaryFromText(raw);
    expect(result.salary_low).toBe(139200);
    expect(result.salary_high).toBe(235200);
  });
});

describe("the fixture of real excerpts from the boards this pipeline polls", () => {
  const salaryCases = fixture.salary;
  const neitherCases = fixture.neither;

  // An emptied or broken fixture would let both sweeps below pass while
  // checking nothing, so both groups have to actually hold cases.
  test("the fixture holds both salary cases and cases naming neither", () => {
    expect(salaryCases.length).toBeGreaterThan(0);
    expect(neitherCases.length).toBeGreaterThan(0);
  });

  test("every excerpt stating a range is read exactly as expected", () => {
    const missed = salaryCases
      .map((one) => ({ source: one.source, expected: one.expect, got: readSalaryFromText(one.text) }))
      .filter(
        ({ expected, got }) =>
          got.salary_low !== expected.salary_low ||
          got.salary_high !== expected.salary_high ||
          got.salary_period !== expected.salary_period
      );
    // Collecting the offending cases rather than counting them means a
    // failure names the board and what was read, instead of leaving it to be
    // worked out again.
    expect(missed).toEqual([]);
  });

  test("no excerpt naming neither is read as a salary", () => {
    const wronglyRead = neitherCases
      .map((one) => ({ source: one.source, got: readSalaryFromText(one.text) }))
      .filter(({ got }) => got.salary_low !== undefined || got.salary_high !== undefined);
    expect(wronglyRead).toEqual([]);
  });
});
