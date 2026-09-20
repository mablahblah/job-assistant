import { afterEach, describe, expect, test, vi } from "vitest";
import {
  extractGreenhouseSlugAndId,
  greenhouseIdentifiersForUrl,
  greenhouseJobIdFromUrl,
  greenhouseParser,
} from "./greenhouse";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const POSTING = {
  id: 12345,
  title: "Senior Product Designer",
  first_published: "2026-08-01T09:00:00Z",
  updated_at: "2026-08-14T09:00:00Z",
  location: { name: "Remote - US" },
  content: "<p>Design things.</p>",
  company_name: "Stripe",
  pay_input_ranges: [{ min_cents: 14000000, max_cents: 18000000, currency_type: "USD" }],
};

// Answers every request with this body and status, recording each call.
function stubFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  const stub = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  globalThis.fetch = stub as unknown as typeof globalThis.fetch;
  return stub;
}

describe("extractGreenhouseSlugAndId: the board slug and the posting id are read off the link", () => {
  test("a board link carries the slug in its path", () => {
    expect(extractGreenhouseSlugAndId("https://boards.greenhouse.io/stripe/jobs/12345")).toEqual({
      slug: "stripe",
      jobId: "12345",
    });
  });

  test.each([
    "https://job-boards.greenhouse.io/stripe/jobs/12345",
    "https://job-boards.eu.greenhouse.io/stripe/jobs/12345",
  ])("%s reads the same way", (url) => {
    expect(extractGreenhouseSlugAndId(url)).toEqual({ slug: "stripe", jobId: "12345" });
  });

  test("an employer's own address carries the slug in its host", () => {
    expect(extractGreenhouseSlugAndId("https://gitlab.greenhouse.io/jobs/67890")).toEqual({
      slug: "gitlab",
      jobId: "67890",
    });
  });

  test("a link naming no posting gives nothing", () => {
    expect(extractGreenhouseSlugAndId("https://boards.greenhouse.io/stripe")).toBeNull();
  });

  test("a string that is not a link gives nothing rather than throwing", () => {
    expect(extractGreenhouseSlugAndId("not-a-url")).toBeNull();
  });
});

describe("greenhouseParser: the posting is read from the board API", () => {
  test("the request names the board, the posting, and asks for pay", async () => {
    const stub = stubFetch(POSTING);

    await greenhouseParser.parse({ url: "https://boards.greenhouse.io/stripe/jobs/12345" });

    const requested = String(stub.mock.calls[0][0]);
    expect(requested).toContain("/boards/stripe/jobs/12345");
    expect(requested).toContain("pay_transparency=true");
  });

  test("AC 9: the request says it is a browser", async () => {
    const stub = stubFetch(POSTING);

    await greenhouseParser.parse({ url: "https://boards.greenhouse.io/stripe/jobs/12345" });

    const options = stub.mock.calls[0][1] as { headers?: Record<string, string> };
    expect(options.headers?.["user-agent"]).toMatch(/Mozilla/);
  });

  test("AC 8: a parse costs one request, not a browser session", async () => {
    const stub = stubFetch(POSTING);

    await greenhouseParser.parse({ url: "https://boards.greenhouse.io/stripe/jobs/12345" });

    // The board publishes the employer's name on the posting itself, so no
    // second request goes out to find it.
    expect(stub).toHaveBeenCalledTimes(1);
  });

  test("the posting's own fields come back", async () => {
    stubFetch(POSTING);

    const fields = await greenhouseParser.parse({
      url: "https://boards.greenhouse.io/stripe/jobs/12345",
    });

    expect(fields.raw_title).toBe("Senior Product Designer");
    expect(fields.raw_company_name).toBe("Stripe");
    expect(fields.raw_company_slug).toBe("stripe");
    expect(fields.description).toBe("<p>Design things.</p>");
  });

  test("AC 11 and 12: no link and no phase gate come back", async () => {
    stubFetch(POSTING);

    const fields = await greenhouseParser.parse({
      url: "https://boards.greenhouse.io/stripe/jobs/12345",
    });

    for (const field of ["resolved_url", "original_url", "is_parsed"]) {
      expect(field in fields).toBe(false);
    }
  });
});

