import { describe, expect, test } from "vitest";
import { jobFieldsFromGemPosting } from "./gem-fields";
import type { GemPosting } from "./gem-fields";

// Shaped like a posting from api.gem.com's job board API, measured on the
// fetch board on 2026-09-24.
const POSTING: GemPosting = {
  absolute_url: "https://jobs.gem.com/fetch/7536752003",
  content: "<div><p>Design how people find rewards.</p></div>",
  content_plain: "Design how people find rewards.",
  created_at: "2025-11-21T22:26:01.000Z",
  first_published_at: "2026-05-12T22:51:02.331Z",
  updated_at: "2026-07-16T16:08:06.647Z",
  id: "7536752003",
  location: { name: "United States - Remote" },
  location_type: "remote",
  employment_type: "full_time",
  title: "Senior Product Designer",
};

describe("jobFieldsFromGemPosting: a posting's own fields are read off it", () => {
  test("the title and the board name come across", () => {
    const fields = jobFieldsFromGemPosting(POSTING, "fetch");

    expect(fields.raw_title).toBe("Senior Product Designer");
    expect(fields.raw_company_slug).toBe("fetch");
  });

  test("the location comes across as a one-entry list", () => {
    expect(jobFieldsFromGemPosting(POSTING, "fetch").raw_location_list).toEqual([
      "United States - Remote",
    ]);
  });

  test("a posting with no location writes an empty list", () => {
    const withoutLocation = { ...POSTING, location: undefined };
    expect(jobFieldsFromGemPosting(withoutLocation, "fetch").raw_location_list).toEqual([]);
  });

  test("the work mode is stored exactly as Gem sent it", () => {
    expect(jobFieldsFromGemPosting(POSTING, "fetch").raw_mode_list).toEqual(["remote"]);
  });

  test("a posting with no work mode leaves the list empty for a parser to fill", () => {
    const withoutMode = { ...POSTING, location_type: undefined };
    expect(jobFieldsFromGemPosting(withoutMode, "fetch").raw_mode_list).toEqual([]);
  });

  test("the plain-text description wins over the html one", () => {
    expect(jobFieldsFromGemPosting(POSTING, "fetch").description).toBe(
      "Design how people find rewards."
    );
  });

  test("the html description is used where the plain one is blank", () => {
    const fields = jobFieldsFromGemPosting({ ...POSTING, content_plain: "" }, "fetch");
    expect(fields.description).toBe("<div><p>Design how people find rewards.</p></div>");
  });

  test("the posting date is when it was first published, not when it was drafted", () => {
    expect(jobFieldsFromGemPosting(POSTING, "fetch").posting_date).toEqual(
      new Date("2026-05-12T22:51:02.331Z")
    );
  });

  test("the updated date is when the posting last changed", () => {
    expect(jobFieldsFromGemPosting(POSTING, "fetch").posting_updated_date).toEqual(
      new Date("2026-07-16T16:08:06.647Z")
    );
  });

  test("a posting with no updated date writes none", () => {
    expect("posting_updated_date" in jobFieldsFromGemPosting({ ...POSTING, updated_at: undefined }, "fetch")).toBe(
      false
    );
  });
});

describe("jobFieldsFromGemPosting: Gem publishes no pay and no employer name", () => {
  test("no salary is written, leaving the description to supply one", () => {
    expect("raw_salary" in jobFieldsFromGemPosting(POSTING, "fetch")).toBe(false);
  });

  test("no employer name is written", () => {
    expect(jobFieldsFromGemPosting(POSTING, "fetch").raw_company_name).toBeUndefined();
  });
});

describe("jobFieldsFromGemPosting: the mapper carries nothing its caller owns", () => {
  test.each(["original_url", "resolved_url"])("no %s is carried", (field) => {
    expect(field in jobFieldsFromGemPosting(POSTING, "fetch")).toBe(false);
  });

  test.each(["is_resolved", "is_parsed", "is_classified"])("no %s is carried", (field) => {
    expect(field in jobFieldsFromGemPosting(POSTING, "fetch")).toBe(false);
  });
});
