import { afterEach, describe, expect, test, vi } from "vitest";
import { extractLeverSlugAndId, leverParser } from "./lever";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const POSTING = {
  id: "abc-123",
  text: "Senior Product Designer",
  createdAt: 1754042400000,
  categories: { location: "Remote - US", team: "Design" },
  workplaceType: "remote",
  descriptionPlain: "Design things.",
  description: "<p>Design things.</p>",
};

const JOB_URL = "https://jobs.lever.co/gohighlevel/abc-123";
const API_URL = "https://api.lever.co/v0/postings/gohighlevel/abc-123";
const BOARD_URL = "https://jobs.lever.co/gohighlevel";

// Answers per-url from a small map the test builds, recording every call.
function stubFetch(routes: Record<string, () => Response>): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown, options: unknown) => {
    const url = String(input);
    calls.push(url);
    const respond = routes[url];
    if (respond === undefined) {
      throw new Error(`no fetch stub set up for ${url}`);
    }
    void options;
    return respond();
  }) as unknown as typeof globalThis.fetch;
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function boardPage(title: string, status = 200): Response {
  return new Response(`<html><head><title>${title}</title></head><body></body></html>`, {
    status,
  });
}

function defaultRoutes(): Record<string, () => Response> {
  return {
    [API_URL]: () => jsonResponse(POSTING),
    [BOARD_URL]: () => boardPage("HighLevel"),
  };
}

describe("extractLeverSlugAndId: the board slug and the posting id are read off the link", () => {
  test("a posting link carries both in its path", () => {
    expect(extractLeverSlugAndId(JOB_URL)).toEqual({
      slug: "gohighlevel",
      postingId: "abc-123",
    });
  });

  test("a trailing slash changes nothing", () => {
    expect(extractLeverSlugAndId(`${JOB_URL}/`)).toEqual({
      slug: "gohighlevel",
      postingId: "abc-123",
    });
  });

  test("a link naming only a board gives nothing", () => {
    expect(extractLeverSlugAndId(BOARD_URL)).toBeNull();
  });

  test("a string that is not a link gives nothing rather than throwing", () => {
    expect(extractLeverSlugAndId("not-a-url")).toBeNull();
  });
});

describe("leverParser: the posting is read from the postings API", () => {
  test("the request names the board and the posting", async () => {
    const calls = stubFetch(defaultRoutes());

    await leverParser.parse({ url: JOB_URL });

    expect(calls).toContain(API_URL);
  });

  test("AC 9: every request says it is a browser", async () => {
    const seen: (Record<string, string> | undefined)[] = [];
    globalThis.fetch = (async (input: unknown, options: unknown) => {
      seen.push((options as { headers?: Record<string, string> })?.headers);
      return defaultRoutes()[String(input)]();
    }) as unknown as typeof globalThis.fetch;

    await leverParser.parse({ url: JOB_URL });

    expect(seen).toHaveLength(2);
    for (const headers of seen) {
      expect(headers?.["user-agent"]).toMatch(/Mozilla/);
    }
  });

  test("the posting's own fields come back", async () => {
    stubFetch(defaultRoutes());

    const fields = await leverParser.parse({ url: JOB_URL });

    expect(fields.raw_title).toBe("Senior Product Designer");
    expect(fields.raw_company_slug).toBe("gohighlevel");
    expect(fields.description).toBe("Design things.");
    expect(fields.raw_mode_list).toEqual(["remote"]);
  });

  test("AC 11 and 12: no link and no phase gate come back", async () => {
    stubFetch(defaultRoutes());

    const fields = await leverParser.parse({ url: JOB_URL });

    for (const field of ["resolved_url", "original_url", "is_parsed"]) {
      expect(field in fields).toBe(false);
    }
  });
});

describe("leverParser: the employer is named off the board page", () => {
  test("AC 13: the board page title becomes the employer name", async () => {
    stubFetch(defaultRoutes());

    const fields = await leverParser.parse({ url: JOB_URL });

    expect(fields.raw_company_name).toBe("HighLevel");
  });

  test("AC 14: a board page answering with an error writes no employer name", async () => {
    stubFetch({ ...defaultRoutes(), [BOARD_URL]: () => boardPage("Not Found", 404) });

    const fields = await leverParser.parse({ url: JOB_URL });

    expect(fields.raw_company_name).toBeUndefined();
  });

  test("a board page whose title is not a name writes no employer name", async () => {
    stubFetch({
      ...defaultRoutes(),
      [BOARD_URL]: () => boardPage("Jobs | Careers | Apply now"),
    });

    const fields = await leverParser.parse({ url: JOB_URL });

    expect(fields.raw_company_name).toBeUndefined();
  });

  test("a board page that will not load costs the name, not the parse", async () => {
    stubFetch({
      ...defaultRoutes(),
      [BOARD_URL]: () => {
        throw new Error("network is down");
      },
    });

    const fields = await leverParser.parse({ url: JOB_URL });

    expect(fields.raw_title).toBe("Senior Product Designer");
    expect(fields.raw_company_name).toBeUndefined();
  });
});

describe("leverParser: the description fills what the API did not publish", () => {
  test("AC 19: a published work mode is not replaced by one in the description", async () => {
    stubFetch({
      ...defaultRoutes(),
      [API_URL]: () => jsonResponse({ ...POSTING, descriptionPlain: "This role is hybrid." }),
    });

    const fields = await leverParser.parse({ url: JOB_URL });

    expect(fields.raw_mode_list).toEqual(["remote"]);
  });

  test("AC 20: a pay range stated only in the description is read out of it", async () => {
    stubFetch({
      ...defaultRoutes(),
      [API_URL]: () =>
        jsonResponse({ ...POSTING, descriptionPlain: "The range is $120,000 - $150,000 per year." }),
    });

    const fields = await leverParser.parse({ url: JOB_URL });

    expect(fields.raw_salary).toEqual({
      salary_min: 120000,
      salary_max: 150000,
      salary_period: "year",
    });
  });
});

describe("leverParser: a parse that cannot read its source throws", () => {
  test("a link naming no posting throws rather than answering nothing", async () => {
    stubFetch(defaultRoutes());

    await expect(leverParser.parse({ url: BOARD_URL })).rejects.toThrow();
  });

  test("the API refusing the request throws an error naming the status", async () => {
    stubFetch({ ...defaultRoutes(), [API_URL]: () => jsonResponse({}, 503) });

    await expect(leverParser.parse({ url: JOB_URL })).rejects.toThrow(/503/);
  });
});

describe("leverParser: the parser names itself", () => {
  test("its name is the one the source priority list uses", () => {
    expect(leverParser.name).toBe("lever");
  });
});
