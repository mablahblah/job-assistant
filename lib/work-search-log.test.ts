import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before importing the module under test
vi.mock("@/lib/prisma", () => ({
  prisma: {
    job: { findUnique: vi.fn() },
    company: { findUnique: vi.fn(), update: vi.fn() },
    workSearchEntry: { create: vi.fn() },
  },
}));

// Mock enrichCompany — fire-and-forget side effect, not under test here
vi.mock("@/lib/company-enrichment", () => ({
  enrichCompany: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "@/lib/prisma";
import { logWorkSearchActivity } from "./work-search-log";

const db = prisma as unknown as {
  job: { findUnique: ReturnType<typeof vi.fn> };
  company: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  workSearchEntry: { create: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  db.job.findUnique.mockResolvedValue({ companyId: "comp-1", location: "Remote" });
  db.company.findUnique.mockResolvedValue({ enrichedAt: null }); // not yet enriched — pending path runs
  db.company.update.mockResolvedValue({});
  db.workSearchEntry.create.mockResolvedValue({});
});

describe("logWorkSearchActivity", () => {
  it('creates an entry with activityType "Applied for job" when status is "app. sent"', async () => {
    await logWorkSearchActivity("job-1", "app. sent");

    expect(db.workSearchEntry.create).toHaveBeenCalledTimes(1);
    expect(db.workSearchEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ jobId: "job-1", activityType: "Applied for job" }),
    });
  });

  it('creates an entry with activityType "Had phone screen" when status is "screening"', async () => {
    await logWorkSearchActivity("job-2", "screening");

    expect(db.workSearchEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ jobId: "job-2", activityType: "Had phone screen" }),
    });
  });

  it('creates an entry with activityType "Had interview" when status is "interview"', async () => {
    await logWorkSearchActivity("job-3", "interview");

    expect(db.workSearchEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ jobId: "job-3", activityType: "Had interview" }),
    });
  });

  it("does NOT create an entry for non-qualifying statuses", async () => {
    for (const status of ["backlog", "rejected", "won't apply", "too far", "expired", "offer", "test"]) {
      await logWorkSearchActivity("job-x", status);
    }

    expect(db.workSearchEntry.create).not.toHaveBeenCalled();
  });

  it("sets date to a recent timestamp (not a hardcoded/stale value)", async () => {
    const before = new Date();
    await logWorkSearchActivity("job-1", "app. sent");
    const after = new Date();

    const call = db.workSearchEntry.create.mock.calls[0][0];
    const date: Date = call.data.date;

    expect(date.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(date.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
