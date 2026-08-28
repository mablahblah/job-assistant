import { afterEach, describe, expect, test } from "vitest";
import { greenhouseCollector } from "./greenhouse";
import type { AtsCompany, SettingsService } from "../settings-service";

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
function makeSettings(boards: AtsCompany[], searchTerms: string[]): SettingsService {
  return {
    getSearchTerms: async () => searchTerms,
    getLocation: async () => "",
    getRadius: async () => 0,
    getExpiryThreshold: async () => 0,
    getAtsCompanies: async () => boards,
  };
}

const jobsUrl = (slug: string) =>
  `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true&pay_transparency=true`;

const boardUrl = (slug: string) => `https://boards-api.greenhouse.io/v1/boards/${slug}`;

const SEARCH_TERMS = ["Product Design"];

// A title genuinely matching "Product Design" once it is stemmed.
const seniorProductDesigner = {
  id: 555111,
  title: "Senior Product Designer",
  first_published: "2026-06-01T00:00:00.000Z",
  updated_at: "2026-06-20T00:00:00.000Z",
  location: { name: "Remote - US" },
  company_name: "Stripe",
  content: "<p>Design beautiful products at Stripe.</p>",
  pay_input_ranges: [{ min_cents: 14000000, max_cents: 21000000, currency_type: "USD" }],
};

const backendEngineer = {
  id: 555112,
  title: "Backend Engineer",
  first_published: "2026-06-02T00:00:00.000Z",
  updated_at: "2026-06-21T00:00:00.000Z",
  location: { name: "Remote - US" },
};

// The one job a single matching posting on the stripe board produces.
async function collectOneJob() {
  stubFetch({
    [jobsUrl("stripe")]: () => jsonResponse({ jobs: [seniorProductDesigner] }),
  });
  const settings = makeSettings([{ name: "Stripe", ats_slug: "stripe" }], SEARCH_TERMS);
  const result = await greenhouseCollector.collect({ settings, limit: Infinity });
  const [posting] = result.jobs;
  return posting;
}