describe("greenhouseParser: the description fills what the board did not publish", () => {
  test("AC 20: a work mode stated only in the description is read out of it", async () => {
    stubFetch({ ...POSTING, content: "<p>This role is remote.</p>" });

    const fields = await greenhouseParser.parse({
      url: "https://boards.greenhouse.io/stripe/jobs/12345",
    });

    expect(fields.raw_mode_list).toEqual(["remote"]);
  });

  test("AC 19: a published pay range is not replaced by one in the description", async () => {
    stubFetch({ ...POSTING, content: "<p>Pays $10 - $12 per hour.</p>" });

    const fields = await greenhouseParser.parse({
      url: "https://boards.greenhouse.io/stripe/jobs/12345",
    });

    expect(fields.raw_salary).toEqual({
      salary_min: 14000000,
      salary_max: 18000000,
      salary_currency: "USD",
      salary_unit: "cents",
    });
  });

  test("AC 20: a pay range stated only in the description is read out of it", async () => {
    stubFetch({
      ...POSTING,
      pay_input_ranges: [],
      content: "<p>The range is $120,000 - $150,000 per year.</p>",
    });

    const fields = await greenhouseParser.parse({
      url: "https://boards.greenhouse.io/stripe/jobs/12345",
    });

    expect(fields.raw_salary).toEqual({
      salary_min: 120000,
      salary_max: 150000,
      salary_period: "year",
    });
  });
});

describe("greenhouseParser: a parse that cannot read its source throws", () => {
  test("a link naming no posting throws rather than answering nothing", async () => {
    stubFetch(POSTING);

    await expect(
      greenhouseParser.parse({ url: "https://boards.greenhouse.io/stripe" })
    ).rejects.toThrow();
  });

  test("a board refusing the request throws an error naming the status", async () => {
    stubFetch({}, 503);

    await expect(
      greenhouseParser.parse({ url: "https://boards.greenhouse.io/stripe/jobs/12345" })
    ).rejects.toThrow(/503/);
  });
});

describe("greenhouseParser: the parser names itself", () => {
  test("its name is the one the source priority list uses", () => {
    expect(greenhouseParser.name).toBe("greenhouse");
  });
});

// AC 1. The registry matches a link by the website its owner holds, and no
// entry owns brex.com or moduscreate.com. The registry asks each parser about
// a link it could not place, and this is the Greenhouse parser's answer.
describe("greenhouseParser: which unowned links it claims", () => {
  test.each([
    "https://www.brex.com/careers/8777949002?gh_jid=8777949002",
    "https://www.moduscreate.com/careers/7994649003?gh_jid=7994649003",
    "https://www.datavant.com/about/careers/open-roles/job?gh_jid=5365997008",
    "https://www.pinterestcareers.com/jobs/7684577/staff-qualitative-ux-researcher/?gh_jid=7684577",
    "https://www.gladly.ai/careers/?utm_source=greenhouse-recruiting&gh_jid=8208190",
    "https://ats.comparably.com/api/v2/stash/post/8209111:?gh_jid=8209111",
  ])("it claims %s, which carries a job number", (url) => {
    expect(greenhouseParser.claims?.(url)).toBe(true);
  });

  // AC 3. Most links no parser owns have nothing to do with Greenhouse, and
  // must stay set aside. Measured 2026-09-20: 120 jobs were set aside, of
  // which 7 carry a Greenhouse job number.
  test.each([
    "https://meredith.wd5.myworkdayjobs.com/jobs/1",
    "https://www.adzuna.com/details/1",
    "https://www.linkedin.com/jobs/view/1",
    "https://www.brex.com/careers/8777949002",
  ])("it does not claim %s, which carries no job number", (url) => {
    expect(greenhouseParser.claims?.(url)).toBe(false);
  });

  test("a string that is not a link is not claimed rather than throwing", () => {
    expect(greenhouseParser.claims?.("historical")).toBe(false);
  });
});

