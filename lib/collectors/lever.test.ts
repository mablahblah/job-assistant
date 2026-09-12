import { afterEach, describe, expect, test, vi } from "vitest";
import { leverCollector } from "./lever";
import { jobFieldsFromLeverPosting } from "../lever-fields";

// The shared mapper is wrapped in a spy that still runs the real thing, so
// every test below reads the same fields it always did while one test can
// also check the collector went through the mapper rather than a copy of it.
vi.mock("../lever-fields", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lever-fields")>();
  return { ...actual, jobFieldsFromLeverPosting: vi.fn(actual.jobFieldsFromLeverPosting) };
});
import type { AtsCompany, SettingsService } from "../settings-service";
import { fakeSettingsService } from "../settings-service.fake";

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
  return fakeSettingsService({
    getSearchTerms: async () => searchTerms,
    getAtsCompanies: async () => boards,
  });
}

const postingsUrl = (slug: string) => `https://api.lever.co/v0/postings/${slug}?mode=json`;

const SEARCH_TERMS = ["Product Design"];

// A title genuinely matching "Product Design" once it is stemmed.
const seniorProductDesigner = {
  id: "post-abc123",
  text: "Senior Product Designer",
  createdAt: 1780000000000,
  categories: { location: "Remote - US", team: "Design" },
  workplaceType: "remote",
  descriptionPlain: "Design beautiful products at HighLevel.",
  description: "<p>Design beautiful products at HighLevel.</p>",
};

const backendEngineer = {
  id: "post-abc124",
  text: "Backend Engineer",
  createdAt: 1780000100000,
  categories: { location: "Remote - US", team: "Engineering" },
  workplaceType: "remote",
};

// The one job a single matching posting on the gohighlevel board produces.
async function collectOneJob() {
  stubFetch({
    [postingsUrl("gohighlevel")]: () => jsonResponse([seniorProductDesigner]),
  });
  const settings = makeSettings([{ ats_slug: "gohighlevel" }], SEARCH_TERMS);
  const result = await leverCollector.collect({ settings, limit: Infinity });
  const [posting] = result.jobs;
  return posting;
}

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
      [postingsUrl("gohighlevel")]: () => jsonResponse([]),
    });
    const settings = makeSettings([{ ats_slug: "gohighlevel" }], SEARCH_TERMS);
    return leverCollector.collect({ settings, limit: Infinity });
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
      [postingsUrl("gohighlevel")]: () => jsonResponse([seniorProductDesigner, backendEngineer]),
    });
    const settings = makeSettings([{ ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs.map((posting) => posting.raw_title)).toEqual([
      "Senior Product Designer",
    ]);
  });
});

