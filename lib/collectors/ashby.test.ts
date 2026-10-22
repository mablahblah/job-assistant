import { afterEach, describe, expect, test, vi } from "vitest";
import { ashbyCollector } from "./ashby";
import { jobFieldsFromAshbyPosting } from "../utils/ashby-fields";

// The shared mapper is wrapped in a spy that still runs the real thing, so
// every test below reads the same fields it always did while one test can
// also check the collector went through the mapper rather than a copy of it.
vi.mock("../utils/ashby-fields", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/ashby-fields")>();
  return { ...actual, jobFieldsFromAshbyPosting: vi.fn(actual.jobFieldsFromAshbyPosting) };
});
import { fakeSettingsService } from "../services/settings-service.fake";
import type { AtsBoard } from "./ats-boards";
import type { CollectorContext } from "./collector";
import { fakeAtsSlugService } from "../services/ats-slug-service.fake";
import { fakeLastSuccessService } from "../services/last-success-service.fake";

// No collector here remembers its searches, so the last-success service each
// one is handed holds no time, and none reads the collection time.
const NO_TIMES = fakeLastSuccessService();
const COLLECTED_AT = new Date("2026-01-01T00:00:00.000Z");

// Everything a collector is handed except the limit, which each test sets.
type CollectorContextParts = Omit<CollectorContext, "limit">;

const COLLECTOR_NAME = "ashby";

// Each test below swaps the global fetch for a plain stand-in and the real one
// is put back afterwards, so nothing leaks into the next test.
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Stands in for global fetch, answering per-url from a small map the test
// builds. Every call is recorded in order, so a test can also check how many
// times — or whether at all — a url was requested.
function stubFetch(routes: Record<string, () => Response>): string[] {
  const calls: string[] = [];
  globalThis.fetch = async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    const respond = routes[url];
    if (respond === undefined) {
      throw new Error(`no fetch stub set up for ${url}`);
    }
    return respond();
  };
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

// A settings-service stand-in typed to the real interface, so a test supplies
// only the boards and search terms it needs.
// What a collector is handed for one run, minus the limit. The boards live in
// the ATS slug table now, so the fake slug service is seeded with a row per
// board, each already carrying this collector.
function makeContext(boards: AtsBoard[], searchTerms: string[]): CollectorContextParts {
  return {
    settings: fakeSettingsService({ getSearchTerms: async () => searchTerms }),
    collectedAt: COLLECTED_AT,
    lastSuccesses: NO_TIMES,
    atsSlugs: fakeAtsSlugService(
      boards.map((board, index) => ({
        id: `row-${index}`,
        slug: board.ats_slug,
        company_id: `company-${index}`,
        parser: COLLECTOR_NAME,
        collector: COLLECTOR_NAME,
      }))
    ),
  };
}

const boardUrl = (slug: string) =>
  `https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`;

const SEARCH_TERMS = ["Product Design"];

