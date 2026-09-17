import { describe, expect, test } from "vitest";
import { fakeWorkLogService } from "./work-log-service.fake";
import type { WorkLogInput } from "./work-log-service";

function entryFor(jobId: string, overrides: Partial<WorkLogInput> = {}): WorkLogInput {
  return {
    job_id: jobId,
    company_name: "Figma",
    job_title: "Senior Product Designer",
    activity: "Applied for job",
    ...overrides,
  };
}

describe("the fake work log service", () => {
  test("holds the entry it was asked to write", async () => {
    const written: Parameters<typeof fakeWorkLogService>[0] = [];
    const service = fakeWorkLogService(written);

    await service.write(entryFor("job-a"));

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      job_id: "job-a",
      company_name: "Figma",
      job_title: "Senior Product Designer",
      activity: "Applied for job",
    });
  });

  // The real service hands back the row the database made, so the stand-in
  // has to supply an id and a creation date of its own.
  test("hands back the entry with an id and a creation date", async () => {
    const service = fakeWorkLogService();

    const entry = await service.write(entryFor("job-a"));

    expect(entry.id).toBeTruthy();
    expect(entry.created_at).toBeInstanceOf(Date);
  });

  test("two writes for one job are two held entries", async () => {
    const written: Parameters<typeof fakeWorkLogService>[0] = [];
    const service = fakeWorkLogService(written);

    await service.write(entryFor("job-a", { activity: "Applied for job" }));
    await service.write(entryFor("job-a", { activity: "Had interview" }));

    expect(written.map((entry) => entry.activity)).toEqual(["Applied for job", "Had interview"]);
  });

  test("every held entry carries its own id", async () => {
    const written: Parameters<typeof fakeWorkLogService>[0] = [];
    const service = fakeWorkLogService(written);

    await service.write(entryFor("job-a"));
    await service.write(entryFor("job-b"));

    expect(written[0]?.id).not.toBe(written[1]?.id);
  });
});

// A handler's test needs a failing write to check what the run reports, and
// the real failure is a database refusal it cannot produce in memory.
describe("the fake refusing a write", () => {
  test("an override can make the write fail", async () => {
    const service = fakeWorkLogService([], {
      write: async () => {
        throw new Error("no such table: WorkLogEntry");
      },
    });

    await expect(service.write(entryFor("job-a"))).rejects.toThrow("no such table");
  });

  test("a refused write holds nothing", async () => {
    const written: Parameters<typeof fakeWorkLogService>[0] = [];
    const service = fakeWorkLogService(written, {
      write: async () => {
        throw new Error("refused");
      },
    });

    await expect(service.write(entryFor("job-a"))).rejects.toThrow();

    expect(written).toHaveLength(0);
  });
});
