import { afterEach, describe, expect, test } from "vitest";
import { workableCollector } from "./workable";
import { fakeSettingsService } from "../services/settings-service.fake";
import { fakeAtsSlugService } from "../services/ats-slug-service.fake";
import type { CollectorContext } from "./collector";
import { fakeLastSuccessService } from "../services/last-success-service.fake";

// No collector here remembers its searches, so the last-success service each
// one is handed holds no time, and none reads the collection time.
const noTimes = fakeLastSuccessService();
const COLLECTED_AT = new Date("2026-01-01T00:00:00.000Z");

const COLLECTOR_NAME = "workable";

// Each test swaps the global fetch for a plain stand-in and the real one is
// put back afterwards, so nothing leaks into the next test.
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Stands in for global fetch, answering per-url from a small map the test
// builds. Every call is recorded in order.
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

// The documented address Workable lists a whole board's jobs at.
const widgetUrl = (board: string) => `https://apply.workable.com/api/v1/widget/accounts/${board}`;

// One job in a board's widget list, shaped like the blueground board's on
// 2026-09-24. Its own link carries no board name.
function listing(shortcode: string, title: string) {
  return {
    title,
    shortcode,
    employment_type: "Full-time",
    telecommuting: false,
    url: `https://apply.workable.com/j/${shortcode}`,
    shortlink: `https://apply.workable.com/j/${shortcode}`,
    published_on: "2026-09-10",
    created_at: "2026-08-30",
    country: "Greece",
    city: "Athens",
    state: "Attica",
  };
}

const board = (...jobs: ReturnType<typeof listing>[]) => () =>
  jsonResponse({ name: "Blueground", description: "", jobs });

const DESIGNER = listing("08717EF2F6", "Senior Product Designer");
const COORDINATOR = listing("186545F8C1", "Client Experience Coordinator");

describe("workableCollector: a board's matching jobs are collected", () => {
  test("the board's whole job list is asked for once", async () => {
    const calls = stubFetch({ [widgetUrl("blueground")]: board(DESIGNER) });

    await workableCollector.collect(makeContext(["blueground"]));

    expect(calls).toEqual([widgetUrl("blueground")]);
  });

  test("only jobs whose title matches a search term are collected", async () => {
    stubFetch({ [widgetUrl("blueground")]: board(DESIGNER, COORDINATOR) });

    const { jobs } = await workableCollector.collect(makeContext(["blueground"]));

    expect(jobs.map((job) => job.raw_title)).toEqual(["Senior Product Designer"]);
  });

  test("a collected job links to its posting on the board's company site", async () => {
    // The widget's own link leaves the board out, and the board is what a
    // later read of the posting needs.
    stubFetch({ [widgetUrl("blueground")]: board(DESIGNER) });

    const [job] = (await workableCollector.collect(makeContext(["blueground"]))).jobs;

    expect(job?.original_url).toBe("https://apply.workable.com/blueground/j/08717EF2F6");
    expect(job?.resolved_url).toBe(job?.original_url);
  });

  test("a collected job carries the employer's name the board gives", async () => {
    stubFetch({ [widgetUrl("blueground")]: board(DESIGNER) });

    const [job] = (await workableCollector.collect(makeContext(["blueground"]))).jobs;

    expect(job?.raw_company_name).toBe("Blueground");
    expect(job?.raw_company_slug).toBe("blueground");
  });

  test("a board that gives no name leaves the employer's name out", async () => {
    stubFetch({ [widgetUrl("blueground")]: () => jsonResponse({ description: "", jobs: [DESIGNER] }) });

    const [job] = (await workableCollector.collect(makeContext(["blueground"]))).jobs;

    expect(job).toBeDefined();
    expect(job && "raw_company_name" in job).toBe(false);
  });

  test("a collected job is already resolved, but still to be parsed and classified", async () => {
    stubFetch({ [widgetUrl("blueground")]: board(DESIGNER) });

    const [job] = (await workableCollector.collect(makeContext(["blueground"]))).jobs;

    expect(job?.is_resolved).toBe(true);
    expect(job?.is_parsed).toBe(false);
    expect(job?.is_classified).toBe(false);
  });

  test("collection stops at the limit", async () => {
    stubFetch({
      [widgetUrl("blueground")]: board(DESIGNER, listing("99AA99AA99", "Product Designer, Growth")),
    });

    const { jobs } = await workableCollector.collect(makeContext(["blueground"], 1));

    expect(jobs).toHaveLength(1);
  });
});

describe("workableCollector: one broken board skips only that board", () => {
  test("a failed request is warned about and the next board is still polled", async () => {
    globalThis.fetch = (async (input: unknown) => {
      if (String(input) === widgetUrl("dead")) throw new TypeError("fetch failed");
      return board(DESIGNER)();
    }) as unknown as typeof globalThis.fetch;

    const result = await workableCollector.collect(makeContext(["dead", "blueground"]));

    expect(result.jobs).toHaveLength(1);
    expect(result.warnings.join("\n")).toContain("dead");
  });

  test("an error status is warned about and the next board is still polled", async () => {
    stubFetch({
      [widgetUrl("gone")]: () => jsonResponse({ error: "not found" }, 404),
      [widgetUrl("blueground")]: board(DESIGNER),
    });

    const result = await workableCollector.collect(makeContext(["gone", "blueground"]));

    expect(result.jobs).toHaveLength(1);
    expect(result.warnings.join("\n")).toContain("gone");
  });

  test("a reply that is not job data is warned about and the next board is still polled", async () => {
    stubFetch({
      [widgetUrl("broken")]: () => new Response("<html>Service unavailable</html>", { status: 200 }),
      [widgetUrl("blueground")]: board(DESIGNER),
    });

    const result = await workableCollector.collect(makeContext(["broken", "blueground"]));

    expect(result.jobs).toHaveLength(1);
    expect(result.warnings.join("\n")).toContain("broken");
  });
});

describe("workableCollector: an empty polling list", () => {
  test("polls nothing and says so", async () => {
    const calls = stubFetch({});

    const result = await workableCollector.collect(makeContext([]));

    expect(calls).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
});
