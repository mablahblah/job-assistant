import { describe, expect, test } from "vitest";
import {
  jobFieldsFromUltiproPosting,
  partsFromUltiproBoard,
  ultiproBoardFromUrl,
  ultiproJobListUrl,
  ultiproPostingUrl,
  ultiproPostingFromPage,
} from "./ultipro-fields";
import type { UltiproPosting } from "../types/ultipro-posting";

// A stored link exactly as an aggregator saved it, measured in pipeline.db on
// 2026-09-23: lower case, the job's identity in the query string.
const STORED =
  "https://recruiting.ultipro.com/tel1010tefo/jobboard/914e6c7a-35d4-4079-865a-b3a7e7758070/opportunitydetail?opportunityid=e3a376f8-6759-4047-a7e7-79a7a3457ab0&utm_source=adzuna&utm_medium=adzuna";

// The same posting as UltiPro spells its own addresses, in mixed case.
const UPPER =
  "https://recruiting.ultipro.com/TEL1010TEFO/JobBoard/914E6C7A-35D4-4079-865A-B3A7E7758070/OpportunityDetail?opportunityId=e3a376f8-6759-4047-a7e7-79a7a3457ab0";

describe("a board is read off an UltiPro link as one joined value", () => {
  test("company code and board id, joined by a colon", () => {
    expect(ultiproBoardFromUrl(STORED)).toBe(
      "tel1010tefo:914e6c7a-35d4-4079-865a-b3a7e7758070"
    );
  });

  test("the same board spelled in another case names one board", () => {
    expect(ultiproBoardFromUrl(UPPER)).toBe(ultiproBoardFromUrl(STORED));
  });

  test("a link with no job board in its path names no board", () => {
    expect(ultiproBoardFromUrl("https://recruiting.ultipro.com/tel1010tefo")).toBeNull();
  });

  test("a string that is not a link names no board", () => {
    expect(ultiproBoardFromUrl("not a link")).toBeNull();
  });
});

describe("a stored board splits back into the parts it was joined from", () => {
  test("the two parts come back in the order they were joined", () => {
    expect(partsFromUltiproBoard("tel1010tefo:914e6c7a-35d4-4079-865a-b3a7e7758070")).toEqual({
      companyCode: "tel1010tefo",
      boardId: "914e6c7a-35d4-4079-865a-b3a7e7758070",
    });
  });

  test("a value with the wrong number of parts is not an UltiPro board", () => {
    expect(partsFromUltiproBoard("tel1010tefo")).toBeNull();
    expect(partsFromUltiproBoard("meredith:wd5:EXT")).toBeNull();
  });

  test("a value with an empty part is not an UltiPro board", () => {
    expect(partsFromUltiproBoard(":914e6c7a")).toBeNull();
  });
});

describe("the posting is read out of the script its page embeds it in", () => {
  // The page as UltiPro serves it to a plain request, measured 2026-09-23:
  // the whole job is handed to CandidateOpportunityDetail inside a script.
  const DETAIL = {
    Id: "e3a376f8-6759-4047-a7e7-79a7a3457ab0",
    Title: "Product Designer",
    Description: "<p>Design the claims flow (see details); apply by Friday.</p>",
    PostedDate: "2026-08-25T15:00:00.000Z",
    UpdatedDate: "2026-08-26T15:00:00.000Z",
    Locations: [],
  };
  const page = (detail: unknown) =>
    [
      "<html><body><script>",
      "    $(function () {",
      `        var opportunity = new US.Opportunity.CandidateOpportunityDetail(${JSON.stringify(detail)});`,
      "    });",
      "</script></body></html>",
    ].join("\n");

  test("the job data comes back whole", () => {
    expect(ultiproPostingFromPage(page(DETAIL))).toEqual(DETAIL);
  });

  test("brackets and semicolons inside the description do not cut it short", () => {
    expect(ultiproPostingFromPage(page(DETAIL))?.Description).toBe(DETAIL.Description);
  });

  test("a page with no embedded job gives nothing", () => {
    expect(ultiproPostingFromPage("<html><body>Not found</body></html>")).toBeNull();
  });
});

