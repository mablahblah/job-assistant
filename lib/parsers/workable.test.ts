import { afterEach, describe, expect, test } from "vitest";
import { workableParser } from "./workable";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const POSTING_URL = "https://apply.workable.com/api/v2/accounts/blueground/jobs/08717EF2F6";
const WIDGET_URL = "https://apply.workable.com/api/v1/widget/accounts/blueground";

// Shaped like the posting and the board widget Workable's company site
// answered for the blueground board on 2026-09-24. Only the widget names the
// employer; only the posting carries the description.
function posting(description: string) {
  return {
    id: 6083341,
    shortcode: "08717EF2F6",
    title: "Senior Product Designer & Builder",
    location: { country: "Greece", region: "Attica", city: "Athens", display: "Athens, Greece" },
    published: "2026-09-10T00:00:00.000Z",
    description,
    requirements: "",
    benefits: "",
  };
}

const WIDGET = { name: "Blueground", description: "", jobs: [] };

// Answers per-url from a small map the test builds, recording every call. An
// address it does not hold answers 404.
function stubFetch(routes: Record<string, () => Response>): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    const respond = routes[url];
    if (respond === undefined) {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
    }
    return respond();
  }) as unknown as typeof globalThis.fetch;
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

const bothFound = (description = "<p>Redefine how people live.</p>") => ({
  [POSTING_URL]: () => jsonResponse(posting(description)),
  [WIDGET_URL]: () => jsonResponse(WIDGET),
});

describe("workableParser: a company-site posting is read", () => {
  test("the posting is asked for by the board and the code in its link", async () => {
    const calls = stubFetch(bothFound());

    await workableParser.parse({ url: "https://apply.workable.com/blueground/j/08717EF2F6" });

    expect(calls).toContain(POSTING_URL);
  });

  test("a link ending in a slash is read the same way", async () => {
    stubFetch(bothFound());

    const fields = await workableParser.parse({
      url: "https://apply.workable.com/blueground/j/08717EF2F6/",
    });

    expect(fields.description).toContain("Redefine how people live.");
  });

  test("the posting fills the description, the location and the board name", async () => {
    stubFetch(bothFound());

    const fields = await workableParser.parse({
      url: "https://apply.workable.com/blueground/j/08717EF2F6",
    });

    expect(fields.description).toContain("Redefine how people live.");
    expect(fields.raw_location_list).toEqual(["Athens, Greece"]);
    expect(fields.raw_company_slug).toBe("blueground");
  });

  test("the employer's name is read off the board", async () => {
    stubFetch(bothFound());

    const fields = await workableParser.parse({
      url: "https://apply.workable.com/blueground/j/08717EF2F6",
    });

    expect(fields.raw_company_name).toBe("Blueground");
  });

  test("a board that cannot be read costs only the name", async () => {
    stubFetch({ [POSTING_URL]: () => jsonResponse(posting("<p>Redefine how people live.</p>")) });

    const fields = await workableParser.parse({
      url: "https://apply.workable.com/blueground/j/08717EF2F6",
    });

    expect(fields.description).toContain("Redefine how people live.");
    expect(fields.raw_company_name).toBeUndefined();
  });

  test("a description stating pay and a mode fills both", async () => {
    stubFetch(
      bothFound(
        "<p>The range for this role is $120,000 - $150,000 per year.</p><p>This role is remote.</p>"
      )
    );

    const fields = await workableParser.parse({
      url: "https://apply.workable.com/blueground/j/08717EF2F6",
    });

    expect(fields.raw_salary).toMatchObject({ salary_min: 120000, salary_max: 150000 });
    expect(fields.raw_mode_list).toEqual(["remote"]);
  });
});

