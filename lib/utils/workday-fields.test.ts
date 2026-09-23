import { describe, expect, test } from "vitest";
import {
  jobFieldsFromWorkdayListing,
  jobFieldsFromWorkdayPosting,
  partsFromWorkdayBoard,
  workdayJobListUrl,
  workdayPostingUrl,
  workdayBoardFromUrl,
  workdayJobPathFromUrl,
  workdayPostingDataUrl,
  type WorkdayPostingInfo,
} from "./workday-fields";

// Real link shapes, measured across the 41 stored Workday links on 2026-09-23.
const PLAIN = "https://meredith.wd5.myworkdayjobs.com/EXT/job/New-York-NY/Director--Design_JR15366";
const WITH_LANGUAGE =
  "https://meredith.wd5.myworkdayjobs.com/en-US/EXT/job/New-York-NY/Product-Designer_JR15400";
const WITH_APPLY =
  "https://att.wd1.myworkdayjobs.com/ATTGeneral/job/Dallas-Texas/Principal-UX-Designer_R-122523/apply";
const NO_LOCATION =
  "https://wonder.wd1.myworkdayjobs.com/en-US/WG/job/Product-Designer-II_JR101067";
const WITH_QUERY =
  "https://jj.wd5.myworkdayjobs.com/en-US/JJ/job/New-Brunswick-NJ/Sr-Product-Designer_R-099819-1/apply?source=DirectEmployersAssoc";

describe("a board is read off a Workday link as one joined value", () => {
  test("company, data centre and site, joined by a colon", () => {
    expect(workdayBoardFromUrl(PLAIN)).toBe("meredith:wd5:EXT");
  });

  test("a language segment before the site is not part of the board", () => {
    expect(workdayBoardFromUrl(WITH_LANGUAGE)).toBe("meredith:wd5:EXT");
  });

  test("two links on one board, one carrying a language segment, name one board", () => {
    expect(workdayBoardFromUrl(PLAIN)).toBe(workdayBoardFromUrl(WITH_LANGUAGE));
  });

  test("any language segment is passed over, not only English", () => {
    expect(
      workdayBoardFromUrl("https://fis.wd5.myworkdayjobs.com/sr-RS/SearchJobs/job/US-FL/Lead_JR1")
    ).toBe("fis:wd5:SearchJobs");
  });

  test("a trailing apply page and a query string leave the board as it is", () => {
    expect(workdayBoardFromUrl(WITH_APPLY)).toBe("att:wd1:ATTGeneral");
    expect(workdayBoardFromUrl(WITH_QUERY)).toBe("jj:wd5:JJ");
  });

  test("a link with no job in its path names no board", () => {
    expect(workdayBoardFromUrl("https://meredith.wd5.myworkdayjobs.com/EXT")).toBeNull();
  });

  test("a string that is not a link names no board", () => {
    expect(workdayBoardFromUrl("not a link")).toBeNull();
  });
});

describe("a stored board splits back into the parts it was joined from", () => {
  test("the three parts come back in the order they were joined", () => {
    expect(partsFromWorkdayBoard("meredith:wd5:EXT")).toEqual({
      company: "meredith",
      dataCentre: "wd5",
      site: "EXT",
    });
  });

  test("a board read off a link splits back into that link's parts", () => {
    const board = workdayBoardFromUrl(WITH_LANGUAGE);
    expect(partsFromWorkdayBoard(board ?? "")).toEqual({
      company: "meredith",
      dataCentre: "wd5",
      site: "EXT",
    });
  });

  test("a value with the wrong number of parts is not a Workday board", () => {
    expect(partsFromWorkdayBoard("meredith:wd5")).toBeNull();
    expect(partsFromWorkdayBoard("stripe")).toBeNull();
  });

  test("a value with an empty part is not a Workday board", () => {
    expect(partsFromWorkdayBoard("meredith::EXT")).toBeNull();
  });
});

describe("the job's own path is read off the link", () => {
  test("a location and a posting name", () => {
    expect(workdayJobPathFromUrl(PLAIN)).toBe("New-York-NY/Director--Design_JR15366");
  });

  test("a posting with no location segment", () => {
    expect(workdayJobPathFromUrl(NO_LOCATION)).toBe("Product-Designer-II_JR101067");
  });

  test("a trailing apply page and a query string are not part of the job", () => {
    expect(workdayJobPathFromUrl(WITH_APPLY)).toBe("Dallas-Texas/Principal-UX-Designer_R-122523");
    expect(workdayJobPathFromUrl(WITH_QUERY)).toBe("New-Brunswick-NJ/Sr-Product-Designer_R-099819-1");
  });

  test("a link with nothing after job names no posting", () => {
    expect(workdayJobPathFromUrl("https://meredith.wd5.myworkdayjobs.com/EXT/job/")).toBeNull();
  });
});