describe("AC 27: the company name costs no request of its own", () => {
  test("the board endpoint is never called", async () => {
    // The name rides along on every posting, so a board with many matches
    // still costs exactly one request.
    const calls = stubFetch({
      [jobsUrl("stripe")]: () =>
        jsonResponse({
          jobs: [
            seniorProductDesigner,
            { ...seniorProductDesigner, id: 555113, title: "Staff Product Designer" },
            { ...seniorProductDesigner, id: 555114, title: "Lead Product Designer" },
          ],
        }),
    });
    const settings = makeSettings([{ name: "Stripe", ats_slug: "stripe" }], SEARCH_TERMS);

    await greenhouseCollector.collect({ settings, limit: Infinity });

    expect(calls.filter((url) => url === boardUrl("stripe"))).toEqual([]);
  });

  test("the jobs endpoint is the only request the board costs", async () => {
    const calls = stubFetch({
      [jobsUrl("stripe")]: () => jsonResponse({ jobs: [seniorProductDesigner] }),
    });
    const settings = makeSettings([{ name: "Stripe", ats_slug: "stripe" }], SEARCH_TERMS);

    await greenhouseCollector.collect({ settings, limit: Infinity });

    expect(calls).toEqual([jobsUrl("stripe")]);
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

  test("resolved_url equals original_url", async () => {
    const posting = await collectOneJob();
    expect(posting.resolved_url).toBe(posting.original_url);
  });
});

describe("AC 35: a board with zero postings returns no jobs without throwing", () => {
  function run() {
    stubFetch({
      [jobsUrl("stripe")]: () => jsonResponse({ jobs: [] }),
    });
    const settings = makeSettings([{ name: "Stripe", ats_slug: "stripe" }], SEARCH_TERMS);
    return greenhouseCollector.collect({ settings, limit: Infinity });
  }

  test("the job list is empty", async () => {
    expect((await run()).jobs).toEqual([]);
  });

  test("collect resolves rather than rejecting", async () => {
    await expect(run()).resolves.toBeDefined();
  });
});

describe("AC 38: postings whose title does not match the search terms are absent", () => {
  test("only the matching posting is returned", async () => {
    stubFetch({
      [jobsUrl("stripe")]: () => jsonResponse({ jobs: [seniorProductDesigner, backendEngineer] }),
    });
    const settings = makeSettings([{ name: "Stripe", ats_slug: "stripe" }], SEARCH_TERMS);

    const result = await greenhouseCollector.collect({ settings, limit: Infinity });

    expect(result.jobs.map((posting) => posting.raw_title)).toEqual([
      "Senior Product Designer",
    ]);
  });
});

describe("AC 24: limit stops collection after that many jobs", () => {
  test("exactly one job comes back when the limit is 1", async () => {
    stubFetch({
      [jobsUrl("stripe")]: () =>
        jsonResponse({
          jobs: [
            seniorProductDesigner,
            { ...seniorProductDesigner, id: 555115, title: "Staff Product Designer" },
          ],
        }),
    });
    const settings = makeSettings([{ name: "Stripe", ats_slug: "stripe" }], SEARCH_TERMS);

    const result = await greenhouseCollector.collect({ settings, limit: 1 });

    expect(result.jobs).toHaveLength(1);
  });
});

describe("AC 48: the dates are written to their own fields", () => {
  test("posting_date is a date", async () => {
    expect((await collectOneJob()).posting_date).toBeInstanceOf(Date);
  });

  test("posting_updated_date is a date", async () => {
    expect((await collectOneJob()).posting_updated_date).toBeInstanceOf(Date);
  });

  test("the entry carries no array of undifferentiated dates", async () => {
    expect(await collectOneJob()).not.toHaveProperty("dates");
  });
});

describe("AC 28: the company name comes from the posting itself", () => {
  test("raw_company_name is the posting's own company_name", async () => {
    stubFetch({
      [jobsUrl("stripe")]: () =>
        jsonResponse({ jobs: [{ ...seniorProductDesigner, company_name: "Stripe, Inc." }] }),
    });
    const settings = makeSettings([{ name: "Stripe", ats_slug: "stripe" }], SEARCH_TERMS);

    const result = await greenhouseCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].raw_company_name).toBe("Stripe, Inc.");
  });

  test("the name stored in settings is ignored in favour of the posting's", async () => {
    stubFetch({
      [jobsUrl("stripe")]: () => jsonResponse({ jobs: [seniorProductDesigner] }),
    });
    const settings = makeSettings(
      [{ name: "Whatever Settings Says", ats_slug: "stripe" }],
      SEARCH_TERMS
    );

    const result = await greenhouseCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].raw_company_name).toBe("Stripe");
  });
});

describe("AC 46: posting_date and posting_updated_date map to separate source fields", () => {
  test("posting_date holds first_published", async () => {
    expect((await collectOneJob()).posting_date).toEqual(new Date("2026-06-01T00:00:00.000Z"));
  });

  test("posting_updated_date holds updated_at", async () => {
    expect((await collectOneJob()).posting_updated_date).toEqual(
      new Date("2026-06-20T00:00:00.000Z")
    );
  });
});

describe("a board answering 404 records a warning and lets the other slugs run", () => {
  function run() {
    stubFetch({
      [jobsUrl("acme")]: () => new Response("Not Found", { status: 404 }),
      [jobsUrl("stripe")]: () => jsonResponse({ jobs: [seniorProductDesigner] }),
    });
    const settings = makeSettings(
      [
        { name: "Acme", ats_slug: "acme" },
        { name: "Stripe", ats_slug: "stripe" },
      ],
      SEARCH_TERMS
    );
    return greenhouseCollector.collect({ settings, limit: Infinity });
  }

  test("collect resolves rather than rejecting", async () => {
    await expect(run()).resolves.toBeDefined();
  });

  test("a warning names the slug that failed", async () => {
    const result = await run();
    expect(result.warnings.some((warning) => warning.includes("acme"))).toBe(true);
  });

  test("the other slug's job still comes back", async () => {
    expect((await run()).jobs).toHaveLength(1);
  });
});

describe("AC 76: no boards configured", () => {
  test("a warning names the platform", async () => {
    stubFetch({});
    const settings = makeSettings([], SEARCH_TERMS);

    const result = await greenhouseCollector.collect({ settings, limit: Infinity });

    expect(result.warnings.some((warning) => warning.includes("greenhouse"))).toBe(true);
  });

  test("no request is made", async () => {
    const calls = stubFetch({});
    const settings = makeSettings([], SEARCH_TERMS);

    await greenhouseCollector.collect({ settings, limit: Infinity });

    expect(calls).toEqual([]);
  });
});

