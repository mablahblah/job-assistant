import { describe, expect, test } from "vitest";
import type { JobListEntry } from "../job-list-entry";
import { unusableReason } from "./job-usable";

// A job carrying everything a source could supply. Each test spreads it and
// overrides the one field under test, so what a test changes is what it proves.
const usableJob: JobListEntry = {
  original_url: "https://example.com/jobs/123",
  raw_title: "Senior Product Designer",
  raw_company_name: "Acme Corp",
  raw_company_slug: "acme-corp",
  posting_date: new Date("2026-01-01"),
  posting_updated_date: new Date("2026-01-02"),
  description: "Build things.",
  raw_location_list: ["Remote"],
  raw_mode_list: ["remote"],
  raw_salary: { salary_min: 100000, salary_max: 150000 },
};

describe("AC 104: a job with no usable link is dropped", () => {
  test("a missing original_url gives a reason", () => {
    expect(unusableReason({ ...usableJob, original_url: undefined })).toContain("original_url");
  });

  test("a null original_url gives a reason", () => {
    expect(unusableReason({ ...usableJob, original_url: null })).toContain("original_url");
  });

  test("an empty original_url gives a reason", () => {
    expect(unusableReason({ ...usableJob, original_url: "" })).toContain("original_url");
  });

  test("a whitespace-only original_url gives a reason", () => {
    expect(unusableReason({ ...usableJob, original_url: "   " })).toContain("original_url");
  });

  test("a non-URL string gives a reason", () => {
    expect(unusableReason({ ...usableJob, original_url: "not-a-url" })).toContain("original_url");
  });

  test("a valid URL passes", () => {
    expect(unusableReason(usableJob)).toBeNull();
  });
});

describe("AC 105: a job with no raw_title is dropped", () => {
  test("a missing raw_title gives a reason", () => {
    expect(unusableReason({ ...usableJob, raw_title: undefined })).toContain("raw_title");
  });

  test("a null raw_title gives a reason", () => {
    expect(unusableReason({ ...usableJob, raw_title: null })).toContain("raw_title");
  });

  test("an empty raw_title gives a reason", () => {
    expect(unusableReason({ ...usableJob, raw_title: "" })).toContain("raw_title");
  });

  test("a whitespace-only raw_title gives a reason", () => {
    expect(unusableReason({ ...usableJob, raw_title: "   " })).toContain("raw_title");
  });
});

// Phase 4 matches a company by slug first and by name second, and Lever and
// Ashby supply only the slug while Adzuna and JSearch supply only the name, so
// demanding both would drop every job the pipeline collects.
describe("AC 106: a job with neither raw_company_name nor raw_company_slug is dropped", () => {
  test("name only passes", () => {
    expect(unusableReason({ ...usableJob, raw_company_slug: undefined })).toBeNull();
  });

  test("slug only passes", () => {
    expect(unusableReason({ ...usableJob, raw_company_name: undefined })).toBeNull();
  });

  test("both present passes", () => {
    expect(unusableReason(usableJob)).toBeNull();
  });

  test("neither present gives a reason naming both fields", () => {
    const reason = unusableReason({
      ...usableJob,
      raw_company_name: undefined,
      raw_company_slug: undefined,
    });
    expect(reason).toContain("raw_company_name");
    expect(reason).toContain("raw_company_slug");
  });

  test("a blank raw_company_name does not count as supplied", () => {
    const reason = unusableReason({
      ...usableJob,
      raw_company_name: "",
      raw_company_slug: undefined,
    });
    expect(reason).toContain("raw_company_name");
  });
});

describe("AC 107: a date that is present but does not parse is dropped", () => {
  test("an unparseable posting_date gives a reason", () => {
    expect(unusableReason({ ...usableJob, posting_date: new Date("nonsense") })).toContain(
      "posting_date"
    );
  });

  test("an unparseable posting_updated_date gives a reason", () => {
    expect(unusableReason({ ...usableJob, posting_updated_date: new Date("nonsense") })).toContain(
      "posting_updated_date"
    );
  });
});

// JSearch omits posting_date on some postings by design, so an absent field
// must not be confused with an invalid one.
describe("AC 108: a field that is absent and not needed is fine and silent", () => {
  test("no posting_date at all passes", () => {
    expect(unusableReason({ ...usableJob, posting_date: undefined })).toBeNull();
  });

  test("no posting_updated_date at all passes", () => {
    expect(unusableReason({ ...usableJob, posting_updated_date: undefined })).toBeNull();
  });

  test("no description passes", () => {
    expect(unusableReason({ ...usableJob, description: undefined })).toBeNull();
  });

  test("no raw_location_list passes", () => {
    expect(unusableReason({ ...usableJob, raw_location_list: undefined })).toBeNull();
  });

  test("no raw_mode_list passes", () => {
    expect(unusableReason({ ...usableJob, raw_mode_list: undefined })).toBeNull();
  });

  test("no raw_salary passes", () => {
    expect(unusableReason({ ...usableJob, raw_salary: undefined })).toBeNull();
  });

  test("none of the six optional fields present at once passes", () => {
    const reason = unusableReason({
      ...usableJob,
      posting_date: undefined,
      posting_updated_date: undefined,
      description: undefined,
      raw_location_list: undefined,
      raw_mode_list: undefined,
      raw_salary: undefined,
    });
    expect(reason).toBeNull();
  });
});

// Junk pay or a junk place does not make the role unusable. Dropping the field
// rather than the job is normalization's work.
describe("AC 109: a malformed salary, location, or work mode does not drop the job", () => {
  test("a nonsense raw_salary passes", () => {
    expect(unusableReason({ ...usableJob, raw_salary: { salary_min: Number.NaN } })).toBeNull();
  });

  test("an empty-string entry in raw_location_list passes", () => {
    expect(unusableReason({ ...usableJob, raw_location_list: [""] })).toBeNull();
  });

  test("a nonsense entry in raw_mode_list passes", () => {
    expect(unusableReason({ ...usableJob, raw_mode_list: ["not-a-mode"] })).toBeNull();
  });
});