describe("a posting's data address is built from its board and path", () => {
  // Measured 2026-09-23: this address returns the posting as data, and it
  // rejects a language segment, which is why the board never carries one.
  test("the address Workday serves the posting's data from", () => {
    expect(
      workdayPostingDataUrl(
        { company: "meredith", dataCentre: "wd5", site: "EXT" },
        "New-York-NY/Director--Design_JR15366"
      )
    ).toBe(
      "https://meredith.wd5.myworkdayjobs.com/wday/cxs/meredith/EXT/job/New-York-NY/Director--Design_JR15366"
    );
  });
});

describe("a posting's fields are mapped", () => {
  // The shape the data address returned for the circle posting, measured
  // 2026-09-23.
  const INFO: WorkdayPostingInfo = {
    title: "Lead Product Designer",
    jobDescription: "<p>Design the wallet.</p>",
    location: "San Francisco - remote first in US",
    additionalLocations: ["New York, NY"],
    postedOn: "Posted 8 Days Ago",
    startDate: "2026-09-15",
    timeType: "Full time",
    jobReqId: "JR101140",
  };

  const fields = jobFieldsFromWorkdayPosting(INFO, "circle:wd1:circle");

  test("the title", () => {
    expect(fields.raw_title).toBe("Lead Product Designer");
  });

  test("the board, as the employer's identity", () => {
    expect(fields.raw_company_slug).toBe("circle:wd1:circle");
  });

  test("every location the posting lists", () => {
    expect(fields.raw_location_list).toEqual(["San Francisco - remote first in US", "New York, NY"]);
  });

  test("a posting listing one location", () => {
    const one = jobFieldsFromWorkdayPosting({ ...INFO, additionalLocations: undefined }, "b:wd1:s");
    expect(one.raw_location_list).toEqual(["San Francisco - remote first in US"]);
  });

  test("the start date, which is a real date rather than an age", () => {
    expect(fields.posting_date).toEqual(new Date("2026-09-15"));
  });

  test("the description", () => {
    expect(fields.description).toBe("<p>Design the wallet.</p>");
  });

  test("no employer name, because Workday names the legal entity instead", () => {
    expect(fields.raw_company_name).toBeUndefined();
  });
});

describe("a board's job list is asked for at its data address", () => {
  // Measured 2026-09-21: a POST to this address returns the board's jobs, 20
  // at a time.
  test("the address Workday serves a board's job list from", () => {
    expect(workdayJobListUrl({ company: "meredith", dataCentre: "wd5", site: "EXT" })).toBe(
      "https://meredith.wd5.myworkdayjobs.com/wday/cxs/meredith/EXT/jobs"
    );
  });
});

describe("a listed job's link is built from its board and the path the list gives", () => {
  test("the posting's public address, with no language segment", () => {
    expect(
      workdayPostingUrl(
        { company: "meredith", dataCentre: "wd5", site: "EXT" },
        "/job/New-York-NY/Senior-Product-Designer_JR20001"
      )
    ).toBe("https://meredith.wd5.myworkdayjobs.com/EXT/job/New-York-NY/Senior-Product-Designer_JR20001");
  });

  test("a link built from a listing names the board it came from", () => {
    const link = workdayPostingUrl(
      { company: "meredith", dataCentre: "wd5", site: "EXT" },
      "/job/New-York-NY/Senior-Product-Designer_JR20001"
    );
    expect(workdayBoardFromUrl(link)).toBe("meredith:wd5:EXT");
    expect(workdayJobPathFromUrl(link)).toBe("New-York-NY/Senior-Product-Designer_JR20001");
  });
});

describe("a listed job's fields are mapped", () => {
  // The shape a board's job list returned, measured 2026-09-21.
  const LISTING = {
    title: "Senior Product Designer",
    externalPath: "/job/New-York-NY/Senior-Product-Designer_JR20001",
    locationsText: "New York, NY",
    postedOn: "Posted 30+ Days Ago",
    bulletFields: ["JR20001"],
  };

  const fields = jobFieldsFromWorkdayListing(LISTING, "meredith:wd5:EXT");

  test("the title", () => {
    expect(fields.raw_title).toBe("Senior Product Designer");
  });

  test("the board, as the employer's identity", () => {
    expect(fields.raw_company_slug).toBe("meredith:wd5:EXT");
  });

  test("the location the list gives", () => {
    expect(fields.raw_location_list).toEqual(["New York, NY"]);
  });

  test("a listing with no location gives an empty list", () => {
    expect(jobFieldsFromWorkdayListing({ ...LISTING, locationsText: undefined }, "b:wd1:s").raw_location_list).toEqual([]);
  });

  // Workday's list gives an age such as "Posted 30+ Days Ago", not a date.
  // The parser fills the real start date from the posting.
  test("no posting date, because the list gives an age rather than a date", () => {
    expect(fields.posting_date).toBeUndefined();
  });

  test("no description, because the list carries none", () => {
    expect(fields.description).toBeUndefined();
  });
});