describe("AC 39: a posting is filtered on its title alone, never its team", () => {
  test("a posting whose team matches but whose title does not is dropped", async () => {
    stubFetch({
      [postingsUrl("gohighlevel")]: () =>
        jsonResponse([
          {
            id: "post-team-match",
            text: "Backend Engineer",
            createdAt: 1780000200000,
            categories: { location: "Remote - US", team: "Product Design" },
          },
        ]),
    });
    const settings = makeSettings([{ ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs).toEqual([]);
  });
});

describe("AC 24: limit stops collection after that many jobs", () => {
  test("exactly one job comes back when the limit is 1", async () => {
    stubFetch({
      [postingsUrl("gohighlevel")]: () =>
        jsonResponse([
          seniorProductDesigner,
          { ...seniorProductDesigner, id: "post-abc127", text: "Staff Product Designer" },
        ]),
    });
    const settings = makeSettings([{ ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: 1 });

    expect(result.jobs).toHaveLength(1);
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

describe("AC 47: posting_updated_date is left unset", () => {
  test("posting_updated_date is undefined, because Lever publishes one date", async () => {
    expect((await collectOneJob()).posting_updated_date).toBeUndefined();
  });
});

describe("a board answering 404 records a warning and lets the other slugs run", () => {
  function run() {
    stubFetch({
      [postingsUrl("acme")]: () => new Response("Not Found", { status: 404 }),
      [postingsUrl("gohighlevel")]: () => jsonResponse([seniorProductDesigner]),
    });
    const settings = makeSettings(
      [
        { ats_slug: "acme" },
        { ats_slug: "gohighlevel" },
      ],
      SEARCH_TERMS
    );
    return leverCollector.collect({ settings, limit: Infinity });
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

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.warnings.some((warning) => warning.includes("lever"))).toBe(true);
  });

  test("no request is made", async () => {
    const calls = stubFetch({});
    const settings = makeSettings([], SEARCH_TERMS);

    await leverCollector.collect({ settings, limit: Infinity });

    expect(calls).toEqual([]);
  });
});

describe("the field mapping from a Lever posting to a job list entry", () => {
  test("original_url points at the posting's page", async () => {
    expect((await collectOneJob()).original_url).toBe(
      "https://jobs.lever.co/gohighlevel/post-abc123"
    );
  });

  test("raw_title is the posting's text", async () => {
    expect((await collectOneJob()).raw_title).toBe("Senior Product Designer");
  });

  test("raw_company_name is unset, because Lever's API carries no employer name", async () => {
    expect((await collectOneJob()).raw_company_name).toBeUndefined();
  });

  test("AC 100: raw_company_slug holds the board slug that was polled", async () => {
    expect((await collectOneJob()).raw_company_slug).toBe("gohighlevel");
  });

  test("posting_date is createdAt", async () => {
    expect((await collectOneJob()).posting_date).toEqual(new Date(1780000000000));
  });

  test("raw_location_list holds the posting's location", async () => {
    expect((await collectOneJob()).raw_location_list).toEqual(["Remote - US"]);
  });

  test("raw_mode_list holds the workplaceType", async () => {
    expect((await collectOneJob()).raw_mode_list).toEqual(["remote"]);
  });
});

describe("a posting missing a location gives an empty location list", () => {
  test("raw_location_list is empty rather than holding a placeholder", async () => {
    stubFetch({
      [postingsUrl("gohighlevel")]: () =>
        jsonResponse([
          {
            id: "post-noloc",
            text: "Senior Product Designer",
            createdAt: 1780000300000,
            categories: {},
          },
        ]),
    });
    const settings = makeSettings([{ ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].raw_location_list).toEqual([]);
  });
});

describe("a posting missing workplaceType gives an empty mode list", () => {
  test("raw_mode_list is empty rather than holding a placeholder", async () => {
    stubFetch({
      [postingsUrl("gohighlevel")]: () =>
        jsonResponse([
          {
            id: "post-nomode",
            text: "Senior Product Designer",
            createdAt: 1780000400000,
            categories: { location: "Remote - US" },
          },
        ]),
    });
    const settings = makeSettings([{ ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].raw_mode_list).toEqual([]);
  });
});

describe("AC 78: description holds exactly what the source sent", () => {
  test("description equals descriptionPlain", async () => {
    expect((await collectOneJob()).description).toBe("Design beautiful products at HighLevel.");
  });
});

describe("AC 79: a posting with no description leaves the field unset", () => {
  test("description is undefined rather than a blank string", async () => {
    stubFetch({
      [postingsUrl("gohighlevel")]: () =>
        jsonResponse([
          {
            id: "post-nodesc",
            text: "Senior Product Designer",
            createdAt: 1780000500000,
            categories: { location: "Remote - US" },
          },
        ]),
    });
    const settings = makeSettings([{ ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].description).toBeUndefined();
  });
});

describe("descriptionPlain wins when both descriptions are present", () => {
  test("description is the plain text, not the HTML", async () => {
    stubFetch({
      [postingsUrl("gohighlevel")]: () =>
        jsonResponse([
          {
            id: "post-both",
            text: "Senior Product Designer",
            createdAt: 1780000600000,
            categories: { location: "Remote - US" },
            descriptionPlain: "Plain version.",
            description: "<p>HTML version.</p>",
          },
        ]),
    });
    const settings = makeSettings([{ ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].description).toBe("Plain version.");
  });
});

describe("description is used when descriptionPlain is absent", () => {
  test("description is the HTML field", async () => {
    stubFetch({
      [postingsUrl("gohighlevel")]: () =>
        jsonResponse([
          {
            id: "post-htmlonly",
            text: "Senior Product Designer",
            createdAt: 1780000700000,
            categories: { location: "Remote - US" },
            description: "<p>HTML only version.</p>",
          },
        ]),
    });
    const settings = makeSettings([{ ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].description).toBe("<p>HTML only version.</p>");
  });
});

describe("AC 84: Lever publishes no salary, so nothing salary-shaped is written", () => {
  test("raw_salary is absent rather than an empty envelope", async () => {
    expect((await collectOneJob()).raw_salary).toBeUndefined();
  });

  test("the salary columns are left unset", async () => {
    const job = await collectOneJob();
    expect(job.salary_low).toBeUndefined();
    expect(job.salary_high).toBeUndefined();
    expect(job.salary_period).toBeUndefined();
  });
});

describe("AC 102: a pay range in the description is left for a parser", () => {
  test("a posting naming pay in its text still gets no raw_salary", async () => {
    stubFetch({
      [postingsUrl("gohighlevel")]: () =>
        jsonResponse([
          {
            id: "post-salary",
            text: "Senior Product Designer",
            createdAt: 1780001000000,
            categories: { location: "Remote - US" },
            descriptionPlain: "The pay range for this role is $120,000 - $150,000 per year.",
          },
        ]),
    });
    const settings = makeSettings([{ ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].raw_salary).toBeUndefined();
    expect(result.jobs[0].description).toContain("$120,000 - $150,000");
  });
});

describe("AC 93: a published workplaceType wins over a mode named in the description", () => {
  test("the published value lands even where the description names another", async () => {
    stubFetch({
      [postingsUrl("gohighlevel")]: () =>
        jsonResponse([
          {
            id: "post-modewins",
            text: "Senior Product Designer",
            createdAt: 1780000800000,
            categories: { location: "Remote - US" },
            workplaceType: "remote",
            descriptionPlain: "This is a hybrid role.",
          },
        ]),
    });
    const settings = makeSettings([{ ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].raw_mode_list).toEqual(["remote"]);
  });
});

describe("AC 101: no request is made to a board page to find an employer name", () => {
  test("the postings endpoint is the only request a board costs", async () => {
    const calls = stubFetch({
      [postingsUrl("gohighlevel")]: () =>
        jsonResponse([
          seniorProductDesigner,
          { ...seniorProductDesigner, id: "post-abc125", text: "Staff Product Designer" },
        ]),
    });
    const settings = makeSettings([{ ats_slug: "gohighlevel" }], SEARCH_TERMS);

    await leverCollector.collect({ settings, limit: Infinity });

    expect(calls).toEqual([postingsUrl("gohighlevel")]);
  });

  test("the name stored in settings is not written to the job either", async () => {
    stubFetch({ [postingsUrl("gohighlevel")]: () => jsonResponse([seniorProductDesigner]) });
    const settings = makeSettings([{ ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].raw_company_name).toBeUndefined();
  });
});

describe("AC 102: a work mode named only in the description is left for a parser", () => {
  test("a posting with no workplaceType gets an empty mode list, description or not", async () => {
    stubFetch({
      [postingsUrl("gohighlevel")]: () =>
        jsonResponse([
          {
            id: "post-hybrid",
            text: "Senior Product Designer",
            createdAt: 1780000900000,
            categories: { location: "Remote - US" },
            descriptionPlain: "This is a hybrid role.",
          },
        ]),
    });
    const settings = makeSettings([{ ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].raw_mode_list).toEqual([]);
    expect(result.jobs[0].description).toContain("hybrid");
  });

  test("onsite is stored as Lever published it, not mapped to another word", async () => {
    stubFetch({
      [postingsUrl("gohighlevel")]: () =>
        jsonResponse([{ ...seniorProductDesigner, workplaceType: "onsite" }]),
    });
    const settings = makeSettings([{ ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].raw_mode_list).toEqual(["onsite"]);
  });
});

describe("AC 10: the collector and the parser read a posting through one shared mapper", () => {
  test("the collector's fields come from jobFieldsFromLeverPosting, not a second copy of it", async () => {
    const job = await collectOneJob();

    expect(jobFieldsFromLeverPosting).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Senior Product Designer" }),
      "gohighlevel"
    );
    // The mapper's answer is what reached the entry, so the two cannot drift.
    expect(job).toMatchObject(
      vi.mocked(jobFieldsFromLeverPosting).mock.results[0].value as object
    );
  });
});
