import { describe, expect, test } from "vitest";
import { jobFieldsFromGreenhousePosting } from "./greenhouse-fields";
import type { GreenhousePosting } from "./greenhouse-fields";

const POSTING: GreenhousePosting = {
  id: 4567,
  title: "Senior Product Designer",
  first_published: "2026-08-01T09:00:00Z",
  updated_at: "2026-08-14T09:00:00Z",
  location: { name: "Remote - US" },
  content: "<p>Design things.</p>",
  company_name: "Acme Corp",
  pay_input_ranges: [{ min_cents: 14000000, max_cents: 18000000, currency_type: "USD" }],
};

describe("jobFieldsFromGreenhousePosting: a posting's own fields are read off it", () => {
  test("the title, the employer and the board slug come across", () => {
    const fields = jobFieldsFromGreenhousePosting(POSTING, "acme");

    expect(fields.raw_title).toBe("Senior Product Designer");
    expect(fields.raw_company_name).toBe("Acme Corp");
    expect(fields.raw_company_slug).toBe("acme");
  });

  test("the pay range comes across in cents, exactly as Greenhouse sent it", () => {
    const fields = jobFieldsFromGreenhousePosting(POSTING, "acme");

    expect(fields.raw_salary).toEqual({
      salary_min: 14000000,
      salary_max: 18000000,
      salary_currency: "USD",
      salary_unit: "cents",
    });
  });

  test("a posting with no pay range writes no salary at all", () => {
    const fields = jobFieldsFromGreenhousePosting({ ...POSTING, pay_input_ranges: [] }, "acme");

    expect("raw_salary" in fields).toBe(false);
  });

  test("a blank description is left unset rather than written empty", () => {
    const fields = jobFieldsFromGreenhousePosting({ ...POSTING, content: "" }, "acme");

    expect(fields.description).toBeUndefined();
  });

  test("a posting with no location gives an empty location list", () => {
    const fields = jobFieldsFromGreenhousePosting({ ...POSTING, location: undefined }, "acme");

    expect(fields.raw_location_list).toEqual([]);
  });
});

describe("jobFieldsFromGreenhousePosting: the mapper carries nothing its caller owns", () => {
  // A collector builds the posting's link and opens the phase gates. A parser
  // already holds a resolved link and is about to close the parsing gate. The
  // mapper touching either would let one overwrite the other's work.
  test.each(["original_url", "resolved_url"])("no %s is carried", (field) => {
    expect(field in jobFieldsFromGreenhousePosting(POSTING, "acme")).toBe(false);
  });

  test.each(["is_resolved", "is_parsed", "is_classified"])("no %s is carried", (field) => {
    expect(field in jobFieldsFromGreenhousePosting(POSTING, "acme")).toBe(false);
  });
});
