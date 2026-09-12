import { describe, expect, test } from "vitest";
import { jobFieldsFromLeverPosting } from "./lever-fields";
import type { LeverPosting } from "./lever-fields";

const POSTING: LeverPosting = {
  id: "abc-123",
  text: "Senior Product Designer",
  createdAt: 1754042400000,
  categories: { location: "Remote - US", team: "Design" },
  workplaceType: "remote",
  descriptionPlain: "Design things.",
  description: "<p>Design things.</p>",
};

describe("jobFieldsFromLeverPosting: a posting's own fields are read off it", () => {
  test("the title and the board slug come across", () => {
    const fields = jobFieldsFromLeverPosting(POSTING, "acme");

    expect(fields.raw_title).toBe("Senior Product Designer");
    expect(fields.raw_company_slug).toBe("acme");
  });

  test("the plain-text description wins over the html one", () => {
    expect(jobFieldsFromLeverPosting(POSTING, "acme").description).toBe("Design things.");
  });

  test("the html description is used where there is no plain-text one", () => {
    const fields = jobFieldsFromLeverPosting({ ...POSTING, descriptionPlain: "" }, "acme");

    expect(fields.description).toBe("<p>Design things.</p>");
  });

  test("the work mode is stored exactly as Lever sent it", () => {
    expect(jobFieldsFromLeverPosting(POSTING, "acme").raw_mode_list).toEqual(["remote"]);
  });

  test("a posting with no work mode gives an empty mode list", () => {
    const fields = jobFieldsFromLeverPosting({ ...POSTING, workplaceType: undefined }, "acme");

    expect(fields.raw_mode_list).toEqual([]);
  });

  test("a posting with no location gives an empty location list", () => {
    const fields = jobFieldsFromLeverPosting({ ...POSTING, categories: undefined }, "acme");

    expect(fields.raw_location_list).toEqual([]);
  });

  test("Lever publishes one date, so no updated date is written", () => {
    expect(jobFieldsFromLeverPosting(POSTING, "acme").posting_updated_date).toBeUndefined();
  });
});

describe("jobFieldsFromLeverPosting: the mapper carries nothing its caller owns", () => {
  test.each(["original_url", "resolved_url"])("no %s is carried", (field) => {
    expect(field in jobFieldsFromLeverPosting(POSTING, "acme")).toBe(false);
  });

  test.each(["is_resolved", "is_parsed", "is_classified"])("no %s is carried", (field) => {
    expect(field in jobFieldsFromLeverPosting(POSTING, "acme")).toBe(false);
  });
});