// A title genuinely matching "Product Design" once it is stemmed.
const seniorProductDesigner = {
  title: "Senior Product Designer",
  isListed: true,
  jobUrl: "https://jobs.ashbyhq.com/hinge-health/cd67cd2f-3a94-4eaf-9ad8-d067fdd18bf0",
  publishedAt: "2026-01-15T00:00:00.000Z",
  location: "Remote - US",
  secondaryLocations: [],
  workplaceType: "Remote",
  descriptionPlain: "Design beautiful products at Hinge Health.",
  descriptionHtml: "<p>Design beautiful products at Hinge Health.</p>",
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

const backendEngineer = {
  title: "Backend Engineer",
  isListed: true,
  jobUrl: "https://jobs.ashbyhq.com/hinge-health/8a1e2c3d-4f5a-6b7c-8d9e-0f1a2b3c4d5e",
  publishedAt: "2026-01-16T00:00:00.000Z",
};

// The one job a single matching posting on the hinge-health board produces.
async function collectOneJob() {
  stubFetch({
    [boardUrl("hinge-health")]: () =>
      jsonResponse({ apiVersion: "1", jobs: [seniorProductDesigner] }),
  });
  const context = makeContext([{ ats_slug: "hinge-health" }], SEARCH_TERMS);
  const result = await ashbyCollector.collect({ ...context, limit: Infinity });
  const [posting] = result.jobs;
  return posting;
}

describe("AC 30: an unlisted posting is absent even when its title matches", () => {
  test("isListed false drops the posting", async () => {
    stubFetch({
      [boardUrl("hinge-health")]: () =>
        jsonResponse({ apiVersion: "1", jobs: [{ ...seniorProductDesigner, isListed: false }] }),
    });
    const context = makeContext([{ ats_slug: "hinge-health" }], SEARCH_TERMS);

    const result = await ashbyCollector.collect({ ...context, limit: Infinity });

    expect(result.jobs).toEqual([]);
  });
});

describe("AC 36: raw_company_name is unset and raw_company_slug holds the board slug", () => {
  test("raw_company_name is undefined, because Ashby's API carries no employer name", async () => {
    expect((await collectOneJob()).raw_company_name).toBeUndefined();
  });

  test("raw_company_slug is the board slug that was polled", async () => {
    expect((await collectOneJob()).raw_company_slug).toBe("hinge-health");
  });
});

describe("AC 101: no request is made to a board page to find an employer name", () => {
  test("the posting-api endpoint is the only request a board costs", async () => {
    const calls = stubFetch({
      [boardUrl("hinge-health")]: () =>
        jsonResponse({ apiVersion: "1", jobs: [seniorProductDesigner] }),
    });
    const context = makeContext([{ ats_slug: "hinge-health" }], SEARCH_TERMS);

    await ashbyCollector.collect({ ...context, limit: Infinity });

    expect(calls).toEqual([boardUrl("hinge-health")]);
  });
});

describe("AC 32: a returned job is resolved, but not yet parsed or classified", () => {
  test("is_resolved is true", async () => {
    expect((await collectOneJob()).is_resolved).toBe(true);
  });

  test("is_parsed is false, because the description is still to be read", async () => {
    expect((await collectOneJob()).is_parsed).toBe(false);
  });

  test("is_classified is false", async () => {
    expect((await collectOneJob()).is_classified).toBe(false);
  });
});

describe("AC 35: a board with zero postings returns no jobs without throwing", () => {
  function run() {
    stubFetch({
      [boardUrl("hinge-health")]: () => jsonResponse({ apiVersion: "1", jobs: [] }),
    });
    const context = makeContext([{ ats_slug: "hinge-health" }], SEARCH_TERMS);
    return ashbyCollector.collect({ ...context, limit: Infinity });
  }

  test("the job list is empty", async () => {
    expect((await run()).jobs).toEqual([]);
  });

  test("collect resolves rather than rejecting", async () => {
    await expect(run()).resolves.toBeDefined();
  });
});

describe("AC 38: a posting whose title does not match the search terms is absent", () => {
  test("only the matching posting is returned", async () => {
    stubFetch({
      [boardUrl("hinge-health")]: () =>
        jsonResponse({ apiVersion: "1", jobs: [seniorProductDesigner, backendEngineer] }),
    });
    const context = makeContext([{ ats_slug: "hinge-health" }], SEARCH_TERMS);

    const result = await ashbyCollector.collect({ ...context, limit: Infinity });

    expect(result.jobs.map((posting) => posting.raw_title)).toEqual(["Senior Product Designer"]);
  });
});

describe("AC 24: limit stops collection after that many jobs", () => {
  test("exactly one job comes back when the limit is 1", async () => {
    stubFetch({
      [boardUrl("hinge-health")]: () =>
        jsonResponse({
          apiVersion: "1",
          jobs: [
            seniorProductDesigner,
            {
              ...seniorProductDesigner,
              jobUrl: "https://jobs.ashbyhq.com/hinge-health/second-posting-id",
              title: "Staff Product Designer",
            },
          ],
        }),
    });
    const context = makeContext([{ ats_slug: "hinge-health" }], SEARCH_TERMS);

    const result = await ashbyCollector.collect({ ...context, limit: 1 });

    expect(result.jobs).toHaveLength(1);
  });
});

describe("AC 48: posting_date holds publishedAt", () => {
  test("posting_date is a Date built from publishedAt", async () => {
    expect((await collectOneJob()).posting_date).toEqual(new Date("2026-01-15T00:00:00.000Z"));
  });
});

describe("AC 47: posting_updated_date is left unset", () => {
  test("posting_updated_date is undefined, because Ashby publishes one date", async () => {
    expect((await collectOneJob()).posting_updated_date).toBeUndefined();
  });
});

describe("AC 76: no boards configured", () => {
  test("a warning names the platform", async () => {
    stubFetch({});
    const context = makeContext([], SEARCH_TERMS);

    const result = await ashbyCollector.collect({ ...context, limit: Infinity });

    expect(result.warnings.some((warning) => warning.includes("ashby"))).toBe(true);
  });

  test("no request is made", async () => {
    const calls = stubFetch({});
    const context = makeContext([], SEARCH_TERMS);

    await ashbyCollector.collect({ ...context, limit: Infinity });

    expect(calls).toEqual([]);
  });
});

describe("a board answering 404 records a warning and lets the other slug's job still come back", () => {
  function run() {
    stubFetch({
      [boardUrl("carta")]: () => new Response("Not Found", { status: 404 }),
      [boardUrl("hinge-health")]: () =>
        jsonResponse({ apiVersion: "1", jobs: [seniorProductDesigner] }),
    });
    const context = makeContext(
      [
        { ats_slug: "carta" },
        { ats_slug: "hinge-health" },
      ],
      SEARCH_TERMS
    );
    return ashbyCollector.collect({ ...context, limit: Infinity });
  }

  test("collect resolves rather than rejecting", async () => {
    await expect(run()).resolves.toBeDefined();
  });

  test("a warning names the slug that failed", async () => {
    const result = await run();
    expect(result.warnings.some((warning) => warning.includes("carta"))).toBe(true);
  });

  test("the other slug's job still comes back", async () => {
    expect((await run()).jobs).toHaveLength(1);
  });
});

// A reply that is not job data, and a request that fails before any reply,
// skip only that board, exactly as an error status does.
describe.each([
  ["a reply that is not job data", () => new Response("<html>Unavailable</html>", { status: 200 })],
  [
    "a request that fails",
    (): Response => {
      throw new TypeError("fetch failed");
    },
  ],
])("a board sending %s records a warning and lets the other slugs run", (_case, broken) => {
  function run() {
    stubFetch({
      [boardUrl("carta")]: broken,
      [boardUrl("hinge-health")]: () => jsonResponse({ apiVersion: "1", jobs: [seniorProductDesigner] }),
    });
    const context = makeContext([{ ats_slug: "carta" }, { ats_slug: "hinge-health" }], SEARCH_TERMS);
    return ashbyCollector.collect({ ...context, limit: Infinity });
  }

  test("a warning names the slug that failed", async () => {
    const result = await run();
    expect(result.warnings.some((warning) => warning.includes("carta"))).toBe(true);
  });

  test("the other slug's job still comes back", async () => {
    expect((await run()).jobs).toHaveLength(1);
  });
});

describe("the field mapping from an Ashby posting to a job list entry", () => {
  test("raw_title is the posting's title", async () => {
    expect((await collectOneJob()).raw_title).toBe("Senior Product Designer");
  });

  test("raw_location_list holds the posting's location", async () => {
    expect((await collectOneJob()).raw_location_list).toEqual(["Remote - US"]);
  });

  test("raw_mode_list holds the workplaceType", async () => {
    expect((await collectOneJob()).raw_mode_list).toEqual(["Remote"]);
  });

  test("description is the plain text", async () => {
    expect((await collectOneJob()).description).toBe("Design beautiful products at Hinge Health.");
  });
});

describe("original_url and resolved_url both equal the posting's own jobUrl", () => {
  test("original_url is the jobUrl Ashby sent, not one rebuilt from slug and id", async () => {
    expect((await collectOneJob()).original_url).toBe(
      "https://jobs.ashbyhq.com/hinge-health/cd67cd2f-3a94-4eaf-9ad8-d067fdd18bf0"
    );
  });

  test("resolved_url equals original_url", async () => {
    const posting = await collectOneJob();
    expect(posting.resolved_url).toBe(posting.original_url);
  });
});

describe("locations", () => {
  test("primary location alone", async () => {
    stubFetch({
      [boardUrl("hinge-health")]: () =>
        jsonResponse({
          apiVersion: "1",
          jobs: [{ ...seniorProductDesigner, location: "Remote - US", secondaryLocations: [] }],
        }),
    });
    const context = makeContext([{ ats_slug: "hinge-health" }], SEARCH_TERMS);

    const result = await ashbyCollector.collect({ ...context, limit: Infinity });

    expect(result.jobs[0].raw_location_list).toEqual(["Remote - US"]);
  });

  test("primary plus two secondary locations, in that order", async () => {
    stubFetch({
      [boardUrl("hinge-health")]: () =>
        jsonResponse({
          apiVersion: "1",
          jobs: [
            {
              ...seniorProductDesigner,
              location: "Remote - US",
              secondaryLocations: [{ location: "San Francisco, CA" }, { location: "New York, NY" }],
            },
          ],
        }),
    });
    const context = makeContext([{ ats_slug: "hinge-health" }], SEARCH_TERMS);

    const result = await ashbyCollector.collect({ ...context, limit: Infinity });

    expect(result.jobs[0].raw_location_list).toEqual([
      "Remote - US",
      "San Francisco, CA",
      "New York, NY",
    ]);
  });

  test("neither primary nor secondary locations gives an empty list", async () => {
    stubFetch({
      [boardUrl("hinge-health")]: () =>
        jsonResponse({
          apiVersion: "1",
          jobs: [{ ...seniorProductDesigner, location: undefined, secondaryLocations: [] }],
        }),
    });
    const context = makeContext([{ ats_slug: "hinge-health" }], SEARCH_TERMS);

    const result = await ashbyCollector.collect({ ...context, limit: Infinity });

    expect(result.jobs[0].raw_location_list).toEqual([]);
  });
});

describe("modes", () => {
  test("workplaceType is stored exactly as sent, with no casing change", async () => {
    stubFetch({
      [boardUrl("hinge-health")]: () =>
        jsonResponse({
          apiVersion: "1",
          jobs: [{ ...seniorProductDesigner, workplaceType: "OnSite" }],
        }),
    });
    const context = makeContext([{ ats_slug: "hinge-health" }], SEARCH_TERMS);

    const result = await ashbyCollector.collect({ ...context, limit: Infinity });

    expect(result.jobs[0].raw_mode_list).toEqual(["OnSite"]);
  });

  test("a null workplaceType gives an empty mode list", async () => {
    stubFetch({
      [boardUrl("hinge-health")]: () =>
        jsonResponse({
          apiVersion: "1",
          jobs: [{ ...seniorProductDesigner, workplaceType: null }],
        }),
    });
    const context = makeContext([{ ats_slug: "hinge-health" }], SEARCH_TERMS);

    const result = await ashbyCollector.collect({ ...context, limit: Infinity });

    expect(result.jobs[0].raw_mode_list).toEqual([]);
  });

  // Ashby publishes isRemote alongside workplaceType, and sets it true on
  // hybrid postings anchored to an office. Only workplaceType feeds the mode
  // list, so the two never end up contradicting each other in the raw field.
  test("isRemote never reaches raw_mode_list, even alongside a workplaceType", async () => {
    stubFetch({
      [boardUrl("hinge-health")]: () =>
        jsonResponse({
          apiVersion: "1",
          jobs: [{ ...seniorProductDesigner, workplaceType: "Hybrid", isRemote: true }],
        }),
    });
    const context = makeContext([{ ats_slug: "hinge-health" }], SEARCH_TERMS);

    const result = await ashbyCollector.collect({ ...context, limit: Infinity });

    expect(result.jobs[0].raw_mode_list).toEqual(["Hybrid"]);
  });
});

describe("salary", () => {
  test("the Salary entry is chosen when an EquityPercentage entry with null values comes first", async () => {
    stubFetch({
      [boardUrl("hinge-health")]: () =>
        jsonResponse({
          apiVersion: "1",
          jobs: [
            {
              ...seniorProductDesigner,
              compensation: {
                summaryComponents: [
                  {
                    compensationType: "EquityPercentage",
                    interval: null,
                    currencyCode: null,
                    minValue: null,
                    maxValue: null,
                  },
                  {
                    compensationType: "Salary",
                    interval: "1 YEAR",
                    currencyCode: "USD",
                    minValue: 140000,
                    maxValue: 180000,
                  },
                ],
              },
            },
          ],
        }),
    });
    const context = makeContext([{ ats_slug: "hinge-health" }], SEARCH_TERMS);

    const result = await ashbyCollector.collect({ ...context, limit: Infinity });

    expect(result.jobs[0].raw_salary).toEqual({
      salary_min: 140000,
      salary_max: 180000,
      salary_period: "1 YEAR",
      salary_currency: "USD",
    });
  });

  test("interval and currencyCode pass through unchanged for a non-USD, non-yearly posting", async () => {
    stubFetch({
      [boardUrl("hinge-health")]: () =>
        jsonResponse({
          apiVersion: "1",
          jobs: [
            {
              ...seniorProductDesigner,
              compensation: {
                summaryComponents: [
                  {
                    compensationType: "Salary",
                    interval: "1 MONTH",
                    currencyCode: "EUR",
                    minValue: 4000,
                    maxValue: 5000,
                  },
                ],
              },
            },
          ],
        }),
    });
    const context = makeContext([{ ats_slug: "hinge-health" }], SEARCH_TERMS);

    const result = await ashbyCollector.collect({ ...context, limit: Infinity });

    expect(result.jobs[0].raw_salary).toEqual({
      salary_min: 4000,
      salary_max: 5000,
      salary_period: "1 MONTH",
      salary_currency: "EUR",
    });
  });

  test("raw_salary carries no salary_unit key, because Ashby sends whole dollars", async () => {
    const job = await collectOneJob();
    expect(Object.keys(job.raw_salary ?? {})).not.toContain("salary_unit");
  });

  test("a posting with no compensation at all gets no raw_salary", async () => {
    stubFetch({
      [boardUrl("hinge-health")]: () =>
        jsonResponse({
          apiVersion: "1",
          jobs: [{ ...seniorProductDesigner, compensation: undefined }],
        }),
    });
    const context = makeContext([{ ats_slug: "hinge-health" }], SEARCH_TERMS);

    const result = await ashbyCollector.collect({ ...context, limit: Infinity });

    expect(result.jobs[0].raw_salary).toBeUndefined();
  });

  test("a posting whose only components are EquityPercentage and Bonus gets no raw_salary", async () => {
    stubFetch({
      [boardUrl("hinge-health")]: () =>
        jsonResponse({
          apiVersion: "1",
          jobs: [
            {
              ...seniorProductDesigner,
              compensation: {
                summaryComponents: [
                  { compensationType: "EquityPercentage", minValue: null, maxValue: null },
                  { compensationType: "Bonus", minValue: 5000, maxValue: 10000 },
                ],
              },
            },
          ],
        }),
    });
    const context = makeContext([{ ats_slug: "hinge-health" }], SEARCH_TERMS);

    const result = await ashbyCollector.collect({ ...context, limit: Infinity });

    expect(result.jobs[0].raw_salary).toBeUndefined();
  });
});

describe("descriptions", () => {
  test("descriptionPlain wins when both are present", async () => {
    expect((await collectOneJob()).description).toBe("Design beautiful products at Hinge Health.");
  });

  test("descriptionHtml is used when descriptionPlain is absent", async () => {
    stubFetch({
      [boardUrl("hinge-health")]: () =>
        jsonResponse({
          apiVersion: "1",
          jobs: [
            {
              ...seniorProductDesigner,
              descriptionPlain: undefined,
              descriptionHtml: "<p>HTML only version.</p>",
            },
          ],
        }),
    });
    const context = makeContext([{ ats_slug: "hinge-health" }], SEARCH_TERMS);

    const result = await ashbyCollector.collect({ ...context, limit: Infinity });

    expect(result.jobs[0].description).toBe("<p>HTML only version.</p>");
  });

  test("neither description present leaves description undefined", async () => {
    stubFetch({
      [boardUrl("hinge-health")]: () =>
        jsonResponse({
          apiVersion: "1",
          jobs: [
            {
              ...seniorProductDesigner,
              descriptionPlain: undefined,
              descriptionHtml: undefined,
            },
          ],
        }),
    });
    const context = makeContext([{ ats_slug: "hinge-health" }], SEARCH_TERMS);

    const result = await ashbyCollector.collect({ ...context, limit: Infinity });

    expect(result.jobs[0].description).toBeUndefined();
  });
});

describe("AC 10: the collector and the parser read a posting through one shared mapper", () => {
  test("the collector's fields come from jobFieldsFromAshbyPosting, not a second copy of it", async () => {
    const job = await collectOneJob();

    expect(jobFieldsFromAshbyPosting).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.any(String) }),
      "hinge-health"
    );
    // The mapper's answer is what reached the entry, so the two cannot drift.
    expect(job).toMatchObject(
      vi.mocked(jobFieldsFromAshbyPosting).mock.results[0].value as object
    );
  });
});
