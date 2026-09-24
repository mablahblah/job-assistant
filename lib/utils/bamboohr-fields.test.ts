import { describe, expect, test } from "vitest";
import { jobFieldsFromBambooHrJob } from "./bamboohr-fields";
import type { BambooHrJob } from "./bamboohr-fields";

// Shaped like the job opening a BambooHR careers page answers as data,
// measured on the shortcut board on 2026-09-24. A board's job list carries
// the same fields without the description and the date.
const JOB: BambooHrJob = {
  id: "40",
  jobOpeningName: "Senior Product Designer",
  departmentLabel: "Product Management",
  employmentStatusLabel: "Full-Time",
  location: { city: null, state: null },
  atsLocation: { country: "United States", state: "New York", province: null, city: "New York" },
  isRemote: null,
  description: "<p>Design the tools engineering teams plan with.</p>",
  datePosted: "2026-07-24",
};

const fields = (job: BambooHrJob = JOB) => jobFieldsFromBambooHrJob(job, "shortcut");

describe("jobFieldsFromBambooHrJob: a job's own fields are read off it", () => {
  test("the title and the board name come across, and no employer name", () => {
    expect(fields().raw_title).toBe("Senior Product Designer");
    expect(fields().raw_company_slug).toBe("shortcut");
    expect(fields().raw_company_name).toBeUndefined();
  });

  test("the location is the city, the state and the country the job names", () => {
    expect(fields().raw_location_list).toEqual(["New York, New York, United States"]);
  });

  test("the plainer location is used where the careers location is empty", () => {
    const job = { ...JOB, atsLocation: undefined, location: { city: "Austin", state: "Texas" } };
    expect(fields(job).raw_location_list).toEqual(["Austin, Texas"]);
  });

  test("a job naming no place writes an empty list", () => {
    const job = { ...JOB, atsLocation: undefined, location: { city: null, state: null } };
    expect(fields(job).raw_location_list).toEqual([]);
  });

  test("the description and the posting date come across", () => {
    expect(fields().description).toBe("<p>Design the tools engineering teams plan with.</p>");
    expect(fields().posting_date).toEqual(new Date("2026-07-24"));
  });

  test("a job list entry, which carries neither, writes neither", () => {
    const listed = fields({ ...JOB, description: undefined, datePosted: undefined });
    expect(listed.description).toBeUndefined();
    expect("posting_date" in listed).toBe(false);
  });
});

describe("jobFieldsFromBambooHrJob: the work mode", () => {
  test("a job flagged remote is remote", () => {
    expect(fields({ ...JOB, isRemote: true }).raw_mode_list).toEqual(["remote"]);
  });

  test("a job not flagged remote leaves the mode empty for the description to fill", () => {
    expect(fields().raw_mode_list).toEqual([]);
    expect(fields({ ...JOB, isRemote: false }).raw_mode_list).toEqual([]);
  });
});

// Reading the free-text pay field is the parser's job, so the mapper the
// collector shares leaves it alone.
describe("jobFieldsFromBambooHrJob: the pay", () => {
  test("a pay field is left for the parser to read", () => {
    expect("raw_salary" in fields({ ...JOB, compensation: "145k-185k" })).toBe(false);
  });
});

describe("jobFieldsFromBambooHrJob: the mapper carries nothing its caller owns", () => {
  test.each(["original_url", "resolved_url", "is_resolved", "is_parsed", "is_classified"])(
    "no %s is carried",
    (field) => {
      expect(field in fields()).toBe(false);
    }
  );
});
