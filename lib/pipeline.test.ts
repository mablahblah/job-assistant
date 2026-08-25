import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all dependencies
vi.mock("@/lib/prisma", () => ({
  prisma: {
    job: {
      findMany: vi.fn(() => Promise.resolve([])),
      update: vi.fn(() => Promise.resolve({})),
    },
  },
}));
vi.mock("@/lib/location", () => ({ classifyLocation: vi.fn(() => "remote") }));
vi.mock("./pipeline-save", () => ({
  saveParsedJobs: vi.fn(() => Promise.resolve({ saved: 0, skipped: 0, savedJobIds: [] })),
}));
vi.mock("./parsers/registry", () => ({
  isGreenlitDomain: vi.fn(() => null),
  routeByDomain: vi.fn(() => ({ matched: {}, unmatched: [] })),
  getParser: vi.fn(() => null),
  registerParser: vi.fn(),
}));
vi.mock("./parsers/ashby", () => ({
  parseAshbyJob: vi.fn(),
}));
vi.mock("./parsers/greenhouse", () => ({
  parseGreenhouseJob: vi.fn(),
}));
vi.mock("./parsers/lever", () => ({
  parseLeverJob: vi.fn(),
}));
vi.mock("./parsers/adzuna", () => ({
  parseAdzunaJob: vi.fn(),
}));
vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn(() => Promise.resolve({ close: vi.fn() })),
  },
}));

import { runPipeline } from "./pipeline";
import { saveParsedJobs } from "./pipeline-save";
import { routeByDomain, isGreenlitDomain, getParser } from "./parsers/registry";
import type { CollectedJob } from "./collectors/types";
import { prisma } from "@/lib/prisma";

const mockSave = saveParsedJobs as ReturnType<typeof vi.fn>;
const mockRoute = routeByDomain as ReturnType<typeof vi.fn>;
const mockIsGreenlit = isGreenlitDomain as ReturnType<typeof vi.fn>;
const mockGetParser = getParser as ReturnType<typeof vi.fn>;
// Typed reference to the prisma mock so we can control findMany return values per test
const mockPrisma = prisma as unknown as {
  job: { findMany: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  // Reset all mocks and re-establish explicit defaults so each test starts clean.
  vi.resetAllMocks();
  mockPrisma.job.findMany.mockResolvedValue([]);
  mockIsGreenlit.mockReturnValue(null);
  mockRoute.mockReturnValue({ matched: {}, unmatched: [] });
  mockPrisma.job.update.mockResolvedValue({});
  mockSave.mockResolvedValue({ saved: 0, skipped: 0, savedJobIds: [] });
});

