import { afterEach, describe, expect, test, vi } from "vitest";
import { extractGreenhouseSlugAndId, greenhouseParser } from "./greenhouse";

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
