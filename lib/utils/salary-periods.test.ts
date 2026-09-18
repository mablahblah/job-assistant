import { describe, expect, test } from "vitest";
import { isReadablePeriod, YEARLY_MULTIPLIERS } from "./salary-periods";

// Criteria 135 and 155. Both the score formula and the pay column read this
// one list, so neither can act on a word the other rejects.
describe("the pay periods", () => {
  test("holds the five the pipeline reads, with what each is worth in a year", () => {
    expect(YEARLY_MULTIPLIERS).toEqual({ year: 1, month: 12, week: 52, day: 260, hour: 2080 });
  });
});

describe("isReadablePeriod", () => {
  test.each(Object.keys(YEARLY_MULTIPLIERS))("%s is readable", (period) => {
    expect(isReadablePeriod(period)).toBe(true);
  });

  // A source quoting "per project" leaves a figure nobody can compare to a
  // yearly target.
  test("a word outside the five is not readable", () => {
    expect(isReadablePeriod("project")).toBe(false);
  });

  test.each([null, undefined])("%s is not readable", (period) => {
    expect(isReadablePeriod(period)).toBe(false);
  });
});
