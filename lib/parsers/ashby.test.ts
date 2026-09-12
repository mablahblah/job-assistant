import { afterEach, describe, expect, test, vi } from "vitest";
import { ashbyParser, extractAshbySlug } from "./ashby";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const JOB_URL = "https://jobs.ashbyhq.com/hinge-health/abc-123";
const API_URL = "https://api.ashbyhq.com/posting-api/job-board/hinge-health?includeCompensation=true";
const BOARD_URL = "https://jobs.ashbyhq.com/hinge-health";

const POSTING = {
  title: "Senior Product Designer",
  isListed: true,
  jobUrl: JOB_URL,
  publishedAt: "2026-08-01T09:00:00Z",
  location: "Remote - US",
  secondaryLocations: [],
  workplaceType: "Remote",
  descriptionPlain: "Design things.",
  descriptionHtml: "<p>Design things.</p>",
  compensation: {
    summaryComponents: [
      {
        compensationType: "Salary",
        interval: "1 YEAR",
        currencyCode: "USD",
        minValue: 140000,
        maxValue: 180000,
      },
    ],
  },
};

const OTHER_POSTING = {
  ...POSTING,
  title: "Staff Engineer",
  jobUrl: "https://jobs.ashbyhq.com/hinge-health/zzz-999",
};

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

function boardPage(title: string, status = 200): Response {
  return new Response(`<html><head><title>${title}</title></head><body></body></html>`, {
    status,
  });
}

function defaultRoutes(jobs: unknown[] = [OTHER_POSTING, POSTING]): Record<string, () => Response> {
  return {
    [API_URL]: () => jsonResponse({ jobs, apiVersion: "1" }),
    [BOARD_URL]: () => boardPage("Hinge Health Jobs"),
  };
}

describe("extractAshbySlug: the board slug is read off the link", () => {
  test("the first path segment is the board", () => {
    expect(extractAshbySlug(JOB_URL)).toBe("hinge-health");
  });

  test("a link naming no board gives nothing", () => {
    expect(extractAshbySlug("https://jobs.ashbyhq.com/")).toBeNull();
  });

  test("a string that is not a link gives nothing rather than throwing", () => {
    expect(extractAshbySlug("not-a-url")).toBeNull();
  });
});

describe("ashbyParser: the posting is found in the board answer", () => {
  test("AC 16: the posting is matched on its link key, not on exact text", async () => {
    // The stored link carries a query string the board's own link does not.
    stubFetch(defaultRoutes());

    const fields = await ashbyParser.parse({ url: `${JOB_URL}?utm_source=jobboard` });

    expect(fields.raw_title).toBe("Senior Product Designer");
  });

  test("the right posting is picked out of a board holding several", async () => {
    stubFetch(defaultRoutes());

    const fields = await ashbyParser.parse({ url: JOB_URL });

    expect(fields.raw_title).toBe("Senior Product Designer");
  });

  test("a posting no longer on the board gives no fields at all", async () => {
    stubFetch(defaultRoutes([OTHER_POSTING]));

    await expect(ashbyParser.parse({ url: JOB_URL })).resolves.toEqual({});
  });

  test("AC 9: every request says it is a browser", async () => {
    const seen: (Record<string, string> | undefined)[] = [];
    globalThis.fetch = (async (input: unknown, options: unknown) => {
      seen.push((options as { headers?: Record<string, string> })?.headers);
      return defaultRoutes()[String(input)]();
    }) as unknown as typeof globalThis.fetch;

    await ashbyParser.parse({ url: JOB_URL });

    expect(seen).toHaveLength(2);
    for (const headers of seen) {
      expect(headers?.["user-agent"]).toMatch(/Mozilla/);
    }
  });

  test("the posting's own fields come back", async () => {
    stubFetch(defaultRoutes());

    const fields = await ashbyParser.parse({ url: JOB_URL });

    expect(fields.raw_company_slug).toBe("hinge-health");
    expect(fields.raw_location_list).toEqual(["Remote - US"]);
    expect(fields.raw_mode_list).toEqual(["Remote"]);
    expect(fields.description).toBe("Design things.");
  });

  test("AC 11 and 12: no link and no phase gate come back", async () => {
    stubFetch(defaultRoutes());

    const fields = await ashbyParser.parse({ url: JOB_URL });

    for (const field of ["resolved_url", "original_url", "is_parsed"]) {
      expect(field in fields).toBe(false);
    }
  });
});

describe("ashbyParser: the employer is named off the board page", () => {
  test("AC 13: the board page title becomes the employer name", async () => {
    stubFetch(defaultRoutes());

    const fields = await ashbyParser.parse({ url: JOB_URL });

    expect(fields.raw_company_name).toBe("Hinge Health");
  });

  test("AC 14: a board page answering with an error writes no employer name", async () => {
    stubFetch({ ...defaultRoutes(), [BOARD_URL]: () => boardPage("Not Found", 404) });

    const fields = await ashbyParser.parse({ url: JOB_URL });

    expect(fields.raw_company_name).toBeUndefined();
  });

  test("a board page that will not load costs the name, not the parse", async () => {
    stubFetch({
      ...defaultRoutes(),
      [BOARD_URL]: () => {
        throw new Error("network is down");
      },
    });

    const fields = await ashbyParser.parse({ url: JOB_URL });

    expect(fields.raw_title).toBe("Senior Product Designer");
    expect(fields.raw_company_name).toBeUndefined();
  });

  test("a posting no longer on the board costs no request for a name", async () => {
    const calls = stubFetch(defaultRoutes([OTHER_POSTING]));

    await ashbyParser.parse({ url: JOB_URL });

    expect(calls).not.toContain(BOARD_URL);
  });
});

describe("ashbyParser: the description fills what the board did not publish", () => {
  test("AC 19: a published pay range is not replaced by one in the description", async () => {
    stubFetch(
      defaultRoutes([{ ...POSTING, descriptionPlain: "Pays $10 - $12 per hour." }])
    );

    const fields = await ashbyParser.parse({ url: JOB_URL });

    expect(fields.raw_salary).toEqual({
      salary_min: 140000,
      salary_max: 180000,
      salary_period: "1 YEAR",
      salary_currency: "USD",
    });
  });

  test("AC 20: a pay range stated only in the description is read out of it", async () => {
    stubFetch(
      defaultRoutes([
        {
          ...POSTING,
          compensation: { summaryComponents: [] },
          descriptionPlain: "The range is $120,000 - $150,000 per year.",
        },
      ])
    );

    const fields = await ashbyParser.parse({ url: JOB_URL });

    expect(fields.raw_salary).toEqual({
      salary_min: 120000,
      salary_max: 150000,
      salary_period: "year",
    });
  });
});

describe("ashbyParser: a parse that cannot read its source throws", () => {
  test("a link naming no board throws rather than answering nothing", async () => {
    stubFetch(defaultRoutes());

    await expect(ashbyParser.parse({ url: "https://jobs.ashbyhq.com/" })).rejects.toThrow();
  });

  test("the board refusing the request throws an error naming the status", async () => {
    stubFetch({ ...defaultRoutes(), [API_URL]: () => jsonResponse({}, 503) });

    await expect(ashbyParser.parse({ url: JOB_URL })).rejects.toThrow(/503/);
  });
});

describe("ashbyParser: the parser names itself", () => {
  test("its name is the one the source priority list uses", () => {
    expect(ashbyParser.name).toBe("ashby");
  });
});
