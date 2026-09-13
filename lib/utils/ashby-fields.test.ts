import { describe, expect, test } from "vitest";
import { jobFieldsFromAshbyPosting } from "./ashby-fields";
import type { AshbyPosting } from "./ashby-fields";

const POSTING: AshbyPosting = {
  title: "Senior Product Designer",
  isListed: true,
  jobUrl: "https://jobs.ashbyhq.com/acme/abc-123",
  publishedAt: "2026-08-01T09:00:00Z",
  location: "Remote - US",
  secondaryLocations: [{ location: "New York" }, { location: "" }],
  workplaceType: "Remote",
  descriptionPlain: "Design things.",
  descriptionHtml: "<p>Design things.</p>",
  compensation: {
    summaryComponents: [
      { compensationType: "Equity", interval: null, currencyCode: null },
      {
        compensationType: "Salary",
        interval: "1 YEAR",
        currencyCode: "USD",
        minValue: 140000,
        maxValue: 180000,
      },
    ],
  },
};

describe("jobFieldsFromAshbyPosting: a posting's own fields are read off it", () => {
  test("the title and the board slug come across", () => {
    const fields = jobFieldsFromAshbyPosting(POSTING, "acme");

    expect(fields.raw_title).toBe("Senior Product Designer");
    expect(fields.raw_company_slug).toBe("acme");
  });

  test("the primary location comes first and blank secondary ones are dropped", () => {
    expect(jobFieldsFromAshbyPosting(POSTING, "acme").raw_location_list).toEqual([
      "Remote - US",
      "New York",
    ]);
  });

  test("the work mode is stored exactly as Ashby sent it", () => {
    expect(jobFieldsFromAshbyPosting(POSTING, "acme").raw_mode_list).toEqual(["Remote"]);
  });

  test("the plain-text description wins over the html one", () => {
    expect(jobFieldsFromAshbyPosting(POSTING, "acme").description).toBe("Design things.");
  });

  test("Ashby publishes one date, so no updated date is written", () => {
    expect(jobFieldsFromAshbyPosting(POSTING, "acme").posting_updated_date).toBeUndefined();
  });
});

describe("jobFieldsFromAshbyPosting: pay is picked out by its type, not its position", () => {
  test("the salary entry is found behind an equity entry", () => {
    expect(jobFieldsFromAshbyPosting(POSTING, "acme").raw_salary).toEqual({
      salary_min: 140000,
      salary_max: 180000,
      salary_period: "1 YEAR",
      salary_currency: "USD",
    });
  });

  test("a posting whose pay list holds no salary entry writes no salary at all", () => {
    const fields = jobFieldsFromAshbyPosting(
      { ...POSTING, compensation: { summaryComponents: [{ compensationType: "Equity" }] } },
      "acme"
    );

    expect("raw_salary" in fields).toBe(false);
  });
});

describe("jobFieldsFromAshbyPosting: the mapper carries nothing its caller owns", () => {
  test.each(["original_url", "resolved_url"])("no %s is carried", (field) => {
    expect(field in jobFieldsFromAshbyPosting(POSTING, "acme")).toBe(false);
  });

  test.each(["is_resolved", "is_parsed", "is_classified"])("no %s is carried", (field) => {
    expect(field in jobFieldsFromAshbyPosting(POSTING, "acme")).toBe(false);
  });
});
