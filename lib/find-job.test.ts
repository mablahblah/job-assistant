import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before importing the module under test
vi.mock("@/lib/prisma", () => ({
  prisma: {
    job: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import { findJobs } from "./find-job";

const db = prisma as unknown as {
  job: { findMany: ReturnType<typeof vi.fn> };
};

// Minimal row shape matching what Prisma returns (with nested company)
function makeJobRow(overrides: Partial<{
  id: string;
  title: string;
  companyName: string;
  status: string;
  location: string;
  workMode: string;
  salaryRange: string;
  url: string;
  firstPublished: Date;
}> = {}) {
  return {
    id: overrides.id ?? "job-1",
    title: overrides.title ?? "Senior Product Designer",
    status: overrides.status ?? "backlog",
    location: overrides.location ?? "Remote, US",
    workMode: overrides.workMode ?? "remote",
    salaryRange: overrides.salaryRange ?? "$150-180k",
    url: overrides.url ?? "https://example.com/job/1",
    firstPublished: overrides.firstPublished ?? new Date("2026-06-15"),
    company: { name: overrides.companyName ?? "Google" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("findJobs", () => {
  it("searches by company only when role is omitted", async () => {
    db.job.findMany.mockResolvedValue([makeJobRow()]);

    await findJobs("google");

    // Should query with company contains filter but no title filter
    expect(db.job.findMany).toHaveBeenCalledWith({
      where: {
        company: { name: { contains: "google" } },
      },
      include: { company: true },
      orderBy: { firstPublished: "desc" },
    });
  });

  it("searches by both company and role when role is provided", async () => {
    db.job.findMany.mockResolvedValue([makeJobRow()]);

    await findJobs("google", "product designer");

    expect(db.job.findMany).toHaveBeenCalledWith({
      where: {
        company: { name: { contains: "google" } },
        title: { contains: "product designer" },
      },
      include: { company: true },
      orderBy: { firstPublished: "desc" },
    });
  });

  it("returns formatted job objects", async () => {
    db.job.findMany.mockResolvedValue([
      makeJobRow({ id: "job-1", title: "Sr Product Designer", companyName: "Google", status: "backlog" }),
    ]);

    const result = await findJobs("google");

    expect(result).toEqual([
      {
        id: "job-1",
        title: "Sr Product Designer",
        company: "Google",
        status: "backlog",
        location: "Remote, US",
        workMode: "remote",
        salary: "$150-180k",
        url: "https://example.com/job/1",
        posted: "2026-06-15",
      },
    ]);
  });

  it("returns empty array when no matches found", async () => {
    db.job.findMany.mockResolvedValue([]);

    const result = await findJobs("nonexistent");

    expect(result).toEqual([]);
  });
});