describe("a posting's fields are mapped", () => {
  const POSTING: UltiproPosting = {
    Id: "e3a376f8-6759-4047-a7e7-79a7a3457ab0",
    Title: "Product Designer",
    Description: "<p>Design the claims experience.</p>",
    PostedDate: "2026-08-25T15:00:00.000Z",
    UpdatedDate: "2026-08-26T15:00:00.000Z",
    Locations: [
      {
        LocalizedName: "Austin Office",
        Address: {
          City: "Austin",
          State: { Code: "TX", Name: "Texas" },
          Country: { Code: "USA", Name: "United States" },
        },
      },
      {
        LocalizedName: "Denver Office",
        Address: {
          City: "Denver",
          State: { Code: "CO", Name: "Colorado" },
          Country: { Code: "USA", Name: "United States" },
        },
      },
    ],
  };

  const BOARD = "tel1010tefo:914e6c7a-35d4-4079-865a-b3a7e7758070";
  const fields = jobFieldsFromUltiproPosting(POSTING, BOARD);

  test("the title", () => {
    expect(fields.raw_title).toBe("Product Designer");
  });

  test("the board, as the employer's identity", () => {
    expect(fields.raw_company_slug).toBe(BOARD);
  });

  test("every location the posting lists, each as its city, state and country", () => {
    expect(fields.raw_location_list).toEqual([
      "Austin, TX, United States",
      "Denver, CO, United States",
    ]);
  });

  test("a location with no address falls back to its own name", () => {
    const named = jobFieldsFromUltiproPosting(
      { ...POSTING, Locations: [{ LocalizedName: "Remote - US" }] },
      BOARD
    );
    expect(named.raw_location_list).toEqual(["Remote - US"]);
  });

  test("the posted date and the updated date", () => {
    expect(fields.posting_date).toEqual(new Date("2026-08-25T15:00:00.000Z"));
    expect(fields.posting_updated_date).toEqual(new Date("2026-08-26T15:00:00.000Z"));
  });

  test("the description", () => {
    expect(fields.description).toBe("<p>Design the claims experience.</p>");
  });
});

describe("a board's job list is asked for at its search address", () => {
  // Measured 2026-09-23: a POST to this address returns the board's jobs.
  test("the address UltiPro serves a board's job list from", () => {
    expect(
      ultiproJobListUrl({
        companyCode: "tel1010tefo",
        boardId: "914e6c7a-35d4-4079-865a-b3a7e7758070",
      })
    ).toBe(
      "https://recruiting.ultipro.com/tel1010tefo/jobboard/914e6c7a-35d4-4079-865a-b3a7e7758070/jobboardview/loadsearchresults"
    );
  });
});

describe("a listed job's link is built from its board and its id", () => {
  const PARTS = { companyCode: "tel1010tefo", boardId: "914e6c7a-35d4-4079-865a-b3a7e7758070" };
  const ID = "e3a376f8-6759-4047-a7e7-79a7a3457ab0";

  // Written the way stored links are, so a job the collector finds and the
  // same job an aggregator found carry one link.
  test("the posting page's address, in the form stored links take", () => {
    expect(ultiproPostingUrl(PARTS, ID)).toBe(
      "https://recruiting.ultipro.com/tel1010tefo/jobboard/914e6c7a-35d4-4079-865a-b3a7e7758070/opportunitydetail?opportunityid=e3a376f8-6759-4047-a7e7-79a7a3457ab0"
    );
  });

  // The job id comes from UltiPro's own reply, so a character that means
  // something inside a web address must arrive as part of the id.
  test("a job id holding query characters stays one query value", () => {
    const link = new URL(ultiproPostingUrl(PARTS, "a1&utm_source=x"));

    expect(link.searchParams.get("opportunityid")).toBe("a1&utm_source=x");
    expect(link.searchParams.has("utm_source")).toBe(false);
  });

  test("a link built from a listing names the board it came from", () => {
    expect(ultiproBoardFromUrl(ultiproPostingUrl(PARTS, ID))).toBe(
      "tel1010tefo:914e6c7a-35d4-4079-865a-b3a7e7758070"
    );
  });
});
