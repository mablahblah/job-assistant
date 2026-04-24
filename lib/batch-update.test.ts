import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before importing the module under test
vi.mock("@/lib/prisma", () => ({
  prisma: {
    job: { update: vi.fn() },
  },
}));

// Mock work-search-log — side effect, not under test here
vi.mock("@/lib/work-search-log", () => ({
  logWorkSearchActivity: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "@/lib/prisma";
import { batchAlignment, batchFlagMismatch, batchFlagAggregator, batchStatus } from "./batch-update";

const db = prisma as unknown as {
  job: { update: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  db.job.update.mockResolvedValue({});
});

describe("batchAlignment", () => {
  it("updates multiple jobs independently", async () => {
    const items = [
      { jobId: "job-1", score: 4 },
      { jobId: "job-2", score: 2 },
    ];

    const result = await batchAlignment(items);

    // Each job should have been updated with its alignment score
    expect(db.job.update).toHaveBeenCalledTimes(2);
    expect(db.job.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { jobAlignment: 4 },
    });
    expect(db.job.update).toHaveBeenCalledWith({
      where: { id: "job-2" },
      data: { jobAlignment: 2 },
    });
    expect(result).toEqual({ updated: 2, failed: 0 });
  });

  it("rejects scores out of range 1-5 without hitting the DB", async () => {
    const items = [
      { jobId: "job-1", score: 0 },  // too low
      { jobId: "job-2", score: 6 },  // too high
      { jobId: "job-3", score: 3 },  // valid
    ];

    const result = await batchAlignment(items);

    // Only the valid score triggers a DB call
    expect(db.job.update).toHaveBeenCalledTimes(1);
    expect(db.job.update).toHaveBeenCalledWith({
      where: { id: "job-3" },
      data: { jobAlignment: 3 },
    });
    expect(result.updated).toBe(1);
    expect(result.failed).toBe(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        { jobId: "job-1", error: "Score must be 1-5" },
        { jobId: "job-2", error: "Score must be 1-5" },
      ])
    );
  });

  it("records a failed entry when a job ID does not exist in the DB", async () => {
    // Simulate Prisma throwing on an unknown job ID
    db.job.update.mockRejectedValue(new Error("Record not found"));

    const items = [{ jobId: "nonexistent-job", score: 3 }];

    const result = await batchAlignment(items);

    expect(result.updated).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual([
      { jobId: "nonexistent-job", error: "Job not found" },
    ]);
  });

  it("reports DB errors and continues with valid items", async () => {
    db.job.update
      .mockResolvedValueOnce({}) // job-1 succeeds
      .mockRejectedValueOnce(new Error("Record not found")); // job-2 fails

    const input = [
      { jobId: "job-1", score: 4 },
      { jobId: "job-2", score: 3 },
    ];

    const result = await batchAlignment(input);

    expect(result).toEqual({
      updated: 1,
      failed: 1,
      errors: [{ jobId: "job-2", error: "Job not found" }],
    });
  });
});

describe("batchFlagMismatch", () => {
  it("flags multiple jobs with title mismatch reasons", async () => {
    const input = [
      { jobId: "job-1", reason: "Actually a PM role" },
      { jobId: "job-2", reason: "Coordinator position" },
    ];
    const result = await batchFlagMismatch(input);
    expect(result).toEqual({ updated: 2, failed: 0 });
    expect(db.job.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { titleMismatch: true, titleMismatchReason: "Actually a PM role" },
    });
  });
});

describe("batchFlagAggregator", () => {
  it("flags multiple jobs as aggregator postings", async () => {
    const result = await batchFlagAggregator(["job-1", "job-2", "job-3"]);
    expect(result).toEqual({ updated: 3, failed: 0 });
    expect(db.job.update).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: { isUnresolvedAggregator: true },
    });
  });
});

describe("batchStatus", () => {
  it("updates status and calls logWorkSearchActivity for each item", async () => {
    const { logWorkSearchActivity } = await import("@/lib/work-search-log");
    const input = [
      { jobId: "job-1", status: "repost" },
      { jobId: "job-2", status: "app. sent" },
    ];
    const result = await batchStatus(input);
    expect(result).toEqual({ updated: 2, failed: 0 });
    expect(db.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "job-1" },
        data: expect.objectContaining({ status: "repost" }),
      })
    );
    expect(logWorkSearchActivity).toHaveBeenCalledWith("job-1", "repost");
    expect(logWorkSearchActivity).toHaveBeenCalledWith("job-2", "app. sent");
  });
});
