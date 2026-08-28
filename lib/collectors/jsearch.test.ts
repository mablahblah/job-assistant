import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { jsearchCollector } from "./jsearch";
import type { SettingsService } from "../settings-service";

// Each test below swaps the global fetch for a plain stand-in and the real one
// is put back afterwards, so nothing leaks into the next test.
const originalFetch = globalThis.fetch;

const RAPIDAPI_KEY = "test-rapidapi-key";
let originalKey: string | undefined;

beforeEach(() => {
  originalKey = process.env.RAPIDAPI_KEY;
  process.env.RAPIDAPI_KEY = RAPIDAPI_KEY;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.RAPIDAPI_KEY;
  else process.env.RAPIDAPI_KEY = originalKey;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

// One request the stand-in has seen: the parsed url plus the headers it
// carried, so a test can check the key travelled as well as the query.
interface FetchCall {
  url: URL;
  headers: Headers;
}

interface FetchRoute {
  match: (url: URL) => boolean;
  respond: () => Response;
}

// Stands in for global fetch, answering the first route whose matcher passes.
// A route may throw instead, standing in for a search that failed outright.
function stubFetch(routes: FetchRoute[]): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: new Headers(init?.headers) });
    const route = routes.find((candidate) => candidate.match(url));
    if (route === undefined) {
      throw new Error(`no fetch stub set up for ${url.toString()}`);
    }
    return route.respond();
  };
  return calls;
}

function findCall(calls: FetchCall[], match: (url: URL) => boolean): URL {
  const found = calls.find((call) => match(call.url));
  expect(found).toBeDefined();
  if (found === undefined) {
    throw new Error("expected a matching call");
  }
  return found.url;
}

const LOCATION = "78701";

function makeSettings(searchTerms: string[]): SettingsService {
  return {
    getSearchTerms: async () => searchTerms,
    getLocation: async () => LOCATION,
    getRadius: async () => 30,
    getExpiryThreshold: async () => 8,
    getAtsCompanies: async () => [],
  };
}

const JSEARCH_URL = "https://jsearch.p.rapidapi.com/search";

function isJsearchUrl(url: URL): boolean {
  return `${url.origin}${url.pathname}` === JSEARCH_URL;
}

// The remote search asks for work_from_home; the local search carries a location.
function matchesRemoteSearch(url: URL): boolean {
  return isJsearchUrl(url) && url.searchParams.get("work_from_home") === "true";
}

function matchesLocalSearch(url: URL): boolean {
  return isJsearchUrl(url) && url.searchParams.has("location");
}

function routesFor(options: { remote?: unknown[]; local?: unknown[] }): FetchRoute[] {
  const remoteJobs = options.remote ?? [];
  const localJobs = options.local ?? [];
  return [
    { match: matchesRemoteSearch, respond: () => jsonResponse({ status: "OK", data: remoteJobs }) },
    { match: matchesLocalSearch, respond: () => jsonResponse({ status: "OK", data: localJobs }) },
  ];
}

const SEARCH_TERMS = ["Product Design"];

const seniorProductDesigner = {
  job_id: "abc123",
  job_title: "Senior Product Designer",
  employer_name: "Acme Corp",
  job_apply_link: "https://example.com/jobs/abc123",
  job_city: "Austin",
  job_state: "TX",
  job_country: "US",
  job_is_remote: true,
  job_posted_at_datetime_utc: "2026-08-20T00:00:00.000Z",
  job_description: "Design beautiful products at Acme Corp.",
  job_min_salary: 140000,
  job_max_salary: 210000,
  job_salary_period: "YEAR",
};

async function collectOneJob() {
  stubFetch(routesFor({ local: [seniorProductDesigner] }));
  const result = await jsearchCollector.collect({
    settings: makeSettings(SEARCH_TERMS),
    limit: Infinity,
  });
  const [job] = result.jobs;
  return job;
}