describe("the field mapping from a Greenhouse posting to a job list entry", () => {
  test("original_url points at the board's job page", async () => {
    expect((await collectOneJob()).original_url).toBe(
      "https://boards.greenhouse.io/stripe/jobs/555111"
    );
  });

  test("raw_title is the posting's title", async () => {
    expect((await collectOneJob()).raw_title).toBe("Senior Product Designer");
  });

  test("raw_company_name is the posting's own company_name", async () => {
    expect((await collectOneJob()).raw_company_name).toBe("Stripe");
  });

  test("AC 100: raw_company_slug holds the board slug that was polled", async () => {
    expect((await collectOneJob()).raw_company_slug).toBe("stripe");
  });

  test("raw_location_list holds the posting's location", async () => {
    expect((await collectOneJob()).raw_location_list).toEqual(["Remote - US"]);
  });

  test("raw_mode_list is empty, because Greenhouse publishes no work-mode field", async () => {
    expect((await collectOneJob()).raw_mode_list).toEqual([]);
  });
});

describe("a posting missing a location gives an empty location list", () => {
  test("raw_location_list is empty rather than holding a placeholder", async () => {
    stubFetch({
      [jobsUrl("stripe")]: () =>
        jsonResponse({
          jobs: [
            {
              id: 555117,
              title: "Senior Product Designer",
              first_published: "2026-06-03T00:00:00.000Z",
              updated_at: "2026-06-22T00:00:00.000Z",
            },
          ],
        }),
    });
    const settings = makeSettings([{ name: "Stripe", ats_slug: "stripe" }], SEARCH_TERMS);

    const result = await greenhouseCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].raw_location_list).toEqual([]);
  });
});

describe("AC 78: description holds exactly what the source sent", () => {
  test("description equals the posting's content", async () => {
    expect((await collectOneJob()).description).toBe("<p>Design beautiful products at Stripe.</p>");
  });
});

describe("AC 79: a posting with no description leaves the field unset", () => {
  test("description is undefined rather than a blank string", async () => {
    stubFetch({
      [jobsUrl("stripe")]: () =>
        jsonResponse({
          jobs: [
            {
              id: 555118,
              title: "Senior Product Designer",
              first_published: "2026-06-04T00:00:00.000Z",
              updated_at: "2026-06-23T00:00:00.000Z",
              location: { name: "Remote - US" },
            },
          ],
        }),
    });
    const settings = makeSettings([{ name: "Stripe", ats_slug: "stripe" }], SEARCH_TERMS);

    const result = await greenhouseCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].description).toBeUndefined();
  });
});

describe("AC 80: raw_salary is filled from pay_input_ranges and no column is written", () => {
  test("raw_salary holds the figures, the currency and the unit", async () => {
    expect((await collectOneJob()).raw_salary).toEqual({
      salary_min: 14000000,
      salary_max: 21000000,
      salary_currency: "USD",
      salary_unit: "cents",
    });
  });

  test("the salary columns are left for normalization to fill", async () => {
    const job = await collectOneJob();
    expect(job.salary_low).toBeUndefined();
    expect(job.salary_high).toBeUndefined();
    expect(job.salary_period).toBeUndefined();
  });
});

describe("AC 81: the cents Greenhouse sends are recorded as cents", () => {
  test("a min_cents of 14000000 is written unchanged", async () => {
    expect((await collectOneJob()).raw_salary?.salary_min).toBe(14000000);
  });

  test("a max_cents of 21000000 is written unchanged", async () => {
    expect((await collectOneJob()).raw_salary?.salary_max).toBe(21000000);
  });

  test("salary_unit records which unit the figures are in", async () => {
    // Nothing about 14000000 says whether it is cents or a large salary in
    // another currency, so the collector says which rather than dividing.
    expect((await collectOneJob()).raw_salary?.salary_unit).toBe("cents");
  });
});

