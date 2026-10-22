import { afterEach, describe, expect, test } from "vitest";
import { gemCollector } from "./gem";
import { fakeSettingsService } from "../services/settings-service.fake";
import { fakeAtsSlugService } from "../services/ats-slug-service.fake";
import type { CollectorContext } from "./collector";
import { fakeLastSuccessService } from "../services/last-success-service.fake";

// No collector here remembers its searches, so the last-success service each
// one is handed holds no time, and none reads the collection time.
const NO_TIMES = fakeLastSuccessService();
const COLLECTED_AT = new Date("2026-01-01T00:00:00.000Z");

const COLLECTOR_NAME = "gem";

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

// What a collector is handed for one run. The boards live in the ATS slug
// table, so the fake slug service is seeded with a row per board, each
// already carrying this collector.
function makeContext(boards: string[], limit = Infinity): CollectorContext {
  return {
    settings: fakeSettingsService({ getSearchTerms: async () => ["Product Design"] }),
    collectedAt: COLLECTED_AT,
    lastSuccesses: NO_TIMES,
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

// The address Gem's job board API lists a whole board at.
const boardUrl = (board: string) => `https://api.gem.com/job_board/v0/${board}/job_posts/`;

// Shaped like a posting from that address, measured on the fetch board on
// 2026-09-24.
function posting(id: string, title: string) {
  return {
    absolute_url: `https://jobs.gem.com/fetch/${id}`,
    content: "<p>A role.</p>",
    content_plain: "A role.",
    created_at: "2026-08-28T22:26:01.000Z",
    first_published_at: "2026-08-30T22:51:02.331Z",
    updated_at: "2026-08-31T16:08:06.647Z",
    id,
    location: { name: "United States - Remote" },
    location_type: "remote",
    title,
  };
}

const DESIGNER = posting("7536752003", "Senior Product Designer");
const ENGINEER = posting("7536752004", "Senior Android Engineer");

describe("gemCollector: a board's matching jobs are collected", () => {
  test("the board's whole job list is asked for at Gem's job board address", async () => {
    const calls = stubFetch({ [boardUrl("fetch")]: () => jsonResponse([DESIGNER]) });

    await gemCollector.collect(makeContext(["fetch"]));

    expect(calls).toEqual([boardUrl("fetch")]);
  });

  test("only jobs whose title matches a search term are collected", async () => {
    stubFetch({ [boardUrl("fetch")]: () => jsonResponse([DESIGNER, ENGINEER]) });

    const { jobs } = await gemCollector.collect(makeContext(["fetch"]));

    expect(jobs.map((job) => job.raw_title)).toEqual(["Senior Product Designer"]);
  });

  test("a collected job links to its posting on Gem's board site", async () => {
    stubFetch({ [boardUrl("fetch")]: () => jsonResponse([DESIGNER]) });

    const [job] = (await gemCollector.collect(makeContext(["fetch"]))).jobs;

    expect(job?.original_url).toBe("https://jobs.gem.com/fetch/7536752003");
    expect(job?.resolved_url).toBe(job?.original_url);
  });

  test("a collected job is already resolved, but still to be parsed and classified", async () => {
    stubFetch({ [boardUrl("fetch")]: () => jsonResponse([DESIGNER]) });

    const [job] = (await gemCollector.collect(makeContext(["fetch"]))).jobs;

    expect(job?.is_resolved).toBe(true);
    expect(job?.is_parsed).toBe(false);
    expect(job?.is_classified).toBe(false);
  });

  test("a collected job records the board it came from", async () => {
    stubFetch({ [boardUrl("fetch")]: () => jsonResponse([DESIGNER]) });

    const [job] = (await gemCollector.collect(makeContext(["fetch"]))).jobs;

    expect(job?.raw_company_slug).toBe("fetch");
  });

  test("collection stops at the limit", async () => {
    stubFetch({
      [boardUrl("fetch")]: () =>
        jsonResponse([DESIGNER, posting("7536752005", "Product Designer, Growth")]),
    });

    const { jobs } = await gemCollector.collect(makeContext(["fetch"], 1));

    expect(jobs).toHaveLength(1);
  });
});

describe("gemCollector: one broken board skips only that board", () => {
  test("a failed request is warned about and the next board is still polled", async () => {
    globalThis.fetch = (async (input: unknown) => {
      if (String(input) === boardUrl("dead")) throw new TypeError("fetch failed");
      return jsonResponse([DESIGNER]);
    }) as unknown as typeof globalThis.fetch;

    const result = await gemCollector.collect(makeContext(["dead", "fetch"]));

    expect(result.jobs).toHaveLength(1);
    expect(result.warnings.join("\n")).toContain("dead");
  });

  test("an error status is warned about and the next board is still polled", async () => {
    stubFetch({
      [boardUrl("gone")]: () => jsonResponse({ message: "not found" }, 404),
      [boardUrl("fetch")]: () => jsonResponse([DESIGNER]),
    });

    const result = await gemCollector.collect(makeContext(["gone", "fetch"]));

    expect(result.jobs).toHaveLength(1);
    expect(result.warnings.join("\n")).toContain("gone");
  });

  test("a reply that is not job data is warned about and the next board is still polled", async () => {
    stubFetch({
      [boardUrl("broken")]: () => new Response("<html>Service unavailable</html>", { status: 200 }),
      [boardUrl("fetch")]: () => jsonResponse([DESIGNER]),
    });

    const result = await gemCollector.collect(makeContext(["broken", "fetch"]));

    expect(result.jobs).toHaveLength(1);
    expect(result.warnings.join("\n")).toContain("broken");
  });
});

describe("gemCollector: an empty polling list", () => {
  test("polls nothing and says so", async () => {
    const calls = stubFetch({});

    const result = await gemCollector.collect(makeContext([]));

    expect(calls).toEqual([]);
    expect(result.jobs).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
});