describe("a missing API key", () => {
  test("records an error", async () => {
    delete process.env.RAPIDAPI_KEY;
    stubFetch([]);
    const result = await jsearchCollector.collect({
      settings: makeSettings(SEARCH_TERMS),
      limit: Infinity,
    });
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("returns no jobs", async () => {
    delete process.env.RAPIDAPI_KEY;
    stubFetch([]);
    const result = await jsearchCollector.collect({
      settings: makeSettings(SEARCH_TERMS),
      limit: Infinity,
    });
    expect(result.jobs).toEqual([]);
  });

  test("makes no request", async () => {
    delete process.env.RAPIDAPI_KEY;
    const calls = stubFetch([]);
    await jsearchCollector.collect({ settings: makeSettings(SEARCH_TERMS), limit: Infinity });
    expect(calls).toEqual([]);
  });
});

describe("the search terms are joined with OR into one query", () => {
  test("the local query holds every term joined by OR", async () => {
    const calls = stubFetch(routesFor({}));
    const settings = makeSettings(["Product Design", "UX Researcher"]);
    await jsearchCollector.collect({ settings, limit: Infinity });
    expect(findCall(calls, matchesLocalSearch).searchParams.get("query")).toBe(
      "Product Design OR UX Researcher jobs"
    );
  });

  test("the remote query asks for remote work", async () => {
    const calls = stubFetch(routesFor({}));
    const settings = makeSettings(["Product Design", "UX Researcher"]);
    await jsearchCollector.collect({ settings, limit: Infinity });
    expect(findCall(calls, matchesRemoteSearch).searchParams.get("query")).toBe(
      "remote Product Design OR UX Researcher jobs"
    );
  });
});

describe("the local search sends the location setting", () => {
  test("location equals the location setting", async () => {
    const calls = stubFetch(routesFor({}));
    await jsearchCollector.collect({ settings: makeSettings(SEARCH_TERMS), limit: Infinity });
    expect(findCall(calls, matchesLocalSearch).searchParams.get("location")).toBe(LOCATION);
  });
});

describe("the remote search sends work_from_home=true", () => {
  test("work_from_home is true", async () => {
    const calls = stubFetch(routesFor({}));
    await jsearchCollector.collect({ settings: makeSettings(SEARCH_TERMS), limit: Infinity });
    expect(findCall(calls, matchesRemoteSearch).searchParams.get("work_from_home")).toBe("true");
  });
});

describe("the key travels in the x-rapidapi-key header", () => {
  test("every request carries the header", async () => {
    const calls = stubFetch(routesFor({}));
    await jsearchCollector.collect({ settings: makeSettings(SEARCH_TERMS), limit: Infinity });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.headers.get("x-rapidapi-key") === RAPIDAPI_KEY)).toBe(true);
  });
});

describe("AC 34: one of the two searches failing is surfaced", () => {
  function run() {
    stubFetch([
      {
        match: matchesRemoteSearch,
        respond: () => {
          throw new Error("network down");
        },
      },
      {
        match: matchesLocalSearch,
        respond: () => jsonResponse({ status: "OK", data: [seniorProductDesigner] }),
      },
    ]);
    return jsearchCollector.collect({ settings: makeSettings(SEARCH_TERMS), limit: Infinity });
  }

  test("a warning names which search failed", async () => {
    // The old pipeline swallowed a rejected half and reported success with
    // half the jobs.
    const result = await run();
    expect(result.warnings.some((warning) => warning.toLowerCase().includes("remote"))).toBe(true);
  });

  test("the other search's jobs are still returned", async () => {
    expect((await run()).jobs).toHaveLength(1);
  });
});

describe("AC 24: limit stops collection after that many jobs", () => {
  test("exactly one job comes back when the limit is 1", async () => {
    stubFetch(
      routesFor({
        local: [
          seniorProductDesigner,
          { ...seniorProductDesigner, job_id: "def456", job_title: "Staff Product Designer" },
        ],
      })
    );
    const result = await jsearchCollector.collect({
      settings: makeSettings(SEARCH_TERMS),
      limit: 1,
    });
    expect(result.jobs).toHaveLength(1);
  });
});

describe("AC 39: results come back unfiltered", () => {
  test("a job whose title does not match the search terms is still present", async () => {
    // JSearch searched on the terms itself, so filtering again would drop jobs
    // the source already decided were a match.
    const nonMatching = {
      ...seniorProductDesigner,
      job_id: "999",
      job_title: "Warehouse Associate",
    };
    stubFetch(routesFor({ local: [nonMatching] }));
    const result = await jsearchCollector.collect({
      settings: makeSettings(SEARCH_TERMS),
      limit: Infinity,
    });
    expect(result.jobs.map((job) => job.raw_title)).toContain("Warehouse Associate");
  });
});

describe("AC 47: posting_updated_date is left unset", () => {
  test("posting_updated_date is undefined, because JSearch publishes one date", async () => {
    expect((await collectOneJob()).posting_updated_date).toBeUndefined();
  });
});

