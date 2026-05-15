import { describe, it, expect, vi, beforeEach } from "vitest";

// Prevent transitive Prisma import (company-cache via parser modules) from failing in test env.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    company: { findFirst: vi.fn(), upsert: vi.fn() },
  },
}));

// Mock fetch-utils so collectors don't make real HTTP calls during tests.
vi.mock("../scrapers/fetch-utils", async () => {
  const actual = await vi.importActual<typeof import("../scrapers/fetch-utils")>("../scrapers/fetch-utils");
  return { ...actual, fetchWithTimeout: vi.fn() };
});

import { fetchWithTimeout } from "../scrapers/fetch-utils";
const mockFetch = fetchWithTimeout as ReturnType<typeof vi.fn>;

// Builds a fake Response object that returns the given body as JSON.
function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

// --- Adzuna Collector ---

describe("collectAdzuna", () => {
  let collectAdzuna: typeof import("./adzuna").collectAdzuna;

  beforeEach(async () => {
    vi.stubEnv("ADZUNA_APP_ID", "FAKE_ID");
    vi.stubEnv("ADZUNA_API_KEY", "FAKE_KEY");
    collectAdzuna = (await import("./adzuna")).collectAdzuna;
  });

  it("sends title_only and shared filters to the API", async () => {
    mockFetch.mockResolvedValue(fakeResponse({ results: [], count: 0 }));

    await collectAdzuna({ titleOnly: "Product Design" });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    const params = new URL(calledUrl).searchParams;
    expect(params.get("title_only")).toBe("Product Design");
    expect(params.get("max_days_old")).toBe("8");
    expect(params.get("salary_min")).toBe("100000");
    expect(params.get("salary_include_unknown")).toBe("1");
    expect(params.get("sort_by")).toBe("date");
    expect(params.get("results_per_page")).toBe("50");
    // title_only calls should NOT set what
    expect(params.has("what")).toBe(false);
  });

  it("sends what param when provided (remote search)", async () => {
    mockFetch.mockResolvedValue(fakeResponse({ results: [], count: 0 }));

    await collectAdzuna({ titleOnly: "Product Design", what: "remote" });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    const params = new URL(calledUrl).searchParams;
    expect(params.get("title_only")).toBe("Product Design");
    expect(params.get("what")).toBe("remote");
  });

  it("sends where and distance for Austin search", async () => {
    mockFetch.mockResolvedValue(fakeResponse({ results: [], count: 0 }));

    await collectAdzuna({ titleOnly: "Product Design", where: "78701", distance: "15" });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    const params = new URL(calledUrl).searchParams;
    expect(params.get("where")).toBe("78701");
    expect(params.get("distance")).toBe("15");
    expect(params.has("what")).toBe(false);
  });

  it("returns CollectedJob[] with all fields mapped", async () => {
    mockFetch.mockResolvedValue(fakeResponse({
      results: [{
        id: "abc123",
        title: "Senior Product Designer",
        company: { display_name: "Acme Corp" },
        description: "Remote role designing products",
        redirect_url: "https://adzuna.com/job/abc123",
        location: { display_name: "New York, NY" },
        salary_min: 120000,
        salary_max: 180000,
        created: "2026-03-15T00:00:00Z",
      }],
      count: 1,
    }));

    const jobs = await collectAdzuna({ titleOnly: "Product Design" });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({
      url: "https://adzuna.com/job/abc123",
      source: "adzuna",
      externalId: "abc123",
      title: "Senior Product Designer",
      companyName: "Acme Corp",
      location: "New York, NY",
      workMode: "remote",
      postedAt: new Date("2026-03-15T00:00:00Z"),
      salaryRange: "$120-180k",
      description: "Remote role designing products",
    });
  });

  it("returns empty array when no results", async () => {
    mockFetch.mockResolvedValue(fakeResponse({ results: null, count: 0 }));
    const jobs = await collectAdzuna({ titleOnly: "Product Design" });
    expect(jobs).toEqual([]);
  });
});

// --- JSearch Collector ---

