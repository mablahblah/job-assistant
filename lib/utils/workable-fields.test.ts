import { describe, expect, test } from "vitest";
import {
  jobFieldsFromWorkableListing,
  jobFieldsFromWorkablePosting,
  jobFieldsFromWorkableSearchJob,
} from "./workable-fields";
import type { WorkableListing, WorkablePosting, WorkableSearchJob } from "./workable-fields";

// Shaped like one posting from the address Workable's company site calls,
// measured on the blueground board on 2026-09-24.
const POSTING: WorkablePosting = {
  id: 6083341,
  shortcode: "08717EF2F6",
  title: "Senior Product Designer & Builder",
  remote: false,
  location: {
    countryCode: "GR",
    country: "Greece",
    region: "Attica",
    city: "Athens",
    display: "Athens, Greece",
  },
  published: "2026-09-10T00:00:00.000Z",
  workplace: "hybrid",
  description: "<p>Redefine how people live.</p>",
  requirements: "<p>Five years of product design.</p>",
  benefits: "<p>Flexible hours.</p>",
};

// Shaped like one job in a board's widget list, measured on the same board.
const LISTING: WorkableListing = {
  title: "Senior Product Designer & Builder",
  shortcode: "08717EF2F6",
  employment_type: "Full-time",
  telecommuting: false,
  url: "https://apply.workable.com/j/08717EF2F6",
  published_on: "2026-09-10",
  created_at: "2026-08-30",
  country: "Greece",
  city: "Athens",
  state: "Attica",
};

// Shaped like one job from Workable's job search site
// (jobs.workable.com/api/v1/jobs/{id}), measured on 2026-09-24.
const SEARCH_JOB: WorkableSearchJob = {
  company: {
    id: "company-tyaZq6jybgHCVRBowKxp43",
    title: "Manila Recruitment",
    description: "",
    url: "https://jobs.workable.com/company/tyaZq6jybgHCVRBowKxp43/jobs-at-manila-recruitment",
    website: "http://manilarecruitment.com",
  },
  created: "2026-08-30T10:59:09.401Z",
  description: "<p>Own the growth experiments.</p>",
  requirementsSection: "<p>Five years of product design.</p>",
  benefitsSection: "<p>A long-term contract.</p>",
  employmentType: "Full-time",
  id: "id-tyaZq6jybgHCVRBowKxp43",
  location: { city: "Manila", countryName: "Philippines", subregion: "Metro Manila" },
  locations: ["TELECOMMUTE"],
  state: "published",
  title: "Senior Product Designer, Growth",
  updated: "2026-08-30T10:59:09.401Z",
  url: "https://jobs.workable.com/view/tyaZq6jybgHCVRBowKxp43/senior-product-designer-growth",
  workplace: "remote",
};

describe("jobFieldsFromWorkablePosting: a posting's own fields are read off it", () => {
  const fields = (posting: WorkablePosting = POSTING) =>
    jobFieldsFromWorkablePosting(posting, "blueground");

  test("the title and the board name come across", () => {
    expect(fields().raw_title).toBe("Senior Product Designer & Builder");
    expect(fields().raw_company_slug).toBe("blueground");
  });

  test("the location is the place Workable displays", () => {
    expect(fields().raw_location_list).toEqual(["Athens, Greece"]);
  });

  test("a posting with no location writes an empty list", () => {
    expect(fields({ ...POSTING, location: undefined }).raw_location_list).toEqual([]);
  });

  test("the work mode is stored exactly as Workable sent it", () => {
    expect(fields().raw_mode_list).toEqual(["hybrid"]);
  });

  test("a posting with no work mode leaves the list empty for a parser to fill", () => {
    expect(fields({ ...POSTING, workplace: undefined }).raw_mode_list).toEqual([]);
  });

  test("the description keeps the role, the requirements and the benefits, in order", () => {
    const description = fields().description ?? "";
    const order = ["Redefine how people live.", "Five years of product design.", "Flexible hours."].map(
      (text) => description.indexOf(text)
    );
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("the posting date is when the posting was published", () => {
    expect(fields().posting_date).toEqual(new Date("2026-09-10T00:00:00.000Z"));
  });
});

describe("jobFieldsFromWorkableListing: a board list entry's own fields are read off it", () => {
  const fields = (listing: WorkableListing = LISTING) =>
    jobFieldsFromWorkableListing(listing, "blueground");

  test("the title and the board name come across", () => {
    expect(fields().raw_title).toBe("Senior Product Designer & Builder");
    expect(fields().raw_company_slug).toBe("blueground");
  });

  test("the location is the city, the state and the country the entry names", () => {
    expect(fields().raw_location_list).toEqual(["Athens, Attica, Greece"]);
  });

  test("the posting date is when the job was published", () => {
    expect(fields().posting_date).toEqual(new Date("2026-09-10"));
  });

  test("an entry flagged as working from home is remote", () => {
    expect(fields({ ...LISTING, telecommuting: true }).raw_mode_list).toEqual(["remote"]);
  });

  test("an entry not flagged leaves the mode empty for the parser to fill", () => {
    expect(fields().raw_mode_list).toEqual([]);
  });
});

describe("jobFieldsFromWorkableSearchJob: a search-site job's own fields are read off it", () => {
  const fields = (job: WorkableSearchJob = SEARCH_JOB) => jobFieldsFromWorkableSearchJob(job);

  test("the title and the employer's name come across", () => {
    expect(fields().raw_title).toBe("Senior Product Designer, Growth");
    expect(fields().raw_company_name).toBe("Manila Recruitment");
  });

  test("no board name is carried, since the search site never names one", () => {
    expect("raw_company_slug" in fields()).toBe(false);
  });

  test("the location is the city, the region and the country the job names", () => {
    expect(fields().raw_location_list).toEqual(["Manila, Metro Manila, Philippines"]);
  });

  test("a region Workable sends as null is left out of the location", () => {
    const job = { ...SEARCH_JOB, location: { city: "Manila", countryName: "Philippines", subregion: null } };
    expect(fields(job).raw_location_list).toEqual(["Manila, Philippines"]);
  });

  test("a job with no location writes an empty list", () => {
    expect(fields({ ...SEARCH_JOB, location: undefined }).raw_location_list).toEqual([]);
  });

  test("the work mode is stored exactly as Workable sent it", () => {
    expect(fields().raw_mode_list).toEqual(["remote"]);
  });

  test("a job with no work mode leaves the list empty for a parser to fill", () => {
    expect(fields({ ...SEARCH_JOB, workplace: null }).raw_mode_list).toEqual([]);
  });

  test("the description keeps the role, the requirements and the benefits, in order", () => {
    const description = fields().description ?? "";
    const order = ["Own the growth experiments.", "Five years of product design.", "A long-term contract."].map(
      (text) => description.indexOf(text)
    );
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("the posting date is when the job was created", () => {
    expect(fields().posting_date).toEqual(new Date("2026-08-30T10:59:09.401Z"));
  });
});

describe("the Workable mappers carry nothing their callers own", () => {
  test.each(["original_url", "resolved_url", "is_resolved", "is_parsed", "is_classified"])(
    "no %s is carried",
    (field) => {
      expect(field in jobFieldsFromWorkablePosting(POSTING, "blueground")).toBe(false);
      expect(field in jobFieldsFromWorkableListing(LISTING, "blueground")).toBe(false);
      expect(field in jobFieldsFromWorkableSearchJob(SEARCH_JOB)).toBe(false);
    }
  );
});
