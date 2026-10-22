import { afterEach, describe, expect, test } from "vitest";
import { ultiproCollector } from "./ultipro";
import { fakeSettingsService } from "../services/settings-service.fake";
import { fakeAtsSlugService } from "../services/ats-slug-service.fake";
import { fakeLastSuccessService } from "../services/last-success-service.fake";

// No collector here remembers its searches, so the last-success service each
// one is handed holds no time, and none reads the collection time.
const noTimes = fakeLastSuccessService();
const COLLECTED_AT = new Date("2026-01-01T00:00:00.000Z");

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const BOARD_ID = "914e6c7a-35d4-4079-865a-b3a7e7758070";
const BOARD = `acme1000acme:${BOARD_ID}`;
const LIST_URL = `https://recruiting.ultipro.com/acme1000acme/jobboard/${BOARD_ID}/jobboardview/loadsearchresults`;

function opportunity(index: number, title: string) {
  return {
    Id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    Title: title,
    PostedDate: "2026-08-28T15:00:00.000Z",
    BriefDescription: "A role at Acme.",
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
}

interface Search {
  url: string;
  method: string;
  body: { opportunitySearch?: { Top?: number; Skip?: number } };
}

// Stands in for UltiPro's board search, answering from `board` with at most
// 200 jobs a reply. Every search is recorded.
function stubUltipro(board: ReturnType<typeof opportunity>[], searches: Search[]) {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Search["body"];
    searches.push({ url: String(input), method: (init?.method ?? "GET").toUpperCase(), body });
    const skip = body.opportunitySearch?.Skip ?? 0;
    const top = Math.min(body.opportunitySearch?.Top ?? 0, 200);
    return new Response(
      JSON.stringify({ opportunities: board.slice(skip, skip + top), totalCount: board.length }),
      { status: 200 }
    );
  }) as unknown as typeof globalThis.fetch;
}

function context(boards: string[], searchTerms: string[], limit = Infinity) {
  return {
    settings: fakeSettingsService({ getSearchTerms: async () => searchTerms }),
    collectedAt: COLLECTED_AT,
    lastSuccesses: noTimes,
    atsSlugs: fakeAtsSlugService(
      boards.map((slug, index) => ({
        id: `row-${index}`,
        slug,
        company_id: `company-${index}`,
        parser: "ultipro",
        collector: "ultipro",
      }))
    ),
    limit,
  };
}

// 450 jobs, three of them matching, one in each 200-job reply.
const LARGE_BOARD = Array.from({ length: 450 }, (_, index) =>
  opportunity(
    index,
    { 3: "Product Designer", 210: "Senior Product Designer", 440: "UX Designer" }[index] ??
      `Accountant ${index}`
  )
);

describe("ultiproCollector: a board is read to its last job", () => {
  test("each request is a POST to the board's job list, 200 jobs at a time", async () => {
    const searches: Search[] = [];
    stubUltipro(LARGE_BOARD, searches);

    await ultiproCollector.collect(context([BOARD], ["Product Design", "UX"]));

    for (const search of searches) {
      expect(search.url).toBe(LIST_URL);
      expect(search.method).toBe("POST");
      expect(search.body.opportunitySearch?.Top).toBe(200);
    }
    expect(searches.map((search) => search.body.opportunitySearch?.Skip)).toEqual([0, 200, 400]);
  });

  test("matching jobs from every reply are collected, and no others", async () => {
    stubUltipro(LARGE_BOARD, []);

    const result = await ultiproCollector.collect(context([BOARD], ["Product Design", "UX"]));

    expect(result.jobs.map((job) => job.raw_title)).toEqual([
      "Product Designer",
      "Senior Product Designer",
      "UX Designer",
    ]);
  });

  test("a board that fits in one reply is asked once", async () => {
    const searches: Search[] = [];
    stubUltipro([opportunity(1, "Product Designer")], searches);

    await ultiproCollector.collect(context([BOARD], ["Product Design"]));

    expect(searches).toHaveLength(1);
  });
});

describe("ultiproCollector: a collected job", () => {
  test("its link is the posting page, and it waits to be parsed", async () => {
    stubUltipro([opportunity(1, "Product Designer")], []);

    const [job] = (await ultiproCollector.collect(context([BOARD], ["Product Design"]))).jobs;

    const link = `https://recruiting.ultipro.com/acme1000acme/jobboard/${BOARD_ID}/opportunitydetail?opportunityid=00000000-0000-4000-8000-000000000001`;
    expect(job.original_url).toBe(link);
    expect(job.resolved_url).toBe(link);
    expect(job.raw_company_slug).toBe(BOARD);
    expect(job.raw_location_list).toEqual(["Austin, TX, United States"]);
    expect(job.posting_date).toEqual(new Date("2026-08-28T15:00:00.000Z"));
    expect(job.description).toBeUndefined();
    expect(job.is_resolved).toBe(true);
    expect(job.is_parsed).toBe(false);
    expect(job.is_classified).toBe(false);
  });

  test("collection stops at the limit", async () => {
    stubUltipro(LARGE_BOARD, []);

    const result = await ultiproCollector.collect(context([BOARD], ["Product Design", "UX"], 1));

    expect(result.jobs).toHaveLength(1);
  });
});

describe("ultiproCollector: a broken board is skipped and reported", () => {
  const HEALTHY = `healthy1000:${BOARD_ID}`;

  test.each([
    ["a reply that is not job data", () => new Response("<html>Unavailable</html>", { status: 200 })],
    ["an error status", () => new Response("Forbidden", { status: 403 })],
    [
      "a request that fails",
      (): Response => {
        throw new TypeError("fetch failed");
      },
    ],
  ])("a board sending %s", async (_case, broken) => {
    globalThis.fetch = (async (input: unknown) => {
      if (String(input).includes("/acme1000acme/")) return broken();
      return new Response(
        JSON.stringify({ opportunities: [opportunity(1, "Product Designer")], totalCount: 1 }),
        { status: 200 }
      );
    }) as unknown as typeof globalThis.fetch;

    const result = await ultiproCollector.collect(context([BOARD, HEALTHY], ["Product Design"]));

    expect(result.warnings.some((warning) => warning.includes("acme1000acme"))).toBe(true);
    expect(result.jobs.map((job) => job.raw_company_slug)).toEqual([HEALTHY]);
  });

  test("a stored value that is not an UltiPro board is skipped and reported", async () => {
    stubUltipro([], []);

    const result = await ultiproCollector.collect(context(["stripe"], ["Product Design"]));

    expect(result.warnings.some((warning) => warning.includes("stripe"))).toBe(true);
  });
});

describe("ultiproCollector: no boards configured", () => {
  test("a warning names the platform and nothing is requested", async () => {
    const searches: Search[] = [];
    stubUltipro([], searches);

    const result = await ultiproCollector.collect(context([], ["Product Design"]));

    expect(result.warnings.some((warning) => warning.includes("ultipro"))).toBe(true);
    expect(searches).toEqual([]);
  });
});

describe("ultiproCollector: the collector names itself", () => {
  test("its name is the one the polling list and the priority list use", () => {
    expect(ultiproCollector.name).toBe("ultipro");
  });
});
