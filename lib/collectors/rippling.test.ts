import { afterEach, describe, expect, test } from "vitest";
import { ripplingCollector } from "./rippling";
import { fakeSettingsService } from "../services/settings-service.fake";
import { fakeAtsSlugService } from "../services/ats-slug-service.fake";
import type { CollectorContext } from "./collector";
import { fakeLastSuccessService } from "../services/last-success-service.fake";

// No collector here remembers its searches, so the last-success service each
// one is handed holds no time, and none reads the collection time.
const NO_TIMES = fakeLastSuccessService();
const COLLECTED_AT = new Date("2026-01-01T00:00:00.000Z");

const COLLECTOR_NAME = "rippling";

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

// Where Rippling lists a whole board's jobs in one reply.
const boardUrl = (board: string) => `https://api.rippling.com/platform/api/ats/v1/board/${board}/jobs`;

// One job in a board's list, shaped like the radicl-defense board's on
// 2026-09-24.
function listing(uuid: string, name: string) {
  return {
    uuid,
    name,
    department: { id: "Product", label: "Product" },
    url: `https://ats.rippling.com/radicl-defense/jobs/${uuid}`,
    workLocation: { label: "Boulder, CO", id: "Boulder, CO" },
  };
}

const DESIGNER = listing("371ee603-a211-467c-b868-b5f5b68ccbff", "Senior Product Designer");
const SALES = listing("26c570f3-8f64-43f1-a641-52cfeb9471b3", "Business Development Representative");

describe("ripplingCollector: a board's matching jobs are collected", () => {
  test("the board's whole job list is asked for once", async () => {
    const calls = stubFetch({ [boardUrl("radicl-defense")]: () => jsonResponse([DESIGNER]) });

    await ripplingCollector.collect(makeContext(["radicl-defense"]));

    expect(calls).toEqual([boardUrl("radicl-defense")]);
  });

  test("only jobs whose title matches a search term are collected", async () => {
    stubFetch({ [boardUrl("radicl-defense")]: () => jsonResponse([DESIGNER, SALES]) });

    const { jobs } = await ripplingCollector.collect(makeContext(["radicl-defense"]));

    expect(jobs.map((job) => job.raw_title)).toEqual(["Senior Product Designer"]);
  });

  test("a collected job links to its posting on Rippling's board site", async () => {
    stubFetch({ [boardUrl("radicl-defense")]: () => jsonResponse([DESIGNER]) });

    const [job] = (await ripplingCollector.collect(makeContext(["radicl-defense"]))).jobs;

    expect(job?.original_url).toBe(
      "https://ats.rippling.com/radicl-defense/jobs/371ee603-a211-467c-b868-b5f5b68ccbff"
    );
    expect(job?.resolved_url).toBe(job?.original_url);
  });

  test("a collected job is already resolved, but still to be parsed and classified", async () => {
    stubFetch({ [boardUrl("radicl-defense")]: () => jsonResponse([DESIGNER]) });

    const [job] = (await ripplingCollector.collect(makeContext(["radicl-defense"]))).jobs;

    expect(job?.is_resolved).toBe(true);
    expect(job?.is_parsed).toBe(false);
    expect(job?.is_classified).toBe(false);
    expect(job?.raw_company_slug).toBe("radicl-defense");
  });

  test("collection stops at the limit", async () => {
    stubFetch({
      [boardUrl("radicl-defense")]: () =>
        jsonResponse([DESIGNER, listing("5b1d7c2a-0000-4000-8000-000000000003", "Product Designer")]),
    });

    const { jobs } = await ripplingCollector.collect(makeContext(["radicl-defense"], 1));

    expect(jobs).toHaveLength(1);
  });
});

describe("ripplingCollector: one broken board skips only that board", () => {
  test("a failed request is warned about and the next board is still polled", async () => {
    globalThis.fetch = (async (input: unknown) => {
      if (String(input) === boardUrl("dead")) throw new TypeError("fetch failed");
      return jsonResponse([DESIGNER]);
    }) as unknown as typeof globalThis.fetch;

    const result = await ripplingCollector.collect(makeContext(["dead", "radicl-defense"]));

    expect(result.jobs).toHaveLength(1);
    expect(result.warnings.join("\n")).toContain("dead");
  });

  test("an error status is warned about and the next board is still polled", async () => {
    stubFetch({
      [boardUrl("gone")]: () => jsonResponse({ message: "not found" }, 404),
      [boardUrl("radicl-defense")]: () => jsonResponse([DESIGNER]),
    });

    const result = await ripplingCollector.collect(makeContext(["gone", "radicl-defense"]));

    expect(result.jobs).toHaveLength(1);
    expect(result.warnings.join("\n")).toContain("gone");
  });

  test("a reply that is not job data is warned about and the next board is still polled", async () => {
    stubFetch({
      [boardUrl("broken")]: () => new Response("<html>Service unavailable</html>", { status: 200 }),
      [boardUrl("radicl-defense")]: () => jsonResponse([DESIGNER]),
    });

    const result = await ripplingCollector.collect(makeContext(["broken", "radicl-defense"]));

    expect(result.jobs).toHaveLength(1);
    expect(result.warnings.join("\n")).toContain("broken");
  });
});

describe("ripplingCollector: an empty polling list", () => {
  test("polls nothing and says so", async () => {
    const calls = stubFetch({});

    const result = await ripplingCollector.collect(makeContext([]));

    expect(calls).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
});
