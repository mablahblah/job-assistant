import { describe, expect, test } from "vitest";
import { rawSalaryFromText } from "./raw-salary-from-text";
import { normalizeSalary } from "./salary";

describe("rawSalaryFromText: pay read out of prose comes back in the envelope's own field names", () => {
  test("the two figures land on salary_min and salary_max", () => {
    expect(rawSalaryFromText("The range for this role is $120,000 - $150,000 per year.")).toEqual({
      salary_min: 120000,
      salary_max: 150000,
      salary_period: "year",
    });
  });

  test("an hourly rate keeps the period the prose stated", () => {
    expect(rawSalaryFromText("This role pays $25 - $32 per hour.")).toEqual({
      salary_min: 25,
      salary_max: 32,
      salary_period: "hour",
    });
  });
});

describe("rawSalaryFromText: a description stating no pay gives nothing", () => {
  test("prose with no figures gives nothing", () => {
    expect(rawSalaryFromText("We are looking for someone who loves hard problems.")).toBe(null);
  });

  test("an empty description gives nothing", () => {
    expect(rawSalaryFromText("")).toBe(null);
  });
});

describe("rawSalaryFromText: the envelope it builds survives the normalizer unchanged", () => {
  test("the figures read out of prose come back out of normalizeSalary as they went in", () => {
    // The round trip is the whole point of this util: what the description
    // reader found has to reach the job's normalized salary columns rather
    // than being dropped on the way for carrying the wrong field names.
    const envelope = rawSalaryFromText("Compensation is $120,000 - $150,000 annually.");

    expect(normalizeSalary(envelope)).toEqual({
      salary_low: 120000,
      salary_high: 150000,
      salary_period: "year",
    });
  });
});
