import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { adzunaCollector } from "./adzuna";
import type { SettingsService } from "../settings-service";

// Each test below swaps the global fetch for a plain stand-in and the real one
// is put back afterwards, so nothing leaks into the next test.
const originalFetch = globalThis.fetch;

const ADZUNA_APP_ID = "test-app-id";
const ADZUNA_API_KEY = "test-api-key";
let originalAppId: string | undefined;
let originalApiKey: string | undefined;

beforeEach(() => {
  originalAppId = process.env.ADZUNA_APP_ID;
  originalApiKey = process.env.ADZUNA_API_KEY;
  process.env.ADZUNA_APP_ID = ADZUNA_APP_ID;
  process.env.ADZUNA_API_KEY = ADZUNA_API_KEY;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalAppId === undefined) delete process.env.ADZUNA_APP_ID;
  else process.env.ADZUNA_APP_ID = originalAppId;
  if (originalApiKey === undefined) delete process.env.ADZUNA_API_KEY;
  else process.env.ADZUNA_API_KEY = originalApiKey;
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

// One request the stand-in has seen, kept as a parsed URL so a test can read
// its query without caring what order the collector built it in.
interface FetchCall {
  url: URL;
}

interface FetchRoute {
  match: (url: URL) => boolean;
  respond: () => Response;
}

// Stands in for global fetch, answering the first route whose matcher passes.
// Every call is recorded, so a test can also check that none were made.
function stubFetch(routes: FetchRoute[]): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = async (input: unknown) => {
    const url = new URL(String(input));
    calls.push({ url });
    const route = routes.find((candidate) => candidate.match(url));
    if (route === undefined) {
      throw new Error(`no fetch stub set up for ${url.toString()}`);
    }
    return route.respond();
  };
  return calls;
}

// Finds the one call matching a predicate, failing with a clear message rather
// than letting a later line throw on undefined.
function findCall(calls: FetchCall[], match: (url: URL) => boolean): URL {
  const found = calls.find((call) => match(call.url));
  expect(found).toBeDefined();
  if (found === undefined) {
    throw new Error("expected a matching call");
  }
  return found.url;
}

const LOCATION = "78701";
const RADIUS = 30;
const EXPIRY_THRESHOLD = 14;

function makeSettings(searchTerms: string[], expiryThreshold = EXPIRY_THRESHOLD): SettingsService {
  return {
    getSearchTerms: async () => searchTerms,
    getLocation: async () => LOCATION,
    getRadius: async () => RADIUS,
    getExpiryThreshold: async () => expiryThreshold,
    getAtsCompanies: async () => [],
  };
}

const ADZUNA_SEARCH_URL = "https://api.adzuna.com/v1/api/jobs/us/search/1";

function isAdzunaSearchUrl(url: URL): boolean {
  return `${url.origin}${url.pathname}` === ADZUNA_SEARCH_URL;
}

// The remote search never carries a where param; the Austin search always does.
function matchesRemoteSearch(url: URL): boolean {
  return isAdzunaSearchUrl(url) && url.searchParams.get("what") === "remote";
}

function matchesAustinSearch(url: URL): boolean {
  return isAdzunaSearchUrl(url) && url.searchParams.has("where");
}

// Routes both searches at once, each defaulting to an empty result list, so a
// test only has to name the search it cares about.
function routesFor(options: { remote?: unknown[]; austin?: unknown[] }): FetchRoute[] {
  const remoteJobs = options.remote ?? [];
  const austinJobs = options.austin ?? [];
  return [
    {
      match: matchesRemoteSearch,
      respond: () => jsonResponse({ results: remoteJobs, count: remoteJobs.length }),
    },
    {
      match: matchesAustinSearch,
      respond: () => jsonResponse({ results: austinJobs, count: austinJobs.length }),
    },
  ];
}

const SEARCH_TERMS = ["Product Design"];

const seniorProductDesigner = {
  id: "1234567",
  title: "Senior Product Designer",
  company: { display_name: "Acme Corp" },
  redirect_url: "https://www.adzuna.com/land/ad/1234567",
  location: { display_name: "Austin, TX, USA" },
  created: "2026-08-20T00:00:00.000Z",
  description: "Design beautiful products at Acme Corp.",
  salary_min: 140000,
  salary_max: 210000,
  // Only an explicit "0" marks a salary the employer published; Adzuna predicts
  // the rest.
  salary_is_predicted: "0",
};

