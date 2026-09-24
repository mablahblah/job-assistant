import { afterEach, describe, expect, test } from "vitest";
import { bamboohrParser } from "./bamboohr";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

// Shaped like the reply a BambooHR careers page gives when asked for one job
// as data, measured on the shortcut board on 2026-09-24.
function detail(description: string, compensation?: string) {
  return {
    meta: {},
    result: {
      jobOpening: {
        jobOpeningShareUrl: "https://shortcut.bamboohr.com/careers/40",
        jobOpeningName: "Senior Product Designer",
        jobOpeningStatus: "Open",
        departmentLabel: "Product Management",
        employmentStatusLabel: "Full-Time",
        location: { city: null, state: null, postalCode: null, addressCountry: null },
        atsLocation: { country: "United States", countryId: "1", state: "New York", city: "New York" },
        description,
        datePosted: "2026-07-24",
        ...(compensation === undefined ? {} : { compensation }),
      },
    },
  };
}

const DETAIL_URL = "https://shortcut.bamboohr.com/careers/40/detail";

interface Call {
  url: string;
  accept: string | null;
}

// Answers per-url from a small map the test builds, recording every call and
// the kind of reply it asked for. An address it does not hold answers 404.
function stubFetch(routes: Record<string, () => Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, accept: new Headers(init?.headers).get("accept") });
    const respond = routes[url];
    if (respond === undefined) {
      return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    }
    return respond();
  }) as unknown as typeof globalThis.fetch;
  return calls;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("bamboohrParser: the job is read from its careers page as data", () => {
  test("the request asks the board named in the address for this job, as data", async () => {
    const calls = stubFetch({ [DETAIL_URL]: () => jsonResponse(detail("<p>Design tools.</p>")) });

    await bamboohrParser.parse({
      url: "https://shortcut.bamboohr.com/careers/40?utm_source=adzuna&utm_medium=adzuna",
    });

    expect(calls.map((call) => call.url)).toEqual([DETAIL_URL]);
    // A careers page answers with a web page unless it is asked for data.
    expect(calls[0]?.accept).toContain("application/json");
  });

  test("the job fills the description, the location and the board name", async () => {
    stubFetch({ [DETAIL_URL]: () => jsonResponse(detail("<p>Design tools.</p>")) });

    const fields = await bamboohrParser.parse({ url: "https://shortcut.bamboohr.com/careers/40" });

    expect(fields.description).toBe("<p>Design tools.</p>");
    expect(fields.raw_location_list).toEqual(["New York, New York, United States"]);
    expect(fields.raw_company_slug).toBe("shortcut");
  });

  test("a description stating pay and a mode fills both", async () => {
    stubFetch({
      [DETAIL_URL]: () =>
        jsonResponse(
          detail("<p>The range for this role is $120,000 - $150,000 per year.</p><p>This role is remote.</p>")
        ),
    });

    const fields = await bamboohrParser.parse({ url: "https://shortcut.bamboohr.com/careers/40" });

    expect(fields.raw_salary).toMatchObject({ salary_min: 120000, salary_max: 150000 });
    expect(fields.raw_mode_list).toEqual(["remote"]);
  });
});

// The detail reply carries a free-text compensation field. It held
// "145k-185k" on the one job measured (shortcut, job 40, on 2026-09-24).
describe("bamboohrParser: the pay field", () => {
  test("a pay field stating a range fills the pay, with no currency needed", async () => {
    stubFetch({ [DETAIL_URL]: () => jsonResponse(detail("<p>Design tools.</p>", "145k-185k")) });

    const fields = await bamboohrParser.parse({ url: "https://shortcut.bamboohr.com/careers/40" });

    expect(fields.raw_salary).toEqual({ salary_min: 145000, salary_max: 185000, salary_period: "year" });
  });

  test("a pay field wins over a range the description states", async () => {
    stubFetch({
      [DETAIL_URL]: () =>
        jsonResponse(detail("<p>The range is $120,000 - $150,000 per year.</p>", "145k-185k")),
    });

    const fields = await bamboohrParser.parse({ url: "https://shortcut.bamboohr.com/careers/40" });

    expect(fields.raw_salary).toMatchObject({ salary_min: 145000, salary_max: 185000 });
  });

  test("a pay field stating no range leaves the description to fill the pay", async () => {
    stubFetch({
      [DETAIL_URL]: () =>
        jsonResponse(detail("<p>The range is $120,000 - $150,000 per year.</p>", "Competitive")),
    });

    const fields = await bamboohrParser.parse({ url: "https://shortcut.bamboohr.com/careers/40" });

    expect(fields.raw_salary).toMatchObject({ salary_min: 120000, salary_max: 150000 });
  });
});

describe("bamboohrParser: a job that cannot be read throws", () => {
  test("a closed job throws, leaving the job where it was", async () => {
    stubFetch({});

    await expect(
      bamboohrParser.parse({ url: "https://shortcut.bamboohr.com/careers/40" })
    ).rejects.toThrow();
  });

  test("a link naming no job throws", async () => {
    stubFetch({});

    await expect(
      bamboohrParser.parse({ url: "https://shortcut.bamboohr.com/careers" })
    ).rejects.toThrow();
  });
});

describe("bamboohrParser: a link that is not a web address", () => {
  test("throws, leaving the job where it was", async () => {
    await expect(bamboohrParser.parse({ url: "not a web address" })).rejects.toThrow();
  });
});
