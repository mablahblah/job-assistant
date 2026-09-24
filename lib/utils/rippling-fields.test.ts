import { describe, expect, test } from "vitest";
import { jobFieldsFromRipplingJob } from "./rippling-fields";
import type { RipplingJob } from "./rippling-fields";

// Shaped like one job from Rippling's board address, measured on the
// radicl-defense board on 2026-09-24. A board's job list carries a single
// work location and none of the description, date, pay or employer name.
const JOB: RipplingJob = {
  uuid: "371ee603-a211-467c-b868-b5f5b68ccbff",
  name: "Product (UX/UI) Designer",
  description: {
    company: "<div><p>RADICL protects small businesses.</p></div>",
    role: "<div><p>Design the security dashboard.</p></div>",
  },
  workLocations: ["Boulder, CO"],
  department: { name: "Product" },
  employmentType: { label: "SALARIED_FT", id: "Salaried, full-time" },
  createdOn: "2026-09-01T13:22:49.176000-07:00",
  url: "https://ats.rippling.com/radicl-defense/jobs/371ee603-a211-467c-b868-b5f5b68ccbff",
  board: { slug: "radicl-defense", companyName: "RADICL" },
  payRangeDetails: [
    {
      location: "Boulder, CO",
      currency: "USD",
      frequency: "YEAR",
      rangeStart: 110000,
      rangeEnd: 135000,
      isRemote: false,
    },
  ],
  companyName: "RADICL",
};

const fields = (job: RipplingJob = JOB) => jobFieldsFromRipplingJob(job, "radicl-defense");

describe("jobFieldsFromRipplingJob: a job's own fields are read off it", () => {
  test("the title, the employer's name and the board name come across", () => {
    expect(fields().raw_title).toBe("Product (UX/UI) Designer");
    expect(fields().raw_company_name).toBe("RADICL");
    expect(fields().raw_company_slug).toBe("radicl-defense");
  });

  test("the board's own name for the employer stands in where the job names none", () => {
    expect(fields({ ...JOB, companyName: undefined }).raw_company_name).toBe("RADICL");
  });

  test("a job naming no employer anywhere writes no employer name", () => {
    expect("raw_company_name" in fields({ ...JOB, companyName: undefined, board: undefined })).toBe(false);
  });

  test("every work location comes across", () => {
    expect(fields({ ...JOB, workLocations: ["Boulder, CO", "Remote"] }).raw_location_list).toEqual([
      "Boulder, CO",
      "Remote",
    ]);
  });

  test("a job list entry's single work location comes across", () => {
    const listed: RipplingJob = {
      uuid: JOB.uuid,
      name: JOB.name,
      workLocation: { label: "Boulder, CO", id: "Boulder, CO" },
    };
    expect(fields(listed).raw_location_list).toEqual(["Boulder, CO"]);
  });

  test("both halves of the description are kept, the company's then the role's", () => {
    const description = fields().description ?? "";
    expect(description.indexOf("RADICL protects small businesses.")).toBeGreaterThanOrEqual(0);
    expect(description.indexOf("Design the security dashboard.")).toBeGreaterThan(
      description.indexOf("RADICL protects small businesses.")
    );
  });

  test("the posting date is when the job was created", () => {
    expect(fields().posting_date).toEqual(new Date("2026-09-01T13:22:49.176-07:00"));
  });

  test("a job list entry, which carries neither description nor date, writes neither", () => {
    const listed = fields({ uuid: JOB.uuid, name: JOB.name });
    expect(listed.description).toBeUndefined();
    expect("posting_date" in listed).toBe(false);
  });
});

describe("jobFieldsFromRipplingJob: pay", () => {
  test("the first pay range comes across as Rippling wrote it", () => {
    expect(fields().raw_salary).toEqual({
      salary_min: 110000,
      salary_max: 135000,
      salary_currency: "USD",
      salary_period: "YEAR",
    });
  });

  test("an empty pay-range list writes no salary, leaving the description to supply one", () => {
    expect("raw_salary" in fields({ ...JOB, payRangeDetails: [] })).toBe(false);
  });
});

describe("jobFieldsFromRipplingJob: the mapper carries nothing its caller owns", () => {
  test.each(["original_url", "resolved_url", "is_resolved", "is_parsed", "is_classified"])(
    "no %s is carried",
    (field) => {
      expect(field in fields()).toBe(false);
    }
  );
});