// The one job the Austin search produces from a single posting.
async function collectOneJob() {
  stubFetch(routesFor({ austin: [seniorProductDesigner] }));
  const settings = makeSettings(SEARCH_TERMS);
  const result = await adzunaCollector.collect({ settings, limit: Infinity });
  const [job] = result.jobs;
  return job;
}

describe("a missing API key", () => {
  test("records an error", async () => {
    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_API_KEY;
    stubFetch([]);
    const result = await adzunaCollector.collect({
      settings: makeSettings(SEARCH_TERMS),
      limit: Infinity,
    });
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("returns no jobs", async () => {
    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_API_KEY;
    stubFetch([]);
    const result = await adzunaCollector.collect({
      settings: makeSettings(SEARCH_TERMS),
      limit: Infinity,
    });
    expect(result.jobs).toEqual([]);
  });

  test("makes no request", async () => {
    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_API_KEY;
    const calls = stubFetch([]);
    await adzunaCollector.collect({ settings: makeSettings(SEARCH_TERMS), limit: Infinity });
    expect(calls).toEqual([]);
  });
});

describe("AC 33: the remote search carries no where or distance", () => {
  test("no where param", async () => {
    const calls = stubFetch(routesFor({}));
    await adzunaCollector.collect({ settings: makeSettings(SEARCH_TERMS), limit: Infinity });
    expect(findCall(calls, matchesRemoteSearch).searchParams.has("where")).toBe(false);
  });

  test("no distance param", async () => {
    // Threading location into the remote search would narrow it to the radius
    // and defeat it.
    const calls = stubFetch(routesFor({}));
    await adzunaCollector.collect({ settings: makeSettings(SEARCH_TERMS), limit: Infinity });
    expect(findCall(calls, matchesRemoteSearch).searchParams.has("distance")).toBe(false);
  });
});

describe("AC 33: the Austin search carries the location and radius settings", () => {
  test("where equals the location setting", async () => {
    const calls = stubFetch(routesFor({}));
    await adzunaCollector.collect({ settings: makeSettings(SEARCH_TERMS), limit: Infinity });
    expect(findCall(calls, matchesAustinSearch).searchParams.get("where")).toBe(LOCATION);
  });

  test("distance equals the radius setting", async () => {
    const calls = stubFetch(routesFor({}));
    await adzunaCollector.collect({ settings: makeSettings(SEARCH_TERMS), limit: Infinity });
    expect(findCall(calls, matchesAustinSearch).searchParams.get("distance")).toBe(String(RADIUS));
  });
});

describe("two searches run per search term", () => {
  test("two terms make four requests", async () => {
    const calls = stubFetch(routesFor({}));
    const settings = makeSettings(["Product Design", "UX Researcher"]);
    await adzunaCollector.collect({ settings, limit: Infinity });
    expect(calls).toHaveLength(4);
  });
});

describe("max_days_old is read from the expiry-threshold setting", () => {
  test("max_days_old equals the setting rather than a hardcoded number", async () => {
    const calls = stubFetch(routesFor({}));
    await adzunaCollector.collect({ settings: makeSettings(SEARCH_TERMS, 21), limit: Infinity });
    expect(findCall(calls, matchesAustinSearch).searchParams.get("max_days_old")).toBe("21");
  });
});

describe("AC 24: limit stops collection after that many jobs", () => {
  test("exactly one job comes back when the limit is 1", async () => {
    stubFetch(
      routesFor({
        austin: [
          seniorProductDesigner,
          { ...seniorProductDesigner, id: "7654321", title: "Staff Product Designer" },
        ],
      })
    );
    const result = await adzunaCollector.collect({
      settings: makeSettings(SEARCH_TERMS),
      limit: 1,
    });
    expect(result.jobs).toHaveLength(1);
  });
});

describe("AC 39: results come back unfiltered", () => {
  test("a job whose title does not match the search terms is still present", async () => {
    // Adzuna searched on the terms itself, so filtering again would drop jobs
    // the source already decided were a match.
    const nonMatching = { ...seniorProductDesigner, id: "999", title: "Warehouse Associate" };
    stubFetch(routesFor({ austin: [nonMatching] }));
    const result = await adzunaCollector.collect({
      settings: makeSettings(SEARCH_TERMS),
      limit: Infinity,
    });
    expect(result.jobs.map((job) => job.original_title)).toContain("Warehouse Associate");
  });
});

describe("AC 47: posting_updated_date is left unset", () => {
  test("posting_updated_date is undefined, because Adzuna publishes one date", async () => {
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

describe("the field mapping from an Adzuna job to a job list entry", () => {
  test("original_url is the redirect_url", async () => {
    expect((await collectOneJob()).original_url).toBe("https://www.adzuna.com/land/ad/1234567");
  });

  test("original_title is the title", async () => {
    expect((await collectOneJob()).original_title).toBe("Senior Product Designer");
  });

  test("company_name is company.display_name", async () => {
    expect((await collectOneJob()).company_name).toBe("Acme Corp");
  });

  test("posting_date is created", async () => {
    expect((await collectOneJob()).posting_date).toEqual(new Date("2026-08-20T00:00:00.000Z"));
  });

  test("original_location_list holds location.display_name", async () => {
    expect((await collectOneJob()).original_location_list).toEqual(["Austin, TX, USA"]);
  });

  test("original_mode_list is always empty", async () => {
    // Adzuna publishes no structured work mode, and reading one out of the
    // description text is a parser's job.
    expect((await collectOneJob()).original_mode_list).toEqual([]);
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

describe("a job missing a location gives an empty location list", () => {
  test("original_location_list is empty rather than holding a placeholder", async () => {
    const withoutLocation = {
      id: "7654321",
      title: "Senior Product Designer",
      company: { display_name: "Acme Corp" },
      redirect_url: "https://www.adzuna.com/land/ad/7654321",
      created: "2026-08-21T00:00:00.000Z",
    };
    stubFetch(routesFor({ austin: [withoutLocation] }));
    const result = await adzunaCollector.collect({
      settings: makeSettings(SEARCH_TERMS),
      limit: Infinity,
    });
    expect(result.jobs[0].original_location_list).toEqual([]);
  });
});

describe("a results list of null gives no jobs", () => {
  test("no jobs come back", async () => {
    stubFetch([
      { match: matchesRemoteSearch, respond: () => jsonResponse({ results: null, count: 0 }) },
      { match: matchesAustinSearch, respond: () => jsonResponse({ results: null, count: 0 }) },
    ]);
    const result = await adzunaCollector.collect({
      settings: makeSettings(SEARCH_TERMS),
      limit: Infinity,
    });
    expect(result.jobs).toEqual([]);
  });
});

describe("an empty results list", () => {
  test("gives no jobs", async () => {
    stubFetch(routesFor({}));
    const result = await adzunaCollector.collect({
      settings: makeSettings(SEARCH_TERMS),
      limit: Infinity,
    });
    expect(result.jobs).toEqual([]);
  });

  test("does not throw", async () => {
    stubFetch(routesFor({}));
    await expect(
      adzunaCollector.collect({ settings: makeSettings(SEARCH_TERMS), limit: Infinity })
    ).resolves.toBeDefined();
  });
});

describe("AC 78: description holds exactly what the source sent", () => {
  test("description equals the job's description", async () => {
    // Adzuna truncates its descriptions to 500 characters, and the collector
    // keeps whatever it was sent rather than judging it.
    expect((await collectOneJob()).description).toBe("Design beautiful products at Acme Corp.");
  });
});

describe("AC 79: a job with no description leaves the field unset", () => {
  test("description is undefined rather than a blank string", async () => {
    const withoutDescription = {
      id: "7654322",
      title: "Senior Product Designer",
      company: { display_name: "Acme Corp" },
      redirect_url: "https://www.adzuna.com/land/ad/7654322",
      location: { display_name: "Austin, TX, USA" },
      created: "2026-08-22T00:00:00.000Z",
    };
    stubFetch(routesFor({ austin: [withoutDescription] }));

    const result = await adzunaCollector.collect({
      settings: makeSettings(SEARCH_TERMS),
      limit: Infinity,
    });

    expect(result.jobs[0].description).toBeUndefined();
  });
});

describe("AC 80: the salary fields are filled from the job's numbers", () => {
  test("salary_low is salary_min, unchanged", async () => {
    expect((await collectOneJob()).salary_low).toBe(140000);
  });

  test("salary_high is salary_max, unchanged", async () => {
    expect((await collectOneJob()).salary_high).toBe(210000);
  });

  test("salary_period is filled", async () => {
    expect((await collectOneJob()).salary_period).toBeDefined();
  });

  test("salary_raw holds the job's figures", async () => {
    expect((await collectOneJob()).salary_raw).toContain("140000-210000");
  });
});

describe("AC 82: salary_period is year, since Adzuna states no period", () => {
  test("salary_period is year", async () => {
    expect((await collectOneJob()).salary_period).toBe("year");
  });
});

describe("AC 84: a job with no salary leaves all four fields unset", () => {
  function collectWithoutSalary() {
    const withoutSalary = {
      id: "7654323",
      title: "Senior Product Designer",
      company: { display_name: "Acme Corp" },
      redirect_url: "https://www.adzuna.com/land/ad/7654323",
      location: { display_name: "Austin, TX, USA" },
      created: "2026-08-23T00:00:00.000Z",
    };
    stubFetch(routesFor({ austin: [withoutSalary] }));
    return adzunaCollector
      .collect({ settings: makeSettings(SEARCH_TERMS), limit: Infinity })
      .then((r) => r.jobs[0]);
  }

  test("salary_low is undefined", async () => {
    expect((await collectWithoutSalary()).salary_low).toBeUndefined();
  });

  test("salary_high is undefined", async () => {
    expect((await collectWithoutSalary()).salary_high).toBeUndefined();
  });

  test("salary_period is undefined", async () => {
    expect((await collectWithoutSalary()).salary_period).toBeUndefined();
  });

  test("salary_raw is undefined", async () => {
    expect((await collectWithoutSalary()).salary_raw).toBeUndefined();
  });
});

describe('AC 99: salary is collected when salary_is_predicted is "0"', () => {
  function collectWithPublishedFlag() {
    stubFetch(routesFor({ austin: [{ ...seniorProductDesigner, salary_is_predicted: "0" }] }));
    return adzunaCollector
      .collect({ settings: makeSettings(SEARCH_TERMS), limit: Infinity })
      .then((r) => r.jobs[0]);
  }

  test("salary_low is collected", async () => {
    expect((await collectWithPublishedFlag()).salary_low).toBe(140000);
  });

  test("salary_high is collected", async () => {
    expect((await collectWithPublishedFlag()).salary_high).toBe(210000);
  });
});

describe("AC 98: a predicted salary is excluded", () => {
  // Adzuna's own model fills the figure where the flag is "1", and a guess reads
  // as fact once it is stored.
  function collectWithPredictedSalary() {
    stubFetch(routesFor({ austin: [{ ...seniorProductDesigner, salary_is_predicted: "1" }] }));
    return adzunaCollector
      .collect({ settings: makeSettings(SEARCH_TERMS), limit: Infinity })
      .then((r) => r.jobs[0]);
  }

  test("salary_low is undefined", async () => {
    expect((await collectWithPredictedSalary()).salary_low).toBeUndefined();
  });

  test("salary_high is undefined", async () => {
    expect((await collectWithPredictedSalary()).salary_high).toBeUndefined();
  });

  test("salary_period is undefined", async () => {
    expect((await collectWithPredictedSalary()).salary_period).toBeUndefined();
  });

  test("salary_raw is undefined", async () => {
    expect((await collectWithPredictedSalary()).salary_raw).toBeUndefined();
  });
});

describe("when salary_is_predicted is absent, the salary is left unset", () => {
  function collectWithoutFlag() {
    const noFlag = {
      id: "9876543",
      title: "Senior Product Designer",
      company: { display_name: "Acme Corp" },
      redirect_url: "https://www.adzuna.com/land/ad/9876543",
      location: { display_name: "Austin, TX, USA" },
      created: "2026-08-20T00:00:00.000Z",
      description: "Design beautiful products at Acme Corp.",
      salary_min: 140000,
      salary_max: 210000,
    };
    stubFetch(routesFor({ austin: [noFlag] }));
    return adzunaCollector
      .collect({ settings: makeSettings(SEARCH_TERMS), limit: Infinity })
      .then((r) => r.jobs[0]);
  }

  test("salary_low is undefined", async () => {
    expect((await collectWithoutFlag()).salary_low).toBeUndefined();
  });

  test("salary_high is undefined", async () => {
    expect((await collectWithoutFlag()).salary_high).toBeUndefined();
  });

  test("salary_period is undefined", async () => {
    expect((await collectWithoutFlag()).salary_period).toBeUndefined();
  });

  test("salary_raw is undefined", async () => {
    expect((await collectWithoutFlag()).salary_raw).toBeUndefined();
  });
});
