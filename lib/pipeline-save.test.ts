import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before importing module under test
vi.mock("@/lib/prisma", () => ({
  prisma: {
    blockedJob: { findMany: vi.fn() },
    company: { upsert: vi.fn() },
    job: { create: vi.fn() },
  },
}));

vi.mock("@/lib/location", () => ({
  classifyLocation: vi.fn(() => ({ tooFar: false })),
}));

import { prisma } from "@/lib/prisma";
import { classifyLocation } from "@/lib/location";
import { saveParsedJobs, type SaveableJob } from "./pipeline-save";

const mockClassify = classifyLocation as ReturnType<typeof vi.fn>;

const db = prisma as unknown as {
  blockedJob: { findMany: ReturnType<typeof vi.fn> };
  company: { upsert: ReturnType<typeof vi.fn> };
  job: { create: ReturnType<typeof vi.fn> };
};

// Use a recent date so jobs don't auto-expire during tests
const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
  .toISOString()
  .split("T")[0];

// Helper: builds a minimal SaveableJob
function makeJob(overrides: Partial<SaveableJob> = {}): SaveableJob {
  return {
    url: "https://jobs.ashbyhq.com/acme/123",
    title: "Product Designer",
    companyName: "Acme Corp",
    location: "Remote",
    workMode: "remote",
    postedAt: recentDate,
    salaryRange: "$120-$150k",
    source: "adzuna",
    parser: "ashby",
    originalUrl: "https://jobs.ashbyhq.com/acme/123",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no blocked URLs
  db.blockedJob.findMany.mockResolvedValue([]);
  db.company.upsert.mockResolvedValue({ id: "comp-1", name: "Acme Corp" });
  db.job.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: "job-1", ...data }));
});

describe("saveParsedJobs", () => {
  it("saves a new parsed job to backlog with tracking fields", async () => {
    const result = await saveParsedJobs([makeJob()], "search");

    expect(result.saved).toBe(1);
    expect(db.job.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        title: "Product Designer",
        url: "https://jobs.ashbyhq.com/acme/123",
        status: "backlog",
        source: "adzuna",
        parser: "ashby",
        originalUrl: "https://jobs.ashbyhq.com/acme/123",
      }),
    });
  });

  it("skips blocked URLs", async () => {
    db.blockedJob.findMany.mockResolvedValue([{ url: "https://jobs.ashbyhq.com/acme/123" }]);

    const result = await saveParsedJobs([makeJob()], "search");

    expect(result.skipped).toBe(1);
    expect(result.saved).toBe(0);
    expect(db.job.create).not.toHaveBeenCalled();
  });

  it("classifies expired jobs in search mode", async () => {
    await saveParsedJobs([makeJob({ postedAt: "2026-04-01" })], "search");

    expect(db.job.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "expired" }),
    });
  });

  it("classifies too-far jobs in search mode", async () => {
    mockClassify.mockReturnValue({ tooFar: true, flagged: false });

    await saveParsedJobs([makeJob()], "search");

    expect(db.job.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "too far" }),
    });
  });

  it("forces backlog in external mode regardless of location", async () => {
    mockClassify.mockReturnValue({ tooFar: true, flagged: false });

    await saveParsedJobs([makeJob()], "external");

    expect(db.job.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "backlog" }),
    });
  });

  it("forces backlog in external mode regardless of age", async () => {
    await saveParsedJobs([makeJob({ postedAt: "2026-01-01" })], "external");

    expect(db.job.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "backlog" }),
    });
  });

  it("skips jobs with missing title", async () => {
    const result = await saveParsedJobs([makeJob({ title: "" })], "search");

    expect(result.skipped).toBe(1);
    expect(db.job.create).not.toHaveBeenCalled();
  });

  it("skips jobs with missing company name", async () => {
    const result = await saveParsedJobs([makeJob({ companyName: "" })], "search");

    expect(result.skipped).toBe(1);
    expect(db.job.create).not.toHaveBeenCalled();
  });

  it("uses geoStatus when provided (too far)", async () => {
    await saveParsedJobs([makeJob({ geoStatus: "too far" })], "search");

    expect(db.job.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "too far" }),
    });
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it("uses geoStatus when provided (backlog)", async () => {
    await saveParsedJobs([makeJob({ geoStatus: "backlog" })], "search");

    expect(db.job.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "backlog" }),
    });
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it("falls back to classifyLocation for remote jobs (geoStatus skip)", async () => {
    mockClassify.mockReturnValue({ tooFar: false });

    await saveParsedJobs([makeJob({ geoStatus: "skip", workMode: "remote" })], "search");

    expect(mockClassify).toHaveBeenCalled();
  });

  it("saves originalUrl when resolution changed the URL", async () => {
    await saveParsedJobs([makeJob({
      url: "https://jobs.ashbyhq.com/acme/123",
      originalUrl: "https://adzuna.com/job/456",
    })], "search");

    expect(db.job.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        url: "https://jobs.ashbyhq.com/acme/123",
        originalUrl: "https://adzuna.com/job/456",
      }),
    });
  });
});
