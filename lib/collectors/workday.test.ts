import { afterEach, describe, expect, test } from "vitest";
import { workdayCollector } from "./workday";
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

const BOARD = "acme:wd1:Careers";
const LIST_URL = "https://acme.wd1.myworkdayjobs.com/wday/cxs/acme/Careers/jobs";

interface Listing {
  title: string;
  externalPath: string;
  locationsText?: string;
  postedOn?: string;
}

function listing(title: string, id: string): Listing {
  return {
    title,
    externalPath: `/job/Remote-USA/${title.replace(/\W+/g, "-")}_${id}`,
    locationsText: "Remote - USA",
    postedOn: "Posted 30+ Days Ago",
  };
}

// Jobs matching no search term, each its own posting.
const fillers = (label: string, count: number) =>
  Array.from({ length: count }, (_, index) => listing(`Accountant ${index}`, `${label}-${index}`));

interface Search {
  url: string;
  method: string;
  body: { appliedFacets?: unknown; limit?: number; offset?: number; searchText?: string };
}

// Stands in for Workday's board search. `pages` answers one term's pages in
// order; a page past the end is empty. Every search is recorded.
function stubWorkday(pages: Record<string, Listing[][]>, searches: Search[]) {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Search["body"];
    searches.push({ url, method: (init?.method ?? "GET").toUpperCase(), body });
    const index = Math.floor((body.offset ?? 0) / 20);
    const jobPostings = pages[body.searchText ?? ""]?.[index] ?? [];
    return new Response(JSON.stringify({ total: 0, jobPostings }), { status: 200 });
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
        parser: "workday",
        collector: "workday",
      }))
    ),
    limit,
  };
}

const offsets = (searches: Search[], term: string) =>
  searches.filter((search) => search.body.searchText === term).map((search) => search.body.offset);

describe("workdayCollector: a board is searched once per term", () => {
  test("each search is a POST to the board's job list, 20 jobs a page", async () => {
    const searches: Search[] = [];
    stubWorkday({}, searches);

    await workdayCollector.collect(context([BOARD], ["Product Designer", "UX Researcher"]));

    expect(searches.map((search) => search.body.searchText)).toEqual([
      "Product Designer",
      "UX Researcher",
    ]);
    for (const search of searches) {
      expect(search.url).toBe(LIST_URL);
      expect(search.method).toBe("POST");
      expect(search.body).toEqual({
        appliedFacets: {},
        limit: 20,
        offset: 0,
        searchText: search.body.searchText,
      });
    }
  });

  test("a job both terms find is collected once", async () => {
    const shared = listing("Product Designer and UX Researcher", "SHARED");
    stubWorkday(
      {
        "Product Designer": [[shared, ...fillers("a", 19)]],
        "UX Researcher": [[shared, ...fillers("b", 19)]],
      },
      []
    );

    const result = await workdayCollector.collect(
      context([BOARD], ["Product Designer", "UX Researcher"])
    );

    expect(result.jobs).toHaveLength(1);
  });
});

describe("workdayCollector: paging", () => {
  test("paging continues while a page holds a match, and stops at a page with none", async () => {
    const searches: Search[] = [];
    stubWorkday(
      {
        "Product Designer": [
          [listing("Product Designer", "1"), ...fillers("p0", 19)],
          [listing("Senior Product Designer", "2"), ...fillers("p1", 19)],
          fillers("p2", 20),
          [listing("Staff Product Designer", "3"), ...fillers("p3", 19)],
        ],
      },
      searches
    );

    const result = await workdayCollector.collect(context([BOARD], ["Product Designer"]));

    expect(offsets(searches, "Product Designer")).toEqual([0, 20, 40]);
    expect(result.jobs.map((job) => job.raw_title)).toEqual([
      "Product Designer",
      "Senior Product Designer",
    ]);
  });

  test("paging stops at an empty page", async () => {
    const searches: Search[] = [];
    stubWorkday(
      {
        "Product Designer": [
          [listing("Product Designer", "1"), ...fillers("p0", 19)],
          [],
          [listing("Staff Product Designer", "3")],
        ],
      },
      searches
    );

    await workdayCollector.collect(context([BOARD], ["Product Designer"]));

    expect(offsets(searches, "Product Designer")).toEqual([0, 20]);
  });

  test("paging stops at fifty pages", async () => {
    const searches: Search[] = [];
    const everyPage = Array.from({ length: 60 }, (_, index) => [
      listing(`Product Designer ${index}`, `${index}`),
      ...fillers(`f${index}`, 19),
    ]);
    stubWorkday({ "Product Designer": everyPage }, searches);

    const result = await workdayCollector.collect(context([BOARD], ["Product Designer"]));

    expect(offsets(searches, "Product Designer")).toHaveLength(50);
    expect(result.jobs).toHaveLength(50);
  });
});

describe("workdayCollector: a collected job", () => {
  test("its link is the posting's public address, and it waits to be parsed", async () => {
    stubWorkday({ "Product Designer": [[listing("Product Designer", "1")]] }, []);

    const [job] = (await workdayCollector.collect(context([BOARD], ["Product Designer"]))).jobs;

    const link = "https://acme.wd1.myworkdayjobs.com/Careers/job/Remote-USA/Product-Designer_1";
    expect(job.original_url).toBe(link);
    expect(job.resolved_url).toBe(link);
    expect(job.raw_company_slug).toBe(BOARD);
    expect(job.raw_location_list).toEqual(["Remote - USA"]);
    expect(job.is_resolved).toBe(true);
    expect(job.is_parsed).toBe(false);
    expect(job.is_classified).toBe(false);
  });

  test("collection stops at the limit", async () => {
    stubWorkday(
      {
        "Product Designer": [
          [listing("Product Designer", "1"), listing("Senior Product Designer", "2")],
        ],
      },
      []
    );

    const result = await workdayCollector.collect(context([BOARD], ["Product Designer"], 1));

    expect(result.jobs).toHaveLength(1);
  });
});

describe("workdayCollector: a broken board is skipped and reported", () => {
  const HEALTHY = "healthy:wd1:Careers";

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
      if (String(input).includes("//acme.")) return broken();
      return new Response(
        JSON.stringify({ total: 1, jobPostings: [listing("Product Designer", "1")] }),
        { status: 200 }
      );
    }) as unknown as typeof globalThis.fetch;

    const result = await workdayCollector.collect(
      context([BOARD, HEALTHY], ["Product Designer"])
    );

    expect(result.warnings.some((warning) => warning.includes("acme"))).toBe(true);
    expect(result.jobs.map((job) => job.raw_company_slug)).toEqual([HEALTHY]);
  });

  test("a stored value that is not a Workday board is skipped and reported", async () => {
    stubWorkday({}, []);

    const result = await workdayCollector.collect(context(["stripe"], ["Product Designer"]));

    expect(result.warnings.some((warning) => warning.includes("stripe"))).toBe(true);
  });
});

describe("workdayCollector: no boards configured", () => {
  test("a warning names the platform and nothing is requested", async () => {
    const searches: Search[] = [];
    stubWorkday({}, searches);

    const result = await workdayCollector.collect(context([], ["Product Designer"]));

    expect(result.warnings.some((warning) => warning.includes("workday"))).toBe(true);
    expect(searches).toEqual([]);
  });
});

describe("workdayCollector: the collector names itself", () => {
  test("its name is the one the polling list and the priority list use", () => {
    expect(workdayCollector.name).toBe("workday");
  });
});
