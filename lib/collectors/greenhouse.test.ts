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

describe("AC 32: a returned job is resolved, parsed, and not yet classified", () => {
  test("is_resolved is true", async () => {
    expect((await collectOneJob()).is_resolved).toBe(true);
  });

  test("is_parsed is true", async () => {
    expect((await collectOneJob()).is_parsed).toBe(true);
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

    expect(result.jobs.map((posting) => posting.original_title)).toEqual([
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
  test("company_name is the posting's own company_name", async () => {
    stubFetch({
      [jobsUrl("stripe")]: () =>
        jsonResponse({ jobs: [{ ...seniorProductDesigner, company_name: "Stripe, Inc." }] }),
    });
    const settings = makeSettings([{ name: "Stripe", ats_slug: "stripe" }], SEARCH_TERMS);

    const result = await greenhouseCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].company_name).toBe("Stripe, Inc.");
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

    expect(result.jobs[0].company_name).toBe("Stripe");
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

describe("AC 31: a posting carrying no company_name falls back to the slug", () => {
  function collectFromNamelessBoard() {
    const nameless = { ...seniorProductDesigner, company_name: undefined };
    stubFetch({
      [jobsUrl("brightwave-labs")]: () => jsonResponse({ jobs: [nameless] }),
    });
    const settings = makeSettings(
      [{ name: "Ignored Settings Name", ats_slug: "brightwave-labs" }],
      SEARCH_TERMS
    );
    return greenhouseCollector.collect({ settings, limit: Infinity });
  }

  test("company_name is built from the slug rather than left empty", async () => {
    expect((await collectFromNamelessBoard()).jobs[0].company_name).toBe("Brightwave Labs");
  });

  test("a warning names the slug", async () => {
    const result = await collectFromNamelessBoard();
    expect(result.warnings.some((warning) => warning.includes("brightwave-labs"))).toBe(true);
  });

  test("the posting still comes back", async () => {
    expect((await collectFromNamelessBoard()).jobs).toHaveLength(1);
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

  test("original_title is the posting's title", async () => {
    expect((await collectOneJob()).original_title).toBe("Senior Product Designer");
  });

  test("company_name is the resolved employer name", async () => {
    expect((await collectOneJob()).company_name).toBe("Stripe");
  });

  test("original_location_list holds the posting's location", async () => {
    expect((await collectOneJob()).original_location_list).toEqual(["Remote - US"]);
  });

  test("original_mode_list is always empty", async () => {
    // Greenhouse has no structured work-mode field, and reading one out of the
    // description text is a parser's job.
    expect((await collectOneJob()).original_mode_list).toEqual([]);
  });
});

describe("a posting missing a location gives an empty location list", () => {
  test("original_location_list is empty rather than holding a placeholder", async () => {
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

    expect(result.jobs[0].original_location_list).toEqual([]);
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

describe("AC 80: the salary fields are filled from pay_input_ranges", () => {
  test("salary_low is filled", async () => {
    expect((await collectOneJob()).salary_low).toBeDefined();
  });

  test("salary_high is filled", async () => {
    expect((await collectOneJob()).salary_high).toBeDefined();
  });

  test("salary_period is filled", async () => {
    expect((await collectOneJob()).salary_period).toBeDefined();
  });

  test("salary_raw holds the source's figures", async () => {
    expect((await collectOneJob()).salary_raw).toContain("140000-210000");
  });

  test("the currency reaches salary_raw", async () => {
    expect((await collectOneJob()).salary_raw).toContain("USD");
  });
});

describe("AC 81: the cents Greenhouse sends become dollars", () => {
  test("a min_cents of 14000000 becomes a salary_low of 140000", async () => {
    expect((await collectOneJob()).salary_low).toBe(140000);
  });

  test("salary_low is not left as the raw cents figure", async () => {
    expect((await collectOneJob()).salary_low).not.toBe(14000000);
  });

  test("a max_cents of 21000000 becomes a salary_high of 210000", async () => {
    expect((await collectOneJob()).salary_high).toBe(210000);
  });
});

describe("AC 82: salary_period is year, since Greenhouse states no period", () => {
  test("salary_period is year", async () => {
    expect((await collectOneJob()).salary_period).toBe("year");
  });
});

describe("AC 84: a posting with no pay_input_ranges leaves the salary fields unset", () => {
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

describe("an empty pay_input_ranges array leaves the salary fields unset", () => {
  test("salary_low is undefined", async () => {
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

    expect(result.jobs[0].salary_low).toBeUndefined();
  });
});