describe("AC 84: a posting with no pay_input_ranges gets no raw_salary at all", () => {
  function collectWithoutSalary() {
    stubFetch({
      [jobsUrl("stripe")]: () =>
        jsonResponse({
          jobs: [
            {
              id: 555119,
              title: "Senior Product Designer",
              first_published: "2026-06-05T00:00:00.000Z",
              updated_at: "2026-06-24T00:00:00.000Z",
              location: { name: "Remote - US" },
            },
          ],
        }),
    });
    const settings = makeSettings([{ name: "Stripe", ats_slug: "stripe" }], SEARCH_TERMS);
    return greenhouseCollector.collect({ settings, limit: Infinity }).then((r) => r.jobs[0]);
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

describe("an empty pay_input_ranges array gets no raw_salary either", () => {
  test("raw_salary is undefined", async () => {
    stubFetch({
      [jobsUrl("stripe")]: () =>
        jsonResponse({
          jobs: [
            {
              id: 555120,
              title: "Senior Product Designer",
              first_published: "2026-06-06T00:00:00.000Z",
              updated_at: "2026-06-25T00:00:00.000Z",
              location: { name: "Remote - US" },
              pay_input_ranges: [],
            },
          ],
        }),
    });
    const settings = makeSettings([{ name: "Stripe", ats_slug: "stripe" }], SEARCH_TERMS);

    const result = await greenhouseCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].raw_salary).toBeUndefined();
  });
});

describe("AC 102: a work mode named in the description is left for a parser", () => {
  test("content saying the role is remote still gives an empty mode list", async () => {
    stubFetch({
      [jobsUrl("stripe")]: () =>
        jsonResponse({
          jobs: [
            {
              id: 555121,
              title: "Senior Product Designer",
              first_published: "2026-06-07T00:00:00.000Z",
              updated_at: "2026-06-26T00:00:00.000Z",
              location: { name: "Remote - US" },
              content: "This role is remote and based in the US.",
            },
          ],
        }),
    });
    const settings = makeSettings([{ name: "Stripe", ats_slug: "stripe" }], SEARCH_TERMS);

    const result = await greenhouseCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].raw_mode_list).toEqual([]);
    expect(result.jobs[0].description).toContain("remote");
  });

  test("a posting carrying no company_name leaves the name unset rather than building one", async () => {
    stubFetch({
      [jobsUrl("brightwave-labs")]: () =>
        jsonResponse({ jobs: [{ ...seniorProductDesigner, company_name: undefined }] }),
    });
    const settings = makeSettings(
      [{ name: "Ignored Settings Name", ats_slug: "brightwave-labs" }],
      SEARCH_TERMS
    );

    const result = await greenhouseCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].raw_company_name).toBeUndefined();
    expect(result.jobs[0].raw_company_slug).toBe("brightwave-labs");
    expect(result.jobs).toHaveLength(1);
  });
});

describe("AC 102: a pay range in the description is left for a parser", () => {
  test("a posting naming pay in its content still gets no raw_salary", async () => {
    stubFetch({
      [jobsUrl("stripe")]: () =>
        jsonResponse({
          jobs: [
            {
              id: 555126,
              title: "Senior Product Designer",
              first_published: "2026-06-12T00:00:00.000Z",
              updated_at: "2026-07-01T00:00:00.000Z",
              location: { name: "Remote - US" },
              content: "The pay range for this role is $120,000 - $150,000 per year.",
            },
          ],
        }),
    });
    const settings = makeSettings([{ name: "Stripe", ats_slug: "stripe" }], SEARCH_TERMS);

    const result = await greenhouseCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].raw_salary).toBeUndefined();
    expect(result.jobs[0].description).toContain("$120,000 - $150,000");
  });
});

describe("a posting carrying no description at all", () => {
  test("the salary and the mode are left empty and nothing throws", async () => {
    stubFetch({
      [jobsUrl("stripe")]: () =>
        jsonResponse({
          jobs: [
            {
              id: 555125,
              title: "Senior Product Designer",
              first_published: "2026-06-11T00:00:00.000Z",
              updated_at: "2026-06-30T00:00:00.000Z",
              location: { name: "Remote - US" },
            },
          ],
        }),
    });
    const settings = makeSettings([{ name: "Stripe", ats_slug: "stripe" }], SEARCH_TERMS);

    const result = await greenhouseCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].raw_mode_list).toEqual([]);
    expect(result.jobs[0].salary_low).toBeUndefined();
    expect(result.jobs[0].salary_period).toBeUndefined();
  });
});