// Six employers host their Greenhouse postings on their own website. Measured
// 2026-09-20 across the nine stored links carrying a job number: brex.com,
// moduscreate.com, pinterestcareers.com, datavant.com, ats.comparably.com,
// gladly.ai and jobs.dropbox.com. None sits on a Greenhouse address, so none
// names a board, and each was set aside unread.
describe("greenhouseJobIdFromUrl: the job number is read off a careers-page link", () => {
  test("a careers-page link carries its job number as gh_jid", () => {
    expect(greenhouseJobIdFromUrl("https://www.brex.com/careers/8777949002?gh_jid=8777949002")).toBe(
      "8777949002"
    );
  });

  test("a job number surrounded by other values is still found", () => {
    expect(
      greenhouseJobIdFromUrl(
        "https://www.gladly.ai/careers/?utm_source=greenhouse-recruiting&gh_jid=8208190"
      )
    ).toBe("8208190");
  });

  test("a link carrying no job number gives nothing", () => {
    expect(greenhouseJobIdFromUrl("https://www.brex.com/careers/8777949002")).toBeNull();
  });

  test("an empty job number gives nothing", () => {
    expect(greenhouseJobIdFromUrl("https://www.brex.com/careers?gh_jid=")).toBeNull();
  });

  test("a string that is not a link gives nothing rather than throwing", () => {
    expect(greenhouseJobIdFromUrl("not-a-url")).toBeNull();
  });
});

describe("greenhouseIdentifiersForUrl: where the board name comes from", () => {
  // AC 14 and 15. Measured 2026-09-20: all 309 postings already on a
  // Greenhouse address also carry a job number, so reading the number first
  // would make every board the pipeline already polls pay a lookup it does
  // not need.
  test("a Greenhouse address takes its board from the link itself", async () => {
    const identifiers = await greenhouseIdentifiersForUrl(
      "https://boards.greenhouse.io/stripe/jobs/12345?gh_jid=12345",
      async () => {
        throw new Error("no board name should be recovered for a Greenhouse address");
      }
    );

    expect(identifiers).toEqual({ slug: "stripe", jobId: "12345" });
  });

  // AC 1. Measured 2026-09-20: job number 7994649003 recovers the board
  // moduscreate, which is the board Modus Create hires through.
  test("a careers-page link recovers its board from the job number", async () => {
    const identifiers = await greenhouseIdentifiersForUrl(
      "https://www.moduscreate.com/careers/7994649003?gh_jid=7994649003",
      async () => "moduscreate"
    );

    expect(identifiers).toEqual({ slug: "moduscreate", jobId: "7994649003" });
  });

  // Measured 2026-09-20: pinterestcareers.com puts "jobs" first in its path,
  // which is the shape an employer's own Greenhouse address takes. Reading
  // that link the way a Greenhouse address is read gives the board name
  // "www". The job number gives "pinterest", which is the real board.
  test("a careers-page link whose path begins with jobs still uses its job number", async () => {
    const identifiers = await greenhouseIdentifiersForUrl(
      "https://www.pinterestcareers.com/jobs/7684577/staff-qualitative-ux-researcher/?gh_jid=7684577",
      async () => "pinterest"
    );

    expect(identifiers).toEqual({ slug: "pinterest", jobId: "7684577" });
  });

  test("the job number it recovers the board from is the link's own", async () => {
    const asked: string[] = [];

    await greenhouseIdentifiersForUrl(
      "https://www.datavant.com/about/careers/open-roles/job?gh_jid=5365997008",
      async (jobId) => {
        asked.push(jobId);
        return "datavant2";
      }
    );

    expect(asked).toEqual(["5365997008"]);
  });

  test("a link carrying neither a board nor a job number gives nothing", async () => {
    const identifiers = await greenhouseIdentifiersForUrl(
      "https://www.brex.com/careers/8777949002",
      async () => "brex"
    );

    expect(identifiers).toBeNull();
  });

  // AC 4 and 6. A board that cannot be recovered, and a posting taken down
  // between being collected and being read, look the same from here.
  test("a job number whose board cannot be recovered gives nothing", async () => {
    const identifiers = await greenhouseIdentifiersForUrl(
      "https://jobs.dropbox.com/listing/7558673?gh_jid=7558673",
      async () => null
    );

    expect(identifiers).toBeNull();
  });
});