describe("workableParser: a company-site posting that cannot be read throws", () => {
  test("a closed posting throws, leaving the job where it was", async () => {
    stubFetch({ [WIDGET_URL]: () => jsonResponse(WIDGET) });

    await expect(
      workableParser.parse({ url: "https://apply.workable.com/blueground/j/08717EF2F6" })
    ).rejects.toThrow();
  });

  test("the link Workable sends a closed posting to throws", async () => {
    // It names only the board, with a flag saying the posting was not found,
    // and carries no posting code at all (two stored on 2026-09-24).
    stubFetch({});

    await expect(
      workableParser.parse({ url: "https://apply.workable.com/blueground/?not_found=true" })
    ).rejects.toThrow();
  });
});

// Shaped like one job Workable's job search site answered on 2026-09-24. The
// job names its employer and the employer's website, but never a board.
const SEARCH_JOB_URL = "https://jobs.workable.com/api/v1/jobs/tyaZq6jybgHCVRBowKxp43";
const SEARCH_SITE_LINK =
  "https://jobs.workable.com/view/tyaZq6jybgHCVRBowKxp43/senior-product-designer-growth-in-manila";

function searchJob(employer: string, website?: string) {
  return {
    company: { id: "c1", title: employer, description: "", website },
    created: "2026-08-30T10:59:09.401Z",
    description: "<p>Own the growth experiments.</p>",
    requirementsSection: "<p>Five years of product design.</p>",
    benefitsSection: "",
    id: "tyaZq6jybgHCVRBowKxp43",
    location: { city: "Manila", countryName: "Philippines", subregion: null },
    state: "published",
    title: "Senior Product Designer, Growth",
    workplace: "remote",
  };
}

const widgetUrl = (board: string) => `https://apply.workable.com/api/v1/widget/accounts/${board}`;
const BOARD_WITH_JOBS = { name: "Manila Recruitment", description: "", jobs: [{ title: "A role", shortcode: "AB12" }] };
const EMPTY_BOARD = { name: "Manila Recruitment", description: "", jobs: [] };

// The board names tried, in the order they were asked for.
const triedBoards = (calls: string[]) =>
  calls
    .filter((url) => url.startsWith("https://apply.workable.com/api/v1/widget/accounts/"))
    .map((url) => url.slice("https://apply.workable.com/api/v1/widget/accounts/".length));

describe("workableParser: a job on Workable's job search site is read", () => {
  test("the job is asked for by the identifier in its link", async () => {
    const calls = stubFetch({ [SEARCH_JOB_URL]: () => jsonResponse(searchJob("Manila Recruitment")) });

    await workableParser.parse({ url: SEARCH_SITE_LINK });

    expect(calls).toContain(SEARCH_JOB_URL);
  });

  test("the job fills its description and its employer's name", async () => {
    stubFetch({ [SEARCH_JOB_URL]: () => jsonResponse(searchJob("Manila Recruitment")) });

    const fields = await workableParser.parse({ url: SEARCH_SITE_LINK });

    expect(fields.description).toContain("Own the growth experiments.");
    expect(fields.raw_company_name).toBe("Manila Recruitment");
  });

  test("tracking values in the link do not stop it being read", async () => {
    stubFetch({ [SEARCH_JOB_URL]: () => jsonResponse(searchJob("Manila Recruitment")) });

    const fields = await workableParser.parse({ url: `${SEARCH_SITE_LINK}?utm_source=adzuna` });

    expect(fields.description).toContain("Own the growth experiments.");
  });

  test("a job with no workplace, whose description states pay and a mode, fills both", async () => {
    stubFetch({
      [SEARCH_JOB_URL]: () =>
        jsonResponse({
          ...searchJob("Manila Recruitment"),
          description:
            "<p>The range for this role is $120,000 - $150,000 per year.</p><p>This role is remote.</p>",
          workplace: undefined,
        }),
    });

    const fields = await workableParser.parse({ url: SEARCH_SITE_LINK });

    expect(fields.raw_salary).toMatchObject({ salary_min: 120000, salary_max: 150000 });
    expect(fields.raw_mode_list).toEqual(["remote"]);
  });

  test("a closed job throws, leaving the job where it was", async () => {
    stubFetch({ [SEARCH_JOB_URL]: () => jsonResponse({ error: "gone" }, 410) });

    await expect(workableParser.parse({ url: SEARCH_SITE_LINK })).rejects.toThrow();
  });
});

