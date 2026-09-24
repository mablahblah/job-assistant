import { afterEach, describe, expect, test } from "vitest";
import { ripplingParser } from "./rippling";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const UUID = "371ee603-a211-467c-b868-b5f5b68ccbff";
const API_URL = `https://api.rippling.com/platform/api/ats/v1/board/radicl-defense/jobs/${UUID}`;

// Shaped like one job from Rippling's board address, measured on the
// radicl-defense board on 2026-09-24.
function job(role: string, payRangeDetails: unknown[] = []) {
  return {
    uuid: UUID,
    name: "Product (UX/UI) Designer",
    description: { company: "<p>RADICL protects small businesses.</p>", role },
    workLocations: ["Boulder, CO"],
    createdOn: "2026-09-01T13:22:49.176000-07:00",
    url: `https://ats.rippling.com/radicl-defense/jobs/${UUID}`,
    board: { slug: "radicl-defense", companyName: "RADICL" },
    payRangeDetails,
    companyName: "RADICL",
  };
}

// Answers per-url from a small map the test builds, recording every call. An
// address it does not hold answers 404.
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

describe("ripplingParser: the job is read from Rippling's board address", () => {
  test("the request names the board and the job, whatever tracking the link carries", async () => {
    const calls = stubFetch({ [API_URL]: () => jsonResponse(job("<p>Design dashboards.</p>")) });

    await ripplingParser.parse({
      url: `https://ats.rippling.com/radicl-defense/jobs/${UUID}?utm_source=adzuna&utm_medium=adzuna`,
    });

    expect(calls).toEqual([API_URL]);
  });

  test("the job fills the description, the location, the employer and the board", async () => {
    stubFetch({ [API_URL]: () => jsonResponse(job("<p>Design dashboards.</p>")) });

    const fields = await ripplingParser.parse({
      url: `https://ats.rippling.com/radicl-defense/jobs/${UUID}`,
    });

    expect(fields.description).toContain("Design dashboards.");
    expect(fields.raw_location_list).toEqual(["Boulder, CO"]);
    expect(fields.raw_company_name).toBe("RADICL");
    expect(fields.raw_company_slug).toBe("radicl-defense");
  });

  test("a description stating pay and a mode fills both where the feed has none", async () => {
    stubFetch({
      [API_URL]: () =>
        jsonResponse(
          job("<p>The range for this role is $120,000 - $150,000 per year.</p><p>This role is remote.</p>")
        ),
    });

    const fields = await ripplingParser.parse({
      url: `https://ats.rippling.com/radicl-defense/jobs/${UUID}`,
    });

    expect(fields.raw_salary).toMatchObject({ salary_min: 120000, salary_max: 150000 });
    expect(fields.raw_mode_list).toEqual(["remote"]);
  });
});

describe("ripplingParser: a job that cannot be read throws", () => {
  test("a closed job throws, leaving the job where it was", async () => {
    stubFetch({});

    await expect(
      ripplingParser.parse({ url: `https://ats.rippling.com/radicl-defense/jobs/${UUID}` })
    ).rejects.toThrow();
  });

  test("a link naming only a board throws", async () => {
    stubFetch({});

    await expect(
      ripplingParser.parse({ url: "https://ats.rippling.com/radicl-defense/jobs" })
    ).rejects.toThrow();
  });
});

describe("ripplingParser: a link that is not a web address", () => {
  test("throws, leaving the job where it was", async () => {
    await expect(ripplingParser.parse({ url: "not a web address" })).rejects.toThrow();
  });
});
