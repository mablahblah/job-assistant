import { afterEach, describe, expect, test } from "vitest";
import { workdayParser } from "./workday";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

// The shape Workday's data address returned for the circle posting, measured
// 2026-09-23. The employer name it carries is a legal entity name.
const POSTING = {
  jobPostingInfo: {
    title: "Lead Product Designer",
    jobDescription: "<p>Design the wallet. This role is fully remote.</p>",
    location: "San Francisco - remote first in US",
    additionalLocations: ["New York, NY"],
    postedOn: "Posted 8 Days Ago",
    startDate: "2026-09-15",
    timeType: "Full time",
    jobReqId: "JR101140",
  },
  hiringOrganization: { name: "Circle Internet Management Services LLC", url: "" },
};

const JOB_URL =
  "https://circle.wd1.myworkdayjobs.com/en-US/circle/job/San-Francisco/Lead-Product-Designer_JR101140/apply?source=LinkedIn";
const DATA_URL =
  "https://circle.wd1.myworkdayjobs.com/wday/cxs/circle/circle/job/San-Francisco/Lead-Product-Designer_JR101140";

// Answers per-url from a small map the test builds, recording every call.
function stubFetch(routes: Record<string, () => Response>): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    const respond = routes[url];
    if (respond === undefined) {
      throw new Error(`no fetch stub set up for ${url}`);
    }
    return respond();
  }) as unknown as typeof globalThis.fetch;
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("workdayParser: the posting is read from its data address", () => {
  test("the request goes to the data address, with no language segment", async () => {
    const calls = stubFetch({ [DATA_URL]: () => jsonResponse(POSTING) });

    await workdayParser.parse({ url: JOB_URL });

    expect(calls).toEqual([DATA_URL]);
  });

  test("the posting's own fields come back, with the board as the employer's identity", async () => {
    stubFetch({ [DATA_URL]: () => jsonResponse(POSTING) });

    const fields = await workdayParser.parse({ url: JOB_URL });

    expect(fields.raw_title).toBe("Lead Product Designer");
    expect(fields.raw_company_slug).toBe("circle:wd1:circle");
    expect(fields.description).toBe("<p>Design the wallet. This role is fully remote.</p>");
    expect(fields.raw_location_list).toEqual(["San Francisco - remote first in US", "New York, NY"]);
    expect(fields.raw_company_name).toBeUndefined();
  });

  test("a work mode stated only in the description is read out of it", async () => {
    stubFetch({ [DATA_URL]: () => jsonResponse(POSTING) });

    const fields = await workdayParser.parse({ url: JOB_URL });

    expect(fields.raw_mode_list).toEqual(["remote"]);
  });
});

describe("workdayParser: a parse that cannot read its source throws", () => {
  test("a link naming no posting throws rather than answering nothing", async () => {
    stubFetch({});

    await expect(
      workdayParser.parse({ url: "https://circle.wd1.myworkdayjobs.com/circle" })
    ).rejects.toThrow();
  });

  test("a closed posting, which Workday answers with 403, throws an error naming the status", async () => {
    stubFetch({ [DATA_URL]: () => jsonResponse({}, 403) });

    await expect(workdayParser.parse({ url: JOB_URL })).rejects.toThrow(/403/);
  });
});

describe("workdayParser: the parser names itself", () => {
  test("its name is the one the source priority list uses", () => {
    expect(workdayParser.name).toBe("workday");
  });
});
