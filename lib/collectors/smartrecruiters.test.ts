import { afterEach, describe, expect, test } from "vitest";
import { smartrecruitersCollector } from "./smartrecruiters";
import { fakeSettingsService } from "../services/settings-service.fake";
import { fakeAtsSlugService } from "../services/ats-slug-service.fake";
import type { CollectorContext } from "./collector";
import { fakeLastSuccessService } from "../services/last-success-service.fake";

// No collector here remembers its searches, so the last-success service each
// one is handed holds no time, and none reads the collection time.
const NO_TIMES = fakeLastSuccessService();
const COLLECTED_AT = new Date("2026-01-01T00:00:00.000Z");

const COLLECTOR_NAME = "smartrecruiters";

// SmartRecruiters hands back at most 100 jobs a reply (measured 2026-09-24).
const PAGE_SIZE = 100;

// Each test swaps the global fetch for a plain stand-in and the real one is
// put back afterwards, so nothing leaks into the next test.
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

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

// One job in a board's list, shaped like the RodeoFX board's on 2026-09-24.
function listing(id: string, name: string) {
  return {
    id,
    name,
    company: { identifier: "RodeoFX", name: "Rodeo FX" },
    releasedDate: "2026-09-23T15:40:10.388Z",
    location: { city: "Montreal", region: "QC", country: "ca", fullLocation: "Montreal, QC, Canada" },
  };
}

function fillers(count: number, from: number) {
  return Array.from({ length: count }, (_, index) =>
    listing(`7440000${from + index}`, `Lighting Artist ${from + index}`)
  );
}

// Stands in for a board's job list, serving each page of the given jobs by
// the offset and limit asked for. Every address asked for is recorded.
function boardStandIn(jobsByBoard: Record<string, ReturnType<typeof listing>[]>): URL[] {
  const asked: URL[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = new URL(String(input));
    asked.push(url);
    const board = url.pathname.match(/^\/v1\/companies\/([^/]+)\/postings$/)?.[1];
    const all = board === undefined ? undefined : jobsByBoard[board];
    if (url.host !== "api.smartrecruiters.com" || all === undefined) {
      return jsonResponse({ message: "not found" }, 404);
    }
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? PAGE_SIZE), PAGE_SIZE);
    return jsonResponse({
      offset,
      limit,
      totalFound: all.length,
      content: all.slice(offset, offset + limit),
    });
  }) as unknown as typeof globalThis.fetch;
  return asked;
}

describe("smartrecruitersCollector: a board's matching jobs are collected", () => {
  test("only jobs whose title matches a search term are collected", async () => {
    boardStandIn({ RodeoFX: [listing("1", "Senior Product Designer"), listing("2", "Compositor")] });

    const { jobs } = await smartrecruitersCollector.collect(makeContext(["RodeoFX"]));

    expect(jobs.map((job) => job.raw_title)).toEqual(["Senior Product Designer"]);
  });

  test("a collected job links to its posting on SmartRecruiters' job site", async () => {
    boardStandIn({ RodeoFX: [listing("744000148584589", "Senior Product Designer")] });

    const [job] = (await smartrecruitersCollector.collect(makeContext(["RodeoFX"]))).jobs;

    expect(job?.original_url).toBe("https://jobs.smartrecruiters.com/RodeoFX/744000148584589");
    expect(job?.resolved_url).toBe(job?.original_url);
  });

  test("a collected job is already resolved, but still to be parsed and classified", async () => {
    boardStandIn({ RodeoFX: [listing("1", "Senior Product Designer")] });

    const [job] = (await smartrecruitersCollector.collect(makeContext(["RodeoFX"]))).jobs;

    expect(job?.is_resolved).toBe(true);
    expect(job?.is_parsed).toBe(false);
    expect(job?.is_classified).toBe(false);
  });

  test("a collected job records the board and the employer's name", async () => {
    boardStandIn({ RodeoFX: [listing("1", "Senior Product Designer")] });

    const [job] = (await smartrecruitersCollector.collect(makeContext(["RodeoFX"]))).jobs;

    expect(job?.raw_company_slug).toBe("RodeoFX");
    expect(job?.raw_company_name).toBe("Rodeo FX");
  });
});

