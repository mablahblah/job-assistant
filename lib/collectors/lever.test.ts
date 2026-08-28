import { afterEach, describe, expect, test } from "vitest";
import { leverCollector } from "./lever";
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

function htmlResponse(html: string): Response {
  return new Response(html);
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

const postingsUrl = (slug: string) => `https://api.lever.co/v0/postings/${slug}?mode=json`;
const boardPageUrl = (slug: string) => `https://jobs.lever.co/${slug}`;

const SEARCH_TERMS = ["Product Design"];

const HIGHLEVEL_BOARD_HTML =
  '<html><head><title data-rh="true">HighLevel Jobs</title></head><body></body></html>';

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
    [boardPageUrl("gohighlevel")]: () => htmlResponse(HIGHLEVEL_BOARD_HTML),
  });
  const settings = makeSettings([{ name: "HighLevel", ats_slug: "gohighlevel" }], SEARCH_TERMS);
  const result = await leverCollector.collect({ settings, limit: Infinity });
  const [posting] = result.jobs;
  return posting;
}

describe("AC 27: the company name is fetched once no matter how many postings match", () => {
  test("the board page is requested exactly once", async () => {
    const calls = stubFetch({
      [postingsUrl("gohighlevel")]: () =>
        jsonResponse([
          seniorProductDesigner,
          { ...seniorProductDesigner, id: "post-abc125", text: "Staff Product Designer" },
          { ...seniorProductDesigner, id: "post-abc126", text: "Lead Product Designer" },
        ]),
      [boardPageUrl("gohighlevel")]: () => htmlResponse(HIGHLEVEL_BOARD_HTML),
    });
    const settings = makeSettings([{ name: "HighLevel", ats_slug: "gohighlevel" }], SEARCH_TERMS);

    await leverCollector.collect({ settings, limit: Infinity });

    expect(calls.filter((url) => url === boardPageUrl("gohighlevel"))).toHaveLength(1);
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
      [postingsUrl("gohighlevel")]: () => jsonResponse([]),
      [boardPageUrl("gohighlevel")]: () => htmlResponse(HIGHLEVEL_BOARD_HTML),
    });
    const settings = makeSettings([{ name: "HighLevel", ats_slug: "gohighlevel" }], SEARCH_TERMS);
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
      [boardPageUrl("gohighlevel")]: () => htmlResponse(HIGHLEVEL_BOARD_HTML),
    });
    const settings = makeSettings([{ name: "HighLevel", ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs.map((posting) => posting.original_title)).toEqual([
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
      [boardPageUrl("gohighlevel")]: () => htmlResponse(HIGHLEVEL_BOARD_HTML),
    });
    const settings = makeSettings([{ name: "HighLevel", ats_slug: "gohighlevel" }], SEARCH_TERMS);

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
      [boardPageUrl("gohighlevel")]: () => htmlResponse(HIGHLEVEL_BOARD_HTML),
    });
    const settings = makeSettings([{ name: "HighLevel", ats_slug: "gohighlevel" }], SEARCH_TERMS);

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

describe("AC 29: the company name is the board title stripped of its decoration", () => {
  test("a board titled 'Hinge Health Jobs' gives the name 'Hinge Health'", async () => {
    stubFetch({
      [postingsUrl("hinge-health")]: () => jsonResponse([seniorProductDesigner]),
      [boardPageUrl("hinge-health")]: () =>
        htmlResponse("<html><head><title>Hinge Health Jobs</title></head></html>"),
    });
    const settings = makeSettings(
      [{ name: "Hinge Health", ats_slug: "hinge-health" }],
      SEARCH_TERMS
    );

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].company_name).toBe("Hinge Health");
  });
});