describe("workableParser: a search-site job's board is guessed and checked", () => {
  test("the name with dashes is tried first, then without, then the website's name", async () => {
    const calls = stubFetch({
      [SEARCH_JOB_URL]: () => jsonResponse(searchJob("Pet Lab Co.", "https://thepetlabco.com")),
    });

    await workableParser.parse({ url: SEARCH_SITE_LINK });

    expect(triedBoards(calls)).toEqual(["pet-lab-co", "petlabco", "thepetlabco"]);
  });

  test("the first board listing a job is kept as the board name", async () => {
    stubFetch({
      [SEARCH_JOB_URL]: () => jsonResponse(searchJob("Manila Recruitment", "http://manilarecruitment.com")),
      [widgetUrl("manila-recruitment")]: () => jsonResponse(EMPTY_BOARD),
      [widgetUrl("manilarecruitment")]: () => jsonResponse(BOARD_WITH_JOBS),
    });

    const fields = await workableParser.parse({ url: SEARCH_SITE_LINK });

    expect(fields.raw_company_slug).toBe("manilarecruitment");
  });

  test("a guess that finds a board stops the guessing", async () => {
    const calls = stubFetch({
      [SEARCH_JOB_URL]: () => jsonResponse(searchJob("Manila Recruitment", "https://www.manila.ph")),
      [widgetUrl("manila-recruitment")]: () => jsonResponse(BOARD_WITH_JOBS),
    });

    const fields = await workableParser.parse({ url: SEARCH_SITE_LINK });

    expect(fields.raw_company_slug).toBe("manila-recruitment");
    expect(triedBoards(calls)).toEqual(["manila-recruitment"]);
  });

  test("a spelling that repeats an earlier guess is not tried twice", async () => {
    const calls = stubFetch({
      [SEARCH_JOB_URL]: () => jsonResponse(searchJob("IBMC", "https://www.ibmc.com")),
      [widgetUrl("ibmc")]: () => jsonResponse(EMPTY_BOARD),
    });

    await workableParser.parse({ url: SEARCH_SITE_LINK });

    expect(triedBoards(calls)).toEqual(["ibmc"]);
  });

  test("a board listing no jobs is not kept", async () => {
    stubFetch({
      [SEARCH_JOB_URL]: () => jsonResponse(searchJob("IBMC", "https://www.ibmc.com")),
      [widgetUrl("ibmc")]: () => jsonResponse(EMPTY_BOARD),
    });

    const fields = await workableParser.parse({ url: SEARCH_SITE_LINK });

    expect(fields.raw_company_slug).toBeUndefined();
    expect(fields.description).toContain("Own the growth experiments.");
  });

  test("a board that cannot be reached costs only the board name", async () => {
    stubFetch({
      [SEARCH_JOB_URL]: () => jsonResponse(searchJob("Manila Recruitment")),
      [widgetUrl("manila-recruitment")]: () => {
        throw new Error("network down");
      },
      [widgetUrl("manilarecruitment")]: () => jsonResponse(BOARD_WITH_JOBS),
    });

    const fields = await workableParser.parse({ url: SEARCH_SITE_LINK });

    expect(fields.raw_company_slug).toBe("manilarecruitment");
    expect(fields.raw_company_name).toBe("Manila Recruitment");
  });

  test("a job naming no website guesses only from the employer's name", async () => {
    const calls = stubFetch({ [SEARCH_JOB_URL]: () => jsonResponse(searchJob("Manila Recruitment")) });

    await workableParser.parse({ url: SEARCH_SITE_LINK });

    expect(triedBoards(calls)).toEqual(["manila-recruitment", "manilarecruitment"]);
  });
});

describe("workableParser: a link that is not a web address", () => {
  test("throws, leaving the job where it was", async () => {
    await expect(workableParser.parse({ url: "not a web address" })).rejects.toThrow();
  });
});