describe("runPipeline", () => {
  it("drops unmatched jobs in search mode", async () => {
    const jobs: CollectedJob[] = [{ url: "https://unknown.com/job/1", source: "adzuna" }];
    mockIsGreenlit.mockReturnValue(null);
    mockRoute.mockReturnValue({ matched: {}, unmatched: [{ id: "https://unknown.com/job/1", finalDomain: "unknown.com", url: "https://unknown.com/job/1", finalUrl: "https://unknown.com/job/1", title: "", companyName: "", source: "resolved" }] });

    await runPipeline(jobs, "search", { skipPlaywright: true });

    // Save called with empty array — unmatched dropped in search mode
    expect(mockSave).toHaveBeenCalledWith([], "search");
  });

  it("keeps unmatched jobs in external mode", async () => {
    const jobs: CollectedJob[] = [{
      url: "https://unknown.com/job/1",
      source: "external",
      title: "Designer",
      companyName: "SomeCompany",
    }];
    mockIsGreenlit.mockReturnValue(null);
    mockRoute.mockReturnValue({
      matched: {},
      unmatched: [{
        id: "https://unknown.com/job/1",
        url: "https://unknown.com/job/1",
        title: "Designer",
        companyName: "SomeCompany",
        finalUrl: "https://unknown.com/job/1",
        finalDomain: "unknown.com",
        source: "resolved",
      }],
    });

    await runPipeline(jobs, "external", { skipPlaywright: true });

    expect(mockSave).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          parser: null,
          source: "external",
          title: "Designer",
          companyName: "SomeCompany",
        }),
      ]),
      "external",
    );
  });

  it("routes greenlit domain jobs without resolution", async () => {
    const jobs: CollectedJob[] = [{ url: "https://jobs.ashbyhq.com/acme/123", source: "adzuna" }];
    mockIsGreenlit.mockReturnValue("jobs.ashbyhq.com");
    mockRoute.mockReturnValue({
      matched: { "jobs.ashbyhq.com": [{ id: "https://jobs.ashbyhq.com/acme/123", finalDomain: "jobs.ashbyhq.com", finalUrl: "https://jobs.ashbyhq.com/acme/123", url: "https://jobs.ashbyhq.com/acme/123", title: "", companyName: "", source: "greenlit-shortcut" }] },
      unmatched: [],
    });

    await runPipeline(jobs, "search", { skipPlaywright: true });

    // Should have been routed with greenlit-shortcut source
    expect(mockRoute).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ finalDomain: "jobs.ashbyhq.com", source: "greenlit-shortcut" }),
      ]),
    );
  });

  it("filters out collected jobs whose originalUrl matches DB", async () => {
    // Dedupe 1 checks collector URLs against DB originalUrls
    mockPrisma.job.findMany.mockImplementation(({ where }: { where?: { originalUrl?: unknown } }) => {
      if (where?.originalUrl) {
        return Promise.resolve([{ originalUrl: "https://jobs.ashbyhq.com/acme/123" }]);
      }
      return Promise.resolve([]);
    });
    mockIsGreenlit.mockReturnValue(null);
    mockRoute.mockReturnValue({ matched: {}, unmatched: [] });

    const jobs: CollectedJob[] = [
      { url: "https://jobs.ashbyhq.com/acme/123", source: "adzuna" },
      { url: "https://newsite.com/job/456", source: "adzuna" },
    ];

    const result = await runPipeline(jobs, "search", { skipPlaywright: true });

    expect(result.dedupe1.droppedDbMatches).toBe(1);
    expect(result.collected).toBe(2);
  });

  it("passes through jobs not found in the DB", async () => {
    mockPrisma.job.findMany.mockResolvedValue([]);
    mockIsGreenlit.mockReturnValue(null);
    mockRoute.mockReturnValue({ matched: {}, unmatched: [] });

    const jobs: CollectedJob[] = [
      { url: "https://brand-new.com/job/1", source: "adzuna" },
    ];

    const result = await runPipeline(jobs, "search", { skipPlaywright: true });

    expect(result.dedupe1.droppedBatchDupes).toBe(0);
    expect(result.dedupe1.droppedDbMatches).toBe(0);
  });

  it("records failure when parser returns success: false", async () => {
    const jobs: CollectedJob[] = [
      { url: "https://jobs.ashbyhq.com/acme/123", source: "jsearch" },
    ];

    // Job is greenlit — skips resolution, goes straight to parsing
    mockIsGreenlit.mockReturnValue("jobs.ashbyhq.com");
    mockRoute.mockReturnValue({
      matched: {
        "jobs.ashbyhq.com": [{
          id: "https://jobs.ashbyhq.com/acme/123",
          url: "https://jobs.ashbyhq.com/acme/123",
          finalUrl: "https://jobs.ashbyhq.com/acme/123",
          finalDomain: "jobs.ashbyhq.com",
          title: "",
          companyName: "",
          source: "greenlit-shortcut",
        }],
      },
      unmatched: [],
    });

    // Parser returns unsuccessful result
    mockGetParser.mockReturnValue(
      vi.fn().mockResolvedValue({
        success: false,
        url: "https://jobs.ashbyhq.com/acme/123",
        finalUrl: "https://jobs.ashbyhq.com/acme/123",
        parser: "ashby",
        fields: {},
        failedFields: [],
        error: "page not found",
      }),
    );

    // No skipPlaywright — parsing block runs with mocked browser
    const result = await runPipeline(jobs, "search");

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toEqual({
      url: "https://jobs.ashbyhq.com/acme/123",
      parser: "ashby",
      error: "page not found",
    });
    expect(result.parsed).toBe(0);
  });

  it("records failure when parser throws an exception", async () => {
    const jobs: CollectedJob[] = [
      { url: "https://jobs.ashbyhq.com/acme/456", source: "jsearch" },
    ];

    mockIsGreenlit.mockReturnValue("jobs.ashbyhq.com");
    mockRoute.mockReturnValue({
      matched: {
        "jobs.ashbyhq.com": [{
          id: "https://jobs.ashbyhq.com/acme/456",
          url: "https://jobs.ashbyhq.com/acme/456",
          finalUrl: "https://jobs.ashbyhq.com/acme/456",
          finalDomain: "jobs.ashbyhq.com",
          title: "",
          companyName: "",
          source: "greenlit-shortcut",
        }],
      },
      unmatched: [],
    });

    // Parser throws
    mockGetParser.mockReturnValue(
      vi.fn().mockRejectedValue(new Error("timeout waiting for selector")),
    );

    const result = await runPipeline(jobs, "search");

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toEqual({
      url: "https://jobs.ashbyhq.com/acme/456",
      parser: "jobs.ashbyhq.com",
      error: "timeout waiting for selector",
    });
    expect(result.parsed).toBe(0);
  });

  it("drops non-Adzuna jobs that resolve to adzuna.com (source gate)", async () => {
    // A JSearch job whose URL resolved to adzuna.com — the pass-through parser
    // must not be allowed to save unverified aggregator data for it.
    const { parseAdzunaJob } = await import("./parsers/adzuna");
    const mockParse = parseAdzunaJob as ReturnType<typeof vi.fn>;
    mockParse.mockResolvedValue({
      finalUrl: "https://www.adzuna.com/details/99",
      parser: "adzuna",
      fields: { title: "Designer", companyName: "Acme", location: "Remote", workMode: "remote", dates: ["2026-04-01"], salaryRange: "?" },
    });

    const jobs: CollectedJob[] = [
      { url: "https://jsearch.com/job/99", source: "jsearch" },
    ];

    mockIsGreenlit.mockReturnValue(null);
    mockRoute.mockReturnValue({
      matched: {
        "www.adzuna.com": [{
          id: "https://jsearch.com/job/99",
          url: "https://jsearch.com/job/99",
          finalUrl: "https://www.adzuna.com/details/99",
          finalDomain: "www.adzuna.com",
          title: "",
          companyName: "",
          source: "resolved",
        }],
      },
      unmatched: [],
    });

    await runPipeline(jobs, "search", { skipPlaywright: true });

    // Source gate must have dropped the job — save must be called with an empty list.
    expect(mockSave).toHaveBeenCalledWith([], "search");
  });
});
