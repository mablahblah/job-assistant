import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch-utils so scrapers don't make real HTTP calls
vi.mock("./fetch-utils", async () => {
  const actual = await vi.importActual<typeof import("./fetch-utils")>("./fetch-utils");
  return {
    ...actual,
    // fetchWithTimeout will be controlled per-test via mockResolvedValue
    fetchWithTimeout: vi.fn(),
  };
});

import { fetchWithTimeout } from "./fetch-utils";
import { scrapeAdzuna } from "./adzuna";
import { scrapeJSearch } from "./jsearch";
import { scrapeGreenhouseCompany } from "./greenhouse";
import { scrapeLeverCompany } from "./lever";

const mockFetch = fetchWithTimeout as ReturnType<typeof vi.fn>;

// Helper: fake Response object with json() support
function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Adzuna ---

describe("scrapeAdzuna", () => {
  beforeEach(() => {
    process.env.ADZUNA_APP_ID = "test-id";
    process.env.ADZUNA_API_KEY = "test-key";
  });

  it("maps API response to ScrapedJob[]", async () => {
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

    const jobs = await scrapeAdzuna();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({
      externalId: "abc123",
      title: "Senior Product Designer",
      companyName: "Acme Corp",
      url: "https://adzuna.com/job/abc123",
      location: "New York, NY",
      workMode: "remote",
      postedAt: new Date("2026-03-15T00:00:00Z"),
      salaryRange: "$120-180k",
      description: "Remote role designing products",
    });
  });

  it("returns '?' for missing salary", async () => {
    mockFetch.mockResolvedValue(fakeResponse({
      results: [{
        id: "1",
        title: "Designer",
        company: { display_name: "Co" },
        description: "A job",
        redirect_url: "https://example.com",
        location: { display_name: "LA" },
        created: "2026-03-15T00:00:00Z",
      }],
      count: 1,
    }));

    const jobs = await scrapeAdzuna();
    expect(jobs[0].salaryRange).toBe("?");
  });

  it("returns empty array when no results", async () => {
    mockFetch.mockResolvedValue(fakeResponse({ results: null, count: 0 }));
    const jobs = await scrapeAdzuna();
    expect(jobs).toEqual([]);
  });

  it("throws on missing API keys", async () => {
    delete process.env.ADZUNA_APP_ID;
    await expect(scrapeAdzuna()).rejects.toThrow("Missing API key");
  });
});

// --- JSearch ---

describe("scrapeJSearch", () => {
  beforeEach(() => {
    process.env.RAPIDAPI_KEY = "test-key";
  });

  it("maps API response to ScrapedJob[]", async () => {
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

    const jobs = await scrapeJSearch();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({
      externalId: "j-001",
      title: "Product Designer",
      companyName: "DesignCo",
      url: "https://designco.com/apply",
      location: "Austin, TX, US",
      workMode: "remote",
      postedAt: new Date("2026-03-10T12:00:00Z"),
      salaryRange: "$100-150k",
      description: "Design amazing products",
    });
  });

  it("formats hourly salary with period label", async () => {
    mockFetch.mockResolvedValue(fakeResponse({
      status: "OK",
      data: [{
        job_id: "j-002",
        job_title: "Contract Designer",
        employer_name: "Agency",
        job_apply_link: "https://agency.com/apply",
        job_is_remote: false,
        job_min_salary: 50,
        job_max_salary: 75,
        job_salary_period: "HOUR",
        job_description: "",
      }],
    }));

    const jobs = await scrapeJSearch();
    expect(jobs[0].salaryRange).toBe("$50/hour-$75/hour");
    expect(jobs[0].workMode).toBe("");
  });

  it("returns '?' for missing salary", async () => {
    mockFetch.mockResolvedValue(fakeResponse({
      status: "OK",
      data: [{
        job_id: "j-003",
        job_title: "Designer",
        employer_name: "Co",
        job_apply_link: "https://co.com",
        job_is_remote: false,
      }],
    }));

    const jobs = await scrapeJSearch();
    expect(jobs[0].salaryRange).toBe("?");
  });
});

// --- Greenhouse ---

describe("scrapeGreenhouseCompany", () => {
  it("maps API response and filters by query", async () => {
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

    const jobs = await scrapeGreenhouseCompany("acme", ["product designer"]);
    // Only the product designer job should match
    expect(jobs).toHaveLength(1);
    expect(jobs[0].externalId).toBe("101");
    expect(jobs[0].title).toBe("Product Designer");
    expect(jobs[0].companyName).toBe("Acme");
    expect(jobs[0].workMode).toBe("hybrid");
    expect(jobs[0].salaryRange).toBe("$150-200k");
  });

  it("returns '?' when no salary in content", async () => {
    mockFetch.mockResolvedValue(fakeResponse({
      jobs: [{
        id: 201,
        title: "Designer",
        absolute_url: "https://boards.greenhouse.io/co/jobs/201",
        location: { name: "NYC" },
        updated_at: "2026-03-12T00:00:00Z",
        content: "<p>No salary info here</p>",
      }],
    }));

    const jobs = await scrapeGreenhouseCompany("co", ["designer"]);
    expect(jobs[0].salaryRange).toBe("?");
  });

  it("returns empty array for 404", async () => {
    mockFetch.mockResolvedValue(fakeResponse(null, false, 404));
    await expect(scrapeGreenhouseCompany("nonexistent", ["designer"])).rejects.toThrow("board not found");
  });
});

// --- Lever ---

describe("scrapeLeverCompany", () => {
  it("maps API response with structured workplaceType", async () => {
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

    const jobs = await scrapeLeverCompany("company", ["product designer"]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual({
      externalId: "lev-001",
      title: "Senior Product Designer",
      companyName: "Company",
      url: "https://jobs.lever.co/company/lev-001",
      location: "Remote, US",
      workMode: "remote",
      postedAt: new Date(1710288000000),
      salaryRange: "?",
      description: "Design things remotely",
    });
  });

  it("falls back to text detection when workplaceType missing", async () => {
    mockFetch.mockResolvedValue(fakeResponse([
      {
        id: "lev-003",
        text: "Product Designer",
        hostedUrl: "https://jobs.lever.co/co/lev-003",
        categories: { location: "SF" },
        createdAt: 1710288000000,
        descriptionPlain: "This is a hybrid role based in SF",
      },
    ]));

    const jobs = await scrapeLeverCompany("co", ["product designer"]);
    expect(jobs[0].workMode).toBe("hybrid");
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

    const jobs = await scrapeLeverCompany("co", ["product design"]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe("Senior IC");
  });
});
