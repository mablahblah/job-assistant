import { afterEach, describe, expect, test } from "vitest";
import { smartrecruitersParser } from "./smartrecruiters";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

// Shaped like a single posting from api.smartrecruiters.com, measured on the
// RodeoFX board on 2026-09-24.
const POSTING = {
  id: "744000148584589",
  name: "UX Specialist",
  company: { identifier: "RodeoFX", name: "Rodeo FX" },
  releasedDate: "2026-09-09T18:30:40.900Z",
  location: {
    city: "Montreal",
    region: "QC",
    country: "ca",
    remote: false,
    hybrid: false,
    fullLocation: "Montreal, QC, Canada",
  },
  jobAd: {
    sections: {
      jobDescription: { title: "Job Description", text: "<p>Research how artists work.</p>" },
    },
  },
};

const API_URL = "https://api.smartrecruiters.com/v1/companies/RodeoFX/postings/744000148584589";

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

describe("smartrecruitersParser: the posting is read from the posting API", () => {
  test("the request names the board and the posting's identifier alone", async () => {
    const calls = stubFetch({ [API_URL]: () => jsonResponse(POSTING) });

    await smartrecruitersParser.parse({
      url: "https://jobs.smartrecruiters.com/RodeoFX/744000148584589",
    });

    expect(calls).toEqual([API_URL]);
  });

  test("a link carrying the job title after the identifier asks for the identifier alone", async () => {
    // The posting address answers Bad Request to the identifier with the
    // title still attached (measured 2026-09-24).
    const calls = stubFetch({ [API_URL]: () => jsonResponse(POSTING) });

    const fields = await smartrecruitersParser.parse({
      url: "https://jobs.smartrecruiters.com/RodeoFX/744000148584589-ux-specialist",
    });

    expect(calls).toEqual([API_URL]);
    expect(fields.description).toContain("Research how artists work.");
  });

  test("the posting fills the description, the location, the employer and the board", async () => {
    stubFetch({ [API_URL]: () => jsonResponse(POSTING) });

    const fields = await smartrecruitersParser.parse({
      url: "https://jobs.smartrecruiters.com/RodeoFX/744000148584589-ux-specialist",
    });

    expect(fields.description).toContain("Research how artists work.");
    expect(fields.raw_location_list).toEqual(["Montreal, QC, Canada"]);
    expect(fields.raw_company_name).toBe("Rodeo FX");
    expect(fields.raw_company_slug).toBe("RodeoFX");
  });
});

describe("smartrecruitersParser: pay and work mode come from the description", () => {
  test("a job ad stating pay and a mode fills both", async () => {
    stubFetch({
      [API_URL]: () =>
        jsonResponse({
          ...POSTING,
          jobAd: {
            sections: {
              jobDescription: {
                title: "Job Description",
                text: "<p>The range for this role is $120,000 - $150,000 per year.</p><p>This role is remote.</p>",
              },
            },
          },
        }),
    });

    const fields = await smartrecruitersParser.parse({
      url: "https://jobs.smartrecruiters.com/RodeoFX/744000148584589",
    });

    expect(fields.raw_salary).toMatchObject({ salary_min: 120000, salary_max: 150000 });
    expect(fields.raw_mode_list).toEqual(["remote"]);
  });
});

describe("smartrecruitersParser: a posting that cannot be read throws", () => {
  test("a closed posting throws, leaving the job where it was", async () => {
    stubFetch({});

    await expect(
      smartrecruitersParser.parse({ url: "https://jobs.smartrecruiters.com/RodeoFX/744000148584589" })
    ).rejects.toThrow();
  });

  test("a link naming only a board throws", async () => {
    stubFetch({});

    await expect(
      smartrecruitersParser.parse({ url: "https://jobs.smartrecruiters.com/RodeoFX" })
    ).rejects.toThrow();
  });
});

describe("smartrecruitersParser: a link that is not a web address", () => {
  test("throws, leaving the job where it was", async () => {
    await expect(smartrecruitersParser.parse({ url: "not a web address" })).rejects.toThrow();
  });
});
