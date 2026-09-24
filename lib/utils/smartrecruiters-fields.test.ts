import { describe, expect, test } from "vitest";
import { jobFieldsFromSmartRecruitersPosting } from "./smartrecruiters-fields";
import type { SmartRecruitersPosting } from "./smartrecruiters-fields";

// Shaped like a single posting from api.smartrecruiters.com, measured on the
// RodeoFX board on 2026-09-24. A board's job list carries the same fields
// without the job ad.
const POSTING: SmartRecruitersPosting = {
  id: "744000148584589",
  name: "UX Specialist",
  company: { identifier: "RodeoFX", name: "Rodeo FX" },
  releasedDate: "2026-09-09T18:30:40.900Z",
  location: {
    city: "Montreal",
    region: "QC",
    country: "ca",
    remote: false,
    hybrid: false,
    fullLocation: "Montreal, QC, Canada",
  },
  jobAd: {
    sections: {
      companyDescription: { title: "Company Description", text: "<p>Rodeo FX makes films.</p>" },
      jobDescription: { title: "Job Description", text: "<p>Research how artists work.</p>" },
      qualifications: { title: "Qualifications", text: "<ul><li>Five years of UX</li></ul>" },
      additionalInformation: { title: "Additional Information", text: "<p>A one-year contract.</p>" },
    },
  },
};

const fields = (posting: SmartRecruitersPosting = POSTING) =>
  jobFieldsFromSmartRecruitersPosting(posting, "RodeoFX");

describe("jobFieldsFromSmartRecruitersPosting: a posting's own fields are read off it", () => {
  test("the title, the employer's name and the board name come across", () => {
    expect(fields().raw_title).toBe("UX Specialist");
    expect(fields().raw_company_name).toBe("Rodeo FX");
    expect(fields().raw_company_slug).toBe("RodeoFX");
  });

  test("the posting date is when the posting was released", () => {
    expect(fields().posting_date).toEqual(new Date("2026-09-09T18:30:40.900Z"));
  });

  test("the location is the full place SmartRecruiters writes", () => {
    expect(fields().raw_location_list).toEqual(["Montreal, QC, Canada"]);
  });

  test("a posting with no location writes an empty list", () => {
    expect(fields({ ...POSTING, location: undefined }).raw_location_list).toEqual([]);
  });

  test("every section of the job ad is kept in the description, in order", () => {
    const description = fields().description ?? "";
    const order = [
      "Rodeo FX makes films.",
      "Research how artists work.",
      "Five years of UX",
      "A one-year contract.",
    ].map((text) => description.indexOf(text));

    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("a job list entry, which carries no job ad, has no description", () => {
    expect(fields({ ...POSTING, jobAd: undefined }).description).toBeUndefined();
  });
});

describe("jobFieldsFromSmartRecruitersPosting: the work mode comes from the two flags", () => {
  test("a remote posting is remote", () => {
    const remote = { ...POSTING, location: { ...POSTING.location, remote: true } };
    expect(fields(remote).raw_mode_list).toEqual(["remote"]);
  });

  test("a hybrid posting is hybrid", () => {
    const hybrid = { ...POSTING, location: { ...POSTING.location, hybrid: true } };
    expect(fields(hybrid).raw_mode_list).toEqual(["hybrid"]);
  });

  test("two false flags leave the mode empty for the description to fill", () => {
    expect(fields().raw_mode_list).toEqual([]);
  });
});

describe("jobFieldsFromSmartRecruitersPosting: the mapper carries nothing its caller owns", () => {
  test.each(["original_url", "resolved_url", "is_resolved", "is_parsed", "is_classified"])(
    "no %s is carried",
    (field) => {
      expect(field in fields()).toBe(false);
    }
  );
});