describe("AC 48: the dates are written to their own fields", () => {
  test("posting_date is a date", async () => {
    expect((await collectOneJob()).posting_date).toBeInstanceOf(Date);
  });

  test("the entry carries no array of undifferentiated dates", async () => {
    expect(await collectOneJob()).not.toHaveProperty("dates");
  });
});

describe("the field mapping from a JSearch posting to a job list entry", () => {
  test("original_url is job_apply_link", async () => {
    expect((await collectOneJob()).original_url).toBe("https://example.com/jobs/abc123");
  });

  test("raw_title is job_title", async () => {
    expect((await collectOneJob()).raw_title).toBe("Senior Product Designer");
  });

  test("raw_company_name is employer_name", async () => {
    expect((await collectOneJob()).raw_company_name).toBe("Acme Corp");
  });

  test("posting_date is job_posted_at_datetime_utc", async () => {
    expect((await collectOneJob()).posting_date).toEqual(new Date("2026-08-20T00:00:00.000Z"));
  });

  test("raw_location_list joins city, state and country", async () => {
    expect((await collectOneJob()).raw_location_list).toEqual(["Austin, TX, US"]);
  });

  test("raw_mode_list holds remote when job_is_remote is true", async () => {
    expect((await collectOneJob()).raw_mode_list).toEqual(["remote"]);
  });

  test("is_resolved is false", async () => {
    // An aggregator link is a redirect, not the source posting.
    expect((await collectOneJob()).is_resolved).toBe(false);
  });

  test("is_parsed is false", async () => {
    expect((await collectOneJob()).is_parsed).toBe(false);
  });

  test("is_classified is false", async () => {
    expect((await collectOneJob()).is_classified).toBe(false);
  });

  test("resolved_url is not written", async () => {
    expect((await collectOneJob()).resolved_url).toBeUndefined();
  });
});

describe("a job that is not remote gives an empty mode list", () => {
  test("raw_mode_list is empty rather than holding a placeholder", async () => {
    stubFetch(routesFor({ local: [{ ...seniorProductDesigner, job_is_remote: false }] }));
    const result = await jsearchCollector.collect({
      settings: makeSettings(SEARCH_TERMS),
      limit: Infinity,
    });
    expect(result.jobs[0].raw_mode_list).toEqual([]);
  });
});

describe("a job missing city, state and country gives an empty location list", () => {
  test("raw_location_list is empty rather than holding a placeholder", async () => {
    const withoutLocation = {
      job_id: "333",
      job_title: "Senior Product Designer",
      employer_name: "Acme Corp",
      job_apply_link: "https://example.com/jobs/333",
      job_is_remote: true,
      job_posted_at_datetime_utc: "2026-08-21T00:00:00.000Z",
    };
    stubFetch(routesFor({ local: [withoutLocation] }));
    const result = await jsearchCollector.collect({
      settings: makeSettings(SEARCH_TERMS),
      limit: Infinity,
    });
    expect(result.jobs[0].raw_location_list).toEqual([]);
  });
});

describe("a job missing its posted date leaves posting_date unset", () => {
  test("posting_date is undefined rather than an invalid date", async () => {
    const withoutDate = {
      job_id: "444",
      job_title: "Senior Product Designer",
      employer_name: "Acme Corp",
      job_apply_link: "https://example.com/jobs/444",
      job_city: "Austin",
      job_state: "TX",
      job_country: "US",
      job_is_remote: true,
    };
    stubFetch(routesFor({ local: [withoutDate] }));
    const result = await jsearchCollector.collect({
      settings: makeSettings(SEARCH_TERMS),
      limit: Infinity,
    });
    expect(result.jobs[0].posting_date).toBeUndefined();
  });
});

describe("a data list of null gives no jobs", () => {
  test("no jobs come back", async () => {
    stubFetch([
      { match: matchesRemoteSearch, respond: () => jsonResponse({ status: "OK", data: null }) },
      { match: matchesLocalSearch, respond: () => jsonResponse({ status: "OK", data: null }) },
    ]);
    const result = await jsearchCollector.collect({
      settings: makeSettings(SEARCH_TERMS),
      limit: Infinity,
    });
    expect(result.jobs).toEqual([]);
  });
});

