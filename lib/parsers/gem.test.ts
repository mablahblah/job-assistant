import { afterEach, describe, expect, test } from "vitest";
import { gemParser } from "./gem";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

// Shaped like a posting from api.gem.com's job board API, measured on the
// fetch board on 2026-09-24.
const POSTING = {
  absolute_url: "https://jobs.gem.com/fetch/7536752003",
  content: "<div><p>Design how people find rewards.</p></div>",
  content_plain: "Design how people find rewards.",
  created_at: "2025-11-21T22:26:01.000Z",
  first_published_at: "2026-05-12T22:51:02.331Z",
  updated_at: "2026-07-16T16:08:06.647Z",
  id: "7536752003",
  location: { name: "United States - Remote" },
  employment_type: "full_time",
  title: "Senior Product Designer",
};

const API_URL = "https://api.gem.com/job_board/v0/fetch/job_posts/7536752003";

// Answers per-url from a small map the test builds, recording every call.
function stubFetch(routes: Record<string, () => Response>): string[] {
  const calls: string[] = [];
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    calls.push(url);
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

describe("gemParser: the posting is read from the job board API", () => {
  test("the request names the board and the posting", async () => {
    const calls = stubFetch({ [API_URL]: () => jsonResponse(POSTING) });

    await gemParser.parse({ url: "https://jobs.gem.com/fetch/7536752003" });

    expect(calls).toContain(API_URL);
  });

  test("the posting fills the description, the location and the board name", async () => {
    stubFetch({ [API_URL]: () => jsonResponse(POSTING) });

    const fields = await gemParser.parse({ url: "https://jobs.gem.com/fetch/7536752003" });

    expect(fields.description).toBe("Design how people find rewards.");
    expect(fields.raw_location_list).toEqual(["United States - Remote"]);
    expect(fields.raw_company_slug).toBe("fetch");
  });

  test("tracking values on the link do not reach the request", async () => {
    const calls = stubFetch({ [API_URL]: () => jsonResponse(POSTING) });

    const fields = await gemParser.parse({
      url: "https://jobs.gem.com/fetch/7536752003?utm_source=adzuna&utm_medium=adzuna",
    });

    expect(calls).toEqual([API_URL]);
    expect(fields.description).toBe("Design how people find rewards.");
  });

  test("an opaque identifier is read the same way as a numeric one", async () => {
    const opaque = "am9icG9zdDpG5zH_yMBPP12ndIz2TqJU";
    const opaqueApiUrl = `https://api.gem.com/job_board/v0/fetch/job_posts/${opaque}`;
    stubFetch({ [opaqueApiUrl]: () => jsonResponse({ ...POSTING, id: opaque }) });

    const fields = await gemParser.parse({ url: `https://jobs.gem.com/fetch/${opaque}` });

    expect(fields.raw_title).toBe("Senior Product Designer");
  });
});

describe("gemParser: pay and work mode come from the description", () => {
  test("a description stating pay and a mode fills both", async () => {
    stubFetch({
      [API_URL]: () =>
        jsonResponse({
          ...POSTING,
          content_plain: "The range for this role is $120,000 - $150,000 per year. This role is remote.",
        }),
    });

    const fields = await gemParser.parse({ url: "https://jobs.gem.com/fetch/7536752003" });

    expect(fields.raw_salary).toMatchObject({ salary_min: 120000, salary_max: 150000 });
    expect(fields.raw_mode_list).toEqual(["remote"]);
  });
});

describe("gemParser: a posting that cannot be read throws", () => {
  test("a closed posting throws, leaving the job where it was", async () => {
    stubFetch({});

    await expect(
      gemParser.parse({ url: "https://jobs.gem.com/fetch/7536752003" })
    ).rejects.toThrow();
  });

  test("a link naming only a board throws", async () => {
    stubFetch({});

    await expect(gemParser.parse({ url: "https://jobs.gem.com/fetch" })).rejects.toThrow();
  });
});

describe("gemParser: a link that is not a web address", () => {
  test("throws, leaving the job where it was", async () => {
    await expect(gemParser.parse({ url: "not a web address" })).rejects.toThrow();
  });
});
