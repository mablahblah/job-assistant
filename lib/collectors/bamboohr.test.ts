import { afterEach, describe, expect, test } from "vitest";
import { bamboohrCollector } from "./bamboohr";
import { fakeSettingsService } from "../services/settings-service.fake";
import { fakeAtsSlugService } from "../services/ats-slug-service.fake";
import type { CollectorContext } from "./collector";
import { fakeLastSuccessService } from "../services/last-success-service.fake";

// No collector here remembers its searches, so the last-success service each
// one is handed holds no time, and none reads the collection time.
const noTimes = fakeLastSuccessService();
const COLLECTED_AT = new Date("2026-01-01T00:00:00.000Z");

const COLLECTOR_NAME = "bamboohr";

// Each test swaps the global fetch for a plain stand-in and the real one is
// put back afterwards, so nothing leaks into the next test.
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

interface Call {
  url: string;
  accept: string | null;
}

// Stands in for global fetch, answering per-url from a small map the test
// builds, and recording every call with the kind of reply it asked for.
function stubFetch(routes: Record<string, () => Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, accept: new Headers(init?.headers).get("accept") });
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

// What a collector is handed for one run, with a row per board already
// carrying this collector.
function makeContext(boards: string[], limit = Infinity): CollectorContext {
  return {
    settings: fakeSettingsService({ getSearchTerms: async () => ["Product Design"] }),
    collectedAt: COLLECTED_AT,
    lastSuccesses: noTimes,
    atsSlugs: fakeAtsSlugService(
      boards.map((slug, index) => ({
        id: `row-${index}`,
        slug,
        company_id: `company-${index}`,
        parser: COLLECTOR_NAME,
        collector: COLLECTOR_NAME,
      }))
    ),
    limit,
  };
}

// Where a board's careers site lists its jobs as data.
const listUrl = (board: string) => `https://${board}.bamboohr.com/careers/list`;

// One job in a board's list, shaped like the shortcut board's on 2026-09-24.
function listing(id: string, jobOpeningName: string) {
  return {
    id,
    jobOpeningName,
    departmentId: "18588",
    departmentLabel: "Engineering",
    employmentStatusLabel: "Full-Time",
    employmentType: null,
    location: { city: null, state: null },
    atsLocation: { country: "United States", state: "New York", province: null, city: "New York" },
    isRemote: null,
    locationType: "1",
  };
}

const board = (...jobs: ReturnType<typeof listing>[]) => () =>
  jsonResponse({ meta: { totalCount: jobs.length }, result: jobs });

const DESIGNER = listing("40", "Senior Product Designer");
const ENGINEER = listing("38", "Senior Product Engineer");

describe("bamboohrCollector: a board's matching jobs are collected", () => {
  test("the board's whole job list is asked for once, as data", async () => {
    const calls = stubFetch({ [listUrl("shortcut")]: board(DESIGNER) });

    await bamboohrCollector.collect(makeContext(["shortcut"]));

    expect(calls.map((call) => call.url)).toEqual([listUrl("shortcut")]);
    // A careers page answers with a web page unless it is asked for data.
    expect(calls[0]?.accept).toContain("application/json");
  });

  test("only jobs whose title matches a search term are collected", async () => {
    stubFetch({ [listUrl("shortcut")]: board(DESIGNER, ENGINEER) });

    const { jobs } = await bamboohrCollector.collect(makeContext(["shortcut"]));

    expect(jobs.map((job) => job.raw_title)).toEqual(["Senior Product Designer"]);
  });

  test("a collected job links to its page on the board's careers site", async () => {
    stubFetch({ [listUrl("shortcut")]: board(DESIGNER) });

    const [job] = (await bamboohrCollector.collect(makeContext(["shortcut"]))).jobs;

    expect(job?.original_url).toBe("https://shortcut.bamboohr.com/careers/40");
    expect(job?.resolved_url).toBe(job?.original_url);
  });

  test("a collected job is already resolved, but still to be parsed and classified", async () => {
    stubFetch({ [listUrl("shortcut")]: board(DESIGNER) });

    const [job] = (await bamboohrCollector.collect(makeContext(["shortcut"]))).jobs;

    expect(job?.is_resolved).toBe(true);
    expect(job?.is_parsed).toBe(false);
    expect(job?.is_classified).toBe(false);
    expect(job?.raw_company_slug).toBe("shortcut");
  });

  test("collection stops at the limit", async () => {
    stubFetch({ [listUrl("shortcut")]: board(DESIGNER, listing("41", "Product Designer, Growth")) });

    const { jobs } = await bamboohrCollector.collect(makeContext(["shortcut"], 1));

    expect(jobs).toHaveLength(1);
  });
});

describe("bamboohrCollector: one broken board skips only that board", () => {
  test("a failed request is warned about and the next board is still polled", async () => {
    globalThis.fetch = (async (input: unknown) => {
      if (String(input) === listUrl("dead")) throw new TypeError("fetch failed");
      return board(DESIGNER)();
    }) as unknown as typeof globalThis.fetch;

    const result = await bamboohrCollector.collect(makeContext(["dead", "shortcut"]));

    expect(result.jobs).toHaveLength(1);
    expect(result.warnings.join("\n")).toContain("dead");
  });

  test("an error status is warned about and the next board is still polled", async () => {
    stubFetch({
      [listUrl("gone")]: () => jsonResponse({ message: "not found" }, 404),
      [listUrl("shortcut")]: board(DESIGNER),
    });

    const result = await bamboohrCollector.collect(makeContext(["gone", "shortcut"]));

    expect(result.jobs).toHaveLength(1);
    expect(result.warnings.join("\n")).toContain("gone");
  });

  test("a reply that is not job data is warned about and the next board is still polled", async () => {
    stubFetch({
      [listUrl("broken")]: () => new Response("<html>Careers</html>", { status: 200 }),
      [listUrl("shortcut")]: board(DESIGNER),
    });

    const result = await bamboohrCollector.collect(makeContext(["broken", "shortcut"]));

    expect(result.jobs).toHaveLength(1);
    expect(result.warnings.join("\n")).toContain("broken");
  });
});

describe("bamboohrCollector: an empty polling list", () => {
  test("polls nothing and says so", async () => {
    const calls = stubFetch({});

    const result = await bamboohrCollector.collect(makeContext([]));

    expect(calls).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
});