describe("smartrecruitersCollector: a board is read to its last page", () => {
  test("a match past the first reply is collected", async () => {
    boardStandIn({
      RodeoFX: [...fillers(PAGE_SIZE + 20, 0), listing("9", "Lead Product Designer")],
    });

    const { jobs } = await smartrecruitersCollector.collect(makeContext(["RodeoFX"]));

    expect(jobs.map((job) => job.raw_title)).toEqual(["Lead Product Designer"]);
  });

  test("every page is asked for once, and no page past the last", async () => {
    const asked = boardStandIn({ RodeoFX: fillers(PAGE_SIZE * 2 + 5, 0) });

    await smartrecruitersCollector.collect(makeContext(["RodeoFX"]));

    expect(asked.map((url) => Number(url.searchParams.get("offset") ?? "0"))).toEqual([
      0,
      PAGE_SIZE,
      PAGE_SIZE * 2,
    ]);
  });

  test("a board of exactly one page is asked for once", async () => {
    const asked = boardStandIn({ RodeoFX: [listing("1", "Senior Product Designer")] });

    await smartrecruitersCollector.collect(makeContext(["RodeoFX"]));

    expect(asked).toHaveLength(1);
  });

  test("an empty board is asked for once and yields nothing", async () => {
    const asked = boardStandIn({ RodeoFX: [] });

    const { jobs } = await smartrecruitersCollector.collect(makeContext(["RodeoFX"]));

    expect(asked).toHaveLength(1);
    expect(jobs).toEqual([]);
  });

  test("collection stops at the limit", async () => {
    boardStandIn({
      RodeoFX: [listing("1", "Senior Product Designer"), listing("2", "Product Designer, Growth")],
    });

    const { jobs } = await smartrecruitersCollector.collect(makeContext(["RodeoFX"], 1));

    expect(jobs).toHaveLength(1);
  });

  test("no page is asked for once the limit is met", async () => {
    const asked = boardStandIn({
      RodeoFX: [listing("1", "Senior Product Designer"), ...fillers(PAGE_SIZE * 3, 0)],
    });

    const { jobs } = await smartrecruitersCollector.collect(makeContext(["RodeoFX"], 1));

    expect(jobs).toHaveLength(1);
    expect(asked).toHaveLength(1);
  });
});

describe("smartrecruitersCollector: one broken board skips only that board", () => {
  test("a failed request is warned about and the next board is still polled", async () => {
    boardStandIn({ RodeoFX: [listing("1", "Senior Product Designer")] });
    const standIn = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      if (String(input).includes("/companies/dead/")) throw new TypeError("fetch failed");
      return standIn(input as string, init);
    }) as unknown as typeof globalThis.fetch;

    const result = await smartrecruitersCollector.collect(makeContext(["dead", "RodeoFX"]));

    expect(result.jobs).toHaveLength(1);
    expect(result.warnings.join("\n")).toContain("dead");
  });

  test("an error status is warned about and the next board is still polled", async () => {
    boardStandIn({ RodeoFX: [listing("1", "Senior Product Designer")] });

    const result = await smartrecruitersCollector.collect(makeContext(["gone", "RodeoFX"]));

    expect(result.jobs).toHaveLength(1);
    expect(result.warnings.join("\n")).toContain("gone");
  });

  test("a reply that is not job data is warned about and the next board is still polled", async () => {
    boardStandIn({ RodeoFX: [listing("1", "Senior Product Designer")] });
    const standIn = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      if (String(input).includes("/companies/broken/")) {
        return new Response("<html>Service unavailable</html>", { status: 200 });
      }
      return standIn(input as string, init);
    }) as unknown as typeof globalThis.fetch;

    const result = await smartrecruitersCollector.collect(makeContext(["broken", "RodeoFX"]));

    expect(result.jobs).toHaveLength(1);
    expect(result.warnings.join("\n")).toContain("broken");
  });

  test("a page failing after the first keeps what was read, warns, and the next board is still polled", async () => {
    boardStandIn({
      halfway: [listing("1", "Senior Product Designer"), ...fillers(PAGE_SIZE + 20, 0)],
      RodeoFX: [listing("2", "Lead Product Designer")],
    });
    const standIn = globalThis.fetch;
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.includes("/companies/halfway/") && url.searchParams.get("offset") !== "0") {
        throw new TypeError("fetch failed");
      }
      return standIn(input as string, init);
    }) as unknown as typeof globalThis.fetch;

    const result = await smartrecruitersCollector.collect(makeContext(["halfway", "RodeoFX"]));

    expect(result.jobs.map((job) => job.raw_title)).toEqual([
      "Senior Product Designer",
      "Lead Product Designer",
    ]);
    expect(result.warnings.join("\n")).toContain("halfway");
  });
});

describe("smartrecruitersCollector: an empty polling list", () => {
  test("polls nothing and says so", async () => {
    const asked = boardStandIn({});

    const result = await smartrecruitersCollector.collect(makeContext([]));

    expect(asked).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
});