describe("greenhouseParser: a careers-page posting is read through its recovered board", () => {
  // Answers the board-name lookup with the address Greenhouse's redirect
  // lands on, and the board API with the posting.
  function stubFetchForCareersPageLink(body: unknown, status = 200): ReturnType<typeof vi.fn> {
    const stub = vi.fn(async (input: unknown) => {
      if (String(input).includes("/embed/job_app")) {
        const landed = new Response("", { status: 200 });
        Object.defineProperty(landed, "url", {
          value: "https://job-boards.greenhouse.io/embed/job_app?for=moduscreate&token=7994649003",
        });
        return landed;
      }

      return new Response(JSON.stringify(body), { status });
    });
    globalThis.fetch = stub as unknown as typeof globalThis.fetch;
    return stub;
  }

  // AC 2.
  test("the posting's fields come back from the recovered board", async () => {
    stubFetchForCareersPageLink({ ...POSTING, company_name: "Modus Create" });

    const fields = await greenhouseParser.parse({
      url: "https://www.moduscreate.com/careers/7994649003?gh_jid=7994649003",
    });

    expect(fields.raw_title).toBe("Senior Product Designer");
    expect(fields.raw_company_name).toBe("Modus Create");
    expect(fields.description).toContain("Design things.");
    expect(fields.raw_location_list).toEqual(["Remote - US"]);
    expect(fields.posting_date).toEqual(new Date("2026-08-01T09:00:00Z"));
  });

  // AC 8. The board is recorded against the employer, which is what puts a
  // high-scoring employer on the Greenhouse collector's polling list.
  test("the recovered board is written onto the job", async () => {
    stubFetchForCareersPageLink(POSTING);

    const fields = await greenhouseParser.parse({
      url: "https://www.moduscreate.com/careers/7994649003?gh_jid=7994649003",
    });

    expect(fields.raw_company_slug).toBe("moduscreate");
  });

  test("the posting is asked for from the recovered board", async () => {
    const stub = stubFetchForCareersPageLink(POSTING);

    await greenhouseParser.parse({
      url: "https://www.moduscreate.com/careers/7994649003?gh_jid=7994649003",
    });

    const requested = stub.mock.calls.map((call) => String(call[0]));
    expect(requested.some((url) => url.includes("/boards/moduscreate/jobs/7994649003"))).toBe(true);
  });

  // AC 6 and 7. A posting can be taken down between being collected and being
  // read, which is a recovered board holding nothing at that job number.
  test("a recovered board no longer holding the posting throws", async () => {
    const stub = stubFetchForCareersPageLink({}, 404);

    await expect(
      greenhouseParser.parse({
        url: "https://www.moduscreate.com/careers/7994649003?gh_jid=7994649003",
      })
    ).rejects.toThrow();

    const requested = stub.mock.calls.map((call) => String(call[0]));
    expect(requested.some((url) => url.includes("/boards/moduscreate/jobs/7994649003"))).toBe(true);
  });

  // AC 5 and 7. The handler records a throw as parser_errored and leaves the
  // job in the backlog.
  test("a board that cannot be recovered throws rather than answering nothing", async () => {
    const stub = vi.fn(async () => new Response("", { status: 404 }));
    globalThis.fetch = stub as unknown as typeof globalThis.fetch;

    await expect(
      greenhouseParser.parse({ url: "https://jobs.dropbox.com/listing/7558673?gh_jid=7558673" })
    ).rejects.toThrow();
  });
});
