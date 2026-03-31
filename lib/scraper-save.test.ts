import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before importing the module under test
vi.mock("@/lib/prisma", () => ({
  prisma: {
    blockedJob: { findMany: vi.fn() },
    company: { upsert: vi.fn() },
    job: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    jobSource: { upsert: vi.fn() },
    $queryRawUnsafe: vi.fn(),
  },
}));

// Mock location classifier — not relevant to dedup tests
vi.mock("@/lib/location", () => ({
  classifyLocation: () => ({ tooFar: false, flagged: false }),
}));

import { prisma } from "@/lib/prisma";
import { saveScrapedJobs } from "./scraper-save";

const db = prisma as unknown as {
  blockedJob: { findMany: ReturnType<typeof vi.fn> };
  company: { upsert: ReturnType<typeof vi.fn> };
  job: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  jobSource: { upsert: ReturnType<typeof vi.fn> };
  $queryRawUnsafe: ReturnType<typeof vi.fn>;
};

const baseJob = {
  title: "Product Designer",
  companyName: "Acme Corp",
  url: "https://board-a.com/job/1",
  location: "Remote",
  workMode: "remote",
  postedAt: new Date("2026-03-28"),
  salaryRange: "?",
  externalId: "ext-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no blocked URLs
  db.blockedJob.findMany.mockResolvedValue([]);
  // Default: company upsert returns an id
  db.company.upsert.mockResolvedValue({ id: "comp-1", name: "Acme Corp" });
  // Default: no existing job by URL
  db.job.findUnique.mockResolvedValue(null);
  // Default: no existing dupe by company+title
  db.$queryRawUnsafe.mockResolvedValue([]);
  // Default: job create returns a new job
  db.job.create.mockResolvedValue({ id: "job-new", ...baseJob });
  // Default: jobSource upsert succeeds
  db.jobSource.upsert.mockResolvedValue({});
});

describe("saveScrapedJobs — deduplication", () => {
  it("creates a new job when no URL or title match exists", async () => {
    const result = await saveScrapedJobs([baseJob], "term-1");

    expect(result.jobsNew).toBe(1);
    expect(db.job.create).toHaveBeenCalledTimes(1);
    expect(db.job.delete).not.toHaveBeenCalled();
  });

  it("skips creation when exact URL already exists", async () => {
    db.job.findUnique.mockResolvedValue({ id: "job-existing", status: "backlog" });

    const result = await saveScrapedJobs([baseJob], "term-1");

    expect(result.jobsNew).toBe(0);
    expect(db.job.create).not.toHaveBeenCalled();
    // Should still link the source
    expect(db.jobSource.upsert).toHaveBeenCalledTimes(1);
  });

  it("replaces a backlog dupe when same company+title found with different URL", async () => {
    db.$queryRawUnsafe.mockResolvedValue([{ id: "job-old", title: "Product Designer", status: "backlog" }]);
    db.job.create.mockResolvedValue({ id: "job-new", ...baseJob });

    const result = await saveScrapedJobs([baseJob], "term-1");

    // Old job should be deleted, new one created
    expect(db.job.delete).toHaveBeenCalledWith({ where: { id: "job-old" } });
    expect(db.job.create).toHaveBeenCalledTimes(1);
    expect(result.jobsNew).toBe(1);
  });

  it("replaces dupes in all replaceable statuses", async () => {
    for (const status of ["backlog", "too far", "expired", "won't apply", "rejected"]) {
      vi.clearAllMocks();
      db.blockedJob.findMany.mockResolvedValue([]);
      db.company.upsert.mockResolvedValue({ id: "comp-1" });
      db.job.findUnique.mockResolvedValue(null);
      db.$queryRawUnsafe.mockResolvedValue([{ id: `job-${status}`, title: "Product Designer", status }]);
      db.job.create.mockResolvedValue({ id: "job-new" });
      db.jobSource.upsert.mockResolvedValue({});

      const result = await saveScrapedJobs([baseJob], "term-1");

      expect(db.job.delete).toHaveBeenCalledTimes(1);
      expect(result.jobsNew).toBe(1);
    }
  });

  it("skips when dupe exists with a sacred (in-progress) status", async () => {
    for (const status of ["app. sent", "screening", "interview", "test", "offer"]) {
      vi.clearAllMocks();
      db.blockedJob.findMany.mockResolvedValue([]);
      db.company.upsert.mockResolvedValue({ id: "comp-1" });
      db.job.findUnique.mockResolvedValue(null);
      db.$queryRawUnsafe.mockResolvedValue([{ id: `job-${status}`, title: "Product Designer", status }]);
      db.jobSource.upsert.mockResolvedValue({});

      const result = await saveScrapedJobs([baseJob], "term-1");

      expect(db.job.delete).not.toHaveBeenCalled();
      expect(db.job.create).not.toHaveBeenCalled();
      expect(result.jobsNew).toBe(0);
    }
  });

  it("skips blocked URLs before any dedup check", async () => {
    db.blockedJob.findMany.mockResolvedValue([{ url: baseJob.url }]);

    const result = await saveScrapedJobs([baseJob], "term-1");

    expect(db.company.upsert).not.toHaveBeenCalled();
    expect(db.job.findUnique).not.toHaveBeenCalled();
    expect(result.jobsNew).toBe(0);
  });
});