describe("collectJSearch", () => {
  let collectJSearch: typeof import("./jsearch").collectJSearch;

  beforeEach(async () => {
    vi.stubEnv("RAPIDAPI_KEY", "FAKE_KEY_FOR_TESTS");
    collectJSearch = (await import("./jsearch")).collectJSearch;
  });

  it("returns CollectedJob[] with all API fields populated", async () => {
    mockFetch.mockResolvedValue(fakeResponse({
      status: "OK",
      data: [{
        job_id: "j-001",
        job_title: "Product Designer",
        employer_name: "DesignCo",
        job_apply_link: "https://designco.com/apply",
        job_city: "Austin",
        job_state: "TX",
        job_country: "US",
        job_is_remote: true,
        job_posted_at_datetime_utc: "2026-03-10T12:00:00Z",
        job_min_salary: 100000,
        job_max_salary: 150000,
        job_salary_period: "YEAR",
        job_description: "Design amazing products",
      }],
    }));

    const jobs = await collectJSearch({ query: "Product Designer jobs in Austin", location: "Austin, United States" });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({
      url: "https://designco.com/apply",
      source: "jsearch",
      externalId: "j-001",
      title: "Product Designer",
      companyName: "DesignCo",
      location: "Austin, TX, US",
      workMode: "remote",
      postedAt: new Date("2026-03-10T12:00:00Z"),
      salaryRange: "$100-150k",
      description: "Design amazing products",
    });
  });

  it("returns empty array when no data", async () => {
    mockFetch.mockResolvedValue(fakeResponse({ status: "OK", data: null }));
    const jobs = await collectJSearch({ query: "test" });
    expect(jobs).toEqual([]);
  });
});

// --- Greenhouse Collector ---

describe("collectGreenhouseCompany", () => {
  let collectGreenhouseCompany: typeof import("./greenhouse").collectGreenhouseCompany;

  beforeEach(async () => {
    collectGreenhouseCompany = (await import("./greenhouse")).collectGreenhouseCompany;
  });

  it("returns CollectedJob[] with all API fields, filtered by query", async () => {
    mockFetch.mockResolvedValue(fakeResponse({
      jobs: [
        {
          id: 101,
          title: "Product Designer",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/101",
          location: { name: "San Francisco, CA" },
          updated_at: "2026-03-12T00:00:00Z",
          content: "<p>We are hiring a hybrid product designer. Salary: $150,000 - $200,000</p>",
        },
        {
          id: 102,
          title: "Software Engineer",
          absolute_url: "https://boards.greenhouse.io/acme/jobs/102",
          location: { name: "Remote" },
          updated_at: "2026-03-12T00:00:00Z",
          content: "<p>Backend engineer</p>",
        },
      ],
    }));

    const jobs = await collectGreenhouseCompany("acme", ["product designer"]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({
      url: "https://boards.greenhouse.io/acme/jobs/101",
      source: "greenhouse-api",
      externalId: "101",
      title: "Product Designer",
      companyName: "Acme",
      location: "San Francisco, CA",
      workMode: "hybrid",
      postedAt: new Date("2026-03-12T00:00:00Z"),
      salaryRange: "$150-200k",
      description: "<p>We are hiring a hybrid product designer. Salary: $150,000 - $200,000</p>",
    });
  });

  it("throws on 404", async () => {
    mockFetch.mockResolvedValue(fakeResponse(null, false, 404));
    await expect(collectGreenhouseCompany("nonexistent", ["designer"])).rejects.toThrow("board not found");
  });
});

// --- Lever Collector ---

describe("collectLeverCompany", () => {
  let collectLeverCompany: typeof import("./lever").collectLeverCompany;

  beforeEach(async () => {
    collectLeverCompany = (await import("./lever")).collectLeverCompany;
  });

  it("returns CollectedJob[] with structured workplaceType", async () => {
    mockFetch.mockResolvedValue(fakeResponse([
      {
        id: "lev-001",
        text: "Senior Product Designer",
        hostedUrl: "https://jobs.lever.co/company/lev-001",
        categories: { location: "Remote, US", team: "Design" },
        createdAt: 1710288000000,
        descriptionPlain: "Design things remotely",
        workplaceType: "remote",
      },
      {
        id: "lev-002",
        text: "Backend Engineer",
        hostedUrl: "https://jobs.lever.co/company/lev-002",
        categories: { location: "NYC", team: "Engineering" },
        createdAt: 1710288000000,
        descriptionPlain: "Write code",
        workplaceType: "on-site",
      },
    ]));

    const jobs = await collectLeverCompany("company", ["product designer"]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({
      url: "https://jobs.lever.co/company/lev-001",
      source: "lever-api",
      externalId: "lev-001",
      title: "Senior Product Designer",
      companyName: "Company",
      location: "Remote, US",
      workMode: "remote",
      postedAt: new Date(1710288000000),
      salaryRange: "?",
      description: "Design things remotely",
    });
  });

  it("matches by team name too", async () => {
    mockFetch.mockResolvedValue(fakeResponse([
      {
        id: "lev-004",
        text: "Senior IC",
        hostedUrl: "https://jobs.lever.co/co/lev-004",
        categories: { location: "Remote", team: "Product Design" },
        createdAt: 1710288000000,
        descriptionPlain: "Remote design work",
        workplaceType: "remote",
      },
    ]));

    const jobs = await collectLeverCompany("co", ["product design"]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe("Senior IC");
  });
});
