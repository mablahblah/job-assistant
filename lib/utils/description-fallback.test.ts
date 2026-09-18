import { describe, expect, test } from "vitest";
import { withFieldsFromDescription } from "./description-fallback";

const SALARY_PROSE = "The range for this role is $120,000 - $150,000 per year.";
const MODE_PROSE = "This role is remote.";

describe("withFieldsFromDescription: a field the source published is never overwritten", () => {
  test("a published work mode survives a description naming a different one", () => {
    const filled = withFieldsFromDescription({ raw_mode_list: ["hybrid"] }, MODE_PROSE);

    expect(filled.raw_mode_list).toEqual(["hybrid"]);
  });

  test("a published salary survives a description naming a different one", () => {
    const published = { salary_min: 90000, salary_max: 100000 };
    const filled = withFieldsFromDescription({ raw_salary: published }, SALARY_PROSE);

    expect(filled.raw_salary).toEqual(published);
  });
});

describe("withFieldsFromDescription: a field the source left empty is read out of the prose", () => {
  test("an empty mode list is filled from the description", () => {
    const filled = withFieldsFromDescription({ raw_mode_list: [] }, MODE_PROSE);

    expect(filled.raw_mode_list).toEqual(["remote"]);
  });

  test("an absent salary is filled from the description", () => {
    const filled = withFieldsFromDescription({}, SALARY_PROSE);

    expect(filled.raw_salary).toEqual({
      salary_min: 120000,
      salary_max: 150000,
      salary_period: "year",
    });
  });
});

describe("withFieldsFromDescription: nothing is invented where the prose says nothing", () => {
  test("a description stating neither leaves both as they were", () => {
    const filled = withFieldsFromDescription({ raw_mode_list: [] }, "We solve hard problems.");

    expect(filled.raw_mode_list).toEqual([]);
    expect("raw_salary" in filled).toBe(false);
  });

  test("a job with no description at all comes back untouched", () => {
    expect(withFieldsFromDescription({ raw_title: "Designer" }, undefined)).toEqual({
      raw_title: "Designer",
    });
  });
});

describe("withFieldsFromDescription: the fields it was handed are left alone", () => {
  test("the object handed in is not changed, so a caller keeps what it had", () => {
    const original = { raw_mode_list: [] };

    withFieldsFromDescription(original, MODE_PROSE);

    expect(original.raw_mode_list).toEqual([]);
  });

  test("every other field comes through untouched", () => {
    const filled = withFieldsFromDescription(
      { raw_title: "Designer", raw_company_slug: "acme", raw_mode_list: [] },
      MODE_PROSE
    );

    expect(filled.raw_title).toBe("Designer");
    expect(filled.raw_company_slug).toBe("acme");
  });
});
