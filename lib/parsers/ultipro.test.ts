import { afterEach, describe, expect, test } from "vitest";
import { ultiproParser } from "./ultipro";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const JOB_URL =
  "https://recruiting.ultipro.com/tel1010tefo/jobboard/914e6c7a-35d4-4079-865a-b3a7e7758070/opportunitydetail?opportunityid=e3a376f8-6759-4047-a7e7-79a7a3457ab0";

const DETAIL = {
  Id: "e3a376f8-6759-4047-a7e7-79a7a3457ab0",
  Title: "Product Designer",
  Description: "<p>Design the claims experience. This role is hybrid.</p>",
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
  ],
};

// The posting page as UltiPro serves it to a plain request, measured
// 2026-09-23: the whole job is handed to CandidateOpportunityDetail.
function postingPage(detail: unknown): string {
  return [
    "<html><body><script>",
    `  var opportunity = new US.Opportunity.CandidateOpportunityDetail(${JSON.stringify(detail)});`,
    "</script></body></html>",
  ].join("\n");
}

// Answers per-url from a small map the test builds, recording every call and
// the headers it carried.
function stubFetch(routes: Record<string, () => Response>) {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  globalThis.fetch = (async (input: unknown, options: unknown) => {
    const url = String(input);
    calls.push({ url, headers: (options as { headers?: Record<string, string> })?.headers });
    const respond = routes[url];
    if (respond === undefined) {
      throw new Error(`no fetch stub set up for ${url}`);
    }
    return respond();
  }) as unknown as typeof globalThis.fetch;
  return calls;
}

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/html" } });
}

describe("ultiproParser: the posting is read from its own page", () => {
  test("the page is asked for once, as a browser", async () => {
    const calls = stubFetch({ [JOB_URL]: () => htmlResponse(postingPage(DETAIL)) });

    await ultiproParser.parse({ url: JOB_URL });

    expect(calls.map((call) => call.url)).toEqual([JOB_URL]);
    expect(calls[0].headers?.["user-agent"]).toMatch(/Mozilla/);
  });

  test("the posting's own fields come back, with the board as the employer's identity", async () => {
    stubFetch({ [JOB_URL]: () => htmlResponse(postingPage(DETAIL)) });

    const fields = await ultiproParser.parse({ url: JOB_URL });

    expect(fields.raw_title).toBe("Product Designer");
    expect(fields.raw_company_slug).toBe("tel1010tefo:914e6c7a-35d4-4079-865a-b3a7e7758070");
    expect(fields.description).toBe("<p>Design the claims experience. This role is hybrid.</p>");
    expect(fields.raw_location_list).toEqual(["Austin, TX, United States"]);
  });

  test("a work mode stated only in the description is read out of it", async () => {
    stubFetch({ [JOB_URL]: () => htmlResponse(postingPage(DETAIL)) });

    const fields = await ultiproParser.parse({ url: JOB_URL });

    expect(fields.raw_mode_list).toEqual(["hybrid"]);
  });
});

describe("ultiproParser: a parse that cannot read its source throws", () => {
  test("a link naming no board throws rather than answering nothing", async () => {
    stubFetch({});

    await expect(
      ultiproParser.parse({ url: "https://recruiting.ultipro.com/tel1010tefo" })
    ).rejects.toThrow();
  });

  test("the page answering with an error throws an error naming the status", async () => {
    stubFetch({ [JOB_URL]: () => htmlResponse("Not found", 404) });

    await expect(ultiproParser.parse({ url: JOB_URL })).rejects.toThrow(/404/);
  });

  test("a page with no embedded job throws rather than answering nothing", async () => {
    stubFetch({ [JOB_URL]: () => htmlResponse("<html><body>Sign in</body></html>") });

    await expect(ultiproParser.parse({ url: JOB_URL })).rejects.toThrow();
  });
});

describe("ultiproParser: the parser names itself", () => {
  test("its name is the one the source priority list uses", () => {
    expect(ultiproParser.name).toBe("ultipro");
  });
});