describe("a board answering 404 records a warning and lets the other slugs run", () => {
  function run() {
    stubFetch({
      [postingsUrl("acme")]: () => new Response("Not Found", { status: 404 }),
      [postingsUrl("gohighlevel")]: () => jsonResponse([seniorProductDesigner]),
      [boardPageUrl("gohighlevel")]: () => htmlResponse(HIGHLEVEL_BOARD_HTML),
    });
    const settings = makeSettings(
      [
        { name: "Acme", ats_slug: "acme" },
        { name: "HighLevel", ats_slug: "gohighlevel" },
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

describe("a slug whose name lookup fails still yields its jobs", () => {
  test("company_name is built from the slug rather than left empty", async () => {
    // No stub is set for the board page, so the lookup fails and the shared
    // resolver falls back to a name built from the slug.
    stubFetch({
      [postingsUrl("brightwave-labs")]: () => jsonResponse([seniorProductDesigner]),
    });
    const settings = makeSettings(
      [{ name: "Ignored Settings Name", ats_slug: "brightwave-labs" }],
      SEARCH_TERMS
    );

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].company_name).toBe("Brightwave Labs");
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

  test("original_title is the posting's text", async () => {
    expect((await collectOneJob()).original_title).toBe("Senior Product Designer");
  });

  test("company_name is the resolved employer name", async () => {
    expect((await collectOneJob()).company_name).toBe("HighLevel");
  });

  test("posting_date is createdAt", async () => {
    expect((await collectOneJob()).posting_date).toEqual(new Date(1780000000000));
  });

  test("original_location_list holds the posting's location", async () => {
    expect((await collectOneJob()).original_location_list).toEqual(["Remote - US"]);
  });

  test("original_mode_list holds the workplaceType", async () => {
    expect((await collectOneJob()).original_mode_list).toEqual(["remote"]);
  });
});

describe("a posting missing a location gives an empty location list", () => {
  test("original_location_list is empty rather than holding a placeholder", async () => {
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
      [boardPageUrl("gohighlevel")]: () => htmlResponse(HIGHLEVEL_BOARD_HTML),
    });
    const settings = makeSettings([{ name: "HighLevel", ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].original_location_list).toEqual([]);
  });
});

describe("a posting missing workplaceType gives an empty mode list", () => {
  test("original_mode_list is empty rather than holding a placeholder", async () => {
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
      [boardPageUrl("gohighlevel")]: () => htmlResponse(HIGHLEVEL_BOARD_HTML),
    });
    const settings = makeSettings([{ name: "HighLevel", ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].original_mode_list).toEqual([]);
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
      [boardPageUrl("gohighlevel")]: () => htmlResponse(HIGHLEVEL_BOARD_HTML),
    });
    const settings = makeSettings([{ name: "HighLevel", ats_slug: "gohighlevel" }], SEARCH_TERMS);

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
      [boardPageUrl("gohighlevel")]: () => htmlResponse(HIGHLEVEL_BOARD_HTML),
    });
    const settings = makeSettings([{ name: "HighLevel", ats_slug: "gohighlevel" }], SEARCH_TERMS);

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
      [boardPageUrl("gohighlevel")]: () => htmlResponse(HIGHLEVEL_BOARD_HTML),
    });
    const settings = makeSettings([{ name: "HighLevel", ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].description).toBe("<p>HTML only version.</p>");
  });
});

describe("Lever publishes no salary field, so all four stay unset", () => {
  test("salary_low is undefined", async () => {
    expect((await collectOneJob()).salary_low).toBeUndefined();
  });

  test("salary_high is undefined", async () => {
    expect((await collectOneJob()).salary_high).toBeUndefined();
  });

  test("salary_period is undefined", async () => {
    expect((await collectOneJob()).salary_period).toBeUndefined();
  });

  test("salary_raw is undefined", async () => {
    expect((await collectOneJob()).salary_raw).toBeUndefined();
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
      [boardPageUrl("gohighlevel")]: () => htmlResponse(HIGHLEVEL_BOARD_HTML),
    });
    const settings = makeSettings([{ name: "HighLevel", ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].original_mode_list).toEqual(["remote"]);
  });
});

describe("AC 92: a posting publishing no workplaceType reads a mode out of the description", () => {
  test("a description naming a hybrid role fills the mode", async () => {
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
      [boardPageUrl("gohighlevel")]: () => htmlResponse(HIGHLEVEL_BOARD_HTML),
    });
    const settings = makeSettings([{ name: "HighLevel", ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].original_mode_list).toEqual(["hybrid"]);
  });
});

describe("AC 86: Lever publishes no salary, so the description is where pay comes from", () => {
  test("a pay range in the description fills the low, the high and the period", async () => {
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
      [boardPageUrl("gohighlevel")]: () => htmlResponse(HIGHLEVEL_BOARD_HTML),
    });
    const settings = makeSettings([{ name: "HighLevel", ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].salary_low).toBe(120000);
    expect(result.jobs[0].salary_high).toBe(150000);
    expect(result.jobs[0].salary_period).toBe("year");
  });
});

describe("AC 88: a description naming no pay leaves every salary field empty", () => {
  test("nothing is filled in and nothing is guessed", async () => {
    stubFetch({
      [postingsUrl("gohighlevel")]: () =>
        jsonResponse([
          {
            id: "post-nopay",
            text: "Senior Product Designer",
            createdAt: 1780001100000,
            categories: { location: "Remote - US" },
            descriptionPlain: "Design beautiful products at HighLevel.",
          },
        ]),
      [boardPageUrl("gohighlevel")]: () => htmlResponse(HIGHLEVEL_BOARD_HTML),
    });
    const settings = makeSettings([{ name: "HighLevel", ats_slug: "gohighlevel" }], SEARCH_TERMS);

    const result = await leverCollector.collect({ settings, limit: Infinity });

    expect(result.jobs[0].salary_low).toBeUndefined();
    expect(result.jobs[0].salary_high).toBeUndefined();
    expect(result.jobs[0].salary_period).toBeUndefined();
    expect(result.jobs[0].salary_raw).toBeUndefined();
  });
});