describe("an empty data list", () => {
  test("gives no jobs", async () => {
    stubFetch(routesFor({}));
    const result = await jsearchCollector.collect({
      settings: makeSettings(SEARCH_TERMS),
      limit: Infinity,
    });
    expect(result.jobs).toEqual([]);
  });

  test("does not throw", async () => {
    stubFetch(routesFor({}));
    await expect(
      jsearchCollector.collect({ settings: makeSettings(SEARCH_TERMS), limit: Infinity })
    ).resolves.toBeDefined();
  });
});

describe("AC 78: description holds exactly what the source sent", () => {
  test("description equals job_description", async () => {
    expect((await collectOneJob()).description).toBe("Design beautiful products at Acme Corp.");
  });
});

describe("AC 79: a job with no description leaves the field unset", () => {
  test("description is undefined rather than a blank string", async () => {
    const withoutDescription = {
      job_id: "555",
      job_title: "Senior Product Designer",
      employer_name: "Acme Corp",
      job_apply_link: "https://example.com/jobs/555",
      job_city: "Austin",
      job_state: "TX",
      job_country: "US",
      job_is_remote: true,
      job_posted_at_datetime_utc: "2026-08-24T00:00:00.000Z",
    };
    stubFetch(routesFor({ local: [withoutDescription] }));

    const result = await jsearchCollector.collect({
      settings: makeSettings(SEARCH_TERMS),
      limit: Infinity,
    });

    expect(result.jobs[0].description).toBeUndefined();
  });
});

describe("AC 80: raw_salary holds the job's numbers and no column is written", () => {
  test("raw_salary holds the figures and the period word", async () => {
    expect((await collectOneJob()).raw_salary).toEqual({
      salary_min: 140000,
      salary_max: 210000,
      salary_period: "YEAR",
    });
  });

  test("the salary columns are left for normalization to fill", async () => {
    const job = await collectOneJob();
    expect(job.salary_low).toBeUndefined();
    expect(job.salary_high).toBeUndefined();
    expect(job.salary_period).toBeUndefined();
  });
});

describe("AC 103: job_salary_period is recorded in the source's own wording", () => {
  test("YEAR is kept as YEAR, not translated to year", async () => {
    expect((await collectOneJob()).raw_salary?.salary_period).toBe("YEAR");
  });

  test("HOUR is kept as HOUR", async () => {
    const hourly = {
      ...seniorProductDesigner,
      job_id: "777",
      job_min_salary: 40,
      job_max_salary: 60,
      job_salary_period: "HOUR",
    };
    stubFetch(routesFor({ local: [hourly] }));

    const result = await jsearchCollector.collect({
      settings: makeSettings(SEARCH_TERMS),
      limit: Infinity,
    });

    expect(result.jobs[0].raw_salary).toEqual({
      salary_min: 40,
      salary_max: 60,
      salary_period: "HOUR",
    });
  });
});

describe("a period with no figures behind it is not a salary", () => {
  // JSearch answers a posting with no pay by sending null, and a period on its
  // own leaves normalization an envelope with nothing to normalize.
  test("raw_salary is absent where only the period arrived", async () => {
    const periodOnly = {
      ...seniorProductDesigner,
      job_id: "778",
      job_min_salary: null,
      job_max_salary: null,
      job_salary_period: "YEAR",
    };
    stubFetch(routesFor({ local: [periodOnly] }));

    const result = await jsearchCollector.collect({
      settings: makeSettings(SEARCH_TERMS),
      limit: Infinity,
    });

    expect(result.jobs[0].raw_salary).toBeUndefined();
  });
});

describe("AC 84: a job with no salary gets no raw_salary at all", () => {
  function collectWithoutSalary() {
    const withoutSalary = {
      job_id: "666",
      job_title: "Senior Product Designer",
      employer_name: "Acme Corp",
      job_apply_link: "https://example.com/jobs/666",
      job_city: "Austin",
      job_state: "TX",
      job_country: "US",
      job_is_remote: true,
      job_posted_at_datetime_utc: "2026-08-25T00:00:00.000Z",
    };
    stubFetch(routesFor({ local: [withoutSalary] }));
    return jsearchCollector
      .collect({ settings: makeSettings(SEARCH_TERMS), limit: Infinity })
      .then((r) => r.jobs[0]);
  }

  test("raw_salary is absent rather than an empty envelope", async () => {
    expect((await collectWithoutSalary()).raw_salary).toBeUndefined();
  });

  test("the salary columns are left unset", async () => {
    const job = await collectWithoutSalary();
    expect(job.salary_low).toBeUndefined();
    expect(job.salary_high).toBeUndefined();
    expect(job.salary_period).toBeUndefined();
  });
});
